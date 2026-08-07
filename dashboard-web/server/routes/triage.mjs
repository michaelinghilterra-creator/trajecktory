import express from 'express';
import fs from 'fs';
import path from 'path';
import { ROOT_DIR, DATA_DIR, APPS_MD } from '../config.mjs';
import { canonicalUrl, buildDecidedIndex, findDecided } from '../../../lib/identity.mjs';
import { markDone, sourceUrlOf } from '../../../lib/pipeline.mjs';

export const router = express.Router();

// Postings already evaluated and recorded in applications.md. Rebuilt only when
// the tracker's mtime changes — a full scan of the tracker is cheap but this endpoint
// is polled, and the answer only moves when the tracker does.
let decidedCache = { mtimeMs: -1, index: null };
function decidedIndex() {
  const appsPath = APPS_MD;
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(appsPath).mtimeMs; } catch { return { byUrl: new Map(), ambiguous: new Set() }; }
  if (decidedCache.mtimeMs !== mtimeMs || !decidedCache.index) {
    decidedCache = { mtimeMs, index: buildDecidedIndex({ appsPath, rootDir: ROOT_DIR }) };
  }
  return decidedCache.index;
}

// ── Triage results reader ─────────────────────────────────────────────────────
// The triage agent (`/api/agent/triage`, run on Haiku) appends one line per scored
// posting to data/triage-results.tsv. The dashboard's triage cards read them here.
// Columns: url, company, title, score, rationale, date.
// Resolved under DATA_DIR (which honors TJK_DATA_DIR) so triage isolates in tests
// like every other route; in production DATA_DIR is the repo's own data/ dir.
const TRIAGE_TSV = () => path.join(DATA_DIR, 'triage-results.tsv');
const DISMISSED_TSV = () => path.join(DATA_DIR, 'triage-dismissed.tsv');
const PIPELINE_MD = () => path.join(DATA_DIR, 'pipeline.md');

// Check off a dismissed URL's pipeline.md row ("- [ ]" → "- [x]"). Without this,
// dismissing a card leaves its row unchecked forever, so it re-enters the triage
// top-15 window on every run and eventually crowds out genuinely-new postings —
// the exact clog that made a triage run write nothing. markDone (lib/pipeline.mjs)
// is the single, CRLF-safe, local+http-aware check-off writer. Best-effort: a
// dismissal must never fail because the pipeline file was busy or missing.
function checkOffPipelineRow(url) {
  try { markDone(PIPELINE_MD(), [canonicalUrl(url)]); }
  catch { /* best-effort — never break a dismissal */ }
}

// URLs the user dismissed ("not a match"). Durable so the cards never resurface:
// GET hides them, and the triage mode is told to skip them on the next scan.
// One `url\tdate` line per dismissal.
// Stored canonicalized so a dismissal survives a cosmetic URL variant (a
// ?utm_source= on the re-scan, /apply vs the bare posting path).
function loadDismissed() {
  const set = new Set();
  let text = '';
  try { text = fs.readFileSync(DISMISSED_TSV(), 'utf8'); } catch { return set; }
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('url\t')) continue; // blank or header
    set.add(canonicalUrl(line.split('\t')[0].trim()));
  }
  return set;
}

// GET /api/triage/results — parsed cards, best-score first, deduped to the most
// recent line per URL (a re-triage of the same URL supersedes the older score).
//
// Postings that already have a tracker row are split into `suppressed` rather
// than dropped. Silently hiding them would repeat the mistake this whole fix
// exists to undo: the user cannot audit a decision they never see, and the same
// reasoning is why portals.mjs surfaces a name-only company match instead of
// skipping it. When this landed, most of the scored cards turned out to be
// postings the tracker had already decided on.
router.get('/api/triage/results', (req, res) => {
  try {
    let text = '';
    try { text = fs.readFileSync(TRIAGE_TSV(), 'utf8'); } catch { return res.json({ cards: [], suppressed: [] }); }
    const byUrl = new Map();
    const dismissed = loadDismissed();
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const c = line.split('\t');
      if (c[0] === 'url' || c.length < 6) continue; // header or malformed (need all 6 columns)
      if (dismissed.has(canonicalUrl(c[0]))) continue; // user dismissed this role ("not a match")
      const score = parseFloat(c[3]);
      byUrl.set(canonicalUrl(c[0]), { // later lines win → most recent triage of this URL
        url: c[0],
        company: (c[1] || '').trim(),
        title: (c[2] || '').trim(),
        score: Number.isFinite(score) ? score : null,
        rationale: (c[4] || '').trim(),
        date: (c[5] || '').trim(),
      });
    }

    const index = decidedIndex();
    const cards = [];
    const suppressed = [];
    for (const card of byUrl.values()) {
      // A card scored while its pipeline row still pointed at a local:jds/ snapshot
      // (Ashby/Workday/etc. postings a plain fetch can't read) carries that local
      // path as its own url — which never canonical-matches the real posting URL
      // recorded in applications.md once the role is actually deep-dived. Resolve
      // the snapshot's own "**Source URL:**" header first so an already-evaluated
      // role gets suppressed instead of reappearing as an unresolved triage card
      // forever. See lib/pipeline.mjs's sourceUrlOf for the full incident history.
      const resolvedUrl = sourceUrlOf(card.url, ROOT_DIR) || card.url;
      const prior = findDecided(index, resolvedUrl, { company: card.company, role: card.title });
      if (prior) {
        suppressed.push({ ...card, existingNum: prior.num, existingStatus: prior.status });
      } else {
        cards.push(card);
      }
    }
    cards.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    suppressed.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
    res.json({ cards, suppressed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/triage/dismiss { url } — mark a triaged role "not a match". Records
// the URL durably so GET hides it and the next scan's triage skips it. Because
// triage rows live only here (never in applications.md), this touches nothing in
// the tracker or analytics. Idempotent.
router.post('/api/triage/dismiss', (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim();
    if (!url) return res.status(400).json({ error: 'A "url" is required.' });
    if (/[\t\r\n]/.test(url)) return res.status(400).json({ error: 'Invalid url (control characters).' });
    if (!loadDismissed().has(canonicalUrl(url))) {
      const file = DISMISSED_TSV();
      const header = fs.existsSync(file) ? '' : 'url\tdate\n';
      const date = new Date().toISOString().slice(0, 10);
      fs.appendFileSync(file, `${header}${url}\t${date}\n`, 'utf8');
    }
    checkOffPipelineRow(url); // stop the dismissed role from re-clogging the triage queue
    res.json({ ok: true, dismissed: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/triage/undismiss { url } — undo a dismissal (supports an "undo"
// affordance). The card reappears on the next results fetch.
router.post('/api/triage/undismiss', (req, res) => {
  try {
    const url = String((req.body && req.body.url) || '').trim();
    if (!url) return res.status(400).json({ error: 'A "url" is required.' });
    const file = DISMISSED_TSV();
    let text = '';
    try { text = fs.readFileSync(file, 'utf8'); } catch { return res.json({ ok: true, restored: url }); }
    const kept = text.split('\n').filter((raw) => {
      const line = raw.trim();
      if (!line) return false;
      if (line.startsWith('url\t')) return true; // keep header
      return canonicalUrl(line.split('\t')[0].trim()) !== canonicalUrl(url);
    });
    fs.writeFileSync(file, kept.length ? kept.join('\n') + '\n' : '', 'utf8');
    res.json({ ok: true, restored: url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
