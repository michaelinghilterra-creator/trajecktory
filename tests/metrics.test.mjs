#!/usr/bin/env node
/**
 * metrics.test.mjs — pins the CANONICAL progression engine and the funnel built
 * on it.
 *
 * Context: a full audit found SIX independent "how far did this application
 * get" implementations. `makeFurthestIdx` is the correct one — it takes the max
 * of live status, the dated event log, and the `[reached:]` notes tag — and the
 * remediation routes every surface through it. These tests pin its behaviour
 * FIRST so that when the other five are deleted, any number that moves is
 * attributable to a bug being fixed rather than a bug being introduced.
 *
 * The fixture deliberately includes the three shapes the broken engines get
 * wrong:
 *   - interview evidence that exists ONLY as an event (no tag)  → charts.jsx eff() misses it
 *   - a `[reached:]` tag BEHIND the live status                 → eff() lets the tag win
 *   - an off-funnel status lifted by an event                   → live-status engines return -1
 *
 * Runs against a temp DATA_DIR via TJK_DATA_DIR — never the user's real tracker.
 *
 * Run: node tests/metrics.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}
function eq(actual, expected, msg) {
  check(actual === expected, `${msg} (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`);
}

console.log('metrics.test.mjs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-metrics-'));
process.env.TJK_DATA_DIR = sandbox;

// ── Fixture ────────────────────────────────────────────────────────────────
// Columns: # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes
// Everything here is invented: greek-letter companies, an engineering role from
// the same fixture vocabulary tracker.test.mjs uses, and dates outside any real
// tracker range. Fixtures must never borrow a value from data/ — a test is a
// tracked file and ships to every user.
const row = (id, company, status, notes = '') =>
  `| ${id} | 2024-03-04 | ${company} | Staff Engineer | 4.0/5 | ${status} | ❌ | — | [${id}](reports/${id}.md) | ${notes} |`;

fs.writeFileSync(path.join(sandbox, 'applications.md'), [
  '# Applications Tracker',
  '',
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes |',
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|',
  row(1, 'Alpha', 'Applied'),
  row(2, 'Beta', 'Rejected'),                                   // + 1st Interview EVENT, no tag
  row(3, 'Gamma', 'Rejected', '[reached: Phone Screen]'),       // tag only, no events
  row(4, 'Delta', 'Offer', '[reached: Responded]'),             // STALE tag, behind live status
  row(5, 'Epsilon', 'Discarded'),                               // off-funnel, no evidence
  row(6, 'Iota', 'No Response'),                                // floors at Applied
  row(7, 'Eta', 'Evaluated'),
  row(8, 'Theta', 'SKIP'),                                      // + Applied EVENT lifts it
  '',
].join('\n'));

fs.writeFileSync(path.join(sandbox, 'status-events.tsv'),
  'app#\tdate\tstatus\tcompany\tlogged\n' +
  '2\t2024-03-11\t1st Interview\tBeta\t2024-03-11\n' +
  '8\t2024-03-18\tApplied\tTheta\t2024-03-18\n');

const { makeFurthestIdx, appReached, FUNNEL_ORDER, INTERVIEW_STAGES, reachedStage } =
  await import('../dashboard-web/server/lib/statuses.mjs');
const { parseApplicationsMd } = await import('../dashboard-web/server/lib/applications.mjs');
const { parseStatusEvents } = await import('../dashboard-web/server/lib/sidecars.mjs');
const { stageFunnelStats } = await import('../dashboard-web/server/lib/insights.mjs');

try {
  // ── makeFurthestIdx: the four signals it maxes over ──────────────────────
  const { furthestIdx, idxOf } = makeFurthestIdx(parseStatusEvents());
  const at = (id, status, notes) => furthestIdx({ id, status, notes });

  eq(at(1, 'Applied', ''), idxOf('Applied'), 'live status alone');
  eq(at(7, 'Evaluated', ''), idxOf('Evaluated'), 'Evaluated is rung 0, not "never entered"');
  eq(at(5, 'Discarded', ''), -1, 'off-funnel status with no evidence is -1 (never entered the funnel)');
  eq(at(6, 'No Response', ''), idxOf('Applied'), 'No Response floors at Applied (ghosting stays in the denominator)');
  eq(at(2, 'Rejected', ''), idxOf('1st Interview'),
    'EVENT-ONLY interview evidence is credited — the case charts.jsx eff() cannot see');
  eq(at(3, 'Rejected', '[reached: Phone Screen]'), idxOf('Phone Screen'), 'tag is credited when it is the only evidence');
  eq(at(4, 'Offer', '[reached: Responded]'), idxOf('Offer'),
    'a STALE tag never drags a row backwards — live status wins by max (eff() gets this wrong)');
  eq(at(8, 'SKIP', ''), idxOf('Applied'),
    'an event lifts an off-funnel row — live-status engines return -1 here');

  // ── appReached: the client-side mirror ───────────────────────────────────
  check(appReached({ reached: '1st Interview' }, 'Responded'), 'appReached prefers the stamped rung');
  check(!appReached({ reached: 'Applied' }, 'Responded'), 'appReached rejects a rung above the stamp');
  check(appReached({ reached: null, status: 'Offer' }, 'Applied'), 'appReached falls back to live status');
  check(appReached({ reached: null, status: 'Rejected', notes: '[reached: Phone Screen]' }, 'Responded'),
    'appReached falls back to the tag');
  check(!appReached({ reached: 'Offer' }, 'Nonsense Rung'), 'an unknown stage name is never "reached"');
  eq(reachedStage('[reached: 2nd Interview] and more'), '2nd Interview', 'tag parser handles multi-word labels');

  // ── parseApplicationsMd stamps `reached` on every row ────────────────────
  const rows = parseApplicationsMd();
  const byId = new Map(rows.map(r => [r.id, r]));
  eq(rows.length, 8, 'fixture parses to 8 rows');
  eq(byId.get(2).reached, '1st Interview', 'row 2 stamped from its event');
  eq(byId.get(4).reached, 'Offer', 'row 4 stamped from live status, not its stale tag');
  eq(byId.get(5).reached, null, 'row 5 (off-funnel, no evidence) stamps null');
  eq(byId.get(8).reached, 'Applied', 'row 8 (SKIP) stamped from its event');

  // ── stageFunnelStats: cumulative rungs + conversion ──────────────────────
  const f = stageFunnelStats();
  // REVISED 2026-07-24. This asserted 7, excluding row 5 (Discarded, no evidence
  // it was ever sent), on the rule "the rung counts rows that reached Evaluated".
  // That rule reads correctly on THIS fixture only because row 7 sits at status
  // `Evaluated`. On the real tracker nothing does — every evaluated row has since
  // moved to a terminal status — so the rung collapsed onto Applied (165 and 165)
  // and the chart published a 100% evaluate-to-apply conversion, hiding the single
  // largest drop in the pipeline.
  //
  // The first rung is membership, not progression: an evaluation is what creates
  // the row, so every row was evaluated, including the ones later declined. Only
  // `Closed` is excluded, matching every other denominator in the app. See
  // enteredFunnel() in statuses.mjs.
  eq(f.reached['Evaluated'], 8, 'the first rung counts every evaluated row, including ones later declined');
  eq(f.reached['Applied'], 6, 'Applied rung');
  eq(f.reached['Responded'], 3, 'Responded rung');
  eq(f.reached['Phone Screen'], 3, 'Phone Screen rung');
  eq(f.reached['1st Interview'], 2, '1st Interview rung');
  eq(f.reached['Offer'], 1, 'Offer rung');
  check(FUNNEL_ORDER.every((s, i) => i === 0 || f.reached[FUNNEL_ORDER[i - 1]] >= f.reached[s]),
    'rungs are monotonically non-increasing (a funnel cannot widen)');

  const evalToApplied = f.conversion.find(c => c.from === 'Evaluated');
  eq(evalToApplied.rate, 75, 'Evaluated→Applied conversion is 6/8: the declined row belongs in the denominator');
  check(f.reached['Evaluated'] > f.reached['Applied'],
    'the first rung is strictly wider than the second whenever a row was declined (the 100%-conversion regression)');

  // ── rejection attribution ────────────────────────────────────────────────
  eq(f.rejections.total, 3, 'terminal rows are Rejected + No Response');
  eq(f.rejections.byStage['1st Interview'], 1, 'a rejection is attributed to its furthest EVENT stage');
  eq(f.rejections.byStage['Phone Screen'], 1, 'a rejection is attributed to its tag when it has no events');
  eq(f.rejections.unknownStage, 1, 'a terminal row with no signal at all is counted as unknown, not as pre-interview');

  // ── Ladder drift: the browser's hardcoded copies vs states.yml ────────────
  // The browser never reads states.yml, so every ladder in src/ is a hand-kept
  // duplicate. That is exactly how `Bounced` came to be live in the data and
  // absent from every ladder, rendering as "Not Contacted". These checks fail
  // the build the moment a copy diverges instead of letting it rot silently.
  const yaml = (await import('js-yaml')).default;
  const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const doc = yaml.load(read('templates/states.yml'));
  const arrOf = (src, re) => { const m = src.match(re); return m ? m[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : null; };

  const dataJs = read('dashboard-web/src/data.js');
  const clientInterview = arrOf(dataJs, /window\.INTERVIEW_STAGES\s*=\s*\[([^\]]+)\]/);
  check(JSON.stringify(clientInterview) === JSON.stringify(INTERVIEW_STAGES),
    `data.js INTERVIEW_STAGES matches states.yml (client ${JSON.stringify(clientInterview)})`);

  const recJsx = read('dashboard-web/src/recruiters.jsx');
  const recIds = [...recJsx.matchAll(/\{\s*id:\s*'([^']+)'[^}]*stage:/g)].map(m => m[1]);
  const yamlRecLabels = (doc.recruiter_states || []).map(s => s.label);
  check(yamlRecLabels.every(l => recIds.includes(l)),
    `recruiters.jsx REC_STATUS covers every recruiter_state (missing: ${yamlRecLabels.filter(l => !recIds.includes(l)).join(', ') || 'none'})`);

  // `contacted` must agree too — the flag, not the stage, is what the rates use.
  const yamlContacted = (doc.recruiter_states || []).filter(s => s.contacted).map(s => s.label).sort();
  const jsxContacted = [...recJsx.matchAll(/\{\s*id:\s*'([^']+)'[^}]*contacted:\s*(true|false)/g)]
    .filter(m => m[2] === 'true').map(m => m[1]).sort();
  check(JSON.stringify(yamlContacted) === JSON.stringify(jsxContacted),
    `recruiters.jsx contacted flags match states.yml (yaml ${yamlContacted.length}, jsx ${jsxContacted.length})`);
  check(yamlContacted.includes('Dormant') && yamlContacted.includes('Bounced'),
    'Dormant and Bounced count as contacted — they are entered AFTER a message goes out');
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
