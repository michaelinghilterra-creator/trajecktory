import fs from 'fs';
import { computeCoreMetrics } from '../../../lib/metrics/core.mjs';
import { parseReplyNote } from '../../../lib/data-review.mjs';
import { classifyInbound, isApplicationReceipt } from '../../../lib/inbound-classify.mjs';
import { INBOUND_EVENT_TYPE, inboundRepliesFromEvents, replyKey, respondedKey } from '../../../lib/inbound-events.mjs';
import { readEvents } from '../../../lib/event-store.mjs';
import { logWritesEnabled, withLogRead } from '../../../lib/log-writes.mjs';
import { normalizeCompany, sameRole } from '../../../lib/identity.mjs';
import { interviewState } from '../../../lib/interview-store.mjs';
import { localToday } from '../../../lib/local-date.mjs';
import { APPS_MD, DATA_DIR, FOLLOWUPS_MD } from '../config.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { isLinkedInEntry } from './channels.mjs';
import { parseFollowupsMd } from './followups.mjs';
import { readInterviewRecords } from './interview-events.mjs';
import { readAppNotes } from './notes.mjs';
import { parseReferralsMd, readReferralCorrespondence, resolveReferralLink } from './referrals.mjs';
import { parseStatusEvents } from './sidecars.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { buildActivities } from './twc.mjs';
import { REFERRAL_STATES } from './statuses.mjs';

export const CORE_CACHE_KEY = 'metrics/core';

const safe = (read, fallback) => {
  try { return read(); } catch { return fallback; }
};

// The classified email_received events, when the event store is on: { replies, keys } or null when it is off.
function readInboundEvents() {
  if (!logWritesEnabled(DATA_DIR)) return null;
  return withLogRead(DATA_DIR, (store) => inboundRepliesFromEvents([
    ...readEvents(store, { type: INBOUND_EVENT_TYPE }),
    ...readEvents(store, { type: 'event_undone' }),
  ]));
}

// Replies come from the recorded events first. A note or a 'Responded' row is read only when no event records that
// reply yet (the key is the same either way), so the switch is safe before, during and after the one-time backfill,
// and with the event store off everything is read from the notes exactly as before.
function collectReplies() {
  const recorded = safe(readInboundEvents, null);
  const recordedKeys = recorded ? recorded.keys : new Set();
  const replies = {};
  const add = (appId, reply) => {
    const key = String(appId);
    if (!replies[key]) replies[key] = [];
    replies[key].push(reply);
  };
  for (const [appId, list] of Object.entries(recorded ? recorded.replies : {})) {
    for (const reply of list) add(appId, reply);
  }

  const notes = safe(readAppNotes, {}) || {};
  for (const [appId, entries] of Object.entries(notes)) {
    for (const entry of (Array.isArray(entries) ? entries : [])) {
      const parsed = parseReplyNote(entry);
      if (!parsed || isApplicationReceipt(parsed)
        || classifyInbound({ subject: parsed.subject, body: parsed.body }) !== 'human') continue;
      if (recordedKeys.has(replyKey({ msg_id: entry.msgId, application_id: appId, note_timestamp: entry.timestamp }))) continue;
      add(appId, { sent_on: parsed.sent_on, sentiment: parsed.sentiment });
    }
  }

  const events = safe(parseStatusEvents, []) || [];
  for (const event of events) {
    if (String(event.status || '').trim().toLowerCase() !== 'responded') continue;
    if (recordedKeys.has(respondedKey({ application_id: event.app, date: event.date }))) continue;
    add(event.app, { sent_on: event.date, sentiment: 'neutral' });
  }
  return replies;
}

function collectUnserviced(apps) {
  if (!fs.existsSync(APPS_MD) || !fs.existsSync(FOLLOWUPS_MD)) return { available: false, count: null };
  try {
    const followups = parseFollowupsMd();
    const followed = new Set(followups.map(row => String(row.appNum)));
    return {
      available: true,
      count: apps.filter(app => app.status === 'Applied' && !followed.has(String(app.id))).length,
    };
  } catch {
    return { available: false, count: null };
  }
}

function collectContacts() {
  const contacts = [];
  const taRows = safe(parseTargetTalentMd, []) || [];
  const referralRows = (safe(parseReferralsMd, []) || []).filter(row => !resolveReferralLink(row, taRows));
  const books = [
    { rows: taRows, read: readTTCorrespondence },
    { rows: referralRows, read: readReferralCorrespondence },
  ];

  for (const book of books) {
    for (const contact of book.rows) {
      const messages = safe(() => book.read(contact.id), []) || [];
      for (const [channel, linkedIn] of [['email', false], ['linkedin', true]]) {
        const onChannel = messages.filter(message => isLinkedInEntry(message) === linkedIn);
        if (!onChannel.some(message => message.direction === 'Sent')) continue;
        contacts.push({
          channel,
          touched: true,
          replied: onChannel.some(message => message.direction === 'Received'
            && classifyInbound({ subject: message.subject, body: message.body }) === 'human'),
          bounced: contact.verified?.state === 'bounced',
        });
      }
    }
  }
  return contacts;
}

// Applications that carried a referral, from referrals.md rows marked applied with referral. The company is the
// "where they are now" cell; the target cell is free text holding the company, a role, or both. When the target
// names a role, only applications at that company whose role matches (lib/identity.mjs sameRole, or the role
// text appearing in the target) count, falling back to the only application there when there is exactly one.
// A company only target counts every application at that company.
export function referralApplicationIds(referralRows, apps) {
  const label = REFERRAL_STATES.find(state => state.id === 'applied_referral')?.label;
  const ids = new Set();
  for (const row of referralRows) {
    if (row.status !== label) continue;
    const company = normalizeCompany(row.where) || normalizeCompany(row.target);
    if (!company) continue;
    const atCompany = apps.filter(app => normalizeCompany(app.company) === company);
    const target = String(row.target || '').trim();
    let matched = atCompany;
    if (target && normalizeCompany(target) !== company) {
      const lowerTarget = target.toLowerCase();
      const byRole = atCompany.filter(app => {
        const role = String(app.role || '').trim();
        return role && (sameRole(role, target) || lowerTarget.includes(role.toLowerCase()));
      });
      matched = byRole.length ? byRole : (atCompany.length === 1 ? atCompany : []);
    }
    for (const app of matched) ids.add(String(app.id));
  }
  return ids;
}

export function collectCoreMetrics({ today = localToday() } = {}) {
  const activities = safe(() => buildActivities({ today }), []) || [];
  const rawApps = safe(parseApplicationsMd, []) || [];
  const referralIds = referralApplicationIds(safe(parseReferralsMd, []) || [], rawApps);
  const apps = rawApps.map(app => ({
    id: app.id,
    status: app.status,
    reached: app.reached,
    score: app.score,
    scorerVersion: app.scorerVersion,
    warm: app.inbound === true || app.outbound === true || app.source === 'Referral' || referralIds.has(String(app.id)),
    referral: app.source === 'Referral' || referralIds.has(String(app.id)),
    archetype: app.archetype,
    source: app.source,
  }));
  const records = safe(readInterviewRecords, new Map());
  const interviews = [...(records?.values?.() || [])].map(record => ({
    appId: record.application_id,
    stage: record.stage,
    held_on: record.held_on ?? null,
    scheduled_for: record.scheduled_for ?? null,
    state: interviewState(record, today).state,
  }));

  return computeCoreMetrics({
    today,
    activities,
    apps,
    replies: collectReplies(),
    interviews,
    unserviced: collectUnserviced(rawApps),
    contacts: collectContacts(),
  });
}
