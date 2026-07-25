// Neutralize the delimiters that structure a pipeline/history row so an
// attacker-controlled field cannot forge one. A job's title, company, or URL comes
// from a board (scan.mjs) or from Brave/Muse discovery (discover.mjs), i.e. from
// outside, and both scanners write it into `data/pipeline.md` (a `|`-separated
// table) and `data/scan-history.tsv` (tab-separated). A raw `|`, tab, or newline in
// that field would open a second row the batch evaluator then reads as real work
// (security: CWE-20 / CWE-117). Tab, LF, CR and `|` collapse to a space; edges trim.
//
// One implementation on purpose. scan.mjs and discover.mjs carried byte-identical
// copies of this, which is exactly the drift that bit the report-path containment
// (a guard fixed at one call site and missed at another). Both import this now, and
// tests/security-review.test.mjs asserts neither keeps a private copy.
const NEUTRALIZE = new Set([9, 10, 13, 124]); // tab, LF, CR, pipe
export function sanitizeCell(s) {
  return String(s ?? '')
    .split('')
    .map((ch) => (NEUTRALIZE.has(ch.charCodeAt(0)) ? ' ' : ch))
    .join('')
    .trim();
}
