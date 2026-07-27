#!/usr/bin/env node
/**
 * fetch-jd.mjs — read a job description straight from the ATS API, not the SPA.
 *
 * Ashby, Greenhouse, and Lever all serve their postings as JavaScript single-page
 * apps: a WebFetch of the human URL returns an empty shell, so the eval used to
 * either fail ("couldn't read") or, worse, stitch a JD together from search
 * results and score a posting it never actually read. But every one of those ATS
 * platforms ALSO exposes a public JSON API that returns the full description. the
 * exact endpoints the zero-token scanner already hits. This resolves a posting URL
 * to that API and prints the real JD text.
 *
 *   node fetch-jd.mjs <job-url>
 *
 * Exit 0 + JD text on stdout when found; exit 1 (and nothing on stdout) when the
 * URL is an ATS this cannot read via API (e.g. Workday without a resolvable site,
 * or a company-hosted Greenhouse board whose token is not in the URL). The caller
 * then falls back to WebFetch, and only if THAT fails does it go to manual paste.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const url = (process.argv[2] || '').trim();
if (!url) { process.stderr.write('usage: node fetch-jd.mjs <job-url>\n'); process.exit(2); }

// HTML → plain text for Greenhouse `content` (Ashby/Lever already give descriptionPlain).
// Deliberately NOT a security sanitizer: it strips ALL tags with one generic pattern
// rather than an incomplete <script>-specific regex (which CodeQL rightly flags as an
// unreliable tag filter), and it decodes entities in a SINGLE pass via a lookup so
// nothing is double-unescaped (a staged "&amp;"→"&" before "&lt;"→"<" would double-decode).
const HTML_ENT = { amp: '&', nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };
const decodeEntities = (s) => s.replace(/&(#\d+|#x[0-9a-f]+|amp|nbsp|lt|gt|quot|apos|rsquo|lsquo|ldquo|rdquo);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return Number.isFinite(code) ? String.fromCharCode(code) : m;
  }
  return HTML_ENT[e.toLowerCase()] ?? m;
});
const stripHtml = (html) =>
  // Decode entities FIRST — Greenhouse `content` is entity-escaped HTML (&lt;h2&gt;),
  // so the real tags only appear after decoding. ONE pass (single replace) so nothing is
  // double-unescaped, then strip the now-real tags with a generic pattern (no incomplete
  // <script>-specific filter, which CodeQL rightly rejects).
  decodeEntities(String(html || ''))
    .replace(/<\/(?:p|div|li|h[1-6]|br|tr)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

async function getJson(u) {
  const res = await fetch(u, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

// Map a company-hosted Greenhouse URL (no token in the path) back to its board
// token via portals.yml, which stores the api endpoint per tracked company.
function greenhouseTokenFromPortals(host) {
  try {
    const y = readFileSync(join(__dirname, 'portals.yml'), 'utf8');
    for (const m of y.matchAll(/boards-api\.greenhouse\.io\/v1\/boards\/([^/\s"']+)/g)) {
      // best-effort: return the first token whose slug appears in the host
      const tok = m[1];
      if (host.includes(tok)) return tok;
    }
  } catch { /* no portals.yml */ }
  return null;
}

async function ashby(slug, id) {
  const feed = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}?includeCompensation=true`);
  const jobs = feed.jobs || [];
  const hit = jobs.find(j => (j.id && j.id === id) || (j.jobUrl && j.jobUrl.includes(id))) || null;
  if (!hit) return null;
  const desc = hit.descriptionPlain || stripHtml(hit.descriptionHtml);
  return { title: hit.title, location: hit.location, isRemote: hit.isRemote, workplaceType: hit.workplaceType, text: desc };
}

async function lever(token, id) {
  try {
    const j = await getJson(`https://api.lever.co/v0/postings/${token}/${id}`);
    const desc = j.descriptionPlain || stripHtml(j.description) || stripHtml(j.descriptionBodyPlain || j.descriptionBody);
    return { title: j.text, location: j.categories?.location, workplaceType: j.workplaceType, text: desc };
  } catch {
    // Fall back to scanning the board list for the id.
    const list = await getJson(`https://api.lever.co/v0/postings/${token}`);
    const j = (Array.isArray(list) ? list : []).find(p => p.id === id);
    if (!j) return null;
    return { title: j.text, location: j.categories?.location, workplaceType: j.workplaceType, text: j.descriptionPlain || stripHtml(j.description) };
  }
}

async function greenhouse(token, id) {
  const j = await getJson(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}?content=true`);
  return { title: j.title, location: j.location?.name, text: stripHtml(j.content) };
}

// SSRF barrier (CWE-918). The slug/token/id come from an attacker-influenced pipeline
// URL and are interpolated into the PATH of a hardcoded-host ATS API request. A crafted
// job URL must not be able to redirect or traverse that request, so every dynamic path
// segment is validated against a strict character allowlist (URL-path-safe only, no `/`,
// `@`, `:`, `?`, `#`, and no `..`) BEFORE it can reach fetch(). The regex `.test()` below
// is the sanitizer on the taint path; anything failing it is treated as unreadable and
// falls through to WebFetch/manual paste. `SEG` is deliberately inlined at each guard.
const SEG = /^[A-Za-z0-9._%-]+$/;
const ok = (s) => typeof s === 'string' && SEG.test(s) && !s.includes('..');

async function main() {
  let out = null;
  const ashbyM = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{16,})/i);
  const leverM = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{16,})/i);
  const ghBoardM = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  const ghJidM = url.match(/[?&]gh_jid=(\d+)/);

  try {
    if (ashbyM && SEG.test(ashbyM[1]) && !ashbyM[1].includes('..') && SEG.test(ashbyM[2])) {
      out = await ashby(ashbyM[1], ashbyM[2]);
    } else if (leverM && SEG.test(leverM[1]) && !leverM[1].includes('..') && SEG.test(leverM[2])) {
      out = await lever(leverM[1], leverM[2]);
    } else if (ghBoardM && SEG.test(ghBoardM[1]) && !ghBoardM[1].includes('..') && SEG.test(ghBoardM[2])) {
      out = await greenhouse(ghBoardM[1], ghBoardM[2]);
    } else if (ghJidM && SEG.test(ghJidM[1])) {
      // company-hosted Greenhouse: token not in the path — resolve via portals.yml (a
      // local config value, not the request URL), then re-validate before use.
      const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();
      const tok = greenhouseTokenFromPortals(host);
      if (tok && ok(tok)) out = await greenhouse(tok, ghJidM[1]);
    }
  } catch (e) {
    process.stderr.write(`fetch-jd: ${e.message}\n`);
  }

  if (!out || !out.text || out.text.length < 40) {
    process.stderr.write('fetch-jd: no JD available via ATS API for this URL\n');
    process.exit(1);
  }
  const header = [
    out.title && `Title: ${out.title}`,
    out.location && `Location: ${out.location}`,
    (out.isRemote != null) && `Remote: ${out.isRemote}`,
    out.workplaceType && `Workplace: ${out.workplaceType}`,
  ].filter(Boolean).join('\n');
  process.stdout.write((header ? header + '\n\n' : '') + out.text + '\n');
}
main().catch(e => { process.stderr.write(`fetch-jd: ${e.message}\n`); process.exit(1); });
