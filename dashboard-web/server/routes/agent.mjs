import express from 'express';
import { spawn } from 'child_process';
import { ROOT_DIR } from '../config.mjs';

export const router = express.Router();

// ── Headless Agent Runner ─────────────────────────────────────────────────────
// Drives the user's local Claude Code (`claude -p`) for the two LLM workflow
// steps — Agent Scan (/trajecktory scan) and Evaluate Pipeline (/trajecktory
// pipeline) — so non-technical users never open a terminal. Runs on the user's
// own Claude login (no API key). Progress is parsed from --output-format
// stream-json into a job record the frontend polls, mirroring the Workflow
// Runner above. Playwright is unavailable headless, so Evaluate Pipeline runs
// the Playwright liveness gate as a node step in THIS process first.

const agentJobs = new Map();

function agentTail(output) {
  return (output || '').trim().split('\n').slice(-3).join('\n');
}

function claudeErrorMessage(e) {
  if (e && e.code === 'ENOENT') {
    return 'Claude Code CLI not found. Make sure `claude` is installed and on your PATH, then retry.';
  }
  return (e && e.message) || 'Failed to start Claude Code.';
}

// Genuine API pressure surfaces in Claude Code's STDERR (HTTP 429/529, the
// Anthropic `overloaded_error` / `rate_limit_error` types) or an explicit
// usage-limit message — NOT inside assistant text or a fetched job description.
// Match those precise tokens only, so a backend JD that merely says "rate
// limiting" never trips a scary warning (the old broad scan did exactly that).
const PRESSURE_RE = /\b(?:429|529)\b|overloaded_error|rate_limit_error|too many requests|usage limit (?:reached|exceeded)|approaching your usage limit/i;
const PRESSURE_WARNING = 'Claude usage or limit pressure detected. The run may slow or stop early.';

// Dashboard-driven runs share ONE Claude subscription, so they must stay inline
// (no subagent fan-out — that is what trips usage limits) and headless (no
// Playwright). These constraints are appended to the slash command; the mode
// still routes normally. Kept to a SINGLE line on purpose — the Windows cmd
// shell mangles multi-line quoted args.
function dashboardConstraints(mode) {
  const common = 'Dashboard run, follow these constraints strictly. Work inline and never spawn subagents or background agents, because this run shares a single Claude subscription and parallel agents trip usage limits. Playwright is unavailable in this environment.';
  // TEST CAP (temporary): when TJK_TEST_LIMIT is set, hard-limit how many
  // postings the Claude steps touch, so testing does not burn the whole quota.
  const limit = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;
  if (mode === 'pipeline') {
    const cap = limit > 0 ? ` TEST MODE (TJK_TEST_LIMIT=${limit}): evaluate ONLY the first ${limit} pending unchecked URLs in data/pipeline.md, then STOP immediately and do not evaluate any more even if others remain.` : '';
    return ' ' + common + ' Evaluate only the URLs already pending in data/pipeline.md and do not scan for new roles.' + cap + ' Do not run gate-pipeline.mjs or any browser tool; just evaluate the pending unchecked URLs as they are. Read each job description with WebFetch first and WebSearch as a fallback, and if a posting cannot be read, mark it skipped in data/pipeline.md and move on. Record every evaluation as a single line nine column TSV in batch/tracker-additions/ and do not edit data/applications.md directly. Always write the report to reports/ even for a low score so the result is visible. Write each report in the trajecktory-report/v1 format (JSON frontmatter then narrative body) and you MUST populate the optional frontmatter sections so the dashboard drawer is complete, not just the score: include customizationCV and customizationLI (the CV and LinkedIn personalization plan), starStories plus a leadStory (interview prep, with the single story to lead with), and a legitimacy object with a tier and signals. Because Playwright is unavailable here, assess legitimacy from the WebFetched page and WebSearch (posting freshness, description quality, reposting, market context, prompt-injection) and set the legitimacy verification to unconfirmed (no live browser) rather than leaving the section empty. Do not abbreviate or skip the personalization, interview, or legitimacy sections. When done, the user will run Merge Tracker to fold your TSVs into the pipeline.';
  }
  if (mode === 'scan') {
    const cap = limit > 0 ? ` TEST MODE (TJK_TEST_LIMIT=${limit}): add at most ${limit} new postings to data/pipeline.md, then stop.` : '';
    return ' ' + common + ' Use only the ATS API tier and the WebSearch tier, and skip the Playwright tier. Pace the searches a few at a time. Add new live postings to data/pipeline.md as usual. When you find a company via WebSearch that has a Greenhouse, Ashby, or Lever job board and is not already in portals.yml tracked_companies, append it there with its careers_url and api endpoint (merge only: preserve every existing entry and comment byte for byte), so the free zero-token API Scan catches its postings next time instead of paying Claude to re-discover it.' + cap;
  }
  return '';
}

function summarizeToolUse(block) {
  const name = block.name || 'tool';
  const inp = block.input || {};
  if (name === 'WebSearch' && inp.query) return `WebSearch: "${String(inp.query).slice(0, 60)}"`;
  if (name === 'WebFetch'  && inp.url)   return `WebFetch: ${String(inp.url).slice(0, 60)}`;
  if ((name === 'Write' || name === 'Edit') && inp.file_path) return `${name}: ${String(inp.file_path).split(/[\\/]/).pop()}`;
  if (name === 'Bash' && inp.command)    return `Bash: ${String(inp.command).slice(0, 60)}`;
  if (name === 'Task' && inp.description) return `Subagent: ${String(inp.description).slice(0, 60)}`;
  return name;
}

// Spawn `claude -p "/trajecktory <mode>"` and stream-parse progress into the
// job record. Resolves { ok, result, error } when the child closes and sets the
// job's final status itself.
function runClaudeAgent(jobId, mode) {
  return new Promise((resolve) => {
    const projectRoot = ROOT_DIR;
    const isWin = process.platform === 'win32';
    // `claude` is a .cmd shim on Windows; Node 20+/24 refuse to spawn a .cmd
    // without a shell, and passing a full .cmd path under a shell mangles the
    // backslashes. The reliable path is the bare name resolved by the shell.
    // shell:true does NOT escape args, so quote the (space-containing) prompt
    // ourselves; the remaining flags have no spaces or backslashes. On posix
    // no shell is needed — the args array handles the space natively.
    const prompt = `/trajecktory ${mode}.${dashboardConstraints(mode)}`;
    const args = ['-p', isWin ? `"${prompt}"` : prompt,
                  '--output-format', 'stream-json', '--verbose',
                  '--permission-mode', 'acceptEdits'];

    const update = (patch) => {
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, ...patch });
    };
    const fail = (msg) => {
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, status: 'error', error: msg, finishedAt: Date.now() });
      resolve({ ok: false, error: msg });
    };

    let child;
    // Run eval/scan on the user's Claude Pro/Max subscription (their `claude
    // login`), NOT on any API key. Claude Code bills ANTHROPIC_API_KEY whenever
    // it sees it in the environment, so strip it from the child's env; that key
    // is reserved for the SDK-based draft features in the server process. This
    // keeps the expensive, repeated agent work on the flat subscription.
    const claudeEnv = { ...process.env };
    delete claudeEnv.ANTHROPIC_API_KEY;
    try {
      child = spawn('claude', args, {
        cwd: projectRoot,
        env: claudeEnv,
        shell: isWin,            // Windows needs the shell to run the claude.cmd shim
        windowsHide: true,
      });
    } catch (e) {
      return fail(claudeErrorMessage(e));
    }
    // `claude -p` has the prompt as an argument and needs no piped stdin. Close
    // the child's stdin so the CLI doesn't sit waiting on it ("no stdin data in
    // 3 seconds" warning the user saw on Agent Scan).
    if (child.stdin) { try { child.stdin.end(); } catch { /* already closed */ } }

    let buf = '';
    let resultText = '';
    let isError = false;
    let settled = false;

    child.on('error', (e) => { if (!settled) { settled = true; fail(claudeErrorMessage(e)); } });

    child.stdout && child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        handleEvent(ev);
      }
    });

    child.stderr && child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      const job = agentJobs.get(jobId) || {};
      const patch = { output: ((job.output || '') + text).slice(-8192) };
      // Real rate-limit / overload retries are logged here, not in the JSON stream.
      if (PRESSURE_RE.test(text)) patch.warning = PRESSURE_WARNING;
      agentJobs.set(jobId, { ...job, ...patch });
    });

    function handleEvent(ev) {
      const job = agentJobs.get(jobId) || {};
      if (ev.type === 'system' && ev.subtype === 'init') {
        update({ activity: 'Starting agent…' });
        return;
      }
      if (ev.type === 'assistant' && ev.message && Array.isArray(ev.message.content)) {
        const toolCalls = (job.toolCalls || []).slice();
        let toolCount = job.toolCount || 0;
        let activity = job.activity;
        for (const block of ev.message.content) {
          if (block.type === 'text' && block.text) {
            activity = block.text.trim().split('\n')[0].slice(0, 160);
          } else if (block.type === 'tool_use') {
            const s = summarizeToolUse(block);
            toolCalls.push(s);
            toolCount += 1;
            activity = s;
          }
        }
        update({ toolCalls: toolCalls.slice(-50), toolCount, activity });
        return;
      }
      if (ev.type === 'result') {
        resultText = (ev.result != null ? ev.result : (ev.subtype || '')).toString();
        isError = !!ev.is_error || ev.subtype === 'error_max_turns' || ev.subtype === 'error_during_execution';
        update({ turns: ev.num_turns, cost: ev.total_cost_usd });
        return;
      }
      // Genuine pressure surfaces in `system` events (or stderr, handled above)
      // with precise tokens — never from assistant text or a fetched JD that
      // merely mentions "rate limiting". Do NOT scan `user`/tool_result content.
      if (ev.type === 'system' && PRESSURE_RE.test(JSON.stringify(ev))) {
        update({ warning: PRESSURE_WARNING });
      }
    }

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      const job = agentJobs.get(jobId) || {};
      let closeErr = null;
      if (code && code !== 0 && !resultText) {
        const out = job.output || '';
        closeErr = /not recognized|command not found/i.test(out)
          ? 'Claude Code CLI not found. Make sure `claude` is installed and on your PATH (run `claude` once in a terminal), then retry.'
          : (agentTail(out) || `claude exited ${code}`);
      }
      const err = isError ? (resultText || 'Agent reported an error') : closeErr;
      const ok = !err;
      agentJobs.set(jobId, {
        ...job,
        status: ok ? 'done' : 'error',
        summary: ok ? (resultText ? agentTail(resultText) : (job.activity || 'Agent finished')) : undefined,
        error: ok ? undefined : err,
        finishedAt: Date.now(),
      });
      resolve({ ok, result: resultText, error: err });
    });
  });
}

// Single agent run for BOTH Agent Scan and Evaluate Pipeline. Each dashboard
// command does exactly ONE thing now — no bundled gate -> merge -> verify ->
// health chain around the eval. The user runs Liveness Gate, Merge Tracker,
// Verify, and Health as their own sidebar steps, so a failure in one is visible
// and isolated. Bundling hid where the pipeline broke and multiplied Claude
// usage (the eval fanned out subagents inside a chain that also ran a gate).
async function runAgent(jobId, mode) {
  agentJobs.set(jobId, { mode, status: 'running', activity: 'Starting agent…', toolCalls: [], toolCount: 0, output: '', startedAt: Date.now() });
  const res = await runClaudeAgent(jobId, mode);
  // Evaluate writes tracker TSVs; folding them into applications.md is the
  // separate Merge Tracker step. Point the user at it so a written-but-not-yet-
  // merged result doesn't read as "nothing happened".
  if (mode === 'pipeline' && res.ok) {
    const job = agentJobs.get(jobId) || {};
    const note = 'Evaluations written. Run Merge Tracker (step 6) to add them to your pipeline.';
    agentJobs.set(jobId, { ...job, summary: job.summary ? `${job.summary} · ${note}` : note });
  }
}

// POST /api/agent/:mode — start a headless Claude Code job (scan | pipeline)
router.post('/api/agent/:mode', (req, res) => {
  const mode = req.params.mode;
  if (mode !== 'scan' && mode !== 'pipeline') {
    return res.status(400).json({ error: `Unknown agent mode: ${mode}` });
  }
  // Single-flight: agent runs share data/pipeline.md and the Pro quota
  for (const job of agentJobs.values()) {
    if (job.status === 'running') {
      return res.status(409).json({ error: 'An agent step is already running. Wait for it to finish.' });
    }
  }
  const jobId = `agent-${mode}-${Date.now()}`;
  const start = runAgent(jobId, mode);
  Promise.resolve(start).catch((e) => {
    agentJobs.set(jobId, { mode, status: 'error', error: (e && e.message) || 'Agent run failed', finishedAt: Date.now() });
  });
  res.json({ jobId });
});

// GET /api/agent/status/:jobId — poll a headless agent job
router.get('/api/agent/status/:jobId', (req, res) => {
  const job = agentJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ ...job, output: (job.output || '').slice(-4000) });
});


export { agentJobs };

