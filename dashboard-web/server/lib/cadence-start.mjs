import { parseApplicationsMd } from './applications.mjs';
import { contactChannelBucket } from './followups.mjs';
import { localToday } from '../../../lib/log-writes.mjs';
import { readApplyDates } from './sidecars.mjs';
import { readSequences, startSequence } from './sequences.mjs';
import { matchByCompany, parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { SUBMITTED_STATUSES, TALENT_CONTACTED, TALENT_REPLIED } from './statuses.mjs';

export const APPLICATION_CADENCE_ID = 'application-day-0-1-5-12';

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sameCompany(a, b) {
  return matchByCompany([{ c: a }], b, row => row.c).length > 0;
}

function inScope(contact, scope) {
  const ids = Array.isArray(scope?.contactIds) ? new Set(scope.contactIds.map(Number)) : null;
  const byId = ids?.has(Number(contact.id)) || false;
  const byCompany = scope?.company ? sameCompany(contact.company, scope.company) : false;
  return byId || byCompany;
}

export function planCadenceStarts({
  contacts = [], apps = [], applyDates = {}, existingKeys = new Set(),
  sentIds = new Set(), today, scope,
}) {
  if (!scope?.company && !Array.isArray(scope?.contactIds)) return [];

  const planned = [];
  for (const contact of [...contacts].sort((a, b) => Number(a.id) - Number(b.id))) {
    if (!inScope(contact, scope)) continue;
    if (contact.status === 'Archived'
      || TALENT_CONTACTED.has(contact.status)
      || TALENT_REPLIED.has(contact.status)
      || String(contact.lastTouch || '').trim()
      || sentIds.has(Number(contact.id))
      || contactChannelBucket(contact).bucket === 0
      || existingKeys.has(`ta:${contact.id}`)) continue;

    const submitted = apps.filter(app => sameCompany(contact.company, app.company))
      .filter(app => SUBMITTED_STATUSES.includes(app.status))
      .map(app => ({
        app,
        date: validDate(applyDates[app.id])
          ? applyDates[app.id]
          : validDate(app.date) ? app.date : today,
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || Number(b.app.id) - Number(a.app.id));
    if (!submitted.length) continue;
    planned.push({ id: Number(contact.id), startDate: submitted[0].date, appId: submitted[0].app.id });
  }
  return planned;
}

export function startCadences({ scope } = {}) {
  try {
    const contacts = parseTargetTalentMd();
    const scopedContacts = contacts.filter(contact => inScope(contact, scope));
    const sentIds = new Set();
    for (const contact of scopedContacts) {
      if (readTTCorrespondence(contact.id).some(message => message.direction === 'Sent')) {
        sentIds.add(Number(contact.id));
      }
    }
    const entries = planCadenceStarts({
      contacts,
      apps: parseApplicationsMd(),
      applyDates: readApplyDates(),
      existingKeys: new Set(Object.keys(readSequences())),
      sentIds,
      today: localToday(),
      scope,
    });
    for (const entry of entries) {
      startSequence('ta', entry.id, APPLICATION_CADENCE_ID, entry.startDate);
    }
    return { started: entries.length };
  } catch (error) {
    return { started: 0, error: error.message };
  }
}
