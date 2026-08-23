#!/usr/bin/env node

import { weeklyMetrics } from '../dashboard-web/server/lib/weekly-metrics.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

console.log('source-mix.test.mjs');

const base = {
  weekStart: '2026-08-17',
  weekEnd: '2026-08-23',
  applications: [
    { id: 8101, date: '2026-08-17', score: 3.3, source: 'API Scan', company: 'Invented One', role: 'Synthetic Role One' },
    { id: 8102, date: '2026-08-18', score: 4.0, source: 'Agent Scan', company: 'Invented Two', role: 'Synthetic Role Two' },
    { id: 8103, date: '2026-08-19', score: 4.7, source: 'Self-sourced', company: 'Invented Three', role: 'Synthetic Role Three' },
    { id: 8104, date: '2026-08-20', score: 4.4, source: 'Referral', company: 'Invented Four', role: 'Synthetic Role Four' },
    { id: 8105, date: '2026-08-10', score: 5.0, source: 'API Scan', company: 'Invented Five', role: 'Synthetic Role Five' },
  ],
};
const mix = weeklyMetrics(base).sourceMix;
check(mix.value.scanFound === 2, 'API Scan and Agent Scan count together as scan-found');
check(mix.value.selfSourced === 1 && mix.value.scanFound + mix.value.selfSourced === 3, 'Referral is in neither source bucket');
check(mix.value.scanFoundAtOrAbove3_3 === 2, 'the 3.3 threshold is inclusive');

const empty = weeklyMetrics({ weekStart: base.weekStart, weekEnd: base.weekEnd, applications: [] }).sourceMix;
check(empty.available && empty.value.scanFound === 0 && empty.value.selfSourced === 0 && empty.value.scanFoundAtOrAbove3_3 === 0, 'an empty week is an available zero measurement');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
