import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeSandbox('report-data-review');
const dataDir = join(sandbox, 'data');
mkdirSync(dataDir, { recursive: true });

const row = (id, company, status) => `| ${id} | 2030-03-01 | ${company} | Example Cog Lead | 0.11/5 | ${status} | no | example-${id}.docx | [${id}](https://example.test/r/${id}) | Invented fixture | https://example.test/jobs/${id} |`;
writeFileSync(join(dataDir, 'applications.md'), [
  '# Invented Applications Tracker', '', TRACKER_HEADER, TRACKER_SEPARATOR,
  row(900001, 'Zorblax Widgetry', 'No Response'),
  row(900002, 'Quennox Ratchet Works', 'No Response'),
  row(900003, 'Zorblax Widgetry', 'Applied'),
  row(900004, 'Quennox Ratchet Works', 'No Response'),
  '',
].join('\n'), 'utf8');
const reply = (date, subject, tag, body) => ({ timestamp: `${date}T10:00:00.000Z`, text: `### Reply logged (${date})\nhr@example.test: ${subject} [${tag}]\n\n${body}` });
writeFileSync(join(dataDir, 'app-notes.json'), `${JSON.stringify({
  900001: [reply('2030-03-08', 'Update on your application', 'negative', 'Unfortunately we will not be moving forward.')],
  900002: [reply('2030-03-09', 'Thanks for your time, let us know a good time to talk', 'positive', '')],
  900003: [reply('2030-03-10', 'Update on your application', 'negative', 'Unfortunately we will not be moving forward.')],
}, null, 2)}\n`, 'utf8');
writeFileSync(join(dataDir, 'twc-overrides.json'), `${JSON.stringify({
  applications: {},
  interviews: [
    { appId: '900001', stage: 'Phone Screen', date: '2030-03-08', note: 'no reference' },
    { appId: '900002', stage: 'Phone Screen', date: '2030-03-09', evidence_ref: { kind: 'message_id', id: 'msg-900002' } },
    { appId: '900004', stage: 'Phone Screen', date: '2030-03-10', evidence_ref: { kind: 'file', id: 'data/missing-evidence.md' } },
  ],
  exclude: [],
  add: [],
}, null, 2)}\n`, 'utf8');

function snapshot() {
  const values = {};
  for (const name of readdirSync(dataDir)) values[name] = readFileSync(join(dataDir, name), 'utf8');
  return JSON.stringify(values);
}

function run(args) {
  return spawnSync(process.execPath, [join(root, 'report-data-review.mjs'), ...args], {
    encoding: 'utf8',
    env: { ...process.env, TJK_DATA_DIR: dataDir },
  });
}

const before = snapshot();
const json = run(['--json']);
check(json.status === 0, 'the report exits 0');
const review = JSON.parse(json.stdout);
const items = new Map(review.status_mismatches.items.map(item => [String(item.application_id), item]));
check(review.status_mismatches.checked === 3 && review.status_mismatches.with_messages === 2, 'three No Response applications are checked and two have replies');
check(items.get('900001')?.type === 'rejection_after_no_response' && items.get('900001').proposed.status === 'Rejected', 'a rejection reply is proposed as Rejected');
check(items.get('900001')?.company === 'Zorblax Widgetry' && items.get('900001')?.role === 'Example Cog Lead', 'the item carries the company and role');
check(items.get('900002')?.type === 'reply_after_no_response' && items.get('900002').proposed === null, 'a human reply is listed with no proposal');
check(!items.has('900003') && !items.has('900004'), 'an Applied application and a No Response with no reply are not listed');
check(review.override_evidence.total === 3 && review.override_evidence.ok === 1, 'one of three overrides cites evidence that resolves');
const reasons = new Map(review.override_evidence.gaps.map(gap => [gap.appId, gap.reason]));
check(reasons.get('900001') === 'no_evidence' && reasons.get('900004') === 'unresolved_evidence', 'a missing reference and an unresolved file are reported with reasons');

const text = run([]);
check(text.status === 0 && /#900001 Zorblax Widgetry/.test(text.stdout) && /propose Rejected dated 2030-03-08/.test(text.stdout), 'the readable report lists the rejection with its proposal');
check(!/#900002/.test(text.stdout) && /1 more have a human reply/.test(text.stdout), 'the readable report counts plain replies instead of listing them');
check(/#900002/.test(run(['--all']).stdout), '--all lists the plain replies too');
check(/message and calendar references are not checked/i.test(text.stdout), 'the report says what it cannot check');
check(snapshot() === before, 'the report changes no data file');

const empty = join(sandbox, 'empty');
mkdirSync(empty, { recursive: true });
const none = spawnSync(process.execPath, [join(root, 'report-data-review.mjs'), '--json'], { encoding: 'utf8', env: { ...process.env, TJK_DATA_DIR: empty } });
const noneReview = JSON.parse(none.stdout);
check(none.status === 0 && noneReview.status_mismatches.checked === 0 && noneReview.override_evidence.total === 0, 'an empty data folder gives an empty report');

console.log(`report-data-review: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
