import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  candidateSlugs,
  isDead,
  main,
  probeCompany,
  slugFromApiUrl,
} from '../probe-board-migrations.mjs';
import { makeSandbox, cleanSandboxes } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;

function check(cond, msg) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${msg}`);
  } else {
    failed += 1;
    console.log(`FAIL ${msg}`);
  }
}

check(
  JSON.stringify(candidateSlugs('Example Widgets Inc.')) === JSON.stringify([
    'examplewidgets',
    'example-widgets',
    'examplewidgetshq',
    'examplewidgetsinc',
  ]),
  'multi-word candidates omit the generic first word',
);
const sampleSlugs = candidateSlugs('Sample Labs (Beta)');
check(sampleSlugs[0] === 'sample' && new Set(sampleSlugs).size === sampleSlugs.length, 'candidate slugs are de-duplicated');
check(!candidateSlugs('Quennox Ratchet Works').includes('quennox'), 'Quennox Ratchet Works does not probe the generic quennox slug');
check(!candidateSlugs('Vellorium Spindle Guild').includes('vellorium'), 'Vellorium Spindle Guild does not probe the generic vellorium slug');
check(isDead({ lastOutcome: '404' }), '404 is dead');
check(isDead({ lastOutcome: 'http_404' }), 'scanner http_404 outcome is dead');
check(isDead({ lastOutcome: 'zero', consecutiveZero: 12 }), 'long zero streak is dead');
check(!isDead({ lastOutcome: 'zero', consecutiveZero: 3 }), 'short zero streak is healthy');
check(!isDead({ lastOutcome: 'ok', consecutiveZero: 12 }), 'ok outcome is healthy');

check(slugFromApiUrl('https://boards-api.greenhouse.io/v1/boards/example/jobs') === 'example', 'greenhouse slug is extracted');
check(slugFromApiUrl('https://api.ashbyhq.com/posting-api/job-board/sample') === 'sample', 'ashby slug is extracted');
check(slugFromApiUrl('https://api.lever.co/v0/postings/example?mode=json') === 'example', 'lever slug is extracted');
check(slugFromApiUrl('https://apply.workable.com/api/v1/widget/accounts/sample') === 'sample', 'workable slug is extracted');
check(slugFromApiUrl('https://example.com/x') === null, 'unrecognized URL has no slug');

const ashbyOnlyFetch = async (url) => {
  if (url === 'https://api.ashbyhq.com/posting-api/job-board/examplewidgets') {
    return { ok: true, json: async () => ({ jobs: Array.from({ length: 7 }, () => ({})) }) };
  }
  return { ok: false };
};
const matches = await probeCompany('Example Widgets Inc.', 'workable', ashbyOnlyFetch);
check(
  matches.length === 1
    && matches[0].ats === 'ashby'
    && matches[0].slug === 'examplewidgets'
    && matches[0].jobs === 7
    && matches[0].confidence === 'slug-only',
  'probe returns the one live Ashby match',
);
const rankedMatches = await probeCompany('Example Widgets Inc.', 'workable', async (url) => {
  if (url === 'https://api.ashbyhq.com/posting-api/job-board/examplewidgets') {
    return { ok: true, json: async () => ({ jobs: Array.from({ length: 9 }, () => ({})) }) };
  }
  if (url === 'https://boards-api.greenhouse.io/v1/boards/example-widgets/jobs') {
    return { ok: true, json: async () => ({ jobs: [{}] }) };
  }
  if (url === 'https://boards-api.greenhouse.io/v1/boards/example-widgets') {
    return { ok: true, json: async () => ({ name: 'Example Widgets Inc.' }) };
  }
  return { ok: false };
});
check(rankedMatches[0]?.confidence === 'name-verified' && rankedMatches[0]?.slug === 'example-widgets',
  'name-verified match sorts before a busier slug-only match');
const thrownMatches = await probeCompany('Sample Labs (Beta)', 'lever', async () => {
  throw new Error('offline');
});
check(thrownMatches.length === 0, 'probe never throws when every request fails');

const tmp = makeSandbox('board-probe');
fs.mkdirSync(path.join(tmp, 'data'));
fs.writeFileSync(path.join(tmp, 'data/scan-coverage.json'), JSON.stringify({
  'https://apply.workable.com/api/v1/widget/accounts/old-example': {
    name: 'Example Widgets Inc.',
    ats: 'workable',
    consecutiveZero: 12,
    lastOutcome: 'zero',
  },
  'https://api.lever.co/v0/postings/sample?mode=json': {
    name: 'Sample Labs (Beta)',
    ats: 'lever',
    consecutiveZero: 0,
    lastOutcome: 'ok',
  },
}), 'utf8');
const results = await main(['--json', '--no-delay'], { fetchFn: ashbyOnlyFetch, root: tmp });
check(results.length === 1 && results[0].name === 'Example Widgets Inc.', 'main probes only the dead board');

const applyTmp = makeSandbox('board-probe-apply');
fs.mkdirSync(path.join(applyTmp, 'data'));
fs.writeFileSync(path.join(applyTmp, 'data/scan-coverage.json'), JSON.stringify({
  'https://apply.workable.com/api/v1/widget/accounts/old-example': {
    name: 'Example Widgets Inc.', ats: 'workable', consecutiveZero: 12, lastOutcome: 'zero',
  },
}), 'utf8');
const portalsFixture = [
  '# invented comment that must survive',
  'tracked_companies:',
  '  - name: Example Widgets Inc.',
  '    careers_url: https://apply.workable.com/old-example',
  '    notes: "invented old board"',
  '    enabled: true',
  '',
].join('\n');
fs.writeFileSync(path.join(applyTmp, 'portals.yml'), portalsFixture, 'utf8');
const verifiedFetch = async (url) => {
  if (url === 'https://boards-api.greenhouse.io/v1/boards/examplewidgets/jobs') {
    return { ok: true, json: async () => ({ jobs: [{ id: 1 }, { id: 2 }] }) };
  }
  if (url === 'https://boards-api.greenhouse.io/v1/boards/examplewidgets') {
    return { ok: true, json: async () => ({ name: 'Example Widgets Inc.' }) };
  }
  return { ok: false };
};
await main(['--apply', '--only', 'Example Widgets Inc.', '--no-delay'], { fetchFn: verifiedFetch, root: applyTmp });
const applied = fs.readFileSync(path.join(applyTmp, 'portals.yml'), 'utf8');
check(applied.includes('# invented comment that must survive'), 'apply preserves comments');
check(/old-example[\s\S]*Moved to greenhouse:examplewidgets\.[\s\S]*enabled: false/.test(applied), 'apply leaves a disabled tombstone with a move note');
check(/careers_url: https:\/\/job-boards\.greenhouse\.io\/examplewidgets/.test(applied), 'apply appends the new board entry');
check(/api: https:\/\/boards-api\.greenhouse\.io\/v1\/boards\/examplewidgets\/jobs/.test(applied), 'Greenhouse entry includes its API');
check(fs.readdirSync(applyTmp).some(name => name.startsWith('portals.yml.bak-probe-')), 'apply creates a timestamped backup');

const sameSlugTmp = makeSandbox('board-probe-same-slug-cross-ats');
fs.mkdirSync(path.join(sameSlugTmp, 'data'));
fs.writeFileSync(path.join(sameSlugTmp, 'data/scan-coverage.json'), JSON.stringify({
  'https://api.lever.co/v0/postings/zorblax?mode=json': {
    name: 'Zorblax Widgetry', ats: 'lever', consecutiveZero: 0, lastOutcome: '404',
  },
}), 'utf8');
fs.writeFileSync(path.join(sameSlugTmp, 'portals.yml'), [
  'tracked_companies:',
  '  - name: Zorblax Widgetry',
  '    careers_url: https://jobs.lever.co/zorblax',
  '    api: https://api.lever.co/v0/postings/zorblax',
  '    notes: "old Lever board"',
  '    enabled: true',
  '',
].join('\n'), 'utf8');
const zorblaxAshbyFetch = async (url) => {
  if (url === 'https://api.ashbyhq.com/posting-api/job-board/zorblax') {
    return { ok: true, json: async () => ({ organizationName: 'Zorblax Widgetry', jobs: [{ id: 1 }] }) };
  }
  return { ok: false };
};
await main(['--apply', '--only', 'Zorblax Widgetry', '--no-delay'], { fetchFn: zorblaxAshbyFetch, root: sameSlugTmp });
const sameSlugApplied = fs.readFileSync(path.join(sameSlugTmp, 'portals.yml'), 'utf8');
const sameSlugCompanies = yaml.load(sameSlugApplied).tracked_companies;
check(sameSlugCompanies[0].enabled === false, 'same-slug cross-ATS apply disables the old entry');
check(sameSlugCompanies[0].notes.includes('Moved to ashby:zorblax.'),
  'same-slug cross-ATS apply adds the moved-to note to the old entry');
check(/careers_url: https:\/\/jobs\.ashbyhq\.com\/zorblax/.test(sameSlugApplied),
  'same-slug cross-ATS apply appends the new board entry');

const unlocatableTmp = makeSandbox('board-probe-unlocatable-old-entry');
fs.mkdirSync(path.join(unlocatableTmp, 'data'));
fs.writeFileSync(path.join(unlocatableTmp, 'data/scan-coverage.json'), fs.readFileSync(path.join(sameSlugTmp, 'data/scan-coverage.json')));
const unlocatableFixture = [
  'tracked_companies:',
  '  - { name: Zorblax Widgetry, careers_url: https://jobs.lever.co/zorblax, api: https://api.lever.co/v0/postings/zorblax, enabled: true }',
  '',
].join('\n');
fs.writeFileSync(path.join(unlocatableTmp, 'portals.yml'), unlocatableFixture, 'utf8');
const refusalLogs = [];
const originalLog = console.log;
console.log = (...args) => refusalLogs.push(args.join(' '));
try {
  await main(['--apply', '--only', 'Zorblax Widgetry', '--no-delay'], { fetchFn: zorblaxAshbyFetch, root: unlocatableTmp });
} finally {
  console.log = originalLog;
}
check(refusalLogs.some((line) => line.includes('REFUSE Zorblax Widgetry: old company text block could not be located')),
  'an unlocatable old entry prints a refusal reason');
check(fs.readFileSync(path.join(unlocatableTmp, 'portals.yml'), 'utf8') === unlocatableFixture,
  'an unlocatable old entry leaves the file unchanged');

const refuseTmp = makeSandbox('board-probe-refuse');
fs.mkdirSync(path.join(refuseTmp, 'data'));
fs.writeFileSync(path.join(refuseTmp, 'data/scan-coverage.json'), fs.readFileSync(path.join(applyTmp, 'data/scan-coverage.json')));
fs.writeFileSync(path.join(refuseTmp, 'portals.yml'), portalsFixture, 'utf8');
await main(['--apply', '--only', 'Example Widgets Inc.', '--no-delay'], { fetchFn: ashbyOnlyFetch, root: refuseTmp });
check(fs.readFileSync(path.join(refuseTmp, 'portals.yml'), 'utf8') === portalsFixture, 'slug-only apply is refused without the override');
check(!fs.readdirSync(refuseTmp).some(name => name.startsWith('portals.yml.bak-probe-')), 'a refused migration creates no backup');

console.log(`probe-board-migrations: ${passed} passed, ${failed} failed`);
cleanSandboxes();
process.exit(failed > 0 ? 1 : 0);
