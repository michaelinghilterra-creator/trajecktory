#!/usr/bin/env node

/**
 * doctor.mjs — Setup validation for career-ops
 * Checks all prerequisites and prints a pass/fail checklist.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = __dirname;

// ANSI colors (only on TTY)
const isTTY = process.stdout.isTTY;
const green = (s) => isTTY ? `\x1b[32m${s}\x1b[0m` : s;
const red = (s) => isTTY ? `\x1b[31m${s}\x1b[0m` : s;
const yellow = (s) => isTTY ? `\x1b[33m${s}\x1b[0m` : s;
const dim = (s) => isTTY ? `\x1b[2m${s}\x1b[0m` : s;

function checkNodeVersion() {
  const major = parseInt(process.versions.node.split('.')[0]);
  if (major >= 18) {
    return { pass: true, label: `Node.js >= 18 (v${process.versions.node})` };
  }
  return {
    pass: false,
    label: `Node.js >= 18 (found v${process.versions.node})`,
    fix: 'Install Node.js 18 or later from https://nodejs.org',
  };
}

function checkDependencies() {
  if (existsSync(join(projectRoot, 'node_modules'))) {
    return { pass: true, label: 'Dependencies installed' };
  }
  return {
    pass: false,
    label: 'Dependencies not installed',
    fix: 'Run: npm install',
  };
}

async function checkPlaywright() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (existsSync(execPath)) {
      return { pass: true, label: 'Playwright chromium installed' };
    }
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  } catch {
    return {
      pass: false,
      label: 'Playwright chromium not installed',
      fix: 'Run: npx playwright install chromium',
    };
  }
}

function checkCv() {
  if (existsSync(join(projectRoot, 'cv.md'))) {
    return { pass: true, label: 'cv.md found' };
  }
  return {
    pass: false,
    blocking: false,
    label: 'cv.md not found',
    fix: [
      'Create cv.md in the project root with your CV in markdown',
      'See examples/ for reference CVs',
    ],
  };
}

function checkProfile() {
  if (existsSync(join(projectRoot, 'config', 'profile.yml'))) {
    return { pass: true, label: 'config/profile.yml found' };
  }
  return {
    pass: false,
    blocking: false,
    label: 'config/profile.yml not found',
    fix: [
      'Run: cp config/profile.example.yml config/profile.yml',
      'Then edit it with your details',
    ],
  };
}

// portals.yml is gitignored (it is user-layer), so a fresh install ships the
// template and nothing else. This used to only tell the user to copy it, or
// wait for a Claude handoff to do it — which meant a user who never ran the CV
// or scanner handoff had NO scanner config at all, and every scan bailed with
// nothing to explain why. Create it here instead: preflight is the gate every
// other onboarding step waits on, so this is the earliest guaranteed-run point.
//
// Copy only when absent. Never overwrite: this file is where the user's tuning,
// tombstones, and auto-disabled companies live, and clobbering it would silently
// undo weeks of learned config.
function checkPortals() {
  const dest = join(projectRoot, 'portals.yml');
  if (existsSync(dest)) {
    return { pass: true, label: 'portals.yml found' };
  }
  const template = join(projectRoot, 'templates', 'portals.example.yml');
  if (existsSync(template)) {
    try {
      copyFileSync(template, dest);
      return { pass: true, label: 'portals.yml created from the starter template' };
    } catch (e) {
      return {
        pass: false,
        blocking: false,
        label: `portals.yml missing and could not be created (${e.code || e.message})`,
        fix: ['Run: cp templates/portals.example.yml portals.yml'],
      };
    }
  }
  return {
    pass: false,
    blocking: false,
    label: 'portals.yml not found, and templates/portals.example.yml is missing too',
    fix: [
      'Reinstall or restore templates/portals.example.yml',
      'Then run: cp templates/portals.example.yml portals.yml',
    ],
  };
}

function checkFonts() {
  const fontsDir = join(projectRoot, 'fonts');
  if (!existsSync(fontsDir)) {
    return {
      pass: false,
      label: 'fonts/ directory not found',
      fix: 'The fonts/ directory is required for PDF generation',
    };
  }
  try {
    const files = readdirSync(fontsDir);
    if (files.length === 0) {
      return {
        pass: false,
        label: 'fonts/ directory is empty',
        fix: 'The fonts/ directory must contain font files for PDF generation',
      };
    }
  } catch {
    return {
      pass: false,
      label: 'fonts/ directory not readable',
      fix: 'Check permissions on the fonts/ directory',
    };
  }
  return { pass: true, label: 'Fonts directory ready' };
}

// Minimal .env parser (doctor has no dependencies, so no dotenv).
function readEnvFile(p) {
  const out = {};
  try {
    for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
      if (line.trim().startsWith('#')) continue;
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* missing/unreadable .env is fine */ }
  return out;
}

// Surface API-key configuration at preflight rather than letting a workflow
// fail mid-run. This is a WARNING, never a hard failure: the main /trajecktory
// pipeline runs on the user's Claude Code login and needs no key at all, so a
// missing key must not flip the dashboard Launchpad preflight red.
function checkApiKeys() {
  const env = {
    ...readEnvFile(join(projectRoot, '.env')),
    ...readEnvFile(join(projectRoot, 'dashboard-web', '.env')),
    ...process.env,
  };
  const has = (k) => typeof env[k] === 'string' && env[k].trim().length > 0;
  const present = ['ANTHROPIC_API_KEY', 'BRAVE_API_KEY', 'OBSIDIAN_API_KEY'].filter(has);
  const summary = present.length ? present.join(', ') : 'none';

  if (has('ANTHROPIC_API_KEY')) {
    const optionalMissing = ['BRAVE_API_KEY', 'OBSIDIAN_API_KEY'].filter((k) => !has(k));
    if (optionalMissing.length) {
      return {
        pass: true,
        warn: true,
        label: `API keys detected (${summary}); optional not set: ${optionalMissing.join(', ')}`,
        fix: [
          'BRAVE_API_KEY (.env) enables discover.mjs portal widening — optional',
          'OBSIDIAN_API_KEY (dashboard-web/.env) enables Obsidian vault push — optional',
        ],
      };
    }
    return { pass: true, label: `API keys detected (${summary})` };
  }

  return {
    pass: true,
    warn: true,
    label: 'No ANTHROPIC_API_KEY detected',
    fix: [
      'The main /trajecktory pipeline runs on your Claude Code login and needs no key.',
      'ANTHROPIC_API_KEY (dashboard-web/.env) powers the dashboard draft endpoints (cover letters, outreach).',
    ],
  };
}

function checkAutoDir(name) {
  const dirPath = join(projectRoot, name);
  if (existsSync(dirPath)) {
    return { pass: true, label: `${name}/ directory ready` };
  }
  try {
    mkdirSync(dirPath, { recursive: true });
    return { pass: true, label: `${name}/ directory ready (auto-created)` };
  } catch {
    return {
      pass: false,
      label: `${name}/ directory could not be created`,
      fix: `Run: mkdir ${name}`,
    };
  }
}

async function gatherChecks() {
  return [
    checkNodeVersion(),
    checkDependencies(),
    await checkPlaywright(),
    checkCv(),
    checkProfile(),
    checkPortals(),
    checkApiKeys(),
    checkFonts(),
    checkAutoDir('data'),
    checkAutoDir('output'),
    checkAutoDir('reports'),
  ];
}

// --json mode: emit a machine-readable summary instead of the TTY checklist.
// Consumed by the dashboard Launchpad preflight step. Always exits 0 so the
// caller parses the body rather than branching on the exit code; `ok` carries
// the pass/fail verdict.
async function mainJson() {
  const checks = await gatherChecks();
  const failures = checks.filter(c => !c.pass).length;
  const warnings = checks.filter(c => c.pass && c.warn).length;
  // Engine readiness gates the Launchpad: only the blocking checks (Node, deps,
  // Playwright, data folders). The config files (cv.md, profile.yml, portals.yml)
  // are created DURING onboarding, so a fresh install must not let them lock the
  // steps that create them. They still show as ✕ to-dos; they just don't gate.
  const engineFailures = checks.filter(c => !c.pass && c.blocking !== false).length;
  const normalized = checks.map(c => ({
    label: c.label,
    pass: !!c.pass,
    warn: !!c.warn,
    blocking: c.blocking !== false,
    fix: c.fix == null ? [] : (Array.isArray(c.fix) ? c.fix : [c.fix]),
  }));
  console.log(JSON.stringify({ ok: failures === 0, engineOk: engineFailures === 0, failures, warnings, checks: normalized }));
  process.exit(0);
}

async function main() {
  if (process.argv.includes('--json')) return mainJson();

  console.log('\ncareer-ops doctor');
  console.log('================\n');

  const checks = await gatherChecks();

  let failures = 0;
  let warnings = 0;

  for (const result of checks) {
    if (result.pass && !result.warn) {
      console.log(`${green('✓')} ${result.label}`);
    } else if (result.pass && result.warn) {
      warnings++;
      console.log(`${yellow('!')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    } else {
      failures++;
      console.log(`${red('✗')} ${result.label}`);
      const fixes = Array.isArray(result.fix) ? result.fix : [result.fix];
      for (const hint of fixes) {
        console.log(`  ${dim('→ ' + hint)}`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.log(`Result: ${failures} issue${failures === 1 ? '' : 's'} found. Fix them and run \`npm run doctor\` again.`);
    process.exit(1);
  } else if (warnings > 0) {
    console.log(`Result: All required checks passed (${warnings} optional warning${warnings === 1 ? '' : 's'} above). You're ready to go! Run \`claude\` to start.`);
    process.exit(0);
  } else {
    console.log('Result: All checks passed. You\'re ready to go! Run `claude` to start.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('doctor.mjs failed:', err.message);
  process.exit(1);
});
