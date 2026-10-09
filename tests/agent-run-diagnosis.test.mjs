/**
 * agent-run-diagnosis.test.mjs
 *
 * An Agent Scan that writes nothing must say WHY from measured facts: what
 * scan.mjs reported and what the server did with each company the agent proposed.
 * Covers parseScanStats and diagnoseEmptyScan (dashboard-web/server/lib/agent-log.mjs)
 * and the proposed/skipped-name accounting in mergePortalAdditions.
 *
 * Run: node tests/agent-run-diagnosis.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import { diagnoseEmptyEval, diagnoseEmptyScan, parseScanStats } from '../dashboard-web/server/lib/agent-log.mjs';
import { mergePortalAdditions, renderTrackedCompanyList, TRACKED_LIST_END } from '../lib/portal-additions.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('agent-run-diagnosis.test.mjs');

const SCAN_OUTPUT = [
  'Scanning 12 companies via API (3 skipped)',
  '',
  'Portal Scan, 2030-01-05',
  'Companies scanned:     12',
  'Total jobs found:      3035',
  'Filtered by title:     3000 removed',
  'Geo-blocked:           20 removed',
  'Duplicates:            15 skipped',
  'New offers added:      0',
  'Rejects logged:        3020 (skipped_title/skipped_location)',
  '',
  'Errors (2):',
  '  x Example Co: 404',
  '',
  'Coverage alerts (3) boards that may be dead or migrated:',
].join('\n');

const st = parseScanStats(SCAN_OUTPUT);
check(st && st.companies === 12 && st.totalJobs === 3035, 'parseScanStats reads boards and total jobs');
check(st && st.filteredByTitle === 3000 && st.geoBlocked === 20 && st.duplicates === 15 && st.newOffers === 0, 'parseScanStats reads the drop counts and new offers');
check(st && st.boardErrors === 2 && st.coverageAlerts === 3, 'parseScanStats reads board errors and coverage alerts');
check(parseScanStats('hello world') === null && parseScanStats('') === null && parseScanStats(undefined) === null,
  'parseScanStats returns null for text that is not a scan summary');
const clean = parseScanStats('Companies scanned: 5\nTotal jobs found: 9\nNew offers added: 2');
check(clean && clean.boardErrors === 0 && clean.coverageAlerts === 0, 'a summary with no Errors block reports zero errors');

const allTracked = diagnoseEmptyScan({
  merge: { added: 0, rolesAdded: 0, proposed: 6, skippedDuplicate: 6, skippedDuplicateNames: ['Zorblax Widgetry', 'Quennox Ratchet Works'], errors: [], collisions: [], parseErrors: [] },
  webSearchCount: 15, scanStats: st,
});
check(allTracked && allTracked.code === 'all-tracked', 'every proposal already tracked gives all-tracked');
check(allTracked.message.includes('15 web searches') && allTracked.message.includes('proposed 6') && allTracked.message.includes('Zorblax Widgetry, Quennox Ratchet Works'),
  'all-tracked names the searches, the proposal count and the companies');
check(allTracked.message.includes('3035 jobs across 12 boards') && allTracked.message.includes('2 boards errored') && allTracked.message.includes('3 flagged'),
  'the scan.mjs health line is appended');

const noProposals = diagnoseEmptyScan({ merge: { added: 0, rolesAdded: 0, proposed: 0, parseErrors: ['no PORTAL_ADDITIONS block found in the agent output'] }, webSearchCount: 4 });
check(noProposals.code === 'no-proposals' && noProposals.message.includes('no PORTAL_ADDITIONS block'), 'no proposals surfaces the parse problem');

const noSearch = diagnoseEmptyScan({ merge: { added: 0, rolesAdded: 0, proposed: 0 }, webSearchCount: 0 });
check(noSearch.code === 'no-searches', 'zero web searches gives no-searches');

const mergeErr = diagnoseEmptyScan({ merge: { added: 0, error: 'portals.yml is not valid YAML' }, webSearchCount: 3 });
check(mergeErr.code === 'merge-error' && mergeErr.message.includes('not valid YAML'), 'a merge error is reported with its text');

check(diagnoseEmptyScan({ merge: null, webSearchCount: 3 }).code === 'merge-not-run', 'a merge that never ran is reported');
check(diagnoseEmptyScan({ merge: { added: 2, rolesAdded: 0, proposed: 2 }, webSearchCount: 3 }) === null, 'a run that added companies returns null');
check(diagnoseEmptyScan({ merge: { added: 0, rolesAdded: 4, proposed: 2 }, webSearchCount: 3 }) === null, 'a run that surfaced roles returns null');

const allDead = diagnoseEmptyScan({ merge: { added: 0, proposed: 2, skippedDead: 2, skippedDeadNames: ['Quennox Phantom Works (ashby/quennoxphantom)'] }, webSearchCount: 5 });
check(allDead.code === 'all-dead' && allDead.message.includes('Quennox Phantom Works (ashby/quennoxphantom)'), 'all-dead names the unreachable boards');

const mixed = diagnoseEmptyScan({ merge: { added: 0, proposed: 3, skippedDuplicate: 1, skippedDead: 1, collisions: [{ name: 'X' }], skippedDuplicateNames: ['Dup'], skippedDeadNames: ['Dead (lever/dead)'] }, webSearchCount: 5 });
check(mixed.code === 'all-skipped' && mixed.message.includes('1 already tracked') && mixed.message.includes('1 name collision'), 'a mixed outcome breaks down every skip reason');

const manyNames = diagnoseEmptyScan({ merge: { added: 0, proposed: 10, skippedDuplicate: 10, skippedDuplicateNames: Array.from({ length: 10 }, (_, i) => `Co${i}`) }, webSearchCount: 5 });
check(manyNames.message.includes('+2 more') && !manyNames.message.includes('Co9'), 'a long name list is capped at eight');

// mergePortalAdditions accounting, against an invented portals.yml.
const dir = makeSandbox('run-diagnosis');
const portals = path.join(dir, 'portals.yml');
fs.writeFileSync(portals, [
  'tracked_companies:',
  '  - name: Zorblax Widgetry',
  '    careers_url: https://job-boards.greenhouse.io/zorblaxwidgetry',
  '    api: https://boards-api.greenhouse.io/v1/boards/zorblaxwidgetry/jobs',
  '    enabled: true',
  '',
].join('\n'));
const m = await mergePortalAdditions(portals, [
  { ats: 'greenhouse', slug: 'zorblaxwidgetry', name: 'Zorblax Widgetry' },
  { ats: 'ashby', slug: 'quennoxphantom', name: 'Quennox Phantom Works' },
], { today: '2030-01-05', fetchImpl: async () => ({ ok: false }) });
check(m.proposed === 2, 'merge reports how many companies were proposed');
check(m.skippedDuplicate === 1 && m.skippedDuplicateNames[0] === 'Zorblax Widgetry', 'merge names the already-tracked company');
check(m.skippedDead === 1 && m.skippedDeadNames[0] === 'Quennox Phantom Works (ashby/quennoxphantom)', 'merge names the unreachable board');
const empty = await mergePortalAdditions(portals, [], { today: '2030-01-05' });
check(empty.proposed === 0 && Array.isArray(empty.skippedDuplicateNames), 'merge with no companies reports proposed 0');

// Tracked-company list handed to the scan agent.
const tracked = [
  { name: 'Zorblax Widgetry', careers_url: 'https://job-boards.greenhouse.io/zorblaxwidgetry' },
  { name: 'Quennox Ratchet Works', careers_url: 'https://jobs.ashbyhq.com/quennox-works-hq' },
  { name: 'zorblax widgetry', careers_url: 'https://job-boards.greenhouse.io/zorblaxwidgetry' },
  { name: 'Zorblax Package', api: 'https://api.lever.co/v0/postings/zorblaxpackage' },
  { name: '' },
  null,
];
const listed = renderTrackedCompanyList(tracked, { perLine: 2 });
check(listed.count === 3, 'the list dedupes by name and skips empty entries');
check(listed.text.includes('Quennox Ratchet Works (quennox-works-hq)'), 'a slug that differs from the name is shown');
check(!listed.text.includes('Zorblax Widgetry (zorblaxwidgetry)'), 'a slug that matches the name is not repeated');
check(listed.text.trimEnd().endsWith(`${TRACKED_LIST_END}: 3 companies`), 'the last line states the total so a truncated read is visible');
const big = renderTrackedCompanyList(Array.from({ length: 1600 }, (_, i) => ({ name: `Company ${i}` })));
check(big.text.split('\n').length < 400, 'a 1600 company list fits in a few hundred lines, well under a Read line cap');
check(big.count === 1600, 'every company is counted');

const partial = diagnoseEmptyScan({ merge: { added: 0, proposed: 2, skippedDuplicate: 2, skippedDuplicateNames: ['A', 'B'] }, webSearchCount: 5, trackedListComplete: false });
check(partial.message.includes('did not read the full tracked-company list'), 'all-tracked blames a partial read of the list');
const full = diagnoseEmptyScan({ merge: { added: 0, proposed: 2, skippedDuplicate: 2, skippedDuplicateNames: ['A', 'B'] }, webSearchCount: 5, trackedListComplete: true });
check(!full.message.includes('did not read'), 'no blame when the full list was read');

// Evaluate / Deep diagnosis.
check(diagnoseEmptyEval({ tsvDelta: 2 }) === null, 'a batch that wrote a TSV needs no diagnosis');
check(diagnoseEmptyEval({ mode: 'pipeline', pendingBefore: 0, toolCount: 3 }).code === 'queue-empty', 'an empty queue is named');
check(diagnoseEmptyEval({ mode: 'deep', pendingBefore: 0, toolCount: 3, resultText: 'done' }).code !== 'queue-empty', 'deep mode ignores the pipeline queue');
const noTsv = diagnoseEmptyEval({ pendingBefore: 5, reportsDelta: 3, toolCount: 20 });
check(noTsv.code === 'report-without-tsv' && noTsv.message.includes('3 reports were written'), 'reports without a TSV are named');
const deferred = diagnoseEmptyEval({ pendingBefore: 5, deferredDelta: 2, fetch: { failed: 2 }, webFetchCount: 2, toolCount: 12 });
check(deferred.code === 'all-deferred' && deferred.message.includes('2 postings') && deferred.message.includes('0 read, 0 closed, 2 failed'), 'deferrals are counted with the fetch-jd breakdown');
check(diagnoseEmptyEval({ pendingBefore: 5, fetch: { closed: 4 }, toolCount: 9 }).code === 'all-closed', 'all postings closed is named');
check(diagnoseEmptyEval({ pendingBefore: 5, fetch: { failed: 3 }, toolCount: 9, resultText: 'could not read' }).code === 'fetch-failed', 'all fetches failing is named');
check(diagnoseEmptyEval({ pendingBefore: 5, toolCount: 0, resultText: 'hi' }).code === 'no-work-attempted', 'no tool calls is named');
const asked = diagnoseEmptyEval({ pendingBefore: 5, toolCount: 4, resultText: 'Which of these 5 roles should I evaluate first?' });
check(asked.code === 'asked-question' && asked.message.includes('Which of these 5 roles'), 'a trailing question is quoted back');
const unknown = diagnoseEmptyEval({ pendingBefore: 5, toolCount: 7, resultText: 'All done.', resultSubtype: 'success', fetch: { ok: 2 } });
check(unknown.code === 'unknown' && unknown.message.includes('success') && unknown.message.includes('All done.'), 'an unexplained batch still records the subtype and last words');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
