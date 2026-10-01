#!/usr/bin/env node
/**
 * capture-guide.mjs: capture every tab and sub-tab of the dashboard for the
 * day-to-day guides (the in-app guide and docs/onboarding/guide3.html) and the
 * README gallery, using Playwright at 2x.
 *
 * ZERO-PII SETUP (read before running):
 *   1. Run from a DATA-FREE checkout (a git worktree, never the main checkout).
 *   2. Start the dashboard on a scratch data dir and a spare port:
 *        TJK_DATA_DIR=<empty dir> TJK_PROFILE_YML=<missing file> PORT=3399 \
 *        TJK_NO_OPEN=1 node dashboard-web/server/index.mjs
 *      There must be no dashboard-web/.env. The server then has nothing real
 *      to read, and every data-bearing endpoint is mocked here anyway.
 *   3. TRAJECKTORY_URL overrides the base url (default http://localhost:3399).
 *
 * Every /api/** request that no mock claims is answered with HTTP 500 and
 * recorded; the run FAILS if any were recorded, and FAILS if a capture step
 * throws. There are no silent skips: a stale selector stops the run instead of
 * leaving an old PNG in place.
 *
 * Usage:
 *   node docs/onboarding/capture-guide.mjs                 # every group
 *   node docs/onboarding/capture-guide.mjs --group pipeline,network
 *   node docs/onboarding/capture-guide.mjs --list
 *
 * Output: docs/onboarding/captures/<name>.png (gitignored) + manifest.json.
 */
import { launch, assertClean, gotoApp, state, closeBrowser } from './capture-lib.mjs';
import { installShell } from './capture-shell.mjs';
import { pathToFileURL } from 'url';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Each group lives in capture-groups/<name>.mjs and exports:
//   export const meta = { name, summary }
//   export async function install(page)            // extra routes for this group
//   export async function capture(h)               // h = { page, ctx, unmocked }
export const GROUPS = ['shell', 'pipeline', 'drawer', 'network', 'social', 'interview', 'insights', 'setup'];

async function runGroup(name) {
  const mod = await import(pathToFileURL(resolve(__dirname, 'capture-groups', `${name}.mjs`)).href);
  console.log(`\n== group: ${name} ==`);
  const h = await launch();
  try {
    await installShell(h.page);
    if (mod.install) await mod.install(h.page);
    await mod.capture(h);
    assertClean(h.unmocked, name);
  } finally {
    await closeBrowser(h);
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) { console.log(GROUPS.join('\n')); return; }
  const gi = args.indexOf('--group');
  const want = gi >= 0 ? args[gi + 1].split(',') : GROUPS;
  for (const g of want) {
    if (!GROUPS.includes(g)) throw new Error(`unknown group "${g}" (have: ${GROUPS.join(', ')})`);
  }
  for (const g of want) await runGroup(g);
  console.log('\nDone.');
}

main().catch((e) => { console.error('capture failed:', e.message); process.exit(1); });
export { state, gotoApp };
