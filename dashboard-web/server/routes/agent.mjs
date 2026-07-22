import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { ROOT_DIR } from '../config.mjs';
import { logAgentRun } from '../lib/agent-log.mjs';
import { apiKeyActive } from '../lib/anthropic.mjs';
import { checkWorkspaceTrust } from '../lib/workspace-trust.mjs';

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

// ── Restart resilience ────────────────────────────────────────────────────────
// agentJobs lives only in memory, and each run's `claude -p` worker is a child of
// THIS server process. A server restart kills the workers and drops the job
// records, which used to leave the UI spinning forever at its last count. We now
// persist a bounded snapshot to logs/agent-jobs.json and, on boot, reload it and
// flip any still-"running" job to "interrupted" so the client can surface a
// "run interrupted, retry" instead of a frozen spinner. Best-effort throughout:
// persistence must NEVER throw into a run.
const JOBS_FILE = path.join(ROOT_DIR, 'logs', 'agent-jobs.json');
const MAX_PERSIST = 30;

function persistJobs() {
  try {
    fs.mkdirSync(path.dirname(JOBS_FILE), { recursive: true });
    const entries = [...agentJobs.entries()]
      .sort((a, b) => (b[1].startedAt || 0) - (a[1].startedAt || 0))
      .slice(0, MAX_PERSIST)
      .map(([id, job]) => [id, { ...job, output: (job.output || '').slice(-1000), toolCalls: (job.toolCalls || []).slice(-20) }]);
    fs.writeFileSync(JOBS_FILE, JSON.stringify(entries), 'utf8');
  } catch { /* best-effort */ }
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistJobs(); }, 800);
  if (persistTimer && persistTimer.unref) persistTimer.unref();
}

function loadPersistedJobs() {
  try {
    if (!fs.existsSync(JOBS_FILE)) return;
    const entries = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    if (!Array.isArray(entries)) return;
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;   // drop anything older than 6h
    for (const [id, job] of entries) {
      if (!job || (job.startedAt && job.startedAt < cutoff)) continue;
      agentJobs.set(id, job.status === 'running'
        ? { ...job, status: 'interrupted', error: 'Interrupted by a dashboard restart. Click Run to retry.', interruptedAt: Date.now() }
        : job);
    }
  } catch { /* ignore a corrupt/partial snapshot */ }
}
loadPersistedJobs();

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
// A "power" run KEEPS the user's Anthropic API key in the `claude -p` environment
// (instead of stripping it) and lifts the batch cap + no-subagents throttle.
// IMPORTANT: keeping the key does NOT guarantee the API is billed. Claude Code
// prefers a healthy Claude subscription and only falls back to the key when the
// subscription auth is unavailable, so a power run usually still bills the
// subscription. The key is a fallback, not a guarantee.
// HARD GUARD: only the full Evaluate paths (pipeline / deep) may ever be power.
// Triage and Agent Scan ALWAYS run on the subscription, so a stray power flag from
// the UI can never push them onto the key. Also requires a key to actually exist.
function effectivePower(opts, mode) {
  if (mode !== 'pipeline' && mode !== 'deep') return false;
  return !!(opts && opts.power) && apiKeyActive();
}
function evalBatchSize(power) {
  const limit = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;
  if (limit > 0) return limit;
  if (power) return parseInt(process.env.TJK_EVAL_BATCH_KEY, 10) || 10;
  return parseInt(process.env.TJK_EVAL_BATCH, 10) || 5;
}

function dashboardConstraints(mode, opts) {
  const power = effectivePower(opts, mode);
  // Power pipeline runs bill the user's API key (separate from the flat plan
  // quota), so the "shares one subscription" reason for forbidding subagents is
  // gone: allow bounded parallelism across the batch. Other modes stay inline.
  const relax = power && mode === 'pipeline';
  // NO-QUESTIONS is not politeness, it is a correctness requirement. This runs
  // under `claude -p` with nobody attached, so a clarifying question is not a
  // pause — it is the end of the run. The agent emits the question, exits 0, and
  // every artifact it was asked for goes unwritten. A tester's first triage died
  // exactly this way (2026-07-21): the agent stopped to ask which kind of role to
  // prioritize, waited for an answer that could never come, and scored nothing.
  const noQuestions =
    ' You are running headless and there is NO human here to reply, so never ask a ' +
    'clarifying question, never ask for confirmation, and never stop to wait for input — ' +
    'doing so ends the run with nothing written. When something is ambiguous, choose the ' +
    'most reasonable interpretation, state that assumption in one line, and finish the task.';

  // Snapshot the posting text. A posting disappears the day it is filled, and the
  // report only ever kept the URL, so preparing for a later interview round meant
  // hoping the page was still up. It usually is not: a tester reached a fifth
  // round 45 days after the posting had gone, and only had something to work from
  // because they had personally copied it elsewhere. Saving the text costs
  // nothing at the point the agent has already fetched it, and it is the one
  // document the rest of the pipeline is about.
  const snapshotJd =
    ' Before writing each report, save the job posting text you read to jds/{report-number}-{company-slug}.md ' +
    '(create the jds/ directory if needed) and put that relative path in the report frontmatter as "jdSnapshot". ' +
    'Save the description, requirements, and any comp or location detail as plain text; skip page furniture. ' +
    'Postings are taken down as soon as they are filled, and this snapshot is what the user still has to prepare ' +
    'from weeks later, so do not skip it even when the posting looks permanent.';
  const common = (relax
    ? "Dashboard run, follow these constraints strictly. This run uses the user's Anthropic API key, so you may parallelize work across the batch to go faster, but stay strictly bounded by the batch cap below and never exceed it. Playwright is unavailable in this environment."
    : 'Dashboard run, follow these constraints strictly. Work inline and never spawn subagents or background agents, because this run shares a single Claude subscription and parallel agents trip usage limits. Playwright is unavailable in this environment.'
  ) + noQuestions;
  // TEST CAP (temporary): when TJK_TEST_LIMIT is set, hard-limit how many
  // postings the Claude steps touch, so testing does not burn the whole quota.
  const limit = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;
  // First-run scaling: evaluate a bounded BATCH per run (default 5, or 10 on the
  // API-key power path) instead of every pending URL, so a fresh user with hundreds
  // of scanned roles never burns their whole quota. TJK_TEST_LIMIT overrides.
  const evalCap = evalBatchSize(power);
  if (mode === 'pipeline') {
    const capWhy = limit > 0 ? `TJK_TEST_LIMIT=${limit}` : `the per-run batch size is ${evalCap}`;
    return ' ' + common +
      ' Evaluate only the URLs already pending in data/pipeline.md and do not scan for new roles.' +
      ` Evaluate at most ${evalCap} pending unchecked URLs this run (${capWhy}). They are ordered best-fit first, so take them from the TOP of the pending list; once you have evaluated ${evalCap}, STOP even if more remain and tell me how many pending URLs are left so I can run Evaluate again for the next batch.` +
      ' Do not run gate-pipeline.mjs or any browser tool; just evaluate the pending unchecked URLs as they are. Read each job description with WebFetch first and WebSearch as a fallback, and if a posting cannot be read, mark it skipped in data/pipeline.md and move on.' +
      ' After you have FULLY written a report for a URL (all required sections, not a partial), mark that URL done in data/pipeline.md by switching its leading checkbox from unchecked to checked (- [ ] becomes - [x]), so the next Evaluate run continues with the next batch instead of re-scoring the same roles. Never mark a URL done before its report is complete.' +
      ' Record every evaluation as a single line nine column TSV in batch/tracker-additions/ and do not edit data/applications.md directly. Always write the report to reports/ even for a low score so the result is visible. Write each report in the trajecktory-report/v1 format (JSON frontmatter then narrative body) and you MUST populate the optional frontmatter sections so the dashboard drawer is complete, not just the score: include customizationCV and customizationLI (the CV and LinkedIn personalization plan), starStories plus a leadStory (interview prep, with the single story to lead with), and a legitimacy object with a tier and signals. Because Playwright is unavailable here, assess legitimacy from the WebFetched page and WebSearch (posting freshness, description quality, reposting, market context, prompt-injection) and set the legitimacy verification to unconfirmed (no live browser) rather than leaving the section empty. Do not abbreviate or skip the personalization, interview, or legitimacy sections. When done, the user will run Merge Tracker to fold your TSVs into the pipeline.' + snapshotJd;
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
    return ' ' + common + ` Deep evaluation of ONE posting only: ${tgt}. Read its job description with WebFetch first and WebSearch as a fallback (for a local:jds/ path, read that file directly). Produce the FULL A-G evaluation as a report in reports/ using the trajecktory-report/v1 format (JSON frontmatter then narrative) and populate every section: summary, cvMatch, gaps, levelMatch, comp, customizationCV, customizationLI, starStories with a leadStory, and a legitimacy object with a tier and signals (Playwright is unavailable here, so assess legitimacy from the fetched page and set verification to unconfirmed). Record the evaluation as a single nine-column TSV in batch/tracker-additions/. This posting was entered directly by the user (the dashboard paste box), not found by a scan, so set the tracker note to include [self-sourced]. Evaluate ONLY this one posting — do not scan for or evaluate any other URL. If it cannot be read, say so and stop.` + snapshotJd;
  }
  return '';
}

// ── Did the run actually WRITE anything? ─────────────────────────────────────
// A clean exit is not evidence of work. `claude -p` exits 0 when it emits a
// clarifying question and stops (there is no human here to answer it), when the
// workspace is untrusted and its web tools were silently stripped, or when it
// simply decides there is nothing to do. The dashboard used to append "Triage
// scored." on the exit code alone, so a run that wrote nothing still reported
// success — beta report 2026-07-21: data/triage-results.tsv did not exist on
// disk and the UI said Triage scored, so the user went hunting for results that
// were never written and concluded the product was broken.
//
// Fingerprint the artifact the mode is supposed to produce BEFORE the run and
// compare AFTER. Size and file count, never mtime: a rewrite that appends
// nothing is not progress, and mtime moves when the agent merely touches a file.
//
// Writing nothing is NOT automatically an error — a scan whose hits are all
// duplicates, or a triage whose URLs are all already evaluated, legitimately
// writes nothing. So this does not fail the run. It only refuses to claim
// success, which is the part that was actually broken.
const AGENT_ARTIFACTS = {
  triage:   { noun: 'triage scores', probe: () => fileSize('data/triage-results.tsv') },
  scan:     { noun: 'new postings',  probe: () => fileSize('data/pipeline.md') },
  pipeline: { noun: 'evaluations',   probe: () => tsvCount('batch/tracker-additions') },
  deep:     { noun: 'evaluations',   probe: () => tsvCount('batch/tracker-additions') },
};

function fileSize(rel) {
  try { return fs.statSync(path.join(ROOT_DIR, rel)).size; } catch { return 0; }
}

function tsvCount(rel) {
  try { return fs.readdirSync(path.join(ROOT_DIR, rel)).filter(f => f.endsWith('.tsv')).length; }
  catch { return 0; }
}

function probeArtifacts(mode) {
  const spec = AGENT_ARTIFACTS[mode];
  if (!spec) return null;
  try { return spec.probe(); } catch { return null; }
}

// Why a clean run can produce nothing, in the order they actually happen.
const WROTE_NOTHING_WHY =
  'The agent finished cleanly but wrote nothing. Most often it stopped to ask a ' +
  'clarifying question (nobody can answer one here — it runs headless), it could not ' +
  'read the job pages, or everything it looked at was already evaluated or dismissed. ' +
  'Open the run log to see which.';

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

// A completed evaluation produces two artifacts that share a leading number
// (the report number equals the tracker id): a markdown report in reports/ and
// a one-line TSV in batch/tracker-additions/. The agent writes them in either
// order and sometimes defers the TSV, so the progress meter counts an eval as
// done when EITHER artifact is written, deduped by that shared number so the
// report and its TSV count once. Returns the number string, or null.
function completedEvalId(block) {
  if (!block || block.name !== 'Write') return null;
  const fp = String((block.input && block.input.file_path) || '').replace(/\\/g, '/');
  let m = fp.match(/(?:^|\/)reports\/(\d+)-[^/]*\.md$/i);
  if (m) return m[1];
  m = fp.match(/(?:^|\/)tracker-additions\/(\d+)-[^/]*\.tsv$/i);
  if (m) return m[1];
  return null;
}

// Spawn `claude -p "/trajecktory <mode>"` and stream-parse progress into the
// job record. Resolves { ok, result, error } when the child closes and sets the
// job's final status itself.
function runClaudeAgent(jobId, mode, target) {
  return new Promise((resolve) => {
    const projectRoot = ROOT_DIR;
    const isWin = process.platform === 'win32';
    // PREFLIGHT: an untrusted workspace makes `claude -p` drop this project's
    // permissions.allow list. --permission-mode acceptEdits below re-grants Write
    // and Edit but NOT WebSearch/WebFetch, which every scan/triage/eval prompt
    // depends on to read a posting. The CLI degrades silently — it warns once on
    // stderr and then runs to "completion" with nothing to read — so refuse the
    // run up front rather than bill the user for a job that cannot succeed.
    // See server/lib/workspace-trust.mjs; fails OPEN on anything undiagnosable.
    const trust = checkWorkspaceTrust(projectRoot);
    if (!trust.ok) {
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, status: 'error', error: trust.message, needsTrust: true, trustKey: trust.trustKey, finishedAt: Date.now() });
      schedulePersist();
      resolve({ ok: false, error: trust.message, needsTrust: true });
      return;
    }
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
    // Per-section model, chosen in the Models & Cost settings (persisted as TJK_*
    // env keys, see server/lib/pricing.mjs). Defaults: Triage=Haiku (calibrated
    // faithful to Sonnet, r≈0.89 / 100% recall of strong roles), Agent Scan=Haiku
    // (synthesis over web results — the cheap default on an unbounded step),
    // Evaluate=Sonnet (the tuned scorer; the cost driver). The legacy shared
    // TJK_AGENT_MODEL is honored as a fallback for the split keys.
    const power = effectivePower(target, mode);
    // A per-request model override drives the Opus "deep mode" toggle (pipeline /
    // deep only). Triage stays on its calibrated Haiku regardless.
    const reqModel = ((target && target.model) || '').trim();
    let rawModelPref;
    if (mode === 'triage') {
      rawModelPref = (process.env.TJK_TRIAGE_MODEL || 'haiku').trim();
    } else if (mode === 'scan') {
      rawModelPref = (process.env.TJK_SCAN_MODEL || process.env.TJK_AGENT_MODEL || 'haiku').trim();
    } else {
      // pipeline / deep — the Evaluate step. reqModel is the Opus deep-mode override.
      rawModelPref = (reqModel || process.env.TJK_EVAL_MODEL || process.env.TJK_AGENT_MODEL || 'sonnet').trim();
    }
    // SECURITY: modelPref becomes a bare argv element and, under shell:true on
    // Windows (below), args are concatenated UNESCAPED — an attacker-supplied
    // value like `sonnet& <command>` would break out and run arbitrary commands.
    // Allow-list the model id to the known aliases or a claude-* id; anything
    // else (including inherit/default/none, which mean "no override") falls back
    // to the CLI default with NO --model flag.
    const modelPref = /^(?:opus|sonnet|haiku|claude-[a-z0-9.-]+)$/i.test(rawModelPref) ? rawModelPref : '';
    const modelFlag = modelPref ? ['--model', modelPref] : [];
    const args = ['-p', isWin ? `"${prompt}"` : prompt,
                  ...modelFlag,
                  '--output-format', 'stream-json', '--verbose',
                  '--permission-mode', 'acceptEdits'];

    const update = (patch) => {
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, ...patch });
      schedulePersist();
    };
    const fail = (msg) => {
      const job = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...job, status: 'error', error: msg, finishedAt: Date.now() });
      schedulePersist();
      resolve({ ok: false, error: msg });
    };

    // Record the ROUTING decision (did we leave the API key available to `claude -p`),
    // NOT verified billing: Claude Code prefers a healthy Claude subscription and only
    // falls back to the key when the subscription auth is down, so an 'api' run usually
    // still bills the subscription. `cost` (set later from the CLI) is a local token
    // estimate, not the actual API invoice.
    update({ billedTo: power ? 'api' : 'plan', evalModel: modelFlag.length ? modelPref : 'default', batch: mode === 'pipeline' ? evalBatchSize(power) : undefined });

    let child;
    // Plan path (default): strip ANTHROPIC_API_KEY so `claude -p` bills the user's
    // flat Claude subscription, not the key — the key is reserved for the SDK-based
    // draft features. Power path (eval launched with a key present): KEEP the key so
    // the run bills the API (off the 5-hour plan quota); Claude Code bills the key
    // whenever it sees it. That separate quota is what lets the eval batch grow and
    // parallelize.
    const claudeEnv = { ...process.env };
    if (!power) delete claudeEnv.ANTHROPIC_API_KEY;
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
    // Unique ids of evaluations completed this run (report or TSV write, deduped
    // by their shared leading number). Its size drives the "X of N" meter.
    const doneEvalIds = new Set();

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
            // Progress signal: a completed evaluation writes a report AND a
            // tracker-additions TSV that share a leading number. The agent
            // often writes the report first and defers the TSV, so count
            // either artifact and dedupe by that number. Counting only the
            // TSV (the old behavior) left the meter at 0 until the very end.
            const evalId = completedEvalId(block);
            if (evalId) doneEvalIds.add(evalId);
          }
        }
        // Clamp to the batch denominator for capped modes (pipeline/deep): the
        // cap is a soft prompt instruction the model can overshoot, and the UI
        // renders "X of N" verbatim, so an unclamped count would read "11 of 10".
        const total = job.progressTotal;
        const evaluationsDone = (typeof total === 'number' && total > 0)
          ? Math.min(doneEvalIds.size, total)
          : doneEvalIds.size;
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
      persistJobs();
      // Rotating diagnostic log: one record per run, captures tool-calls (incl.
      // any `Subagent:` fan-out) + pressure warning. Best-effort, never throws.
      logAgentRun({
        ts: new Date().toISOString(),
        mode,
        status: ok ? 'done' : 'error',
        turns: job.turns,
        cost: job.cost,
        model: job.evalModel || null,
        billedTo: job.billedTo || null,
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
    progressTotal: mode === 'pipeline' ? evalBatchSize(effectivePower(target, mode)) : (mode === 'deep' ? 1 : null), evaluationsDone: 0 });
  persistJobs();   // capture the running record immediately so a restart can mark it interrupted
  const before = probeArtifacts(mode);
  const res = await runClaudeAgent(jobId, mode, target);
  // Only claim work when the artifact grew. `before === null` means we have no
  // probe for this mode, so fall back to trusting the exit code rather than
  // inventing a failure.
  const wroteSomething = before === null || (probeArtifacts(mode) ?? 0) > before;

  if (res.ok && !wroteSomething && AGENT_ARTIFACTS[mode]) {
    const job = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, {
      ...job,
      summary: `No ${AGENT_ARTIFACTS[mode].noun} were written this run.`,
      warning: job.warning || WROTE_NOTHING_WHY,
    });
  }

  // Evaluate writes tracker TSVs; folding them into applications.md is the
  // separate Merge Tracker step. Point the user at it so a written-but-not-yet-
  // merged result doesn't read as "nothing happened".
  if (mode === 'pipeline' && res.ok && wroteSomething) {
    const job = agentJobs.get(jobId) || {};
    const note = 'Evaluations written. Run Merge Tracker to add them to your pipeline.';
    agentJobs.set(jobId, { ...job, summary: job.summary ? `${job.summary} · ${note}` : note });
  }
  if (mode === 'triage' && res.ok && wroteSomething) {
    const job = agentJobs.get(jobId) || {};
    const note = 'Triage scored. Open the triage cards to deep-dive the ones worth a full report.';
    agentJobs.set(jobId, { ...job, summary: job.summary ? `${job.summary} · ${note}` : note });
  }
  // Deep dive auto-promotes: fold the new eval into applications.md right away
  // so the triage row flips to a real Evaluated entry in one click (no separate
  // Merge step). Falls back to the manual-merge note if merge-tracker fails.
  // `wroteSomething` gates this too: with no new TSV there is nothing to merge,
  // and running merge-tracker anyway would report "complete and merged" over an
  // evaluation that was never written.
  if (mode === 'deep' && res.ok && wroteSomething) {
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
      if (/[\x00-\x1f]/.test(url) || !/^https?:\/\/[^\s]+$/i.test(url)) {
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
  // Power runs (pipeline + deep) route the eval through the user's API key when one
  // is present: bigger/parallel batch off the flat plan quota. An optional model
  // override drives the Opus "deep mode" toggle. Scan/triage stay plan-side (cheap).
  if (mode === 'pipeline' || mode === 'deep') {
    const power = !!(req.body && req.body.power);
    const model = String((req.body && req.body.model) || '').trim();
    target = { ...(target || {}), power, model: model || undefined };
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

// GET /api/agent/active — running or interrupted jobs, newest first. A freshly
// loaded client uses this to re-attach to a run still in flight (resume polling)
// or surface one the server marked interrupted after a restart, instead of
// showing an idle step with no memory of the run.
router.get('/api/agent/active', (req, res) => {
  const out = [];
  for (const [jobId, job] of agentJobs.entries()) {
    if (job.status !== 'running' && job.status !== 'interrupted') continue;
    out.push({
      jobId, mode: job.mode, status: job.status,
      evaluationsDone: job.evaluationsDone, progressTotal: job.progressTotal,
      error: job.error, summary: job.summary, activity: job.activity,
      toolCount: job.toolCount, startedAt: job.startedAt,
      billedTo: job.billedTo, batch: job.batch,
    });
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  res.json(out);
});


// GET /api/agent/cost-history — recent real per-run costs, read from the
// rotating logs/agent-runs.*.log files (written by agent-log.mjs). Powers the
// "recent actual runs" table in the Models & Cost settings, so the user sees
// what runs really cost (from the CLI's total_cost_usd) next to the estimates.
router.get('/api/agent/cost-history', (req, res) => {
  const dir = path.join(ROOT_DIR, 'logs');
  const out = [];
  try {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('agent-runs.') && f.endsWith('.log'));
    for (const f of files) {
      let text = '';
      try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec && typeof rec.cost === 'number') {
          out.push({ ts: rec.ts, mode: rec.mode, cost: rec.cost, model: rec.model || null, billedTo: rec.billedTo || null, turns: rec.turns ?? null });
        }
      }
    }
  } catch { /* no logs yet — return empty */ }
  out.sort((a, b) => String(b.ts).localeCompare(String(a.ts)));
  res.json(out.slice(0, 20));
});

export { agentJobs };

