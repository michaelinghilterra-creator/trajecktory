import express from 'express';
import { exec, spawn } from 'child_process';
import { ROOT_DIR } from '../config.mjs';
import { WORKFLOW_STEPS, gateSummary, tailLines, verifySummary } from '../lib/workflow.mjs';

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
// job record. Resolves { ok, result, error } when the child closes. When
// `composed` is true the caller owns terminal status (used by the Evaluate
// sequence); otherwise this sets the job's final status itself.
function runClaudeAgent(jobId, mode, { composed = false } = {}) {
  return new Promise((resolve) => {
    const projectRoot = ROOT_DIR;
    const isWin = process.platform === 'win32';
    // `claude` is a .cmd shim on Windows; Node 20+/24 refuse to spawn a .cmd
    // without a shell, and passing a full .cmd path under a shell mangles the
    // backslashes. The reliable path is the bare name resolved by the shell.
    // shell:true does NOT escape args, so quote the (space-containing) prompt
    // ourselves; the remaining flags have no spaces or backslashes. On posix
    // no shell is needed — the args array handles the space natively.
    const prompt = `/trajecktory ${mode}`;
    const args = ['-p', isWin ? `"${prompt}"` : prompt,
                  '--output-format', 'stream-json', '--verbose',
                  '--permission-mode', 'acceptEdits'];

    const update = (patch) => {
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, ...patch });
    };
    const fail = (msg) => {
      const job = agentJobs.get(jobId) || {};
      if (!composed) agentJobs.set(jobId, { ...job, status: 'error', error: msg, finishedAt: Date.now() });
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
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, output: ((job.output || '') + chunk.toString()).slice(-8192) });
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
      // rate-limit / retry pressure → soft warning, keep running
      const flat = JSON.stringify(ev).toLowerCase();
      if (/api_retry|overloaded|rate.?limit|usage limit/.test(flat)) {
        update({ warning: 'Claude usage/limit pressure — run may slow or stop early.' });
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
      if (!composed) {
        agentJobs.set(jobId, {
          ...job,
          status: ok ? 'done' : 'error',
          summary: ok ? (resultText ? agentTail(resultText) : (job.activity || 'Agent finished')) : undefined,
          error: ok ? undefined : err,
          finishedAt: Date.now(),
        });
      }
      resolve({ ok, result: resultText, error: err });
    });
  });
}

// Run one deterministic node step (reuses the WORKFLOW_STEPS command strings).
function runNodeStep(cmd) {
  return new Promise((resolve) => {
    const projectRoot = ROOT_DIR;
    exec(cmd, { cwd: projectRoot, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      const output = (stdout || '') + (stderr ? '\n[stderr]\n' + stderr : '');
      resolve({ ok: !(err && err.code), output, error: err && err.code ? err.message : null });
    });
  });
}

// Single agent run (Agent Scan): no pre/post node steps.
async function runAgent(jobId, mode) {
  agentJobs.set(jobId, { mode, status: 'running', activity: 'Starting agent…', toolCalls: [], toolCount: 0, output: '', startedAt: Date.now() });
  await runClaudeAgent(jobId, mode);
}

// Composed Evaluate Pipeline: gate → agent → merge → verify → health.
// Matches the AGENTS.md "one true batch workflow" ordering.
async function runEvaluatePipeline(jobId) {
  const subSteps = [
    { key: 'gate',   label: 'Liveness gate',     status: 'pending' },
    { key: 'agent',  label: 'Evaluate (Claude)', status: 'pending' },
    { key: 'merge',  label: 'Merge tracker',     status: 'pending' },
    { key: 'verify', label: 'Verify actionable', status: 'pending' },
    { key: 'health', label: 'Health check',      status: 'pending' },
  ];
  const commit = () => {
    const job = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, { ...job, subSteps: subSteps.map(s => ({ ...s })) });
  };
  const setSub = (key, patch) => {
    const s = subSteps.find(x => x.key === key);
    if (s) Object.assign(s, patch);
    commit();
  };

  agentJobs.set(jobId, {
    mode: 'pipeline', status: 'running', activity: 'Gating pipeline…',
    toolCalls: [], toolCount: 0, output: '',
    subSteps: subSteps.map(s => ({ ...s })), startedAt: Date.now(),
  });

  // 1. Liveness gate (Playwright in the main process — agent can't run it headless)
  setSub('gate', { status: 'running' });
  const gate = await runNodeStep(WORKFLOW_STEPS.gate.cmd);
  setSub('gate', { status: gate.ok ? 'done' : 'error', summary: gate.ok ? gateSummary(gate.output) : (gate.error || 'gate failed') });
  if (!gate.ok) {
    const job = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, { ...job, status: 'error', error: 'Liveness gate failed — aborted before spending tokens. See the gate sub-step.', finishedAt: Date.now() });
    return;
  }

  // 2. Evaluate (headless Claude Code)
  setSub('agent', { status: 'running' });
  update_activity(jobId, 'Evaluating pending postings…');
  const agent = await runClaudeAgent(jobId, 'pipeline', { composed: true });
  setSub('agent', { status: agent.ok ? 'done' : 'error', summary: agent.ok ? agentTail(agent.result || 'evaluation complete') : (agent.error || 'agent error') });
  if (!agent.ok) {
    const job = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, { ...job, warning: 'Evaluation stopped early (often a Claude usage limit). Partial results are still merged below — re-run later to finish remaining items.' });
  }

  // 3. Merge tracker
  setSub('merge', { status: 'running' });
  const merge = await runNodeStep(WORKFLOW_STEPS.merge.cmd);
  setSub('merge', { status: merge.ok ? 'done' : 'error', summary: merge.ok ? tailLines(merge.output) : (merge.error || 'merge failed') });

  // 4. Verify actionable (safety-net dead-link flip)
  setSub('verify', { status: 'running' });
  const verify = await runNodeStep(WORKFLOW_STEPS.verify.cmd);
  setSub('verify', { status: verify.ok ? 'done' : 'error', summary: verify.ok ? verifySummary(verify.output) : (verify.error || 'verify failed') });

  // 5. Health check (report parser drift)
  setSub('health', { status: 'running' });
  const health = await runNodeStep(WORKFLOW_STEPS.health.cmd);
  const drift = /⚠|drift|FAIL/i.test(health.output || '');
  setSub('health', { status: !health.ok ? 'error' : (drift ? 'warn' : 'done'), summary: tailLines(health.output) });

  const job = agentJobs.get(jobId) || {};
  const warning = job.warning || (drift ? 'Report drift detected — some drawer entries may not parse. Re-run health or fix report format.' : undefined);
  agentJobs.set(jobId, {
    ...job,
    status: 'done',
    summary: agent.ok ? 'Pipeline evaluated · reports + tracker updated' : 'Partial evaluation merged — re-run to finish',
    warning,
    finishedAt: Date.now(),
  });
}

function update_activity(jobId, activity) {
  const job = agentJobs.get(jobId) || {};
  agentJobs.set(jobId, { ...job, activity });
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
  const start = mode === 'scan' ? runAgent(jobId, 'scan') : runEvaluatePipeline(jobId);
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

