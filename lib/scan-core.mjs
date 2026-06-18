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
  const positive = (titleFilter?.positive || []).map(normalizeForMatch);
  const negative = (titleFilter?.negative || []).map(normalizeForMatch);

  return (title) => {
    const norm = normalizeForMatch(title);
    const hasPositive = positive.length === 0 || positive.some(k => norm.includes(k));
    const hasNegative = negative.some(k => norm.includes(k));
    return hasPositive && !hasNegative;
  };
}

// Strip query strings and trailing /application so the same Ashby/Greenhouse
// job isn't re-added just because the URL variant changed (e.g. with /application).
// Order matters: drop the query FIRST, otherwise a `/application?utm=…` URL keeps
// its `/application` segment (the `$`-anchored /application regex can't match when
// a query trails it) and fails to dedupe against the stored clean URL.
export function normalizeUrl(url) {
  return url.replace(/\?.*$/, '').replace(/\/application(\/.*)?$/, '').replace(/\/$/, '');
}
