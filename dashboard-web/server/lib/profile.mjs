// server/lib/profile.mjs — single source of the user's identity for the
// dashboard. Reads config/profile.yml (the canonical profile) so NO personal
// name/email/phone/links are hardcoded in shippable server, route, or frontend
// code. Everything that used to hardcode the user's name/contact now reads here.
//
// Dependency-free on purpose: mirrors the tiny scalar reader in setup.mjs rather
// than pulling js-yaml into dashboard-web. We only read a handful of known
// scalar fields, never the whole document.
import fs from 'fs';
import path from 'path';
import { ROOT_DIR } from '../config.mjs';

const PROFILE_YML = path.resolve(ROOT_DIR, 'config', 'profile.yml');

// Read a scalar: top-level `key:` (section null) or one level of nesting
// (`section:` then an indented `key:`). Strips quotes and trailing inline ` #`.
function getScalar(text, section, key) {
  if (!text) return '';
  const lines = text.split(/\r?\n/);
  const stripVal = (raw) => {
    let v = raw.trim();
    if (v.startsWith('"') || v.startsWith("'")) {
      const q = v[0]; const end = v.indexOf(q, 1);
      if (end > 0) return v.slice(1, end);
    }
    const hash = v.indexOf(' #');
    if (hash >= 0) v = v.slice(0, hash).trim();
    return v;
  };
  if (!section) {
    for (const ln of lines) {
      const m = ln.match(new RegExp('^' + key + ':\\s*(.*)$'));
      if (m) return stripVal(m[1]);
    }
    return '';
  }
  let inSection = false;
  for (const ln of lines) {
    if (new RegExp('^' + section + ':\\s*$').test(ln)) { inSection = true; continue; }
    if (inSection) {
      if (/^\S/.test(ln)) break; // dedented to a new top-level block
      const m = ln.match(new RegExp('^\\s+' + key + ':\\s*(.*)$'));
      if (m) return stripVal(m[1]);
    }
  }
  return '';
}

// "+1-555-123-4567" -> "555.123.4567" (drop country code, dot-group the 10
// digits). Falls back to the raw string if it isn't a 10/11-digit number.
function fmtPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  const local = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (local.length === 10) return `${local.slice(0, 3)}.${local.slice(3, 6)}.${local.slice(6)}`;
  return String(raw || '');
}

// "https://www.linkedin.com/in/foo/" -> "linkedin.com/in/foo"
// "https://foo.com/" -> "foo.com"
function stripUrl(url) {
  return String(url || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
}

// Dependency-free read of credentials.certifications names (a list of {name,
// issuer} objects, which the scalar reader can't handle). Scans the lines under
// the `certifications:` key and pulls each `name:` until the block dedents.
function getCertNames(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^\s*certifications:\s*$/.test(l));
  if (start === -1) return [];
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const names = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (l.match(/^\s*/)[0].length <= baseIndent) break; // dedented out of the block
    const m = l.match(/^\s*-?\s*name:\s*(.+?)\s*$/);
    if (m) names.push(m[1].replace(/^["']|["']$/g, ''));
  }
  return names;
}

let _cache = null; // { mtimeMs, identity }

// Returns the user's identity, cached and invalidated by profile.yml mtime.
// All fields default to '' when profile.yml is absent (fresh, pre-onboarding
// user) so callers degrade gracefully instead of leaking a placeholder name.
export function getIdentity() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(PROFILE_YML).mtimeMs; } catch { /* missing: fall through */ }
  if (_cache && _cache.mtimeMs === mtimeMs) return _cache.identity;

  let text = '';
  try { text = fs.readFileSync(PROFILE_YML, 'utf8'); } catch { /* fresh user */ }

  const fullName = getScalar(text, 'candidate', 'full_name');
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] || '';
  const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
  const linkedin = getScalar(text, 'candidate', 'linkedin');
  const portfolioUrl = getScalar(text, 'candidate', 'portfolio_url');
  const portfolioHost = stripUrl(portfolioUrl);

  const identity = {
    fullName,
    firstName,
    lastName,
    email: getScalar(text, 'candidate', 'email'),
    phone: getScalar(text, 'candidate', 'phone'),
    phoneDisplay: fmtPhone(getScalar(text, 'candidate', 'phone')),
    location: getScalar(text, 'candidate', 'location'),
    linkedin,
    linkedinDisplay: stripUrl(linkedin),
    portfolioUrl,
    portfolioHost,
    github: getScalar(text, 'candidate', 'github'),
    // Reusable application info for the drawer's one-click "Quick copy" bar.
    certifications: getCertNames(text),
    headline: getScalar(text, 'narrative', 'headline'),
    // Convenience: the user's documented-approach landing page used in outreach.
    trajecktoryUrl: portfolioHost ? `${portfolioHost}/trajecktory` : '',
  };
  _cache = { mtimeMs, identity };
  return identity;
}
