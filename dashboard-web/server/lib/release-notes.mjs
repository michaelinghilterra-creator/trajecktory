// GitHub release notes, shared by the Change Log tab and the update banner.
//
// CHANGELOG.md is written by Release Please from commit SUBJECTS, so anything
// rendering it shows users internal script names and Conventional Commit scopes
// as though they were feature descriptions. The plain-language notes are written
// by hand on the GitHub release; this module is the one place that reads them.
//
// Deliberately ONE implementation with two consumers. The metric audit that
// preceded this found six competing "furthest rung reached" engines that had
// silently diverged, each added because a new surface re-solved a solved problem
// locally. Two copies of this would drift the same way.
//
// update-system.mjs is NOT a consumer and must not become one: it is the
// signature-gated updater and has to work before an update is applied. It keeps
// returning CHANGELOG.md text, which is exactly the fallback wanted when the API
// is unreachable.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { ROOT_DIR } from '../config.mjs';

const CACHE = path.resolve(ROOT_DIR, 'data', 'release-notes-cache.json');
const TTL_MS = 6 * 60 * 60 * 1000;
const FALLBACK_SLUG = 'michaelinghilterra-creator/trajecktory';

// Strip commit/issue reference links, leftover [label](url) markdown and bold
// markers, then sentence-case. Turns a raw bullet into something readable.
//
// The sentence-casing exists for the CHANGELOG.md fallback, whose entries are
// commit subjects and therefore start lowercase ("close the leak..."). It must
// not fire on the brand, which is lowercase by house rule everywhere including
// mid-UI and at the start of a sentence. Written notes legitimately open with
// it, and this used to render them as "Trajecktory ...".
const BRAND_FIRST = /^trajecktory\b/;
export function cleanNote(text) {
  const s = String(text)
    .replace(/\s*\([^()]*\[[^\]]+\]\([^)]*\)\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return BRAND_FIRST.test(s) ? s : s.replace(/^([a-z])/, (_, c) => c.toUpperCase());
}

// Prefer the install's own origin so a fork shows its own notes; fall back to the
// canonical public repo (the constant update-system.mjs anchors on).
function repoSlug() {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT_DIR, encoding: 'utf8', timeout: 4000 }).trim();
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+)/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch { /* no git, no remote, or not a checkout */ }
  return FALLBACK_SLUG;
}

export async function fetchReleases() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    if (Date.now() - c.at < TTL_MS && Array.isArray(c.releases)) return c.releases;
  } catch { /* cold or stale cache */ }
  // Unauthenticated: 60 req/hr per IP, hence the cache. A failure here is not an
  // error condition — every caller is expected to fall back.
  const res = await fetch(`https://api.github.com/repos/${repoSlug()}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'trajecktory-dashboard' },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const releases = (await res.json())
    .filter(r => r && !r.draft && !r.prerelease)
    .map(r => ({
      version: String(r.tag_name || '').replace(/^trajecktory[\s-]*/i, '').replace(/^v/, ''),
      date: String(r.published_at || '').slice(0, 10),
      body: String(r.body || ''),
    }));
  try {
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, JSON.stringify({ at: Date.now(), releases }, null, 2));
  } catch { /* cache is an optimisation, not a requirement */ }
  return releases;
}

// Install instructions are the bulk of a release body and useless in-app: by the
// time this renders, the reader is already installed.
const SKIP_SECTION = /^(install|download|upgrad|getting started)/i;

// Items carry their own kind. A release body mixes real bullet lists with prose
// paragraphs, and flattening both into strings made the UI bullet everything:
// hand-written prose rendered as a wall of one-sentence bullets, which is the
// look the written notes exist to avoid. `type` is what lets a paragraph render
// as a paragraph. Both this and parseChangelog in routes/setup-modules.mjs emit
// the shape, because both feed the same two components.
export function parseReleaseBody(body) {
  const sections = [];
  let sec = null, skipping = false, inProse = false;
  const open = (heading) => { sec = { heading, items: [] }; sections.push(sec); inProse = false; };
  for (const ln of String(body).split(/\r?\n/)) {
    const h3 = ln.match(/^###\s+(.+)$/);
    const h2 = !h3 && ln.match(/^##\s+(.+)$/);
    if (h2) {
      const t = h2[1].trim();
      skipping = SKIP_SECTION.test(t);
      // "What changed" is a wrapper, not a section — its ### children carry the headings.
      if (!skipping && !/^what changed/i.test(t)) open(t); else sec = null;
      continue;
    }
    if (h3) { if (!skipping) open(h3[1].trim()); continue; }
    if (skipping) continue;
    const it = ln.match(/^[-*]\s+(.+)$/);
    if (it) { if (!sec) open(''); sec.items.push({ type: 'bullet', text: cleanNote(it[1]) }); inProse = false; continue; }
    const prose = ln.trim();
    if (!prose) { inProse = false; continue; }
    if (/^<!--/.test(prose)) continue;
    if (!sec) open('');
    const last = sec.items[sec.items.length - 1];
    // inProse is only ever set by a prose line, and a bullet clears it, so `last`
    // here is always the prose item this line continues.
    if (inProse && last) last.text = cleanNote(`${last.text} ${prose}`);
    else { sec.items.push({ type: 'prose', text: cleanNote(prose) }); inProse = true; }
  }
  return sections.filter(s => s.items.length);
}

// Notes for one version, for the update banner. Returns null when the release is
// unknown or carries no written body, so the caller keeps its own fallback text
// rather than showing an empty panel.
export async function notesForVersion(version) {
  const want = String(version || '').replace(/^v/, '');
  if (!want) return null;
  const rel = (await fetchReleases()).find(r => r.version === want);
  if (!rel || !rel.body.trim()) return null;
  const sections = parseReleaseBody(rel.body);
  return sections.length ? { version: rel.version, date: rel.date, sections } : null;
}
