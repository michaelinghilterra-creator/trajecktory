/**
 * agent-stream-facts.test.mjs
 *
 * Feeds createStreamFacts the event shapes the real `claude -p` CLI emits (captured
 * 2026-10-09) and checks the facts that drive empty-run diagnosis: scan.mjs stats,
 * fetch-jd outcomes, tracked-list completeness, tool errors.
 *
 * Run: node tests/agent-stream-facts.test.mjs   (exit 0 = pass, 1 = fail)
 */

import { createStreamFacts, resultText } from '../dashboard-web/server/lib/agent-stream-facts.mjs';

let passed = 0, failed = 0;
function check(cond, msg) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('agent-stream-facts.test.mjs');

const use = (id, name, input) => ({ type: 'tool_use', id, name, input });
const res = (id, content, is_error) => ({ type: 'tool_result', tool_use_id: id, content, ...(is_error ? { is_error: true } : {}) });

const SCAN_OUT = 'Companies scanned:     10\nTotal jobs found:      200\nNew offers added:      0\nErrors (2):\n';

// Scan run: list read in full, scan.mjs summary, a failed call.
{
  const s = createStreamFacts();
  s.noteToolUse(use('t1', 'Bash', { command: 'node scan.mjs 2>&1' }));
  check(s.noteToolResult(res('t1', SCAN_OUT)) === true, 'a scan.mjs result reports that scan stats changed');
  check(s.facts.scanStats && s.facts.scanStats.totalJobs === 200 && s.facts.scanStats.boardErrors === 2, 'scan stats are parsed from a Bash result');

  s.noteToolUse(use('t2', 'Read', { file_path: 'C:\\repo\\data\\tracked-companies.txt' }));
  s.noteToolResult(res('t2', '1\tZorblax Widgetry ; Quennox Ratchet Works\n2\t# END OF LIST: 2 companies\n3\t'));
  check(s.facts.trackedListComplete === true, 'a Read with the end marker (line-number prefixed) counts as a complete read');

  s.noteToolUse(use('t3', 'WebSearch', { query: 'x' }));
  s.noteToolUse(use('t4', 'WebFetch', { url: 'https://example.com' }));
  check(s.facts.webFetchCount === 1, 'WebFetch calls are counted');

  s.noteToolUse(use('t5', 'Bash', { command: 'grep name portals.yml | head -300' }));
  s.noteToolResult(res('t5', 'name: A\nname: B'));
  check(s.facts.scanStats.totalJobs === 200, 'an unrelated Bash result leaves scan stats alone');
}

// A truncated read of the list is flagged, and a later complete read wins.
{
  const s = createStreamFacts();
  s.noteToolUse(use('r1', 'Read', { file_path: 'data/tracked-companies.txt' }));
  s.noteToolResult(res('r1', '1\t# header\n2\tZorblax Widgetry ; Quennox Ratchet Works'));
  check(s.facts.trackedListComplete === false, 'a read without the end marker is flagged incomplete');
  s.noteToolUse(use('r2', 'Read', { file_path: 'data/tracked-companies.txt' }));
  s.noteToolResult(res('r2', '9\t# END OF LIST: 2 companies'));
  check(s.facts.trackedListComplete === true, 'reading the rest afterwards makes it complete');
  s.noteToolUse(use('r3', 'Read', { file_path: 'data/tracked-companies.txt' }));
  s.noteToolResult(res('r3', '1\t# header'));
  check(s.facts.trackedListComplete === true, 'a later partial re-read does not undo a complete read');
}

// Never reading the list leaves it null (not false).
{
  const s = createStreamFacts();
  s.noteToolUse(use('x', 'Read', { file_path: 'data/pipeline.md' }));
  s.noteToolResult(res('x', '1\t- [ ] https://example.com'));
  check(s.facts.trackedListComplete === null, 'reading other files leaves trackedListComplete null');
}

// fetch-jd outcomes, as Bash and as PowerShell.
{
  const s = createStreamFacts();
  s.noteToolUse(use('f1', 'Bash', { command: 'node fetch-jd.mjs "https://example.com/a"' }));
  s.noteToolResult(res('f1', 'full job description text'));
  s.noteToolUse(use('f2', 'Bash', { command: 'node fetch-jd.mjs "https://example.com/b"' }));
  s.noteToolResult(res('f2', 'Exit code 3', true));
  s.noteToolUse(use('f3', 'Bash', { command: 'node fetch-jd.mjs "https://example.com/c"' }));
  s.noteToolResult(res('f3', 'Exit code 1\nfetch-jd: no API', true));
  s.noteToolUse(use('f4', 'PowerShell', { command: 'node fetch-jd.mjs "https://example.com/d"' }));
  s.noteToolResult(res('f4', 'Exit code 3', true));
  check(s.facts.fetchJd.ok === 1 && s.facts.fetchJd.closed === 2 && s.facts.fetchJd.failed === 1, 'fetch-jd outcomes split into read, closed (exit 3) and failed, for Bash and PowerShell');
}

// Tool errors: counted, capped, and attributed.
{
  const s = createStreamFacts();
  for (let i = 0; i < 8; i++) {
    s.noteToolUse(use(`e${i}`, 'Bash', { command: `node thing${i}.mjs` }));
    s.noteToolResult(res(`e${i}`, 'x'.repeat(500), true));
  }
  s.noteToolResult(res('unknown-id', 'orphan failure', true));
  check(s.facts.toolErrorCount === 9, 'every errored tool result is counted');
  check(s.facts.toolErrors.length === 5, 'only the first five errors are kept');
  check(s.facts.toolErrors[0].tool.startsWith('Bash: node thing0') && s.facts.toolErrors[0].message.length === 200, 'an error names its command and is truncated');
}

// Robustness: odd shapes never throw.
{
  const s = createStreamFacts();
  let threw = false;
  try {
    s.noteToolUse(null); s.noteToolUse({}); s.noteToolUse(use(undefined, 'Bash', { command: 'x' })); s.noteToolUse(use('b', 'Bash', undefined));
    s.noteToolResult(null); s.noteToolResult({ type: 'text' }); s.noteToolResult(res('nope', undefined)); s.noteToolResult(res('nope', [{ type: 'text', text: 'hi' }, null]));
  } catch { threw = true; }
  check(!threw, 'malformed blocks are ignored rather than thrown');
  check(resultText([{ text: 'a' }, null, { text: 'b' }]) === 'a\n\nb' && resultText(undefined) === '', 'resultText flattens array content and tolerates undefined');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
