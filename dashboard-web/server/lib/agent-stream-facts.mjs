/**
 * agent-stream-facts.mjs: the facts one `claude -p` run's event stream reveals
 * about WHY it produced what it did. routes/agent.mjs feeds every tool_use and
 * tool_result block through here and reads the totals back when the run closes.
 *
 * It lives in its own module so the stream handling can be tested against the
 * event shapes the real CLI emits. It used to be closure state inside
 * runClaudeAgent, which nothing could call without spawning an agent.
 *
 * Shapes observed from the real CLI (verified 2026-10-09):
 *   Read result    content is a string with a "<n><TAB>" line-number prefix per line
 *   failed shell   content "Exit code 3", is_error true
 *   other errors   content is the error text, is_error true
 * Shell calls arrive as `Bash`, or `PowerShell` on Windows when Bash is not granted.
 */
import { parseScanStats } from './agent-log.mjs';

const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const TRACKED_LIST_FILE = /tracked-companies\.txt$/;
const TRACKED_LIST_END = '# END OF LIST';

// A tool_result's content is a string, or an array of { type, text } blocks.
export function resultText(content) {
  if (Array.isArray(content)) return content.map(c => (c && c.text) || '').join('\n');
  return String(content ?? '');
}

export function createStreamFacts() {
  const commands = new Map();   // tool_use id → { tool, command }
  const readFiles = new Map();  // tool_use id → file path
  const facts = {
    toolErrorCount: 0,
    toolErrors: [],                       // first few { tool, message }
    scanStats: null,                      // parsed `node scan.mjs` summary
    fetchJd: { ok: 0, closed: 0, failed: 0 },
    webFetchCount: 0,
    trackedListComplete: null,            // null never read, false read but cut short, true saw the end marker
  };

  return {
    facts,

    noteToolUse(block) {
      if (!block || block.type !== 'tool_use') return;
      if (block.name === 'WebFetch') facts.webFetchCount += 1;
      const input = block.input || {};
      if (block.id && block.name === 'Read' && input.file_path) readFiles.set(block.id, String(input.file_path));
      if (block.id && SHELL_TOOLS.has(block.name) && input.command) {
        commands.set(block.id, { tool: block.name, command: String(input.command) });
      }
    },

    // Returns true when scanStats changed, so the caller can persist it to the job.
    noteToolResult(block) {
      if (!block || block.type !== 'tool_result') return false;
      const text = resultText(block.content);
      const shell = commands.get(block.tool_use_id);
      const readFile = readFiles.get(block.tool_use_id);
      let scanChanged = false;

      if (readFile && TRACKED_LIST_FILE.test(readFile)) {
        facts.trackedListComplete = facts.trackedListComplete === true || text.includes(TRACKED_LIST_END);
      }
      if (shell && /fetch-jd\.mjs/.test(shell.command)) {
        if (!block.is_error) facts.fetchJd.ok += 1;
        else if (/exit(?:ed with)? code 3\b/i.test(text)) facts.fetchJd.closed += 1;
        else facts.fetchJd.failed += 1;
      }
      if (shell && /\bscan\.mjs\b/.test(shell.command)) {
        const st = parseScanStats(text);
        if (st) { facts.scanStats = st; scanChanged = true; }
      }
      if (block.is_error) {
        facts.toolErrorCount += 1;
        if (facts.toolErrors.length < 5) {
          facts.toolErrors.push({ tool: shell ? `${shell.tool}: ${shell.command.slice(0, 60)}` : 'tool', message: text.slice(0, 200) });
        }
      }
      return scanChanged;
    },
  };
}
