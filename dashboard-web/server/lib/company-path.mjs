// company-path.mjs — turn a company display name into the folder name and slug
// the interview-prep convention uses ("Example Co, Inc." -> "Example Co" ->
// "example-co").
//
// Extracted from organize-interview-prep.mjs, which now imports it, so the
// organizer that WRITES the folders and the dashboard that READS them share one
// implementation. Two copies would drift, and the drift is invisible: the
// dashboard would simply show an empty Interview tab for a company whose folder
// the organizer had filed under a name it no longer computes.
//
// Dependency-free on purpose (no config, no node_modules) so the repo-root CLI
// scripts can import it from here without pulling in the dashboard server.

const FORBIDDEN = /[\\/:*?"<>|]/g; // Windows-forbidden path characters
// Trailing legal suffix. Comma-preceded abbreviations (", Inc.", ", LLC", ", Co.")
// strip in either form; bare space-preceded forms only strip for spelled-out
// words and "Inc" — never bare " Co"/" Corp"/" LLC", so "Mystery Co" stays intact.
const LEGAL_SUFFIX = /(?:,\s*(?:inc|llc|l\.l\.c|corp|co|ltd|plc|gmbh|pbc|s\.a|sa|ag)\.?|\s+(?:incorporated|corporation|company|limited|inc)\.?)\s*$/i;

function cleanCompany(name) {
  if (!name) return null;
  let s = name.replace(/\s+/g, ' ').trim();
  let prev; // strip trailing legal suffix(es), e.g. "Foo Bar, Inc."
  do { prev = s; s = s.replace(LEGAL_SUFFIX, '').trim(); } while (s !== prev && s);
  s = s.replace(FORBIDDEN, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[.\s]+$/, '').trim(); // no trailing dot/space (Windows folder rule)
  return s || null;
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export { cleanCompany, slug, FORBIDDEN, LEGAL_SUFFIX };
