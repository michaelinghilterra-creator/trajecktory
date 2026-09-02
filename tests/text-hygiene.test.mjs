#!/usr/bin/env node
/**
 * text-hygiene.test.mjs -- unit tests for the text-hygiene layer.
 *
 * Imports through the server wrapper (dashboard-web/server/lib/text-hygiene.mjs)
 * so the re-export chain over lib/text-hygiene-core.mjs is exercised too.
 *
 * Pins: universal invisible/space/newline cleanup, English house-style folding
 * (em dash, "--", curly quotes, ellipsis), protected spans (URLs/emails/inline
 * code stay byte-exact), homoglyph fold is opt-in only, ATS preset is
 * length-stable (never trips the docx +/-15% drift guard), non-English output is
 * left alone by cleanUniversal, idempotency, and _replaceEmDashes back-compat.
 *
 * Run: node tests/text-hygiene.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  cleanText, cleanUniversal, cleanProse, cleanEmailBody, cleanEmailSubject,
  cleanAtsField, cleanMarkdownProse, stripDraftMeta, _replaceEmDashes,
} from '../dashboard-web/server/lib/text-hygiene.mjs';
import { cleanMarkdown } from '../clean-generated-text.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ok   ${msg}`); passed++; }
  else { console.log(`  FAIL ${msg}`); failed++; }
}
function eq(got, exp, msg) { check(got === exp, `${msg}  => ${JSON.stringify(got)}`); }

// Build every non-ASCII test input from codepoints so this source stays ASCII.
const C = (cp) => String.fromCharCode(cp);
const ZWSP = C(0x200B), ZWNJ = C(0x200C), WJ = C(0x2060), BOM = C(0xFEFF), SHY = C(0x00AD);
const RLO = C(0x202E), NBSP = C(0x00A0), NNBSP = C(0x202F), THIN = C(0x2009), IDEO = C(0x3000);
const EM = C(0x2014), EN = C(0x2013), HELL = C(0x2026);
const LSQ = C(0x2018), RSQ = C(0x2019), LDQ = C(0x201C), RDQ = C(0x201D);
const LS = C(0x2028), PS = C(0x2029);
const LOWQ = C(0x201E), RAQUO = C(0x00BB), LAQUO = C(0x00AB); // German/French quotes
const EACUTE = C(0x00E9); // e-acute, a legitimate accented letter
const CYR_A = C(0x0410), CYR_a = C(0x0430), CYR_e = C(0x0435), GRK_O = C(0x039F);

console.log('text-hygiene.test.mjs');

// --- 1. Universal: strip invisibles / bidi / BOM, keep tab & newline ---------
eq(cleanUniversal('a' + ZWSP + 'b'), 'ab', 'zero-width space stripped');
eq(cleanUniversal('a' + ZWNJ + WJ + 'b'), 'ab', 'ZWNJ + word joiner stripped');
eq(cleanUniversal(BOM + 'a' + BOM + 'b'), 'ab', 'BOM stripped anywhere');
eq(cleanUniversal('soft' + SHY + 'hyphen'), 'softhyphen', 'soft hyphen stripped');
eq(cleanUniversal('a' + RLO + 'b'), 'ab', 'bidi override (Trojan-Source class) stripped');
eq(cleanUniversal('a\tb\nc'), 'a\tb\nc', 'tab and newline preserved');

// --- 2. Space normalization is 1:1 (length-neutral) --------------------------
eq(cleanUniversal('a' + NBSP + 'b'), 'a b', 'nbsp -> space');
eq(cleanUniversal('a' + NNBSP + 'b' + THIN + 'c' + IDEO + 'd'), 'a b c d', 'assorted Unicode spaces -> space');
check(cleanUniversal('x' + NBSP + 'y').length === ('x' + NBSP + 'y').length, 'space fold preserves length');

// --- 3. Newlines: CRLF / CR / LS / PS -> \n -----------------------------------
eq(cleanUniversal('a\r\nb'), 'a\nb', 'CRLF -> \\n');
eq(cleanUniversal('a\rb'), 'a\nb', 'CR -> \\n');
eq(cleanUniversal('a' + LS + 'b' + PS + 'c'), 'a\nb\nc', 'line/paragraph separators -> \\n');

// --- 4. House style (prose) ---------------------------------------------------
eq(cleanProse('a ' + EM + ' b'), 'a, b', 'spaced em dash -> ", "');
eq(cleanProse('a' + EM + 'b'), 'a, b', 'bare em dash -> ", "');
eq(cleanProse('a--b'), 'a, b', 'double hyphen -> ", "');
eq(cleanProse('well -- maybe'), 'well, maybe', 'spaced double hyphen -> ", "');
eq(cleanProse(LDQ + 'x' + RDQ), '"x"', 'curly double quotes -> straight');
eq(cleanProse(LSQ + 'y' + RSQ + ' don' + RSQ + 't'), "'y' don't", 'curly single quotes/apostrophe -> straight');
eq(cleanProse('wait' + HELL), 'wait...', 'ellipsis char -> ...');
eq(cleanProse('done' + EN + 'ish'), 'done' + EN + 'ish', 'en dash left alone by default');

// --- 5. Homoglyph fold is opt-in; accents are never touched ------------------
eq(cleanProse(CYR_A + 'pple'), CYR_A + 'pple', 'homoglyph NOT folded by any preset');
eq(cleanText(CYR_A + 'pple', { foldHomoglyphs: true }), 'Apple', 'homoglyph folded when explicitly enabled');
eq(cleanText('caf' + EACUTE, { foldHomoglyphs: true }), 'caf' + EACUTE, 'legitimate accent survives homoglyph fold');
eq(cleanText('J' + C(0x00F3) + 's' + EACUTE, { foldHomoglyphs: true }), 'J' + C(0x00F3) + 's' + EACUTE, 'accented name unchanged');

// --- 6. Protected spans stay byte-exact --------------------------------------
eq(cleanProse('see https://x.com/a--b' + EM + 'c now'), 'see https://x.com/a--b' + EM + 'c now',
  'URL span (with -- and em dash) untouched by prose folding');
eq(cleanProse('run `a--b' + EM + '` then'), 'run `a--b' + EM + '` then', 'inline code span untouched');
eq(cleanProse('mail me@example.com' + EM + 'now'), 'mail me@example.com, now', 'email protected, em dash outside it still folds');
eq(cleanAtsField('title with ' + CYR_a + CYR_e + GRK_O), 'title with ' + CYR_a + CYR_e + GRK_O,
  'ATS preset does no homoglyph folding');

// --- 7. Idempotency: running twice == once -----------------------------------
const messy = LDQ + 'Ops' + RDQ + ' ' + EM + ' scale' + HELL + ' a--b ' + NBSP + ZWSP + 'end';
for (const [name, fn] of [['cleanProse', cleanProse], ['cleanEmailBody', cleanEmailBody],
  ['cleanAtsField', cleanAtsField], ['cleanMarkdownProse', cleanMarkdownProse], ['cleanUniversal', cleanUniversal]]) {
  eq(fn(fn(messy)), fn(messy), `${name} is idempotent`);
}

// --- 8. ATS length-stability vs the +/-15% drift guard -----------------------
const slot = 'Warehouse Operations ' + EM + ' Logistics Coordinator with ' + LDQ + 'end-to-end' + RDQ +
  ' ownership' + NBSP + 'across ' + ZWSP + 'inbound, outbound, and returns; ' + NBSP + 'managed routing, slotting, ' +
  'and cycle-count planning for three regional distribution centers' + BOM + ', on schedule.';
const cleaned = cleanAtsField(slot);
check(Math.abs(cleaned.length - slot.length) <= slot.length * 0.15, 'ATS cleaned slot within +/-15% of original length');
check(cleaned.length <= slot.length, 'ATS cleaning only shrinks or holds length (invisibles removed, no growth)');
check(cleaned.includes(EM), 'ATS preset does NOT expand the em dash (would grow length)');
check(!cleaned.includes(ZWSP) && !cleaned.includes(BOM) && !cleaned.includes(NBSP), 'ATS strips invisibles + folds nbsp');
check(cleaned.includes('"end-to-end"'), 'ATS folds curly quotes to straight');

// --- 9. Non-English output is left alone by cleanUniversal --------------------
const german = LOWQ + 'Gr' + C(0x00FC) + 'ndlich' + RDQ;      // low + right quote
const french = LAQUO + ' bonjour ' + RAQUO;                     // guillemets
eq(cleanUniversal(german), german, 'cleanUniversal keeps German low/curly quotes');
eq(cleanUniversal(french), french, 'cleanUniversal keeps French guillemets');
check(cleanUniversal(german + ZWSP).length === german.length, 'cleanUniversal still strips invisibles in non-English');

// --- 10. Email subject flattens newlines -------------------------------------
eq(cleanEmailSubject('Re: role\n follow' + EM + 'up'), 'Re: role follow, up', 'subject collapses newline + folds em dash');

// --- 11. Back-compat: _replaceEmDashes exported and behaviorally identical ----
eq(_replaceEmDashes('a ' + EM + ' b'), 'a, b', '_replaceEmDashes spaced form');
eq(_replaceEmDashes('a' + EM + 'b' + EM + 'c'), 'a, b, c', '_replaceEmDashes multiple');
eq(_replaceEmDashes(''), '', '_replaceEmDashes empty string passthrough');
check(_replaceEmDashes(null) === null, '_replaceEmDashes null passthrough');

// --- 12. null/undefined pass through -----------------------------------------
check(cleanProse(null) === null, 'cleanProse(null) -> null');
check(cleanProse(undefined) === undefined, 'cleanProse(undefined) -> undefined');

// --- 13. Tier-B markdown walker: protect frontmatter / fences / tables --------
const md = [
  '---',
  '{"schema":"v1","title":"Role ' + EM + ' X"}',   // JSON frontmatter must stay byte-exact
  '---',
  'Prose with ' + LDQ + 'quotes' + RDQ + ' and ' + EM + ' a dash.',
  '',
  '| Col | Val |',
  '|-----|-----|',
  '',
  '```',
  'code ' + LDQ + 'kept' + RDQ + ' ' + EM + ' here',
  '```',
  'End `inline' + EM + 'code` line.',
].join('\n');
const cm = cleanMarkdown(md);
check(cm.includes('{"schema":"v1","title":"Role ' + EM + ' X"}'), 'markdown: JSON frontmatter stays byte-exact');
check(cm.includes('Prose with "quotes" and, a dash.'), 'markdown: prose folded (curly + em dash)');
check(cm.includes('|-----|-----|'), 'markdown: table separator untouched');
check(cm.includes('code ' + LDQ + 'kept' + RDQ + ' ' + EM + ' here'), 'markdown: fenced code block untouched');
check(cm.includes('`inline' + EM + 'code`'), 'markdown: inline code span untouched');
eq(cleanMarkdown(cm), cm, 'markdown: cleanMarkdown is idempotent');
eq(cleanMarkdown('a\r\nb'), 'a\r\nb', 'markdown: CRLF line endings preserved');
eq(cleanMarkdown('a\nb'), 'a\nb', 'markdown: LF line endings preserved');

// --- stripDraftMeta: strip LLM metadata that leaks into drafted output ---
console.log('\nstripDraftMeta');
eq(stripDraftMeta('253 chars, within limit. Hi Jordan, saw you'), 'Hi Jordan, saw you', 'strips leading char count annotation');
eq(stripDraftMeta('(280 characters) Hi Alex, great to see'), 'Hi Alex, great to see', 'strips parenthesized char count');
eq(stripDraftMeta('Hi Alex, nice note. (253 chars)'), 'Hi Alex, nice note.', 'strips trailing char count');
eq(stripDraftMeta('"Hi Alex, nice to meet you."'), 'Hi Alex, nice to meet you.', 'strips wrapping quotes');
eq(stripDraftMeta("Here's the connection note:\nHi Alex, saw your work."), 'Hi Alex, saw your work.', 'strips preamble');
eq(stripDraftMeta('Sure, Hi Alex, saw your work.'), 'Hi Alex, saw your work.', 'strips filler opener');
eq(stripDraftMeta('Reconnecting on LinkedIn is a light, low-risk personal message, so no need for tools here. Here\'s the draft:\nGood to see Acme Corp'), 'Good to see Acme Corp', 'strips LLM reasoning before preamble');
eq(stripDraftMeta('Hi Alex, saw your work at Acme.'), 'Hi Alex, saw your work at Acme.', 'clean text passes through unchanged');
eq(stripDraftMeta(''), '', 'empty string is safe');
eq(stripDraftMeta(null), null, 'null is safe');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
