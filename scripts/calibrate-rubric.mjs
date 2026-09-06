#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_BASE = 'http://127.0.0.1:3333';
const DEFAULT_LIMIT = 3;
const DEFAULT_SURFACES = ['app_followup', 'ta_email'];
const ALLOWED_SURFACES = new Set(['app_followup', 'ta_email', 'ta_dm']);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_OUT = path.join(path.dirname(SCRIPT_PATH), 'calibrate-rubric.tsv');
const TSV_HEADER = [
  'timestamp',
  'surface',
  'sample_id',
  'status',
  'reason',
  'inline_score',
  'independent_score',
  'gap',
  'dimension_pairs',
].join('\t') + '\n';

const USAGE = `Usage: node scripts/calibrate-rubric.mjs [options]

Options:
  --token <t>        Dashboard auth token, or use TJK_TOKEN
  --base <url>       Dashboard URL, default ${DEFAULT_BASE}
  --limit <n>        Samples per surface, default ${DEFAULT_LIMIT}
  --surfaces <list>  Comma separated list, default ${DEFAULT_SURFACES.join(',')}
                     Allowed: app_followup, ta_email, ta_dm
  --out <path>       TSV path, default ${DEFAULT_OUT}
  --same-model       Use the draft model for independent grading, then restore settings
  --help             Print this usage and exit

Find the token in the dashboard startup line:
  Auth token for CLI/curl (x-tjk-token header): <value>`;

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = {
    token: '',
    base: DEFAULT_BASE,
    limit: DEFAULT_LIMIT,
    surfaces: [...DEFAULT_SURFACES],
    out: DEFAULT_OUT,
    sameModel: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--same-model') {
      options.sameModel = true;
      continue;
    }

    const names = new Set(['--token', '--base', '--limit', '--surfaces', '--out']);
    if (!names.has(arg)) fail(`Unknown option: ${arg}\n\n${USAGE}`);
    if (index + 1 >= argv.length) fail(`Missing value for ${arg}\n\n${USAGE}`);
    const value = argv[index + 1];
    index += 1;

    if (arg === '--token') options.token = value;
    if (arg === '--base') options.base = value;
    if (arg === '--limit') options.limit = Number(value);
    if (arg === '--surfaces') {
      options.surfaces = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
    }
    if (arg === '--out') options.out = path.resolve(value);
  }

  if (!Number.isInteger(options.limit) || options.limit < 1) {
    fail('--limit must be a positive integer.');
  }
  if (!options.surfaces.length) fail('--surfaces must name at least one surface.');
  const invalid = options.surfaces.filter((surface) => !ALLOWED_SURFACES.has(surface));
  if (invalid.length) fail(`Unknown surface: ${invalid.join(', ')}.`);

  options.base = options.base.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(options.base)) fail('--base must be an http or https URL.');
  if (path.resolve(options.out) === path.resolve(SCRIPT_PATH)) fail('--out cannot overwrite this script.');
  return options;
}

function cleanTsv(value) {
  return String(value == null ? '' : value).replace(/[\t\r\n]+/g, ' ').trim();
}

function ensureOutput(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
    fs.appendFileSync(filePath, TSV_HEADER, 'utf8');
  }
}

function appendRow(filePath, row) {
  const values = [
    row.timestamp,
    row.surface,
    row.sampleId,
    row.status,
    row.reason,
    row.inlineScore,
    row.independentScore,
    row.gap,
    row.dimensionPairs,
  ];
  fs.appendFileSync(filePath, values.map(cleanTsv).join('\t') + '\n', 'utf8');
}

let activeController = null;

async function requestJson(options, route, request = {}) {
  const controller = new AbortController();
  activeController = controller;
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);
  const method = request.method || 'GET';
  const headers = {
    Accept: 'application/json',
    'x-tjk-token': options.token,
  };
  if (request.body !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const response = await fetch(`${options.base}${route}`, {
      method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail = payload?.error || text || response.statusText;
      fail(`${method} ${route} failed with HTTP ${response.status}: ${detail}`);
    }
    if (payload == null) fail(`${method} ${route} returned no JSON body.`);
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') fail(`${method} ${route} timed out or was interrupted.`);
    throw error;
  } finally {
    clearTimeout(timer);
    if (activeController === controller) activeController = null;
  }
}

function section(state, key) {
  return Array.isArray(state?.sections)
    ? state.sections.find((item) => item.key === key)
    : null;
}

function fullModelId(state, key) {
  const alias = section(state, key)?.current;
  return state?.modelVersions?.[alias]?.current || alias || 'unknown';
}

function uniqueIds(items, source) {
  const ids = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (source && item?.source !== source) continue;
    const id = item?.id;
    if (id == null || seen.has(String(id))) continue;
    seen.add(String(id));
    ids.push(id);
  }
  return ids;
}

async function discoverAppIds(options) {
  const stale = await requestJson(options, '/api/followups/stale');
  const staleItems = [
    ...(stale.warm || []),
    ...(stale.cold || []),
    ...(stale.snoozed || []),
    ...(stale.items || []),
  ];
  const ids = uniqueIds(staleItems, 'app');
  if (ids.length >= options.limit) return ids.slice(0, options.limit);

  const applications = await requestJson(options, '/api/applications');
  const fallback = uniqueIds(
    (Array.isArray(applications) ? applications : []).filter((item) => item.status === 'Applied'),
  );
  for (const id of fallback) {
    if (!ids.some((existing) => String(existing) === String(id))) ids.push(id);
    if (ids.length >= options.limit) break;
  }
  return ids.slice(0, options.limit);
}

async function discoverTalentIds(options) {
  const contacts = await requestJson(options, '/api/target-talent');
  return uniqueIds(contacts).slice(0, options.limit);
}

async function discoverSamples(options, surface) {
  const ids = surface === 'app_followup'
    ? await discoverAppIds(options)
    : await discoverTalentIds(options);
  const samples = ids.map((id) => ({ id, available: true }));
  while (samples.length < options.limit) {
    samples.push({
      id: `unavailable-${samples.length + 1}`,
      available: false,
      reason: `only ${ids.length} eligible id${ids.length === 1 ? '' : 's'} discovered`,
    });
  }
  return samples;
}

function draftRequest(surface, id) {
  if (surface === 'app_followup') {
    return { route: `/api/followups/${encodeURIComponent(id)}/draft`, body: {} };
  }
  if (surface === 'ta_dm') {
    return {
      route: `/api/target-talent/${encodeURIComponent(id)}/draft`,
      body: { channel: 'linkedin', interviewStage: 'general' },
    };
  }
  return {
    route: `/api/target-talent/${encodeURIComponent(id)}/draft`,
    body: { channel: 'email', interviewStage: 'general' },
  };
}

function dimensionPairs(inlineDimensions, independentDimensions) {
  const independent = new Map();
  for (const dimension of Array.isArray(independentDimensions) ? independentDimensions : []) {
    if (typeof dimension?.id === 'string' && Number.isFinite(dimension.score)) {
      independent.set(dimension.id, dimension.score);
    }
  }

  const pairs = [];
  for (const dimension of Array.isArray(inlineDimensions) ? inlineDimensions : []) {
    if (typeof dimension?.id !== 'string' || !Number.isFinite(dimension.score)) continue;
    if (!independent.has(dimension.id)) continue;
    const independentScore = independent.get(dimension.id);
    pairs.push({
      id: dimension.id,
      inline: dimension.score,
      independent: independentScore,
      gap: dimension.score - independentScore,
    });
  }
  return pairs;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : NaN;
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function standardDeviation(values) {
  if (!values.length) return NaN;
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function ranks(values) {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const output = new Array(values.length);
  let start = 0;
  while (start < indexed.length) {
    let end = start + 1;
    while (end < indexed.length && indexed[end].value === indexed[start].value) end += 1;
    const averageRank = ((start + 1) + end) / 2;
    for (let index = start; index < end; index += 1) output[indexed[index].index] = averageRank;
    start = end;
  }
  return output;
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 2) return NaN;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSquares += leftDelta ** 2;
    rightSquares += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftSquares * rightSquares);
  return denominator ? numerator / denominator : NaN;
}

function spearman(records) {
  return pearson(
    ranks(records.map((record) => record.inlineScore)),
    ranks(records.map((record) => record.independentScore)),
  );
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : 'n/a';
}

function reasonCounts(skips) {
  const counts = new Map();
  for (const skip of skips) counts.set(skip.reason, (counts.get(skip.reason) || 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function summarizeGroup(label, records, skips) {
  const gaps = records.map((record) => record.gap);
  console.log(`\n${label}`);
  console.log(`  n: ${records.length}`);
  console.log(`  skipped: ${skips.length}`);
  for (const [reason, count] of reasonCounts(skips)) console.log(`    ${count} x ${reason}`);
  console.log(`  mean gap: ${formatNumber(mean(gaps))}`);
  console.log(`  median gap: ${formatNumber(median(gaps))}`);
  console.log(`  standard deviation: ${formatNumber(standardDeviation(gaps))}`);
  console.log(`  Spearman: ${formatNumber(spearman(records))} (n=${records.length})`);

  const byDimension = new Map();
  for (const record of records) {
    for (const pair of record.dimensions) {
      if (!byDimension.has(pair.id)) byDimension.set(pair.id, []);
      byDimension.get(pair.id).push(pair.gap);
    }
  }
  console.log('  mean gap per dimension:');
  if (!byDimension.size) console.log('    none');
  for (const [id, dimensionGaps] of [...byDimension.entries()].sort()) {
    console.log(`    ${id}: ${formatNumber(mean(dimensionGaps))} (n=${dimensionGaps.length})`);
  }
}

function verdict(meanGap, n) {
  if (!n) return 'DO NOT DISPLAY: harden the anchors and re-run';
  if (meanGap <= 5) return 'SHIP: display the score as is';
  if (meanGap <= 10) {
    return 'SHIP WITH LABEL: mark it self-scored, keep the independent review button prominent';
  }
  return 'DO NOT DISPLAY: harden the anchors and re-run';
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return;
  }

  const options = parseArgs(argv);
  options.token = options.token || (process.env.TJK_TOKEN || '').trim();
  if (!options.token) {
    console.error('Missing dashboard auth token. Pass --token <value> or set TJK_TOKEN.');
    console.error('Find it in the dashboard startup output: Auth token for CLI/curl (x-tjk-token header).');
    process.exitCode = 1;
    return;
  }

  ensureOutput(options.out);
  const initialModels = await requestJson(options, '/api/setup/models');
  const draftAlias = section(initialModels, 'draft')?.current;
  const originalGradeAlias = section(initialModels, 'grade')?.current;
  if (!draftAlias || !originalGradeAlias) fail('Dashboard model settings did not include draft and grade models.');

  const draftModelId = fullModelId(initialModels, 'draft');
  let gradeModelId = fullModelId(initialModels, 'grade');
  let gradeChanged = false;
  let stopping = false;

  const restoreGradeModel = async () => {
    if (!gradeChanged) return;
    gradeChanged = false;
    await requestJson(options, '/api/setup/models', {
      method: 'POST',
      body: { section: 'grade', value: originalGradeAlias },
    });
  };

  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    if (activeController) activeController.abort();
    restoreGradeModel()
      .catch((error) => console.error(`Could not restore grade model: ${error.message}`))
      .finally(() => process.exit(code));
  };
  process.once('SIGINT', () => stop(130));
  process.once('SIGTERM', () => stop(143));

  const completed = [];
  const skipped = [];
  const total = options.limit * options.surfaces.length;
  let position = 0;

  try {
    if (options.sameModel && originalGradeAlias !== draftAlias) {
      const changedModels = await requestJson(options, '/api/setup/models', {
        method: 'POST',
        body: { section: 'grade', value: draftAlias },
      });
      gradeChanged = true;
      gradeModelId = fullModelId(changedModels, 'grade');
    } else if (options.sameModel) {
      gradeModelId = draftModelId;
    }

    for (const requestedSurface of options.surfaces) {
      let samples;
      try {
        samples = await discoverSamples(options, requestedSurface);
      } catch (error) {
        samples = Array.from({ length: options.limit }, (_, index) => ({
          id: `discovery-failed-${index + 1}`,
          available: false,
          reason: `discovery failed: ${error.message}`,
        }));
      }

      for (const sample of samples) {
        position += 1;
        const started = Date.now();
        const timestamp = new Date().toISOString();
        let row;

        if (!sample.available) {
          row = {
            timestamp,
            surface: requestedSurface,
            sampleId: sample.id,
            status: 'skipped',
            reason: sample.reason,
          };
          skipped.push({ surface: requestedSurface, sampleId: sample.id, reason: sample.reason });
        } else {
          try {
            const request = draftRequest(requestedSurface, sample.id);
            const generated = await requestJson(options, request.route, {
              method: 'POST',
              body: request.body,
            });
            if (generated.reviewStatus !== 'ok') {
              fail(`generation reviewStatus was ${generated.reviewStatus ?? 'missing'}`);
            }
            if (!Number.isFinite(generated.review?.score)) fail('generation review score was missing.');
            if (!Array.isArray(generated.review?.dimensions)) fail('generation review dimensions were missing.');
            if (typeof generated.draft?.body !== 'string' || !generated.draft.body.trim()) {
              fail('generation draft body was missing.');
            }
            if (typeof generated.surfaceId !== 'string' || !generated.surfaceId) {
              fail('generation surfaceId was missing.');
            }

            const graded = await requestJson(options, '/api/drafts/review', {
              method: 'POST',
              body: {
                body: generated.draft.body,
                subject: generated.draft.subject,
                surfaceId: generated.surfaceId,
              },
            });
            if (!Number.isFinite(graded.review?.score)) fail('independent review score was missing.');
            if (!Array.isArray(graded.review?.dimensions)) fail('independent review dimensions were missing.');

            const pairs = dimensionPairs(generated.review.dimensions, graded.review.dimensions);
            const record = {
              surface: generated.surfaceId,
              sampleId: sample.id,
              inlineScore: generated.review.score,
              independentScore: graded.review.score,
              gap: generated.review.score - graded.review.score,
              dimensions: pairs,
            };
            completed.push(record);
            row = {
              timestamp,
              ...record,
              status: 'ok',
              reason: '',
              dimensionPairs: JSON.stringify(pairs),
            };
          } catch (error) {
            const reason = error.message || String(error);
            skipped.push({ surface: requestedSurface, sampleId: sample.id, reason });
            row = {
              timestamp,
              surface: requestedSurface,
              sampleId: sample.id,
              status: 'skipped',
              reason,
            };
          }
        }

        appendRow(options.out, row);
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        const result = row.status === 'ok' ? `gap ${row.gap}` : `skipped: ${row.reason}`;
        console.log(`[${position}/${total}] ${requestedSurface} ${sample.id}: ${result} (${elapsed}s)`);
      }
    }
  } finally {
    await restoreGradeModel();
  }

  console.log('\nRubric calibration summary');
  console.log(`Draft model: ${draftModelId}`);
  console.log(`Independent grade model: ${gradeModelId}`);
  console.log(`Same model forced: ${options.sameModel ? 'yes' : 'no'}`);
  console.log(`Output: ${options.out}`);
  summarizeGroup('Pooled', completed, skipped);
  for (const surface of options.surfaces) {
    summarizeGroup(
      `Surface: ${surface}`,
      completed.filter((record) => record.surface === surface),
      skipped.filter((record) => record.surface === surface),
    );
  }

  const pooledMean = mean(completed.map((record) => record.gap));
  console.log(`\n${verdict(pooledMean, completed.length)}`);
}

main().catch((error) => {
  console.error(`Calibration failed: ${error.message || error}`);
  process.exitCode = 1;
});
