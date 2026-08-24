// v1-loader.mjs — load reports written in the trajecktory Report Schema v1 format.
//
// v1 reports start with a JSON frontmatter block fenced by `---` lines:
//   ---
//   { "schema": "trajecktory-report/v1", "id": 12, ... }
//   ---
//   # Markdown narrative body...
//
// See templates/report-schema-v1.md for the field reference.
//
// This module provides the pure helpers used by server/index.mjs:
//   - hasV1Frontmatter(md)  → boolean
//   - parseV1(md)           → { data, body }      throws on malformed JSON
//   - v1ToCheatsheet(data)  → cs object (same shape as legacy parser.mjs returns)
//   - validateReportMarkdown(md, label) → { ok, error }   write-time syntax gate

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?/;

export function hasV1Frontmatter(md) {
  if (!md || !md.startsWith('---')) return false;
  const m = md.match(FRONTMATTER_RE);
  if (!m) return false;
  const trimmed = m[1].trim();
  if (!trimmed.startsWith('{')) return false;
  // Cheap schema sniff — avoid JSON.parse just to detect.
  return /"schema"\s*:\s*"(?:trajecktory-report\/v\d|report-v\d)/.test(trimmed);
}

export function parseV1(md) {
  const m = md.match(FRONTMATTER_RE);
  if (!m) throw new Error('No frontmatter block');
  const data = JSON.parse(m[1]);
  const body = md.slice(m[0].length);
  return { data, body };
}

// Strip frontmatter and return only the narrative body (for the Full Report tab).
// Returns the original string when no v1 frontmatter is present.
export function stripFrontmatter(md) {
  if (!hasV1Frontmatter(md)) return md;
  const m = md.match(FRONTMATTER_RE);
  return md.slice(m[0].length);
}

// Read the same fields readReportHeader() extracts from legacy markdown, but
// from v1 frontmatter. Returns { url, domain, compStated, legitimacy }.
export function v1Header(data) {
  return {
    url: data.url || null,
    domain: data.domain || null,
    compStated: data.summary?.compStated || data.comp?.stated || null,
    legitimacy: data.legitimacy?.tier || null,
  };
}

// Project v1 frontmatter onto the cheat-sheet shape consumed by drawer.jsx.
// Field names match the legacy parser's return object exactly so the drawer
// renders identically for v1 and legacy reports.
export function v1ToCheatsheet(data) {
  const s = data.summary || {};
  const lm = data.levelMatch || {};
  const c  = data.comp || {};
  const ls = data.leadStory || {};
  const lg = data.legitimacy || {};

  return {
    // Header / meta
    url:                  data.url || null,
    legitimacy:           lg.tier || 'Proceed with Caution',
    legitimacyConclusion: lg.conclusion || null,
    // Normalize signals: agents sometimes write plain strings instead of {signal,finding,good} objects.
    // Coerce strings so the drawer always receives the expected shape.
    legitimacySignals: Array.isArray(lg.signals)
      ? lg.signals.map(s =>
          typeof s === 'string'
            ? { signal: s, finding: '', good: !/❌|negative|bad|suspicious|caution|hard.no|unverified/i.test(s) }
            : s
        )
      : [],
    batchId:              data.batchId || null,
    pdf:                  data.pdf || null,
    docx:                 data.docx || null,

    // Summary block
    archetypeDetected: s.archetypeDetected || null,
    domain:            data.domain || null,
    function:          s.function || null,
    seniority:         s.seniority || null,
    remote:            s.remote || null,
    teamSize:          s.teamSize || null,
    compStated:        s.compStated || c.stated || null,
    tldr:              s.tldr || null,
    companyBrief:      s.companyBrief || null,

    // Scoring + recommendation.
    // scoreSource distinguishes a DERIVED headline (computed by lib/score.mjs from
    // the keyed globalScore dimensions + the user's weights) from a LEGACY one
    // (authored under the old rubric). Absent means legacy: existing reports are read
    // as legacy without being rewritten, and their authored number is never silently
    // recomputed. scoreBasis is the derivation snapshot (weights + per-dim points +
    // penalty) so a derived headline stays traceable even if the weights change later.
    globalScore:    Array.isArray(data.globalScore) ? data.globalScore : [],
    scoreSource:    data.scoreSource === 'derived' ? 'derived' : 'legacy',
    scoreBasis:     data.scoreBasis && typeof data.scoreBasis === 'object' ? data.scoreBasis : null,
    recommendation: data.recommendation || null,
    keywords:       Array.isArray(data.keywords) ? data.keywords : [],

    // CV match + gaps
    cvMatch: Array.isArray(data.cvMatch) ? data.cvMatch : [],
    gaps:    Array.isArray(data.gaps)    ? data.gaps    : [],

    // Level / sell-senior
    levelMatch: {
      jdLevel:      lm.jdLevel      || null,
      naturalLevel: lm.naturalLevel || null,
      verdict:      lm.verdict      || null,
    },
    sellSenior:    Array.isArray(data.sellSenior) ? data.sellSenior : [],
    downlevelPlan: data.downlevelPlan || null,

    // Comp
    comp: {
      stated:   c.stated   || null,
      sources:  Array.isArray(c.sources) ? c.sources : [],
      score:    c.score    ?? null,
      walkaway: c.walkaway ?? null,
      verdict:  c.verdict  || null,
      market:   c.market   || null,
    },

    // Customize
    customizationCV: Array.isArray(data.customizationCV) ? data.customizationCV : [],
    customizationLI: Array.isArray(data.customizationLI) ? data.customizationLI : [],

    // Interview
    starStories: Array.isArray(data.starStories) ? data.starStories : [],
    leadStory: {
      title:  ls.title  || null,
      reason: ls.reason || null,
      script: ls.script || null,
    },
    redFlagQs: Array.isArray(data.redFlagQs) ? data.redFlagQs : [],
  };
}

// ── Write-time validation ────────────────────────────────────────────────────
// A report is authored by the headless agent, one JSON blob emitted by a model,
// and nothing between the model and the disk ever parsed it. A single wrong
// closing bracket (report 1869 closed the `leadStory` OBJECT with `],`) makes the
// whole frontmatter unreadable, and because the drawer and verify-reports.mjs
// parse every report in one pass, that one file takes down the entire read. It
// sat on disk until the next health check.
//
// validateReportMarkdown is the check to run the moment a report is written, so
// the failure surfaces against the run that produced it. It is deliberately
// STRICTER than hasV1Frontmatter: that helper sniffs for a `"schema"` key and
// falls back to the legacy prose parser when it does not find one, which is the
// right behavior for READING the 600+ legacy reports but the wrong behavior for
// a fresh write — a v1 report whose JSON broke before the schema key would sniff
// as legacy and be silently parsed as prose, losing every field. Here, anything
// that OPENS a `---` fence with a `{` is treated as intended-v1 and must parse.
//
// Returns { ok: true } or { ok: false, error } with a message that names the
// FILE line and shows it, since JSON.parse only reports a byte offset into the
// frontmatter substring ("position 17676"), which is useless for finding it.
export function validateReportMarkdown(md, label = 'report') {
  if (typeof md !== 'string' || !md.trim()) {
    return { ok: false, error: `${label}: file is empty` };
  }
  // Legacy prose reports do not open with a fence — nothing to parse, nothing to
  // check. Only a leading `---` claims a frontmatter block.
  if (!md.startsWith('---')) return { ok: true };

  const m = md.match(FRONTMATTER_RE);
  if (!m) {
    return { ok: false, error: `${label}: opens a "---" frontmatter fence that is never closed by a matching "---" line` };
  }
  const trimmed = m[1].trim();
  // A fenced block that is not JSON is not a v1 report (YAML frontmatter, or a
  // stray horizontal rule). Out of scope. A leading `[` counts as intended-JSON
  // so a model that emitted an array is caught by the object check below rather
  // than waved through as "not JSON".
  if (!/^[{[]/.test(trimmed)) return { ok: true };

  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    // JSON.parse counts from the start of the frontmatter body; shift by the
    // opening fence so the number matches what an editor shows for the file.
    const prefix = md.match(/^---\s*\n/);
    const prefixLen = prefix ? prefix[0].length : 4;
    const pos = Number((/at position (\d+)/.exec(e.message) || [])[1]);
    let where = '';
    if (Number.isFinite(pos)) {
      const before = md.slice(0, prefixLen + pos);
      const line = before.split('\n').length;
      const col = before.length - (before.lastIndexOf('\n') + 1) + 1;
      const text = (md.split('\n')[line - 1] || '').trim().slice(0, 120);
      where = ` at line ${line}, column ${col}${text ? ` → ${text}` : ''}`;
    }
    // Drop JSON.parse's own byte offset and its frontmatter-relative line/column.
    // Both are measured from the start of the fenced block, so quoting them next
    // to the real file line gives two different numbers for one fault.
    const why = e.message.replace(/ at position \d+/, '').replace(/\s*\(line \d+ column \d+\)/, '').trim();
    return { ok: false, error: `${label}: JSON frontmatter is malformed${where}. ${why}` };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: `${label}: JSON frontmatter is not an object` };
  }
  // Parses, but without a schema tag hasV1Frontmatter sniffs it as legacy and the
  // drawer reads it with the PROSE parser — every frontmatter field silently
  // dropped. That is the same class of failure as a syntax error, so catch it here.
  if (!/^(?:trajecktory-report\/v\d|report-v\d)/.test(String(data.schema || ''))) {
    return { ok: false, error: `${label}: JSON frontmatter parses but carries no "schema": "trajecktory-report/v1" tag, so it will be read as a legacy prose report and every field dropped` };
  }
  return { ok: true };
}
