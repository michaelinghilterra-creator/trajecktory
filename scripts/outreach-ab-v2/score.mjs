import fs from 'node:fs';
import path from 'node:path';
import './bootstrap.mjs';

const ARMS = ['august', 'lap7', 'august_plus'];

export function parseAnswerLine(line) {
  const result = {};
  const pattern = /\bC\s*(\d{1,2})\s+(favorite|second)\s*:\s*(A|B|C|None)\b/gi;
  for (const match of String(line || '').matchAll(pattern)) {
    const number = match[1].padStart(2, '0');
    const field = match[2].toLowerCase();
    const raw = match[3];
    const value = /^none$/i.test(raw) ? null : raw.toUpperCase();
    result[number] ||= { favorite: undefined, second: undefined };
    result[number][field] = value;
  }
  for (const entry of Object.values(result)) {
    if (entry.favorite === undefined) delete entry.favorite;
    if (entry.second === undefined) delete entry.second;
  }
  return result;
}

function mapPick(value, mapping) {
  if (value == null) return null;
  if (mapping?.[value]) return mapping[value];
  return ARMS.includes(value) ? value : null;
}

export function joinPicks(parsed, key) {
  const out = {};
  for (const [number, answer] of Object.entries(parsed || {})) {
    const mapping = key?.[number];
    if (!mapping) continue;
    out[number] = {};
    if (Object.hasOwn(answer, 'favorite')) out[number].favorite = mapPick(answer.favorite, mapping);
    if (Object.hasOwn(answer, 'second')) out[number].second = mapPick(answer.second, mapping);
  }
  return out;
}

export function recordAnswers({ runDir, tranche, lineFile, force = false } = {}) {
  const dir = path.resolve(runDir || '');
  const trancheNumber = Number(tranche);
  const target = path.join(dir, `tranche-${trancheNumber}`, 'picks.json');
  if (!runDir || ![1, 2, 3].includes(trancheNumber)) throw new Error('record requires a run directory and tranche 1, 2, or 3');
  if (fs.existsSync(target) && !force) throw new Error(`${target} already exists; pass --force to replace it`);
  const line = fs.readFileSync(path.resolve(lineFile), 'utf8');
  const key = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8'));
  const picks = joinPicks(parseAnswerLine(line), key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(picks, null, 2) + '\n', 'utf8');
  return { target, picks };
}

function gradeScore(draft) {
  const raw = draft?.grade?.score ?? draft?.grade?.overallScore ?? draft?.grade?.overall_score;
  const score = Number(raw);
  return Number.isFinite(score) ? score : null;
}

function binomialCoefficient(n, k) {
  const limit = Math.min(k, n - k);
  let value = 1;
  for (let i = 1; i <= limit; i++) value = value * (n - limit + i) / i;
  return value;
}

export function signTestPValue(aWins, bWins) {
  const a = Math.max(0, Number(aWins) || 0);
  const b = Math.max(0, Number(bWins) || 0);
  const n = a + b;
  if (!n) return 1;
  const low = Math.min(a, b);
  let tail = 0;
  for (let k = 0; k <= low; k++) tail += binomialCoefficient(n, k) * (0.5 ** n);
  return Math.min(1, 2 * tail);
}

function emptyTotals() {
  return Object.fromEntries(ARMS.map(arm => [arm, 0]));
}

function addBreakdown(container, key, favorite, second, none) {
  container[key] ||= { favorites: emptyTotals(), seconds: emptyTotals(), points: emptyTotals(), noneAtAll: 0, rated: 0 };
  const row = container[key];
  row.rated++;
  if (favorite) {
    row.favorites[favorite]++;
    row.points[favorite] += 2;
  }
  if (second) {
    row.seconds[second]++;
    row.points[second]++;
  }
  if (none) row.noneAtAll++;
}

export function scoreResults({ picks = {}, cases = [] } = {}) {
  const favorites = emptyTotals();
  const seconds = emptyTotals();
  const points = emptyTotals();
  const byKind = {};
  const byTier = {};
  let noneAtAll = 0;
  let agreement = 0;
  let agreementCompared = 0;
  let rated = 0;

  for (const item of cases) {
    const number = String(item.number ?? String(item.label || '').replace(/^C/i, '')).padStart(2, '0');
    const pick = picks[number];
    if (!pick || !Object.hasOwn(pick, 'favorite')) continue;
    rated++;
    const favorite = ARMS.includes(pick.favorite) ? pick.favorite : null;
    const second = ARMS.includes(pick.second) && pick.second !== favorite ? pick.second : null;
    const none = pick.favorite === null;
    if (favorite) {
      favorites[favorite]++;
      points[favorite] += 2;
    }
    if (second) {
      seconds[second]++;
      points[second]++;
    }
    if (none) noneAtAll++;
    addBreakdown(byKind, item.kind || 'unknown', favorite, second, none);
    addBreakdown(byTier, item.tier || item.packet?.recipient?.tier || 'unknown', favorite, second, none);

    if (!favorite) continue;
    const scored = (item.drafts || []).map(draft => ({ arm: draft.arm, score: gradeScore(draft) }))
      .filter(entry => ARMS.includes(entry.arm) && entry.score !== null);
    if (scored.length < 2) continue;
    const high = Math.max(...scored.map(entry => entry.score));
    const top = scored.filter(entry => entry.score === high);
    if (top.length !== 1) continue;
    agreementCompared++;
    if (top[0].arm === favorite) agreement++;
  }

  const signTests = {};
  for (let i = 0; i < ARMS.length; i++) {
    for (let j = i + 1; j < ARMS.length; j++) {
      const a = ARMS[i], b = ARMS[j];
      signTests[`${a}_vs_${b}`] = { a, b, aWins: favorites[a], bWins: favorites[b], pValue: signTestPValue(favorites[a], favorites[b]) };
    }
  }
  return {
    favorites, seconds, points, noneAtAll, rated, byKind, byTier,
    graderAgreement: {
      agreement,
      compared: agreementCompared,
      rate: agreementCompared ? agreement / agreementCompared : null,
    },
    signTests,
  };
}

function table(lines, title, rows) {
  lines.push(`## ${title}`, '', '| Group | Arm | Favorites | Seconds | Points | None | Rated |', '|---|---|---:|---:|---:|---:|---:|');
  for (const [group, values] of Object.entries(rows)) {
    for (const arm of ARMS) lines.push(`| ${group} | ${arm} | ${values.favorites[arm]} | ${values.seconds[arm]} | ${values.points[arm]} | ${values.noneAtAll} | ${values.rated} |`);
  }
  if (!Object.keys(rows).length) lines.push('| - | - | 0 | 0 | 0 | 0 | 0 |');
  lines.push('');
}

export function renderResults(result) {
  const lines = ['# Outreach A/B v2 results', '', '| Arm | Favorites | Seconds | Points |', '|---|---:|---:|---:|'];
  for (const arm of ARMS) lines.push(`| ${arm} | ${result.favorites[arm]} | ${result.seconds[arm]} | ${result.points[arm]} |`);
  lines.push('', `None at all: ${result.noneAtAll}`, `Rated cases: ${result.rated}`, '',
    `Grader agreement: ${result.graderAgreement.agreement}/${result.graderAgreement.compared}${result.graderAgreement.compared ? ` (${(result.graderAgreement.rate * 100).toFixed(1)}%)` : ''}`, '');
  table(lines, 'By kind', result.byKind);
  table(lines, 'By tier', result.byTier);
  lines.push('## Two-sided sign tests', '', '| Pair | Wins | p-value |', '|---|---:|---:|');
  for (const test of Object.values(result.signTests)) lines.push(`| ${test.a} vs ${test.b} | ${test.aWins}-${test.bWins} | ${test.pValue.toFixed(6)} |`);
  return lines.join('\n') + '\n';
}

export function scoreRun(runDir) {
  const dir = path.resolve(runDir || '');
  const picks = {};
  const cases = [];
  for (let tranche = 1; tranche <= 3; tranche++) {
    const trancheDir = path.join(dir, `tranche-${tranche}`);
    const picksFile = path.join(trancheDir, 'picks.json');
    const draftsFile = path.join(trancheDir, 'drafts.json');
    if (fs.existsSync(picksFile)) Object.assign(picks, JSON.parse(fs.readFileSync(picksFile, 'utf8')));
    if (fs.existsSync(draftsFile)) cases.push(...JSON.parse(fs.readFileSync(draftsFile, 'utf8')));
  }
  const result = scoreResults({ picks, cases });
  const markdown = renderResults(result);
  fs.writeFileSync(path.join(dir, 'results.md'), markdown, 'utf8');
  return { result, markdown };
}
