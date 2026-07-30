#!/usr/bin/env node
/**
 * backfill-reply-correspondence.mjs — one-time repair.
 *
 * Replies dispositioned (Log / Responded / Rejected) in Insights → Review BEFORE
 * the "log a reply onto the contact's card" fix wrote a note on the APPLICATION
 * but never a Received entry on the CONTACT's correspondence timeline. The record
 * of which messages were dispositioned lives in data/google-sync.json
 * (handledReplies: msgId → { action, appId, date }), but it does NOT hold the
 * email text or which contact it was from. The messages themselves are still in
 * Gmail, keyed by those msgIds, so this re-fetches each one, matches the sender to
 * a TA or recruiter contact, and appends the missing Received entry.
 *
 * Idempotent: a reply already on the card (same contact, subject, timestamp) is
 * skipped, so re-running is safe. Dry-run by default; pass --apply to write.
 *
 *   node backfill-reply-correspondence.mjs            # preview only
 *   node backfill-reply-correspondence.mjs --apply    # write the entries
 *
 * Reads the REAL data dir (no TJK_DATA_DIR sandbox) and the user's own Gmail
 * token. If the token needs reconnecting, it says so and writes nothing.
 */
import {
  readTokens, getAccessToken, fetchMessagesConcurrent, parseGmailMessage,
  extractEmail, matchAddress, readSync, logReplyToContact,
} from './dashboard-web/server/lib/google.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './dashboard-web/server/lib/target-talent.mjs';
import { parseRecruitersMd, readRecruiterCorrespondence } from './dashboard-web/server/lib/recruiters.mjs';

const APPLY = process.argv.includes('--apply');

// Actions that represent a reply RECEIVED from the contact (belongs on the card).
// dismiss / not-related are hides and are intentionally excluded.
const REPLYISH = new Set(['log', 'responded', 'rejected', 'Phone Screen', '1st Interview', '2nd Interview', '3rd Interview', '4th Interview']);

// Must match logReplyToContact's normalizeCorrTimestamp exactly, so the added
// timestamp is the email's real date.
function corrTs(date) {
  const t = date ? Date.parse(date) : NaN;
  const ms = Number.isNaN(t) ? Date.now() : t;
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

// Dedup keys. A reply may already be on the card from earlier manual logging,
// stamped with a hand-entered time that differs from the email's real send time,
// so an exact-timestamp match misses it and creates a near-duplicate. Match
// instead on the normalized subject (leading Re:/Fw:/Fwd: stripped, lowercased)
// AND the same calendar day.
function normSubject(s) {
  let x = String(s || '').toLowerCase().trim();
  while (/^(re|fw|fwd)\s*:\s*/i.test(x)) x = x.replace(/^(re|fw|fwd)\s*:\s*/i, '').trim();
  return x;
}
const day = (t) => String(t || '').slice(0, 10);

const handled = (readSync().handledReplies) || {};
const msgIds = Object.entries(handled).filter(([, v]) => REPLYISH.has(v.action)).map(([k]) => k);
console.log(`Dispositioned replies on record: ${msgIds.length}`);
if (!msgIds.length) process.exit(0);

let accessToken;
try { accessToken = await getAccessToken({ tokens: readTokens() }); }
catch (e) { console.error(`\nGmail auth failed — reconnect Gmail in the dashboard, then rerun.\n  (${e.message})`); process.exit(1); }

const raws = await fetchMessagesConcurrent(msgIds.map(id => ({ id })), { accessToken });
console.log(`Fetched from Gmail: ${raws.length}  (unfetchable/deleted: ${msgIds.length - raws.length})`);

const taRows = parseTargetTalentMd();
const recruiterRows = parseRecruitersMd();

const toAdd = [];
let noContact = 0, already = 0;
for (const raw of raws) {
  const msg = parseGmailMessage(raw);
  const contact = matchAddress(extractEmail(msg.from), { taRows, recruiterRows });
  if (!contact) { noContact++; continue; }
  const existing = contact.source === 'ta' ? readTTCorrespondence(contact.id) : readRecruiterCorrespondence(contact.id);
  const ts = corrTs(msg.date);
  const subject = String(msg.subject || '(no subject)').trim() || '(no subject)';
  const nsub = normSubject(subject);
  if (existing.some(m => m.direction === 'Received' && normSubject(m.subject) === nsub && day(m.timestamp) === day(ts))) { already++; continue; }
  const auto = /automatic reply|out of office|out.of.office|catching me out|auto-?reply/i.test(subject);
  toAdd.push({ contact, subject, ts, snippet: msg.snippet, rawDate: msg.date, auto });
}

console.log(`\nAlready on the card (skip):   ${already}`);
console.log(`No matched contact (skip):    ${noContact}`);
console.log(`To backfill:                  ${toAdd.length}  (${toAdd.filter(a => a.auto).length} auto/OOO)\n`);
for (const a of toAdd) console.log(`  + [${a.contact.source} #${a.contact.id}] ${a.contact.name} · ${a.ts}${a.auto ? ' · [auto/OOO]' : ''} · ${a.subject}`);

if (!APPLY) { console.log(`\nDRY RUN — rerun with --apply to write these ${toAdd.length} entries.`); process.exit(0); }

// advanceStatus:false — record the correspondence ONLY. No status advances and no
// lastTouch change, so this historical repair never moves anyone's funnel stage
// or recency. It purely restores the received emails onto the cards.
let wrote = 0;
for (const a of toAdd) { if (logReplyToContact(a.contact, { subject: a.subject, body: a.snippet, timestamp: a.rawDate, advanceStatus: false })) wrote++; }
console.log(`\nApplied: wrote ${wrote} Received entries onto contact cards (no status changes).`);
