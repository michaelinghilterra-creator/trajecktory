#!/usr/bin/env node
/**
 * find-contacts.mjs — find email addresses for ACTIVE contacts that have none,
 * then verify each candidate before writing it. The active companies (a live
 * application still open) are exactly where outreach should go, and those TA
 * contacts usually have no address yet.
 *
 * PIPELINE per contact: Hunter Email Finder (company + name → candidate address)
 * → MillionVerifier (is it deliverable?) → write ONLY if ok/risky. A found
 * address that fails verification is never written — we don't trade one guess for
 * another. Reuses the API clients from verify-contacts.mjs.
 *
 * SAFETY: dry-run by default, timestamped backup, and the write asserts every
 * NON-email cell byte-identical (the email cell is allowed to go from empty to
 * the found address). Preserves each file's own line endings.
 *
 * Usage:
 *   node find-contacts.mjs                    # DRY RUN: who needs an address found
 *   node find-contacts.mjs --apply            # find + verify + write (backup first)
 *   node find-contacts.mjs --apply --limit=5
 *   node find-contacts.mjs --apply --file=tt  # only target-talent (or rec)
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseVerifyTag, setVerifyTag } from './lib/email-verify.mjs';
import { loadEnvKey, mvVerify } from './verify-contacts.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

// Hunter Email Finder → { email, score } or null when nothing is found.
export function mapHunterFind(json) {
  const d = json?.data || {};
  const email = (d.email || '').trim().toLowerCase();
  const score = Number.isFinite(d.score) ? d.score : null;
  return email ? { email, score } : null;
}
async function hunterFind(company, first, last, key) {
  const params = new URLSearchParams({ company, first_name: first, last_name: last, api_key: key });
  const res = await fetch(`https://api.hunter.io/v2/email-finder?${params.toString()}`, { signal: AbortSignal.timeout(25_000) });
  if (res.status === 429) throw new Error('Hunter rate limit (429) — wait and re-run');
  const j = await res.json();
  if (j?.errors) throw new Error(`Hunter: ${j.errors[0]?.details || 'error'}`);
  return mapHunterFind(j);
}

const FILES = {
  tt: { path: join(ROOT, 'data/target-talent.md'), emailIdx: 11, statusIdx: 13, orgIdx: 2, lastIdx: 3, firstIdx: 4 },
  rec: { path: join(ROOT, 'data/recruiters.md'), emailIdx: 11, statusIdx: 12, orgIdx: 2, lastIdx: 3, firstIdx: 4 },
};

// Contacts worth finding an address for: no address yet, a real name and company,
// and still active (not Archived, not a dead-end bounce/block state).
function readNeedsEmail(cfg) {
  if (!existsSync(cfg.path)) return [];
  const out = [];
  for (const line of readFileSync(cfg.path, 'utf8').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|');
    const id = parseInt((parts[1] || '').trim(), 10);
    if (Number.isNaN(id)) continue;
    if (parseVerifyTag((parts[cfg.emailIdx] || '').trim()).address) continue; // already has an address
    const status = (parts[cfg.statusIdx] || '').trim();
    if (['Archived', 'Bounced', 'Blocked'].includes(status)) continue;
    const first = (parts[cfg.firstIdx] || '').trim();
    const last = (parts[cfg.lastIdx] || '').trim();
    const company = (parts[cfg.orgIdx] || '').trim();
    if (!first || !last || !company) continue; // cannot find without a name + company
    out.push({ id, first, last, company, status });
  }
  return out;
}

// Rewrite one file, setting the Email cell of each found row to "address [v:...]".
// The email cell is allowed to change from empty to the found address; EVERY other
// cell must be byte-identical.
function applyFound(cfg, editsById) {
  const original = readFileSync(cfg.path, 'utf8');
  const mtimeBefore = statSync(cfg.path).mtimeMs;
  const lines = original.split('\n');
  const newLines = lines.slice();
  const changed = new Set();
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('| ')) continue;
    const parts = lines[i].split('|');
    const id = parseInt((parts[1] || '').trim(), 10);
    if (Number.isNaN(id) || !editsById.has(id)) continue;
    const { email, verify } = editsById.get(id);
    parts[cfg.emailIdx] = ` ${setVerifyTag(email, verify)} `;
    newLines[i] = parts.join('|');
    changed.add(i);
  }
  const problems = [];
  if (newLines.length !== lines.length) problems.push('line count changed');
  for (let i = 0; i < lines.length; i++) {
    if (!changed.has(i)) { if (newLines[i] !== lines[i]) problems.push(`line ${i + 1} changed unexpectedly`); continue; }
    const a = lines[i].split('|'), b = newLines[i].split('|');
    if (a.length !== b.length) { problems.push(`row ${i + 1}: cell count changed (stray pipe)`); continue; }
    for (let c = 0; c < a.length; c++) if (c !== cfg.emailIdx && a[c] !== b[c]) problems.push(`row ${i + 1} col ${c}: changed unexpectedly`);
    if (parseVerifyTag(a[cfg.emailIdx].trim()).address) problems.push(`row ${i + 1}: overwrote an existing address (should have been empty)`);
  }
  return { newText: newLines.join('\n'), changed: changed.size, problems, mtimeBefore };
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('node find-contacts.mjs [--apply] [--file=tt|rec|both] [--limit=N] [--json]');
    return;
  }
  const APPLY = argv.includes('--apply');
  const JSON_OUT = argv.includes('--json');
  const fileArg = (argv.find(a => a.startsWith('--file=')) || '').split('=')[1] || 'both';
  const limit = parseInt((argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10) || 0;
  const say = (...a) => { if (!JSON_OUT) console.log(...a); };
  const die = (m) => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); else console.error(`\n❌ ${m}`); process.exit(1); };

  const hkey = loadEnvKey('HUNTER_API_KEY');
  const mkey = loadEnvKey('MILLIONVERIFIER_API_KEY');
  if (!hkey) die('HUNTER_API_KEY not set in dashboard-web/.env (finding needs Hunter).');
  if (!mkey) die('MILLIONVERIFIER_API_KEY not set in dashboard-web/.env (found addresses are verified before writing).');

  const targets = fileArg === 'tt' ? ['tt'] : fileArg === 'rec' ? ['rec'] : ['tt', 'rec'];
  let needs = [];
  for (const fk of targets) for (const c of readNeedsEmail(FILES[fk])) needs.push({ ...c, fk });
  const capped = limit > 0 ? needs.slice(0, limit) : needs;

  say(`\n🔎 find-contacts — ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  say(`   active contacts with NO address: ${capped.length}${limit ? ` (of ${needs.length}, capped)` : ''}`);
  for (const c of capped) say(`     #${c.id} ${c.first} ${c.last} @ ${c.company} [${c.status}]`);
  if (!APPLY) { say(`\n   Dry run. Re-run with --apply to find (Hunter) + verify (MillionVerifier) + write.`); if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: false, needs: capped.length }, null, 2)); return; }
  if (!capped.length) { say('\n   Nothing to find.'); return; }

  const editsByFile = { tt: new Map(), rec: new Map() };
  const tally = { found_ok: 0, found_risky: 0, found_invalid: 0, not_found: 0, error: 0 };
  const log = [];
  for (const c of capped) {
    try {
      const cand = await hunterFind(c.company, c.first, c.last, hkey);
      if (!cand) { tally.not_found++; log.push(`   ✗ #${c.id} ${c.first} ${c.last} @ ${c.company}: no address found`); await sleep(250); continue; }
      const verdict = await mvVerify(cand.email, mkey);
      if (!verdict || verdict.state === 'invalid') {
        tally.found_invalid++;
        log.push(`   ⚠ #${c.id} ${c.first} ${c.last}: found ${cand.email} but it failed verification — not written`);
      } else {
        editsByFile[c.fk].set(c.id, { email: cand.email, verify: { state: verdict.state, source: 'mv', date: new Date().toISOString().slice(0, 10), score: verdict.score } });
        tally[verdict.state === 'ok' ? 'found_ok' : 'found_risky']++;
        log.push(`   ✓ #${c.id} ${c.first} ${c.last} @ ${c.company}: ${cand.email} (${verdict.state}, Hunter score ${cand.score ?? '?'})`);
      }
    } catch (e) { tally.error++; log.push(`   ! #${c.id} ${c.first} ${c.last}: ${e.message}`); if (/rate limit/i.test(e.message)) break; }
    await sleep(250);
  }
  log.forEach(l => say(l));

  const backups = [];
  for (const fk of targets) {
    if (!editsByFile[fk].size) continue;
    const cfg = FILES[fk];
    const { newText, changed, problems, mtimeBefore } = applyFound(cfg, editsByFile[fk]);
    if (problems.length) { say(`\n❌ ${fk}: verification failed, NOT written:`); problems.slice(0, 20).forEach(p => say(`   ${p}`)); continue; }
    if (statSync(cfg.path).mtimeMs !== mtimeBefore) { say(`\n⚠️  ${cfg.path} changed under us — ${fk} NOT written.`); continue; }
    const backup = `${cfg.path}.bak-${stamp()}-find`;
    copyFileSync(cfg.path, backup);
    writeFileSync(cfg.path, newText);
    backups.push(backup.replace(ROOT, '.'));
    say(`💾 ${fk}: backed up → ${backup.replace(ROOT, '.')}, wrote ${changed} address(es)`);
  }

  say(`\n✅ Found + verified: ${tally.found_ok} ok · ${tally.found_risky} risky written. ${tally.found_invalid} found-but-bad · ${tally.not_found} not found · ${tally.error} error.`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: true, tally, backups }, null, 2));
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
