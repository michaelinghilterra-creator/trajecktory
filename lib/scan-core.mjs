/**
 * lib/scan-core.mjs — pure helpers for the portal scanner.
 *
 * Extracted from scan.mjs so the dedup and title-filter primitives can be
 * unit-tested in isolation (they were previously module-private and only
 * exercisable through a full end-to-end scan). No I/O, no network.
 */

// Note: "Chief of Staff" normalizes to "chief staff", which is fine — no
// real job title contains "chief staff" as a substring except actual
// Chief-of-Staff postings.
export function normalizeForMatch(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[—–()|/,:\-]/g, ' ')   // em-dash, en-dash, parens, comma, colon, pipe, slash, hyphen
    .replace(/\s+of\s+/g, ' ')
    .replace(/\s+(?:and|&)\s+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildTitleFilter(titleFilter) {
  const positive = (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  const negative = (titleFilter?.negative || []).map(normalizeForMatch).filter(Boolean);

  return (title) => {
    const norm = normalizeForMatch(title);
    // Negative keywords must match a WHOLE token run, not a fragment buried in
    // an unrelated word. The old substring match silently dropped real, relevant
    // postings: negative "hr" hit "Ant-hr-opic" and "T-hr-eat Intelligence",
    // "java" hit "JavaScript", "engineer" hit "Engineering". Pad with spaces so
    // " hr " only matches a standalone "hr" token. Positives stay substring-
    // lenient on purpose — they widen the funnel, and a too-narrow positive list
    // (not the negatives) is what filters out most postings.
    const padded = ` ${norm} `;
    const hasPositive = positive.length === 0 || positive.some(k => norm.includes(k));
    const hasNegative = negative.some(k => padded.includes(` ${k} `));
    return hasPositive && !hasNegative;
  };
}

// Cheap, no-LLM relevance score for RANKING scanned postings so the best-fit
// roles get evaluated first. The dashboard evaluates pipeline.md top-down in
// batches, so scan.mjs sorts new offers by this score before appending. Signals
// (all free at scan time): positive-keyword density (the core fit signal), a
// whole-token seniority-prefix boost, and posting recency. Higher = better fit.
// Unknown/missing dates are neutral (no recency bonus, no penalty).
export function scoreOffer(offer, titleFilter) {
  const norm = normalizeForMatch(offer?.title);
  if (!norm) return 0;
  const positive = (titleFilter?.positive || []).map(normalizeForMatch).filter(Boolean);
  const seniority = (titleFilter?.seniority_boost || []).map(normalizeForMatch).filter(Boolean);
  let score = 0;
  for (const k of positive) if (norm.includes(k)) score += 2;
  const padded = ` ${norm} `;
  if (seniority.some(k => padded.includes(` ${k} `))) score += 3;
  const t = offer?.postedAt ? new Date(offer.postedAt).getTime() : NaN;
  if (!isNaN(t)) {
    const ageDays = (Date.now() - t) / 86400000;
    if (ageDays < 7) score += 2; else if (ageDays < 30) score += 1;
  }
  return score;
}

// Strip query strings and a trailing /application or /apply so the same posting
// isn't re-added just because the URL variant changed (Ashby/Greenhouse expose
// /application, Lever exposes /apply). Order matters: drop the query FIRST,
// otherwise a `/application?utm=…` URL keeps its segment (the `$`-anchored regex
// can't match when a query trails it) and fails to dedupe against the stored
// clean URL. The (?:application|apply) group only strips a WHOLE trailing
// segment, so a company slug like jobs.lever.co/applydigital/{uuid} is left
// intact ("apply" there is followed by "digital", not "/" or end-of-string).
export function normalizeUrl(url) {
  return url.replace(/\?.*$/, '').replace(/\/(?:application|apply)(\/.*)?$/, '').replace(/\/$/, '');
}
