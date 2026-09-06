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

const PROFILE_YML = process.env.TJK_PROFILE_YML
  ? path.resolve(process.env.TJK_PROFILE_YML)
  : path.resolve(ROOT_DIR, 'config', 'profile.yml');

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

// Dependency-free read of credentials.certifications (a list of objects, which
// the scalar reader can't handle). Scans the lines under the `certifications:`
// key and collects each entry until the block dedents.
//
// Returns the whole entry, not just the name: application forms ask for the
// certificate number and the issue/expiry dates as well, and those were being
// looked up by hand every time because the quick-copy bar only knew names.
function getCertEntries(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^\s*certifications:\s*$/.test(l));
  if (start === -1) return [];
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const unquote = (v) => v.replace(/^["']|["']$/g, '');
  const entries = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (l.match(/^\s*/)[0].length <= baseIndent) break; // dedented out of the block
    // A new list item starts an entry; subsequent keys attach to it.
    const isItem = /^\s*-\s/.test(l);
    const kv = l.match(/^\s*-?\s*([A-Za-z_]+):\s*(.*?)\s*$/);
    if (!kv) continue;
    if (isItem) { if (cur) entries.push(cur); cur = {}; }
    if (!cur) cur = {};
    const [, key, rawVal] = kv;
    if (rawVal !== '') cur[key] = unquote(rawVal);
  }
  if (cur) entries.push(cur);
  return entries.filter(e => e.name);
}

// Parse archetype names + title_variants from profile.yml. Returns an array of
// { name, variants: string[] } where variants are the raw title_variant strings
// (lowercased for matching). Falls back to an empty array for a fresh user.
//
// This is the only place that reads the archetype structure. inferArchetype() in
// applications.mjs consumes the output via getArchetypeRules() below.
function parseArchetypes(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  // Find the "archetypes:" key under "target_roles:"
  let inTargetRoles = false;
  let archetypesStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^target_roles:\s*$/.test(lines[i])) { inTargetRoles = true; continue; }
    if (inTargetRoles && /^\S/.test(lines[i])) break; // left the section
    if (inTargetRoles && /^\s+archetypes:\s*$/.test(lines[i])) { archetypesStart = i + 1; break; }
  }
  if (archetypesStart === -1) return [];

  const result = [];
  let current = null;
  let inVariants = false;
  for (let i = archetypesStart; i < lines.length; i++) {
    const ln = lines[i];
    if (/^\S/.test(ln)) break; // dedented to a new top-level block
    // A new list item at the archetype level (indented "- name:")
    const nameMatch = ln.match(/^\s+-\s+name:\s*"?([^"]*?)"?\s*$/);
    if (nameMatch) {
      if (current) result.push(current);
      current = { name: nameMatch[1].trim(), variants: [] };
      inVariants = false;
      continue;
    }
    // Start of title_variants block
    if (current && /^\s+title_variants:\s*$/.test(ln)) { inVariants = true; continue; }
    // A variant entry (indented "- ...")
    if (current && inVariants) {
      const varMatch = ln.match(/^\s+-\s+"?([^"]*?)"?\s*$/);
      if (varMatch) {
        current.variants.push(varMatch[1].trim().toLowerCase());
        continue;
      }
      // Any non-list line ends the variants block
      if (/^\s+\S/.test(ln) && !/^\s+-/.test(ln)) inVariants = false;
    }
  }
  if (current) result.push(current);
  return result;
}

let _archetypeCache = null; // { mtimeMs, rules }

// Returns archetype classification rules derived from profile.yml. Each entry
// has { name, pattern: RegExp } built from title_variants. Cached by mtime.
export function getArchetypeRules() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(PROFILE_YML).mtimeMs; } catch { /* missing profile */ }
  if (_archetypeCache && _archetypeCache.mtimeMs === mtimeMs) return _archetypeCache.rules;

  let text = '';
  try { text = fs.readFileSync(PROFILE_YML, 'utf8'); } catch { /* fresh user */ }

  const archetypes = parseArchetypes(text);
  const rules = archetypes
    .filter(a => a.variants.length > 0)
    .map(a => {
      // Build a regex from title_variants. Escape regex chars, join with |.
      const escaped = a.variants.map(v => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      return { name: a.name, pattern: new RegExp(escaped.join('|'), 'i') };
    });
  _archetypeCache = { mtimeMs, rules };
  return rules;
}

// Returns the list of archetype names from profile.yml (for the client's filter
// dropdowns and chart axes). Always ends with "Unclassified".
export function getArchetypeNames() {
  const rules = getArchetypeRules();
  const names = rules.map(r => r.name);
  if (!names.includes('Unclassified')) names.push('Unclassified');
  return names;
}

let _cache = null; // { mtimeMs, identity }
let _outreachCache = null; // { mtimeMs, policy }

// Defaults for the outreach guardrails. These apply only once the user adds an
// `outreach:` block; with no block, parseOutreachPolicy below neutralizes the new
// rules so behavior is exactly what it was before they existed.
//
// awaitingReplyHold deliberately matches minDaysBetweenTouches. It is a separate
// rule (do not re-pitch someone mid-thread) but if its default were longer, it
// would quietly become the real floor: the owner chose 3 days, and a 10 day hold
// on any unanswered message would have meant 10 whatever they set. One knob, one
// behavior. Raise this on its own if you want the hold to outlast the gap.
export const OUTREACH_DEFAULTS = Object.freeze({
  enabled: true,
  minDaysBetweenTouches: 3,
  // Widening per-channel gap. When set (a list like [3, 6]) it SUPERSEDES the flat
  // minDaysBetweenTouches: the first entry is the gap before touch 2, the next
  // before touch 3, and so on; the last entry repeats for every touch after that.
  // null means "use the flat gap" — the behavior before this existed. The count
  // that picks the entry is the number of prior Sent touches ON THAT CHANNEL, so
  // LinkedIn and email widen on their own clocks. This only spaces touches; the
  // hard STOP on unanswered cold touches is still coldOutreachCap.
  touchGapSchedule: null,
  maxTouchesPer30d: 6,
  awaitingReplyHold: 3,
  // A rest day that spans BOTH channels. The per-channel gap above only spaces
  // touches on the same channel, so a LinkedIn message on Monday left an email
  // free on Tuesday. This holds every channel for this many days after the most
  // recent touch on ANY channel, so a contact reached yesterday is not prompted
  // again today regardless of which channel it was. 1 = one clear rest day
  // (Monday touch clears Wednesday). 0 disables it.
  minDaysBetweenTouchesAnyChannel: 1,
  // Cool-off after someone accepts a LinkedIn connection before the "just
  // connected, send the ask" card surfaces. Asking a brand-new connection to flag
  // your application the day after they accept reads as hounding; let the
  // relationship breathe first. Counted in business days. 0 surfaces immediately.
  connectedCooloffDays: 5,
  coldOutreachCap: Object.freeze({ linkedin: 3, email: 3 }),
  perCompanyPerDay: 3,
  // At or below this many credits remaining, only decision-makers get one.
  inmailReserveFloor: 3,
});

// "3,6" -> [3, 6]. Any empty/negative/non-numeric part is dropped; an all-empty or
// missing value returns null so the caller falls back to the flat gap. A scalar so
// it parses with getScalar and never needs a YAML list reader.
function parseGapSchedule(raw) {
  // Drop empty tokens BEFORE Number(): Number('') is 0, so an absent value or a
  // stray comma would otherwise parse to a spurious 0-day gap instead of null.
  const parts = String(raw || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(Number).filter(n => Number.isFinite(n) && n >= 0);
  return parts.length ? parts : null;
}

function safeOutreachNumber(raw, fallback) {
  if (raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getNestedScalar(text, section, subsection, key) {
  const match = String(text || '').match(new RegExp(`^${section}:\\s*$[\\s\\S]*?^\\s+${subsection}:\\s*$[\\s\\S]*?^\\s+${key}:\\s*(.*)$`, 'm'));
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '').split(' #')[0].trim();
}

export function parseOutreachPolicy(text) {
  const hasBlock = /^outreach:\s*$/m.test(String(text || ''));
  if (!hasBlock) return {
    ...OUTREACH_DEFAULTS,
    enabled: true,
    minDaysBetweenTouches: 0,
    touchGapSchedule: null,
    maxTouchesPer30d: Number.POSITIVE_INFINITY,
    awaitingReplyHold: 0,
    coldOutreachCap: { ...OUTREACH_DEFAULTS.coldOutreachCap },
  };
  const enabledRaw = getScalar(text, 'outreach', 'enabled').toLowerCase();
  return {
    enabled: enabledRaw === '' ? true : enabledRaw !== 'false',
    minDaysBetweenTouches: safeOutreachNumber(getScalar(text, 'outreach', 'minDaysBetweenTouches'), OUTREACH_DEFAULTS.minDaysBetweenTouches),
    touchGapSchedule: parseGapSchedule(getScalar(text, 'outreach', 'touchGapSchedule')),
    maxTouchesPer30d: safeOutreachNumber(getScalar(text, 'outreach', 'maxTouchesPer30d'), OUTREACH_DEFAULTS.maxTouchesPer30d),
    awaitingReplyHold: safeOutreachNumber(getScalar(text, 'outreach', 'awaitingReplyHold'), OUTREACH_DEFAULTS.awaitingReplyHold),
    minDaysBetweenTouchesAnyChannel: safeOutreachNumber(getScalar(text, 'outreach', 'minDaysBetweenTouchesAnyChannel'), OUTREACH_DEFAULTS.minDaysBetweenTouchesAnyChannel),
    connectedCooloffDays: safeOutreachNumber(getScalar(text, 'outreach', 'connectedCooloffDays'), OUTREACH_DEFAULTS.connectedCooloffDays),
    coldOutreachCap: {
      linkedin: safeOutreachNumber(getNestedScalar(text, 'outreach', 'coldOutreachCap', 'linkedin'), OUTREACH_DEFAULTS.coldOutreachCap.linkedin),
      email: safeOutreachNumber(getNestedScalar(text, 'outreach', 'coldOutreachCap', 'email'), OUTREACH_DEFAULTS.coldOutreachCap.email),
    },
    perCompanyPerDay: safeOutreachNumber(getScalar(text, 'outreach', 'perCompanyPerDay'), OUTREACH_DEFAULTS.perCompanyPerDay),
    inmailReserveFloor: safeOutreachNumber(getScalar(text, 'outreach', 'inmailReserveFloor'), OUTREACH_DEFAULTS.inmailReserveFloor),
  };
}

export function getOutreachPolicy() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(PROFILE_YML).mtimeMs; } catch { /* missing profile */ }
  if (_outreachCache && _outreachCache.mtimeMs === mtimeMs) return _outreachCache.policy;
  let text = '';
  try { text = fs.readFileSync(PROFILE_YML, 'utf8'); } catch { /* fresh user */ }
  const policy = parseOutreachPolicy(text);
  _outreachCache = { mtimeMs, policy };
  return policy;
}

function getProofPoints(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^\s*proof_points:\s*$/.test(l));
  if (start === -1) return [];
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const unquote = (v) => v.replace(/^["']|["']$/g, '');
  const entries = [];
  let cur = null;
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (l.match(/^\s*/)[0].length <= baseIndent) break;
    const isItem = /^\s*-\s/.test(l);
    const kv = l.match(/^\s*-?\s*([A-Za-z_]+):\s*(.*?)\s*$/);
    if (!kv) continue;
    if (isItem) { if (cur) entries.push(cur); cur = {}; }
    if (!cur) cur = {};
    const [, key, rawVal] = kv;
    if (rawVal !== '') cur[key] = unquote(rawVal);
  }
  if (cur) entries.push(cur);
  return entries.filter(e => e.name && e.hero_metric);
}

function getSuperpowers(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^\s*superpowers:\s*$/.test(l));
  if (start === -1) return [];
  const baseIndent = lines[start].match(/^\s*/)[0].length;
  const result = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (l.match(/^\s*/)[0].length <= baseIndent) break;
    const m = l.match(/^\s*-\s*(.+)$/);
    if (!m) continue;
    let val = m[1].trim();
    if ((val.startsWith('"') || val.startsWith("'")) && val.length >= 2) {
      const q = val[0];
      const end = val.lastIndexOf(q);
      if (end > 0) val = val.slice(1, end);
    }
    if (val) result.push(val);
  }
  return result;
}

let _narrativeCache = null;

export function getNarrative() {
  let mtimeMs = 0;
  try { mtimeMs = fs.statSync(PROFILE_YML).mtimeMs; } catch { /* missing profile */ }
  if (_narrativeCache && _narrativeCache.mtimeMs === mtimeMs) return _narrativeCache.narrative;
  let text = '';
  try { text = fs.readFileSync(PROFILE_YML, 'utf8'); } catch { /* fresh user */ }
  const narrative = {
    headline: getScalar(text, 'narrative', 'headline'),
    superpowers: getSuperpowers(text),
    proofPoints: getProofPoints(text).map(point => ({
      name: point.name,
      heroMetric: point.hero_metric,
    })),
  };
  _narrativeCache = { mtimeMs, narrative };
  return narrative;
}

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
    // Names only, kept for anything that just wants the list.
    certifications: getCertEntries(text).map(c => c.name),
    // Full entries (number, issued, expires) for the quick-copy bar.
    certificationEntries: getCertEntries(text),
    headline: getScalar(text, 'narrative', 'headline'),
    // Convenience: the user's documented-approach landing page used in outreach.
    trajecktoryUrl: portfolioHost ? `${portfolioHost}/trajecktory` : '',
  };
  _cache = { mtimeMs, identity };
  return identity;
}

// The Obsidian vault folder that applied-role notes are filed under. Read from the
// user's gitignored profile (integrations.obsidian.applied_folder, three levels
// deep, so getScalar's two-level reader does not reach it). Falls back to a NEUTRAL
// default: this used to be hardcoded to the maintainer's real personal vault
// taxonomy in apply.mjs, which both disclosed his private folder structure in
// shipped code AND filed every other user's notes into his path.
export function getObsidianAppliedFolder() {
  let text = '';
  try { text = fs.readFileSync(PROFILE_YML, 'utf8'); } catch { /* fresh user */ }
  const lines = text.split(/\r?\n/);
  let inInteg = false, inObs = false;
  for (const ln of lines) {
    if (/^integrations:\s*$/.test(ln)) { inInteg = true; inObs = false; continue; }
    if (inInteg && /^\S/.test(ln)) break;                 // dedented out of integrations
    if (inInteg && /^\s+obsidian:\s*$/.test(ln)) { inObs = true; continue; }
    if (inObs && /^\s{0,2}\S/.test(ln)) inObs = false;    // dedented out of obsidian
    if (inObs) {
      const m = ln.match(/^\s+applied_folder:\s*(.*)$/);
      if (m) {
        let v = m[1].trim();
        if (v.startsWith('"') || v.startsWith("'")) { const q = v[0], e = v.indexOf(q, 1); if (e > 0) v = v.slice(1, e); }
        else { const h = v.indexOf(' #'); if (h >= 0) v = v.slice(0, h).trim(); }
        if (v) return v.replace(/\/+$/, '');
      }
    }
  }
  return 'Job Search/Applied';
}
