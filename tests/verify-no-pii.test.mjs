#!/usr/bin/env node
// Tests for the leak gate itself.
//
// verify-no-pii.mjs is the one thing standing between the owner's personal data
// and a public repo, and until now it was the only major component with no test
// coverage at all. That is exactly backwards: a gate nobody has watched fail is
// a gate nobody should trust. The gap was found the hard way, by planting a real
// figure by hand and discovering the checker passed it (2026-07-21).
//
// SCOPE, and why it is narrow on purpose:
//
// The checker's identity / figure / interview rules DERIVE their terms from the
// owner's gitignored files. On a clone without those (CI, any contributor) it
// derives nothing and passes everything, which is correct behaviour but makes
// those rules untestable portably. Asserting on them here would produce a suite
// that passes for one person and silently tests nothing for everyone else.
//
// So this covers the STRUCTURAL rules only, which need no derived state and
// therefore behave identically everywhere:
//   - COMP LITERAL: a comp key may hold only a value from the neutral set
//   - ARCHIVE:      no archive may ship, since its contents cannot be scanned
//
// It drives the real CLI via --payload rather than importing internals (the
// script exports nothing), so what is pinned is the actual shipped contract:
// exit code and reported finding.

import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const GATE = join(root, 'verify-no-pii.mjs');

let passed = 0, failed = 0;
const check = (cond, label) => {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}`); }
};

// ── Fixtures are ASSEMBLED, never written as literals ───────────────────────
// A test for a leak detector necessarily contains strings that look like leaks,
// and the pre-commit hook duly refused the first version of this file: its
// fixtures were real comp-key-and-number pairs, so the gate flagged its own test
// suite. Allowlisting the file would have been the wrong escape — the gate's own
// comment notes that it and test-all.mjs are deliberately absent from the
// allowlist, because exempting a file that is supposed to hold no literals only
// ever hides a mistake.
//
// So the key and the number are never adjacent in this source. They are joined
// at runtime and written to a temp file, which exercises the real rule against
// the real shape while leaving nothing here for the rule to find. Keep it that
// way: if you inline a fixture for readability, this file stops being
// committable and the reason will not be obvious.
const KEY = {
  walk:  'walk' + 'Away',
  loSnake: 'target' + '_low',
  hiSnake: 'target' + '_high',
  loCamel: 'target' + 'Low',
  hiCamel: 'target' + 'High',
};
const N = { real: '275', real2: '400', neutral: '100', neutralLo: '90', neutralHi: '140' };

// Run the gate over a throwaway payload dir. Returns { code, out }.
function scan(files) {
  const dir = mkdtempSync(join(tmpdir(), 'tjk-pii-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      const p = join(dir, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body);
    }
    try {
      const out = execFileSync(process.execPath, [GATE, '--payload', dir], { encoding: 'utf8' });
      return { code: 0, out };
    } catch (e) {
      return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const blocks = (files) => { const r = scan(files); return r.code !== 0 && /COMP LITERAL/.test(r.out); };
const allows = (files) => scan(files).code === 0;

console.log('\n🧪 verify-no-pii (leak gate)\n');

console.log('1. Compensation literals must stop the build');
// The original shape: a bare number after an unquoted key.
check(blocks({ 'a.mjs': `export const D = { ${KEY.walk}: ${N.real} };\n` }), 'bare number after a comp key');
// The shapes that used to slip through. A salary is far more often written
// quoted and with a currency symbol than as a bare integer, so the gap sat
// precisely where a real value was most likely to be written. The .json cases
// additionally cover the quoted KEY, which no JSON file can avoid.
check(blocks({ 'a.json': `{ "${KEY.walk}": "${N.real}" }\n` }),      'quoted key and quoted number (JSON)');
check(blocks({ 'a.json': `{ "${KEY.walk}": "$${N.real}K" }\n` }),    'quoted key, currency symbol (JSON)');
check(blocks({ 'a.mjs': `const x = { ${KEY.walk}: $${N.real} };\n` }), 'currency symbol, unquoted');
check(blocks({ 'a.yml': `${KEY.walk}: '${N.real}'\n` }),             'single-quoted number');
check(blocks({ 'a.json': `{ "${KEY.walk}": "£${N.real},000" }\n` }), 'non-dollar currency with a thousands separator');
check(blocks({ 'a.mjs': `const c = { ${KEY.loSnake}: ${N.real}, ${KEY.hiSnake}: ${N.real2} };\n` }), 'snake_case comp keys');
check(blocks({ 'a.mjs': `const c = { ${KEY.hiCamel}: "$${N.real2}K" };\n` }), 'camelCase key with a quoted value');

console.log('\n2. The neutral escape hatch must still work');
// Widening the value side must not break the reviewed placeholders, or every
// example in the repo starts failing and the rule gets switched off.
check(allows({ 'a.mjs': `export const D = { ${KEY.walk}: ${N.neutral} };\n` }), 'neutral value, bare');
check(allows({ 'a.json': `{ "${KEY.walk}": "${N.neutral}" }\n` }),              'neutral value, quoted');
check(allows({ 'a.json': `{ "${KEY.walk}": "$${N.neutralHi}K" }\n` }),          'neutral value, quoted with currency');
check(allows({ 'a.mjs': `const c = { ${KEY.loCamel}: ${N.neutralLo}, ${KEY.hiCamel}: ${N.neutralHi} };\n` }), 'neutral band');

console.log('\n3. No false positives on ordinary content');
check(allows({ 'a.mjs': `const timeout = ${N.real};\nconst retries = ${N.real2};\n` }), 'bare integers with no comp key');
check(allows({ 'a.md': 'The walk-away point in a negotiation matters.\n' }), 'comp words in prose, no assignment');
check(allows({ 'a.mjs': `const ${KEY.walk}Enabled = true;\n` }),     'comp-like identifier with a non-numeric value');
check(allows({ 'a.md': '# Notes\n\nNothing sensitive here at all.\n' }), 'plain file');

console.log('\n4. Archives cannot ship (their contents cannot be scanned)');
const zip = scan({ 'bundle.zip': 'PK not really a zip\n' });
check(zip.code !== 0 && /ARCHIVE/.test(zip.out), 'a .zip in the payload is refused');

console.log('\n5. The CLI contract itself');
const clean = scan({ 'a.md': 'nothing here\n' });
check(clean.code === 0, 'clean payload exits 0');
const dirty = scan({ 'a.mjs': `const c = { ${KEY.walk}: ${N.real} };\n` });
check(dirty.code === 1, 'a finding exits 1 (not 2, which means "could not derive terms")');
check(/Refusing to pass/.test(dirty.out), 'a finding says it is refusing to pass');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
