#!/usr/bin/env node

import assert from 'node:assert/strict';
import { evaluateFloors, FLOORS } from '../dashboard-web/server/lib/review-thresholds.mjs';

assert.deepEqual(Object.keys(FLOORS), [
  'verifiedTouches',
  'linkedinConnects',
  'cadencePct',
]);
assert.equal(Object.hasOwn(FLOORS, 'influencerEngagements'), false);

const currentMetrics = {
  verifiedTouches: { value: 13, available: true },
  linkedinConnects: { value: 49, available: true },
  influencerEngagements: { value: 58, available: true },
  cadencePct: { available: false },
};
const current = evaluateFloors(currentMetrics);

assert.equal(current.results.some(row => row.key === 'influencerEngagements'), false);
assert.deepEqual(current.results, [
  { key: 'verifiedTouches', label: 'Verified touches sent', value: 13, floor: 13, unit: '', met: true, available: true },
  { key: 'linkedinConnects', label: 'LinkedIn connects sent', value: 49, floor: 50, unit: '', met: false, available: true },
  { key: 'cadencePct', label: 'Cadence adherence', value: null, floor: 70, unit: '%', met: null, available: false },
]);
assert.deepEqual(current.missed, ['linkedinConnects']);
assert.deepEqual(current.notLogged, ['cadencePct']);
assert.equal(current.allMet, false);

const frozenHistoricalMetrics = {
  verifiedTouches: { value: 14, available: true },
  linkedinConnects: { value: 51, available: true },
  cadencePct: { value: 72, available: true },
};
const historical = evaluateFloors(frozenHistoricalMetrics);

assert.equal(historical.results.length, 3);
assert.equal(historical.results.every(row => row.met === true), true);
assert.deepEqual(historical.missed, []);
assert.deepEqual(historical.notLogged, []);
assert.equal(historical.allMet, true);

console.log('influencer-floor.test.mjs passed');
