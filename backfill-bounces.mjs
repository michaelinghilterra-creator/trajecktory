#!/usr/bin/env node
/**
 * backfill-bounces.mjs — recover the bounce evidence that already exists in the
 * free-text Notes of data/recruiters.md and data/target-talent.md, and turn the
 * CERTAIN cases into structured state.
 *
 * WHY THIS EXISTS
 * Outreach went dark on 2026-06-24. Part of why the channel looked dead: only 2
 * contacts carried Status = Bounced, while ~40 rows described a bounce in prose
 * and were parked as Dormant/Archived (talent_states had no `bounced` at all
 * until this branch). So a bounced address and an ignored one were the same row,
 * and every reply-rate number counted dead addresses in the denominator. This
 * separates the two: it writes a `[v:…]` verification tag onto the Email cell and
 * flips the certain hard bounces to Status = Bounced, so the delivered-only reply
 * rate becomes computable for the first time.
 *
 * CONSERVATIVE BY DESIGN
 * Many bounce notes describe a bounce of an OLD address that was then CORRECTED
 * (a firm's team can have stale addresses on an old domain, while the current
 * cell holds the good new-domain one). Killing that would be worse than nothing.
 * So this AUTO-WRITES only high-confidence rows where the note ties the bounce to
 * the CURRENT address (or is already Status = Bounced). Everything ambiguous —
 * corrections, multi-pattern org-walls, soft bounces — is SURFACED for review and
 * handed to the Hunter/MillionVerifier step, never written.
 *
 * WHAT IT TOUCHES
 * The Email cell (adds/updates a `[v:…]` tag; the clean address is never changed)
 * and the Status cell (only Not Contacted/Sent/Dormant/Archived → Bounced; never
 * Replied/Meeting Scheduled/Connected, which prove the address once worked).
 * Every other cell is asserted byte-identical before a single byte is written.
 *
 * These files are user-layer and gitignored: no git history, so a timestamped
 * .bak is the ONLY rollback.
 *
 * Usage:
 *   node backfill-bounces.mjs            # DRY RUN (default): print the plan
 *   node backfill-bounces.mjs --apply    # back up, verify, then write
 *   node backfill-bounces.mjs --json     # machine-readable summary
 *   node backfill-bounces.mjs --file=tt  # only target-talent.md (or --file=rec)
 *
 * Exit: 0 on success (including nothing-to-do); 1 if verification fails or a file
 * changed underfoot.
 */

import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import { parseVerifyTag, setVerifyTag } from './lib/email-verify.mjs';
import { mineNotesForBounce } from './lib/bounce-parse.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const JSON_OUT = argv.includes('--json');
const fileArg = (argv.find(a => a.startsWith('--file=')) || '').split('=')[1] || 'both';

if (argv.includes('--help') || argv.includes('-h')) {
  console.log(`backfill-bounces.mjs — mine bounce forensics into structured state
  node backfill-bounces.mjs            dry run (default), writes nothing
  node backfill-bounces.mjs --apply    back up, verify, then write
  node backfill-bounces.mjs --json     machine-readable summary
  node backfill-bounces.mjs --file=tt  only target-talent.md (rec = recruiters)`);
  process.exit(0);
}

const say = (...a) => { if (!JSON_OUT) console.log(...a); };
const die = (msg) => {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
  else console.error(`\n❌ ${msg}`);
  process.exit(1);
};

// Contacted / replied label sets, loaded from the ONE source of truth so this
// script can never drift from the ladders the dashboard uses.
let CONTACTED = new Set(), REPLIED = new Set();
try {
  const doc = yaml.load(readFileSync(join(ROOT, 'templates', 'states.yml'), 'utf8'));
  for (const s of [...(doc.recruiter_states || []), ...(doc.talent_states || [])]) {
    if (s.contacted) CONTACTED.add(s.label);
    if (s.replied) REPLIED.add(s.label);
  }
} catch (e) { die(`could not read templates/states.yml: ${e.message}`); }

// Statuses a hard bounce may overwrite. Replied/Meeting Scheduled/Connected are
// excluded on purpose: they prove a message once reached a human, so a later
// prose bounce must not erase that evidence.
const FLIPPABLE = new Set(['Not Contacted', 'Sent', 'Dormant', 'Archived']);

// Per-file column map. email and status indices are stable regardless of whether
// the optional trailing LinkedIn/Website cells are present, because they sit
// before those columns. Verified against the live headers in both files.
const FILES = {
  tt: { path: join(ROOT, 'data', 'target-talent.md'), emailIdx: 11, statusIdx: 13, notesIdx: 15, nameIdx: 4, orgIdx: 2 },
  rec: { path: join(ROOT, 'data', 'recruiters.md'), emailIdx: 11, statusIdx: 12, notesIdx: 14, nameIdx: 4, orgIdx: 2 },
};

const targets = fileArg === 'tt' ? ['tt'] : fileArg === 'rec' ? ['rec'] : ['tt', 'rec'];

const summary = { ok: true, applied: APPLY, files: {} };
let anyProblem = false;

for (const key of targets) {
  const cfg = FILES[key];
  if (!existsSync(cfg.path)) { say(`\n(skip ${key}: ${cfg.path} not found)`); continue; }

  const originalText = readFileSync(cfg.path, 'utf-8');
  const mtimeBefore = statSync(cfg.path).mtimeMs;
  // Split on \n only; each line keeps its own trailing \r (target-talent.md is
  // CRLF, recruiters.md is LF). Never normalize line endings — that would be a
  // far larger diff than the one being asked for.
  const originalLines = originalText.split('\n');
  const newLines = originalLines.slice();
  const changed = new Set();

  const marked = [];       // auto-written: address tagged + status flipped to Bounced
  const annotated = [];    // already Bounced: just added the verify tag
  const reviewCorrected = [];
  const reviewBlocked = [];
  const reviewSoft = [];
  const reviewLowConf = [];
  const badStatus = [];    // status not in the ladder — possible column shift

  let dataRows = 0;

  for (let i = 0; i < originalLines.length; i++) {
    const line = originalLines[i];
    if (!line.startsWith('| ')) continue;
    // Split WITHOUT trimming so untouched cells stay byte-identical on rejoin,
    // and the trailing \r (CRLF files) rides along in the last element.
    const parts = line.split('|');
    const id = parseInt((parts[1] || '').trim(), 10);
    if (Number.isNaN(id)) continue; // header / separator
    dataRows++;

    const rawEmailCell = (parts[cfg.emailIdx] || '').trim();
    const status = (parts[cfg.statusIdx] || '').trim();
    const notes = (parts[cfg.notesIdx] || '').trim();
    const org = (parts[cfg.orgIdx] || '').trim();
    const v = parseVerifyTag(rawEmailCell);
    const address = v.address;

    // A status the ladder does not know about can be a real column shift (the
    // exact bug that hid a whole row from every metric). Surface, never write.
    if (status && !CONTACTED.has(status) && ![...FLIPPABLE].includes(status) &&
        !['Drafted', 'Replied', 'Meeting Scheduled', 'Connected', 'Bounced', 'Blocked'].includes(status)) {
      badStatus.push({ id, org, status });
    }

    // Row already Bounced → make sure the address carries a matching verify tag
    // (pure annotation, no status change). Idempotent: skip if already tagged.
    if (status === 'Bounced') {
      if (address) {
        const mine = mineNotesForBounce(notes, address, rawEmailCell);
        if (mine.verdict === 'corrected') {
          // Marked Bounced, but the note shows the CURRENT address is a correction
          // of the one that actually bounced (the old-domain address died, the
          // new-domain one is a fresh correction). Do NOT confirm it dead — it may
          // be reachable. Surface for Hunter verification; leave the status as the
          // human set it, but don't tag the address bounced.
          reviewCorrected.push({ id, org, address, reason: 'marked Bounced, but address is a correction — verify, may be reachable' });
        } else if (v.state !== 'bounced') {
          const newCell = setVerifyTag(rawEmailCell, { state: 'bounced', source: 'notes', date: mine.date || null });
          parts[cfg.emailIdx] = ` ${newCell} `;
          newLines[i] = parts.join('|');
          changed.add(i);
          annotated.push({ id, org, address });
        }
      }
      continue;
    }

    if (!address) continue; // nothing to verify or send to

    const mine = mineNotesForBounce(notes, address, rawEmailCell);
    if (!mine.verdict) continue;

    if ((mine.verdict === 'bounced' || mine.verdict === 'invalid') && mine.confidence === 'high') {
      const newCell = setVerifyTag(rawEmailCell, { state: mine.verdict, source: 'notes', date: mine.date || null });
      parts[cfg.emailIdx] = ` ${newCell} `;
      if (FLIPPABLE.has(status) || status === '') parts[cfg.statusIdx] = ' Bounced ';
      newLines[i] = parts.join('|');
      changed.add(i);
      marked.push({ id, org, address, from: status || '(none)', verdict: mine.verdict, reason: mine.reason });
    } else if (mine.verdict === 'corrected') {
      reviewCorrected.push({ id, org, address, reason: mine.reason });
    } else if (mine.verdict === 'blocked') {
      reviewBlocked.push({ id, org, address, reason: mine.reason });
    } else if (mine.verdict === 'soft') {
      reviewSoft.push({ id, org, address });
    } else {
      reviewLowConf.push({ id, org, address, verdict: mine.verdict, reason: mine.reason });
    }
  }

  // ── Verify BEFORE any write: only the scheduled lines changed, and only the
  // email cell (tag added, address unchanged) and status cell (→ Bounced from an
  // allowed prior state). Everything else must be byte-identical. ──────────────
  const problems = [];
  if (newLines.length !== originalLines.length) problems.push(`line count changed`);
  for (let i = 0; i < originalLines.length; i++) {
    if (!changed.has(i)) {
      if (newLines[i] !== originalLines[i]) problems.push(`line ${i + 1} changed but was not scheduled`);
      continue;
    }
    const a = originalLines[i].split('|');
    const b = newLines[i].split('|');
    if (a.length !== b.length) { problems.push(`row ${i + 1}: cell count changed ${a.length}→${b.length} (stray pipe)`); continue; }
    for (let c = 0; c < a.length; c++) {
      if (c === cfg.emailIdx || c === cfg.statusIdx) continue; // the two we allow
      if (a[c] !== b[c]) problems.push(`row ${i + 1} col ${c}: changed unexpectedly`);
    }
    // The clean address must be identical before and after — only the tag differs.
    const beforeAddr = parseVerifyTag(a[cfg.emailIdx].trim()).address;
    const afterAddr = parseVerifyTag(b[cfg.emailIdx].trim()).address;
    if (beforeAddr !== afterAddr) problems.push(`row ${i + 1}: email ADDRESS changed "${beforeAddr}"→"${afterAddr}"`);
    // Status may only become Bounced, and only from an allowed prior state.
    const bStatus = b[cfg.statusIdx].trim(), aStatus = a[cfg.statusIdx].trim();
    if (aStatus !== bStatus && !(bStatus === 'Bounced' && (FLIPPABLE.has(aStatus) || aStatus === ''))) {
      problems.push(`row ${i + 1}: status ${aStatus}→${bStatus} not an allowed transition`);
    }
  }

  if (problems.length) { anyProblem = true; }

  summary.files[key] = {
    path: cfg.path.replace(ROOT, '.'), dataRows,
    marked: marked.length, annotated: annotated.length,
    review: { corrected: reviewCorrected.length, blocked: reviewBlocked.length, soft: reviewSoft.length, lowConfidence: reviewLowConf.length },
    badStatus: badStatus.length,
    problems,
    details: { marked, annotated, reviewCorrected, reviewBlocked, reviewSoft, reviewLowConf, badStatus },
    _newText: newLines.join('\n'), _mtimeBefore: mtimeBefore, _changed: changed.size,
  };
}

// ── Report ────────────────────────────────────────────────────────────────────
say(`\n📋 backfill-bounces — ${APPLY ? 'APPLY' : 'DRY RUN (nothing will be written)'}\n`);

for (const key of targets) {
  const f = summary.files[key];
  if (!f) continue;
  say(`── ${f.path}  (${f.dataRows} contacts) ──`);
  say(`   ✍️  mark Bounced (high confidence) : ${f.marked}`);
  say(`   🏷️  annotate rows already Bounced  : ${f.annotated}`);
  say(`   🔎 surface for review (no write)   : corrected ${f.review.corrected} · blocked/org-wall ${f.review.blocked} · soft ${f.review.soft} · low-confidence ${f.review.lowConfidence}`);
  if (f.badStatus) say(`   ⚠️  unknown status (possible shift) : ${f.badStatus}`);

  if (f.details.marked.length) {
    say(`\n   Will mark Bounced:`);
    for (const m of f.details.marked) say(`     #${m.id} ${m.org} — ${m.address}  (${m.from} → Bounced; ${m.verdict})`);
  }
  if (f.details.reviewCorrected.length) {
    say(`\n   ↪ Corrected address, verify with Hunter (NOT written):`);
    for (const r of f.details.reviewCorrected) say(`     #${r.id} ${r.org} — ${r.address}`);
  }
  if (f.details.reviewBlocked.length) {
    say(`\n   ↪ Multiple patterns bounced — LinkedIn / confirm (NOT written):`);
    for (const r of f.details.reviewBlocked) say(`     #${r.id} ${r.org} — ${r.address}  (${r.reason})`);
  }
  if (f.details.badStatus.length) {
    say(`\n   ⚠️  Rows whose Status is not a known ladder value (check for a column shift):`);
    for (const r of f.details.badStatus) say(`     #${r.id} ${r.org} — status="${r.status}"`);
  }
  if (f.problems.length) {
    say(`\n   ❌ VERIFICATION FAILED — nothing will be written for this file:`);
    for (const p of f.problems.slice(0, 30)) say(`      ${p}`);
  }
  say('');
}

// ── Reply-rate payoff: what separating bounces from ignores does to the number ─
// Computed across BOTH files' contacted contacts. "delivered" excludes rows whose
// verification is bounced/blocked/invalid — the addresses that never reached a
// human. This is the question that killed the channel: the raw rate counted dead
// addresses in the denominator.
function replyStats(text, cfg) {
  let contacted = 0, delivered = 0, replied = 0, deliveredReplied = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const parts = line.split('|');
    if (Number.isNaN(parseInt((parts[1] || '').trim(), 10))) continue;
    const status = (parts[cfg.statusIdx] || '').trim();
    const v = parseVerifyTag((parts[cfg.emailIdx] || '').trim());
    const dead = ['bounced', 'blocked', 'invalid'].includes(v.state) || status === 'Bounced' || status === 'Blocked';
    const wasContacted = CONTACTED.has(status) || status === 'Bounced';
    const didReply = REPLIED.has(status);
    if (wasContacted) { contacted++; if (didReply) replied++; }
    if (wasContacted && !dead) { delivered++; if (didReply) deliveredReplied++; }
  }
  return { contacted, replied, delivered, deliveredReplied };
}
const agg = { contacted: 0, replied: 0, delivered: 0, deliveredReplied: 0 };
for (const key of targets) {
  const f = summary.files[key];
  if (!f) continue;
  const s = replyStats(f._newText, FILES[key]); // post-backfill view
  for (const k of Object.keys(agg)) agg[k] += s[k];
}
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : 'n/a';
say(`── Reply rate, before vs after separating bounces (post-backfill view) ──`);
say(`   raw     : ${agg.replied}/${agg.contacted} contacted = ${pct(agg.replied, agg.contacted)}`);
say(`   delivered: ${agg.deliveredReplied}/${agg.delivered} that actually reached a human = ${pct(agg.deliveredReplied, agg.delivered)}`);
say(`   (delivered excludes ${agg.contacted - agg.delivered} bounced/blocked/invalid addresses that were inflating the denominator)`);
summary.replyRate = { ...agg, rawPct: pct(agg.replied, agg.contacted), deliveredPct: pct(agg.deliveredReplied, agg.delivered) };

// ── Write ──────────────────────────────────────────────────────────────────────
if (anyProblem) {
  say(`\n❌ One or more files failed verification. Nothing written.`);
  if (JSON_OUT) console.log(JSON.stringify(scrub(summary), null, 2));
  process.exit(1);
}

if (APPLY) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  for (const key of targets) {
    const f = summary.files[key];
    if (!f || !f._changed) continue;
    const cfg = FILES[key];
    if (statSync(cfg.path).mtimeMs !== f._mtimeBefore) die(`${cfg.path} changed while running. Nothing written — re-run.`);
    const backup = `${cfg.path}.bak-${stamp}-bounce-backfill`;
    copyFileSync(cfg.path, backup);
    writeFileSync(cfg.path, f._newText);
    say(`💾 ${key}: backed up → ${backup.replace(ROOT, '.')}, wrote ${f.marked + f.annotated} change(s)`);
  }
  say(`\n✅ Applied. Rollback: restore the .bak-${stamp}-bounce-backfill file(s).`);
} else {
  say(`\n   Dry run only. Re-run with --apply to write (a timestamped backup is made first).`);
}

// Drop the heavy internal fields from JSON output.
function scrub(s) {
  const out = { ok: s.ok, applied: s.applied, replyRate: s.replyRate, files: {} };
  for (const [k, f] of Object.entries(s.files)) {
    out.files[k] = { path: f.path, dataRows: f.dataRows, marked: f.marked, annotated: f.annotated, review: f.review, badStatus: f.badStatus, problems: f.problems, details: f.details };
  }
  return out;
}
if (JSON_OUT) console.log(JSON.stringify(scrub(summary), null, 2));
