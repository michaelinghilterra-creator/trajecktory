/**
 * lib/invite-status-reconcile.mjs — keep the LinkedIn status axis (tt-linkedin.json)
 * in sync with the invites already recorded in our own correspondence, so a contact
 * we demonstrably invited never reads back as "Not Connected".
 *
 * WHY THIS EXISTS
 * A "Mark sent" on a LinkedIn invite writes a `Sent | LinkedIn connection request`
 * correspondence entry AND advances the LinkedIn axis to 'Invite Pending'. Both halves
 * run on the current write path (see routes/target-talent.mjs), but LEGACY invites
 * logged before that guard existed left the axis stale — 163 contacts read as
 * un-invited and the queue re-pitched them. The one-off backfill fixed those; this is
 * the self-heal that keeps it that way: whichever write path ever misses the status
 * update, the queue corrects it on the next load.
 *
 * CHEAP BY DESIGN: only contacts currently 'Not Connected' can advance, so we read
 * correspondence for those only. After the backfill almost every invited contact is
 * already 'Invite Pending' / 'Connected' and is skipped without a file read. Forward-
 * only (markInvitePending never regresses 'Connected'), idempotent, reads our own
 * files. Guarded by tests/invite-status-reconcile.test.mjs.
 */
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { readLinkedInMap, markInvitePending } from './tt-linkedin.mjs';
import { isLinkedInInvite } from './channels.mjs';

// The earliest recorded LinkedIn INVITE date for a contact, or '' if none.
export function earliestInviteDate(messages) {
  const dates = (messages || [])
    .filter(m => m.direction === 'Sent' && isLinkedInInvite(m.subject))
    .map(m => (m.timestamp || '').slice(0, 10))
    .filter(Boolean)
    .sort();
  return dates[0] || '';
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.apply=false]  Write the advances (default: dry count only).
 * @param {object[]} [opts.taRows]      Pre-parsed target-talent rows (avoids a re-read).
 * @returns {{ scanned:number, advanced:number, ids:string[] }}
 */
export function reconcileInviteStatus({ apply = false, taRows } = {}) {
  const rows = taRows ?? parseTargetTalentMd();
  const li = readLinkedInMap();
  let scanned = 0, advanced = 0;
  const ids = [];
  for (const r of rows) {
    const state = (li[String(r.id)] && li[String(r.id)].state) || 'Not Connected';
    if (state !== 'Not Connected') continue;   // already >= Invite Pending — cheap skip, no file read
    scanned++;
    const date = earliestInviteDate(readTTCorrespondence(r.id));
    if (!date) continue;                        // no invite on file — nothing to advance
    if (apply) markInvitePending(r.id, date);
    advanced++;
    ids.push(String(r.id));
  }
  return { scanned, advanced, ids };
}
