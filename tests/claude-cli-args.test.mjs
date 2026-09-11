#!/usr/bin/env node
/**
 * claude-cli-args.test.mjs — lean, shell-safe argv for one-shot Claude plan
 * calls. Pure argument construction only; this never spawns the CLI.
 *
 * Run: node tests/claude-cli-args.test.mjs   (exit 0 = pass, 1 = fail)
 */

import {
  LEAN_SYSTEM_PROMPT,
  buildClaudeArgs,
  shellArg,
} from '../dashboard-web/server/lib/claude-cli.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

console.log('claude-cli-args.test.mjs');

{
  const args = buildClaudeArgs({ isWin: false });
  check(args.includes('--strict-mcp-config'), 'non-Windows enables strict MCP config');
  check(valueAfter(args, '--setting-sources') === '', 'non-Windows passes an empty setting source');
  check(valueAfter(args, '--tools') === '', 'non-Windows disables built-in tools');
  check(valueAfter(args, '--system-prompt') === LEAN_SYSTEM_PROMPT, 'non-Windows passes the lean system prompt');
}

{
  const args = buildClaudeArgs({ isWin: true });
  check(valueAfter(args, '--setting-sources') === '""', 'Windows quotes the empty setting source');
  check(valueAfter(args, '--tools') === '""', 'Windows quotes the empty tools value');
  check(valueAfter(args, '--system-prompt') === `"${LEAN_SYSTEM_PROMPT}"`, 'Windows quotes the lean system prompt');
}

{
  const posix = buildClaudeArgs({ allowedTools: 'WebSearch', isWin: false });
  const win = buildClaudeArgs({ allowedTools: 'WebSearch', isWin: true });
  check(valueAfter(posix, '--tools') === 'WebSearch' && valueAfter(win, '--tools') === '"WebSearch"',
    'allowed tools are plain off-shell and quoted on Windows');
  check(valueAfter(posix, '--allowedTools') === 'WebSearch' && valueAfter(win, '--allowedTools') === 'WebSearch',
    'the existing --allowedTools WebSearch argument remains present');
}

{
  const model = buildClaudeArgs({ model: 'sonnet', isWin: true });
  const unsafe = buildClaudeArgs({ model: 'sonnet & calc', isWin: true });
  check(valueAfter(model, '--model') === 'sonnet', 'sonnet maps to the sonnet CLI alias');
  check(!unsafe.includes('--model'), 'a model with shell metacharacters adds no model flag');
}

{
  let threw = false;
  try { shellArg('WebSearch & calc', true); } catch { threw = true; }
  check(threw, 'Windows shellArg rejects ampersands');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
