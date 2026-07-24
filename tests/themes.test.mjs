#!/usr/bin/env node
/**
 * themes.test.mjs: guards the theme palettes against token drift.
 *
 * The dashboard has one base dark theme (`:root, [data-theme="dark"]`) plus a
 * dim and a light variant, and six drop-in "designer" palettes (amber, emerald,
 * cyan, rose, paper, arctic). A theme applies by setting `data-theme` on <html>;
 * any token a block omits silently falls back to the dark `:root` value. That
 * fallback is the whole hazard: a light palette that forgets `--shadow` or
 * `--panel-3` inherits a DARK shadow / near-black panel and looks broken, and a
 * palette that forgets `--accent-rgb` renders the base violet in every
 * accent-tinted border. This suite pins three invariants so a future token added
 * to the dark block, or a palette pasted in without filling it, fails loudly:
 *
 *   1. Every theme the Tweaks picker offers has a matching CSS block.
 *   2. Every designer palette defines the FULL dark token set (minus the
 *      structural tokens that are theme-invariant by design).
 *   3. Each palette's --accent-rgb / --accent-bg actually match its --accent
 *      (catches copy-paste errors in the hand-filled RGB triples).
 *
 * Pure string parsing, no DOM, no fixtures. Run: node tests/themes.test.mjs
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = join(__dirname, '..', 'dashboard-web', 'src');
const css = readFileSync(join(SRC, 'styles.css'), 'utf-8');
const appJsx = readFileSync(join(SRC, 'app.jsx'), 'utf-8');

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('themes.test.mjs');

// ── 0. CSS comments are balanced ─────────────────────────────────────────────
// A stray */ inside a comment (e.g. writing a token list like --r-*/--gap in
// prose) silently closes the comment early and corrupts the FOLLOWING rule in
// every real CSS parser, while leaving the token TEXT present. A string-match
// test misses it; the browser drops the rule. Strip comments the way a parser
// does (global, non-greedy) and assert nothing dangles. This exact bug ate the
// amber block on first integration.
const deCommented = css.replace(/\/\*[\s\S]*?\*\//g, '');
check(!deCommented.includes('*/') && !deCommented.includes('/*'),
  'styles.css comments are balanced (no premature */ that would silently drop the next rule)');

// Token blocks here never nest braces, so [^}]* is a safe body matcher.
const tokenNames = (body) => new Set([...body.matchAll(/--([\w-]+)\s*:/g)].map(m => m[1]));
const tokenValue = (body, name) => {
  const m = body.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
};
// Grab the body of a [data-theme="x"] block (dark also matches its own selector).
function themeBody(theme) {
  const m = css.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

// ── Canonical token set: the union of every [data-theme="dark"] block ─────────
// The dark palette is split across two regions (the main block + the pipeline
// module's --pink/--pink-rgb). Union them so "the full dark token set" stays
// correct no matter where a dark token is declared.
const darkBlocks = [...css.matchAll(/\[data-theme="dark"\]\s*\{([^}]*)\}/g)].map(m => m[1]);
check(darkBlocks.length >= 1, `found the base dark token block (${darkBlocks.length} region(s))`);
const darkTokens = new Set();
for (const b of darkBlocks) for (const t of tokenNames(b)) darkTokens.add(t);

// Structural tokens are identical across every theme, so palettes inherit them
// from :root on purpose. Everything else is a color/tone token that MUST be set
// per palette (a fallback to the dark value is a bug).
const EXEMPT = new Set(['mono', 'sans', 'r-card', 'r-ctl', 'gap', 'drawer-w']);
const required = [...darkTokens].filter(t => !EXEMPT.has(t)).sort();
check(required.includes('shadow') && required.includes('panel-3') && required.includes('accent-rgb'),
  'the required set includes the drift-prone tokens (shadow, panel-3, accent-rgb)');

const DESIGNER = ['amber', 'emerald', 'cyan', 'rose', 'paper', 'arctic'];

// ── 2. Every designer palette covers the full token set ──────────────────────
for (const theme of DESIGNER) {
  const body = themeBody(theme);
  if (!body) { check(false, `[data-theme="${theme}"] block exists`); continue; }
  const have = tokenNames(body);
  const missing = required.filter(t => !have.has(t));
  check(missing.length === 0, `${theme} defines the full token set${missing.length ? ` — MISSING: ${missing.join(', ')}` : ''}`);
}

// ── 3. Each palette's accent RGB derivations match its accent hex ─────────────
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
};
for (const theme of DESIGNER) {
  const body = themeBody(theme);
  if (!body) continue;
  const accent = tokenValue(body, 'accent');
  const rgb = hexToRgb(accent || '');
  const accentRgb = (tokenValue(body, 'accent-rgb') || '').replace(/\s/g, '');
  check(rgb !== null && accentRgb === rgb,
    `${theme}: --accent-rgb (${accentRgb}) matches --accent ${accent} → ${rgb}`);
  const bg = tokenValue(body, 'accent-bg') || '';
  const bgRgb = (bg.match(/rgba?\(([^)]+)\)/)?.[1] || '').split(',').slice(0, 3).map(s => s.trim()).join(',');
  check(rgb !== null && bgRgb === rgb,
    `${theme}: --accent-bg leads with the accent RGB (${bgRgb} === ${rgb})`);
}

// ── 1. Every picker option maps to a real CSS block ──────────────────────────
const optBlock = appJsx.match(/const THEME_OPTIONS\s*=\s*\[([\s\S]*?)\];/);
check(!!optBlock, 'THEME_OPTIONS array is present in app.jsx');
const optionValues = optBlock ? [...optBlock[1].matchAll(/value:\s*"([^"]+)"/g)].map(m => m[1]) : [];
check(optionValues.length === 9, `THEME_OPTIONS lists all 9 themes (got ${optionValues.length})`);
for (const v of optionValues) {
  check(css.includes(`[data-theme="${v}"]`), `picker theme "${v}" has a [data-theme="${v}"] CSS block`);
}

// DESIGNER_THEMES (the accent-override skip list) must equal the six palettes.
const setBlock = appJsx.match(/const DESIGNER_THEMES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
check(!!setBlock, 'DESIGNER_THEMES set is present in app.jsx');
const setValues = setBlock ? [...setBlock[1].matchAll(/"([^"]+)"/g)].map(m => m[1]).sort() : [];
check(JSON.stringify(setValues) === JSON.stringify([...DESIGNER].sort()),
  `DESIGNER_THEMES matches the six palettes (got ${setValues.join(', ')})`);

// ── 4. Default theme + persistence key stay in sync with index.html ──────────
// index.html applies the default (and the saved) theme before first paint, so
// its hardcoded default and localStorage key MUST match app.jsx. Drift here
// means a flash of the wrong theme or a persisted pick that never loads.
const html = readFileSync(join(SRC, 'index.html'), 'utf-8');
const defaultsBlock = appJsx.match(/EDITMODE-BEGIN\*\/\s*\{([\s\S]*?)\}\s*\/\*EDITMODE-END/);
const defaultTheme = defaultsBlock ? (defaultsBlock[1].match(/"theme":\s*"([^"]+)"/) || [])[1] : undefined;
const htmlDefaultTheme = (html.match(/<html[^>]*\bdata-theme="([^"]+)"/) || [])[1];
const appKey = (appJsx.match(/TWEAKS_STORAGE_KEY\s*=\s*'([^']+)'/) || [])[1];
const htmlKey = (html.match(/localStorage\.getItem\('([^']+)'\)/) || [])[1];

check(optionValues.includes(defaultTheme), `TWEAK_DEFAULTS.theme "${defaultTheme}" is a real palette`);
check(defaultTheme === htmlDefaultTheme,
  `index.html <html data-theme> (${htmlDefaultTheme}) matches TWEAK_DEFAULTS.theme (${defaultTheme})`);
check(!!appKey && appKey === htmlKey,
  `persistence key matches across app.jsx (${appKey}) and index.html pre-paint script (${htmlKey})`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
