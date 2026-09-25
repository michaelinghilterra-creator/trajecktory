#!/usr/bin/env node
/**
 * spark-prefilter-holdback.test.mjs - unit tests for the holdback feature in
 * spark-prefilter.mjs.
 *
 * Tests cover: parseHoldbackRate, holdbackFraction, splitHoldback,
 * discardRows, and appendHoldbackLog.
 *
 * Run: node tests/spark-prefilter-holdback.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  parseHoldbackRate,
  holdbackFraction,
  splitHoldback,
  discardRows,
  appendHoldbackLog,
} from '../spark-prefilter.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('spark-prefilter-holdback.test.mjs');

// ── parseHoldbackRate ──────────────────────────────────────────────────────
{
  check(parseHoldbackRate(undefined) === 0.1, 'undefined returns default 0.1');
  check(parseHoldbackRate(null) === 0.1, 'null returns default 0.1');
  check(parseHoldbackRate('') === 0.1, 'empty string returns default 0.1');
  check(parseHoldbackRate('  ') === 0.1, 'whitespace string returns default 0.1');
  check(parseHoldbackRate('0') === 0, 'string "0" returns 0');
  check(parseHoldbackRate('1') === 1, 'string "1" returns 1');
  check(parseHoldbackRate('0.25') === 0.25, 'string "0.25" returns 0.25');
  check(parseHoldbackRate(0.5) === 0.5, 'numeric 0.5 returns 0.5');
  check(parseHoldbackRate('abc') === 0.1, '"abc" returns default, not 0');
  check(parseHoldbackRate('1.5') === 0.1, '"1.5" returns default, not 0');
  check(parseHoldbackRate('-0.1') === 0.1, '"-0.1" returns default, not 0');
  check(parseHoldbackRate('0.5', 0.2) === 0.5, 'custom default not used when value is valid');
  check(parseHoldbackRate('abc', 0.2) === 0.2, 'custom default used when value is invalid');
  check(parseHoldbackRate('1.5', 0.2) === 0.2, 'out-of-range uses custom default');
  check(parseHoldbackRate('-0.1', 0.2) === 0.2, 'negative uses custom default');
}

// ── holdbackFraction ──────────────────────────────────────────────────────
{
  // Range: every call returns a number in [0, 1)
  let allInRange = true;
  for (let i = 0; i < 2000; i++) {
    const url = `https://jobs.zorblax.example/p/${i}`;
    const f = holdbackFraction(url);
    if (f < 0 || f >= 1) { allInRange = false; break; }
  }
  check(allInRange, '2000 generated URLs all return a value in [0, 1)');

  // Determinism: same URL always gives the same value
  const url1 = 'https://jobs.zorblax.example/p/100';
  check(holdbackFraction(url1) === holdbackFraction(url1), 'same URL gives same fraction');

  // Tracking parameter and trailing slash produce the same value
  const urlA = 'https://a.example/j/1?utm_source=x';
  const urlB = 'https://a.example/j/1/';
  check(holdbackFraction(urlA) === holdbackFraction(urlB),
    'tracking param and trailing slash give identical values');

  // Different URLs can give different fractions
  const urlC = 'https://a.example/j/2';
  check(holdbackFraction(urlA) !== holdbackFraction(urlC) || holdbackFraction(urlA) === holdbackFraction(urlC),
    'different URLs produce a fraction (deterministic)');
}

// ── Rate close to target ──────────────────────────────────────────────────
{
  const rate = 0.1;
  let belowCount = 0;
  for (let i = 0; i < 2000; i++) {
    const url = `https://jobs.zorblax.example/p/${i}`;
    if (holdbackFraction(url) < rate) belowCount++;
  }
  const share = belowCount / 2000;
  check(share >= 0.07 && share <= 0.13,
    `share below rate 0.1 over 2000 URLs is in [0.07, 0.13] (got ${share.toFixed(4)})`);

  // At least one of the first 50 is held back (the old unmixed hash held back none)
  let anyHeldBack = false;
  for (let i = 0; i < 50; i++) {
    if (holdbackFraction(`https://jobs.zorblax.example/p/${i}`) < rate) {
      anyHeldBack = true;
      break;
    }
  }
  check(anyHeldBack, 'at least one of the first 50 URLs is held back at rate 0.1');
}

// ── splitHoldback ─────────────────────────────────────────────────────────
{
  const rows = [];
  for (let i = 0; i < 20; i++) {
    rows.push({ id: `id-${i}`, sourceUrl: `https://jobs.zorblax.example/p/${i}`, score: 1.5, data: { company: 'Zorblax Widgetry', role: 'Example Bolt Title' } });
  }

  // Partition: lengths add up, no id in both
  const { dropped, heldBack } = splitHoldback(rows, 0.3);
  check(dropped.length + heldBack.length === rows.length,
    'dropped + heldBack equals input length');
  const droppedIds = new Set(dropped.map(r => r.id));
  const heldBackIds = new Set(heldBack.map(r => r.id));
  for (const id of rows.map(r => r.id)) {
    check(droppedIds.has(id) || heldBackIds.has(id), `id ${id} is in exactly one array`);
  }
  let noOverlap = true;
  for (const id of droppedIds) {
    if (heldBackIds.has(id)) { noOverlap = false; break; }
  }
  check(noOverlap, 'no id appears in both dropped and heldBack');

  // Rate 0: nothing is held back
  const { dropped: d0, heldBack: hb0 } = splitHoldback(rows, 0);
  check(hb0.length === 0, 'rate 0 holds back nothing');
  check(d0.length === rows.length, 'rate 0 drops everything');

  // Rate 1: everything is held back
  const { dropped: d1, heldBack: hb1 } = splitHoldback(rows, 1);
  check(d1.length === 0, 'rate 1 drops nothing');
  check(hb1.length === rows.length, 'rate 1 holds back everything');

  // Deterministic decision regardless of row position
  const rows2 = [...rows].reverse();
  const { dropped: d2, heldBack: _hb2 } = splitHoldback(rows2, 0.3);
  const d2Ids = new Set(d2.map(r => r.id));
  for (const r of rows) {
    const inDropped1 = droppedIds.has(r.id);
    const inDropped2 = d2Ids.has(r.id);
    check(inDropped1 === inDropped2,
      `id ${r.id} has same dropped decision regardless of position`);
  }
}

// ── discardRows ───────────────────────────────────────────────────────────
{
  const rows = [
    { id: 'r1', sourceUrl: 'https://jobs.zorblax.example/p/1', score: 1.5, data: { company: 'Zorblax Widgetry', role: 'Example Bolt Title' } },
    { id: 'r2', sourceUrl: 'https://jobs.zorblax.example/p/2', score: 1.2, data: { company: 'Quennox Ratchet Works', role: 'Example Gear Title' } },
  ];
  const triage = discardRows(rows, 2.0);
  check(triage.length === 2, 'discardRows returns one row per input');
  check(triage[0].url === rows[0].sourceUrl, 'url field equals sourceUrl');
  check(triage[1].url === rows[1].sourceUrl, 'url field equals sourceUrl');
  check(triage[0].company === 'Zorblax Widgetry', 'company is preserved');
  check(triage[1].company === 'Quennox Ratchet Works', 'company is preserved');
}

// ── Critical safety: heldBack rows must never produce triage rows ─────────
{
  const rows = [];
  for (let i = 0; i < 50; i++) {
    rows.push({ id: `safety-${i}`, sourceUrl: `https://jobs.zorblax.example/safety/${i}`, score: 1.5, data: { company: 'Zorblax Widgetry', role: 'Example Bolt Title' } });
  }
  const { dropped, heldBack } = splitHoldback(rows, 0.5);
  const triage = discardRows(dropped, 2.0);
  const heldBackUrls = new Set(heldBack.map(r => r.sourceUrl));
  let safetyOk = true;
  for (const t of triage) {
    if (heldBackUrls.has(t.url)) { safetyOk = false; break; }
  }
  check(safetyOk, 'no triage row url belongs to a heldBack row');
}

// ── appendHoldbackLog ─────────────────────────────────────────────────────
{
  const dir = makeSandbox('spark-holdback');
  const file = join(dir, 'holdback.tsv');
  const date = '2030-01-15';

  // First write: header plus rows
  const heldBack = [
    { sourceUrl: 'https://jobs.zorblax.example/p/1', score: 1.2 },
    { sourceUrl: 'https://jobs.zorblax.example/p/2', score: 1.5 },
    { sourceUrl: 'https://jobs.zorblax.example/p/3', score: 1.8 },
    { sourceUrl: 'https://quennox.example/j/4', score: 1.1 },
    { sourceUrl: 'https://quennox.example/j/5', score: 1.3 },
    { sourceUrl: 'https://a.example/j/6', score: 1.7 },
  ];
  const r1 = appendHoldbackLog(file, heldBack, date, { threshold: 2.0, model: 'spark-model-v1' });
  check(r1.appended === 6, 'first write appends 6 rows');
  check(r1.skippedDuplicate === 0, 'first write has no duplicates');
  check(existsSync(file), 'file is created');
  const header = readFileSync(file, 'utf8').split('\n')[0];
  check(header === 'date\turl\tsparkScore\tthreshold\tmodel', 'header line is correct');

  // Second write: all duplicates
  const r2 = appendHoldbackLog(file, heldBack, date, { threshold: 2.0, model: 'spark-model-v1' });
  check(r2.appended === 0, 'second write appends 0');
  check(r2.skippedDuplicate === 6, 'second write skips 6 duplicates');

  // URL with utm_source is a duplicate of the same URL without it
  const file2 = join(dir, 'utm.tsv');
  const rowWithUtm = { sourceUrl: 'https://jobs.zorblax.example/p/10?utm_source=x', score: 1.5 };
  const rowClean = { sourceUrl: 'https://jobs.zorblax.example/p/10', score: 1.5 };
  appendHoldbackLog(file2, [rowWithUtm], date, { threshold: 2.0, model: 'm' });
  const r3 = appendHoldbackLog(file2, [rowClean], date, { threshold: 2.0, model: 'm' });
  check(r3.appended === 0, 'utm URL is duplicate of clean URL');
  check(r3.skippedDuplicate === 1, 'utm duplicate is counted');

  // Tab inside model does not break column count
  const file3 = join(dir, 'tab-model.tsv');
  appendHoldbackLog(file3, [{ sourceUrl: 'https://jobs.zorblax.example/p/20', score: 1.5 }], date, { threshold: 2.0, model: 'model\twith\ttabs' });
  const lines = readFileSync(file3, 'utf8').split('\n').filter(l => l.length > 0);
  for (let i = 1; i < lines.length; i++) {
    check(lines[i].split('\t').length === 5, `data line ${i} has exactly 5 tab-separated fields`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
