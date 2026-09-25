#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = path.basename(fileURLToPath(import.meta.url));
const PROTECTED = new Set(['reports', 'data', 'jds', 'batch']);
const MUTATORS = '(?:writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|renameSync|copyFileSync|cpSync)';

// These exact snippets are inert fixtures in data-dir-sandbox.test.mjs. Build
// them from fragments so this guard does not itself contain that guard's banned
// source pattern.
const ALLOWLIST = new Map([
  ['data-dir-sandbox.test.mjs', new Set([
    [
      'const FILE = path.join(',
      'ROOT_DIR',
      ", 'data', 'inmail-usage.json');",
    ].join(''),
    [
      'const C = path.resolve(',
      'ROOT_DIR',
      ', "data", "release-notes-cache.json");',
    ].join(''),
  ])],
]);

function quotedValue(expression) {
  const match = expression.trim().match(/^([`'"])([\s\S]*)\1$/);
  return match ? match[2] : null;
}

function inspect(name, source) {
  if (name === SELF) return [];
  const repoRoots = new Set(['ROOT', 'REPO_ROOT', 'PROJECT_ROOT']);
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*import\.meta\.url[^;\n]*(?:\.\.|['"]\.\.['"])[^;\n]*;/g)) {
    repoRoots.add(match[1]);
  }

  const stringValues = new Map();
  for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*([^;\n]+);/g)) {
    const value = quotedValue(match[2]);
    if (value !== null) stringValues.set(match[1], value);
  }

  const protectedPaths = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const match of source.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:path\.)?(?:join|resolve)\(\s*([A-Za-z_$][\w$]*)\s*,\s*([^,)]+)/g)) {
      const [, target, base, childExpression] = match;
      const child = quotedValue(childExpression) ?? stringValues.get(childExpression.trim());
      const protectedChild = child && PROTECTED.has(child.split(/[\\/]/)[0]);
      if ((repoRoots.has(base) && protectedChild) || protectedPaths.has(base)) {
        if (!protectedPaths.has(target)) {
          protectedPaths.add(target);
          changed = true;
        }
      }
    }
  }

  const violations = [];
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const allowed = ALLOWLIST.get(name);
    if ([...(allowed || [])].some(snippet => line.includes(snippet))) continue;
    if (!new RegExp(`\\b${MUTATORS}\\s*\\(`).test(line)) continue;
    const direct = [...repoRoots].some(root => new RegExp(
      `(?:path\\.)?(?:join|resolve)\\(\\s*${root}\\s*,\\s*['\"](?:reports|data|jds|batch)(?:[/\\\\'\"]|$)`,
    ).test(line));
    const viaVariable = [...protectedPaths].some(variable => new RegExp(`\\b${variable}\\b`).test(line));
    if (direct || viaVariable) violations.push(`${name}:${index + 1}: ${line.trim()}`);
  }
  return violations;
}

const violations = fs.readdirSync(HERE)
  .filter(name => name.endsWith('.mjs'))
  .flatMap(name => inspect(name, fs.readFileSync(path.join(HERE, name), 'utf8')));

if (violations.length > 0) {
  console.error('Tests may not write through repository-root paths into reports, data, jds, or batch.');
  for (const violation of violations) console.error(`  ${violation}`);
  process.exit(1);
}

console.log('1 passed, 0 failed');
