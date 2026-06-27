import fs from 'fs';
import { SNOOZE_PATH, APPLY_DATES_PATH, STATUS_EVENTS_PATH, MUTE_PATH } from '../config.mjs';

// ─── Follow-up snooze store ───────────────────────────────────────────────────
// Defers a stale follow-up alert without logging a touch. Shape:
//   { app: { "<appNum>": "YYYY-MM-DD" }, ta: { "<contactId>": "YYYY-MM-DD" } }
// A snooze hides the alert until its date passes; it is NOT a touch, so the
// follow-up cadence clock keeps running underneath (when it returns, it still
// reads the true "Xd since last touch"). Separate file → never perturbs the
// applications.md schema or the follow-up touch-log / analytics.
function snoozeToday() { return new Date().toISOString().slice(0, 10); }
function snoozeDateIn(days) { return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10); }

function readSnooze() {
  try {
    const raw = JSON.parse(fs.readFileSync(SNOOZE_PATH, 'utf8'));
    return { app: raw.app || {}, ta: raw.ta || {} };
  } catch { return { app: {}, ta: {} }; }
}
function writeSnooze(snooze) {
  fs.writeFileSync(SNOOZE_PATH, JSON.stringify({ app: snooze.app || {}, ta: snooze.ta || {} }, null, 2) + '\n');
}
// Drop entries whose date has passed so the file stays small and expired
// snoozes naturally re-surface as stale. Returns true if anything was pruned.
function pruneSnooze(snooze) {
  const today = snoozeToday();
  let changed = false;
  for (const kind of ['app', 'ta']) {
    for (const [id, until] of Object.entries(snooze[kind] || {})) {
      if (!until || until <= today) { delete snooze[kind][id]; changed = true; }
    }
  }
  return changed;
}
const SNOOZE_KINDS = new Set(['app', 'ta']);

// ─── Follow-up mute store ─────────────────────────────────────────────────────
// "Done for now / Awaiting reply": indefinitely removes an application from the
// WARM follow-up queue WITHOUT changing its status or logging a touch. Unlike
// snooze (time-based, expires, app+ta), mute is app-only and has no expiry — it
// clears only when the user un-mutes (or the app leaves the tracked statuses).
// This is the honest alternative to closing an opportunity early just to silence
// an alert: the app stays Applied and accurate in analytics, it just stops
// nagging. Shape: { "<appNum>": true }.
function readMute() {
  try { return JSON.parse(fs.readFileSync(MUTE_PATH, 'utf8')) || {}; }
  catch { return {}; }
}
function writeMute(map) {
  fs.writeFileSync(MUTE_PATH, JSON.stringify(map || {}, null, 2) + '\n');
}
function setMute(appNum, on) {
  const map = readMute();
  const key = String(appNum);
  if (on) map[key] = true; else delete map[key];
  writeMute(map);
  return !!map[key];
}
function isMuted(appNum) { return !!readMute()[String(appNum)]; }

// ─── Apply-date store ─────────────────────────────────────────────────────────
// The applications.md Date column is the EVALUATION/scrape date (when the row
// was logged), not the date the user actually applied — those can differ by
// days. Follow-up cadence must count from the apply date, so we record it here
// (appNum -> YYYY-MM-DD) the moment status flips to Applied. Separate file keeps
// the Date column intact for "date logged" analytics (e.g. "added in last 14d").
function readApplyDates() {
  try { return JSON.parse(fs.readFileSync(APPLY_DATES_PATH, 'utf8')) || {}; }
  catch { return {}; }
}
function writeApplyDates(map) {
  fs.writeFileSync(APPLY_DATES_PATH, JSON.stringify(map, null, 2) + '\n');
}
// Record today as the apply date for an app the first time it goes Applied.
// Never overwrites an existing date (the first apply is the cadence anchor).
function recordApplyDate(appNum) {
  const map = readApplyDates();
  const key = String(appNum);
  if (map[key]) return map[key];
  map[key] = snoozeToday();
  writeApplyDates(map);
  return map[key];
}
// ── Status event sidecar ──────────────────────────────────────────────────
// Append-only TSV log of every dashboard-driven status change, kept OUT of
// applications.md (which stays a fixed 10-column table). Columns:
//   app#  date(YYYY-MM-DD)  status  company
// Enables time-in-stage analytics (e.g. days-to-rejection) that the single
// Date column in applications.md can't express. Only dashboard PATCHes are
// captured, so the metric fills in over time.
function logStatusEvent(appNum, status, { company = '' } = {}) {
  try {
    const clean = (s) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim();
    const row = `${clean(appNum)}\t${snoozeToday()}\t${clean(status)}\t${clean(company)}\n`;
    if (!fs.existsSync(STATUS_EVENTS_PATH)) {
      fs.writeFileSync(STATUS_EVENTS_PATH, 'app#\tdate\tstatus\tcompany\n' + row);
    } else {
      fs.appendFileSync(STATUS_EVENTS_PATH, row);
    }
  } catch (e) {
    console.warn('[status-events] failed to log:', e.message);
  }
}

function parseStatusEvents() {
  try {
    if (!fs.existsSync(STATUS_EVENTS_PATH)) return [];
    const out = [];
    for (const line of fs.readFileSync(STATUS_EVENTS_PATH, 'utf8').split('\n')) {
      if (!line.trim() || line.startsWith('app#')) continue;
      const [app, date, status, company = ''] = line.split('\t');
      if (!app || !date) continue;
      out.push({ app: app.trim(), date: date.trim(), status: (status || '').trim(), company: company.trim() });
    }
    return out;
  } catch {
    return [];
  }
}

export {
  snoozeToday, snoozeDateIn,
  readSnooze, writeSnooze, pruneSnooze, SNOOZE_KINDS,
  readMute, writeMute, setMute, isMuted,
  readApplyDates, writeApplyDates, recordApplyDate,
  logStatusEvent, parseStatusEvents,
};

