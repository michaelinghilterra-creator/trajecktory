#!/usr/bin/env node
/**
 * verify-contacts.mjs — check the deliverability of contact email addresses and
 * record the verdict as a [v:...] tag, so the send gate (isSendable) can stop a
 * message ever reaching an unverified or dead address.
 *
 * WHY THIS EXISTS
 * Outreach died partly because addresses were auto-synthesized guesses that the
 * system flagged "unverified" and then sent to anyway. This turns "unverified"
 * into a real ok / risky / invalid verdict from a deliverability API.
 *
 * SOURCES (both are OFFICIAL verifier APIs)
 *   MillionVerifier (default) — the deliverability authority. ~2,000 credits for
 *     $4.90, never expire, one credit per address.
 *   Hunter (--source=hunter) — verifier on the free tier (~100/month).
 * We do NOT do in-house SMTP probing (catch-all domains defeat it and it burns
 * sending reputation), and we never treat the user's own guessed addresses as a
 * pattern authority — the verifier's verdict is the only authority.
 *
 * SAFETY: dry-run by default, timestamped backup, and the write asserts every
 * non-email cell byte-identical and the clean address unchanged before writing —
 * the same discipline as backfill-bounces.mjs. (If a third writer of these files
 * ever appears, extract a shared lib/contact-write.mjs; two is still fine.)
 *
 * Usage:
 *   node verify-contacts.mjs                       # DRY RUN: scope + credit cost
 *   node verify-contacts.mjs --apply               # verify + write (backup first)
 *   node verify-contacts.mjs --apply --limit=40    # cap count (warm contacts first)
 *   node verify-contacts.mjs --apply --source=hunter
 *   node verify-contacts.mjs --apply --file=rec    # only recruiters (or tt)
 *   node verify-contacts.mjs --apply --force       # re-verify ok/risky/invalid too
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { parseVerifyTag, setVerifyTag, isSendable } from './lib/email-verify.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = join(ROOT, 'dashboard-web/.env');

// Same loader as discover.mjs: read a single KEY=value from dashboard-web/.env,
// with process.env taking precedence.
export function loadEnvKey(key) {
  if (process.env[key]) return process.env[key].trim();
  if (!existsSync(ENV_PATH)) return '';
  const m = readFileSync(ENV_PATH, 'utf8').match(new RegExp(`^${key}=(.+)$`, 'm'));
  return m?.[1]?.trim() || '';
}

// ── Pure API → state mapping (unit-tested with fake JSON; no network here) ─────

// MillionVerifier /api/v3 returns { result, quality, ... }.
// result ∈ ok | catch_all | unknown | disposable | invalid | error
export function mapMillionVerifier(json) {
  const r = (json?.result || '').toLowerCase();
  const q = (json?.quality || '').toLowerCase();
  if (r === 'ok') return { state: 'ok', score: q === 'good' ? 90 : 75 };
  if (r === 'catch_all') return { state: 'risky', score: 50 };
  if (r === 'unknown') return { state: 'risky', score: 40 }; // inconclusive, usually sendable
  if (r === 'disposable' || r === 'invalid') return { state: 'invalid', score: 0 };
  return null; // 'error' / unrecognized → write nothing, allow a later retry
}

// Hunter /v2/email-verifier returns { data: { status, result, score } }.
// result ∈ deliverable | undeliverable | risky ; status ∈ valid|invalid|accept_all|webmail|disposable|unknown
export function mapHunter(json) {
  const d = json?.data || {};
  const result = (d.result || '').toLowerCase();
  const status = (d.status || '').toLowerCase();
  const score = Number.isFinite(d.score) ? d.score : null;
  if (status === 'disposable') return { state: 'invalid', score: 0 };
  if (result === 'deliverable' || status === 'valid') return { state: 'ok', score: score ?? 90 };
  if (result === 'undeliverable' || status === 'invalid') return { state: 'invalid', score: 0 };
  if (result === 'risky' || ['accept_all', 'webmail', 'unknown'].includes(status)) return { state: 'risky', score: score ?? 50 };
  return null;
}

// ── Network clients ────────────────────────────────────────────────────────────

export async function mvVerify(email, key) {
  const url = `https://api.millionverifier.com/api/v3/?api=${encodeURIComponent(key)}&email=${encodeURIComponent(email)}&timeout=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`MillionVerifier HTTP ${res.status}`);
  const j = await res.json();
  if (j?.error) throw new Error(`MillionVerifier: ${j.error}`);
  return mapMillionVerifier(j);
}
async function mvCredits(key) {
  try {
    const r = await fetch(`https://api.millionverifier.com/api/v3/credits?api=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) });
    const j = await r.json();
    return Number.isFinite(j?.credits) ? j.credits : null;
  } catch { return null; }
}
export async function hunterVerify(email, key) {
  const url = `https://api.hunter.io/v2/email-verifier?email=${encodeURIComponent(email)}&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  if (res.status === 429) throw new Error('Hunter rate limit (429) — wait and re-run');
  const j = await res.json();
  if (j?.errors) throw new Error(`Hunter: ${j.errors[0]?.details || 'error'}`);
  return mapHunter(j);
}
async function hunterCredits(key) {
  try {
    const r = await fetch(`https://api.hunter.io/v2/account?api_key=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(10_000) });
    const v = (await r.json())?.data?.requests?.verifications;
    return v ? (v.available - v.used) : null;
  } catch { return null; }
}

// ── Contact files (read directly, self-contained like backfill-bounces) ────────

const FILES = {
  tt: { path: join(ROOT, 'data/target-talent.md'), emailIdx: 11, statusIdx: 13, orgIdx: 2 },
  rec: { path: join(ROOT, 'data/recruiters.md'), emailIdx: 11, statusIdx: 12, orgIdx: 2 },
};

// Warm contacts first, so a --limit run spends credits on the people most likely
// to be emailed next.
const STATUS_PRIORITY = { Replied: 4, 'Meeting Scheduled': 4, Connected: 4, Sent: 3, Dormant: 2, 'Not Contacted': 1, Archived: 0 };

function readCandidates(cfg, { force }) {
  if (!existsSync(cfg.path)) return [];
  const out = [];
  for (const line of readFileSync(cfg.path, 'utf8').split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|');
    const id = parseInt((parts[1] || '').trim(), 10);
    if (Number.isNaN(id)) continue;
    const v = parseVerifyTag((parts[cfg.emailIdx] || '').trim());
    if (!v.address) continue; // nothing to verify
    // Default: only unverified. --force: also re-check ok/risky/invalid. NEVER
    // re-verify bounced/blocked — those are observed / human truth, not a guess.
    const eligible = force ? !['bounced', 'blocked'].includes(v.state) : v.state === 'unverified';
    if (!eligible) continue;
    out.push({ id, address: v.address, state: v.state, status: (parts[cfg.statusIdx] || '').trim(), org: (parts[cfg.orgIdx] || '').trim() });
  }
  return out;
}

// Rewrite one file, setting the [v:...] tag on the Email cell of each edited row.
// Only the email cell may change; every other cell is asserted byte-identical and
// the clean address must be unchanged. Preserves each line's own \r (CRLF vs LF).
function applyTags(cfg, editsById) {
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
    parts[cfg.emailIdx] = ` ${setVerifyTag((parts[cfg.emailIdx] || '').trim(), editsById.get(id))} `;
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
    if (parseVerifyTag(a[cfg.emailIdx].trim()).address !== parseVerifyTag(b[cfg.emailIdx].trim()).address) problems.push(`row ${i + 1}: email ADDRESS changed`);
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
    console.log('node verify-contacts.mjs [--apply] [--source=mv|hunter] [--file=tt|rec|both] [--limit=N] [--force] [--json]');
    return;
  }
  const APPLY = argv.includes('--apply');
  const JSON_OUT = argv.includes('--json');
  const FORCE = argv.includes('--force');
  const source = (argv.find(a => a.startsWith('--source=')) || '').split('=')[1] || 'mv';
  const fileArg = (argv.find(a => a.startsWith('--file=')) || '').split('=')[1] || 'both';
  const limit = parseInt((argv.find(a => a.startsWith('--limit=')) || '').split('=')[1] || '0', 10) || 0;
  const say = (...a) => { if (!JSON_OUT) console.log(...a); };
  const die = (m) => { if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: m })); else console.error(`\n❌ ${m}`); process.exit(1); };

  if (!['mv', 'hunter'].includes(source)) die(`--source must be mv or hunter, got "${source}"`);
  const keyName = source === 'mv' ? 'MILLIONVERIFIER_API_KEY' : 'HUNTER_API_KEY';
  const key = loadEnvKey(keyName);
  if (!key) die(`${keyName} not set in dashboard-web/.env. Add it, then re-run.`);
  const verifyOne = source === 'mv' ? mvVerify : hunterVerify;
  const getCredits = source === 'mv' ? mvCredits : hunterCredits;

  const targets = fileArg === 'tt' ? ['tt'] : fileArg === 'rec' ? ['rec'] : ['tt', 'rec'];
  let candidates = [];
  for (const fk of targets) for (const c of readCandidates(FILES[fk], { force: FORCE })) candidates.push({ ...c, fk });
  candidates.sort((a, b) => (STATUS_PRIORITY[b.status] ?? 1) - (STATUS_PRIORITY[a.status] ?? 1) || a.id - b.id);
  const capped = limit > 0 ? candidates.slice(0, limit) : candidates;

  const credits = await getCredits(key);
  say(`\n📧 verify-contacts — ${APPLY ? 'APPLY' : 'DRY RUN'} · source: ${source} · credits left: ${credits ?? 'unknown'}`);
  say(`   candidates to verify : ${capped.length}${limit ? ` (of ${candidates.length}, capped by --limit=${limit})` : ''}`);
  say(`   estimated credit cost: ${capped.length}`);
  if (credits != null && capped.length > credits) say(`   ⚠️  not enough credits (${credits}) for ${capped.length} — only the first ${credits} will run.`);

  if (!APPLY) {
    say(`\n   Dry run only. Re-run with --apply to verify + write (a backup is made first).`);
    if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: false, candidates: capped.length, credits, source }, null, 2));
    return;
  }
  if (!capped.length) { say('\n   Nothing to verify.'); return; }

  // Verify sequentially (gentle on rate limits). Errors are skipped, not written,
  // so a re-run picks them up; a few wasted credits beats a bad write.
  const editsByFile = { tt: new Map(), rec: new Map() };
  const tally = { ok: 0, risky: 0, invalid: 0, error: 0 };
  const runnable = credits != null ? capped.slice(0, credits) : capped;
  for (let i = 0; i < runnable.length; i++) {
    const c = runnable[i];
    try {
      const r = await verifyOne(c.address, key);
      if (!r) { tally.error++; }
      else {
        editsByFile[c.fk].set(c.id, { state: r.state, source, date: new Date().toISOString().slice(0, 10), score: r.score });
        tally[r.state] = (tally[r.state] || 0) + 1;
      }
    } catch (e) { tally.error++; if (/rate limit/i.test(e.message)) { say(`\n   ⚠️  ${e.message} — stopping early with ${i} done.`); break; } }
    if ((i + 1) % 10 === 0 || i + 1 === runnable.length) say(`   ...${i + 1}/${runnable.length}  (ok ${tally.ok} · risky ${tally.risky} · invalid ${tally.invalid} · err ${tally.error})`);
    if (source === 'hunter') await new Promise(r => setTimeout(r, 250)); // free tier is slow
  }

  // Write each file once, with backup + byte-identical verification.
  const backups = [];
  for (const fk of targets) {
    const edits = editsByFile[fk];
    if (!edits.size) continue;
    const cfg = FILES[fk];
    const { newText, changed, problems, mtimeBefore } = applyTags(cfg, edits);
    if (problems.length) { say(`\n❌ ${fk}: verification failed, NOT written:`); problems.slice(0, 20).forEach(p => say(`   ${p}`)); continue; }
    if (statSync(cfg.path).mtimeMs !== mtimeBefore) { say(`\n⚠️  ${cfg.path} changed under us — ${fk} NOT written, re-run.`); continue; }
    const backup = `${cfg.path}.bak-${stamp()}-verify`;
    copyFileSync(cfg.path, backup);
    writeFileSync(cfg.path, newText);
    backups.push(backup.replace(ROOT, '.'));
    say(`💾 ${fk}: backed up → ${backup.replace(ROOT, '.')}, wrote ${changed} tag(s)`);
  }

  say(`\n✅ Verified ${tally.ok + tally.risky + tally.invalid} addresses: ${tally.ok} ok · ${tally.risky} risky · ${tally.invalid} invalid · ${tally.error} error/skipped`);
  say(`   Sendable now (ok + risky): ${tally.ok + tally.risky}. Errors can be re-run.`);
  if (JSON_OUT) console.log(JSON.stringify({ ok: true, applied: true, tally, backups, source }, null, 2));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
