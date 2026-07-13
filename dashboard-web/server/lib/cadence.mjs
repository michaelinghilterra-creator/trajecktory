import fs from 'fs';
import { randomBytes } from 'crypto';
import { CADENCE_PATH, CADENCE_LOG_PATH } from '../config.mjs';

// ── Weekly cadence (habit) template + per-day completion log ──────────────────
// Two JSON sidecars under data/, mirroring apply-dates.json / app-notes.json so
// nothing here perturbs applications.md or its analytics.
//
//   data/cadence.json      the weekly TEMPLATE (definition, edited in the UI):
//     { version, tasks: [ { id, label, days:[1..7], start:"HH:MM",
//                           durationMin, pomodoros, notes, order, archived } ] }
//     days use Mon=1 … Sun=7 (convert JS getDay() via `getDay() || 7`).
//
//   data/cadence-log.json  per-day completion, keyed date → taskId:
//     { "YYYY-MM-DD": { "<taskId>": { done, pomodorosDone, completedAt } } }
//
// Dates and day-of-week are computed in LOCAL time. The server runs on the
// user's own machine (localhost), so local time is their time — a daily habit
// tracker must not flip "today" at UTC midnight (that's mid-evening in the US).

// ── Local-time date helpers ───────────────────────────────────────────────────
function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function localToday() { return ymd(new Date()); }
// Mon=1 … Sun=7 (JS getDay() is Sun=0 … Sat=6).
function dowOf(d) { return d.getDay() || 7; }

function newTaskId() { return 't_' + randomBytes(4).toString('hex'); }

// Starter template returned when data/cadence.json does not exist yet. NOT
// written to disk until the user first saves (same read-with-default instinct as
// the follow-up sidecars — never write user data uninvited). The task ids are
// FIXED (not random) so completions toggled before the first save still match
// after it. Mirrors the user's stated shape (a Mon/Wed/Fri group + a Tue/Thu
// group) so they rename rather than build from scratch.
function starterTemplate() {
  return {
    version: 1,
    tasks: [
      { id: 't_seed_deepwork', label: 'Deep work block',        days: [1, 3, 5], start: '09:00', durationMin: 50, pomodoros: 2, notes: '', order: 0, archived: false },
      { id: 't_seed_outreach', label: 'Applications & outreach', days: [1, 3, 5], start: '11:00', durationMin: 50, pomodoros: 2, notes: '', order: 1, archived: false },
      { id: 't_seed_network',  label: 'Networking / LinkedIn',   days: [2, 4],    start: '10:00', durationMin: 25, pomodoros: 1, notes: '', order: 0, archived: false },
      { id: 't_seed_skill',    label: 'Skill building',          days: [2, 4],    start: '14:00', durationMin: 50, pomodoros: 2, notes: '', order: 1, archived: false },
    ],
  };
}

function readTemplate() {
  try {
    const raw = JSON.parse(fs.readFileSync(CADENCE_PATH, 'utf8'));
    return { version: raw.version || 1, tasks: Array.isArray(raw.tasks) ? raw.tasks : [] };
  } catch { return starterTemplate(); }
}
function writeTemplate(tpl) {
  fs.writeFileSync(CADENCE_PATH, JSON.stringify({ version: 1, tasks: tpl.tasks || [] }, null, 2) + '\n');
}

// Normalize + persist an incoming task array (editor save). Assigns ids to new
// rows, clamps/typecasts fields, drops blank-labeled rows, and keeps a stable
// order index. Returns the saved template.
function saveTemplate(tasks) {
  const clean = (Array.isArray(tasks) ? tasks : [])
    .map((t, i) => {
      const label = String(t.label == null ? '' : t.label).trim();
      const days = Array.isArray(t.days)
        ? [...new Set(t.days.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 7))].sort()
        : [];
      const start = /^\d{2}:\d{2}$/.test(t.start) ? t.start : '09:00';
      const durationMin = Math.max(1, Math.min(240, parseInt(t.durationMin, 10) || 25));
      const pomodoros = Math.max(0, Math.min(12, parseInt(t.pomodoros, 10) || 0));
      return {
        id: t.id && String(t.id).startsWith('t_') ? String(t.id) : newTaskId(),
        label,
        days,
        start,
        durationMin,
        pomodoros,
        notes: String(t.notes == null ? '' : t.notes).trim(),
        // Renumber by incoming array position so `order` is the authoritative
        // manual arrangement from the editor (what drag-and-drop produces). The
        // Today view sorts by this, so the day's blocks follow the user's order.
        order: i,
        archived: !!t.archived,
      };
    })
    .filter(t => t.label); // a row with no label is a discarded draft
  const tpl = { version: 1, tasks: clean };
  writeTemplate(tpl);
  return tpl;
}

function readLog() {
  try { return JSON.parse(fs.readFileSync(CADENCE_LOG_PATH, 'utf8')) || {}; }
  catch { return {}; }
}
function writeLog(log) {
  fs.writeFileSync(CADENCE_LOG_PATH, JSON.stringify(log || {}, null, 2) + '\n');
}

// Sort key for a day's tasks: by the user's manual order (from the Schedule
// editor / drag-and-drop), with start time as a tiebreak. This makes the Today
// view follow the order the user arranged rather than clock order.
function byOrderThenStart(a, b) {
  const ao = Number.isFinite(a.order) ? a.order : 0;
  const bo = Number.isFinite(b.order) ? b.order : 0;
  if (ao !== bo) return ao - bo;
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  return 0;
}

// Tasks scheduled for a given day-of-week (Mon=1…Sun=7), archived excluded.
function scheduledForDow(template, dow) {
  return (template.tasks || [])
    .filter(t => !t.archived && Array.isArray(t.days) && t.days.includes(dow))
    .sort(byOrderThenStart);
}

// Today's tasks joined with today's completion state.
function deriveToday(date = localToday()) {
  const template = readTemplate();
  const log = readLog();
  const dow = dowOf(new Date(date + 'T00:00:00'));
  const dayLog = log[date] || {};
  return scheduledForDow(template, dow).map(t => {
    const entry = dayLog[t.id] || {};
    return { ...t, done: !!entry.done, pomodorosDone: entry.pomodorosDone || 0 };
  });
}

// Object keys that could climb the prototype chain if they arrived from a
// crafted request. taskId comes straight off the API body, and `log[date][taskId]`
// would otherwise let a "__proto__" value resolve to Object.prototype.
const UNSAFE_KEY = new Set(['__proto__', 'constructor', 'prototype']);

// Toggle completion / bump the pomodoro count for one task on one date.
// Partial: pass `done` and/or `pomodorosDone`. Returns the day's log entries.
function logTask(taskId, { done, pomodorosDone, date = localToday() } = {}) {
  if (!taskId) throw new Error('taskId is required');
  if (UNSAFE_KEY.has(taskId)) throw new Error('invalid taskId');
  const log = readLog();
  const day = log[date] || (log[date] = {});
  // Read prior state via an own-property check (never an inherited member like
  // toString), then build a FRESH object literal to write into. Writing the
  // completion fields onto a brand-new object — not one obtained by indexing with
  // the user-controlled taskId — makes prototype pollution structurally
  // impossible (js/prototype-polluting-assignment).
  const prior = Object.prototype.hasOwnProperty.call(day, taskId) ? day[taskId] : null;
  const entry = {
    done: false, pomodorosDone: 0, completedAt: null,
    ...(prior && typeof prior === 'object' ? prior : {}),
  };
  if (done !== undefined) {
    entry.done = !!done;
    entry.completedAt = entry.done ? new Date().toISOString() : null;
  }
  if (pomodorosDone !== undefined) {
    entry.pomodorosDone = Math.max(0, parseInt(pomodorosDone, 10) || 0);
  }
  day[taskId] = entry;
  writeLog(log);
  return day;
}

// Consistency stats. A scheduled day "counts" only when EVERY task scheduled for
// that day-of-week is done. Rest days (nothing scheduled) are skipped — they
// neither break nor extend a streak. Today is forgiving: if it isn't fully done
// yet it's treated as in-progress (skipped) rather than breaking the streak.
function computeStreak() {
  const template = readTemplate();
  const log = readLog();
  const todayStr = localToday();
  const WINDOW = 180;

  // Classify each of the last WINDOW days: 'rest' | 'complete' | 'incomplete'.
  // Walk newest → oldest so `current` can stop at the first real break.
  const seq = []; // oldest-first, for `best`
  let current = 0;
  let brokeCurrent = false;
  const cur = new Date(); cur.setHours(0, 0, 0, 0);
  for (let i = 0; i < WINDOW; i++) {
    const dstr = ymd(cur);
    const dow = dowOf(cur);
    const scheduled = scheduledForDow(template, dow);
    let kind;
    if (scheduled.length === 0) {
      kind = 'rest';
    } else {
      const dayLog = log[dstr] || {};
      const doneCount = scheduled.filter(t => dayLog[t.id] && dayLog[t.id].done).length;
      kind = doneCount === scheduled.length ? 'complete' : 'incomplete';
    }
    if (!brokeCurrent) {
      if (kind === 'complete') current += 1;
      else if (kind === 'incomplete') {
        if (dstr === todayStr) { /* in progress — don't break */ }
        else brokeCurrent = true;
      }
      // rest days are skipped either way
    }
    seq.push(kind);
    cur.setDate(cur.getDate() - 1);
  }

  // Longest run of consecutive 'complete' days (rest skipped, incomplete resets).
  let best = 0, run = 0;
  for (let i = seq.length - 1; i >= 0; i--) {
    const k = seq[i];
    if (k === 'complete') { run += 1; best = Math.max(best, run); }
    else if (k === 'incomplete') { run = 0; }
    // rest: leave run as-is
  }
  best = Math.max(best, current);

  // Last 7 calendar days (oldest → newest) as completion percentages.
  const last7 = [];
  const d7 = new Date(); d7.setHours(0, 0, 0, 0); d7.setDate(d7.getDate() - 6);
  for (let i = 0; i < 7; i++) {
    const dstr = ymd(d7);
    const scheduled = scheduledForDow(template, dowOf(d7));
    if (scheduled.length === 0) {
      last7.push({ date: dstr, pct: null, rest: true });
    } else {
      const dayLog = log[dstr] || {};
      const doneCount = scheduled.filter(t => dayLog[t.id] && dayLog[t.id].done).length;
      last7.push({ date: dstr, pct: Math.round((doneCount / scheduled.length) * 100), rest: false });
    }
    d7.setDate(d7.getDate() + 1);
  }

  return { current, best, last7 };
}

export {
  readTemplate, writeTemplate, saveTemplate,
  readLog, writeLog, logTask,
  deriveToday, computeStreak,
  localToday, dowOf, newTaskId, starterTemplate,
};
