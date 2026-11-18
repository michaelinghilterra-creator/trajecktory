#!/usr/bin/env node
/**
 * reset-contact-search-attempts.mjs: give parked companies another contact search.
 *
 * The dashboard stops searching a company for contacts after two tries that
 * found nobody. Until the fix that introduced this script, an error or a
 * timeout was counted as a try too, and the stored file kept only a number, so
 * those tries CANNOT be told apart from real empty searches after the fact.
 *
 * What the file can tell apart is newer: every try counted since the fix is
 * marked "confirmed" (a search that finished and found nobody). So this script
 * clears the tries that are NOT confirmed, which is every try on a file written
 * before the fix, and keeps the confirmed ones unless you pass --all.
 *
 * Usage:
 *   node reset-contact-search-attempts.mjs                  # DRY RUN: list what would be cleared
 *   node reset-contact-search-attempts.mjs --apply          # write (timestamped backup first)
 *   node reset-contact-search-attempts.mjs --tier talent    # only the talent search (or: principal)
 *   node reset-contact-search-attempts.mjs --company "Name" # only one company
 *   node reset-contact-search-attempts.mjs --all            # also clear confirmed empty searches
 *   node reset-contact-search-attempts.mjs --below-cap      # also companies not yet parked
 *   node reset-contact-search-attempts.mjs --json           # machine-readable
 *
 * Reads and writes contact-search-attempts.json in the data folder
 * (TJK_DATA_DIR is honored, which is how the tests run it against a sandbox).
 */

import { copyFileSync, existsSync } from 'fs';
import {
  ATTEMPTS_PATH, SEARCH_CAP, SEARCH_TYPES,
  readAttempts, writeAttempts, resetEntry,
} from './dashboard-web/server/lib/contact-search-attempts.mjs';
import { normCompany } from './dashboard-web/server/lib/tt-reconcile-core.mjs';

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const value = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = flag('--json');
const say = (...a) => { if (!JSON_OUT) console.log(...a); };

if (flag('--help') || flag('-h')) {
  console.log('node reset-contact-search-attempts.mjs [--apply] [--tier talent|principal] [--company "Name"] [--all] [--below-cap] [--json]');
  process.exit(0);
}

const TIER_ALIASES = { talent: 'talent', ta: 'talent', principal: 'principal', dm: 'principal' };
const tierArg = value('--tier');
if (flag('--tier') && !Object.hasOwn(TIER_ALIASES, String(tierArg || '').toLowerCase())) {
  console.error('--tier must be talent or principal.');
  process.exit(2);
}
const types = tierArg ? [TIER_ALIASES[tierArg.toLowerCase()]] : SEARCH_TYPES;
const companyArg = value('--company');
if (flag('--company') && !normCompany(companyArg)) {
  console.error('--company needs a company name.');
  process.exit(2);
}
const onlyKey = companyArg ? normCompany(companyArg) : null;
const ALL = flag('--all');
const BELOW_CAP = flag('--below-cap');
const APPLY = flag('--apply');

const attempts = readAttempts();
const plan = [];
const keptConfirmed = [];
let legacyTries = 0;
for (const [key, entry] of Object.entries(attempts)) {
  if (!entry || typeof entry !== 'object') continue;
  if (onlyKey && key !== onlyKey) continue;
  for (const type of types) {
    const tries = Number(entry[type]) || 0;
    if (tries === 0) continue;
    const confirmed = Math.min(tries, Number(entry.confirmed?.[type]) || 0);
    const atCap = tries >= SEARCH_CAP;
    legacyTries += tries - confirmed;
    if (!atCap && !BELOW_CAP) continue;
    const clear = ALL ? tries : tries - confirmed;
    if (clear === 0) { keptConfirmed.push({ company: key, tier: type, tries }); continue; }
    plan.push({ company: key, tier: type, tries, confirmed, clear, left: tries - clear, atCap });
  }
}

say(`\nreset-contact-search-attempts: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
say(`   file: ${ATTEMPTS_PATH}`);
say(`   Tries counted before the fix cannot be told apart from errors or timeouts: the file kept only a number.`);
say(`   ${legacyTries} such unconfirmed ${legacyTries === 1 ? 'try is' : 'tries are'} in scope. ${ALL ? 'With --all, confirmed empty searches are cleared too.' : 'Confirmed empty searches are kept (pass --all to clear them too).'}`);
say(`   would clear: ${plan.length} company search${plan.length === 1 ? '' : 'es'}${BELOW_CAP ? '' : ' at the cap'}`);
for (const row of plan) say(`     ${row.company} [${row.tier}] ${row.tries} ${row.tries === 1 ? 'try' : 'tries'} (${row.confirmed} confirmed) to ${row.left}`);
if (keptConfirmed.length) {
  say(`   left parked (every try is a confirmed empty search): ${keptConfirmed.length}`);
  for (const row of keptConfirmed) say(`     ${row.company} [${row.tier}] ${row.tries} tries`);
}

const result = { ok: true, applied: false, canTellErrorsApart: false, legacyTries, cleared: plan, keptConfirmed };
if (!APPLY) {
  say('\n   Dry run. Re-run with --apply to write (a backup is made first).');
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}
if (plan.length === 0) {
  say('\n   Nothing to clear.');
  if (JSON_OUT) console.log(JSON.stringify({ ...result, applied: true }, null, 2));
  process.exit(0);
}

const d = new Date(), p = n => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
const backup = `${ATTEMPTS_PATH}.bak-${stamp}-reset`;
if (existsSync(ATTEMPTS_PATH)) copyFileSync(ATTEMPTS_PATH, backup);
for (const row of plan) resetEntry(attempts[row.company], row.tier, { unconfirmedOnly: !ALL });
writeAttempts(attempts);

say(`\n   backed up to ${backup}`);
say(`   cleared ${plan.length} company search${plan.length === 1 ? '' : 'es'}. They are back in the contact search list.`);
if (JSON_OUT) console.log(JSON.stringify({ ...result, applied: true, backup }, null, 2));
