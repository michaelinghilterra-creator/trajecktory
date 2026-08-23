#!/usr/bin/env node
/**
 * backfill-reply-correspondence.mjs: one-time repair.
 *
 * Replies dispositioned (Log / Responded / Rejected) in Insights → Review BEFORE
 * the "log a reply onto the contact's card" fix wrote a note on the APPLICATION
 * but never a Received entry on the CONTACT's correspondence timeline. The record
 * of which messages were dispositioned lives in data/google-sync.json
 * (handledReplies: msgId → { action, appId, date }), but it does NOT hold the
 * email text or which contact it was from. The messages themselves are still in
 * Gmail, keyed by those msgIds, so this re-fetches each one, matches the sender to
 * a TA or recruiter contact, appends a missing Received entry, and replaces a
 * recognizably truncated stored body with the fetched full text.
 *
 * Idempotent: after repair, the stored body equals the prepared fetched body, so
 * the prefix and shorter test fails on the next run. Dry-run by default; pass
 * the apply flag to write.
 *
 *   node backfill-reply-correspondence.mjs            # preview only
 *   node backfill-reply-correspondence.mjs --apply    # write the entries
 *
 * Reads the REAL data dir (no TJK_DATA_DIR sandbox) and the user's own Gmail
 * token. If the token needs reconnecting, it says so and writes nothing.
 */
import {
  readTokens, getAccessToken, fetchMessagesConcurrent, parseGmailMessage,
  extractEmail, matchAddress, readSync, logReplyToContact, MAX_CORR_BODY,
} from './dashboard-web/server/lib/google.mjs';
import { parseTargetTalentMd, readTTCorrespondence, writeTTCorrespondence } from './dashboard-web/server/lib/target-talent.mjs';

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
const TRUNCATION_MARKER = '\n\n[Message truncated at 20000 characters]';
// Comparison form ONLY. What gets STORED is always the raw fetched text; this is
// purely for deciding whether the stored body is a truncated version of it.
//
// A Gmail snippet is not a byte-prefix of the same message's body. Gmail
// HTML-escapes the snippet, so an apostrophe arrives as &#39; where the body has
// the character itself, and the two sources disagree on curly punctuation and
// non-breaking spaces. Comparing raw text therefore reported "not a prefix" for
// genuinely truncated entries and left them truncated forever, which is the exact
// data this script exists to recover.
const decodeEntities = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
  .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&amp;/gi, '&');   // last, so &amp;#39; does not double-decode
const comparable = (s) => decodeEntities(s)
  .replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"')
  .replace(/[–—]/g, '-').replace(/ /g, ' ')
  .replace(/\s+/g, ' ').trim().toLowerCase();
function preparedBody(body) {
  let text = String(body || '').trim() || '(no preview available)';
  if (text.length > MAX_CORR_BODY) text = text.slice(0, MAX_CORR_BODY - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
  return text.replace(/^(#+ )/gm, ' $1');
}

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

const toAdd = [], toRepair = [];
let noContact = 0, already = 0, different = 0;
for (const raw of raws) {
  const msg = parseGmailMessage(raw);
  const contact = matchAddress(extractEmail(msg.from), { taRows });
  if (!contact) { noContact++; continue; }
  const existing = readTTCorrespondence(contact.id);
  const ts = corrTs(msg.date);
  const subject = String(msg.subject || '(no subject)').trim() || '(no subject)';
  const nsub = normSubject(subject);
  const existingIndex = existing.findIndex(m => m.direction === 'Received' && normSubject(m.subject) === nsub && day(m.timestamp) === day(ts));
  if (existingIndex !== -1) {
    const fetchedBody = preparedBody(msg.text);
    const stored = comparable(existing[existingIndex].body);
    const fetched = comparable(fetchedBody);
    if (stored === fetched) {
      already++;
    } else if (stored.length < fetched.length && (fetched.startsWith(stored) || fetched.includes(stored))) {
      toRepair.push({ contact, subject, ts, body: fetchedBody });
    } else {
      different++;
      console.log(`Leave unchanged: [${contact.source} #${contact.id}] ${subject} has a body that is not a shorter prefix or substring.`);
    }
    continue;
  }
  const auto = /automatic reply|out of office|out.of.office|catching me out|auto-?reply/i.test(subject);
  toAdd.push({ contact, subject, ts, body: msg.text, rawDate: msg.date, auto });
}

console.log(`\nAlready on the card (skip):   ${already}`);
console.log(`Different body (leave alone): ${different}`);
console.log(`No matched contact (skip):    ${noContact}`);
console.log(`To backfill:                  ${toAdd.length}  (${toAdd.filter(a => a.auto).length} auto/OOO)\n`);
console.log(`${APPLY ? 'To repair' : 'Would repair'}:                 ${toRepair.length}`);
for (const a of toAdd) console.log(`  + [${a.contact.source} #${a.contact.id}] ${a.contact.name} · ${a.ts}${a.auto ? ' · [auto/OOO]' : ''} · ${a.subject}`);

if (!APPLY) { console.log(`\nDRY RUN: would add ${toAdd.length} and would repair ${toRepair.length} entries.`); process.exit(0); }

// advanceStatus:false — record the correspondence ONLY. No status advances and no
// lastTouch change, so this historical repair never moves anyone's funnel stage
// or recency. It purely restores the received emails onto the cards.
let wrote = 0, repaired = 0;
for (const a of toAdd) { if (logReplyToContact(a.contact, { subject: a.subject, body: a.body, timestamp: a.rawDate, advanceStatus: false })) wrote++; }
for (const r of toRepair) {
  const current = readTTCorrespondence(r.contact.id);
  const index = current.findIndex(m => m.direction === 'Received' && normSubject(m.subject) === normSubject(r.subject) && day(m.timestamp) === day(r.ts));
  if (index !== -1) {
    current[index] = { ...current[index], body: r.body };
    writeTTCorrespondence(r.contact.id, current);
    repaired++;
  }
}
console.log(`\nApplied: wrote ${wrote} Received entries and repaired ${repaired} bodies (no status or lastTouch changes).`);
