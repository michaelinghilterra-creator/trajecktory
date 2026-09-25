#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  buildPool,
  generateQueries,
  nextSlice,
} from '../lib/discover-queries.mjs';
import { loadCursor, saveCursor } from '../lib/discover-rotation.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}

const titleFilter = {
  matrix: {
    seniority: ['Lead', 'Director', 'Head'],
    functions_bare: ['Widget Operations'],
    functions_ranked: ['Ratchet Analytics', 'Widget Operations'],
  },
};

test('generation is scoped, capped, deterministic, and deduplicated', () => {
  const first = generateQueries(titleFilter, { sites: ['jobs.ashbyhq.com', 'jobs.lever.co'] });
  const second = generateQueries(titleFilter, { sites: ['jobs.ashbyhq.com', 'jobs.lever.co'] });
  assert.deepEqual(first, second);
  assert.ok(first.length > 0);
  assert.equal(new Set(first).size, first.length);
  assert.ok(first.every(query => /^site:(?:jobs\.ashbyhq\.com|jobs\.lever\.co) /.test(query)));
  assert.ok(first.every(query => query.includes('"Lead of Widget Operations"') || query.includes('Ratchet Analytics')));
  assert.ok(first.every(query => query.length <= 380));
  assert.ok(first.every(query => query.split(/\s+/).length <= 45));
});

test('a long seniority list splits into multiple capped queries', () => {
  const seniority = Array.from({ length: 30 }, (_, index) => `Level ${index + 1}`);
  const queries = generateQueries({
    matrix: { seniority, functions_ranked: ['Quantum Widget Strategy'] },
  }, { sites: ['job-boards.greenhouse.io'] });
  assert.ok(queries.length > 1);
  assert.ok(queries.every(query => query.length <= 380 && query.split(/\s+/).length <= 45));
  for (const level of seniority) {
    assert.ok(queries.some(query => query.includes(`"${level} of Quantum Widget Strategy"`)));
    assert.ok(queries.some(query => query.includes(`"${level} Quantum Widget Strategy"`)));
  }
});

test('buildPool merges enabled ATS queries and deduplicates them', () => {
  const generated = generateQueries(titleFilter);
  const duplicate = generated[0];
  const configured = 'site:jobs.ashbyhq.com "Zorblax Widgetry Director"';
  const pool = buildPool({
    title_filter: titleFilter,
    search_queries: [
      { query: configured, enabled: true },
      { query: configured, enabled: true },
      { query: duplicate, enabled: true },
      { query: 'site:example.test "Quennox Ratchet Works"', enabled: true },
      { query: 'site:jobs.lever.co "Disabled Widget Lead"', enabled: false },
    ],
  });
  assert.deepEqual(pool.slice(0, generated.length), generated);
  assert.equal(pool.filter(query => query === configured).length, 1);
  assert.equal(pool.filter(query => query === duplicate).length, 1);
  assert.ok(!pool.some(query => query.includes('example.test') || query.includes('Disabled Widget')));
});

test('nextSlice wraps and returns the whole pool at most once', () => {
  const pool = ['a', 'b', 'c', 'd'];
  assert.deepEqual(nextSlice(pool, 3, 3), {
    queries: ['d', 'a', 'b'], nextCursor: 2, from: 4, to: 2, total: 4,
  });
  assert.deepEqual(nextSlice(pool, 2, 20), {
    queries: ['c', 'd', 'a', 'b'], nextCursor: 2, from: 3, to: 2, total: 4,
  });
});

test('cursor persistence starts safely and advances in a sandbox', () => {
  const dataDir = path.join(makeSandbox('discover-queries'), 'data');
  assert.equal(loadCursor(dataDir), 0);
  saveCursor(dataDir, 7);
  assert.equal(loadCursor(dataDir), 7);
  const cursorPath = path.join(dataDir, 'discover-rotation.json');
  assert.deepEqual(JSON.parse(readFileSync(cursorPath, 'utf8')), { cursor: 7 });
  writeFileSync(cursorPath, '{ corrupt');
  assert.equal(loadCursor(dataDir), 0);
  const rotation = nextSlice(['x', 'y', 'z'], loadCursor(dataDir), 2);
  saveCursor(dataDir, rotation.nextCursor);
  assert.equal(loadCursor(dataDir), 2);
});

console.log(`${passed} passed, 0 failed`);
