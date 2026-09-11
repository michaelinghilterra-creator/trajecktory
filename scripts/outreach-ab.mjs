#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 300_000;
const KINDS = new Set(['li_followup', 'connect_note', 'ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup']);

// Request contract copied from the current UI:
// - connect-note / li_followup: dashboard-web/src/connect.jsx:417-420
// - TA/referral DM: dashboard-web/src/target-talent.jsx:905-912
// - TA/referral email: dashboard-web/src/target-talent.jsx:943-951
// - application follow-up: dashboard-web/src/followups.jsx:1090-1102
//
// Route side-effect audit (normal draft request):
// - /api/linkedin-drafts/connect-note: reads contact/application context and calls the
//   model. Its only possible write is logOutreachOverride -> data/outreach-overrides.tsv,
//   and only when policy blocks are bypassed with override:true (route lines 363-364).
// - /api/linkedin-drafts/followup-message: same; its only possible write is the override
//   log when override:true (route lines 491-492).
// - /api/target-talent/:id/draft: reads the TA row, correspondence, applications, CV,
//   profile, and research; its only possible write is that override log (lines 310-312).
// - /api/referrals/:id/draft: reads the referral row, shared correspondence,
//   applications, CV, profile, and research; its only possible write is that override
//   log (lines 348-350).
// - /api/followups/:appNum/draft: reads applications, prior follow-ups, CV, profile,
//   and research, then calls the model; it performs no file write or state mutation.
// Every policy-aware request below therefore carries override:false. A blocked response
// is recorded and never retried.
export const REQUESTS = Object.freeze({
  li_followup: {
    endpoint: () => '/api/linkedin-drafts/followup-message',
    body: (c) => ({ source: c.source, id: c.id, override: false }),
  },
  connect_note: {
    endpoint: () => '/api/linkedin-drafts/connect-note',
    body: (c) => ({ source: c.source, id: c.id, override: false }),
  },
  ta_dm: {
    endpoint: (c) => `/api/target-talent/${encodeURIComponent(c.id)}/draft`,
    body: () => ({ interviewStage: 'general', channel: 'linkedin', override: false }),
  },
  ta_email: {
    endpoint: (c) => `/api/target-talent/${encodeURIComponent(c.id)}/draft`,
    body: () => ({ interviewStage: 'general', override: false }),
  },
  referral_dm: {
    endpoint: (c) => `/api/referrals/${encodeURIComponent(c.id)}/draft`,
    body: () => ({ topic: 'reconnect', channel: 'linkedin', override: false }),
  },
  referral_email: {
    endpoint: (c) => `/api/referrals/${encodeURIComponent(c.id)}/draft`,
    body: () => ({ topic: 'reconnect', override: false }),
  },
  app_followup: {
    endpoint: (c) => `/api/followups/${encodeURIComponent(c.appId)}/draft`,
    body: () => undefined,
  },
});

export const SURFACE_BY_KIND = Object.freeze({
  li_followup: 'li_followup', connect_note: 'connect_note_influencer',
  ta_dm: 'ta_dm', ta_email: 'ta_email', referral_dm: 'referral_dm',
  referral_email: 'referral_email', app_followup: 'app_followup',
});

function fail(message) { throw new Error(message); }

function parseServer(value, flag) {
  const comma = String(value || '').lastIndexOf(',');
  if (comma <= 0 || comma === value.length - 1) fail(`${flag} must be URL,token`);
  const baseText = value.slice(0, comma);
  const token = value.slice(comma + 1);
  let url;
  try { url = new URL(baseText); } catch { fail(`${flag} has an invalid URL`); }
  const host = url.hostname.toLowerCase();
  const octets = host.split('.').map(Number);
  const loopbackV4 = octets.length === 4 && octets[0] === 127 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const loopback = host === 'localhost' || host === '::1' || host === '[::1]' || loopbackV4;
  if (!loopback) fail(`${flag} host must be loopback (localhost, 127.0.0.0/8, or ::1)`);
  if (!['http:', 'https:'].includes(url.protocol)) fail(`${flag} URL must use http or https`);
  if (url.username || url.password || url.search || url.hash) fail(`${flag} URL must not contain credentials, query, or fragment`);
  return { url: url.origin, token };
}

export function parseArgs(argv) {
  const out = { arms: [], stability: 1, stabilityArm: 'new', seed: 1, only: null, cases: null, grader: null, score: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (value === undefined) fail(`${flag} requires a value`);
    if (flag === '--cases') out.cases = value;
    else if (flag === '--arm') {
      const eq = value.indexOf('=');
      if (eq <= 0) fail('--arm must be label=URL,token');
      out.arms.push({ name: value.slice(0, eq), ...parseServer(value.slice(eq + 1), '--arm') });
    } else if (flag === '--grader') out.grader = parseServer(value, '--grader');
    else if (flag === '--stability') out.stability = Number(value);
    else if (flag === '--stability-arm') out.stabilityArm = value;
    else if (flag === '--seed') out.seed = Number(value);
    else if (flag === '--only') out.only = value;
    else if (flag === '--score') out.score = value;
    else fail(`Unknown argument: ${flag}`);
  }
  if (out.score) {
    if (argv.length !== 2) fail('--score cannot be combined with run arguments');
    return out;
  }
  if (!out.cases || !out.arms.length || !out.grader) fail('A run requires --cases, at least one --arm, and --grader');
  if (new Set(out.arms.map((a) => a.name)).size !== out.arms.length) fail('Arm labels must be unique');
  if (!Number.isInteger(out.stability) || out.stability < 1) fail('--stability must be a positive integer');
  if (out.stability > 1 && !out.arms.some((arm) => arm.name === out.stabilityArm)) {
    fail(`--stability-arm "${out.stabilityArm}" is not among the configured --arm names`);
  }
  if (!Number.isFinite(out.seed)) fail('--seed must be a finite number');
  return out;
}

export function validateCases(cases) {
  if (!Array.isArray(cases)) fail('Cases file must contain a JSON array');
  const labels = new Set();
  for (const c of cases) {
    if (!c || typeof c.label !== 'string' || !c.label.trim()) fail('Every case needs a non-empty label');
    if (labels.has(c.label)) fail(`Duplicate case label: ${c.label}`);
    labels.add(c.label);
    if (!KINDS.has(c.kind)) fail(`Unsupported kind for ${c.label}: ${c.kind}`);
    if (c.kind === 'app_followup') {
      if (c.appId == null) fail(`${c.label}: app_followup needs appId`);
      continue;
    }
    if (c.id == null) fail(`${c.label}: ${c.kind} needs id`);
    if (c.source !== 'ta' && c.source !== 'referral') fail(`${c.label}: ${c.kind} source must be "ta" or "referral"`);
    if ((c.kind === 'referral_dm' || c.kind === 'referral_email') && c.source !== 'referral') {
      fail(`${c.label}: ${c.kind} source must be "referral"`);
    }
  }
  return cases;
}

export function normalizeResponse(data, { arm, label, kind, ms = 0 } = {}) {
  const blocked = data?.blocked === true;
  const subject = String(data?.draft?.subject ?? data?.subject ?? '').trim();
  const body = String(data?.draft?.body ?? data?.response ?? data?.body ?? '').trim();
  const failed = !blocked && (!body || data?.error);
  return {
    arm, label, kind, subject, body, ms,
    status: blocked ? 'blocked' : failed ? 'failed' : 'ok',
    rawReview: data?.review ?? data?.draft?.review ?? null,
    surfaceId: data?.surfaceId ?? data?.draft?.surfaceId ?? null,
    gradeContext: data?.gradeContext ?? data?.draft?.gradeContext ?? null,
    ...(blocked ? { blocks: data.blocks || [], nextEligible: data.nextEligible || null } : {}),
    ...(failed ? { error: String(data?.error || 'Draft response contained no body') } : {}),
  };
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(values, seed) {
  const result = [...values];
  const random = mulberry32(Number(seed) || 0);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function buildKey(cases, armNames, seed) {
  const key = {};
  cases.forEach((c, index) => {
    const available = Array.isArray(c.drafts)
      ? c.drafts.filter((d) => d.status === 'ok').map((d) => d.arm)
      : armNames;
    key[c.label] = seededShuffle(available, Number(seed) + index);
  });
  return key;
}

export function renderSheet(cases, key) {
  const sections = ['# Outreach A/B blind sheet', ''];
  for (const c of cases) {
    sections.push(`## ${c.label} (${c.kind})`, '');
    const byArm = new Map((c.drafts || []).filter((d) => d.status === 'ok').map((d) => [d.arm, d]));
    let version = 0;
    for (const arm of key[c.label] || []) {
      const draft = byArm.get(arm);
      if (!draft) continue;
      version++;
      sections.push(`### Version ${version}`, '');
      if (draft.subject) sections.push(`Subject: ${draft.subject}`, '');
      sections.push(draft.body, '');
    }
    if (!version) sections.push('_No successful drafts._', '');
    sections.push('Pick: ____', '');
  }
  return sections.join('\n').trimEnd() + '\n';
}

function gradeScore(draft) {
  const value = draft?.grade?.score ?? draft?.grade?.overallScore ?? draft?.grade?.overall_score;
  if (value === null || value === undefined || value === '') return null;
  const score = Number(value);
  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : null;
}

export function findStabilityDraft(drafts, armName) {
  return drafts.find((draft) => draft.arm === armName && draft.status === 'ok') || null;
}

export function scorePicks(picks, key, raw) {
  const wins = Object.fromEntries([...new Set(Object.values(key).flat())].map((arm) => [arm, 0]));
  let agreement = 0;
  let compared = 0;
  const details = [];
  const skipped = [];
  const agreementSkipped = [];
  for (const [label, pickedVersion] of Object.entries(picks || {})) {
    const order = key[label];
    if (!Array.isArray(order)) {
      skipped.push({ label, reason: 'missing key' });
      continue;
    }
    if (order.length < 2) {
      skipped.push({ label, reason: 'fewer than 2 versions' });
      continue;
    }
    if (!Number.isInteger(Number(pickedVersion)) || Number(pickedVersion) < 1 || Number(pickedVersion) > order.length) {
      skipped.push({ label, reason: 'invalid version number' });
      continue;
    }
    const pickedArm = order[Number(pickedVersion) - 1];
    wins[pickedArm] = (wins[pickedArm] || 0) + 1;
    const c = (raw.cases || []).find((item) => item.label === label);
    const scored = (c?.drafts || []).map((d) => ({ arm: d.arm, score: gradeScore(d) })).filter((d) => d.score !== null);
    let matched = null;
    if (scored.length >= 2) {
      const high = Math.max(...scored.map((d) => d.score));
      matched = scored.some((d) => d.arm === pickedArm && d.score === high);
      compared++;
      if (matched) agreement++;
    } else agreementSkipped.push({ label, reason: 'fewer than 2 valid grade scores' });
    details.push({ label, pickedVersion: Number(pickedVersion), pickedArm, graderMatched: matched });
  }
  return { wins, agreement, compared, agreementRate: compared ? agreement / compared : null, skipped, agreementSkipped, details };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function post(server, endpoint, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = performance.now();
  try {
    const headers = { 'x-tjk-token': server.token };
    const init = { method: 'POST', headers, signal: controller.signal };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(server.url + endpoint, init);
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { error: `Non-JSON response (${response.status})` }; }
    if (!response.ok && !data.error) data.error = `HTTP ${response.status}`;
    return { data, ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

async function draftArm(arm, c) {
  const spec = REQUESTS[c.kind];
  const started = performance.now();
  try {
    const { data, ms } = await post(arm, spec.endpoint(c), spec.body(c));
    return normalizeResponse(data, { arm: arm.name, label: c.label, kind: c.kind, ms });
  } catch (error) {
    return normalizeResponse({ error: error.name === 'AbortError' ? 'Request timed out after 300s' : error.message }, { arm: arm.name, label: c.label, kind: c.kind, ms: Math.round(performance.now() - started) });
  }
}

async function gradeDraft(grader, draft, context) {
  const started = performance.now();
  try {
    const { data, ms } = await post(grader, '/api/drafts/review', {
      body: draft.body, subject: draft.subject, surfaceId: draft.surfaceId || SURFACE_BY_KIND[draft.kind], gradeContext: context,
    });
    if (data.error || !data.review) return { status: 'failed', ms, error: String(data.error || 'Review response contained no review') };
    return { status: 'ok', ms, ...data.review };
  } catch (error) {
    return { status: 'failed', ms: Math.round(performance.now() - started), error: error.name === 'AbortError' ? 'Request timed out after 300s' : error.message };
  }
}

function caseContext(c, drafts) {
  const surfaceId = drafts.find((d) => d.surfaceId)?.surfaceId || SURFACE_BY_KIND[c.kind];
  if (c.appId == null) {
    const returned = drafts.find((d) => d.gradeContext && typeof d.gradeContext === 'object')?.gradeContext;
    if (returned) return { surfaceId, source: c.source ?? returned.source ?? null, id: c.id ?? returned.id ?? null, appId: returned.appId ?? null };
  }
  return { surfaceId, source: c.source ?? null, id: c.id ?? null, appId: c.appId ?? null };
}

function renderSummary(raw) {
  const lines = ['# Outreach A/B summary', '', '| Arm | Median draft ms | Max draft ms | Median grader score | Blocked | Failed |', '|---|---:|---:|---:|---:|---:|'];
  for (const arm of raw.arms) {
    const drafts = raw.cases.flatMap((c) => c.drafts).filter((d) => d.arm === arm);
    const times = drafts.filter((d) => d.status === 'ok').map((d) => d.ms);
    const scores = drafts.map(gradeScore).filter((n) => n !== null);
    lines.push(`| ${arm} | ${median(times) ?? 'n/a'} | ${times.length ? Math.max(...times) : 'n/a'} | ${median(scores) ?? 'n/a'} | ${drafts.filter((d) => d.status === 'blocked').length} | ${drafts.filter((d) => d.status === 'failed').length} |`);
  }
  lines.push('', '## Grader stability', '', '| Case | Arm | Min | Max | Spread | Scores |', '|---|---|---:|---:|---:|---|');
  const stability = raw.cases.filter((c) => c.stability);
  if (!stability.length) lines.push('| _None_ | | | | | |');
  else for (const c of stability) lines.push(`| ${c.label} | ${c.stability.arm} | ${c.stability.min ?? 'n/a'} | ${c.stability.max ?? 'n/a'} | ${c.stability.spread ?? 'n/a'} | ${(c.stability.scores || []).join(', ')} |`);
  const extras = raw.cases.map((c) => ({ label: c.label, extra: c.extra })).filter((c) => Object.keys(c.extra || {}).length);
  if (extras.length) {
    lines.push('', '## Case metadata', '', '| Case | Extra fields |', '|---|---|');
    for (const c of extras) lines.push(`| ${c.label} | ${JSON.stringify(c.extra).replace(/\|/g, '\\|')} |`);
  }
  return lines.join('\n') + '\n';
}

async function runExperiment(args) {
  const input = JSON.parse(fs.readFileSync(path.resolve(args.cases), 'utf8'));
  validateCases(input);
  const selected = input.filter((c) => !args.only || c.label === args.only);
  if (args.only && !selected.length) fail(`No case has label ${args.only}`);

  const raw = { generatedAt: new Date().toISOString(), seed: args.seed, stabilityRuns: args.stability, stabilityArm: args.stabilityArm, arms: args.arms.map((a) => a.name), cases: [] };
  for (const c of selected) {
    process.stdout.write(`Drafting ${c.label}...\n`);
    const drafts = await Promise.all(args.arms.map((arm) => draftArm(arm, c)));
    const context = caseContext(c, drafts);
    for (const draft of drafts) {
      if (draft.status !== 'ok') continue;
      draft.grade = await gradeDraft(args.grader, draft, context);
    }
    const stabilityDraft = findStabilityDraft(drafts, args.stabilityArm);
    let stability = null;
    if (stabilityDraft) {
      const grades = [];
      if (stabilityDraft.grade) grades.push(stabilityDraft.grade);
      while (grades.length < args.stability) grades.push(await gradeDraft(args.grader, stabilityDraft, context));
      const scores = grades.map((g) => gradeScore({ grade: g })).filter((n) => n !== null);
      stability = { arm: args.stabilityArm, runs: grades, scores, min: scores.length ? Math.min(...scores) : null, max: scores.length ? Math.max(...scores) : null, spread: scores.length ? Math.max(...scores) - Math.min(...scores) : null };
    }
    const { label, kind, source, id, appId, ...extra } = c;
    raw.cases.push({ label, kind, source: source ?? null, id: id ?? null, appId: appId ?? null, extra, gradeContext: context, drafts, ...(stability ? { stability } : {}) });
  }

  const stamp = raw.generatedAt.replace(/[:.]/g, '-');
  const outDir = path.resolve('output', 'outreach-ab', stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const key = buildKey(raw.cases, raw.arms, args.seed);
  fs.writeFileSync(path.join(outDir, 'raw.json'), JSON.stringify(raw, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'key.json'), JSON.stringify(key, null, 2) + '\n');
  fs.writeFileSync(path.join(outDir, 'sheet.md'), renderSheet(raw.cases, key));
  fs.writeFileSync(path.join(outDir, 'summary.md'), renderSummary(raw));
  process.stdout.write(`Wrote ${outDir}\n`);
}

function runScore(picksFile) {
  const full = path.resolve(picksFile);
  const dir = path.dirname(full);
  const result = scorePicks(JSON.parse(fs.readFileSync(full, 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8')), JSON.parse(fs.readFileSync(path.join(dir, 'raw.json'), 'utf8')));
  process.stdout.write('Wins by arm:\n');
  for (const [arm, wins] of Object.entries(result.wins)) process.stdout.write(`  ${arm}: ${wins}\n`);
  process.stdout.write(`Grader agreement: ${result.agreement}/${result.compared}${result.compared ? ` (${(result.agreementRate * 100).toFixed(1)}%)` : ''}\n`);
  if (result.skipped.length) process.stdout.write(`Skipped cases: ${result.skipped.map((item) => `${item.label} (${item.reason})`).join(', ')}\n`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.score) runScore(args.score);
    else await runExperiment(args);
  } catch (error) {
    console.error(`outreach-ab: ${error.message}`);
    process.exitCode = 1;
  }
}
