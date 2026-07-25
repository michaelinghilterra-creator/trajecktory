#!/usr/bin/env node
/**
 * reconcile-ta.mjs — headless Talent Acquisition reconcile.
 *
 * Archives TA contacts whose company's applications are ALL closed (dead
 * opportunities), so an outreach cycle spends time and verification credits only
 * on live opps. Uses the SAME decision as the dashboard TA Reconcile tab, from the
 * one shared function (dashboard-web/server/lib/tt-reconcile-core.mjs), so the CLI
 * and the UI can never disagree. Recruiters are external firms, not tied to one
 * opportunity, and are never touched.
 *
 * RUN THIS FIRST in an outreach cycle: reconcile → find missing emails → verify.
 * Verifying before reconciling spends credits on contacts you're about to archive.
 *
 * Usage:
 *   node reconcile-ta.mjs            # DRY RUN: list who would be archived
 *   node reconcile-ta.mjs --apply    # archive them (timestamped backup first)
 *   node reconcile-ta.mjs --json     # machine-readable
 */

import { copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parseApplicationsMd } from './dashboard-web/server/lib/applications.mjs';
import { parseTargetTalentMd, updateTTLine } from './dashboard-web/server/lib/target-talent.mjs';
import { reconcilePreview } from './dashboard-web/server/lib/tt-reconcile-core.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MD = join(ROOT, 'data/target-talent.md');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const JSON_OUT = argv.includes('--json');
const say = (...a) => { if (!JSON_OUT) console.log(...a); };

if (argv.includes('--help') || argv.includes('-h')) {
  console.log('node reconcile-ta.mjs [--apply] [--json]   # archive TA contacts whose company opps all closed');
  process.exit(0);
}

const apps = parseApplicationsMd();
const ttRows = parseTargetTalentMd().filter(r => r.status !== 'Archived');
const { toArchive } = reconcilePreview(apps, ttRows);

say(`\n♻️  reconcile-ta — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
say(`   non-archived TA contacts : ${ttRows.length}`);
say(`   would archive (opps dead): ${toArchive.length}`);
for (const c of toArchive) say(`     #${c.id} ${c.first} ${c.last} @ ${c.company}  (${c.reason})`);

if (!APPLY) {
  say(`\n   Dry run. Re-run with --apply to archive (a backup is made first).`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: false, toArchive }, null, 2));
  process.exit(0);
}
if (!toArchive.length) { say('\n   Nothing to archive.'); if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: true, archived: 0 })); process.exit(0); }

const d = new Date(), p = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const backup = `${MD}.bak-${stamp}-reconcile`;
copyFileSync(MD, backup);

let archived = 0;
for (const c of toArchive) { if (updateTTLine(c.id, { status: 'Archived' })) archived++; }

say(`\n💾 backed up → ${backup.replace(ROOT, '.')}`);
say(`✅ archived ${archived}/${toArchive.length} TA contact(s).`);
if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: true, archived, backup: backup.replace(ROOT, '.') }, null, 2));
