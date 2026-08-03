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

const __dirname = dirname(fileURLToPath(import.meta.url));
const PIPELINE = join(__dirname, 'data/pipeline.md');
const PORTALS = join(__dirname, 'portals.yml');
const JDS_DIR = join(__dirname, 'jds');

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

  // ── summary ──
  console.log(`resolve-jds ${dryRun ? '(dry run — no writes)' : ''}`.trim());
  console.log(`  ${report.resolved.length} resolved · ${report.alreadyLocal} already local · ${report.unrecognized.length} unrecognized · ${report.failed.length} failed\n`);
  for (const r of report.resolved) console.log(`  ✅ ${r.ats.padEnd(15)} ${r.company} — ${r.title}  (${r.chars}ch → ${r.file})`);
  if (report.failed.length) {
    console.log('\n  Recognized ATS but could not fetch (needs a board/site hint, or the posting is gone):');
    for (const r of report.failed) console.log(`  ⚠ ${r.ats.padEnd(15)} ${r.company} — ${r.title}  (${r.reason})`);
  }
  if (report.unrecognized.length) {
    console.log('\n  Unrecognized platform (no public JD API — paste the JD or supply a specific job URL):');
    for (const r of report.unrecognized) console.log(`  · ${r.company} — ${r.title}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1); });
}
