#!/usr/bin/env node
/**
 * contacts-characterization.test.mjs: a snapshot of how the contact stores
 * behave TODAY, including everywhere they behave WRONGLY.
 *
 * READ THIS BEFORE "FIXING" A FAILING ASSERTION HERE.
 *
 * Most suites assert that the code is correct. This one asserts only that the
 * code is UNCHANGED. Roughly a third of the expected values below are known
 * defects, each marked with a "WRONG, recorded deliberately" comment. They are
 * pinned on purpose. An assertion here going red does not mean this file is
 * out of date; it means some other change moved a number, and the point of the
 * file is to say exactly which one.
 *
 * It exists because the contact stores are about to be unified behind one
 * identity layer, and every one of them lives under `data/`, which is
 * gitignored. There is no `git checkout` for a number that silently shifts in
 * a user's live tracker. This suite is the closest thing to an undo we get:
 * before-and-after evidence for the two laps that touch the parsers.
 * Lap 2b collapsed the three LinkedIn parsers into one, so the table now tracks two.
 *
 * The defects pinned here, all real as of 2026-08-22:
 *   - Lap 3 replaced the two correspondence parsers with one shared parser and
 *     normalized direction and channel casing.
 *   - `resolveReferralLink` skips its company check when the referral's "where"
 *     cell is blank, so two different people who share a name are merged into
 *     one timeline.
 *   - Its name normalizer deletes non-ASCII letters, so an accented name never
 *     matches its unaccented twin.
 *   - `canonicalLinkedinUrl` falls through and returns its stripped input when
 *     the URL is not a /in/ profile, so "n/a" is a truthy identity key.
 *   - The three slug parsers disagree on whitespace, percent-encoding, and
 *     literal Unicode.
 *
 * When a later lap changes one of these on purpose, update THAT assertion and
 * leave a comment naming the lap and the old value. Do not bulk-update.
 *
 * Fixtures are invented people at .example domains and -ex handles. No real
 * personal data, and nothing under data/ is read or written: TJK_DATA_DIR
 * points at a temp sandbox before any server module loads.
 *
 * Run: node tests/contacts-characterization.test.mjs   (exit 0 = pass)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-contacts-characterization-'));
process.env.TJK_DATA_DIR = sandbox;
const rule = Array(16).fill(['-', '-', '-'].join('')).join('|');

fs.writeFileSync(path.join(sandbox, 'target-talent.md'),
  '# Target Talent\n\n' +
  '| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\n' +
  `|${rule}|\n` +
  '| 1 | Acme | Ramirez | Jose |  |  |  |  |  |  | jose@acme.example | linkedin.com/in/jose-ramirez-ex | Sent |  |  |  |\n' +
  '| 2 | Globex | Vance | Dana |  |  |  |  |  |  | dana@globex.example | n/a | Sent |  |  |  |\n' +
  '| 3 | Initech | Doe | Jane |  |  |  |  |  |  | jane@initech.example | https://www.linkedin.com/in/jane-doe-ex (personal) | Sent |  |  |  |\n',
  'utf8');

const { appendReferralRows, readReferralCorrespondence } =
  await import('../dashboard-web/server/lib/referrals.mjs');
const referrals = appendReferralRows([
  { name: 'José Ramírez', where: 'Acme', linkedin: '' },
  { name: 'Dana Vance', where: '', linkedin: 'n/a' },
  { name: 'Jane Doe', where: 'Initech', linkedin: 'https://www.linkedin.com/in/jane-doe-ex' },
]);

fs.mkdirSync(path.join(sandbox, 'target-talent-correspondence'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'target-talent-correspondence', '1.md'),
  '## 2026-08-01 | Sent | LinkedIn | LinkedIn connection request\n\nFirst note\n\n' +
  '## 2026-08-02 | SENT | LINKEDIN | Second note\n\nSecond body\n', 'utf8');
fs.mkdirSync(path.join(sandbox, 'referral-correspondence'), { recursive: true });
fs.writeFileSync(path.join(sandbox, 'referral-correspondence', `${referrals[0].id}.md`),
  '## 2026-08-01 | Sent | Email | Hello\n\nFirst email\n\n' +
  '## 2026-08-02 | SENT | Email | Upper case direction\n\nSecond email\n', 'utf8');

const express = (await import('express')).default;
const { router: referralsRouter } = await import('../dashboard-web/server/routes/referrals.mjs');
const { readTTCorrespondence } = await import('../dashboard-web/server/lib/target-talent.mjs');
const { outreachCapState, summarizeThread } = await import('../dashboard-web/server/lib/correspondence-context.mjs');
const { linkedinKey, cleanName } = await import('../dashboard-web/server/lib/contact-identity.mjs');
const { canonicalLinkedinUrl } = await import('../dashboard-web/server/lib/linkedin-referrals.mjs');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(referralsRouter);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('contacts-characterization.test.mjs');

const taMessages = readTTCorrespondence(1);
const referralMessages = readReferralCorrespondence(referrals[0].id);

console.log('\n1. Correspondence parsing is shared by the two stores');
check(taMessages.length === 2, 'TA parser returns exactly 2 entries');
// Lap 3 changed the referral count from 1 to 2.
check(referralMessages.length === 2, 'referral parser returns exactly 2 entries');
check(taMessages[0].direction === 'Sent', 'TA first direction is Sent');
check(taMessages[0].channel === 'LinkedIn', 'TA first channel is LinkedIn');
// Lap 3 changed the normalized direction from SENT to Sent.
check(taMessages[1].direction === 'Sent', 'TA second direction is Sent');
check(taMessages[1].channel === 'LinkedIn', 'TA second channel is LinkedIn');
check(referralMessages.every(m => m.direction === 'Sent'), 'every parsed referral direction is Sent');

console.log('\n2. Cap counting');
const taCap = outreachCapState(taMessages);
const referralCap = outreachCapState(referralMessages);
// Lap 3 changed the TA LinkedIn sent count from 1 to 2.
check(taCap.linkedin.sent === 2, 'TA LinkedIn sent count is 2');
check(taCap.email.sent === 0, 'TA email sent count is 0');
check(taCap.linkedin.capped === false, 'TA LinkedIn is not capped');
check(taCap.email.capped === false, 'TA email is not capped');
check(taCap.hasReply === false, 'TA thread has no reply');
check(referralCap.linkedin.sent === 0, 'referral LinkedIn sent count is 0');
// Lap 3 changed the referral email sent count from 1 to 2.
check(referralCap.email.sent === 2, 'referral email sent count is 2');
check(referralCap.linkedin.capped === false, 'referral LinkedIn is not capped');
check(referralCap.email.capped === false, 'referral email is not capped');
check(referralCap.hasReply === false, 'referral thread has no reply');

console.log('\n3. Thread state');
const now = new Date('2026-08-05T00:00:00Z');
const taThread = summarizeThread(taMessages, { now });
const referralThread = summarizeThread(referralMessages, { now });
check(taThread.count === 2, 'TA thread count is 2');
// Lap 3 changed this from null to 2 after normalizing the later sent message.
check(taThread.daysSinceLastSub === 2, 'TA days since last substantive message is 2');
// Lap 3 changed this from false to true after normalizing the later sent message.
check(taThread.recentPitch === true, 'TA recent pitch is true');
// Lap 3 changed the referral thread count from 1 to 2.
check(referralThread.count === 2, 'referral thread count is 2');
// Lap 3 changed this from 3 to 2 after the later referral entry became visible.
check(referralThread.daysSinceLastSub === 2, 'referral days since last substantive message is 2');
check(referralThread.recentPitch === true, 'referral recent pitch is true');

console.log('\n4. Referral twin resolution through the route');
const details = [];
for (const referral of referrals) {
  const response = await fetch(`${base}/api/referrals/${referral.id}/detail`);
  details.push(await response.json());
}
// WRONG, recorded deliberately: accent-sensitive name normalization misses the
// Jose Ramirez TA twin.
check(details[0].link === null, 'Jose referral has no link');
// WRONG, recorded deliberately: an empty referral company permits a name-only
// match even though twin resolution promises name plus company agreement.
check(details[1].link !== null, 'Dana referral has a link');
check(details[1].link.id === 2, 'Dana referral resolves to TA id 2');
check(details[2].link !== null, 'Jane referral has a link');
check(details[2].link.id === 3, 'Jane referral resolves to TA id 3');

console.log('\n5. The two LinkedIn URL parsers disagree');
// One row per input: [input, linkedinKey, canonicalLinkedinUrl, note].
// The note travels with the values it explains, so a later lap that changes one
// expectation can see immediately whether it is correcting a defect or breaking
// something that was right.
const URL_CASES = [
  ['n/a',
   '', 'n/a',
   'WRONG: canonicalLinkedinUrl falls through and hands back its own input, so a ' +
   '"not on LinkedIn" sentinel becomes a truthy identity key. Group people on it ' +
   'and every contact carrying n/a merges into one person. linkedinKey correctly ' +
   'returns empty. This is why the join key cannot be ' +
   'canonicalLinkedinUrl.'],

  ['https://www.linkedin.com/in/jane-doe-ex',
   'jane-doe-ex', 'linkedin.com/in/jane-doe-ex',
   'The happy path. Both agree, modulo the prefix.'],

  ['https://www.linkedin.com/in/jane-doe-ex (personal)',
   'jane-doe-ex', 'linkedin.com/in/jane-doe-ex (personal)',
   'WRONG: canonicalLinkedinUrl swallows the trailing annotation because its ' +
   'capture excludes / ? # but not whitespace. The same human then keys ' +
   'differently depending on whether someone typed a note after the URL, which ' +
   'is precisely the duplicate this project exists to remove.'],

  ['https://www.linkedin.com/company/acme-ex',
   '', 'www.linkedin.com/company/acme-ex',
   'WRONG: a company page is not a person, but canonicalLinkedinUrl still ' +
   'returns something truthy. Two contacts who both list their employer page ' +
   'would merge.'],

  ['https://www.linkedin.com/in/jos%C3%A9-ex',
   // Lap 2a changed the shared key from 'jos%c3%a9-ex' to 'josé-ex'.
   'josé-ex', 'linkedin.com/in/jos%c3%a9-ex',
   'WRONG: canonicalLinkedinUrl does not decode, so the same profile keys ' +
   'differently depending on which parser a code path happens to call.'],

  ['https://www.linkedin.com/in/josé-ex',
   // Lap 2a changed the shared key from 'jos' to 'josé-ex'.
   'josé-ex', 'linkedin.com/in/josé-ex',
   'The literal spelling is preserved by both parsers.'],
];
for (const [input, wantKey, wantCanonical] of URL_CASES) {
  check(linkedinKey(input) === wantKey, `linkedinKey(${JSON.stringify(input)}) is ${JSON.stringify(wantKey)}`);
  check(canonicalLinkedinUrl(input) === wantCanonical, `canonicalLinkedinUrl(${JSON.stringify(input)}) is ${JSON.stringify(wantCanonical)}`);
}

console.log('\n6. Name normalizers disagree');
check(cleanName('José Ramírez') === 'jose ramirez', 'cleanName strips accents from Jose Ramirez');
check(cleanName('Jose Ramirez') === 'jose ramirez', 'cleanName preserves ASCII Jose Ramirez');
// WRONG, recorded deliberately: cleanName removes a leading digit that is part
// of the name.
check(cleanName('1Password') === 'password', 'cleanName turns 1Password into password');
// WRONG, recorded deliberately: cleanName removes a leading digit that is part
// of the name.
check(cleanName('3M') === 'm', 'cleanName turns 3M into m');

server.closeAllConnections?.();
await new Promise(resolve => server.close(() => resolve()));
try { const undici = await import('undici'); await undici.getGlobalDispatcher().close(); } catch {}
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exitCode = failed ? 1 : 0;
