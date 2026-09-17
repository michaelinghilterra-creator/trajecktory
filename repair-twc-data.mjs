#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parseTrackerLine, formatTrackerLine } from './lib/tracker.mjs';
import { normalizeCompany } from './lib/identity.mjs';
import {
  APPS_MD, APPLY_DATES_PATH, STATUS_EVENTS_PATH, TWC_OVERRIDES_PATH,
} from './dashboard-web/server/config.mjs';
import {
  readApplyDates, writeApplyDates, parseStatusEvents, logStatusEvent,
} from './dashboard-web/server/lib/sidecars.mjs';
import { parseFollowupsMd } from './dashboard-web/server/lib/followups.mjs';
import { buildActivities, TWC_KINDS } from './dashboard-web/server/lib/twc.mjs';
import { appendEventsWithEffects } from './lib/legacy-files.mjs';
import { localToday, logWritesEnabled, withLogWrite, writeTableText } from './lib/log-writes.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RECOVERABLE_STATUSES = new Set(['Closed', 'Not a Fit', 'Discarded', 'SKIP', 'Evaluated']);
const CHANGE_TYPES = [
  'apply_date', 'tracker_status', 'tracker_status_event', 'interview_override',
  'interview_status_event', 'application_restore', 'application_exclusion',
  'activity_exclusion', 'activity_addition',
];

function localYmd(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timestamp(date = new Date()) {
  return `${localYmd(date).replace(/-/g, '')}-${String(date.getHours()).padStart(2, '0')}`
    + `${String(date.getMinutes()).padStart(2, '0')}${String(date.getSeconds()).padStart(2, '0')}`
    + `${String(date.getMilliseconds()).padStart(3, '0')}`;
}

function canonicalAppId(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return /^\d+$/.test(raw) ? String(Number(raw)) : raw;
}

function trueValue(value) {
  return value === true || value === 1 || /^(?:true|yes|1)$/i.test(String(value ?? '').trim());
}

function normalizePerson(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function companyKey(value) {
  return String(normalizeCompany(String(value ?? '')) || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function companiesMatch(a, b, allowPrefix = false) {
  const left = companyKey(a);
  const right = companyKey(b);
  if (!left || !right) return false;
  return left === right || (allowPrefix && (left.startsWith(right) || right.startsWith(left)));
}

function normalizeWords(value) {
  return String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanField(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function employerOf(row) {
  return cleanField(row.employer ?? row.company, 120);
}

function currentApplyDate(value) {
  return typeof value === 'string' ? value : value && typeof value === 'object' ? value.date : undefined;
}

function correctedApplyValue(before, date) {
  return before && typeof before === 'object' && !Array.isArray(before) ? { ...before, date } : date;
}

function withinLastDays(date, today, days) {
  if (!ISO_DATE.test(String(date || '')) || !ISO_DATE.test(today)) return false;
  const elapsed = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000;
  return elapsed >= 0 && elapsed <= days;
}

export function deriveInterviewStage(activity) {
  const text = normalizeWords(activity);
  if (/\b(?:round 3|interview 3|third|3rd|final)\b/.test(text)) return '3rd Interview';
  if (/\b(?:round 2|interview 2|second|2nd)\b/.test(text)) return '2nd Interview';
  if (/\b(?:phone|recruiter|intro call|screen)\b/.test(text)) return 'Phone Screen';
  return '1st Interview';
}

function isContactChannel(channel) {
  return /^(?:e-?mail|linkedin|phone|call|sms|text|form|in person|online|video|zoom|teams|web|other)$/i
    .test(String(channel || '').trim());
}

function activitySignature(value, kind = value.kind) {
  return [kind, value.date, companyKey(value.company ?? value.employer), normalizePerson(value.contact)].join('|');
}

function sameActivity(activity, row, kind = row.kind) {
  return activitySignature(activity) === activitySignature(row, kind);
}

function excludeKey(value) {
  return activitySignature(value);
}

function interviewKey(value) {
  return `${canonicalAppId(value.appId)}|${normalizeWords(value.stage)}|${value.date}`;
}

function interviewStageKey(value) {
  return `${canonicalAppId(value.appId ?? value.app)}|${normalizeWords(value.stage ?? value.status)}`;
}

function additionKey(value) {
  const role = ['application', 'interview'].includes(value.kind) ? normalizeWords(value.role) : '';
  return [activitySignature(value), role].join('|');
}

function applicationCompanyDateKey(value) {
  return `${value.date}|${companyKey(value.company ?? value.employer)}`;
}

function applicationRoleKey(value) {
  return `${applicationCompanyDateKey(value)}|${normalizeWords(value.role)}`;
}

function jsonEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function evidenceText(row) {
  if (typeof row.evidence === 'string') return cleanField(row.evidence);
  if (row.evidence !== undefined) return cleanField(JSON.stringify(row.evidence));
  if (row.receipt) return cleanField(row.receipt);
  if (row.resume) return cleanField(row.resume);
  return '';
}

function planFileLabel(file) {
  if ([APPS_MD, APPLY_DATES_PATH, STATUS_EVENTS_PATH, TWC_OVERRIDES_PATH].includes(file)) {
    return `data/${path.basename(file)}`;
  }
  return path.relative(ROOT, file).replace(/\\/g, '/');
}

function mergeArrayEntry({ array, keyOf, value, type, file, key, row, changes }) {
  const indexes = [];
  array.forEach((item, index) => {
    if (keyOf(item) === keyOf(value)) indexes.push(index);
  });
  const before = indexes.length ? array[indexes.at(-1)] : null;
  if (indexes.length === 1 && jsonEqual(before, value)) return false;
  if (indexes.length) {
    const first = indexes[0];
    for (let i = indexes.length - 1; i >= 0; i -= 1) array.splice(indexes[i], 1);
    array.splice(first, 0, value);
  } else array.push(value);
  changes.push({
    type, file, key, before, after: value, evidence: evidenceText(row), conflict: indexes.length > 0,
  });
  return true;
}

function changeStatus({ trackerLines, trackerById, appId, after, row, changes, pendingEvents, today }) {
  const target = trackerById.get(appId);
  if (!target || target.parsed.status === after) return false;
  const before = target.parsed.status;
  const next = formatTrackerLine({ ...target.parsed, status: after });
  trackerLines[target.index] = next;
  target.parsed = parseTrackerLine(next);
  const eventDate = after === 'Applied' && ISO_DATE.test(String(row.date || '')) ? row.date : today;
  changes.push({
    type: 'tracker_status', file: APPS_MD, key: `application ${appId}`,
    before, after, evidence: evidenceText(row), conflict: false,
  });
  const event = { appId, status: after, company: target.parsed.company, date: eventDate };
  pendingEvents.push(event);
  changes.push({
    type: 'tracker_status_event', file: STATUS_EVENTS_PATH,
    key: `application ${appId}, ${after}`, before: null,
    after: { app: appId, date: eventDate, status: after, company: target.parsed.company, logged: today },
    evidence: evidenceText(row), conflict: false,
  });
  return true;
}

function countByKind(activities) {
  return Object.fromEntries(TWC_KINDS.map(kind => [kind, activities.filter(item => item.kind === kind).length]));
}

function applicationDateForSimulation({ appId, override, applyDates, statusEvents, tracker }) {
  if (ISO_DATE.test(String(override?.date || ''))) return override.date;
  const applyDate = currentApplyDate(applyDates[appId]);
  if (ISO_DATE.test(String(applyDate || ''))) return applyDate;
  const eventDate = statusEvents
    .filter(event => canonicalAppId(event.app) === appId && event.status === 'Applied'
      && ISO_DATE.test(String(event.date || '')))
    .map(event => event.date)
    .sort()[0];
  if (eventDate) return eventDate;
  return ISO_DATE.test(String(tracker?.date || '')) ? tracker.date : '';
}

function simulateAfter({ preActivities, changes, ledgerRows, trackerById, applyDates, statusEvents }) {
  let activities = preActivities.map(item => ({ ...item }));

  for (const change of changes.filter(item => item.type === 'apply_date')) {
    const date = currentApplyDate(change.after);
    activities.forEach(item => {
      if (item.kind === 'application' && canonicalAppId(item.appId) === canonicalAppId(change.key)) item.date = date;
    });
  }

  for (const change of changes.filter(item => item.type === 'tracker_status')) {
    const appId = canonicalAppId(change.key.replace('application ', ''));
    if (activities.some(item => item.kind === 'application' && canonicalAppId(item.appId) === appId)) continue;
    const row = ledgerRows.find(item => item.kind === 'application' && canonicalAppId(item.appId) === appId);
    const tracker = trackerById.get(appId)?.parsed;
    if (!row || !tracker) continue;
    activities.push({
      kind: 'application', date: row.date, company: tracker.company, contact: '', role: tracker.role, appId,
    });
  }

  for (const change of changes.filter(item => item.type === 'application_restore')) {
    const appId = canonicalAppId(change.key);
    if (activities.some(item => item.kind === 'application' && canonicalAppId(item.appId) === appId)) continue;
    const tracker = trackerById.get(appId)?.parsed;
    if (!tracker) continue;
    const date = applicationDateForSimulation({
      appId, override: change.after, applyDates, statusEvents, tracker,
    });
    if (!date) continue;
    activities.push({
      kind: 'application', date, company: tracker.company, contact: '', role: tracker.role, appId,
    });
  }

  for (const change of changes.filter(item => item.type === 'application_exclusion')) {
    activities = activities.filter(item => !(item.kind === 'application'
      && canonicalAppId(item.appId) === canonicalAppId(change.key)));
  }

  for (const change of changes.filter(item => item.type === 'interview_override')) {
    const value = change.after;
    activities = activities.filter(item => !(item.kind === 'interview'
      && canonicalAppId(item.appId) === canonicalAppId(value.appId)
      && normalizeWords(String(item.activity || '').replace(/^Interview:\s*/i, '')) === normalizeWords(value.stage)));
    const tracker = trackerById.get(canonicalAppId(value.appId))?.parsed;
    activities.push({
      kind: 'interview', date: value.date, company: tracker?.company || change.company || '',
      contact: '', role: tracker?.role || '', appId: value.appId, activity: `Interview: ${value.stage}`,
    });
  }

  for (const change of changes.filter(item => item.type === 'activity_exclusion')) {
    const exclusion = change.after;
    activities = activities.filter(item => !sameActivity(item, exclusion, exclusion.kind));
  }

  const seenAdds = new Set(activities.map(additionKey));
  for (const change of changes.filter(item => item.type === 'activity_addition')) {
    const value = change.after;
    const key = additionKey(value);
    if (seenAdds.has(key)) continue;
    seenAdds.add(key);
    activities.push({ ...value });
  }
  return activities;
}

function addAutomaticExclusion({ candidate, row, preActivities, includedSignatures, overrides, changes,
  ambiguousExclusions, processedExclusions }) {
  const signature = activitySignature(candidate);
  if (processedExclusions.has(signature) || includedSignatures.has(signature)) return false;
  const matches = preActivities.filter(activity => activitySignature(activity) === signature);
  if (matches.length > 1) {
    processedExclusions.add(signature);
    ambiguousExclusions.push({
      date: candidate.date, kind: candidate.kind, company: candidate.company,
      contact: candidate.contact, matches: matches.length, evidence: evidenceText(row),
    });
    return false;
  }
  if (matches.length !== 1) return false;
  processedExclusions.add(signature);
  const emitted = matches[0];
  const value = {
    date: emitted.date, kind: emitted.kind, contact: cleanField(emitted.contact, 120),
    company: cleanField(emitted.company, 120),
    note: cleanField(candidate.note || 'Excluded by the TWC evidence ledger'),
  };
  return mergeArrayEntry({
    array: overrides.exclude, keyOf: excludeKey, value,
    type: 'activity_exclusion', file: TWC_OVERRIDES_PATH,
    key: excludeKey(value), row, changes,
  });
}

export function buildRepairPlan({ ledger, now = new Date() }) {
  if (!ledger || !Array.isArray(ledger.final)) throw new Error('Ledger must be a JSON object with a final array');

  const today = localYmd(now);
  const trackerText = fs.existsSync(APPS_MD) ? fs.readFileSync(APPS_MD, 'utf8') : '';
  const eol = trackerText.includes('\r\n') ? '\r\n' : '\n';
  const trackerLines = trackerText.split(/\r?\n/);
  const trackerById = new Map();
  trackerLines.forEach((line, index) => {
    const parsed = parseTrackerLine(line);
    if (parsed) trackerById.set(String(parsed.num), { index, parsed });
  });

  const applyDates = { ...(readApplyDates() || {}) };
  const statusEvents = parseStatusEvents() || [];
  const pendingEvents = [];
  const existingStageEvents = new Set(statusEvents.map(interviewStageKey));

  const rawOverrides = readJson(TWC_OVERRIDES_PATH, {});
  const overrides = rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)
    ? structuredClone(rawOverrides) : {};
  if (!overrides.applications || typeof overrides.applications !== 'object' || Array.isArray(overrides.applications)) {
    overrides.applications = {};
  }
  if (!Array.isArray(overrides.interviews)) overrides.interviews = [];
  if (!Array.isArray(overrides.exclude)) overrides.exclude = [];
  if (!Array.isArray(overrides.add)) overrides.add = [];

  const changes = [];
  const needsTrackerRows = [];
  const pendingConfirmations = [];
  const ambiguousExclusions = [];
  const manualInterviews = [];
  let applyDatesChanged = false;
  let trackerChanged = false;
  let overridesChanged = false;

  const preActivities = buildActivities();
  const includedRows = ledger.final.filter(row => row && row.include === 'yes');
  const includedSignatures = new Set(includedRows.map(row => activitySignature(row)));
  const processedExclusions = new Set();

  for (const row of ledger.final) {
    if (!row || typeof row !== 'object' || row.kind !== 'application') continue;
    const appId = canonicalAppId(row.appId);
    const trackedApplication = Boolean(appId && trackerById.has(appId));

    if (row.include === 'confirm') {
      pendingConfirmations.push({
        date: row.date || '', employer: employerOf(row), role: cleanField(row.role, 120),
        appId, evidence: evidenceText(row),
      });
      continue;
    }

    if (row.include === 'no' && trackedApplication) {
      const before = overrides.applications[appId];
      const value = {
        ...(before && typeof before === 'object' ? before : {}), include: false,
        note: cleanField(`Excluded by ledger: ${row.status || 'include no'}`),
      };
      if (!jsonEqual(before, value)) {
        overrides.applications[appId] = value;
        overridesChanged = true;
        changes.push({
          type: 'application_exclusion', file: TWC_OVERRIDES_PATH, key: appId,
          before: before ?? null, after: value, evidence: evidenceText(row), conflict: before !== undefined,
        });
      }
      continue;
    }

    if (row.include !== 'yes') continue;
    if (trackedApplication && overrides.applications[appId]?.include === false) {
      const before = overrides.applications[appId];
      const after = { ...before, include: true };
      overrides.applications[appId] = after;
      overridesChanged = true;
      changes.push({
        type: 'application_restore', file: TWC_OVERRIDES_PATH, key: appId,
        before, after, evidence: evidenceText(row), conflict: true,
      });
    }
    if (!trackedApplication) {
      needsTrackerRows.push({
        date: row.date || '', employer: employerOf(row), role: cleanField(row.role, 120), evidence: evidenceText(row),
      });
    }

    if (trackedApplication && ISO_DATE.test(String(row.date || '')) && (Boolean(row.receipt) || Boolean(row.resume))) {
      const before = applyDates[appId];
      if (currentApplyDate(before) !== row.date) {
        const after = correctedApplyValue(before, row.date);
        applyDates[appId] = after;
        applyDatesChanged = true;
        changes.push({
          type: 'apply_date', file: APPLY_DATES_PATH, key: appId,
          before: before ?? null, after, evidence: evidenceText(row), conflict: before !== undefined,
        });
      }
    }

    if (trackedApplication) {
      const target = trackerById.get(appId);
      let nextStatus = null;
      if (target && target.parsed.status === 'Rejected' && row.result === 'No reply' && !trueValue(row.hasRej)) {
        nextStatus = 'No Response';
      } else if (target && RECOVERABLE_STATUSES.has(target.parsed.status)) {
        nextStatus = trueValue(row.hasRej) ? 'Rejected'
          : withinLastDays(row.date, today, 20) ? 'Applied' : 'No Response';
      }
      if (nextStatus && changeStatus({
        trackerLines, trackerById, appId, after: nextStatus, row, changes, pendingEvents, today,
      })) trackerChanged = true;
    }
  }

  const ledgerInterviews = [];
  for (const row of includedRows.filter(item => item.kind === 'interview' && ISO_DATE.test(String(item.date || '')))) {
    const appId = canonicalAppId(row.appId);
    const duplicate = ledgerInterviews.some(existing => existing.date === row.date
      && companyKey(employerOf(existing)) === companyKey(employerOf(row))
      && (!appId || !canonicalAppId(existing.appId) || canonicalAppId(existing.appId) === appId));
    if (duplicate) continue;
    ledgerInterviews.push(row);
  }

  const seenLedgerInterviewStages = new Map();
  for (const row of ledgerInterviews) {
    const appId = canonicalAppId(row.appId);
    const stage = deriveInterviewStage(row.activity);
    const stageKey = interviewStageKey({ appId, stage });
    const priorStage = appId ? seenLedgerInterviewStages.get(stageKey) : null;
    if (priorStage && priorStage.date !== row.date) {
      manualInterviews.push({
        appId, stage, company: employerOf(row), dates: [priorStage.date, row.date],
        evidence: [priorStage.evidence, evidenceText(row) || cleanField(row.activity, 120)],
      });
      continue;
    }
    if (appId && !priorStage) {
      seenLedgerInterviewStages.set(stageKey, {
        date: row.date, evidence: evidenceText(row) || cleanField(row.activity, 120),
      });
    }
    const existing = preActivities.filter(activity => activity.kind === 'interview' && activity.date === row.date
      && (appId ? canonicalAppId(activity.appId) === appId : companiesMatch(activity.company, employerOf(row))));
    if (existing.length > 0 || !appId) continue;

    const value = {
      appId, stage, date: row.date,
      note: cleanField(`Evidence ledger: ${row.activity || 'interview'}`, 220),
    };
    if (mergeArrayEntry({
      array: overrides.interviews, keyOf: interviewKey, value,
      type: 'interview_override', file: TWC_OVERRIDES_PATH,
      key: `application ${appId}, ${stage}, ${row.date}`, row, changes,
    })) {
      overridesChanged = true;
      changes.at(-1).company = employerOf(row);
    }

    if (!existingStageEvents.has(stageKey)) {
      existingStageEvents.add(stageKey);
      const company = trackerById.get(appId)?.parsed.company || employerOf(row);
      pendingEvents.push({ appId, status: stage, company, date: row.date });
      changes.push({
        type: 'interview_status_event', file: STATUS_EVENTS_PATH,
        key: `application ${appId}, ${stage}`, before: null,
        after: { app: appId, date: row.date, status: stage, company, logged: today },
        evidence: evidenceText(row), conflict: false,
      });
    }
  }

  const preInterviews = preActivities.filter(item => item.kind === 'interview');
  const protectedInterviews = new Set();
  for (const row of ledgerInterviews) {
    const appId = canonicalAppId(row.appId);
    const candidates = preInterviews.map((activity, index) => ({ activity, index }))
      .filter(({ activity, index }) => !protectedInterviews.has(index) && activity.date === row.date
        && companiesMatch(activity.company, employerOf(row), true));
    const preferred = candidates.find(({ activity }) => appId && canonicalAppId(activity.appId) === appId)
      || candidates[0];
    if (preferred) protectedInterviews.add(preferred.index);
  }

  preInterviews.forEach((activity, index) => {
    if (protectedInterviews.has(index)) return;
    const candidate = {
      date: activity.date, kind: 'interview', company: activity.company, contact: '',
      note: 'Interview absent from the included evidence ledger',
    };
    if (addAutomaticExclusion({
      candidate, row: { evidence: activity.note || activity.activity }, preActivities,
      includedSignatures, overrides, changes, ambiguousExclusions, processedExclusions,
    })) overridesChanged = true;
  });

  for (const row of includedRows) {
    if (!['followup', 'outreach'].includes(row.kind)
      || !ISO_DATE.test(String(row.trackerDate || ''))
      || !ISO_DATE.test(String(row.date || ''))
      || row.trackerDate === row.date) continue;
    const candidate = {
      date: row.trackerDate, kind: row.kind, company: employerOf(row), contact: cleanField(row.contact, 120),
      note: cleanField(`Moved to ${row.date} by evidence ledger`),
    };
    if (addAutomaticExclusion({
      candidate, row, preActivities, includedSignatures, overrides, changes,
      ambiguousExclusions, processedExclusions,
    })) overridesChanged = true;
  }

  const ledgerExclusionRows = ledger.final.filter(row => row && (
    (row.kind === 'followup' && row.status === 'NOT_FOUND_IN_GMAIL')
    || (['followup', 'outreach'].includes(row.kind) && row.include === 'no')
  ));
  for (const row of ledgerExclusionRows) {
    if (!ISO_DATE.test(String(row.date || ''))) continue;
    const candidate = {
      date: row.date, kind: row.kind, company: employerOf(row), contact: cleanField(row.contact, 120),
      note: cleanField(`Excluded by ledger: ${row.status || row.include}`),
    };
    if (addAutomaticExclusion({
      candidate, row, preActivities, includedSignatures, overrides, changes,
      ambiguousExclusions, processedExclusions,
    })) overridesChanged = true;
  }

  for (const followup of parseFollowupsMd()) {
    if (isContactChannel(followup.channel) || !ISO_DATE.test(String(followup.date || ''))) continue;
    const emittedKinds = preActivities.filter(activity => activity.date === followup.date
      && companiesMatch(activity.company, followup.company)
      && normalizePerson(activity.contact) === normalizePerson(followup.contact)
      && ['followup', 'outreach'].includes(activity.kind));
    for (const kind of new Set(emittedKinds.map(activity => activity.kind))) {
      const candidate = {
        date: followup.date, kind, company: cleanField(followup.company, 120),
        contact: cleanField(followup.contact, 120),
        note: cleanField(`Excluded non-contact channel: ${followup.channel}`),
      };
      if (addAutomaticExclusion({
        candidate, row: { evidence: `follow-ups.md row ${followup.n}` }, preActivities,
        includedSignatures, overrides, changes, ambiguousExclusions, processedExclusions,
      })) overridesChanged = true;
    }
  }

  const plannedActivitiesBeforeAdditions = simulateAfter({
    preActivities, changes, ledgerRows: ledger.final, trackerById, applyDates, statusEvents,
  });
  const plannedApplications = plannedActivitiesBeforeAdditions
    .filter(activity => activity.kind === 'application' && ISO_DATE.test(String(activity.date || '')));
  const emittedTrackerApplicationKeys = new Set(plannedApplications
    .filter(activity => trackerById.has(canonicalAppId(activity.appId)))
    .map(applicationCompanyDateKey));
  const emittedAddedApplicationKeys = new Set(plannedApplications
    .filter(activity => !trackerById.has(canonicalAppId(activity.appId)))
    .map(applicationRoleKey));
  const addableRows = includedRows.filter(row => ['followup', 'outreach', 'event', 'application'].includes(row.kind)
    && ISO_DATE.test(String(row.date || ''))
    && !(row.kind === 'application' && trackerById.has(canonicalAppId(row.appId))));
  for (const row of addableRows) {
    const trackerApplicationKey = row.kind === 'application' ? applicationCompanyDateKey(row) : '';
    const addedApplicationKey = row.kind === 'application' ? applicationRoleKey(row) : '';
    if ((trackerApplicationKey && (emittedTrackerApplicationKeys.has(trackerApplicationKey)
      || emittedAddedApplicationKeys.has(addedApplicationKey)))
      || (!trackerApplicationKey && preActivities.some(activity => sameActivity(activity, row)))) continue;
    const value = {
      date: row.date, kind: row.kind, activity: cleanField(row.activity, 120),
      company: employerOf(row), role: cleanField(row.role, 120), contact: cleanField(row.contact, 120),
      method: cleanField(row.method, 120), result: cleanField(row.result || 'Other', 120),
      note: cleanField(`Added from evidence ledger: ${evidenceText(row) || row.source || row.status || 'verified evidence'}`),
    };
    if (!value.activity) continue;
    if (mergeArrayEntry({
      array: overrides.add, keyOf: additionKey, value,
      type: 'activity_addition', file: TWC_OVERRIDES_PATH,
      key: additionKey(value), row, changes,
    })) {
      overridesChanged = true;
      if (addedApplicationKey) emittedAddedApplicationKeys.add(addedApplicationKey);
    }
  }

  const afterActivities = simulateAfter({
    preActivities, changes, ledgerRows: ledger.final, trackerById, applyDates, statusEvents,
  });
  return {
    today,
    changes,
    needsTrackerRows,
    pendingConfirmations,
    ambiguousExclusions,
    manualInterviews,
    exportBefore: countByKind(preActivities),
    exportAfter: countByKind(afterActivities),
    counts: Object.fromEntries(CHANGE_TYPES.map(type => [type, changes.filter(change => change.type === type).length])),
    totalChanges: changes.length,
    files: {
      trackerText: trackerLines.join(eol), trackerChanged,
      applyDates, applyDatesChanged,
      overrides, overridesChanged,
      pendingEvents,
    },
  };
}

function printable(value) {
  if (value === null || value === undefined) return '(none)';
  if (typeof value === 'string') return value || '(empty)';
  return JSON.stringify(value);
}

function renderPlan(plan, { applied = false, backups = [], written = [] } = {}) {
  const lines = [
    '# TWC repair plan', '',
    `Generated: ${plan.today}`, `Mode: ${applied ? 'apply' : 'dry run'}`, '',
    '## Summary', '',
  ];
  for (const type of CHANGE_TYPES) lines.push(`- ${type}: ${plan.counts[type]}`);
  lines.push(`- total changes: ${plan.totalChanges}`);
  lines.push(`- needs a tracker row: ${plan.needsTrackerRows.length}`);
  lines.push(`- pending confirmation: ${plan.pendingConfirmations.length}`);
  lines.push(`- ambiguous exclusions: ${plan.ambiguousExclusions.length}`);
  lines.push(`- interviews needing a manual entry: ${plan.manualInterviews.length}`, '');

  lines.push('## Export activity by kind', '');
  for (const kind of TWC_KINDS) lines.push(`- ${kind}: before ${plan.exportBefore[kind]}, after ${plan.exportAfter[kind]}`);
  lines.push('');

  lines.push('## Changes', '');
  if (!plan.changes.length) lines.push('No data changes planned.', '');
  plan.changes.forEach((change, index) => {
    lines.push(`### ${index + 1}. ${change.type}`, '');
    lines.push(`- File: ${planFileLabel(change.file)}`);
    lines.push(`- Key or row: ${change.key}`);
    lines.push(`- Before: ${printable(change.before)}`);
    lines.push(`- After: ${printable(change.after)}`);
    lines.push(`- Evidence: ${change.evidence || '(none)'}`);
    if (change.conflict) lines.push('- Conflict: ledger value wins');
    lines.push('');
  });

  lines.push('## Needs a tracker row', '');
  if (!plan.needsTrackerRows.length) lines.push('None.', '');
  for (const item of plan.needsTrackerRows) {
    lines.push(`- ${item.date}: ${item.employer} | ${item.role} | Evidence: ${item.evidence || '(none)'}`);
  }
  if (plan.needsTrackerRows.length) lines.push('');

  lines.push('## Pending your confirmation (counted by the tracker, not by the ledger)', '');
  if (!plan.pendingConfirmations.length) lines.push('None.', '');
  for (const item of plan.pendingConfirmations) {
    lines.push(`- ${item.date}: application ${item.appId || '(no app id)'} | ${item.employer} | ${item.role}`);
  }
  if (plan.pendingConfirmations.length) lines.push('');

  lines.push('## Ambiguous exclusions, needs review', '');
  if (!plan.ambiguousExclusions.length) lines.push('None.', '');
  for (const item of plan.ambiguousExclusions) {
    lines.push(`- ${item.date}: ${item.kind} | ${item.company} | ${item.contact || '(no contact)'} | ${item.matches} matches`);
  }
  if (plan.ambiguousExclusions.length) lines.push('');

  lines.push('## Interviews needing a manual entry (same application and stage on two dates)', '');
  if (!plan.manualInterviews.length) lines.push('None.', '');
  for (const item of plan.manualInterviews) {
    lines.push(`- Application ${item.appId}: ${item.stage} at ${item.company} | Dates: ${item.dates.join(' and ')} | Evidence: ${item.evidence.join(' | ')}`);
  }
  if (plan.manualInterviews.length) lines.push('');

  if (applied) {
    lines.push('## Backups', '');
    if (!backups.length) lines.push('None.', '');
    for (const file of backups) lines.push(`- ${file}`);
    lines.push('## Files written', '');
    if (!written.length) lines.push('None.', '');
    for (const file of written) lines.push(`- ${file}`);
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function parseArgs(args) {
  const options = { apply: false, ledgerPath: '', planPath: '' };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--apply') options.apply = true;
    else if (arg === '--ledger') options.ledgerPath = args[++i] || '';
    else if (arg === '--plan') options.planPath = args[++i] || '';
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.ledgerPath) throw new Error('Required argument missing: --ledger <path>');
  return options;
}

function statusEventKey(value) {
  return `${canonicalAppId(value.appId ?? value.app)}|${normalizeWords(value.status)}|${value.date}`;
}

function countStatusEvents(events) {
  const counts = new Map();
  for (const event of events) {
    const key = statusEventKey(event);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function verifyAppendedStatusEvents(beforeEvents, pendingEvents) {
  const beforeCounts = countStatusEvents(beforeEvents);
  const afterCounts = countStatusEvents(parseStatusEvents() || []);
  const expectedCounts = countStatusEvents(pendingEvents);
  const missing = [];
  for (const [key, expected] of expectedCounts) {
    if ((afterCounts.get(key) || 0) >= (beforeCounts.get(key) || 0) + expected) continue;
    const event = pendingEvents.find(item => statusEventKey(item) === key);
    missing.push(`application ${event.appId}, status ${event.status}, date ${event.date}`);
  }
  if (missing.length) throw new Error(`Status events failed verification: ${missing.join('; ')}`);
}

function writeData(plan, now, statusEventLogger = logStatusEvent) {
  const targets = [];
  if (plan.files.applyDatesChanged) targets.push(APPLY_DATES_PATH);
  if (plan.files.trackerChanged) targets.push(APPS_MD);
  if (plan.files.pendingEvents.length) targets.push(STATUS_EVENTS_PATH);
  if (plan.files.overridesChanged) targets.push(TWC_OVERRIDES_PATH);

  const stamp = timestamp(now);
  const backupPairs = targets.filter(file => fs.existsSync(file)).map(file => ({
    file, backup: `${file}.bak-${stamp}-pre-twc-repair`,
  }));
  const collision = backupPairs.find(pair => fs.existsSync(pair.backup));
  if (collision) throw new Error(`Backup already exists: ${collision.backup}`);

  const backups = [];
  for (const pair of backupPairs) {
    fs.copyFileSync(pair.file, pair.backup, fs.constants.COPYFILE_EXCL);
    backups.push(pair.backup);
  }

  const written = [];
  const statusEventsBefore = plan.files.pendingEvents.length ? (parseStatusEvents() || []) : [];
  const dataDir = path.dirname(APPS_MD);
  let renderFailed = false;

  if (logWritesEnabled(dataDir)) {
    try {
      withLogWrite(dataDir, store => {
        if (plan.files.applyDatesChanged) writeApplyDates(plan.files.applyDates);
        if (plan.files.trackerChanged) {
          const baseText = fs.readFileSync(APPS_MD, 'utf8');
          writeTableText({
            dataDir,
            file: 'applications.md',
            baseText,
            newText: plan.files.trackerText,
            rowKey: line => {
              const row = parseTrackerLine(line);
              return row ? String(row.num) : null;
            },
            buildEvents: ({ added, changed, removed }) => {
              if (added.length || removed.length) throw new Error('repair-twc-data may only update existing tracker rows');
              return changed.map(change => {
                const before = parseTrackerLine(change.previousRaw);
                const after = parseTrackerLine(change.raw);
                return {
                  type: 'status_changed', application_id: String(after.num), occurred_on: localToday(now),
                  payload: {
                    ref: `app:${after.num}`, fields: ['status'], from: before.status, to: after.status,
                    legacy_effects: [change.effect],
                  },
                };
              });
            },
          });
        }
        for (const event of plan.files.pendingEvents) {
          statusEventLogger(event.appId, event.status, { company: event.company, date: event.date });
        }
        if (plan.files.overridesChanged) {
          appendEventsWithEffects(store, [{
            type: 'legacy_record', occurred_on: localToday(now), source: 'cli', definitions_version: 'v1',
            payload: {
              reason: 'twc_overrides_repaired', count: plan.changes.length,
              legacy_effects: [{ file: 'twc-overrides.json', op: 'json_replace', value: plan.files.overrides }],
            },
          }]);
        }
      });
    } catch (error) {
      if (error.code === 'RENDER_FAILED') {
        renderFailed = true;
        console.warn(`Warning: ${error.message}`);
      } else throw error;
    }
  } else {
    if (plan.files.applyDatesChanged) writeApplyDates(plan.files.applyDates);
    if (plan.files.trackerChanged) fs.writeFileSync(APPS_MD, plan.files.trackerText);
    for (const event of plan.files.pendingEvents) {
      statusEventLogger(event.appId, event.status, { company: event.company, date: event.date });
    }
    if (plan.files.overridesChanged) {
      fs.writeFileSync(TWC_OVERRIDES_PATH, `${JSON.stringify(plan.files.overrides, null, 2)}\n`);
    }
  }

  if (plan.files.applyDatesChanged) written.push(APPLY_DATES_PATH);
  if (plan.files.trackerChanged) written.push(APPS_MD);
  if (plan.files.pendingEvents.length) {
    if (!renderFailed) verifyAppendedStatusEvents(statusEventsBefore, plan.files.pendingEvents);
    written.push(STATUS_EVENTS_PATH);
  }
  if (plan.files.overridesChanged) written.push(TWC_OVERRIDES_PATH);
  return { backups, written };
}

export function runRepair({
  ledgerPath, planPath, apply = false, now = new Date(), statusEventLogger = logStatusEvent,
}) {
  const ledgerFile = path.resolve(ledgerPath);
  const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
  const plan = buildRepairPlan({ ledger, now });
  const destination = path.resolve(planPath || path.join(ROOT, 'output', `twc-repair-plan-${timestamp(now)}.md`));
  let result = { backups: [], written: [] };
  if (apply && plan.totalChanges > 0) result = writeData(plan, now, statusEventLogger);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, renderPlan(plan, {
    applied: apply,
    backups: result.backups.map(planFileLabel),
    written: result.written.map(planFileLabel),
  }));

  console.log(`TWC repair ${apply ? 'apply' : 'dry run'}`);
  for (const type of CHANGE_TYPES) console.log(`${type}: ${plan.counts[type]}`);
  console.log(`total changes: ${plan.totalChanges}`);
  console.log(`needs a tracker row: ${plan.needsTrackerRows.length}`);
  console.log(`pending confirmation: ${plan.pendingConfirmations.length}`);
  console.log(`ambiguous exclusions: ${plan.ambiguousExclusions.length}`);
  console.log(`interviews needing a manual entry: ${plan.manualInterviews.length}`);
  for (const kind of TWC_KINDS) console.log(`${kind}: before ${plan.exportBefore[kind]}, after ${plan.exportAfter[kind]}`);
  console.log(`plan: ${destination}`);
  if (apply) {
    console.log(`backups: ${result.backups.length}`);
    result.backups.forEach(file => console.log(`backup: ${file}`));
    console.log(`files written: ${result.written.length}`);
    result.written.forEach(file => console.log(`written: ${file}`));
  }
  return { ...plan, planPath: destination, ...result };
}

export function main(args = process.argv.slice(2)) {
  return runRepair(parseArgs(args));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`repair-twc-data: ${error.message}`);
    process.exitCode = 1;
  }
}
