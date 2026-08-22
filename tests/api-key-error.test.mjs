#!/usr/bin/env node
/**
 * api-key-error.test.mjs — the clear, actionable message shown when an API-key
 * call is refused. Single-rail billing does NOT silently fall back to the plan;
 * it stops with this message. Replaces the raw 400 ("You have reached your
 * specified API usage limits") that killed draft generation with no explanation.
 *
 * Run: node tests/api-key-error.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { apiKeyErrorMessage, CONSOLE_LIMITS_URL } from '../dashboard-web/server/lib/anthropic.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('api-key-error.test.mjs');

// ── Capped by HTTP 429 ────────────────────────────────────────────────────────
{
  const m = apiKeyErrorMessage({ status: 429, message: 'Rate limit exceeded' });
  check(/usage limit or spend cap/i.test(m), '429 is treated as a cap');
  check(m.includes(CONSOLE_LIMITS_URL), 'cap message links the Anthropic console limits page');
  check(/claude plan/i.test(m), 'cap message offers the plan as the alternative');
  check(/no automatic\s+fallback/i.test(m), 'cap message states there is no silent fallback');
  check(m.includes('Rate limit exceeded'), 'cap message preserves the raw error text');
}

// ── Capped by the incident message (status 400, "usage limits") ───────────────
{
  const m = apiKeyErrorMessage({ status: 400, message: 'You have reached your specified API usage limits. You will regain access on 2026-09-01' });
  check(/usage limit or spend cap/i.test(m), 'the real incident message is recognized as a cap');
  check(m.includes(CONSOLE_LIMITS_URL), 'incident message links the console');
}

// ── Generic (non-cap) failure ────────────────────────────────────────────────
{
  const m = apiKeyErrorMessage({ status: 401, message: 'invalid x-api-key' });
  check(!/usage limit or spend cap/i.test(m), 'a 401 is not mislabeled as a cap');
  check(/dashboard-web\/\.env/.test(m), 'generic message points at the key in .env');
  check(/claude plan/i.test(m), 'generic message still offers the plan fallback path');
  check(m.includes('invalid x-api-key'), 'generic message preserves the raw error text');
}

// ── Defensive: a bare Error or string ────────────────────────────────────────
{
  check(typeof apiKeyErrorMessage(new Error('boom')) === 'string', 'accepts a bare Error');
  check(typeof apiKeyErrorMessage('boom') === 'string', 'accepts a string');
  check(typeof apiKeyErrorMessage(undefined) === 'string', 'accepts undefined without throwing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
