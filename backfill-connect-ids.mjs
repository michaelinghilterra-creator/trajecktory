#!/usr/bin/env node
/**
 * backfill-connect-ids.mjs — one-time migration for data/linkedin-connects.json.
 *
 * WHY
 * The connects ledger historically stored only { date, name, source }. lib/connects.mjs
 * now also records the target-talent contact `id` on every new connect, so the Activity
 * Tracker (lib/twc.mjs) can join a connect back to its contact by id instead of by a
 * fragile name string. Entries written before that change have no id. This stamps the id
 * onto them by matching the stored name to a UNIQUE target-talent contact.
 *
 * SAFE BY DEFAULT
 * Dry-run unless --apply is passed. It only ADDS an `id` to entries that have none and
 * match exactly one contact; it never edits date/name/source, never removes an entry, and
 * leaves ambiguous (name shared by 2+ contacts) and unmatched entries untouched — those
 * keep working through the tracker's name fallback. Idempotent: re-running finds nothing
 * new once applied.
 *
 * Usage:  node backfill-connect-ids.mjs            # dry run, prints what would change
 *         node backfill-connect-ids.mjs --apply    # write the ids into the ledger
 */
import fs from 'fs';
import { CONNECTS_PATH } from './dashboard-web/server/config.mjs';
import { parseTargetTalentMd } from './dashboard-web/server/lib/target-talent.mjs';
import { normName } from './dashboard-web/server/lib/connects.mjs';

const APPLY = process.argv.includes('--apply');

if (!fs.existsSync(CONNECTS_PATH)) {
  console.log(`No connects ledger at ${CONNECTS_PATH} — nothing to backfill.`);
  process.exit(0);
}

const ledger = JSON.parse(fs.readFileSync(CONNECTS_PATH, 'utf8'));
const list = Array.isArray(ledger) ? ledger : (Array.isArray(ledger?.connects) ? ledger.connects : []);

// name → set of contact ids, so a name shared by two contacts is detected as ambiguous
// rather than silently assigned to the first.
const byName = new Map();
for (const c of parseTargetTalentMd()) {
  if (c.id === undefined || c.id === null) continue;
  const k = normName(`${c.first || ''} ${c.last || ''}`);
  if (!k) continue;
  if (!byName.has(k)) byName.set(k, new Set());
  byName.get(k).add(c.id);
}

let already = 0, matched = 0, ambiguous = 0, unmatched = 0;
const ambiguousNames = [];
const unmatchedNames = [];
for (const e of list) {
  if (e.id !== undefined && e.id !== null && e.id !== '') { already++; continue; }
  const ids = byName.get(normName(e.name));
  if (!ids || ids.size === 0) { unmatched++; unmatchedNames.push(e.name); continue; }
  if (ids.size > 1) { ambiguous++; ambiguousNames.push(e.name); continue; }
  e.id = [...ids][0];
  matched++;
}

console.log(`Connects ledger: ${list.length} entries`);
console.log(`  already have id: ${already}`);
console.log(`  matched (id assigned): ${matched}`);
console.log(`  ambiguous (name shared by 2+ contacts, left as-is): ${ambiguous}`);
console.log(`  unmatched (no target-talent contact, left as-is): ${unmatched}`);
if (ambiguous) console.log(`  ambiguous names: ${[...new Set(ambiguousNames)].slice(0, 20).join(', ')}${ambiguousNames.length > 20 ? ' …' : ''}`);
if (unmatched) console.log(`  unmatched names: ${[...new Set(unmatchedNames)].slice(0, 20).join(', ')}${unmatchedNames.length > 20 ? ' …' : ''}`);

if (!APPLY) {
  console.log(`\nDry run. Re-run with --apply to write ${matched} id${matched === 1 ? '' : 's'} into the ledger.`);
  process.exit(0);
}
if (matched === 0) {
  console.log('\nNothing to write.');
  process.exit(0);
}
fs.writeFileSync(CONNECTS_PATH, JSON.stringify(list, null, 2) + '\n');
console.log(`\nWrote ${matched} id${matched === 1 ? '' : 's'} into ${CONNECTS_PATH}.`);
