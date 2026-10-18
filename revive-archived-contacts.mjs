#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './dashboard-web/server/config.mjs';
import { parseApplicationsMd } from './dashboard-web/server/lib/applications.mjs';
import { contactIdsToRevive } from './dashboard-web/server/lib/contact-revive.mjs';
import { OUTREACH_ELIGIBLE_STATUSES } from './dashboard-web/server/lib/statuses.mjs';
import { parseTargetTalentMd, updateTTLine } from './dashboard-web/server/lib/target-talent.mjs';
import { companiesMatchForOutreach } from './lib/identity.mjs';

const apply = process.argv.includes('--apply');
const apps = parseApplicationsMd();
const ttRows = parseTargetTalentMd();
const liveCompanies = [...new Set(apps
  .filter(app => OUTREACH_ELIGIBLE_STATUSES.includes(app.status))
  .map(app => String(app.company || '').trim())
  .filter(Boolean))];

const revivedById = new Map();
for (const company of liveCompanies) {
  for (const revival of contactIdsToRevive(apps, ttRows, company)) {
    if (!revivedById.has(revival.id)) revivedById.set(revival.id, revival);
  }
}

const rowsById = new Map(ttRows.map(row => [row.id, row]));
const groups = new Map();
for (const revival of revivedById.values()) {
  const company = rowsById.get(revival.id)?.company || '(unknown company)';
  if (!groups.has(company)) groups.set(company, []);
  groups.get(company).push(revival);
}

const skipped = { manualArchiveMarker: 0, noRevive: 0, noLiveApplication: 0 };
for (const row of ttRows) {
  if (row.status !== 'Archived' || revivedById.has(row.id)) continue;
  const notes = String(row.notes || '');
  if (/Archived \d{4}-\d{2}-\d{2}:/.test(notes)) skipped.manualArchiveMarker++;
  else if (notes.includes('[no-revive]')) skipped.noRevive++;
  else if (!apps.some(app => OUTREACH_ELIGIBLE_STATUSES.includes(app.status)
    && companiesMatchForOutreach(app.company, row.company))) skipped.noLiveApplication++;
}

console.log(`Archived TA contact revival ${apply ? '(apply)' : '(dry run)'}`);
console.log('Company | Count | Restored statuses');
for (const [company, revivals] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const statusCounts = new Map();
  for (const revival of revivals) statusCounts.set(revival.status, (statusCounts.get(revival.status) || 0) + 1);
  const statuses = [...statusCounts.entries()].map(([status, count]) => `${status}: ${count}`).join(', ');
  console.log(`${company} | ${revivals.length} | ${statuses}`);
}
console.log(`Total: ${revivedById.size}`);
console.log(`Skipped manual archive marker: ${skipped.manualArchiveMarker}`);
console.log(`Skipped [no-revive]: ${skipped.noRevive}`);
console.log(`Skipped no live application: ${skipped.noLiveApplication}`);

if (!apply) {
  console.log('Dry run only. Run with --apply to write these changes.');
  process.exit(0);
}

if (revivedById.size === 0) {
  console.log('Nothing to revive.');
  process.exit(0);
}

const now = new Date();
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
const backupDir = path.join(DATA_DIR, `backups-manual-${stamp}-revive`);
try {
  fs.mkdirSync(backupDir);
  fs.copyFileSync(path.join(DATA_DIR, 'target-talent.md'), path.join(backupDir, 'target-talent.md'));
  const eventStore = path.join(DATA_DIR, 'event-store.json');
  if (fs.existsSync(eventStore)) fs.copyFileSync(eventStore, path.join(backupDir, 'event-store.json'));
} catch (error) {
  console.error(`Refusing to apply because the backup failed: ${error.message}`);
  process.exit(1);
}

let updated = 0;
for (const revival of revivedById.values()) {
  if (updateTTLine(revival.id, { status: revival.status, notes: revival.notes })) updated++;
}
console.log(`Applied: ${updated}`);
