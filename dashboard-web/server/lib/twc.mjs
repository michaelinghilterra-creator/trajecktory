// lib/twc.mjs — the Texas Workforce Commission (TWC) work-search activity report.
//
// WHY THIS EXISTS
// A claimant on unemployment must keep a running log of job-search activities and
// produce it on request or lose benefits. The user already does all of that
// searching inside trajecktory, so this assembles the log straight from their own
// data instead of asking them to hand-keep it. Pick a date range, get one row per
// dated activity in that window, export as CSV whose columns mirror the TWC Work
// Search Log. TWC accepts CSV — the exact PDF form is not required.
//
// WHAT COUNTS AS AN ACTIVITY (all TWC-acceptable):
//   - applications sent   → "Applied online for a job"
//   - interviews          → each dated interview event ("Interview: Phone Screen")
//   - follow-up (email)   → each dated Sent email to an employer contact
//   - networking          → each dated LinkedIn connection request to a contact
// Raw evaluations are deliberately NOT counted (hundreds of them; padding).
//
// OUTREACH IS SOURCED FROM THE CORRESPONDENCE LOGS, not follow-ups.md alone.
// follow-ups.md only captures a touch when the "also log to application"
// cross-log fires, so every bulk / queue send (the bulk of the real outreach)
// never reached it and the report was blind to it — e.g. a fortnight showing 13
// follow-ups when 90 emails and 60 LinkedIn requests had actually gone out. The
// per-contact correspondence logs (target-talent + recruiters) ARE the authoritative
// record of every Sent message, so we read them directly and merge follow-ups.md on
// top, deduped, so a cross-logged touch (present in both) is counted exactly once and
// a hand-entered follow-up with no correspondence file is still kept.
//
// DATE SOURCING is the subtle part. The applications.md Date column is the
// evaluation/scrape date, NOT when the user applied, so an application is dated
// (best first): apply-dates.json → earliest "Applied" status-event → the tracker
// Date column (approximate; flagged). Interviews and follow-ups carry their own
// real dates.
//
// Pure apart from the sidecar reads (mirrors lib/activity.mjs), so it is unit
// testable. enrichEmployers is the one impure, network-touching export.
import fs from 'fs';
import { parseApplicationsMd } from './applications.mjs';
import { readApplyDates, parseStatusEvents } from './sidecars.mjs';
import { parseFollowupsMd } from './followups.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';
import { parseReferralsMd, readReferralCorrespondence, resolveReferralLink } from './referrals.mjs';
import { isLinkedInEntry, isLinkedInInvite, isLinkedInSubject } from './channels.mjs';
import { canonicalUrl, normalizeCompany } from '../../../lib/identity.mjs';
import { appReached, isInterviewStage } from './statuses.mjs';
import { readEmployerDirectory, employerKey, hasEmployer, mergeEmployers } from './employer-directory.mjs';
import { toCsv } from './csv.mjs';
import { readConnects } from './connects.mjs';
import { readAppNotes } from './notes.mjs';
import { readEvents, TWC_EVENT_TYPES, TWC_EVENT_METHODS } from './twc-events.mjs';
import { getIdentity } from './profile.mjs';
import { generateText, draftModel } from './anthropic.mjs';
import { TWC_OVERRIDES_PATH } from '../config.mjs';
import { readInterviewRecords } from './interview-events.mjs';
import { interviewKey, interviewState } from '../../../lib/interview-store.mjs';
import { localToday } from '../../../lib/log-writes.mjs';

const isYmd = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };

// TWC weeks run Sunday–Saturday ("a week begins on Sunday and ends on Saturday").
// Returns the Sunday on or before `ymd`, so activities group into benefit weeks.
// Parsed as UTC deliberately, exactly like activity.mjs weekStartOf: a local-time
// parse shifts a date-only string across a week boundary west of UTC and silently
// moves Sunday's work into the wrong week. NOTE this is Sunday-based on purpose —
// activity.mjs weekStartOf is Monday-based (ISO) and must not be reused here.
export function twcWeekStart(ymd) {
  if (!isYmd(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // getUTCDay: 0 = Sunday
  return d.toISOString().slice(0, 10);
}

// Map an application's current status to a TWC "Result of your activity" phrase.
// TWC's own examples: submitted job application, sent a résumé, interviewed, hired,
// not hired, no reply, other. The application row reflects that application's
// outcome, so a role that later rejected reads "Not hired" on its apply row.
const RESULT_BY_STATUS = {
  Evaluated: 'Submitted job application',
  Applied: 'Submitted job application',
  'Phone Screen': 'Interviewed',
  '1st Interview': 'Interviewed',
  '2nd Interview': 'Interviewed',
  '3rd Interview': 'Interviewed',
  Hired: 'Hired',
  Offer: 'Other',
  Rejected: 'Not hired',
  'No Response': 'No reply',
  Closed: 'Other',
  Discarded: 'Other',
  'Not a Fit': 'Other',
  SKIP: 'Other',
};
function resultForStatus(status) { return RESULT_BY_STATUS[status] || 'Other'; }

export const TWC_KINDS = ['application', 'interview', 'followup', 'outreach', 'event'];
const TWC_RESULTS = new Set(['Submitted job application', 'Sent a résumé', 'Interviewed', 'Hired', 'Not hired', 'No reply', 'Other']);
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/;

function readTwcOverrides() {
  try {
    const raw = JSON.parse(fs.readFileSync(TWC_OVERRIDES_PATH, 'utf8'));
    return {
      applications: raw && typeof raw.applications === 'object' && !Array.isArray(raw.applications)
        ? raw.applications : {},
      interviews: Array.isArray(raw && raw.interviews) ? raw.interviews : [],
      exclude: Array.isArray(raw && raw.exclude) ? raw.exclude : [],
      add: Array.isArray(raw && raw.add) ? raw.add : [],
    };
  } catch {
    return { applications: {}, interviews: [], exclude: [], add: [] };
  }
}

const normalizePerson = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeStage = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const joinNotes = (...parts) => parts.map(p => String(p || '').trim()).filter(Boolean).join('; ');
const cleanTwcText = (s) => String(s || '').replace(/\u2014/g, '-').replace(/\x2d{2,}/g, '-');

function overrideString(value, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') return null;
  if (CONTROL_RE.test(value)) return null;
  const clean = value.trim();
  if ((required && !clean) || clean.length > max) return null;
  return clean;
}

function validExcludeOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const contact = overrideString(value.contact, 120);
  const company = overrideString(value.company, 120);
  const note = overrideString(value.note, 500);
  if (!isYmd(value.date) || !TWC_KINDS.includes(value.kind)
    || contact === null || company === null || note === null || (!contact && !company)) return null;
  return { date: value.date, kind: value.kind, contact, company };
}

function validAddOverride(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const activity = overrideString(value.activity, 120, true);
  const company = overrideString(value.company, 120);
  const role = overrideString(value.role, 120);
  const contact = overrideString(value.contact, 120);
  const method = overrideString(value.method, 120);
  const note = overrideString(value.note, 500);
  if (!isYmd(value.date) || !TWC_KINDS.includes(value.kind) || !TWC_RESULTS.has(value.result)
    || [activity, company, role, contact, method, note].some(field => field === null)) return null;
  return {
    date: value.date, kind: value.kind, activity, company, role, contact, method,
    result: value.result, note,
  };
}

function isSelfActivity(contact, identity) {
  const raw = String(contact || '').trim();
  if (!raw) return false;
  const ownName = normalizePerson(identity && identity.fullName);
  const ownEmail = String((identity && identity.email) || '').trim().toLowerCase();
  return Boolean((ownName && normalizePerson(raw) === ownName)
    || (ownEmail && raw.toLowerCase().includes(ownEmail)));
}

function applicationDetailNote(status) {
  return resultForStatus(status) === 'Other' && status ? `Status: ${status}` : '';
}

function isPostingSpecificCanonical(canonical) {
  if (!canonical) return false;
  if (/^(?:gh|lever|ashby):/i.test(canonical)) return true;
  if (canonical.includes('?')) return true;
  try {
    const parsed = new URL(canonical);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (segments.some(segment => /^\d+$/.test(segment) || uuid.test(segment))) return true;
    const atsHost = /(?:^|\.)(?:lever\.co|ashbyhq\.com)$/i.test(parsed.hostname);
    return atsHost && segments.length >= 2 && /^[a-z0-9-]{8,}$/i.test(segments.at(-1));
  } catch {
    return false;
  }
}

// The CSV header row — mirrors the TWC Work Search Log fields, with a leading
// benefit-week column so each activity is grouped to its Sunday–Saturday week.
export const TWC_CSV_HEADERS = [
  'Week of (Sun)', 'Date', 'Work search activity', 'Type of job you are seeking',
  'Employer name', 'Employer address', 'Employer web page', 'Employer phone',
  'Person contacted', 'Method of contact', 'Result', 'Note',
];

/**
 * Build the flat, dated activity list for [from, to] inclusive (YYYY-MM-DD, either
 * open-ended). One row per application (deduped), per interview event, and per
 * follow-up touch, joined to the cached employer directory for address/phone.
 */
export function buildActivities({ from, to, identity, interviewRecords, today } = {}) {
  const apps = safe(parseApplicationsMd, []);
  const byId = new Map(apps.map(a => [String(a.id), a]));
  const applyDates = safe(readApplyDates, {}) || {};
  const events = safe(parseStatusEvents, []) || [];
  const followups = safe(parseFollowupsMd, []) || [];
  const directory = safe(readEmployerDirectory, {}) || {};
  const appNotes = safe(readAppNotes, {}) || {};
  const overrides = readTwcOverrides();
  const candidateIdentity = identity || getIdentity();
  // D-1 and D-3: an interview line with a recorded interview event is counted only when it was held and
  // has evidence, and it is dated by the day it was held. A line with no recording keeps its old rules
  // (and shows up in the export warning) until its evidence is recorded.
  const records = interviewRecords || safe(readInterviewRecords, new Map());
  const todayYmd = today || localToday();

  // Earliest dashboard-logged "Applied" event per app — the fallback apply date
  // when apply-dates.json has no entry.
  const earliestApplied = new Map();
  for (const e of events) {
    if (e.status !== 'Applied' || !isYmd(e.date)) continue;
    const cur = earliestApplied.get(e.app);
    if (!cur || e.date < cur) earliestApplied.set(e.app, e.date);
  }

  const empFor = (company) => directory[employerKey(company)] || null;
  const webPage = (app, emp) => (app && app.url) || (emp && emp.website) || '';

  // Company → its applications, so an outreach touch can borrow the role the user
  // is seeking there (the TWC "Type of job" column) when it is unambiguous. Left
  // blank when a company has zero or several open applications rather than guessing.
  const appsByCompany = new Map();
  for (const app of apps) {
    const k = normalizeCompany(app.company);
    if (!k) continue;
    if (!appsByCompany.has(k)) appsByCompany.set(k, []);
    appsByCompany.get(k).push(app);
  }
  const roleFor = (company) => {
    const list = appsByCompany.get(normalizeCompany(company)) || [];
    return list.length === 1 ? { role: list[0].role || '', appId: list[0].id } : { role: '', appId: '' };
  };

  // Dedup keys so a correspondence touch that ALSO lives in follow-ups.md (the
  // cross-logged ones) is counted once. Two independent signatures because a
  // follow-up row may match on either: the exact subject line (cross-logged rows
  // store "Subject: …") OR the same contact reached the same day at the same
  // company (catches rows whose notes are the full email body, no "Subject:").
  const loggedSig = new Set();
  const seenFollowupRows = new Set();
  const seenFollowupDays = new Set();
  const seenLinkedInDays = new Set();
  const seenLinkedInIds = new Set();
  const normSub = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const normNm = normalizePerson;
  const subjOf = (notes) => { const m = /subject:\s*(.+)$/i.exec(String(notes || '')); return m ? m[1] : notes; };
  // Keep at most one row per person, company, day, and channel.
  const personDayKey = (date, person, company, channel) => {
    const name = normNm(person);
    if (!name) return '';
    const employer = normalizeCompany(company);
    return `${date}|${employer || 'unknown'}|${name}|${channel}`;
  };
  const claimLinkedIn = (date, person, company, id) => {
    const employer = normalizeCompany(company) || 'unknown';
    const personKey = personDayKey(date, person, company, 'linkedin');
    const idKey = id !== undefined && id !== null && id !== '' ? `${date}|${employer}|${id}|linkedin` : '';
    const duplicate = (personKey && seenLinkedInDays.has(personKey))
      || (idKey && seenLinkedInIds.has(idKey));
    if (personKey) seenLinkedInDays.add(personKey);
    if (idKey) seenLinkedInIds.add(idKey);
    return !duplicate;
  };
  const claimFollowup = (date, person, company, channel, fallback) => {
    const channelKey = String(channel || 'Other').toLowerCase();
    const key = personDayKey(date, person, company, channelKey)
      || `${date}|${normalizeCompany(company) || 'unknown'}|unknown|${channelKey}|${fallback}`;
    if (seenFollowupDays.has(key)) return false;
    seenFollowupDays.add(key);
    return true;
  };

  const activities = [];

  // 1) Applications — one row per app that ever reached Applied (or beyond).
  const voidStatuses = new Set(['Not a Fit', 'SKIP', 'Discarded', 'Closed']);
  const appliedEventIndex = new Map();
  const sameDayVoids = new Set();
  events.forEach((e, index) => {
    const eventKey = `${e.app}|${e.date}`;
    if (e.status === 'Applied') appliedEventIndex.set(eventKey, index);
    else if (voidStatuses.has(e.status) && appliedEventIndex.has(eventKey)
      && appliedEventIndex.get(eventKey) < index) sameDayVoids.add(String(e.app));
  });

  const applicationCandidates = [];
  apps.forEach((app, index) => {
    const override = overrides.applications[String(app.id)] || {};
    if (override.include === false) return;
    if (override.include !== true && !appReached(app, 'Applied')) return;
    if (override.include !== true && sameDayVoids.has(String(app.id))) return;
    const raw = applyDates[String(app.id)];
    const applyDate = typeof raw === 'string' ? raw : (raw && raw.date);
    let date = null, approx = false;
    if (isYmd(override.date)) date = override.date;
    else if (isYmd(applyDate)) date = applyDate;
    else if (earliestApplied.has(String(app.id))) date = earliestApplied.get(String(app.id));
    else if (isYmd(app.date)) { date = app.date; approx = true; } // tracker Date = eval date
    if (!date) return;
    applicationCandidates.push({ app, date, approx, override, index });
  });

  const seenPostings = new Set();
  applicationCandidates.sort((a, b) => a.date.localeCompare(b.date) || a.index - b.index);
  for (const candidate of applicationCandidates) {
    const { app, date, approx, override } = candidate;
    const posting = canonicalUrl(app.url);
    const company = normalizeCompany(app.company);
    const postingKey = company && isPostingSpecificCanonical(posting) ? `${company}|${posting}` : '';
    if (postingKey && seenPostings.has(postingKey)) continue;
    if (postingKey) seenPostings.add(postingKey);
    const emp = empFor(app.company);
    activities.push({
      kind: 'application',
      date, week: twcWeekStart(date), dateApprox: approx,
      activity: 'Applied online for a job',
      role: app.role || '', company: app.company || '',
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: webPage(app, emp),
      employerPhone: (emp && emp.phone) || '',
      contact: '', method: 'Online application',
      result: resultForStatus(app.status),
      note: joinNotes(
        approx ? 'Apply date estimated from the evaluation date' : '',
        override.note,
        applicationDetailNote(app.status),
      ),
      appId: app.id,
    });
  }

  const debriefDates = new Map();
  for (const [appId, notes] of Object.entries(appNotes)) {
    for (const entry of (Array.isArray(notes) ? notes : [])) {
      const text = String((entry && entry.text) || '');
      const re = /^###\s+Debrief:\s*(.+?)\s*\((\d{4}-\d{2}-\d{2})\)\s*$/gmi;
      let match;
      while ((match = re.exec(text))) {
        if (!isYmd(match[2])) continue;
        const key = `${appId}|${normalizeStage(match[1])}`;
        if (!debriefDates.has(key)) debriefDates.set(key, match[2]);
      }
    }
  }

  const interviewOverrides = new Map();
  for (const item of overrides.interviews) {
    if (!item || !isYmd(item.date) || !item.stage || item.appId === undefined || item.appId === null) continue;
    interviewOverrides.set(`${item.appId}|${normalizeStage(item.stage)}`, item);
  }
  const emittedInterviews = new Set();
  const addInterview = ({ appId, stage, event, override }) => {
    const key = `${appId}|${normalizeStage(stage)}`;
    if (emittedInterviews.has(key)) return;
    const app = byId.get(String(appId));
    const record = records.get(interviewKey(appId, stage));
    if (record) {
      emittedInterviews.add(key);
      const state = interviewState(record, todayYmd);
      if (state.state !== 'counted') return;
      const company = (app && app.company) || (event && event.company) || '';
      const emp = empFor(company);
      activities.push({
        kind: 'interview',
        date: record.held_on, week: twcWeekStart(record.held_on), dateApprox: false,
        activity: `Interview: ${stage}`,
        role: (app && app.role) || '', company,
        employerAddress: (emp && emp.hqAddress) || '',
        employerWebPage: webPage(app, emp),
        employerPhone: (emp && emp.phone) || '',
        contact: '', method: '', result: 'Interviewed',
        note: 'Interview held, with evidence on record',
        appId,
        evidenced: true,
        evidenceRefs: record.evidence.map((item) => item.ref).filter(Boolean),
      });
      return;
    }
    const debriefDate = debriefDates.get(key);
    const date = override ? override.date : (debriefDate || (event && event.date));
    if (!isYmd(date)) return;
    const company = (app && app.company) || (event && event.company) || '';
    emittedInterviews.add(key);
    const emp = empFor(company);
    const dateSource = override
      ? 'Interview date set by override'
      : debriefDate
        ? 'Interview date from debrief note'
        : 'Interview date is when the status changed';
    activities.push({
      kind: 'interview',
      date, week: twcWeekStart(date), dateApprox: false,
      activity: `Interview: ${stage}`,
      role: (app && app.role) || '', company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: webPage(app, emp),
      employerPhone: (emp && emp.phone) || '',
      contact: '', method: '', result: 'Interviewed',
      note: joinNotes(dateSource, override && override.note),
      appId,
      evidenced: false,
    });
  };

  // 2) Interviews, preferring overrides and debrief dates over status dates.
  for (const e of events) {
    if (!isInterviewStage(e.status) || !isYmd(e.date)) continue;
    const key = `${e.app}|${normalizeStage(e.status)}`;
    addInterview({ appId: e.app, stage: e.status, event: e, override: interviewOverrides.get(key) });
  }
  for (const override of interviewOverrides.values()) {
    addInterview({ appId: override.appId, stage: override.stage, override });
  }
  // A recorded interview line with no status change or override behind it still counts once held.
  for (const record of records.values()) {
    addInterview({ appId: record.application_id, stage: record.stage });
  }

  // 3) Follow-ups from follow-ups.md — one row per dated touch. This is the only
  // source that carries a named contact + method; online applications leave both
  // blank. Each row also seeds the dedup index so the correspondence sweep below
  // does not re-add a touch that was cross-logged here.
  for (const f of followups) {
    if (!isYmd(f.date)) continue;
    if (/^backfill\b/i.test(String(f.notes || '').trim())) continue;
    const exact = [f.date, f.appNum, f.company, f.role, f.channel, f.contact, f.notes]
      .map(normSub).join('|');
    if (seenFollowupRows.has(exact)) continue;
    seenFollowupRows.add(exact);
    const app = byId.get(String(f.appNum));
    const company = f.company || (app && app.company) || '';
    if (isSelfActivity(f.contact, candidateIdentity)) continue;
    const co = normalizeCompany(company);
    const subject = subjOf(f.notes);
    const linkedin = isLinkedInEntry({ channel: f.channel, subject });
    const request = linkedin && isLinkedInInvite(subject);
    const channel = String(f.channel || '').trim() || 'Other';
    const claimed = linkedin
      ? claimLinkedIn(f.date, f.contact, company, null)
      : claimFollowup(f.date, f.contact, company, channel, `${co}|${normSub(subject)}`);
    if (!claimed) continue;
    loggedSig.add(`s|${f.date}|${co}|${normSub(subject)}`);
    if ((f.contact || '').trim()) loggedSig.add(`c|${f.date}|${co}|${normNm(f.contact)}`);
    const emp = empFor(company);
    activities.push({
      kind: linkedin ? 'outreach' : 'followup',
      date: f.date, week: twcWeekStart(f.date), dateApprox: false,
      activity: linkedin
        ? (request ? 'Networking, LinkedIn connection request' : 'LinkedIn message')
        : `Follow-up (${channel})`,
      role: f.role || (app && app.role) || '', company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: webPage(app, emp),
      employerPhone: (emp && emp.phone) || '',
      contact: f.contact || '', method: linkedin ? 'LinkedIn' : channel,
      result: 'Other',
      note: request ? 'Sent connection request' : linkedin ? 'Sent LinkedIn message' : 'Sent follow-up',
      appId: f.appNum,
    });
  }

  // 4) Outreach straight from the correspondence logs (target-talent + referrals).
  // Every Sent message is a dated employer contact: an email follow-up, or a
  // LinkedIn connection request (networking). Deduped against the follow-ups.md
  // rows above so a cross-logged touch is not double-counted. This is what makes
  // the report reflect ALL outreach automatically, no manual cross-log required.
  //
  // The target-talent rows are parsed once here and reused for the referral-twin
  // check and the section-5 ledger join. Referrals are folded in as a second book,
  // but ONLY the unlinked ones: a referral with a TA/recruiter twin shares (and logs
  // to) the twin's correspondence dir, so it is already swept via the TA book above;
  // reading it again here would double-count it. Each book adapts its own row shape
  // (TA has first/last + a shared-namespace id; a referral has a single name and an
  // id from a DIFFERENT namespace, so it must not seed the ledger's id-based dedup).
  const taRows = safe(parseTargetTalentMd, []) || [];
  const unlinkedReferrals = (safe(parseReferralsMd, []) || [])
    .filter(r => !resolveReferralLink(r, taRows));
  const books = [
    { rows: taRows, read: readTTCorrespondence,
      companyOf: (r) => r.company, contactOf: (r) => `${r.first || ''} ${r.last || ''}`.trim(), idOf: (r) => r.id },
    { rows: unlinkedReferrals, read: readReferralCorrespondence,
      companyOf: (r) => r.where, contactOf: (r) => r.name || '', idOf: () => null },
  ];
  for (const book of books) {
    for (const c of book.rows) {
      let msgs = [];
      try { msgs = book.read(c.id) || []; } catch { msgs = []; }
      for (const msg of msgs) {
        if (msg.direction !== 'Sent') continue;
        const date = String(msg.timestamp || '').slice(0, 10);
        if (!isYmd(date)) continue;
        const company = book.companyOf(c) || '';
        const co = normalizeCompany(company);
        const subject = msg.subject || '';
        const contactName = book.contactOf(c);
        if (isSelfActivity(contactName, candidateIdentity)
          || isSelfActivity(c.email || '', candidateIdentity)) continue;
        const linkedin = isLinkedInEntry(msg);
        const channel = String(msg.channel || '').trim() || 'Email';
        const claimed = linkedin
          ? claimLinkedIn(date, contactName, company, book.idOf(c))
          : claimFollowup(date, contactName, company, channel, `${co}|${normSub(subject)}`);
        if (!claimed) continue;
        // Already captured as a follow-ups.md row?
        if (loggedSig.has(`s|${date}|${co}|${normSub(subject)}`)) continue;
        if (contactName && loggedSig.has(`c|${date}|${co}|${normNm(contactName)}`)) continue;
        // Guard against the same Sent message being read twice.
        const selfSig = `x|${date}|${co}|${normNm(contactName)}|${normSub(subject)}`;
        if (loggedSig.has(selfSig)) continue;
        loggedSig.add(selfSig);

        const request = linkedin && isLinkedInInvite(subject);
        const emp = empFor(company);
        const { role, appId } = roleFor(company);
        activities.push({
          kind: linkedin ? 'outreach' : 'followup',
          date, week: twcWeekStart(date), dateApprox: false,
          activity: linkedin
            ? (request ? 'Networking, LinkedIn connection request' : 'LinkedIn message')
            : `Follow-up (${channel})`,
          role, company,
          employerAddress: (emp && emp.hqAddress) || '',
          employerWebPage: (emp && emp.website) || '',
          employerPhone: (emp && emp.phone) || '',
          contact: contactName, method: linkedin ? 'LinkedIn' : channel,
          result: 'Other',
          note: request ? 'Sent connection request' : linkedin ? 'Sent LinkedIn message' : 'Sent follow-up',
          appId, contactId: book.idOf(c),
        });
      }
    }
  }

  // 5) LinkedIn connection requests straight from the authoritative connects
  // ledger (data/linkedin-connects.json, written by lib/connects.mjs logConnect).
  // Section 4 only sees connects that were ALSO written to a correspondence log;
  // the manual "log a connect" button and any bulk/legacy import write ONLY the
  // ledger, so without this every such invite is invisible here while
  // weekly-collect.mjs already counts it (that mismatch is the bug this fixes).
  //
  // Identity is the contact id, not the name: logConnect now records the id of the
  // contact the invite went to, so a ledger connect dedups EXACTLY against the
  // section-4 connect for the same (date, contact id). Name is the fallback key for
  // legacy rows logged before id capture (until `node backfill-connect-ids.mjs`
  // stamps their ids). Employer is recovered by id → target-talent company (name as
  // the fallback), so these rows carry the same Employer/Type columns as the rest.
  // taRows was parsed once in section 4 and is reused here.
  const taById = new Map();
  const taByName = new Map();
  for (const c of taRows) {
    if (c.id !== undefined && c.id !== null) taById.set(String(c.id), c.company || '');
    const k = normNm(`${c.first || ''} ${c.last || ''}`);
    if (k && !taByName.has(k)) taByName.set(k, c.company || '');
  }
  for (const e of (safe(readConnects, null) || [])) {
    const date = String((e && e.date) || '').slice(0, 10);
    if (!isYmd(date)) continue;
    const hasId = e.id !== undefined && e.id !== null && e.id !== '';
    const nm = normNm(e.name);
    const company = (hasId && taById.get(String(e.id))) || taByName.get(nm) || '';
    if (isSelfActivity(e.name, candidateIdentity)) continue;
    if (!claimLinkedIn(date, e.name, company, hasId ? e.id : null)) continue;
    const emp = company ? empFor(company) : null;
    const { role, appId } = company ? roleFor(company) : { role: '', appId: '' };
    activities.push({
      kind: 'outreach',
      date, week: twcWeekStart(date), dateApprox: false,
      activity: 'Networking, LinkedIn connection request',
      role, company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: (emp && emp.website) || '',
      employerPhone: (emp && emp.phone) || '',
      contact: e.name || '', method: 'LinkedIn',
      result: 'Other', note: 'Sent connection request',
      appId, contactId: hasId ? e.id : null,
    });
  }

  // 6) Manually logged activities that do not exist in the application and
  // outreach ledgers, such as job clubs, workshops, and job fairs.
  for (const event of (safe(readEvents, []) || [])) {
    if (!event || !isYmd(event.date) || !TWC_EVENT_TYPES.includes(event.type)
      || !TWC_EVENT_METHODS.includes(event.method)) continue;
    const company = String(event.organizer || '').trim();
    const emp = company ? empFor(company) : null;
    activities.push({
      kind: 'event',
      date: event.date, week: twcWeekStart(event.date), dateApprox: false,
      activity: event.type,
      role: '', company,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: (emp && emp.website) || '',
      employerPhone: (emp && emp.phone) || '',
      contact: String(event.contact || '').trim(), method: event.method,
      result: 'Other', note: String(event.notes || '').trim(),
      eventId: event.id,
    });
  }

  // Corrections leave source data untouched. Exclusions remove only the exact
  // kind, date, and normalized contact, plus company when one is supplied.
  let overrideWarnings = 0;
  const exclusions = [];
  for (const value of overrides.exclude) {
    const parsed = validExcludeOverride(value);
    if (parsed) exclusions.push(parsed);
    else overrideWarnings += 1;
  }
  let corrected = activities.filter(activity => !exclusions.some(exclude =>
    activity.kind === exclude.kind
    && activity.date === exclude.date
    && normalizePerson(activity.contact) === normalizePerson(exclude.contact)
    && (!exclude.company || normalizeCompany(activity.company) === normalizeCompany(exclude.company))));

  // Added corrections dedupe against both source rows and earlier valid adds.
  const overrideKey = (activity) => {
    const role = ['application', 'interview'].includes(activity.kind) ? normSub(activity.role) : '';
    return [activity.kind, activity.date, normalizeCompany(activity.company),
      normalizePerson(activity.contact), role].join('|');
  };
  const overrideKeys = new Set(corrected.map(overrideKey));
  for (const value of overrides.add) {
    const parsed = validAddOverride(value);
    if (!parsed) {
      overrideWarnings += 1;
      continue;
    }
    const key = overrideKey(parsed);
    if (overrideKeys.has(key)) continue;
    overrideKeys.add(key);
    const emp = parsed.company ? empFor(parsed.company) : null;
    corrected.push({
      ...parsed,
      week: twcWeekStart(parsed.date),
      dateApprox: false,
      employerAddress: (emp && emp.hqAddress) || '',
      employerWebPage: (emp && emp.website) || '',
      employerPhone: (emp && emp.phone) || '',
    });
  }

  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const result = corrected
    .filter(a => a.date && inRange(a.date))
    .map(a => ({
      ...a,
      activity: cleanTwcText(a.activity),
      result: cleanTwcText(a.result),
      note: cleanTwcText(a.note),
    }))
    .sort((a, b) => a.date.localeCompare(b.date)
      || (a.company || '').localeCompare(b.company || '')
      || a.kind.localeCompare(b.kind));
  result.overrideWarnings = overrideWarnings;
  return result;
}

// Per benefit-week activity counts, so the UI can show whether a week hit the
// required minimum. Each week also carries a per-kind breakdown (byKind) so the
// dashboard can show WHAT made up the week — applications vs LinkedIn networking
// vs follow-ups vs interviews — not just the total. `count` is retained (it is
// the sum of byKind) so an older client keeps working. Sorted by week ascending.
/**
 * D-11: the interview lines the export gate looks at. Every recorded line, plus every line the Work Search
 * log still takes from the old rules (no recorded event), shaped as an interview record: a past line with
 * no evidence, a future line scheduled.
 */
export function interviewGateLines(activities, records, today) {
  const lines = [...records.values()];
  const seen = new Set(lines.map((record) => interviewKey(record.application_id, record.stage)));
  for (const activity of activities) {
    if (activity.kind !== 'interview' || activity.evidenced !== false) continue;
    const stage = String(activity.activity || '').replace(/^Interview:\s*/, '');
    if (seen.has(interviewKey(activity.appId, stage))) continue;
    const numeric = Number(activity.appId);
    const id = Number.isInteger(numeric) ? numeric : activity.appId;
    lines.push(activity.date > today
      ? { id, stage, scheduled_for: activity.date, evidence: [] }
      : { id, stage, held_on: activity.date, slot_end: `${activity.date}T23:59:59Z`, evidence: [] });
  }
  return lines;
}

export function weeklyCounts(activities) {
  const map = new Map();
  const zero = () => TWC_KINDS.reduce((o, k) => (o[k] = 0, o), {});
  for (const a of activities) {
    const wk = a.week || 'unknown';
    if (!map.has(wk)) map.set(wk, { count: 0, byKind: zero() });
    const entry = map.get(wk);
    entry.count += 1;
    if (Object.prototype.hasOwnProperty.call(entry.byKind, a.kind)) entry.byKind[a.kind] += 1;
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, { count, byKind }]) => ({ week, count, byKind }));
}

// Distinct employers in a set of activities, each flagged with whether the
// directory already has it. Drives the "look up employer HQ + phone" action:
// only the un-cached ones need a web search.
export function employersInActivities(activities) {
  const seen = new Map();
  for (const a of activities) {
    const key = employerKey(a.company);
    if (!key || seen.has(key)) continue;
    seen.set(key, { company: a.company, cached: hasEmployer(a.company) });
  }
  return [...seen.values()];
}

// Serialize activities to the TWC CSV. Header row first, then one line per
// activity in the same column order.
export function toTwcCsv(activities) {
  const rows = [TWC_CSV_HEADERS.slice()];
  for (const a of activities) {
    rows.push([
      a.week || '', a.date || '', a.activity || '', a.role || '',
      a.company || '', a.employerAddress || '', a.employerWebPage || '', a.employerPhone || '',
      a.contact || '', a.method || '', a.result || '', a.note || '',
    ]);
  }
  return toCsv(rows);
}

// ── Employer HQ enrichment (web search) ─────────────────────────────────────────
// Look up each company's US headquarters mailing address + main phone via the same
// web-search path the TA-discovery step uses (generateText with the hosted
// web_search tool on the API-key path, --allowedTools WebSearch on the Claude-plan
// path; billing mode is honored inside generateText). Results are cached in the
// employer directory, so a report never re-searches a company already resolved.
//
// Scale guards copied from routes/tt-reconcile.mjs discover: bounded concurrency,
// a per-company hard timeout so one stalled search cannot hang the batch, and a
// per-company try/catch so a failure drops that company rather than the whole run.
const ENRICH_CONCURRENCY = 3;
const ENRICH_TIMEOUT_MS = 90000;
export const ENRICH_MAX = 15; // rate-limit protection, same cap as discover

function employerPrompt(company) {
  return `Find the UNITED STATES corporate headquarters mailing address and the main phone number for the company "${company}".

INSTRUCTIONS:
1. USE THE web_search tool. Try queries like:
   - "${company}" corporate headquarters address
   - "${company}" head office phone number
   - "${company}" contact us
2. Prefer the company's own official website or a reputable business directory.
3. Return the US headquarters. If the company is foreign-based with a US office, return the main US office; if it has no US presence, return the global HQ.
4. Put the full street address on one line (street, city, state, ZIP) and the main phone with area code.

Output ONLY this JSON object (your final response after searching), no prose, no markdown:
{ "hqAddress": "123 Main St, Austin, TX 78701", "phone": "(512) 555-0100", "website": "https://example.com" }

If you cannot find a reliable value, leave that field as an empty string. Never fabricate an address or phone number.`;
}

async function lookupEmployer(company) {
  const prompt = employerPrompt(company);
  const apiCall = generateText(prompt, {
    model: draftModel(),
    maxTokens: 1200,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 2, allowed_callers: ['direct'] }],
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`employer lookup timeout after 90s for ${company}`)), ENRICH_TIMEOUT_MS));
  const text = await Promise.race([apiCall, timeout]);
  const m = String(text || '').match(/\{[\s\S]*\}/);
  const obj = m ? (() => { try { return JSON.parse(m[0]); } catch { return {}; } })() : {};
  const hqAddress = String(obj.hqAddress || obj.address || '').trim();
  const phone = String(obj.phone || '').trim();
  const website = String(obj.website || '').trim();
  return { company, hqAddress, phone, website, source: (hqAddress || phone) ? 'web-search' : 'not-found' };
}

/**
 * Enrich (web-search + cache) the given companies. Skips any already cached.
 * Returns { updated: [entries written], errors: [{ company, error }], skipped:[names] }.
 * Caller enforces the ENRICH_MAX cap; this also de-dupes and drops cached names.
 */
export async function enrichEmployers(companies) {
  const wanted = [...new Set((companies || []).map(c => String(c || '').trim()).filter(Boolean))];
  const todo = wanted.filter(c => !hasEmployer(c));
  const skipped = wanted.filter(c => hasEmployer(c));
  const updated = [];
  const errors = [];

  for (let i = 0; i < todo.length; i += ENRICH_CONCURRENCY) {
    const slice = todo.slice(i, i + ENRICH_CONCURRENCY);
    const chunk = await Promise.all(slice.map(async (company) => {
      try { return await lookupEmployer(company); }
      catch (e) { return { company, error: e.message }; }
    }));
    // Write successes (including a searched-but-not-found result, so it is not
    // re-searched next time) in one merge. A thrown error is transient — do NOT
    // cache it, so the user can retry.
    const ok = chunk.filter(r => r && !r.error);
    if (ok.length) mergeEmployers(ok);
    for (const r of chunk) {
      if (r && r.error) errors.push({ company: r.company, error: r.error });
      else if (r) updated.push(r);
    }
  }
  return { updated, errors, skipped };
}
