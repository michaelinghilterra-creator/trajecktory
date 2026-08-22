#!/usr/bin/env node
/**
 * model-versions.test.mjs — per-family model version pinning in pricing.mjs.
 * Lets a user pin "Opus 4.8" so a bare `opus` alias does not drift to whatever
 * the Claude CLI treats as latest (Opus 5). Covers the stale-pin fallback too.
 *
 * Run: node tests/model-versions.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { currentModelVersion, resolveModelId, validateSetting, MODEL_VERSIONS } from '../dashboard-web/server/lib/pricing.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('model-versions.test.mjs');

const OPUS_DEFAULT = MODEL_VERSIONS.opus[0].id;   // claude-opus-4-8
const OPUS_ALT = MODEL_VERSIONS.opus[1].id;       // claude-opus-5

// ── currentModelVersion: default / valid pin / stale pin ────────────────────
check(currentModelVersion('opus', {}) === OPUS_DEFAULT, 'no pin → family default (Opus 4.8)');
check(currentModelVersion('opus', { TJK_OPUS_VERSION: OPUS_ALT }) === OPUS_ALT, 'valid pin is honored (Opus 5)');
check(currentModelVersion('opus', { TJK_OPUS_VERSION: 'claude-opus-9-9' }) === OPUS_DEFAULT,
  'a retired/unknown pin falls back to the default (no hard break)');
check(currentModelVersion('haiku', {}) === MODEL_VERSIONS.haiku[0].id, 'single-version family returns its one id');
check(currentModelVersion('bogus', {}) === 'bogus', 'unknown family returns the input');

// ── resolveModelId consults the pin (reads process.env) ─────────────────────
delete process.env.TJK_OPUS_VERSION;
check(resolveModelId('opus') === OPUS_DEFAULT, 'resolveModelId("opus") → default when unpinned');
process.env.TJK_OPUS_VERSION = OPUS_ALT;
check(resolveModelId('opus') === OPUS_ALT, 'resolveModelId("opus") → pinned id when pinned');
delete process.env.TJK_OPUS_VERSION;
check(resolveModelId('claude-sonnet-4-6') === 'claude-sonnet-4-6', 'a full id passes through unchanged');
check(resolveModelId('inherit') === 'inherit', 'an unknown value passes through unchanged');

// ── validateSetting for version settings ────────────────────────────────────
{
  const ok = validateSetting('opus_version', OPUS_ALT);
  check(ok.ok && ok.envKey === 'TJK_OPUS_VERSION' && ok.value === OPUS_ALT, 'valid opus_version accepted → TJK_OPUS_VERSION');
  const bad = validateSetting('opus_version', 'claude-opus-9-9');
  check(bad.ok === false, 'an unknown version id is rejected');
  const sonnet = validateSetting('sonnet_version', MODEL_VERSIONS.sonnet[1].id);
  check(sonnet.ok && sonnet.envKey === 'TJK_SONNET_VERSION', 'sonnet_version routes to TJK_SONNET_VERSION');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
