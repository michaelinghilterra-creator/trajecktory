// lib/text-hygiene-core.mjs -- pure text-hygiene transforms (no I/O, no deps).
//
// Why this exists: trajecktory drafts a lot of text with an LLM (cover letters,
// resume slots, recruiter / LinkedIn / coach drafts, evaluation reports). Model
// output carries invisible/format Unicode (zero-width spaces, BOM, bidi controls)
// and "AI-prose tells" (em dashes, curly quotes, the ellipsis character) that make
// a document look machine-made and can break ATS keyword parsing or a clean Word
// paste. This module folds that back to plain, human-looking text.
//
// This is DOCUMENT HYGIENE -- clean, human-sounding, parseable output -- NOT
// "AI-detection evasion". A Unicode scrub does not defeat a statistical or
// cadence-based detector, and nothing here claims it does.
//
// Load-bearing design rules:
//  - Idempotent. Every transform is a fixed point; running twice == running once.
//    Never add an inverse rule (e.g. "..." back to one ellipsis char) or output
//    oscillates.
//  - Length-stable ATS preset. cleanAtsField only strips (shrinks) or does 1:1
//    swaps, so a tailored resume slot can never trip the +/-15% char-count drift
//    guard in generate-docx-from-template.mjs (which exit(2)s on drift).
//  - Protected spans stay byte-exact. URLs, emails, markdown link targets and
//    inline `code` are never touched by the prose transforms, so a "--" in a query
//    string or an em dash in a code sample survives. Universal cleanup
//    (invisibles / spaces / newlines) is safe everywhere; prose transforms run
//    only on the unprotected gaps between protected spans.
//  - English house-style only. Curly-quote / dash folding is for English output;
//    non-English drafts (modes/de|fr|ja use low/guillemet quotes) must use
//    cleanUniversal.
//  - Homoglyph folding is OFF in every preset. Folding Cyrillic/Greek look-alikes
//    would mangle a legitimately non-Latin name (e.g. a recruiter whose name is
//    written in Cyrillic), so it stays behind the foldHomoglyphs flag for callers
//    that KNOW their input is English-only. When enabled it is still protected
//    from URLs/emails/code.
//
// This source is pure ASCII on purpose: every non-ASCII codepoint is built via
// String.fromCharCode from an explicit number. A literal zero-width or bidi
// character in this file would be exactly the kind of thing this module removes,
// and would be invisible to a reviewer.

const chr = (cp) => String.fromCharCode(cp);
function range(a, b) { let s = ''; for (let c = a; c <= b; c++) s += String.fromCharCode(c); return s; }

// --- Universal tier: invisible / format characters to STRIP entirely ---------
// C0 controls except tab/LF/CR, soft hyphen, combining grapheme joiner, arabic
// letter mark, hangul fillers, khmer inherent vowels, mongolian FVS + vowel
// separator, zero-width chars, bidi embeddings/overrides, word joiner + invisible
// math operators, bidi isolates + deprecated format chars, BOM, variation
// selectors, interlinear annotation. Never \t (0009) / \n (000A) / \r (000D).
const STRIP_CHARS =
  range(0x00, 0x08) + chr(0x0B) + chr(0x0C) + range(0x0E, 0x1F) +
  chr(0x00AD) + chr(0x034F) + chr(0x061C) + chr(0x115F) + chr(0x1160) +
  chr(0x17B4) + chr(0x17B5) + range(0x180B, 0x180E) + range(0x200B, 0x200F) +
  range(0x202A, 0x202E) + range(0x2060, 0x2064) + range(0x2066, 0x206F) +
  chr(0xFEFF) + range(0xFE00, 0xFE0F) + range(0xFFF9, 0xFFFB);
const STRIP_RE = new RegExp('[' + STRIP_CHARS + ']', 'g');

// Unicode spaces (nbsp, ogham space, en/em/thin/hair spaces, narrow nbsp, medium
// math space, ideographic space) -> a plain ASCII space. Zero-width "spaces" are
// stripped above, not mapped here. This mapping is 1:1 (length-neutral).
const SPACE_CHARS = chr(0x00A0) + chr(0x1680) + range(0x2000, 0x200A) + chr(0x202F) + chr(0x205F) + chr(0x3000);
const SPACE_RE = new RegExp('[' + SPACE_CHARS + ']', 'g');

// Line separators -> \n. In-memory prose uses \n; file writers re-emit CRLF.
const LS = chr(0x2028), PS = chr(0x2029);
function normalizeNewlines(s) {
  return s.replace(/\r\n|\r/g, '\n').split(LS).join('\n').split(PS).join('\n');
}

// --- House-style punctuation (built from codepoints, matched via RegExp) ------
const EM_DASH = chr(0x2014), EN_DASH = chr(0x2013), HELLIP = chr(0x2026);
const LSQUO = chr(0x2018), RSQUO = chr(0x2019), LDQUO = chr(0x201C), RDQUO = chr(0x201D);
const EM_SPACED_RE = new RegExp('\\s+' + EM_DASH + '\\s+', 'g');
const EM_BARE_RE = new RegExp(EM_DASH, 'g');
const EN_RE = new RegExp(EN_DASH, 'g');
const SQUO_RE = new RegExp('[' + LSQUO + RSQUO + ']', 'g');
const DQUO_RE = new RegExp('[' + LDQUO + RDQUO + ']', 'g');
const HELLIP_RE = new RegExp(HELLIP, 'g');

// --- Homoglyph fold: curated, unambiguous Cyrillic/Greek -> Latin -------------
// Only characters visually identical to a Latin letter AND rarely used
// intentionally in this app's English output. Ambiguous lowercase Greek (alpha,
// nu, rho) is deliberately excluded to avoid corrupting math/science notation.
const HOMO_PAIRS = [
  [0x0410, 'A'], [0x0412, 'B'], [0x0415, 'E'], [0x041A, 'K'], [0x041C, 'M'], [0x041D, 'H'],
  [0x041E, 'O'], [0x0420, 'P'], [0x0421, 'C'], [0x0422, 'T'], [0x0425, 'X'], [0x0405, 'S'],
  [0x0406, 'I'], [0x0408, 'J'],
  [0x0430, 'a'], [0x0435, 'e'], [0x043E, 'o'], [0x0440, 'p'], [0x0441, 'c'], [0x0443, 'y'],
  [0x0445, 'x'], [0x0455, 's'], [0x0456, 'i'], [0x0458, 'j'],
  [0x0391, 'A'], [0x0392, 'B'], [0x0395, 'E'], [0x0396, 'Z'], [0x0397, 'H'], [0x0399, 'I'],
  [0x039A, 'K'], [0x039C, 'M'], [0x039D, 'N'], [0x039F, 'O'], [0x03A1, 'P'], [0x03A4, 'T'],
  [0x03A5, 'Y'], [0x03A7, 'X'], [0x03BF, 'o'],
];
const HOMOGLYPHS = {};
for (const [cp, to] of HOMO_PAIRS) HOMOGLYPHS[chr(cp)] = to;
const HOMOGLYPH_RE = new RegExp('[' + Object.keys(HOMOGLYPHS).join('') + ']', 'g');

// Spans that must stay byte-exact even inside prose: inline code, markdown
// link/image targets, URLs, emails. ONE capturing group so String.split keeps the
// protected text in the result (at odd indices).
const PROTECT_RE = /(`[^`\n]*`|\]\([^)\n]*\)|https?:\/\/[^\s)]+|[^\s@]+@[^\s@]+\.[A-Za-z]{2,})/g;

// Apply the English house-style transforms to ONE unprotected text segment.
function applyProse(seg, o) {
  let t = seg;
  if (o.emDash) t = t.replace(EM_SPACED_RE, ', ').replace(EM_BARE_RE, ', ');
  if (o.doubleHyphen) {
    // ASCII "--" used as an em-dash substitute. Requires non-space on both sides
    // so a standalone "---" (markdown thematic break / table separator) is left
    // alone; the file walker also skips those lines as belt-and-suspenders.
    t = t.replace(/(?<=\S)[ \t]*-{2,}[ \t]*(?=\S)/g, ', ');
  }
  if (o.enDash) t = t.replace(EN_RE, '-');
  if (o.curlyQuotes) t = t.replace(SQUO_RE, "'").replace(DQUO_RE, '"');
  if (o.ellipsis) t = t.replace(HELLIP_RE, '...');
  if (o.foldHomoglyphs) t = t.replace(HOMOGLYPH_RE, (ch2) => HOMOGLYPHS[ch2] || ch2);
  if (o.collapseSpaces) {
    // Clean up the space-before-comma and double-comma artifacts that em-dash /
    // double-hyphen folding produces. Scoped to spaces/tabs (not \n) so line
    // structure is preserved.
    t = t.replace(/[ \t]+,/g, ',').replace(/,[ \t]*(?:,[ \t]*)+/g, ', ');
  }
  return t;
}

const DEFAULTS = {
  stripInvisible: true,
  normalizeSpaces: true,
  normalizeNewlines: true,
  curlyQuotes: false,
  emDash: false,
  doubleHyphen: false,
  enDash: false,
  ellipsis: false,
  foldHomoglyphs: false,
  collapseSpaces: true,
};

// cleanText(s, opts) -- the one engine. null/undefined pass through unchanged (so
// callers can pipe an optional field straight in). opts is a flag bag; see
// DEFAULTS. Universal flags apply to the whole string; prose flags apply only to
// the unprotected gaps between protected spans.
export function cleanText(s, opts = {}) {
  if (s == null) return s;
  const o = { ...DEFAULTS, ...opts };
  let t = String(s);
  if (o.normalizeNewlines) t = normalizeNewlines(t);
  if (o.stripInvisible) t = t.replace(STRIP_RE, '');
  if (o.normalizeSpaces) t = t.replace(SPACE_RE, ' ');
  const runsProse =
    o.curlyQuotes || o.emDash || o.doubleHyphen || o.enDash || o.ellipsis || o.foldHomoglyphs || o.collapseSpaces;
  if (!runsProse) return t;
  // Split on protected spans; even indices are unprotected gaps, odd are protected.
  const parts = t.split(PROTECT_RE);
  for (let i = 0; i < parts.length; i += 2) parts[i] = applyProse(parts[i], o);
  return parts.join('');
}

// --- Presets: cleanText with a fixed profile, one per call-site aggressiveness --

// Always-safe tier only: strip invisibles, fold Unicode spaces, normalize
// newlines. No punctuation or homoglyph changes. Safe for non-English output.
export function cleanUniversal(s) {
  return cleanText(s, {
    curlyQuotes: false, emDash: false, doubleHyphen: false, enDash: false,
    ellipsis: false, foldHomoglyphs: false, collapseSpaces: false,
  });
}

// General English prose (coach, LinkedIn drafts, social posts, cover letter):
// universal + curly->straight + em-dash/"--"->", " + ellipsis->"...".
export function cleanProse(s) {
  return cleanText(s, { curlyQuotes: true, emDash: true, doubleHyphen: true, ellipsis: true, collapseSpaces: true });
}

// Email body -- same house-style as prose. Named separately so a future
// email-only rule has a home and so call sites read intent.
export function cleanEmailBody(s) {
  return cleanText(s, { curlyQuotes: true, emDash: true, doubleHyphen: true, ellipsis: true, collapseSpaces: true });
}

// Email subject -- prose house-style, then flatten any newlines to a single line.
export function cleanEmailSubject(s) {
  const t = cleanText(s, { curlyQuotes: true, emDash: true, doubleHyphen: true, ellipsis: true, collapseSpaces: true });
  if (t == null) return t;
  return t.replace(/\s*\n\s*/g, ' ').trim();
}

// ATS resume slot (title, subtitle, summary, areas of expertise). CONSERVATIVE
// and length-stable: strip invisibles (shrinks) + nbsp->space + curly->straight
// (both 1:1). No em dash / ellipsis / en dash (each would GROW length) and no
// homoglyph fold, so the swapped slot cannot trip the +/-15% drift guard.
export function cleanAtsField(s) {
  return cleanText(s, {
    curlyQuotes: true, emDash: false, doubleHyphen: false, enDash: false,
    ellipsis: false, foldHomoglyphs: false, collapseSpaces: false,
  });
}

// Markdown prose line (Tier-B report / interview-prep cleaning). Same house-style
// as cleanProse but WITHOUT the "--" rule, because a markdown table separator
// ("|---|---|") or thematic break is made of ASCII dashes. The em-dash CHARACTER
// is still folded. The file walker is responsible for skipping frontmatter and
// fenced code blocks before calling this per line.
export function cleanMarkdownProse(s) {
  return cleanText(s, { curlyQuotes: true, emDash: true, doubleHyphen: false, ellipsis: true, collapseSpaces: true });
}

// Strip LLM metadata that leaks into drafted output despite "no preface / no
// character count" instructions. Covers char-count annotations ("253 chars,
// within limit."), wrapper quotes, and "Here is/Here's the ..." preambles.
// Idempotent and safe on already-clean text.
export function stripDraftMeta(s) {
  if (!s) return s;
  let t = String(s).trim();
  // Remove wrapping quotes (model sometimes quotes the entire output)
  if (/^[""].*[""]$/.test(t)) t = t.slice(1, -1).trim();
  // Strip leading char-count annotations: "(280 characters)" or "253 chars, within limit."
  t = t.replace(/^\(\d{1,4}\s*(?:chars?|characters?)[^)]{0,30}\)\s*/i, '');
  t = t.replace(/^\d{1,4}\s*(?:chars?|characters?)\b[^.]{0,30}\.\s*/i, '');
  // Strip trailing char-count annotations: "(253 characters)" or "— 280 chars"
  t = t.replace(/\s*[(—,]\s*\d{1,4}\s*(?:chars?|characters?)\b[^)]*\)?\s*$/i, '');
  // Strip "Here is the ..." / "Here's your ..." preamble before the actual greeting
  t = t.replace(/^(?:Here(?:'s| is)(?: the| your| a)?\s+(?:connection (?:request )?note|message|draft|note|response|reply)[^:]*:\s*)+/i, '');
  // Strip "Sure, " / "Certainly, " / "Of course, " opener
  t = t.replace(/^(?:Sure|Certainly|Of course|Absolutely)[,!.]?\s*/i, '');
  return t.trim();
}

// Back-compat: the ORIGINAL em-dash->comma helper, kept behaviorally identical so
// it stays the single implementation. dashboard-web/server/lib/anthropic.mjs
// re-exports it and routes/recruiters.mjs + routes/target-talent.mjs keep
// importing it unchanged. Not routed through cleanText so their output never shifts.
export function _replaceEmDashes(body) {
  if (!body) return body;
  return body
    .replace(EM_SPACED_RE, ', ')
    .replace(EM_BARE_RE, ', ')
    .replace(/\s+,/g, ',')
    .replace(/,\s*,+/g, ',');
}
