/**
 * lib/bounce-parse.mjs — recognize a bounce, from two very different sources.
 *
 * 1. classifyBounce(): reads an actual Gmail delivery-status message (a DSN /
 *    mailer-daemon reply) and says hard | soft | none. Used by the Gmail scan
 *    (/api/google/scan-bounces) so a bounce records itself going forward.
 *
 * 2. mineNotesForBounce(): reads the free-text bounce forensics already sitting
 *    in ~40 contact rows ("EMAIL BOUNCED 2026-06-10 — do not reach out again")
 *    and turns the CERTAIN ones into structured state. Used once, by
 *    backfill-bounces.mjs.
 *
 * THE SUBTLETY THAT SHAPES THE MINER
 * Many bounce notes describe a bounce of an OLD address that was then CORRECTED:
 * a firm's whole team can have stale addresses on an old domain, and the note
 * reads "BOUNCED … Corrected to <new-domain>. Resend after verification." The
 * current Email cell holds the CORRECTED address, which is NOT dead — it is
 * unverified. A naive "note contains BOUNCED → mark the row dead" would kill a
 * good address. So the miner only calls a row bounced when the bounced address
 * matches the CURRENT address (or the note names no address and offers no
 * correction). Everything ambiguous is returned as a verdict for a human to
 * resolve, never auto-written. Pure: no fs, no network.
 */

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function firstEmail(text) {
  const m = String(text || '').match(EMAIL_RE);
  return m ? m[0].toLowerCase() : null;
}
function allEmails(text) {
  const m = String(text || '').match(EMAIL_RE);
  return m ? [...new Set(m.map(e => e.toLowerCase()))] : [];
}
function firstDate(text) {
  const m = String(text || '').match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return m ? m[1] : null;
}

// ── 1. Live DSN classification ───────────────────────────────────────────────
// Permanent (5.x.x / "user unknown" / "does not exist") → hard: the address is
// dead. Transient (4.x.x / "deferred" / "temporarily" / "quota") → soft: retry,
// do NOT kill the address. Anything that is not recognizably a bounce → none, so
// a normal reply is never mistaken for a bounce.
const HARD_SIGNALS = [
  /\b5\.\d\.\d\b/,                       // enhanced status 5.x.x
  /\b55\d\b/,                            // SMTP 550/551/553
  /\buser unknown\b/i,
  /\b(address|recipient|mailbox|user|account)\s+(not\s+found|unknown|does\s+not\s+exist|doesn'?t\s+exist|disabled|no\s+longer)\b/i,
  /\bno such (user|address|mailbox|recipient)\b/i,
  /\bunrouteable address\b/i,
  /\bpermanent(ly)?\s+fail/i,
  /\bdelivery\s+has\s+failed\s+permanently\b/i,
];
const SOFT_SIGNALS = [
  /\b4\.\d\.\d\b/,                       // enhanced status 4.x.x
  /\b45\d\b/,                            // SMTP 450/451/452
  /\b(deferred|temporar(y|ily)|try again|will retry|retry\b)/i,
  /\b(quota|mailbox full|over quota|storage)\b/i,
  /\bgreylist/i,
];
const DSN_MARKERS = [
  /mailer-daemon/i,
  /delivery status notification/i,
  /delivery (has )?failed/i,
  /undeliverable/i,
  /returned mail/i,
  /message not delivered/i,
  /Content-Type:\s*message\/delivery-status/i,
];

export function classifyBounce(messageText, { subject = '', from = '' } = {}) {
  const hay = `${subject}\n${from}\n${String(messageText || '')}`;
  const looksLikeDSN = DSN_MARKERS.some(re => re.test(hay)) || /mailer-daemon|postmaster/i.test(from);
  if (!looksLikeDSN) return { kind: 'none', address: null, code: null };

  const code = (hay.match(/\b[45]\.\d\.\d\b/) || hay.match(/\b[45]\d\d\b/) || [null])[0];
  // The bounced recipient is usually the "Final-Recipient" / "Original-Recipient"
  // address, or the first address in the body that is not the daemon itself.
  const finalRcpt = hay.match(/(?:final|original)-recipient:\s*(?:rfc822;)?\s*([^\s]+@[^\s]+)/i);
  const address = finalRcpt ? finalRcpt[1].toLowerCase().replace(/[>;,]+$/, '') : firstEmail(String(messageText || ''));

  if (HARD_SIGNALS.some(re => re.test(hay))) return { kind: 'hard', address, code };
  if (SOFT_SIGNALS.some(re => re.test(hay))) return { kind: 'soft', address, code };
  // A DSN with no classifiable code: treat as soft (do not kill an address on an
  // ambiguous daemon message).
  return { kind: 'soft', address, code };
}

// ── 2. Notes-prose mining (one-time backfill) ────────────────────────────────
// Returns a verdict about the CURRENT address given the row's free-text notes
// (and optionally the raw Email cell, which may carry a legacy `[bounced …]`
// tag). Verdicts:
//   bounced   — high confidence the current address hard-bounced
//   invalid   — verifier/human said this specific mailbox does not exist
//   blocked   — multiple valid patterns bounced; person still employed (org wall)
//   corrected — a bounce is described, but of a DIFFERENT (old) address; the
//               current one is a correction and is merely unverified
//   soft      — transient/deferred only; leave the address alone
//   null      — no bounce signal at all
// `confidence` is 'high' only when the miner is safe to AUTO-WRITE. Everything
// else is surfaced for review and handed to the Hunter/MillionVerifier step.
export function mineNotesForBounce(notes, currentAddress = '', emailCell = '') {
  const cur = String(currentAddress || '').toLowerCase().trim();
  const curDomain = cur.includes('@') ? cur.split('@')[1] : '';
  // signalText — for KEYWORD detection (bounced / corrected / soft): the email
  // cell may carry a legacy `[bounced …]` tag, so include it here.
  const signalText = `${String(emailCell || '')} ${String(notes || '')}`;
  // noteText — for ADDRESS analysis: the notes prose plus any addresses named
  // inside a legacy `[bounced: a, b]` tag. Deliberately EXCLUDES the bare current
  // address that always sits in its own Email cell — scanning the cell made every
  // row's current address look "mentioned as bounced", which wrongly killed
  // corrected addresses (the corrected-domain case). An address only counts as bounced if
  // the NOTE says so.
  const legacyBounced = String(emailCell || '').match(/\[bounced[^\]]*\]/i);
  const noteText = `${String(notes || '')} ${legacyBounced ? legacyBounced[0] : ''}`;
  const date = firstDate(signalText);

  const softOnly = /\bsoft bounce\b/i.test(signalText) &&
    !/\bhard bounce\b/i.test(signalText) && !/\bdo not (reach|contact|send)\b/i.test(signalText);

  const hardSignal =
    /\bhard bounce\b/i.test(signalText) ||
    /\bemail bounced\b/i.test(signalText) ||
    (/\bbounced\b/i.test(signalText) && !softOnly) ||
    /\bdo not reach out again\b/i.test(signalText) ||
    /\bis invalid\b/i.test(signalText) ||
    /\bdomain (dead|deprecated|no longer)\b/i.test(signalText) ||
    /\[bounced\b/i.test(emailCell); // legacy inline email tag

  if (!hardSignal) {
    if (softOnly) return { verdict: 'soft', address: null, date, confidence: 'low', reason: 'soft/transient bounce only' };
    return { verdict: null, address: null, date, confidence: 'low', reason: 'no bounce signal' };
  }
  if (!cur) {
    // No current address to judge (row has no email). Nothing is sendable anyway,
    // and setVerifyTag won't write to an empty cell — surface, never auto-write.
    return { verdict: null, address: null, date, confidence: 'low', reason: 'bounce noted but row has no email' };
  }

  // A correction points at a DIFFERENT address to use going forward.
  const corrected = /\b(corrected|use @|use [a-z0-9._%+-]+@|resend after|switch(ed)? to|new (email|address)|stale)\b/i.test(signalText);
  const autoSynth = /\bauto-synthesized\b/i.test(signalText);

  // Addresses the NOTE names as bounced, and whether the CURRENT one is among
  // them (a real "your current address died" signal, not the cell tautology).
  const emails = allEmails(noteText);
  const currentMentioned = emails.includes(cur);
  const otherDomainBounce = emails.some(e => e.split('@')[1] !== curDomain);

  // Distinct local-parts tied to the CURRENT domain: full addresses at that
  // domain, PLUS bare "local@" mentions (the note truncates the domain, e.g.
  // "Bounced on jkim@ and jenna.kim@brightwave.example"). Two or more is the
  // org-wall / left-company signature. Derived from noteText, not the email cell.
  const localsAtCurDomain = new Set(
    emails.filter(e => e.split('@')[1] === curDomain).map(e => e.split('@')[0]));
  const bareLocals = [...noteText.matchAll(/([a-z0-9._%+-]+)@(?![a-z0-9.-]+\.[a-z])/gi)].map(m => m[1].toLowerCase());
  for (const l of bareLocals) localsAtCurDomain.add(l);
  const curDomainMultiPattern = localsAtCurDomain.size >= 2;

  // Case A — the trap: the bounce was of a DIFFERENT (old) address and the note
  // corrects to a new one, which is the current cell. The current address is
  // unverified, NOT dead. Never auto-write a bounce here.
  if (corrected && !currentMentioned && (otherDomainBounce || emails.length > 0) && !curDomainMultiPattern) {
    return { verdict: 'corrected', address: emails[0] || null, date, confidence: 'low',
      reason: 'bounce was of a prior address; current cell is a correction — verify, do not kill' };
  }

  // Case B — the address was fabricated by Reconcile and never real.
  if (autoSynth && (/\bis invalid\b/i.test(signalText) || currentMentioned)) {
    return { verdict: 'invalid', address: cur, date, confidence: currentMentioned ? 'high' : 'low',
      reason: 'auto-synthesized address, invalid' };
  }

  // Case C — two or more valid patterns at the current domain bounced. Either the
  // org firewalls external TA mail or the person left; both mean "don't email,
  // use LinkedIn". LOW confidence so a human confirms which before it becomes the
  // reason to stop.
  if (curDomainMultiPattern) {
    const left = /\b(likely left|left (the )?company|no longer (at|with))\b/i.test(signalText);
    return { verdict: 'blocked', address: cur, date, confidence: 'low',
      reason: left ? 'multiple patterns bounced; likely left company (confirm on LinkedIn)'
        : 'multiple patterns bounced while employed → org wall (confirm)' };
  }

  // Case D — the current address itself is named as bounced, OR the note reports a
  // bounce with no other address and no correction (so it can only be about the
  // current one). High confidence dead.
  if (currentMentioned || (emails.length === 0 && !corrected)) {
    return { verdict: 'bounced', address: cur, date, confidence: 'high',
      reason: 'current address hard-bounced' };
  }

  // Fallback — a bounce is described but cannot be tied to the current address.
  return { verdict: 'bounced', address: emails[0] || cur, date, confidence: 'low',
    reason: 'bounce described but not clearly tied to the current address — confirm' };
}
