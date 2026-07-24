#!/usr/bin/env node
/**
 * board-theme.test.mjs — the interview board must look like the rest of the app.
 *
 * It did not. Both the in-app board and the standalone live board carried their
 * own palette: their own colour VALUES under their own names, switched on
 * prefers-color-scheme. So the board ignored all nine dashboard themes and drew
 * itself in the system font, which on a cyan app produced a green board in a
 * different typeface. That is not a contrast bug and no accessibility script
 * catches it; it only shows up when someone looks at the screen.
 *
 * A rule nobody can check rots, so the rule is a test:
 *   1. Neither board declares a colour VALUE. Every colour is a var().
 *   2. Neither board switches on prefers-color-scheme, which is what made them
 *      ignore the theme picker.
 *   3. Both use the app's font tokens, not a system stack.
 *   4. The board vocabulary is aliased onto tokens the dashboard actually
 *      defines, so an alias cannot silently resolve to nothing.
 *   5. The standalone board really inlines the themes and the typeface, since it
 *      cannot link a stylesheet.
 *
 * Run: node tests/board-theme.test.mjs   (exit 0 = pass, 1 = fail)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const interviewSrc = fs.readFileSync(path.join(root, 'dashboard-web/src/interview.jsx'), 'utf8');
const runsheetSrc = fs.readFileSync(path.join(root, 'render-runsheet.mjs'), 'utf8');
const stylesSrc = fs.readFileSync(path.join(root, 'dashboard-web/src/styles.css'), 'utf8');

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

console.log('board-theme.test.mjs');

// The board stylesheet inside the dashboard bundle, and the <style> block of the
// standalone renderer. PRINT_CSS is deliberately excluded from the colour rule
// below: printing forces black on white on purpose, and it says so.
const boardCss = interviewSrc.slice(interviewSrc.indexOf('const BOARD_CSS'), interviewSrc.indexOf('const RAIL_CSS'));
const runsheetCss = runsheetSrc.slice(runsheetSrc.indexOf('<style>'), runsheetSrc.indexOf('</style>'));
check(boardCss.length > 500, 'located the in-app board stylesheet');
check(runsheetCss.length > 500, 'located the standalone board stylesheet');

// ── 1. No literal colours ────────────────────────────────────────────────────
// A hex here is a colour that cannot follow the theme, which is the whole bug.
// rgba(0,0,0,.5) on a shadow is allowed: a shadow is a shade, not a hue, and it
// reads correctly on every palette. The negative lookbehind skips HTML numeric
// entities (&#9888; is a warning glyph, not a colour), which the standalone
// renderer emits inside content: strings.
const hexes = (css) => (css.match(/(?<!&)#[0-9a-fA-F]{3,8}\b/g) || []);
check(hexes(boardCss).length === 0,
  `in-app board declares no literal colour${hexes(boardCss).length ? ` (found ${hexes(boardCss).join(', ')})` : ''}`);
check(hexes(runsheetCss).length === 0,
  `standalone board declares no literal colour${hexes(runsheetCss).length ? ` (found ${hexes(runsheetCss).join(', ')})` : ''}`);

// ── 2. No prefers-color-scheme ───────────────────────────────────────────────
// The dashboard has an explicit theme picker. Reading the OS preference instead
// is precisely how these surfaces ended up ignoring it.
check(!/prefers-color-scheme/.test(boardCss), 'in-app board does not switch on the OS colour scheme');
check(!/prefers-color-scheme/.test(runsheetCss), 'standalone board does not switch on the OS colour scheme');

// ── 3. The app's typeface, not the system stack ──────────────────────────────
const SYSTEM_STACK = /-apple-system|Segoe UI|Helvetica|Arial/;
check(!SYSTEM_STACK.test(boardCss), 'in-app board does not hardcode a system font stack');
check(!SYSTEM_STACK.test(runsheetCss), 'standalone board does not hardcode a system font stack');
check(/font-family:\s*var\(--sans\)/.test(boardCss), 'in-app board uses the app font token');
check(/font-family:\s*var\(--sans\)/.test(runsheetCss), 'standalone board uses the app font token');

// ── 4. Every alias resolves to a token the dashboard defines ─────────────────
// The board keeps its own names because they carry meaning the dashboard's do
// not, but an alias pointing at a token that does not exist resolves to nothing
// and fails silently, which is worse than a wrong colour.
const definedTokens = new Set((stylesSrc.match(/--[a-z0-9-]+\s*:/gi) || []).map(s => s.replace(/\s*:$/, '').trim()));
const BOARD_VOCAB = ['--ink', '--muted', '--line', '--hero', '--danger', '--tint', '--hi'];
for (const css of [['in-app', boardCss], ['standalone', runsheetCss]]) {
  const [name, text] = css;
  for (const v of BOARD_VOCAB) {
    const m = text.match(new RegExp(`${v}\\s*:\\s*([^;]+);`));
    check(!!m, `${name}: ${v} is defined`);
    if (!m) continue;
    const refs = (m[1].match(/var\(\s*(--[a-z0-9-]+)/gi) || []).map(s => s.replace(/var\(\s*/i, ''));
    check(refs.length > 0 && refs.every(r => definedTokens.has(r)),
      `${name}: ${v} aliases only tokens styles.css defines (${refs.join(', ') || 'none'})`);
  }
}

// --accent, --bg and --panel must NOT be redeclared by the board: that is what
// lets them inherit the live theme.
for (const [name, text] of [['in-app', boardCss], ['standalone', runsheetCss]]) {
  for (const t of ['--accent', '--bg', '--panel']) {
    check(!new RegExp(`${t}\\s*:`).test(text), `${name}: does not redeclare ${t}, so it inherits the theme`);
  }
}

// ── 5. The standalone board carries what it cannot link ──────────────────────
const { themeTokensCss, embeddedFontCss } = await import('../render-runsheet.mjs');
const tokens = themeTokensCss();
check(tokens.length > 500, 'theme tokens were extracted from the dashboard stylesheet');
check(/:root/.test(tokens), 'extraction keeps the base :root block');
const themeCount = (tokens.match(/\[data-theme="/g) || []).length;
check(themeCount >= 9, `extraction keeps every theme (found ${themeCount} selectors)`);
check(!/\{\s*\}/.test(tokens), 'no empty blocks were emitted');
// Only custom properties, never layout. A stray `display:grid` dragged in from a
// theme-scoped rule would silently restyle the board.
const nonTokenDecl = tokens.split('\n').filter(l => /^\s{2}[a-z-]+\s*:/.test(l) && !/^\s{2}--/.test(l));
check(nonTokenDecl.length === 0, `extraction keeps custom properties only${nonTokenDecl.length ? ` (found ${nonTokenDecl[0].trim()})` : ''}`);
for (const t of ['--text', '--text-dim', '--border', '--orange', '--red', '--accent-bg', '--sans']) {
  check(tokens.includes(`${t}:`) || tokens.includes(`${t} :`) || new RegExp(`${t}\\s*:`).test(tokens),
    `extracted tokens include ${t}, which the board aliases`);
}

const fontCss = embeddedFontCss();
check(/@font-face/.test(fontCss), 'the typeface is embedded, so the board does not depend on it being installed');
check(/data:font\/woff2;base64,/.test(fontCss), 'the font is inlined as data, so the file works with no network');
check(/unicode-range/.test(fontCss), 'subset ranges survive, so an accented name still draws in the app font');
// Inlining is not fetching: the same file repeated per weight embeds the same
// bytes again and multiplies the file size for nothing.
const payloads = (fontCss.match(/base64,([A-Za-z0-9+/=]{64})/g) || []);
check(payloads.length === new Set(payloads).size,
  `no font file is embedded twice (${payloads.length} faces, ${new Set(payloads).size} distinct)`);
check(/font-weight:\s*\d+\s+\d+/.test(fontCss),
  'a deduped face covers the weight range it replaced, so bold is not lost');
check(embeddedFontCss('/no/such/dir') === '' || !/base64/.test(embeddedFontCss('/no/such/dir')),
  'a missing font directory degrades to the system fallback instead of throwing');

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
