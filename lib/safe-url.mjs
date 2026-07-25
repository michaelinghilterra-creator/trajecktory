// SSRF guard for a URL that came from outside and is about to be fetched
// server-side. A job URL is written into pipeline.md by the scanner from board
// JSON, so it is attacker-influenced; the liveness probe then navigates to it.
// Without this, that probe is a request-forgery primitive pointed wherever the
// posting says (security: CWE-918): loopback, private ranges, link-local, and the
// 169.254.169.254 cloud-metadata endpoint.
//
// A LITERAL check, deliberately. It rejects an address that is plainly non-public;
// it does not resolve DNS, so a public hostname that resolves into private space is
// out of scope for a job-URL probe and would need a resolve-then-check at fetch
// time. Extracted from check-liveness.mjs so the actual shipped function is unit
// tested (that file pulls in Playwright and cannot be imported by a test).
export function isSafeLivenessUrl(url) {
  let u;
  try { u = new URL(String(url == null ? '' : url)); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname.toLowerCase();
  // localhost by name, any *.localhost, and any bracketed IPv6 literal (which
  // carries a ':') are refused outright — none is a public job board.
  if (h === 'localhost' || h.endsWith('.localhost') || h.includes(':')) return false;
  const parts = h.split('.');
  if (parts.length === 4 && parts.every((p) => p.length > 0 && Number.isInteger(Number(p)) && Number(p) >= 0 && Number(p) <= 255)) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a === 0 || a === 127 || a === 10) return false;      // "this host", loopback, private /8
    if (a === 169 && b === 254) return false;                // link-local incl. cloud metadata
    if (a === 192 && b === 168) return false;                // private /16
    if (a === 172 && b >= 16 && b <= 31) return false;       // private /12
  }
  return true;
}
