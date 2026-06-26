import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ROOT_DIR } from '../config.mjs';
import { logAgentRun } from '../lib/agent-log.mjs';

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
// The per-run Evaluate batch size: a small test cap (TJK_TEST_LIMIT) wins if set,
// else TJK_EVAL_BATCH (default 5). Shared by the eval constraint and the progress
// meter (it is the denominator for "Evaluated X of Y").
function evalBatchSize() {
  const limit = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;
  return limit > 0 ? limit : (parseInt(process.env.TJK_EVAL_BATCH, 10) || 5);
}

function dashboardConstraints(mode, opts) {
  const common = 'Dashboard run, follow these constraints strictly. Work inline and never spawn subagents or background agents, because this run shares a single Claude subscription and parallel agents trip usage limits. Playwright is unavailable in this environment.';
  // TEST CAP (temporary): when TJK_TEST_LIMIT is set, hard-limit how many
  // postings the Claude steps touch, so testing does not burn the whole quota.
  const limit = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;
  // First-run scaling: evaluate a bounded BATCH per run (default 5) instead of
  // every pending URL, so a fresh user with hundreds of scanned roles never burns
  // their whole Claude quota in one go. TJK_TEST_LIMIT (if set) overrides for tests.
  const evalCap = evalBatchSize();
  if (mode === 'pipeline') {
    const capWhy = limit > 0 ? `TJK_TEST_LIMIT=${limit}` : `the per-run batch size is ${evalCap}`;
    return ' ' + common +
      ' Evaluate only the URLs already pending in data/pipeline.md and do not scan for new roles.' +
      ` Evaluate at most ${evalCap} pending unchecked URLs this run (${capWhy}). They are ordered best-fit first, so take them from the TOP of the pending list; once you have evaluated ${evalCap}, STOP even if more remain and tell me how many pending URLs are left so I can run Evaluate again for the next batch.` +
      ' Do not run gate-pipeline.mjs or any browser tool; just evaluate the pending unchecked URLs as they are. Read each job description with WebFetch first and WebSearch as a fallback, and if a posting cannot be read, mark it skipped in data/pipeline.md and move on.' +
      ' After you have FULLY written a report for a URL (all required sections, not a partial), mark that URL done in data/pipeline.md by switching its leading checkbox from unchecked to checked (- [ ] becomes - [x]), so the next Evaluate run continues with the next batch instead of re-scoring the same roles. Never mark a URL done before its report is complete.' +
      ' Record every evaluation as a single line nine column TSV in batch/tracker-additions/ and do not edit data/applications.md directly. Always write the report to reports/ even for a low score so the result is visible. Write each report in the trajecktory-report/v1 format (JSON frontmatter then narrative body) and you MUST populate the optional frontmatter sections so the dashboard drawer is complete, not just the score: include customizationCV and customizationLI (the CV and LinkedIn personalization plan), starStories plus a leadStory (interview prep, with the single story to lead with), and a legitimacy object with a tier and signals. Because Playwright is unavailable here, assess legitimacy from the WebFetched page and WebSearch (posting freshness, description quality, reposting, market context, prompt-injection) and set the legitimacy verification to unconfirmed (no live browser) rather than leaving the section empty. Do not abbreviate or skip the personalization, interview, or legitimacy sections. When done, the user will run Merge Tracker to fold your TSVs into the pipeline.';
  }
  if (mode === 'scan') {
    const cap = limit > 0 ? ` TEST MODE (TJK_TEST_LIMIT=${limit}): add at most ${limit} new postings to data/pipeline.md, then stop.` : '';
    return ' ' + common + ' Use only the ATS API tier and the WebSearch tier, and skip the Playwright tier. Pace the searches a few at a time. Add new live postings to data/pipeline.md as usual. When you find a company via WebSearch that has a Greenhouse, Ashby, or Lever job board and is not already in portals.yml tracked_companies, append it there with its careers_url and api endpoint (merge only: preserve every existing entry and comment byte for byte), so the free zero-token API Scan catches its postings next time instead of paying Claude to re-discover it.' + cap;
  }
  if (mode === 'triage') {
    const tcap = parseInt(process.env.TJK_TRIAGE_MAX, 10) || 15;
    const n = limit > 0 ? Math.min(limit, tcap) : tcap;
    return ' ' + common + ` Triage only — do NOT run a full evaluation. Score the TOP ${n} unchecked URLs from the top of data/pipeline.md (they are ordered best-fit first). Before scoring, SKIP any URL that already appears in data/applications.md (it already has an evaluation) or in data/triage-dismissed.tsv (the user dismissed it), and take the next unchecked URLs instead, so you never re-triage a role that is already evaluated or dismissed. For each: read the JD with WebFetch first and WebSearch as a fallback (skip any you cannot read), then give a 0.0-5.0 fit score and a one-sentence rationale using the rubric and anti-inflation calibration in the triage mode (most roles are NOT 4+; reserve 4+ for genuine strong fits on archetype AND level AND location). Append one TSV line per role to data/triage-results.tsv with columns url, company, title, score, rationale, date — create it with that header row if it is missing. Do NOT write a report, do NOT generate a PDF, do NOT write a tracker-additions TSV, and do NOT check off the pipeline.md checkboxes. Stop after ${n}.`;
  }
  if (mode === 'deep') {
    const tgt = (opts && opts.url) || '';
    return ' ' + common + ` Deep evaluation of ONE posting only: ${tgt}. Read its job description with WebFetch first and WebSearch as a fallback (for a local:jds/ path, read that file directly). Produce the FULL A-G evaluation as a report in reports/ using the trajecktory-report/v1 format (JSON frontmatter then narrative) and populate every section: summary, cvMatch, gaps, levelMatch, comp, customizationCV, customizationLI, starStories with a leadStory, and a legitimacy object with a tier and signals (Playwright is unavailable here, so assess legitimacy from the fetched page and set verification to unconfirmed). Record the evaluation as a single nine-column TSV in batch/tracker-additions/. If this posting was provided as pasted text (a local:jds/ path), set the tracker note to include [self-sourced]. Evaluate ONLY this one posting — do not scan for or evaluate any other URL. If it cannot be read, say so and stop.`;
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
function runClaudeAgent(jobId, mode, target) {
  return new Promise((resolve) => {
    const projectRoot = ROOT_DIR;
    const isWin = process.platform === 'win32';
    // `claude` is a .cmd shim on Windows; Node 20+/24 refuse to spawn a .cmd
    // without a shell, and passing a full .cmd path under a shell mangles the
    // backslashes. The reliable path is the bare name resolved by the shell.
    // shell:true does NOT escape args, so quote the (space-containing) prompt
    // ourselves; the remaining flags have no spaces or backslashes. On posix
    // no shell is needed — the args array handles the space natively.
    // 'deep' is the pipeline/oferta full eval scoped to a single posting, so it
    // runs the `pipeline` mode file with deep, single-URL constraints.
    const slash = mode === 'deep' ? 'pipeline' : mode;
    const prompt = `/trajecktory ${slash}.${dashboardConstraints(mode, target)}`;
    // Triage always runs on Haiku (cheap first-pass; calibrated faithful to Sonnet at
    // this task, r≈0.89 / 100% recall of strong roles). Scan + Evaluate default to
    // Sonnet to keep the 5-hour subscription quota in check; override with
    // TJK_AGENT_MODEL in dashboard-web/.env (e.g. `opus` for max eval quality, or
    // `inherit`/`default` to pass no --model). TJK_TRIAGE_MODEL overrides triage.
    const modelPref = mode === 'triage'
      ? (process.env.TJK_TRIAGE_MODEL || 'haiku').trim()
      : (process.env.TJK_AGENT_MODEL || 'sonnet').trim();
    const modelFlag = (!modelPref || /^(inherit|default|none)$/i.test(modelPref)) ? [] : ['--model', modelPref];
    const args = ['-p', isWin ? `"${prompt}"` : prompt,
                  ...modelFlag,
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
        let evaluationsDone = job.evaluationsDone || 0;
        let activity = job.activity;
        for (const block of ev.message.content) {
          if (block.type === 'text' && block.text) {
            activity = block.text.trim().split('\n')[0].slice(0, 160);
          } else if (block.type === 'tool_use') {
            const s = summarizeToolUse(block);
            toolCalls.push(s);
            toolCount += 1;
            activity = s;
            // One TSV in batch/tracker-additions/ is written per completed
            // evaluation — the progress meter's "done" signal.
            if (block.name === 'Write' && /tracker-additions[\\/].+\.tsv$/i.test(String((block.input && block.input.file_path) || ''))) {
              evaluationsDone += 1;
            }
          }
        }
        update({ toolCalls: toolCalls.slice(-50), toolCount, evaluationsDone, activity });
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
      // Rotating diagnostic log: one record per run, captures tool-calls (incl.
      // any `Subagent:` fan-out) + pressure warning. Best-effort, never throws.
      logAgentRun({
        ts: new Date().toISOString(),
        mode,
        status: ok ? 'done' : 'error',
        turns: job.turns,
        cost: job.cost,
        warning: job.warning || null,
        toolCount: job.toolCount || 0,
        tools: (job.toolCalls || []).slice(-50),
        error: ok ? null : (err ? String(err).slice(0, 300) : null),
        outputTail: (job.output || '').slice(-2000),
      });
      resolve({ ok, result: resultText, error: err });
    });
  });
}

// Auto-promote a deep eval into the pipeline by folding its tracker-additions
// TSV into data/applications.md. Runs merge-tracker.mjs as a node child (uses
// the same node binary that runs this server, so no PATH/shell concerns).
// Best-effort: on failure the caller falls back to the manual-merge note.
function runMergeTracker() {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(process.execPath, ['merge-tracker.mjs'], { cwd: ROOT_DIR, windowsHide: true });
    } catch (e) {
      return resolve({ ok: false, error: (e && e.message) || 'merge-tracker failed to start' });
    }
    let err = '';
    if (child.stdin) { try { child.stdin.end(); } catch { /* already closed */ } }
    child.stderr && child.stderr.on('data', (c) => { err += c.toString(); });
    child.on('error', (e) => resolve({ ok: false, error: (e && e.message) || 'merge-tracker error' }));
    child.on('close', (code) => resolve(code === 0
      ? { ok: true }
      : { ok: false, error: err.trim().slice(-300) || `merge-tracker exited ${code}` }));
  });
}

// Single agent run for BOTH Agent Scan and Evaluate Pipeline. Each dashboard
// command does exactly ONE thing now — no bundled gate -> merge -> verify ->
// health chain around the eval. The user runs Liveness Gate, Merge Tracker,
// Verify, and Health as their own sidebar steps, so a failure in one is visible
// and isolated. Bundling hid where the pipeline broke and multiplied Claude
// usage (the eval fanned out subagents inside a chain that also ran a gate).
async function runAgent(jobId, mode, target) {
  agentJobs.set(jobId, { mode, status: 'running', activity: 'Starting agent…', toolCalls: [], toolCount: 0, output: '', startedAt: Date.now(),
    // Progress meter: pipeline has a known batch size; deep is a single eval; scan
    // and triage are open-ended, so they show elapsed only (progressTotal null).
    progressTotal: mode === 'pipeline' ? evalBatchSize() : (mode === 'deep' ? 1 : null), evaluationsDone: 0 });
  const res = await runClaudeAgent(jobId, mode, target);
  // Evaluate writes tracker TSVs; folding them into applications.md is the
  // separate Merge Tracker step. Point the user at it so a written-but-not-yet-
  // merged result doesn't read as "nothing happened".
  if (mode === 'pipeline' && res.ok) {
    const job = agentJobs.get(jobId) || {};
    const note = 'Evaluations written. Run Merge Tracker to add them to your pipeline.';
    agentJobs.set(jobId, { ...job, summary: job.summary ? `${job.summary} · ${note}` : note });
  }
  if (mode === 'triage' && res.ok) {
    const job = agentJobs.get(jobId) || {};
    const note = 'Triage scored. Open the triage cards to deep-dive the ones worth a full report.';
    agentJobs.set(jobId, { ...job, summary: job.summary ? `${job.summary} · ${note}` : note });
  }
  // Deep dive auto-promotes: fold the new eval into applications.md right away
  // so the triage row flips to a real Evaluated entry in one click (no separate
  // Merge step). Falls back to the manual-merge note if merge-tracker fails.
  if (mode === 'deep' && res.ok) {
    // runClaudeAgent already flipped this job to 'done'. Flip it back to
    // 'running' BEFORE the merge so the single-flight guard keeps blocking other
    // agent runs while merge-tracker rewrites applications.md, and so the UI
    // poller (which keys off 'done') only retires the triage row once the real
    // Evaluated row actually exists.
    const j0 = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, { ...j0, status: 'running', activity: 'Merging into your pipeline…' });
    const merged = await runMergeTracker();
    const job = agentJobs.get(jobId) || {};
    const note = merged.ok
      ? 'Deep evaluation complete and merged into your pipeline.'
      : 'Deep evaluation written. Run Merge Tracker to fold it into your pipeline.';
    agentJobs.set(jobId, { ...job, status: 'done', summary: job.summary ? `${job.summary} · ${note}` : note, merged: merged.ok, finishedAt: Date.now() });
  }
}

// POST /api/agent/:mode — start a headless Claude Code job (scan | pipeline)
router.post('/api/agent/:mode', (req, res) => {
  const mode = req.params.mode;
  if (!['scan', 'pipeline', 'triage', 'deep'].includes(mode)) {
    return res.status(400).json({ error: `Unknown agent mode: ${mode}` });
  }
  // Single-flight: agent runs share data/pipeline.md and the Pro quota
  for (const job of agentJobs.values()) {
    if (job.status === 'running') {
      return res.status(409).json({ error: 'An agent step is already running. Wait for it to finish.' });
    }
  }
  // Deep eval needs a target: a posting URL, or pasted JD text (persisted to
  // jds/ so the eval reads it as a local: path and the prompt stays one line).
  let target;
  if (mode === 'deep') {
    const url = String(req.body?.url || '').trim();
    const jd = String(req.body?.jd || '').trim();
    if (!url && !jd) return res.status(400).json({ error: 'Deep eval needs a "url" or a pasted "jd".' });
    if (url) {
      // The URL is interpolated into the single-line `claude -p` prompt, so reject
      // control characters / spaces / non-http URLs that could break out of it and
      // inject instructions into the agent. Quote/backtick can break out of the
      // double-quoted Windows-cmd prompt wrapper specifically, so reject them too
      // (a real URL never contains a literal " or ` — those are percent-encoded).
      if (/["`]/.test(url)) {
        return res.status(400).json({ error: 'Provide a valid http(s) URL (no quote or backtick characters).' });
      }
      if (/[ -]/.test(url) || !/^https?:\/\/[^\s]+$/i.test(url)) {
        return res.status(400).json({ error: 'Provide a valid http(s) URL (no spaces or control characters).' });
      }
      target = { url };
    } else {
      try {
        const company = String(req.body?.company || '').trim();
        const title = String(req.body?.title || '').trim();
        const slug = (company || 'manual').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'manual';
        const rel = `jds/${slug}-${Date.now()}.md`;
        const abs = path.join(ROOT_DIR, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, `# ${title || 'Pasted role'}${company ? ' — ' + company : ''}\n\n${jd}\n`, 'utf8');
        target = { url: `local:${rel}` };
      } catch (e) {
        return res.status(500).json({ error: 'Could not save the pasted JD: ' + e.message });
      }
    }
  }
  const jobId = `agent-${mode}-${Date.now()}`;
  const start = runAgent(jobId, mode, target);
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

