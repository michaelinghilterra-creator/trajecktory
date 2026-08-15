/**
 * lib/channels.mjs — the one place that knows a LinkedIn connection request apart
 * from an email touch.
 *
 * WHY THIS EXISTS
 * Contact correspondence is a single Sent/Received log, but the two outreach
 * motions it records are NOT the same metric. A "verified touch" is a message
 * sent to a VERIFIED EMAIL address (the email motion, floor-gated). A "LinkedIn
 * connect" is a hand-sent connection request to someone with no sendable email
 * (the fallback motion, tallied in linkedin-connects.json). Counting every Sent
 * correspondence as a verified touch silently books LinkedIn invites as email
 * touches — which is exactly the mislabel that made 9 invites show up as 9
 * verified touches and 0 connects.
 *
 * Connect-queue invites are written with this exact subject, so it is the stable
 * signal every metric uses to keep the two channels apart. Pure (no I/O) so
 * weekly-metrics can stay unit-testable.
 */

// The subject the Connect queue stamps on every LinkedIn connection request.
export const LINKEDIN_INVITE_SUBJECT = 'LinkedIn connection request';

// True when a correspondence entry is a LinkedIn connection request rather than
// an email touch. Tolerant of trailing detail so a future "LinkedIn connection
// request (2nd try)" still classifies correctly.
export function isLinkedInInvite(subject) {
  return /^linkedin connection request/i.test(String(subject || '').trim());
}

// True when a correspondence MESSAGE is a LinkedIn touch rather than an email one.
// Honors the explicit `channel` field (written when a user logs a LinkedIn message
// from the contact card) as well as the legacy connect-queue subject convention,
// so both the old invite path and hand-logged LinkedIn DMs classify correctly.
// Accepts a message object; falls back to subject-only for legacy callers.
export function isLinkedInEntry(msg) {
  if (msg && typeof msg === 'object') {
    if (msg.channel === 'LinkedIn') return true;
    return isLinkedInInvite(msg.subject);
  }
  return isLinkedInInvite(msg);
}
