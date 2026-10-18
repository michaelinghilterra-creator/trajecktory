import { companiesMatchForOutreach } from '../../../lib/identity.mjs';
import { OUTREACH_ELIGIBLE_STATUSES, TALENT_STATUS_LABELS } from './statuses.mjs';

const WAS_TAG = /\[was:([^\]]+)\]/i;
const MANUAL_ARCHIVE_MARKER = /Archived \d{4}-\d{2}-\d{2}:/;

export function withWasTag(notes, status) {
  const text = String(notes || '');
  const prior = String(status || '').trim();
  if (!prior || prior === 'Archived') return text;
  if (WAS_TAG.test(text)) return text.replace(WAS_TAG, `[was:${prior}]`);
  return `${text}${text ? ' · ' : ''}[was:${prior}]`;
}

export function reviveNotes(notes) {
  return String(notes || '')
    .replace(/\s*·\s*\[was:[^\]]+\]/gi, '')
    .replace(/\[was:[^\]]+\]\s*·\s*/gi, '')
    .replace(/\[was:[^\]]+\]/gi, '')
    .trim();
}

export function contactIdsToRevive(apps, ttRows, company) {
  const appList = Array.isArray(apps) ? apps : [];
  const rows = Array.isArray(ttRows) ? ttRows : [];
  const hasLiveApplication = appList.some(app =>
    OUTREACH_ELIGIBLE_STATUSES.includes(app.status)
    && companiesMatchForOutreach(app.company, company));
  if (!hasLiveApplication) return [];

  const validStatuses = new Set(TALENT_STATUS_LABELS.filter(status => status !== 'Archived'));
  return rows.filter(row =>
    row.status === 'Archived'
    && companiesMatchForOutreach(row.company, company)
    && !MANUAL_ARCHIVE_MARKER.test(String(row.notes || ''))
    && !String(row.notes || '').includes('[no-revive]'))
    .map(row => {
      const tagged = String(row.notes || '').match(WAS_TAG)?.[1]?.trim();
      const status = validStatuses.has(tagged)
        ? tagged
        : (String(row.lastTouch || '').trim() ? 'Sent' : 'Not Contacted');
      return { id: row.id, status, notes: reviveNotes(row.notes) };
    });
}
