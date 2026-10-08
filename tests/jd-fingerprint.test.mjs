#!/usr/bin/env node

import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { makeSandbox } from './helpers/sandbox.mjs';
import {
  buildFingerprintIndex,
  findDuplicateJd,
  fingerprintBody,
  snapshotFingerprint,
} from '../lib/jd-fingerprint.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok ${msg}`); passed++; }
  else { console.log(`  fail ${msg}`); failed++; }
}

function body(seed = 'core') {
  return [
    `This ${seed} role owns roadmap, customer discovery, delivery, incident learning, stakeholder communication, analytics instrumentation, and careful execution across teams.`,
    'The candidate will translate ambiguous employer needs into reliable systems, partner with engineering and operations, document tradeoffs, and improve workflows.',
    'Success means shipping measurable outcomes, reducing manual effort, keeping feedback loops short, mentoring teammates, and creating durable operating habits.',
    'The work includes planning experiments, reviewing data, writing clear narratives, supporting adoption, and making sure implementation quality stays high.',
    'This paragraph adds enough realistic detail that fixture bodies are safely above the fingerprint threshold and never behave like tiny stubs.',
  ].join(' ');
}

function snapshot(text) {
  return ['Captured at one time', 'Source URL: https://jobs.example.test/globex/1', '---', text].join('\n');
}

function rawSnapshot(url, text) {
  return ['Captured at one time', `**Source URL:** ${url}`, '---', text].join('\n');
}

console.log('jd-fingerprint.test.mjs');

console.log('\n1. fingerprintBody');
{
  const a = fingerprintBody(snapshot(`<p>${body('alpha')}</p>`));
  const b = fingerprintBody(['Different header', '---', `<main>${body('alpha').replace(/\s+/g, '\n\t')}</main>`].join('\n'));
  const c = fingerprintBody(snapshot(`${body('alpha')} This changed sentence should alter the hash.`));
  check(a && b && a.hash === b.hash, 'header lines, whitespace, and HTML tags normalize to the same hash');
  check(a && c && a.hash !== c.hash, 'changed body text changes the hash');
  check(fingerprintBody('short body') === null, 'short body returns null');
  const once = fingerprintBody(snapshot(`${body('alpha')} Tom &amp; Jerry`));
  const plain = fingerprintBody(snapshot(`${body('alpha')} Tom & Jerry`));
  const escaped = fingerprintBody(snapshot(`${body('alpha')} Use &amp;lt;b&amp;gt; for bold`));
  const decodedTwice = fingerprintBody(snapshot(`${body('alpha')} Use <b> for bold`));
  check(once && plain && once.hash === plain.hash, 'an ampersand entity decodes to the same text as a plain ampersand');
  check(escaped && decodedTwice && escaped.hash !== decodedTwice.hash, 'an escaped entity is decoded once, not twice');
}

console.log('\n2. snapshotFingerprint');
const root = makeSandbox('jd-fingerprint');
mkdirSync(join(root, 'jds'), { recursive: true });
writeFileSync(join(root, 'jds', 'globex.md'), snapshot(body('snapshot')), 'utf8');
writeFileSync(join(root, 'secret.md'), snapshot(body('secret')), 'utf8');
{
  const a = snapshotFingerprint('jds/globex.md', root);
  const b = snapshotFingerprint('local:jds/globex.md', root);
  check(a && b && a.hash === b.hash, 'snapshot reads with and without local prefix');
  check(snapshotFingerprint('../secret.md', root) === null, 'snapshot outside jds returns null');
}

console.log('\n3. buildFingerprintIndex');
{
  const shared = body('shared');
  const rejected = body('rejected');
  const stub = body('numbered stub');
  const otherCompany = body('other company');
  writeFileSync(join(root, 'jds', 'globex-principal-widget-100.md'), rawSnapshot('https://jobs.example.test/globex/900100', shared), 'utf8');
  writeFileSync(join(root, 'jds', 'globex-principal-widget-99.md'), rawSnapshot('https://jobs.example.test/globex/900099', shared), 'utf8');
  writeFileSync(join(root, 'jds', 'globex-rejected-widget-50.md'), rawSnapshot('https://jobs.example.test/globex/900050', rejected), 'utf8');
  writeFileSync(join(root, 'jds', 'globex-no-response-widget-51.md'), rawSnapshot('https://jobs.example.test/globex/900051', rejected), 'utf8');
  writeFileSync(join(root, 'jds', '900123-globex-stub-2030-01-05.md'), rawSnapshot('https://jobs.example.test/globex/stub', stub), 'utf8');
  writeFileSync(join(root, 'jds', 'initech-other-widget-70.md'), rawSnapshot('https://jobs.example.test/initech/900070', otherCompany), 'utf8');

  const apps = [
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |',
    '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|',
    '| 900100 | 2030-01-01 | Zorblax Widgetry | Principal Widget Builder | 4.1/5 | Evaluated | - | - | [900100](reports/missing-900100.md) | - | https://jobs.example.test/globex/900100 |',
    '| 900099 | 2030-01-02 | Zorblax Widgetry | Principal Widget Builder | 4.2/5 | Passed | - | - | [900099](reports/missing-900099.md) | - | https://jobs.example.test/globex/900099 |',
    '| 900050 | 2030-01-03 | Zorblax Widgetry | Old Widget Role | 3.1/5 | Rejected | - | - | [900050](reports/missing-900050.md) | - | https://jobs.example.test/globex/900050 |',
    '| 900051 | 2030-01-04 | Zorblax Widgetry | Silent Widget Role | 3.1/5 | No Response | - | - | [900051](reports/missing-900051.md) | - | https://jobs.example.test/globex/900051 |',
    '| 900088 | 2030-01-05 | Zorblax Widgetry | Numbered Stub | 3.9/5 | Evaluated | - | - | [900088](reports/missing-900088.md) | - | https://jobs.example.test/globex/stub |',
    '| 900070 | 2030-01-06 | Quennox Ratchet Works | Other Widget Role | 4.0/5 | Evaluated | - | - | [900070](reports/missing-900070.md) | - | https://jobs.example.test/initech/900070 |',
  ].join('\n');
  const appsPath = join(root, 'applications.md');
  writeFileSync(appsPath, apps, 'utf8');

  const index = buildFingerprintIndex({ appsPath, rootDir: root, companies: new Set(['zorblaxwidgetry']) });
  const sharedHash = snapshotFingerprint('jds/globex-principal-widget-100.md', root).hash;
  const rejectedHash = snapshotFingerprint('jds/globex-rejected-widget-50.md', root).hash;
  const stubHash = snapshotFingerprint('jds/900123-globex-stub-2030-01-05.md', root).hash;
  const hit = findDuplicateJd(index, 'Zorblax Widgetry', sharedHash);
  check(hit && hit.num === 900099 && hit.status === 'Passed', 'lowest numbered matching row wins');
  check(findDuplicateJd(index, 'Zorblax Widgetry', rejectedHash) === null, 'Rejected and No Response rows are not indexed');
  check(findDuplicateJd(index, 'Zorblax Widgetry', stubHash) === null, 'report-number stub files are ignored');
  check(findDuplicateJd(index, 'Zorblax Widgetry', 'not-a-real-hash') === null, 'findDuplicateJd misses unknown hashes');
  check(findDuplicateJd(index, 'Quennox Ratchet Works', sharedHash) === null, 'same body under a different company is a miss');
  check(buildFingerprintIndex({ appsPath, rootDir: join(root, 'missing'), companies: new Set() }).size === 0, 'empty company set returns an empty index without scanning jds');
}

console.log('\n4. gate level');
{
  const source = readFileSync(new URL('../gate-pipeline.mjs', import.meta.url), 'utf8');
  check(!source.includes('TJK_DATA_DIR'), 'gate-pipeline does not expose a temp data dir hook, so child-process gate check is skipped');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
