#!/usr/bin/env node
// gate-pipeline.mjs — Liveness gate that runs BEFORE batch evaluation.
//
// Reads data/pipeline.md, finds every pending "- [ ]" URL, runs the
// same Playwright liveness check used elsewhere, and rewrites the file:
//   - LIVE URLs   → stay as "- [ ]" (ready for batch)
//   - DEAD URLs   → flipped to "- [!]" with a closure note
//
// The batch flow only processes "- [ ]" items, so dead URLs are
// silently skipped — saving the LLM tokens and the user's time.
//
// Usage:
//   node gate-pipeline.mjs           # check & rewrite (default)
//   node gate-pipeline.mjs --dry-run # show what would change, no writes
//   node gate-pipeline.mjs --concurrency 5  # parallel checks (default 4)
//
// Exit code: 0 always (a low live rate is not a script error).

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { chromium } from 'playwright';
import { classifyLiveness } from './liveness-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE = join(__dirname, 'data/pipeline.md');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const concIdx = args.indexOf('--concurrency');
const concurrency = concIdx >= 0 ? parseInt(args[concIdx + 1], 10) || 4 : 4;

// ── Parse pipeline.md ─────────────────────────────────────────────────────────
const text = readFileSync(PIPELINE, 'utf8').replace(/\r/g, '');
const lines = text.split('\n');

// Each pending line looks like:
//   - [ ] https://...                                  (bare URL)
//   - [ ] https://... | Company | Role                 (with metadata)
const PENDING_RX = /^(\s*-\s*\[ \]\s+)(https?:\/\/[^\s|]+)(\s.*)?$/;

const pending = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(PENDING_RX);
  if (m) pending.push({ idx: i, prefix: m[1], url: m[2], suffix: m[3] || '' });
}

if (pending.length === 0) {
  console.log('No pending "- [ ]" items in pipeline.md. Nothing to gate.');
  process.exit(0);
}

console.log(`Gating ${pending.length} pending URLs (concurrency ${concurrency})...`);
if (dryRun) console.log('[dry run — no writes]\n');

// ── Run Playwright liveness in parallel batches ───────────────────────────────
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 career-ops/gate-pipeline',
});

// SPAs that ship a near-empty shell at domcontentloaded and hydrate
// the job description later. We give these extra time before reading
// the page so we don't false-positive as "insufficient content".
const SLOW_SPA_HOSTS = [
  /\.myworkdayjobs\.com$/i,    // Workday (Clio, etc.)
  /icims\.com$/i,              // iCIMS
  /\.oraclecloud\.com$/i,      // Oracle Cloud HCM
  /smartrecruiters\.com$/i,    // SmartRecruiters
  /successfactors\./i,         // SAP SuccessFactors
  /jobvite\.com$/i,            // Jobvite
];

function hydrationDelayFor(url) {
  try {
    const host = new URL(url).hostname;
    return SLOW_SPA_HOSTS.some(rx => rx.test(host)) ? 6000 : 2500;
  } catch { return 2500; }
}

async function checkOne(item) {
  const page = await context.newPage();
  try {
    const response = await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const status = response?.status() ?? 0;
    await page.waitForTimeout(hydrationDelayFor(item.url)); // SPA hydration window
    const finalUrl = page.url();
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '');
    const applyControls = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]'));
      return els.filter(el => !el.closest('nav, header, footer, [aria-hidden="true"]'))
                .map(el => (el.innerText || el.value || '').trim())
                .filter(Boolean);
    });
    const verdict = classifyLiveness({ status, finalUrl, bodyText, applyControls });
    return { ...item, ...verdict };
  } catch (err) {
    // Network errors / timeouts / browser-internal nav errors → treat as expired
    return { ...item, result: 'expired', reason: `nav error: ${(err.message || '').slice(0, 80)}` };
  } finally {
    await page.close();
  }
}

// Concurrency-limited parallel runner
async function runPool(items, n) {
  const out = [];
  let cursor = 0;
  const workers = Array.from({ length: n }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      const r = await checkOne(items[i]);
      out[i] = r;
      const tag = r.result === 'active' ? '✓ live    ' : r.result === 'expired' ? '✗ dead    ' : '? uncertain';
      console.log(`  ${tag} ${r.url.slice(0, 90)}${r.url.length > 90 ? '…' : ''}`);
    }
  });
  await Promise.all(workers);
  return out;
}

const results = await runPool(pending, concurrency);
await browser.close();

// ── Tally ────────────────────────────────────────────────────────────────────
const live      = results.filter(r => r.result === 'active');
const dead      = results.filter(r => r.result === 'expired');
const uncertain = results.filter(r => r.result === 'uncertain');

console.log('');
console.log(`Live:      ${live.length}`);
console.log(`Dead:      ${dead.length}`);
console.log(`Uncertain: ${uncertain.length} (kept as live — manual review)`);
console.log('');

// ── Rewrite pipeline.md ──────────────────────────────────────────────────────
// Dead URLs get flipped to "- [!]" with a note. Uncertain URLs stay pending
// (the batch agent can read the JD even if the page lacks an apply button —
// it's the dead/expired ones we want to keep out of LLM scope).
const newLines = [...lines];
for (const r of dead) {
  const reasonShort = (r.reason || 'closed').replace(/[\r\n]+/g, ' ').slice(0, 60);
  newLines[r.idx] = `- [!] ${r.url}${r.suffix} — gated: ${reasonShort}`;
}

if (dryRun) {
  console.log('Would rewrite pipeline.md with the above changes. No file written.');
  process.exit(0);
}

writeFileSync(PIPELINE, newLines.join('\n'));
console.log(`Rewrote ${PIPELINE} — ${dead.length} entries flipped to "- [!]" (gated).`);
console.log(`Batch will now process only ${live.length + uncertain.length} URLs.`);
