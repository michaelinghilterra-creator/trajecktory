#!/usr/bin/env node
// resolve-jds.mjs — JD snapshot gate. Runs BEFORE triage/evaluate.
//
// The triage and deep-eval agents read a posting by fetching its page. Modern ATS
// posting pages (Ashby, Workday, SmartRecruiters, Greenhouse-embedded, Workable)
// render nothing to a plain fetch, so those roles were silently skipped. But the
// JD is available over each platform's public JSON API. This gate walks every
// pending "- [ ]" URL in data/pipeline.md, and for each one on a recognized ATS it
// pulls the JD via the API, writes it to jds/{slug}.md, and repoints the pipeline
// entry to "local:jds/{slug}.md" — which the agents read directly. Nothing on a
// supported platform gets skipped for being a single-page app again.
//
// The original posting URL is preserved in the snapshot file's header, so the
// apply link is never lost.
//
// Usage:
//   node resolve-jds.mjs            # fetch & rewrite pipeline.md (default)
//   node resolve-jds.mjs --dry-run  # show what would resolve, no writes
//
// Exit code: 0 always (an unresolved posting is not a script error).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import yaml from 'js-yaml';
import { parsePostingUrl, fetchJdText } from './lib/ats-jd.mjs';
import { workdaySiteFromCareersUrl } from './liveness-core.mjs';
import { updatePipelineRows } from './lib/pipeline.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE = join(__dirname, 'data/pipeline.md');
const PORTALS = join(__dirname, 'portals.yml');
const JDS_DIR = join(__dirname, 'jds');
const FAIL_COUNTS = join(__dirname, 'data/resolve-fail-counts.json');

// A "recognized ATS but couldn't fetch" result might be a transient blip (network,
// rate limit) — give it one more run before gating. An "unrecognized platform" is a
// structural fact about that URL, not a fluke; it will never resolve on its own, so
// it gates immediately (0 retries). Both are read by the batch triage/deep-dive
// agents, which otherwise burn a full LLM round re-discovering the same dead end
// every time it happens to be at the top of the queue.
const RETRY_LIMIT = 1; // 1 retry = gate on the 2nd consecutive failure

function loadFailCounts() {
  if (!existsSync(FAIL_COUNTS)) return {};
  try { return JSON.parse(readFileSync(FAIL_COUNTS, 'utf8')); } catch { return {}; }
}
function saveFailCounts(counts) {
  writeFileSync(FAIL_COUNTS, JSON.stringify(counts, null, 2), 'utf8');
}

const todayISO = () => new Date().toISOString().slice(0, 10);
const normCompany = (s) => String(s || '').toLowerCase()
  .replace(/[,.]?\s*(inc|llc|ltd|corp|corporation|co|company|holdings?|group|technologies|technology|software|systems|solutions|international|usa|plc|pbc)\.?$/gi, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const kebab = (s) => String(s || '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

// Build company-name → { greenhouseBoard, workdaySite } hints from portals.yml so
// a Greenhouse gh_jid on a company domain, or a Workday URL missing its career
// site, can still resolve. Matched on normalized company name.
export function buildHintIndex(portalsText) {
  const idx = new Map();
  let doc;
  try { doc = yaml.load(portalsText); } catch { return idx; }
  for (const c of (doc && doc.tracked_companies) || []) {
    const key = normCompany(c.name);
    if (!key) continue;
    const hint = idx.get(key) || {};
    const gh = String(c.api || c.careers_url || '').match(/greenhouse\.io\/(?:v1\/boards\/)?([^/?#]+)/i);
    if (gh && !hint.greenhouseBoard) hint.greenhouseBoard = gh[1];
    const site = workdaySiteFromCareersUrl(c.careers_url || '');
    if (site && !hint.workdaySite) hint.workdaySite = site;
    idx.set(key, hint);
  }
  return idx;
}

// A pending pipeline row: "- [ ] {url} | {company} | {title}". Split on " | " so
// the URL is a whole token — replacing it wholesale avoids leaving a trailing
// "&gh_jid=" or "#anchor" fragment glued to the new local: path.
export function parsePendingRow(line) {
  if (!line.startsWith('- [ ] ')) return null;
  const parts = line.split(' | ');
  const url = parts[0].replace(/^- \[ \] /, '').trim();
  return { url, company: (parts[1] || '').trim(), title: (parts[2] || '').trim(), parts };
}

// Rewrite pipeline text, repointing each resolved URL to its local snapshot.
// `resolved` is a Map(url -> localPath). Pure + tested: this is where the
// trailing-fragment bug lived when done by naive substring replace.
export function repointPipeline(md, resolved) {
  return md.split('\n').map(line => {
    const row = parsePendingRow(line);
    if (!row || !resolved.has(row.url)) return line;
    const parts = row.parts.slice();
    parts[0] = `- [ ] ${resolved.get(row.url)}`;
    return parts.join(' | ');
  }).join('\n');
}

// Decide which rows to gate to "- [!]" and what the next fail-count file should
// hold. Pure (no fs/network) so the retry-limit boundary is unit-testable:
//   - every `unrecognized` row gates immediately (0 retries — a structural fact,
//     retrying never changes the outcome).
//   - a `failed` row gates once its count EXCEEDS retryLimit; otherwise its count
//     is carried forward for the next run to check again.
export function computeGating({ unrecognized, failed, priorFailCounts, retryLimit }) {
  const toGate = [];
  for (const r of unrecognized) {
    toGate.push({ url: r.url, reason: 'unsupported ATS platform — needs manual JD paste' });
  }
  const nextFailCounts = {};
  for (const r of failed) {
    const count = (priorFailCounts[r.url] || 0) + 1;
    if (count > retryLimit) {
      toGate.push({ url: r.url, reason: `unreadable after ${count} attempts — ${r.reason}` });
    } else {
      nextFailCounts[r.url] = count;
    }
  }
  return { toGate, nextFailCounts };
}

// ── main (guarded so the module is importable for tests) ─────────────────────
async function main() {
  const dryRun = process.argv.slice(2).includes('--dry-run');
  if (!existsSync(PIPELINE)) { console.log('no data/pipeline.md — nothing to do.'); return; }
  const md = readFileSync(PIPELINE, 'utf8');
  const hints = existsSync(PORTALS) ? buildHintIndex(readFileSync(PORTALS, 'utf8')) : new Map();

  const pending = md.split('\n').map(parsePendingRow).filter(Boolean);
  const resolved = new Map();     // url -> local:jds/… (for the repoint)
  const usedSlugs = new Set();
  const report = { resolved: [], alreadyLocal: 0, unrecognized: [], failed: [] };

  for (const row of pending) {
    if (row.url.startsWith('local:')) { report.alreadyLocal++; continue; }
    const desc = parsePostingUrl(row.url);
    if (!desc) { report.unrecognized.push(row); continue; }

    const hint = hints.get(normCompany(row.company)) || {};
    try {
      const { text } = await fetchJdText(desc, { boardHint: hint.greenhouseBoard, workdaySiteHints: hint.workdaySite ? [hint.workdaySite] : [] });
      if (!text || text.length < 200) throw new Error(`JD too short (${(text || '').length} chars)`);

      let slug = kebab(`${row.company}-${row.title}`) || `jd-${desc.ats}`;
      if (usedSlugs.has(slug)) slug = `${slug}-${(desc.id || desc.shortcode || desc.reqId || '').toString().slice(-8) || usedSlugs.size}`;
      usedSlugs.add(slug);

      const file = `jds/${slug}.md`;
      if (!dryRun) {
        if (!existsSync(JDS_DIR)) mkdirSync(JDS_DIR, { recursive: true });
        writeFileSync(join(__dirname, file),
          `# ${row.title} — ${row.company}\n\n**Source URL:** ${row.url}\n**ATS:** ${desc.ats}\n**Pulled via ATS API:** ${todayISO()}\n\n---\n\n${text}\n`, 'utf8');
      }
      resolved.set(row.url, `local:${file}`);
      report.resolved.push({ company: row.company, title: row.title, ats: desc.ats, chars: text.length, file });
    } catch (e) {
      report.failed.push({ company: row.company, title: row.title, ats: desc.ats, reason: e.message });
    }
  }

  if (!dryRun && resolved.size) writeFileSync(PIPELINE, repointPipeline(md, resolved), 'utf8');

  // ── gate persistently-unreadable rows so the triage/deep-dive agents stop
  // re-discovering them every run. Unrecognized platform gates immediately (it is
  // never going to resolve without a human pasting the JD). A recognized-ATS fetch
  // failure gets one retry (its previous count from a prior resolve-jds run) before
  // gating, in case the first failure was a transient network blip.
  const failCounts = loadFailCounts();
  const stillPendingUrls = new Set(pending.map(r => r.url));
  const { toGate, nextFailCounts } = computeGating({
    unrecognized: report.unrecognized, failed: report.failed,
    priorFailCounts: failCounts, retryLimit: RETRY_LIMIT,
  });
  // Drop counters for URLs no longer pending (resolved, gated, or removed elsewhere).
  for (const url of Object.keys(nextFailCounts)) {
    if (!stillPendingUrls.has(url)) delete nextFailCounts[url];
  }
  if (!dryRun) saveFailCounts(nextFailCounts);

  if (toGate.length && !dryRun) {
    const gateSet = new Map(toGate.map(g => [g.url, g.reason]));
    const { changed } = updatePipelineRows(PIPELINE, (row) => {
      if (row.state !== 'open' || !gateSet.has(row.url)) return null;
      const reasonShort = gateSet.get(row.url).replace(/[\r\n]+/g, ' ').slice(0, 80);
      return { box: '!', rest: `${row.rest} — gated: ${reasonShort}` };
    });
    report.gated = changed;
  } else {
    report.gated = 0;
  }

  // ── summary ──
  console.log(`resolve-jds ${dryRun ? '(dry run — no writes)' : ''}`.trim());
  console.log(`  ${report.resolved.length} resolved · ${report.alreadyLocal} already local · ${report.unrecognized.length} unrecognized · ${report.failed.length} failed · ${report.gated} gated (retry limit ${RETRY_LIMIT})\n`);
  for (const r of report.resolved) console.log(`  ✅ ${r.ats.padEnd(15)} ${r.company} — ${r.title}  (${r.chars}ch → ${r.file})`);
  if (report.failed.length) {
    console.log('\n  Recognized ATS but could not fetch (needs a board/site hint, or the posting is gone):');
    for (const r of report.failed) {
      const gated = toGate.some(g => g.url === r.url);
      console.log(`  ⚠ ${r.ats.padEnd(15)} ${r.company} — ${r.title}  (${r.reason})${gated ? '  [GATED — retry limit reached]' : '  [will retry once more next run]'}`);
    }
  }
  if (report.unrecognized.length) {
    console.log('\n  Unrecognized platform (no public JD API — paste the JD or supply a specific job URL):');
    for (const r of report.unrecognized) console.log(`  · ${r.company} — ${r.title}  [GATED — no retry]`);
  }
  if (dryRun && (report.failed.length || report.unrecognized.length)) {
    console.log('\n  (dry run: no rows were actually gated or written)');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
