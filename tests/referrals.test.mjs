#!/usr/bin/env node
/**
 * referrals.test.mjs — server/lib/referrals.mjs (the Referrals tracker store).
 * Hermetic: points TJK_DATA_DIR at a temp dir so it exercises the real write
 * paths without touching the user's data/referrals.md.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-referrals-'));
process.env.TJK_DATA_DIR = tmp;

// Import AFTER setting the env so config.mjs resolves REFERRALS_MD into the temp dir.
const { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES,
  readReferralCorrespondence, writeReferralCorrespondence } =
  await import('../dashboard-web/server/lib/referrals.mjs');

let n = 0;
const ok = (m) => { n++; console.log('  ok ' + m); };

// The ladder loaded from states.yml, not a hardcoded copy.
assert.ok(REFERRAL_STATUSES.includes('Not Asked'));
assert.ok(REFERRAL_STATUSES.includes('Applied w/ Referral'));
ok('statuses derive from states.yml (Not Asked .. Applied w/ Referral)');

// empty file -> empty list
assert.deepEqual(parseReferralsMd(), []);
ok('parse: missing file -> []');

// append assigns sequential ids and defaults an unknown/blank status to Not Asked
const [a] = appendReferralRows([{ name: 'Alex Rivera', how: 'Acme Corp, 2015-2019', target: 'Globex RevOps' }]);
const [b] = appendReferralRows([{ name: 'Sam Doe', status: 'bogus-status' }]);
assert.equal(a.id, 1);
assert.equal(b.id, 2);
let rows = parseReferralsMd();
assert.equal(rows.length, 2);
assert.equal(rows[0].name, 'Alex Rivera');
assert.equal(rows[0].status, 'Not Asked');
assert.equal(rows[1].status, 'Not Asked'); // invalid status coerced
ok('append: sequential ids, invalid status coerced to Not Asked');

// pipes in free text can never break the row layout
appendReferralRows([{ name: 'Pipe | Person', notes: 'a | b | c' }]);
rows = parseReferralsMd();
const piped = rows.find(r => r.id === 3);
assert.ok(piped, 'piped row parses back');
assert.ok(!piped.name.includes('|'), 'pipe neutralized in name');
ok('append: pipes in free text neutralized, row still parses');

// update a mutable cell; a valid status advances
assert.equal(updateReferralLine(1, { status: 'Asked', lastTouch: '2026-07-26', notes: 'sent reconnect' }), true);
rows = parseReferralsMd();
const updated = rows.find(r => r.id === 1);
assert.equal(updated.status, 'Asked');
assert.equal(updated.lastTouch, '2026-07-26');
assert.equal(updated.notes, 'sent reconnect');
ok('update: status / lastTouch / notes persist');

// updating a non-existent id touches nothing
assert.equal(updateReferralLine(999, { status: 'Asked' }), false);
ok('update: unknown id -> false');

// delete removes exactly one row, leaves the rest intact
assert.equal(deleteReferralLine(2), true);
rows = parseReferralsMd();
assert.equal(rows.length, 2);
assert.ok(!rows.some(r => r.id === 2));
assert.ok(rows.some(r => r.id === 1) && rows.some(r => r.id === 3));
ok('delete: removes one row, others intact');

assert.equal(deleteReferralLine(2), false);
ok('delete: already-gone id -> false');

// next id after a delete is still monotonic (max + 1, never reuses 2)
const [c] = appendReferralRows([{ name: 'New Person' }]);
assert.equal(c.id, 4);
ok('append after delete: id is max+1, never reused');

// ── LinkedIn + Email columns (structured, trailing, backward-compatible) ───────

// append with a LinkedIn URL and a plain (unverified) email → both persist
const [d] = appendReferralRows([{ name: 'Jo Lin', where: 'Globex', linkedin: 'https://www.linkedin.com/in/jolin', email: 'jo@example.com' }]);
let jo = parseReferralsMd().find(r => r.id === d.id);
assert.equal(jo.linkedin, 'https://www.linkedin.com/in/jolin');
assert.equal(jo.email, 'jo@example.com');
assert.equal(jo.verified.state, 'unverified');
ok('append: linkedin + plain email persist; email reads unverified');

// email with a verify stamp round-trips to a CLEAN address plus a parsed state
const [e] = appendReferralRows([{ name: 'Vee Kay', where: 'Initech', email: 'vee@example.com', emailVerify: { state: 'ok', source: 'mv', date: '2026-08-12', score: 95 } }]);
let vee = parseReferralsMd().find(r => r.id === e.id);
assert.equal(vee.email, 'vee@example.com');        // tag stripped from the address
assert.equal(vee.verified.state, 'ok');
assert.equal(vee.verified.source, 'mv');
ok('append: email verify tag round-trips (clean address + ok state)');

// update the structured columns on an existing (new-format) row
assert.equal(updateReferralLine(d.id, { linkedin: 'https://www.linkedin.com/in/jo-lin-2', email: 'jo.lin@example.com' }), true);
jo = parseReferralsMd().find(r => r.id === d.id);
assert.equal(jo.linkedin, 'https://www.linkedin.com/in/jo-lin-2');
assert.equal(jo.email, 'jo.lin@example.com');
ok('update: linkedin + email persist');

// backward-compat: a legacy 8-field row (no LinkedIn/Email cells) gains them
// without shifting any existing cell — the column-drift hazard this guards.
const { REFERRALS_MD } = await import('../dashboard-web/server/config.mjs');
fs.appendFileSync(REFERRALS_MD, '| 900 | Legacy Person | old friend | Acme | Acme RevOps | Not Asked |  | just notes |\n');
let legacy = parseReferralsMd().find(r => r.id === 900);
assert.equal(legacy.linkedin, '');   // absent trailing cells read as empty
assert.equal(legacy.email, '');
assert.equal(updateReferralLine(900, { linkedin: 'https://www.linkedin.com/in/legacy', email: 'legacy@example.com' }), true);
legacy = parseReferralsMd().find(r => r.id === 900);
assert.equal(legacy.linkedin, 'https://www.linkedin.com/in/legacy');
assert.equal(legacy.email, 'legacy@example.com');
assert.equal(legacy.notes, 'just notes');   // padding didn't corrupt existing cells
ok('update: legacy 8-field row gains linkedin + email without column drift');

// ── Referral correspondence store (for referrals with no TA/recruiter twin) ────
assert.deepEqual(readReferralCorrespondence(1), []);   // nothing logged yet
writeReferralCorrespondence(1, [
  { timestamp: '2026-08-12 10:00', direction: 'Sent', subject: 'reconnect', body: 'long time no talk' },
  { timestamp: '2026-08-12 11:30', direction: 'Received', subject: 'Re: reconnect', body: 'great to hear from you' },
]);
const corr = readReferralCorrespondence(1);
assert.equal(corr.length, 2);
assert.equal(corr[0].direction, 'Sent');
assert.equal(corr[0].subject, 'reconnect');
assert.equal(corr[1].direction, 'Received');
assert.equal(corr[1].body, 'great to hear from you');
ok('correspondence: write + read round-trips (2 messages, direction + body preserved)');

console.log(`\n  ${n} referrals checks passed`);
