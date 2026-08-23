import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';

export const SPLIT_TEST_MIN_SCORE = 3.5;
export const SPLIT_TEST_TARGET = 30;
export const SPLIT_TEST_PATH = path.join(DATA_DIR, 'split-test.json');

function localYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function cleanState(raw, defaults = {}) {
  const fallbackMin = Number.isFinite(defaults.minScore) ? defaults.minScore : SPLIT_TEST_MIN_SCORE;
  const fallbackTarget = Number.isInteger(defaults.target) && defaults.target > 0 ? defaults.target : SPLIT_TEST_TARGET;
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const assignments = source.assignments && typeof source.assignments === 'object' && !Array.isArray(source.assignments)
    ? Object.fromEntries(Object.entries(source.assignments).filter(([, value]) => value && (value.arm === 'A' || value.arm === 'B')))
    : {};
  return {
    startedOn: /^\d{4}-\d{2}-\d{2}$/.test(source.startedOn || '') ? source.startedOn : null,
    minScore: Number.isFinite(source.minScore) ? source.minScore : fallbackMin,
    target: Number.isInteger(source.target) && source.target > 0 ? source.target : fallbackTarget,
    assignments,
  };
}

export function readSplitTest(defaults = {}) {
  try {
    return cleanState(JSON.parse(fs.readFileSync(SPLIT_TEST_PATH, 'utf8')), defaults);
  } catch {
    return cleanState(null, defaults);
  }
}

export function writeSplitTest(state) {
  fs.writeFileSync(SPLIT_TEST_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

export function assignSplitTest(appId, score, date, defaults = {}) {
  const state = readSplitTest(defaults);
  const key = String(appId);
  if (state.assignments[key]) return state.assignments[key];

  const numericScore = Number(score);
  const assigned = Object.keys(state.assignments).length;
  if (!Number.isFinite(numericScore) || numericScore < state.minScore || assigned >= state.target) return null;

  const assignmentDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : localYmd();
  if (!state.startedOn) state.startedOn = assignmentDate;
  const assignment = { arm: assigned % 2 === 0 ? 'A' : 'B', date: assignmentDate, score: numericScore };
  state.assignments[key] = assignment;
  writeSplitTest(state);
  return assignment;
}

export function splitTestSummary(defaults = {}) {
  const state = readSplitTest(defaults);
  const counts = { A: 0, B: 0 };
  for (const assignment of Object.values(state.assignments)) counts[assignment.arm]++;
  return {
    ...state,
    counts,
    remaining: Math.max(0, state.target - counts.A - counts.B),
  };
}
