#!/usr/bin/env node
// Definitions v1 section 3 removed the 45 day Ghosted label, the archive button, the "Expired before action"
// tile and the business day reminder for applications. This suite fails if any of them comes back.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSandbox } from './helpers/sandbox.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = makeSandbox('ghosted-removed');
process.env.TJK_DATA_DIR = sandbox;

const daysBack = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const row = (id, date, company, role, status) => `| ${id} | ${date} | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
fs.writeFileSync(path.join(sandbox, 'applications.md'),
  '# Applications Tracker\n\n' +
  '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
  '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
  row(900001, daysBack(400), 'Zorblax Widgetry', 'Example Cog Lead', 'Applied') +
  row(900002, daysBack(3), 'Zorblax Widgetry', 'Example Pulley Director', 'Phone Screen') +
  row(900003, daysBack(2), 'Quennox Ratchet Works', 'Example Gear Manager', '1st Interview'),
  'utf8');
fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n', 'utf8');

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}

const { computeStaleApps, STALE_THRESHOLD_BY_STATUS } = await import('../dashboard-web/server/lib/followups.mjs');

console.log('ghosted-removed.test.mjs');

// Structural: none of the removed identifiers or texts exists in the UI source or the server.
const REMOVED = [
  'Expired before action',
  'archive-ghosted',
  'archiveGhosted',
  'computeGhostedCandidates',
  'GHOST_DAYS',
  'ghostedCandidates',
  'ghostDays',
  'likely ghosted',
  '_businessDaysAgo',
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file, out);
    else if (/\.(mjs|js|jsx)$/.test(name)) out.push(file);
  }
  return out;
}

function findRemoved(files) {
  const found = [];
  for (const [name, text] of files) {
    for (const term of REMOVED) if (text.includes(term)) found.push(`${name}: ${term}`);
  }
  return found;
}

const files = [
  ...walk(path.join(root, 'dashboard-web', 'src')),
  ...walk(path.join(root, 'dashboard-web', 'server')),
].map(file => [path.relative(root, file).split(path.sep).join('/'), fs.readFileSync(file, 'utf8')]);

check(files.length > 100, `scanned ${files.length} UI and server files`);
const leftovers = findRemoved(files);
check(leftovers.length === 0, `no removed feature is present${leftovers.length ? `: ${leftovers.join('; ')}` : ''}`);
check(findRemoved([['x.jsx', '<span>Expired before action</span>']]).length === 1, 'the scan can fail on a returned tile');
check(findRemoved([['x.mjs', "router.post('/api/followups/archive-ghosted', h)"]]).length === 1, 'the scan can fail on a returned route');
check(findRemoved([['x.mjs', 'const ghostedCandidates = []']]).length === 1, 'the scan can fail on a returned response field');
check(findRemoved([['x.mjs', 'const days = _daysAgo(x);']]).length === 0, 'the scan does not flag the calendar day helper');

// Behavior: an application nobody answered has no reminder; interview stages use calendar days.
const staleIds = computeStaleApps().map(item => item.id);
check(!staleIds.includes(900001), 'an application applied to long ago is not in the stale list');
check(staleIds.includes(900002), 'an interview stage quiet for 3 calendar days is in the stale list');
check(!staleIds.includes(900003), 'an interview stage quiet for 2 calendar days is not yet in the stale list');
check(!('Applied' in STALE_THRESHOLD_BY_STATUS), 'there is no stale threshold for Applied');

// Behavior: the removed route is gone and the stale response no longer carries the ghosted fields.
const express = (await import('express')).default;
const { router } = await import('../dashboard-web/server/routes/followups.mjs');
const app = express();
app.use(express.json());
app.use(router);
const server = app.listen(0);
await new Promise(resolve => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

try {
  const before = fs.readFileSync(path.join(sandbox, 'applications.md'), 'utf8');
  const archive = await fetch(`${base}/api/followups/archive-ghosted`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: [900001] }),
  });
  check(archive.status === 404, `the archive route answers 404 (got ${archive.status})`);
  check(fs.readFileSync(path.join(sandbox, 'applications.md'), 'utf8') === before, 'the tracker is untouched after the request');

  const stale = await fetch(`${base}/api/followups/stale`);
  const body = await stale.json();
  check(stale.status === 200, `the stale route still answers 200 (got ${stale.status})`);
  check(!('ghostedCandidates' in body) && !('ghostDays' in body), 'the stale response has no ghosted fields');
  check(body.thresholds && !('Applied' in body.thresholds), 'the stale thresholds carry no entry for Applied');
} finally {
  await new Promise(resolve => server.close(resolve));
}

console.log(`\nghosted-removed: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
