import fs from 'fs';
import path from 'path';
import { INTERVIEW_PREP_DIR } from '../config.mjs';
import { cleanCompany, slug } from './company-path.mjs';
import { parseApplicationsMd } from './applications.mjs';
import { INTERVIEW_STAGES, isInterviewStage } from './statuses.mjs';
import { reportMdToHtml } from './html.mjs';
import { parseRunsheet, derive } from '../../../render-runsheet.mjs';

// ── Interview tab ─────────────────────────────────────────────────────────────
// Reads the interview-prep tree (one folder per company, per the convention in
// modes/interview-prep.md) and joins it against the tracker:
//
//   interview-prep/{Company}/{company-slug}-round-{N}-{descriptor}.md      prep prose
//   interview-prep/{Company}/{company-slug}-round-{N}-{descriptor}.run.md  board sidecar
//
// The filesystem is the source of truth for what prep EXISTS; applications.md is
// the source of truth for where the application STANDS. Neither is derived from
// the other.
//
// Collision/hero warnings are NOT computed here: derive() from render-runsheet.mjs
// is imported and called. That is the whole point of deriving them — a second
// implementation would drift, and then the board and the dashboard would disagree
// about which stories collide, which is worse than not showing them at all.

// A round file carries its number in the FILENAME. Its stage does not live here:
// A tracker status and a round number are different things and neither derives the
// other: a company whose process opens with a TA screen ends up with status
// "1st Interview" on a file named round-2, while a company that opens with the
// hiring manager writes round-1 against status "Phone Screen". Any off-by-one you
// notice is a coincidence of one company's process, not a rule. Carry both.
const ROUND_RE = /-round-(\d+)-(.+)\.md$/i;
const RUN_SUFFIX = /\.run\.md$/i;

// Active for this tab = the interview ladder (Phone Screen .. 4th Interview,
// from states.yml via statuses.mjs) plus Offer, which is still a live session
// you prep for (the negotiation call). Everything else — Applied, Rejected,
// Discarded, or no tracker row at all — is archive.
function isActiveInterviewStatus(status) {
  return isInterviewStage(status) || status === 'Offer';
}

function safeRead(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

// Parse a .run.md, or null if it is missing/unreadable/malformed. Callers treat
// null as "no board": a half-written sidecar must degrade to a missing board,
// never to a broken tab.
function readRunsheet(runPath) {
  const raw = safeRead(runPath);
  if (raw == null) return null;
  try { return parseRunsheet(raw); } catch { return null; }
}

// ── Scan ──────────────────────────────────────────────────────────────────────

// Every {Company} folder under INTERVIEW_PREP_DIR, with its round files paired to
// their optional sidecars. story-bank.md is a top-level FILE, so filtering to
// directories drops it without naming it.
function scanPrepFolders() {
  let entries;
  try {
    entries = fs.readdirSync(INTERVIEW_PREP_DIR, { withFileTypes: true });
  } catch {
    return []; // no prep dir yet (fresh install, or a redirected dir not created)
  }

  const folders = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const prepDir = path.join(INTERVIEW_PREP_DIR, e.name);

    let files;
    try { files = fs.readdirSync(prepDir); } catch { continue; }

    const rounds = [];
    for (const base of files) {
      if (RUN_SUFFIX.test(base)) continue;      // sidecar, paired below
      const m = base.match(ROUND_RE);
      if (!m) continue;                          // company intel report, not a round
      const prepPath = path.join(prepDir, base);
      const runPath = path.join(prepDir, base.replace(/\.md$/i, '.run.md'));
      const sheet = fs.existsSync(runPath) ? readRunsheet(runPath) : null;
      rounds.push({
        round: parseInt(m[1], 10),
        descriptor: m[2],
        prepPath,
        // runPath is set whenever the file is on disk; hasBoard says whether it
        // actually parses. A malformed sidecar is visible (the path is there to
        // open and fix) but is not offered as a board.
        runPath: fs.existsSync(runPath) ? runPath : null,
        hasBoard: !!sheet,
        stage: typeof sheet?.data?.stage === 'string' ? sheet.data.stage : null,
        appId: Number.isFinite(sheet?.data?.id) ? sheet.data.id : null,
      });
    }
    rounds.sort((a, b) => a.round - b.round);

    folders.push({ folder: e.name, company: cleanCompany(e.name) || e.name, prepDir, rounds });
  }
  return folders;
}

// ── Tracker join ──────────────────────────────────────────────────────────────

// Match a folder to its tracker row by company slug: the folder drops the legal
// suffix ("Example Co, Inc." -> "Example Co") while the tracker keeps it, so
// cleanCompany + slug is what makes them the same key.
//
// One company can own several rows: re-applying to a company months later leaves an
// older closed row and a newer live one, deliberately kept separate. Preference order:
//   1. the id a run sheet names outright — authored, exact, wins over any guess
//   2. a row on an active interview status — the one you are actually prepping
//   3. the highest id — the counter is monotonic, so this is the most recent
function pickTrackerRow(folder, rowsBySlug) {
  const rows = rowsBySlug.get(slug(folder.company)) || [];
  if (rows.length === 0) return null;

  const namedIds = new Set(folder.rounds.map(r => r.appId).filter(id => id != null));
  const named = rows.filter(r => namedIds.has(r.id));
  const pool = named.length ? named : rows;

  const active = pool.filter(r => isActiveInterviewStatus(r.status));
  const candidates = active.length ? active : pool;
  return candidates.reduce((best, r) => (best == null || r.id > best.id ? r : best), null);
}

function buildSession(folder, row) {
  // The session's round is the furthest round file on disk, not a count: a folder
  // holding only round-2 is at round 2.
  const latest = folder.rounds.length
    ? folder.rounds.reduce((m, r) => Math.max(m, r.round), 0)
    : null;

  // The tracker is only a usable stage fallback when its status IS a stage: the
  // interview ladder (Phone Screen .. 4th Interview). "Rejected"/"Discarded"/
  // "Offer" are OUTCOMES, not rounds: a round that was later rejected is still a
  // hiring-manager round, and stamping "Rejected" on it states something that never
  // happened. And even a real stage only describes where the app stands TODAY, i.e.
  // the LATEST round: an earlier round was a screen even though the tracker has since
  // moved on, so stamping the live status onto every round mislabels the earlier ones.
  const trackerStage = row && isInterviewStage(row.status) ? row.status : null;

  const rounds = folder.rounds.map(r => ({
    round: r.round,
    // A run sheet states its own stage, per round, and is authoritative. Failing
    // that, the gated tracker fallback above. Failing that, null — the UI shows
    // "Round N", which is true, rather than a stage that is false.
    stage: r.stage || (r.round === latest ? trackerStage : null),
    descriptor: r.descriptor,
    prepPath: r.prepPath,
    runPath: r.runPath,
    hasBoard: r.hasBoard,
  }));

  // A run sheet also carries company/role, so a folder with no tracker row still
  // shows a real role instead of a blank.
  const sheetRole = folder.rounds.map(r => r.runPath).filter(Boolean)
    .map(p => readRunsheet(p)?.data?.role).find(Boolean) || null;

  return {
    // Slug, not the tracker id: it is the folder's identity, so it exists even for
    // a prep folder with no tracker row (which is exactly what archive is for).
    // The routes also accept the numeric app id.
    id: slug(folder.company),
    company: folder.company,
    role: row?.role || sheetRole,
    status: row?.status || null,
    round: latest,
    prepDir: folder.prepDir,
    appId: row?.id ?? null,
    rounds,
  };
}

// Most recent first (the counter is monotonic), folders with no tracker row last,
// company name as the tiebreak so the order never wobbles between calls.
function bySession(a, b) {
  if ((a.appId == null) !== (b.appId == null)) return a.appId == null ? 1 : -1;
  if (a.appId != null && b.appId != null && a.appId !== b.appId) return b.appId - a.appId;
  return a.company.localeCompare(b.company);
}

// ── Public API ────────────────────────────────────────────────────────────────

// { active, archive } — every company prep folder, split by tracker status.
function listSessions() {
  let rows = [];
  try { rows = parseApplicationsMd(); } catch { rows = []; } // no tracker yet: all archive

  const rowsBySlug = new Map();
  for (const r of rows) {
    const key = slug(cleanCompany(r.company) || r.company);
    if (!key) continue;
    if (!rowsBySlug.has(key)) rowsBySlug.set(key, []);
    rowsBySlug.get(key).push(r);
  }

  const active = [];
  const archive = [];
  for (const folder of scanPrepFolders()) {
    const row = pickTrackerRow(folder, rowsBySlug);
    const session = buildSession(folder, row);
    (row && isActiveInterviewStatus(row.status) ? active : archive).push(session);
  }
  active.sort(bySession);
  archive.sort(bySession);
  return { active, archive };
}

function findSession(id) {
  const want = String(id == null ? '' : id).trim().toLowerCase();
  if (!want) return null;
  const { active, archive } = listSessions();
  const all = [...active, ...archive];
  return all.find(s => s.id === want)
      || all.find(s => s.appId != null && String(s.appId) === want)
      || null;
}

// The parsed frontmatter verbatim, plus everything derive() computed. Returns
// { error } when there is no board for that round — the route turns it into a 404.
// A malformed sidecar is NOT this case: parseRunsheet throws with a precise
// message and the route surfaces it as a 500, because "your file is broken" and
// "you have no run sheet for round 3" are different answers.
function getRunsheet(id, round) {
  const session = findSession(id);
  if (!session) return { error: `No interview prep found for "${id}".` };
  const n = parseInt(round, 10);
  if (!Number.isFinite(n)) return { error: `Invalid round "${round}".` };
  const entry = session.rounds.find(r => r.round === n);
  if (!entry) return { error: `${session.company} has no round ${n}.` };
  if (!entry.runPath) {
    // Per templates/runsheet-schema-v1.md: a round with no .run.md simply has no
    // board. That is a correct state, not a debt.
    return { error: `No run sheet for ${session.company} round ${n}. This round has prep but no live board.` };
  }
  const raw = safeRead(entry.runPath);
  if (raw == null) return { error: `Run sheet is not readable: ${entry.runPath}` };

  const { data } = parseRunsheet(raw);
  const { warnings, problems, collidingKeys, heroKey } = derive(data);
  return {
    data,                              // frontmatter, verbatim
    warnings,
    problems,
    collidingKeys: [...collidingKeys], // derive() returns a Set; JSON needs an array
    heroKey: heroKey ?? null,
  };
}

// The prep prose for one round. Returns { error } when the file is gone.
function getPrep(id, round) {
  const session = findSession(id);
  if (!session) return { error: `No interview prep found for "${id}".` };
  const n = parseInt(round, 10);
  if (!Number.isFinite(n)) return { error: `Invalid round "${round}".` };
  const entry = session.rounds.find(r => r.round === n);
  if (!entry) return { error: `${session.company} has no round ${n}.` };
  const markdown = safeRead(entry.prepPath);
  if (markdown == null) return { error: `Prep file not found: ${entry.prepPath}` };
  // Render server-side with the SAME converter the report drawer uses. A prep file is
  // dense real markdown (tables, numbered lists, links, code spans); a hand-rolled
  // client renderer drops all of it and leaks raw pipes onto the page. reportMdToHtml
  // also owns escaping via safeHref, so the client's dangerouslySetInnerHTML sink is
  // fed sanitized HTML rather than arbitrary file content.
  let html = null;
  try {
    html = reportMdToHtml(markdown);
  } catch {
    html = null; // fall back to the client's plain-prose renderer
  }
  return { markdown, html };
}

export {
  listSessions,
  findSession,
  getRunsheet,
  getPrep,
  isActiveInterviewStatus,
  INTERVIEW_STAGES,
};
