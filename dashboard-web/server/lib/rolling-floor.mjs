/**
 * lib/rolling-floor.mjs — the rolling outreach floor for the build cap (v1).
 *
 * Replaces the calendar-week floor's two weaknesses (end-loadable, and a deadline
 * on the last day that resets Monday with no bite) with a LIVE, rolling gate:
 *
 *   Building is unlocked when your verified touches over the trailing 7 calendar
 *   days (days off excluded) are at or above the floor F.
 *
 * There is no week boundary, so a shortfall follows you day to day (carryover for
 * free) and there is no Monday amnesty to game. Two rules keep it life-aware:
 *
 *   - Every day counts as a calendar day (Definitions v1 section 2: no business day
 *     clocks). A day you mark PTO never demands anything: it is skipped, so the
 *     window reaches one day further back for each one.
 *   - Credit counts on ANY day. A touch sent on a day off still counts.
 *
 * A once-a-month, logged RESET starts a short grace period so someone far behind
 * can dig out without being stuck. It never lowers the floor and never fakes a
 * touch count — it transparently pauses the gate for a few working days.
 *
 * The compute half is pure and unit-tested (tests/rolling-floor.test.mjs); the IO
 * half gathers day-stamped Sent touches (same definition as the weekly
 * verifiedTouches floor) and reads/writes data/build-floor.json.
 *
 * Phase 2 (not here): a capped escalating debt on top of F. Ship rolling first.
 */
import fs from 'fs';
import { BUILD_FLOOR_PATH } from '../config.mjs';
import { FLOORS } from './review-thresholds.mjs';
import { parseTargetTalentMd, readTTCorrespondence } from './target-talent.mjs';

export const WINDOW_DAYS = 7;
export const GRACE_DAYS = 3;

// ── local-date helpers (all math in the user's local day, like the rest of the app) ──
function toYmd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function nowYmd(now) { return typeof now === 'string' ? now : toYmd(now || new Date()); }

// The most recent `n` days at or before today, oldest→today, skipping days marked
// PTO. `guard` bounds the lookback so a pathological PTO run can never loop forever.
function trailingDays(todayYmd, ptoSet, n) {
  const out = []; const d = fromYmd(todayYmd); let guard = 0;
  while (out.length < n && guard++ < 400) {
    const s = toYmd(d);
    if (!ptoSet.has(s)) out.push(s);
    d.setDate(d.getDate() - 1);
  }
  return out.reverse();
}

// The date `n` days AFTER startYmd (skipping PTO). Used for the reset grace window's end.
function addDays(startYmd, n, ptoSet) {
  const d = fromYmd(startYmd); let added = 0, guard = 0;
  while (added < n && guard++ < 400) {
    d.setDate(d.getDate() + 1);
    if (!ptoSet.has(toYmd(d))) added++;
  }
  return toYmd(d);
}

// Inclusive count of days (not marked PTO) in [aYmd, bYmd].
function daysBetween(aYmd, bYmd, ptoSet) {
  const d = fromYmd(aYmd); const end = fromYmd(bYmd); let c = 0, guard = 0;
  while (d <= end && guard++ < 4000) { if (!ptoSet.has(toYmd(d))) c++; d.setDate(d.getDate() + 1); }
  return c;
}

/**
 * Pure: given the raw inputs, produce the full floor status. `now` may be a Date
 * or a YYYY-MM-DD string (the tests pin a date). `touchDates` is a flat list of
 * YYYY-MM-DD strings, one per verified Sent touch.
 */
export function computeRollingFloor({ now, touchDates = [], pto = [], resets = [], floor, windowDays = WINDOW_DAYS, graceDays = GRACE_DAYS } = {}) {
  const F = Number.isFinite(floor) ? floor : (FLOORS.verifiedTouches?.min ?? 13);
  const today = nowYmd(now);
  const ptoSet = new Set(pto);
  const windowDaysList = trailingDays(today, ptoSet, windowDays);
  const windowStart = windowDaysList[0] || today;

  // Credit: every touch in [windowStart, today], inclusive of any PTO day inside
  // that span (credit counts on any day).
  const trailingCount = touchDates.filter(d => d >= windowStart && d <= today).length;
  const met = trailingCount >= F;

  // Grace from the most recent reset: today is covered from the reset day through
  // `graceDays` days after it.
  const sortedResets = resets.slice().sort();
  const lastReset = sortedResets.length ? sortedResets[sortedResets.length - 1] : null;
  let inGrace = false, graceUntil = null;
  if (lastReset && today >= lastReset) {
    graceUntil = addDays(lastReset, graceDays, ptoSet);
    inGrace = today <= graceUntil;
  }

  // Resolve the gate. `met` wins regardless of how new the account is (meeting the
  // floor is the happy state, full stop). Otherwise ramp-in protects a brand-new
  // user with fewer than a full window of history from being locked
  // (mirrors the review's "missing data is never a fail"); then the reset grace;
  // then, only for an established user still short, the lock.
  let state, unlocked;
  if (touchDates.length === 0) {
    state = 'no-data'; unlocked = true;
  } else if (met) {
    state = 'met'; unlocked = true;
  } else {
    const earliest = touchDates.slice().sort()[0];
    const elapsed = daysBetween(earliest, today, ptoSet);
    if (elapsed < windowDays) { state = 'ramp-in'; unlocked = true; }
    else if (inGrace) { state = 'grace'; unlocked = true; }
    else { state = 'behind'; unlocked = false; }
  }

  const monthKey = today.slice(0, 7);
  const usedThisMonth = resets.some(r => String(r).slice(0, 7) === monthKey);

  // Per-day touch counts across the window (for the UI's day strip). PTO days are not
  // in the strip, so it can sum to less than trailingCount when a touch fell on one.
  const perDay = windowDaysList.map(day => ({ day, count: touchDates.filter(d => d === day).length }));

  return {
    floor: F, windowDays, graceDays,
    today, windowStart, window: windowDaysList, perDay,
    trailingCount, met, gap: Math.max(0, F - trailingCount),
    state, unlocked,
    inGrace, graceUntil,
    reset: { availableThisMonth: !usedThisMonth, lastReset, monthKey },
    pto: pto.slice().sort(),
  };
}

// ── IO ────────────────────────────────────────────────────────────────────────
export function readFloorState() {
  try {
    const j = JSON.parse(fs.readFileSync(BUILD_FLOOR_PATH, 'utf8'));
    return { pto: Array.isArray(j.pto) ? j.pto : [], resets: Array.isArray(j.resets) ? j.resets : [] };
  } catch { return { pto: [], resets: [] }; }
}

export function writeFloorState(s) {
  fs.writeFileSync(BUILD_FLOOR_PATH, JSON.stringify({ pto: s.pto || [], resets: s.resets || [] }, null, 2) + '\n');
}

// Every dated Sent touch across the TA + recruiter books — the same set the weekly
// verifiedTouches floor counts, so the two floors can never disagree on what a
// touch is.
export function gatherSentTouchDates() {
  const dates = [];
  const add = (msgs) => { for (const m of (msgs || [])) if (m.direction === 'Sent' && m.timestamp) dates.push(String(m.timestamp).slice(0, 10)); };
  try { for (const c of parseTargetTalentMd()) add(readTTCorrespondence(c.id)); } catch { /* apps-only env */ }
  return dates;
}

export function floorStatus(now = new Date()) {
  const st = readFloorState();
  return computeRollingFloor({ now, touchDates: gatherSentTouchDates(), pto: st.pto, resets: st.resets });
}

export function togglePto(date, on, now = new Date()) {
  const st = readFloorState();
  const set = new Set(st.pto);
  if (on === false) set.delete(date); else set.add(date);
  st.pto = [...set].sort();
  writeFloorState(st);
  return floorStatus(now);
}

// Use the monthly reset. Rate-limited to one per calendar month; the caller gets
// { ok:false } (never throws) when it's already been used, so the UI can explain.
export function useReset(now = new Date()) {
  const st = readFloorState();
  const today = nowYmd(now);
  const monthKey = today.slice(0, 7);
  if (st.resets.some(r => String(r).slice(0, 7) === monthKey)) {
    return { ok: false, reason: 'A reset has already been used this month.', status: floorStatus(now) };
  }
  st.resets = [...st.resets, today].sort();
  writeFloorState(st);
  return { ok: true, status: floorStatus(now) };
}
