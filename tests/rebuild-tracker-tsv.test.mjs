import fs from 'node:fs';
import path from 'node:path';
import { main, tsvFromReport } from '../rebuild-tracker-tsv.mjs';
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

function report(overrides = {}) {
  const data = {
    schema: 'trajecktory-report/v1',
    id: 900001,
    date: '2030-01-02',
    company: 'Example Co',
    role: 'Director, Example Ops',
    url: 'https://example.com/jobs/1',
    score: 3.96,
    recommendation: 'Strong\tmatch\nwith | evidence',
    ...overrides,
  };
  return `---\n${JSON.stringify(data)}\n---\n\n# Report\n`;
}

const valid = tsvFromReport(report(), '900001-example-co-2030-01-02.md');
const fields = valid.ok ? valid.line.split('\t') : [];
check(valid.ok && fields.length === 9, 'valid report produces nine fields');
check(fields[4] === 'Evaluated', 'status field is Evaluated');
check(fields[5] === '4.0/5', 'score is rounded to one decimal');
check(fields[7] === '[900001](reports/900001-example-co-2030-01-02.md)', 'report link is exact');
check(fields[8]?.startsWith('[reinstated] '), 'rebuilt note starts with the reinstated source tag');
check(!/[\t\r\n|]/.test(fields[8] || ''), 'note removes tabs, newlines, and pipes');
check(valid.ok && valid.fileName === '900001-example-co.tsv', 'file name uses id and company slug');

const longNote = tsvFromReport(report({ recommendation: 'x'.repeat(250) }), 'report.md');
check(longNote.ok && longNote.line.split('\t')[8].length === 200, 'long note is cut to 200 characters');

const missingScoreData = JSON.parse(JSON.stringify({
  schema: 'trajecktory-report/v1',
  id: 900001,
  date: '2030-01-02',
  company: 'Example Co',
  role: 'Director, Example Ops',
  url: 'https://example.com/jobs/1',
}));
const missingScore = `---\n${JSON.stringify(missingScoreData)}\n---\n`;
check(tsvFromReport(missingScore, 'report.md').reason === 'missing score', 'missing score is identified');
check(tsvFromReport('# Report', 'report.md').reason === 'not a v1 report', 'legacy report is skipped');
check(tsvFromReport('---\n{broken json}\n---\n', 'report.md').reason === 'unparseable frontmatter', 'broken JSON is skipped');

const tmp = makeSandbox('rebuild-tsv');
const reportPath = path.join(tmp, '900001-example-co-2030-01-02.md');
const tmpOut = path.join(tmp, 'out');
fs.writeFileSync(reportPath, report(), 'utf8');
const firstCount = main(['--out', tmpOut, '--write', reportPath]);
const outputPath = path.join(tmpOut, '900001-example-co.tsv');
const firstContent = fs.readFileSync(outputPath, 'utf8');
check(firstCount === 1 && fs.existsSync(outputPath), 'write mode creates one TSV and returns one');
const secondCount = main(['--out', tmpOut, '--write', reportPath]);
check(secondCount === 1 && fs.readFileSync(outputPath, 'utf8') === firstContent, 'existing TSV is unchanged and still counts as OK');

const dryOut = path.join(tmp, 'dry-out');
const dryCount = main([reportPath, '--out', dryOut]);
check(dryCount === 1 && !fs.existsSync(dryOut), 'dry run returns one and writes nothing');

console.log(`rebuild-tracker-tsv: ${passed} passed, ${failed} failed`);
cleanSandboxes();
process.exit(failed > 0 ? 1 : 0);
