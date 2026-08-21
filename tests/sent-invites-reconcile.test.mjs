#!/usr/bin/env node
/**
 * sent-invites-reconcile.test.mjs — LinkedIn "Sent invitations" reconcile.
 *
 * WHY THIS EXISTS
 * The app only recorded LinkedIn invites you clicked "Mark sent" on; invites sent
 * directly on LinkedIn left no trace, so the queue re-pitched people who already had
 * a pending invite out. This reconcile parses the copied "Manage invitations → Sent"
 * page and matches invites to contacts.
 *
 * It also pins the SYNC CONTRACT that drifted underneath the original bug: the
 * subject the writer stamps (LINKEDIN_INVITE_SUBJECT) MUST be exactly what the
 * detector (isLinkedInInvite) recognizes. When those two silently disagreed, saved
 * invites read back as email touches and statuses went stale. If this assertion ever
 * fails, that whole class of bug is back.
 *
 * All names/companies below are fictional placeholders — this file is tracked/shipped.
 *
 * Run: node tests/sent-invites-reconcile.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { parseSentInvites, matchSentInvites, cleanName, profileHandle } from '../dashboard-web/server/lib/sent-invites-reconcile.mjs';
import { isLinkedInInvite, LINKEDIN_INVITE_SUBJECT } from '../dashboard-web/server/lib/channels.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('sent-invites-reconcile.test.mjs');

// ── THE SYNC CONTRACT (the load-bearing assertion) ───────────────────────────
check(isLinkedInInvite(LINKEDIN_INVITE_SUBJECT) === true,
  'SYNC: the subject the reconcile writes is recognized by isLinkedInInvite (writer↔reader agree)');

// ── cleanName / profileHandle ────────────────────────────────────────────────
check(cleanName('Dana (Reyes) Whitfield') === 'dana whitfield',
  'cleanName strips a parenthetical maiden name');
check(cleanName('José Núñez, MBA 🚀') === 'jose nunez',
  'cleanName strips diacritics, post-comma credentials, and emoji');
check(profileHandle('https://www.linkedin.com/in/dana-reyes/') === 'dana-reyes',
  'profileHandle extracts the /in/ slug, lowercased, no trailing slash');

// ── parseSentInvites — the "Manage invitations → Sent" copy format ────────────
// avatar-alt line, name, blank, headline, blank, "Sent <when>", blank, "Withdraw",
// message. Some entries have no avatar-alt line. A 4-plain-word headline like
// "Sr. Recruiter at Northwind" must NOT be read as a name (the headline-as-name bug).
const pasted = `Priya Nadeau’s profile picture
Priya Nadeau

Sr. Recruiter at Northwind

Sent 17 minutes ago

Withdraw
Hi Priya, saw your team is hiring. Thanks, Alex

Marcus T.

Manager of Talent Acquisition @ Contoso | Human Resources Management

Sent 21 minutes ago

Withdraw
Hi Marcus, noticed you lead Talent Acquisition. Thanks, Alex

Dana (Reyes) Whitfield’s profile picture
Dana (Reyes) Whitfield

GTM Recruiting @ Northwind | Ex-BigCo | Talent Partner

Sent yesterday

Withdraw
Hi Dana, GTM recruiting caught my eye. Thanks, Alex`;
const parsed = parseSentInvites(pasted);
check(parsed.length === 3, 'parses every invite block (avatar-alt line optional)');
check(parsed[0].name === 'Priya Nadeau' && /Sr\. Recruiter at Northwind/.test(parsed[0].headline),
  'name + headline: does NOT read the 4-word headline as the name');
check(parsed.some(p => p.name === 'Marcus T.'), 'parses an entry that has no avatar-alt line');
check(parsed.some(p => p.name === 'Dana (Reyes) Whitfield'), 'keeps the parenthetical maiden name for matching');
check(!parsed.some(p => /profile picture$/i.test(p.name) || /^sent\b/i.test(p.name) || /^withdraw$/i.test(p.name)),
  'never captures an avatar-alt, timestamp, or Withdraw line as a name');

// Interleaved LinkedIn metadata (a "· 2nd" degree, a "Message" button) — as the real
// clipboard carries — must be SKIPPED, not read as the name/headline. This is the class
// that routed real contacts into "unmatched" until the noise filter was applied.
const noisy = `Dana (Reyes) Whitfield’s profile picture
Dana (Reyes) Whitfield
· 2nd
GTM Recruiting @ Northwind | Ex-BigCo | Talent Partner
Message
Sent yesterday
Withdraw
Hi Dana, GTM recruiting caught my eye. Thanks, Alex`;
const noisyParsed = parseSentInvites(noisy);
check(noisyParsed.length === 1 && noisyParsed[0].name === 'Dana (Reyes) Whitfield' && /Northwind/.test(noisyParsed[0].headline),
  'skips interleaved "· 2nd" / "Message" metadata and still recovers name + headline');

const urlText = 'Sent to https://www.linkedin.com/in/some-handle/ · pending';
check(parseSentInvites(urlText).some(p => p.handle === 'some-handle'),
  'extracts a profile URL when the paste contains links');

// ── matchSentInvites ─────────────────────────────────────────────────────────
const ta = [
  { id: 554, first: 'Dana', last: 'Whitfield', company: 'Northwind', linkedin: 'https://www.linkedin.com/in/dana-reyes/' },
  { id: 900, first: 'Priya', last: 'Nadeau', company: 'Northwind', linkedin: '' },
];
const m1 = matchSentInvites(parsed, ta);
check(m1.matched.find(x => x.contact.id === 554) && m1.matched.find(x => x.contact.id === 900),
  'matches Dana (parenthetical name) and Priya to their contacts');

// URL/handle match is definitive even with a different display name.
const m2 = matchSentInvites([{ name: 'D. R. Whitfield', headline: '', handle: 'dana-reyes' }], ta);
check(m2.matched.length === 1 && m2.matched[0].contact.id === 554,
  'profile-handle match wins even when the display name differs');

// Ambiguity: two same-name contacts, no company tiebreak → reported, NOT applied.
const dupTa = [
  { id: 1, first: 'John', last: 'Smith', company: 'Acme', linkedin: '' },
  { id: 2, first: 'John', last: 'Smith', company: 'Globex', linkedin: '' },
];
const amb = matchSentInvites([{ name: 'John Smith', headline: 'Engineer', handle: '' }], dupTa);
check(amb.matched.length === 0 && amb.ambiguous.length === 1 && amb.ambiguous[0].candidates.length === 2,
  'two same-name contacts with no company tiebreak are ambiguous, never guessed');

// ...but a company in the headline disambiguates them.
const amb2 = matchSentInvites([{ name: 'John Smith', headline: 'VP Sales at Globex', handle: '' }], dupTa);
check(amb2.matched.length === 1 && amb2.matched[0].contact.id === 2,
  'a company in the headline breaks the tie to the right contact');

// A name with no contact at all is unmatched (not force-fit).
const un = matchSentInvites([{ name: 'Nobody Here', headline: '', handle: '' }], ta);
check(un.unmatched.length === 1 && un.matched.length === 0,
  'an invite with no matching contact is left unmatched, never force-fit');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
