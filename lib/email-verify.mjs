/**
 * lib/email-verify.mjs — the pure core for per-contact email deliverability.
 *
 * WHY THIS EXISTS
 * Outreach died on 2026-06-24 partly because addresses were auto-synthesized
 * guesses (first.last@company) that the system flagged as unverified and sent to
 * anyway, and partly because a bounce and an ignore were the same row: only 2
 * contacts carried Status = Bounced while ~40 rows described a bounce in free
 * text and were parked as Dormant/Archived. So every reply-rate number counted
 * dead addresses in the denominator, making the channel look worse than it was.
 *
 * This module holds the single definition of a contact's deliverability state
 * and the ONE gate — isSendable — that every send path must pass through, so no
 * message is ever sent to an unverified or dead address again.
 *
 * WHY A TAG, NOT A COLUMN
 * The state lives as an inline `[v:...]` tag inside the Email cell of
 * target-talent.md / recruiters.md, not as a new table column. Those two files
 * have DIFFERENT column layouts and DIFFERENT line endings (target-talent.md is
 * CRLF, recruiters.md is LF), and adding a physical column to hand-rolled
 * pipe-split parsers is the exact drift bug AGENTS.md documents twice. A tag
 * cannot shift a column — it lives inside a cell both parsers already strip with
 * `\s*\[[^\]]*\]\s*`, so it is backward-compatible by construction and the same
 * code path works on both files. The verification is ABOUT the email, so it
 * travels with it; stripping keeps the address clean for mailto/copy/send.
 *
 * This module is PURE: no fs, no network. It parses/formats the tag, ranks the
 * states, and answers isSendable. I/O lives in backfill-bounces.mjs,
 * verify-contacts.mjs, and the server parsers.
 */

// State vocabulary. Precedence matters: an OBSERVED-dead state (a real bounce, a
// verifier's "invalid", an org block) must never be silently overwritten by an
// optimistic re-check. Higher rank wins a merge. This is the same principle as
// status-events furthest-rung: trust the strongest evidence, not the latest.
export const VERIFY_RANK = {
  unverified: 0, // default: never checked
  ok: 1,         // verifier says deliverable
  risky: 2,      // catch-all / accept-all domain: inconclusive, usually works
  invalid: 3,    // verifier says the mailbox does not exist
  blocked: 4,    // org firewalls external mail to this person (LinkedIn instead)
  bounced: 5,    // observed hard bounce: a real message came back
};

export const VERIFY_STATES = Object.keys(VERIFY_RANK);

// The gate. Only ok and risky may be sent to. unverified is blocked ON PURPOSE:
// the whole failure was sending to unverified guesses. invalid/blocked/bounced
// are observed-dead. risky (catch-all) is allowed because blocking every
// catch-all domain would exclude a large share of legitimate corporate mail.
export const SENDABLE_STATES = new Set(['ok', 'risky']);

export function isStateSendable(state) {
  return SENDABLE_STATES.has(String(state || 'unverified'));
}

// Accepts a contact row ({ email, verified }) or a bare state string. A row is
// sendable only if it has a non-empty clean address AND a sendable state. No
// address means nothing to send, regardless of state.
export function isSendable(rowOrState) {
  if (typeof rowOrState === 'string') return isStateSendable(rowOrState);
  const row = rowOrState || {};
  const state = row.verified?.state || 'unverified';
  const address = (row.email || '').trim();
  return address.length > 0 && isStateSendable(state);
}

// Find the `[v:...]` verification tag anywhere in an Email cell and parse it.
// Format: [v:STATE:SOURCE:YYYY-MM-DD] or [v:STATE:SOURCE:YYYY-MM-DD:SCORE]
//   STATE  ∈ VERIFY_STATES
//   SOURCE ∈ hunter | mv | gmail | manual | notes  (free-form; who decided)
//   DATE   = YYYY-MM-DD (when the decision was made)
//   SCORE  = optional integer 0..100 (verifier confidence)
// Returns { state, source, date, score, address } always. `address` is the cell
// with EVERY bracket tag stripped (identical to the parsers' existing behavior),
// so it stays a clean sendable address. With no tag: state = 'unverified'.
export function parseVerifyTag(emailCell) {
  const raw = String(emailCell ?? '');
  const address = raw.replace(/\s*\[[^\]]*\]\s*/g, '').trim();
  const m = raw.match(/\[v:([a-z]+)(?::([a-z0-9_-]*))?(?::(\d{4}-\d{2}-\d{2}))?(?::(\d{1,3}))?\]/i);
  if (!m) {
    return { state: 'unverified', source: null, date: null, score: null, address, hadTag: false };
  }
  let state = (m[1] || '').toLowerCase();
  if (!VERIFY_STATES.includes(state)) state = 'unverified';
  const score = m[4] != null ? Math.min(100, parseInt(m[4], 10)) : null;
  return {
    state,
    source: m[2] || null,
    date: m[3] || null,
    score: Number.isFinite(score) ? score : null,
    address,
    hadTag: true,
  };
}

// Build the tag string. Omits trailing empty fields so a manual bounce with no
// score reads `[v:bounced:notes:2026-06-10]`, not `[v:bounced:notes:2026-06-10:]`.
export function formatVerifyTag({ state, source, date, score } = {}) {
  const st = VERIFY_STATES.includes(state) ? state : 'unverified';
  const parts = [`v:${st}`];
  const src = (source || '').toString().toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const hasScore = score != null && Number.isFinite(Number(score));
  // date is only meaningful with a source; keep the positional format stable.
  if (src || date || hasScore) parts.push(src || '');
  if (date || hasScore) parts.push(date || '');
  if (hasScore) parts.push(String(Math.min(100, Math.max(0, Math.round(Number(score))))));
  return `[${parts.join(':')}]`;
}

// Return an Email cell with its verification tag set to `verify`, preserving the
// clean address and any OTHER bracket tags (e.g. a legacy `[bounced 2026-… : …]`
// left in place as human history). Only the `[v:...]` tag is replaced. An empty
// address yields an empty cell (nothing to annotate).
export function setVerifyTag(emailCell, verify) {
  const raw = String(emailCell ?? '');
  const withoutV = raw.replace(/\s*\[v:[^\]]*\]\s*/gi, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!withoutV.replace(/\s*\[[^\]]*\]\s*/g, '').trim()) return withoutV; // no address
  const tag = formatVerifyTag(verify);
  return `${withoutV} ${tag}`.replace(/\s{2,}/g, ' ').trim();
}

// Merge two verification observations, keeping the stronger evidence. An observed
// bounce (rank 5) must survive a later optimistic ok (rank 1). Ties (same rank)
// keep the more recent by date, so a fresh ok replaces a stale ok. Used when a
// verifier result meets an existing tag.
export function mergeVerify(existing, incoming) {
  const a = existing || { state: 'unverified' };
  const b = incoming || { state: 'unverified' };
  const ra = VERIFY_RANK[a.state] ?? 0;
  const rb = VERIFY_RANK[b.state] ?? 0;
  if (rb > ra) return b;
  if (ra > rb) return a;
  // same rank: newer date wins; if equal/unknown, prefer incoming
  if (a.date && b.date) return b.date >= a.date ? b : a;
  return b.date ? b : a;
}
