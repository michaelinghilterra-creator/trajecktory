#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearClosedFromNeedsManual } from '../lib/needs-manual.mjs';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, name) {
  if (condition) { console.log(`  ok ${name}`); passed++; }
  else { console.log(`  FAIL ${name}`); failed++; }
}

console.log('needs-manual.test.mjs');

const dir = makeRepoSandbox(process.cwd(), 'needs-manual-test');
try {
  const needsManualPath = join(dir, 'needs-manual-jd.tsv');
  const pipelinePath = join(dir, 'pipeline.md');
  const gateHistoryPath = join(dir, 'gate-history.tsv');
  const goneUrl = 'https://job-boards.greenhouse.io/zorblaxwidgetry/jobs/700001';
  const liveUrl = 'https://jobs.lever.co/quennoxratchet/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const unknownUrl = 'https://zorblax.wd1.myworkdayjobs.com/en-US/Careers/job/Ratchet-Keeper';
  const unrelatedUrl = 'https://jobs.example.test/flibber/other-role';
  const needsText = [
    'url\tcompany\trole',
    `${goneUrl}\tZorblax Widgetry\tWidget Keeper`,
    `${liveUrl}\tQuennox Ratchet Works\tRatchet Tuner`,
    `${unknownUrl}\tFlibber Analytics\tSignal Reader`,
    `${goneUrl}\tZorblax Widgetry\tSenior Widget Keeper`,
    '',
  ].join('\n');
  const pipelineText = [
    '# Pipeline',
    `- [x] ${goneUrl} | Zorblax Widgetry | Widget Keeper`,
    `- [ ] ${goneUrl} | Zorblax Widgetry | Senior Widget Keeper`,
    `- [ ] ${liveUrl} | Quennox Ratchet Works | Ratchet Tuner`,
    `- [x] ${unknownUrl} | Flibber Analytics | Signal Reader`,
    `- [ ] ${unrelatedUrl} | Flibber Analytics | Other Role`,
    `- [!] ${goneUrl} | Zorblax Widgetry | Archived Widget Keeper`,
    '',
  ].join('\n');
  const gateText = 'date\turl\tcompany\trole\tresult\treason\n';
  writeFileSync(needsManualPath, needsText);
  writeFileSync(pipelinePath, pipelineText);
  writeFileSync(gateHistoryPath, gateText);

  const calls = [];
  const probe = async (url) => {
    calls.push(url);
    if (url === goneUrl) return { verdict: 'gone', reason: 'greenhouse: job removed (404)' };
    if (url === liveUrl) return { verdict: 'live', reason: 'lever: job found (200)' };
    return { verdict: 'unknown', reason: 'no ATS probe for this host' };
  };

  const beforeNeeds = readFileSync(needsManualPath);
  const beforePipeline = readFileSync(pipelinePath);
  const beforeGate = readFileSync(gateHistoryPath);
  const dry = await clearClosedFromNeedsManual({ needsManualPath, pipelinePath, gateHistoryPath, probe, apply: false, today: '2030-04-05' });
  check(dry.checked === 3 && dry.closed.length === 2 && dry.kept === 2 && dry.unknown === 1, 'dry run reports rows and distinct probes');
  check(calls.filter((url) => url === goneUrl).length === 1, 'duplicate URL is probed once');
  check(readFileSync(needsManualPath).equals(beforeNeeds), 'dry run preserves needs manual bytes');
  check(readFileSync(pipelinePath).equals(beforePipeline), 'dry run preserves pipeline bytes');
  check(readFileSync(gateHistoryPath).equals(beforeGate), 'dry run preserves gate history bytes');

  calls.length = 0;
  const applied = await clearClosedFromNeedsManual({ needsManualPath, pipelinePath, gateHistoryPath, probe, apply: true, today: '2030-04-05' });
  check(applied.closed.length === 2 && !applied.error, 'apply reports both closed rows');
  check(calls.filter((url) => url === goneUrl).length === 1, 'apply probes the duplicate URL once');
  const expectedNeeds = [
    'url\tcompany\trole',
    `${liveUrl}\tQuennox Ratchet Works\tRatchet Tuner`,
    `${unknownUrl}\tFlibber Analytics\tSignal Reader`,
    '',
  ].join('\n');
  check(readFileSync(needsManualPath, 'utf8') === expectedNeeds, 'apply removes only gone rows and preserves remaining lines');

  const gateAfter = readFileSync(gateHistoryPath, 'utf8');
  const expiredRows = gateAfter.split('\n').filter((line) => line.split('\t')[1] === goneUrl);
  check(expiredRows.length === 2, 'gate history receives one row per closed posting');
  check(expiredRows.every((line) => line.includes('\texpired\tats-gone: greenhouse: job removed (404)')), 'gate history records expired ATS reasons');

  const pipelineAfter = readFileSync(pipelinePath, 'utf8');
  check(pipelineAfter.includes(`- [!] ${goneUrl} | Zorblax Widgetry | Widget Keeper — gated: closed (posting removed)`), 'done matching row becomes dead');
  check(pipelineAfter.includes(`- [!] ${goneUrl} | Zorblax Widgetry | Senior Widget Keeper — gated: closed (posting removed)`), 'open matching row becomes dead');
  check(pipelineAfter.includes(`- [ ] ${unrelatedUrl} | Flibber Analytics | Other Role`), 'unrelated row stays open');
  check(pipelineAfter.includes(`- [!] ${goneUrl} | Zorblax Widgetry | Archived Widget Keeper`), 'already dead row stays unchanged');

  const stableNeeds = readFileSync(needsManualPath);
  const stablePipeline = readFileSync(pipelinePath);
  const stableGate = readFileSync(gateHistoryPath);
  const again = await clearClosedFromNeedsManual({ needsManualPath, pipelinePath, gateHistoryPath, probe, apply: true, today: '2030-04-05' });
  check(again.closed.length === 0, 'second apply finds no closed rows');
  check(readFileSync(needsManualPath).equals(stableNeeds) && readFileSync(pipelinePath).equals(stablePipeline) && readFileSync(gateHistoryPath).equals(stableGate), 'second apply writes nothing');

  const allGonePath = join(dir, 'all-gone-needs-manual.tsv');
  writeFileSync(allGonePath, 'url\tcompany\trole\nhttps://example.test/gone-a\tFlibber Analytics\tHead of Fictional Ops\n');
  await clearClosedFromNeedsManual({
    needsManualPath: allGonePath, pipelinePath: join(dir, 'all-gone-pipeline.md'), gateHistoryPath: join(dir, 'all-gone-gate.tsv'),
    probe: async () => ({ verdict: 'gone', reason: 'invented: removed' }), apply: true, today: '2030-04-05',
  });
  check(readFileSync(allGonePath, 'utf8') === 'url\tcompany\trole\n', 'clearing every row leaves the header WITH a trailing newline so the next appended row stays on its own line');

  const missingPath = join(dir, 'missing-needs-manual.tsv');
  const missingPipeline = join(dir, 'missing-pipeline.md');
  const missingGate = join(dir, 'missing-gate.tsv');
  const missing = await clearClosedFromNeedsManual({ needsManualPath: missingPath, pipelinePath: missingPipeline, gateHistoryPath: missingGate, probe, apply: true });
  check(missing.checked === 0 && missing.closed.length === 0 && missing.kept === 0 && missing.unknown === 0, 'missing needs manual file returns zeros');
  check(!existsSync(missingPath) && !existsSync(missingPipeline) && !existsSync(missingGate), 'missing input creates no files');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
