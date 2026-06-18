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
// This module provides three pure helpers used by server/index.mjs:
//   - hasV1Frontmatter(md)  → boolean
//   - parseV1(md)           → { data, body }      throws on malformed JSON
//   - v1ToCheatsheet(data)  → cs object (same shape as legacy parser.mjs returns)

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

    // Scoring + recommendation
    globalScore:    Array.isArray(data.globalScore) ? data.globalScore : [],
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
