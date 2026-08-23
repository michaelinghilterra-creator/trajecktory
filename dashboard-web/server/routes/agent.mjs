import express from 'express';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR, DATA_DIR, APPS_MD } from '../config.mjs';
import { reconcileHandled } from '../../../lib/pipeline.mjs';
import { reconcileTriageResults } from '../../../lib/reconcile-triage.mjs';
import { parseTriageOutput, appendTriageResults, START_MARKER, END_MARKER } from '../../../lib/triage-results.mjs';
import { parsePortalAdditions, mergePortalAdditions, START_MARKER as PORTAL_START, END_MARKER as PORTAL_END } from '../../../lib/portal-additions.mjs';
import { scanDiscoveryStalled } from '../../../lib/scan-stall.mjs';
import { logAgentRun, readAgentRuns, rollupByDay, sumRollup } from '../lib/agent-log.mjs';
import { apiKeyActive } from '../lib/anthropic.mjs';
import { resolveModelId } from '../lib/pricing.mjs';
import { checkWorkspaceTrust } from '../lib/workspace-trust.mjs';
import { record as recordActivation } from '../lib/activation.mjs';
import { issueJd } from '../../../next-jd.mjs';

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
// Shown ONLY when a run actually stopped early (errored) with a pressure signal.
// Deliberately does NOT say "usage limit": the regex also matches a transient 529
// `overloaded_error` (Anthropic's servers briefly busy — nothing to do with the
// user's quota), so a run at 2% of the window was tripping a scary limit message.
// A run that COMPLETES never shows this now, even if a blip was seen mid-run — the
// blip becomes the diagnostic `sawPressure` flag (logged), and the real outcome
// (WROTE_NOTHING_WHY / the agent's own summary) is what the user sees.
const PRESSURE_WARNING = 'Anthropic returned a transient rate-limit or overload signal and the run stopped early. Wait a moment and retry.';

// Dashboard-driven runs share ONE Claude subscription, so they must stay inline
// (no subagent fan-out — that is what trips usage limits) and headless (no
// Playwright). These constraints are appended to the slash command; the mode
// still routes normally. Kept to a SINGLE line on purpose — the Windows cmd
// shell mangles multi-line quoted args.
// The per-run Evaluate batch size: a small test cap (TJK_TEST_LIMIT) wins if set,
// else TJK_EVAL_BATCH (default 5). Shared by the eval constraint and the progress
// meter (it is the denominator for "Evaluated X of Y").
// SINGLE-RAIL BILLING. The billing toggle (TJK_BILLING_MODE) picks the rail and
// the ENTIRE workflow bills it. apiKeyActive() (a key is saved AND billing = key)
// is the one switch: when true, every `claude -p` spawn KEEPS the key and bills it
// (Claude Code bills the key whenever it sees it); when false, every spawn strips
// the key and runs on the flat Claude plan. That key-strip lives at the spawn (see
// `billsKey` in runClaudeAgent), so it covers ALL modes — Triage and Agent Scan
// included — not just the Evaluate paths.
//
// effectivePower is the NARROWER question of the key rail's THROUGHPUT boost (a
// bigger Evaluate batch + bounded parallelism), which only applies to the full
// Evaluate paths (pipeline / deep). It is not a separate billing axis: there is no
// per-run "power" toggle any more, the rail decides.
function effectivePower(opts, mode) {
  if (mode !== 'pipeline' && mode !== 'deep') return false;
  return apiKeyActive();
}
function evalBatchSize(power) {
  const limit = parseInt(process.env.TJK_TEST_LIMIT, 10) || 0;
  if (limit > 0) return limit;
  if (power) return parseInt(process.env.TJK_EVAL_BATCH_KEY, 10) || 10;
  return parseInt(process.env.TJK_EVAL_BATCH, 10) || 5;
}

// How many pending postings are actually queued for evaluation: the unchecked
// "- [ ]" lines in data/pipeline.md. The eval agent takes its work from exactly
// these, best-fit first. Returns null (not 0) when the file cannot be read, so
// callers can tell "no pending" from "unknown".
function countPipelinePending() {
  try {
    const txt = fs.readFileSync(path.join(ROOT_DIR, 'data/pipeline.md'), 'utf8');
    // Only rows the eval can actually read: an http(s) posting or a local:jds/
    // snapshot. A bare "- [ ]" with garbage (a broken $file url) is not evaluable
    // and must not inflate the meter denominator or keep a rolling chain alive.
    // Keep in sync with /api/pipeline/pending in routes/workflow.mjs.
    const m = txt.match(/^\s*-\s*\[ \]\s+(?:https?:\/\/|local:)/gm);
    return m ? m.length : 0;
  } catch { return null; }
}

// The Evaluate meter's denominator. It must be the number of postings the run
// will REALLY attempt — min(batch cap, pending) — not the raw cap. Showing the
// cap made "0 of 8" appear when only 3 URLs were pending, so the denominator
// never tied off with what the run produced. A number the user cannot reconcile
// reads as the tool lying, even when every posting was handled correctly. Fall
// back to the cap only when the pipeline is unreadable.
function pipelineEvalTotal(power) {
  const cap = evalBatchSize(power);
  const pending = countPipelinePending();
  return pending === null ? cap : Math.min(cap, pending);
}

// ── Rolling Evaluate (Slice 7.1) ──────────────────────────────────────────────
// One click, then walk away: after a clean pipeline batch that still leaves
// pending work, the SAME job auto-continues into the next batch until the queue
// drains, a session cap is reached, or Stop is pressed. The chain is sequential
// (one batch at a time), so it lives inside the existing single-flight lock and
// needs no lock rework — the job simply stays 'running' across every batch.
// TJK_EVAL_ROLL_MAX bounds total evaluations per chain (the hard cap that keeps a
// bug from over-running); set it to 1 to effectively disable rolling (one batch).
function rollMax() {
  const n = parseInt(process.env.TJK_EVAL_ROLL_MAX, 10);
  return Number.isFinite(n) && n > 0 ? n : 60;
}
// Stop control: the roll/stop endpoint sets this; rollPipeline checks it before
// starting each next batch (it cannot interrupt a batch already in flight). Reset
// at the start of every new pipeline chain.
let rollingStop = false;

// Self-heal the pending queue after a batch: check off any pipeline row already
// evaluated, dismissed, staged, deferred to needs-manual, or triage-scored, so
// the next batch sees real remaining work instead of re-evaluating the same
// top-of-queue rows. Both passes are best-effort and idempotent; a reconcile
// failure never breaks a run. Called between rolling batches AND once in the
// post-run block, so it is the single reconcile implementation for this route.
function reconcilePipelineQueue() {
  try {
    reconcileHandled(path.join(DATA_DIR, 'pipeline.md'), {
      appsPath: APPS_MD,
      dismissedPath: path.join(DATA_DIR, 'triage-dismissed.tsv'),
      additionsDir: path.join(ROOT_DIR, 'batch/tracker-additions'),
      needsManualPath: path.join(DATA_DIR, 'needs-manual-jd.tsv'),
      rootDir: ROOT_DIR,
      apply: true,
    });
  } catch { /* never break a run on reconcile */ }
  try {
    reconcileTriageResults(path.join(DATA_DIR, 'pipeline.md'), {
      triageResultsPath: path.join(DATA_DIR, 'triage-results.tsv'),
      appsPath: APPS_MD,
      apply: true,
    });
  } catch { /* never break a run on reconcile */ }
}

function clampedDone(jobId) {
  return (agentJobs.get(jobId) || {}).evaluationsDone || 0;
}
function batchCost(jobId) {
  const c = (agentJobs.get(jobId) || {}).cost;
  return Number.isFinite(c) ? c : 0;
}

// ── Bounded per-batch retry (Slice 7.6) ───────────────────────────────────────
// How many times a single transiently-failed batch may be retried before the
// chain gives up. Default 1; TJK_EVAL_BATCH_RETRIES overrides. 0 disables.
function batchRetries() {
  const n = parseInt(process.env.TJK_EVAL_BATCH_RETRIES, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}
// A failed batch is worth retrying only if the failure looks transient (a CLI
// rate-limit/overload blip, a dropped process). A deterministic failure — an
// untrusted workspace, a missing CLI, a hard billing/credit error — will fail
// identically on retry and must NOT be retried (it would burn quota re-hitting a
// wall). Fail toward NOT retrying when the error clearly names one of those.
function batchRetryable(jobId, res) {
  if (res && res.ok) return false;
  const job = agentJobs.get(jobId) || {};
  if (job.needsTrust) return false;                                   // trust is deterministic
  const e = String((res && res.error) || '').toLowerCase();
  if (/not found|not recognized|command not found|on your path/.test(e)) return false;  // CLI missing
  if (/credit|billing|payment|insufficient|quota exceeded|invalid api key|authentication/.test(e)) return false; // hard account error
  return true;                                                        // otherwise treat as transient
}
// Retry ONE batch after a transient failure. Reconciles BEFORE each retry so the
// retry resumes from what the failed attempt already finished (checkpoint) rather
// than re-evaluating and duplicating it — the durable `- [ ]` state is the
// checkpoint. Stops early if reconcile shows the queue already drained (the batch
// wrote everything, then hiccuped). Returns the latest result.
async function retryBatch(jobId, target, res) {
  const max = batchRetries();
  for (let attempt = 1; !res.ok && attempt <= max && batchRetryable(jobId, res); attempt++) {
    reconcilePipelineQueue();                             // checkpoint what the failed attempt finished
    if (!(countPipelinePending() > 0)) break;             // nothing left → let the caller see it drained
    const j = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, { ...j, status: 'running', activity: `Batch failed — retrying (${attempt}/${max})…`, error: undefined, rollRetries: (j.rollRetries || 0) + 1 });
    res = await runClaudeAgent(jobId, 'pipeline', target);
  }
  return res;
}

// Continue a pipeline run into further batches within the same job. `firstRes` is
// the result of the first (already-run) batch; returns the LAST batch's result so
// the caller's post-run block reports on the whole chain. Terminates on: a batch
// error, Stop, an empty/unreadable queue, the session cap, or the queue failing
// to shrink between batches (a stall guard so unreadable rows cannot loop forever).
// Threads whole-chain telemetry onto the job (7.2): rollTotal (evals across all
// batches), rollCost (summed CLI cost), rollPending (rows still queued after the
// last reconcile), and rollEndReason so the meter shows chain progress and names
// why the chain stopped rather than resetting per batch or freezing on a bar.
async function rollPipeline(jobId, target, firstRes) {
  const cap = rollMax();
  // 7.6: give even the first batch a bounded retry on a transient failure, so a
  // one-off CLI blip doesn't lose the whole run before the chain starts.
  let res = await retryBatch(jobId, target, firstRes);
  let rollTotal = clampedDone(jobId);
  let rollCost = batchCost(jobId);
  let batches = 1;
  const mark = (patch) => { const j = agentJobs.get(jobId) || {}; agentJobs.set(jobId, { ...j, ...patch }); };
  mark({ rolling: true, rollCap: cap, rollBatches: batches, rollTotal, rollCost });

  let lastPending = null;
  let endReason = 'drained';
  while (true) {
    if (rollingStop) { endReason = 'stopped'; mark({ rollStopped: true }); break; }
    // Reconcile FIRST, then judge. If the queue drained we are done even if the
    // batch's exit was an error (it wrote everything, then hiccuped) — checkpoint
    // over exit code. Only a failure that ALSO left work behind stops the chain.
    reconcilePipelineQueue();
    const pending = countPipelinePending();
    mark({ rollPending: pending == null ? undefined : pending });
    if (pending === null || pending <= 0) { endReason = 'drained'; break; }
    if (!res.ok) { endReason = 'error'; break; }         // failed AND work remains → stop (retries already spent)
    if (rollTotal >= cap) { endReason = 'capped'; mark({ rollCapped: true }); break; }
    if (lastPending !== null && pending >= lastPending) { endReason = 'stall'; break; }  // last batch advanced nothing
    lastPending = pending;

    // Next batch, same job. Set status back to 'running' (the batch that just
    // closed flipped it to 'done') and reset the per-batch meter. This runs with
    // NO await before the next spawn, so the single-flight window never opens.
    batches += 1;
    const power = effectivePower(target, 'pipeline');
    mark({ status: 'running', rollBatches: batches, progressTotal: pipelineEvalTotal(power), evaluationsDone: 0, activity: `Rolling batch ${batches}…`, error: undefined, summary: undefined });
    res = await runClaudeAgent(jobId, 'pipeline', target);
    res = await retryBatch(jobId, target, res);          // 7.6: bounded retry on a transient batch failure
    rollTotal += clampedDone(jobId);
    rollCost += batchCost(jobId);
    mark({ rollTotal, rollCost });
  }
  mark({ rolling: false, rollEndReason: endReason });
  return res;
}

// Reserve report numbers SERVER-SIDE and hand them to the eval agent in the
// prompt, so the agent never needs `Bash(node next-jd.mjs)`. Numbering used to
// be the ONLY Bash allowance the sandbox granted, which kept the door open for a
// prompt-injected posting to reach a broad Bash(node *) allow (from a local
// settings.local.json) and run `node -e`. issueJd() is imported straight from
// next-jd.mjs and advances the SAME persistent monotonic counter, so numbers are
// still unique and never reused. Numbers reserved but not used (the agent wrote
// fewer reports than the batch cap) simply leave a gap — harmless, since the
// counter only ever moves forward. Returns padded 3-wide strings to match the
// {###}-{slug}-{date}.md report filename convention.
function reserveReportNumbers(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(String(issueJd()).padStart(3, '0'));
  return out;
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
    '(create the jds/ directory if needed) and put that relative path in the report frontmatter under the jdSnapshot key.' +
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
    // Pre-reserve one report number per posting this run will really attempt
    // (min of the batch cap and the pending count), so the agent numbers reports
    // from this list instead of shelling out to next-jd.mjs.
    const reserved = reserveReportNumbers(pipelineEvalTotal(power));
    const reservedLine = reserved.length
      ? ` Report numbers are PRE-RESERVED for this run: ${reserved.join(', ')}. Use them IN ORDER, one per report you write — as both the report filename number ({num}-{slug}-{date}.md) and the matching tracker id in your TSV. Do NOT run node next-jd.mjs; numbering is handled for you here. If you write fewer reports than numbers listed, leave the extras unused.`
      : '';
    return ' ' + common + reservedLine +
      ' Evaluate only the URLs already pending in data/pipeline.md and do not scan for new roles.' +
      ` Evaluate at most ${evalCap} pending unchecked URLs this run (${capWhy}). They are ordered best-fit first, so take them from the TOP of the pending list; once you have evaluated ${evalCap}, STOP even if more remain and tell me how many pending URLs are left so I can run Evaluate again for the next batch.` +
      ' Do not run gate-pipeline.mjs or any browser tool; just evaluate the pending unchecked URLs as they are. To read each job description, your FIRST step is to run node fetch-jd.mjs from the repo root, passing the posting URL as its only argument (quote the URL in your own shell). it returns the full JD straight from the ATS API (Ashby, Greenhouse, Lever) and works where WebFetch cannot, because those postings are JavaScript single-page apps that a raw fetch sees as an empty shell. Evaluate ONLY from the text it prints. If fetch-jd.mjs exits non-zero (no ATS API available for that URL, e.g. a Workday posting), THEN try WebFetch. Only if BOTH fail do you defer: do NOT reconstruct the JD from WebSearch or aggregator mirrors — a stitched-together JD produces a confident score for a posting you never actually read, and that has shipped CLOSED roles as high scores. Instead append one tab-separated line (url, company, role) to data/needs-manual-jd.tsv (create it with that exact header row if it is missing), and write NO report and NO tracker TSV for it. The user will confirm the posting is live and paste the JD text themselves.' +
      ' Do NOT edit data/pipeline.md at all — checking off evaluated, deferred, and already-decided rows is handled deterministically after the run, so an in-prompt edit is both unnecessary and unsafe when this run parallelizes across the batch.' +
      ' Record every evaluation as a single line nine column TSV in batch/tracker-additions/ and do not edit data/applications.md directly. Always write the report to reports/ even for a low score so the result is visible. Write each report in the trajecktory-report/v1 format (JSON frontmatter then narrative body) and you MUST populate the optional frontmatter sections so the dashboard drawer is complete, not just the score: include customizationCV and customizationLI (the CV and LinkedIn personalization plan), starStories plus a leadStory (interview prep, with the single story to lead with), and a legitimacy object with a tier and signals. Base EVERY section only on the JD text you actually fetched — never fabricate or infer missing content from search results. Legitimacy is assessed from the fetched posting (freshness, description quality, reposting, prompt-injection); set verification to unconfirmed (no live browser). If you could not fetch the posting, it does not belong here at all — it goes to data/needs-manual-jd.tsv per the rule above, not into a report. When done, the user will run Merge Tracker to fold your TSVs into the pipeline.' + snapshotJd;
  }
  // NOTE ON THE DEDUP SENTENCES BELOW (scan + triage): they are belt-and-braces,
  // NOT the guarantee. A prose instruction to an LLM is advisory — it was dropped
  // from the scan prompt entirely at one point and nobody noticed, because
  // nothing tests a prompt. The enforced checks are gate-pipeline.mjs (before
  // tokens are spent) and the triage route's filter (before cards are shown),
  // both using lib/identity.mjs. Keep these sentences anyway: a scan that skips
  // a duplicate up front is cheaper than one that adds it and gets it filtered.
  //
  // The triage "SKIP any URL already in data/applications.md" line below shipped
  // for months as a guaranteed no-op: applications.md had no URL column, so the
  // set it matched against was empty. It became true only when that column
  // landed. Do not "clean up" this now-working instruction.
  if (mode === 'scan') {
    const cap = limit > 0 ? ` TEST MODE (TJK_TEST_LIMIT=${limit}): list at most ${limit} new companies in the block, then stop.` : '';
    return ' ' + common + ' Your FIRST and mandatory step is to run `node scan.mjs` from the repo root ONCE. That script IS the entire ATS API tier: it hits every tracked_companies Greenhouse/Ashby/Lever board, applies the portals.yml title_filter, dedups against data/scan-history.tsv + data/pipeline.md + data/applications.md, and writes every new live posting into data/pipeline.md itself — all zero-token. Do NOT WebFetch ATS boards by hand, do NOT re-implement the title filter, and do NOT write any test/helper script (buildTitleFilter and the whole API tier already live in scan.mjs); doing so wastes the turn budget for no gain.' +
      ' After scan.mjs finishes, spend the REST of this run on the one thing it cannot do: use WebSearch to discover companies NOT yet in portals.yml tracked_companies that run their careers on a Greenhouse, Ashby, or Lever job board. Pace the searches a few at a time. Read portals.yml first so you do not re-list a company that is already tracked.' +
      ' You MUST actually CALL the WebSearch tool to run these searches — issue at least 6 WebSearch queries this run. Do NOT print, echo, or describe a search in prose (e.g. a Bash echo "performing discovery searches…") as a stand-in for calling the tool: narration is not a search, and a run that announces searching without issuing a real WebSearch call is a FAILED run, not a completed one. Call WebSearch directly.' +
      ' Do NOT edit portals.yml, and do NOT add anything to data/pipeline.md yourself — you cannot write portals.yml here (it is intentionally read-only to this run), and a role you found only through WebSearch has not actually been read, so adding it would file a guessed posting. Instead, hand the companies to the dashboard as structured data and let it do the writing: for each genuinely new company, output ONE JSON object with exactly three keys — "name" (the company display name), "ats" (one of "greenhouse", "ashby", or "lever"), and "slug" (the board identifier, i.e. the path segment right after the ATS host: jobs.ashbyhq.com/<slug>, jobs.lever.co/<slug>, or job-boards.greenhouse.io/<slug>). Do NOT include a URL, careers_url, or api field — the dashboard builds those from ats+slug itself, verifies the board is live, adds the new companies to portals.yml, and then scans their real boards for live matching roles. Only list a company whose board slug you actually saw in a real ATS URL; never guess a slug.' +
      ` Emit the companies as a single valid JSON array between these two exact marker lines, each marker alone on its own line, standard double-quote JSON, no markdown code fence:` +
      ` ${PORTAL_START}` +
      ` ${PORTAL_END}` +
      ` Put this block FIRST in your final response, before any prose summary, so a long summary cannot push it past the response length limit and truncate it. If you found no genuinely new companies, still emit the two markers with an empty array [] between them so the run records cleanly. Skip the Playwright tier entirely.` + cap;
  }
  if (mode === 'triage') {
    const tcap = parseInt(process.env.TJK_TRIAGE_MAX, 10) || 15;
    const n = limit > 0 ? Math.min(limit, tcap) : tcap;
    return ' ' + common + ` Triage only — do NOT run a full evaluation. Score the TOP ${n} unchecked URLs from the top of data/pipeline.md (they are ordered best-fit first). Before scoring, SKIP any URL that already appears in data/applications.md (it already has an evaluation), in data/triage-dismissed.tsv (the user dismissed it), OR in data/triage-results.tsv (a PRIOR triage run already scored it), and take the next unchecked URLs instead, so you never re-triage a role that is already evaluated, dismissed, or scored. For each URL that survives that filter, read the JD: if the row is a local:jds/<file> snapshot path (not an http(s) URL), read that file DIRECTLY with the Read tool and do NOT WebFetch it, resolving the path relative to the repo root (your current working directory) so local:jds/foo.md means the file jds/foo.md, NOT data/jds/foo.md (the jds/ snapshot directory sits at the repo root, not beside data/pipeline.md, which merely lists the row); otherwise read the JD with WebFetch first and WebSearch as a fallback. Skip only rows you genuinely cannot read. Then give a 0.0-5.0 fit score and a one-sentence rationale using the rubric and anti-inflation calibration in the triage mode (most roles are NOT 4+; reserve 4+ for genuine strong fits on archetype AND level AND location).` +
      ` Do NOT write to data/triage-results.tsv yourself, and do NOT use Bash, Write, or Edit on it at all — the dashboard server appends your results deterministically after you finish, which is more reliable than a direct file edit across a long run. Instead, output every role you scored this run as a single valid JSON array between these two exact marker lines, each marker on its own line with nothing else on that line, and the array using standard double-quote JSON syntax (never single quotes, never a markdown code fence around it):` +
      ` ${START_MARKER}` +
      ` ${END_MARKER}` +
      ` Between those two marker lines, put one JSON object per scored role, as an array. Each object needs exactly five keys: url (the posting URL, string), company (string), title (string), score (a number from 0.0 to 5.0), and rationale (one sentence, string). Use real double-quote characters around every string, standard JSON syntax throughout.` +
      ` Put this block FIRST in your final response, before any summary or commentary — your response has a length limit, and if the block comes last a long summary can push it past that limit and cut the array off mid-write, which loses every score in the run even though you actually did the work. Write the block complete and correct, THEN add a short summary after it if you want. Omit any role you could not read rather than guessing a field. If you scored zero roles this run (everything was a duplicate or unreadable), still emit the markers with an empty array between them so the run is recorded as complete rather than ambiguous. Do NOT write a report, do NOT generate a PDF, do NOT write a tracker-additions TSV, and do NOT check off the pipeline.md checkboxes. Stop after ${n}.`;
  }
  if (mode === 'deep') {
    const tgt = (opts && opts.url) || '';
    const [num] = reserveReportNumbers(1);
    return ' ' + common + ` Report number is PRE-RESERVED for this run: ${num}. Use it as the report filename number ({num}-{slug}-{date}.md) and the matching tracker id. Do NOT run node next-jd.mjs; numbering is handled for you here.` + ` Deep evaluation of ONE posting only: ${tgt}. Read its job description with WebFetch first and WebSearch as a fallback (for a local:jds/ path, read that file directly, resolving it relative to the repo root (your current working directory) so local:jds/foo.md means the file jds/foo.md, NOT data/jds/foo.md; that snapshot begins with a "**Source URL:**" line — use that real posting URL as the URL in the report frontmatter and the tracker row, never the local: path). Produce the FULL A-G evaluation as a report in reports/ using the trajecktory-report/v1 format (JSON frontmatter then narrative) and populate every section: summary, cvMatch, gaps, levelMatch, comp, customizationCV, customizationLI, starStories with a leadStory, and a legitimacy object with a tier and signals (Playwright is unavailable here, so assess legitimacy from the fetched page and set verification to unconfirmed). Record the evaluation as a single nine-column TSV in batch/tracker-additions/. This posting was entered directly by the user (the dashboard paste box), not found by a scan, so set the tracker note to include [self-sourced]. Evaluate ONLY this one posting — do not scan for or evaluate any other URL. If it cannot be read, say so and stop.` + snapshotJd;
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
// NOTE: 'triage' is deliberately ABSENT here. It used to be file-size-probed
// like scan/pipeline/deep, but the agent no longer writes triage-results.tsv at
// all (see lib/triage-results.mjs) -- the server parses structured output from
// the agent's final response and appends deterministically. wroteSomething for
// triage is therefore computed directly from that append's real return value in
// runAgent(), not from a before/after probe.
const AGENT_ARTIFACTS = {
  scan:     { noun: 'new postings',  probe: () => fileSize('data/pipeline.md') },
  // Count staged AND merged TSVs: the dashboard auto-runs Merge right after a
  // batch, which moves TSVs from tracker-additions/ into tracker-additions/merged/.
  // Counting only the staged dir made a successful run look like it wrote nothing
  // once the auto-merge had swept the TSVs away. Summing both dirs is invariant to
  // that move, so the before/after delta reflects real evaluations either way.
  pipeline: { noun: 'evaluations',   probe: () => tsvCount('batch/tracker-additions') + tsvCount('batch/tracker-additions/merged') },
  deep:     { noun: 'evaluations',   probe: () => tsvCount('batch/tracker-additions') + tsvCount('batch/tracker-additions/merged') },
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

// The scan discovery stall (see lib/scan-stall.mjs): a precise cause the generic
// message above cannot name, because it fires BEFORE we know the outcome — the
// tell is zero WebSearch calls, not an empty result. Distinguishing it lets the
// UI say what actually happened instead of listing three unrelated maybes.
const SCAN_STALL_RETRY_WHY =
  'The discovery step issued no web search — the model stalled before searching. ' +
  'Retrying automatically on a stronger model…';
const SCAN_STALL_FAILED_WHY =
  'The discovery step issued no web search, even after an automatic retry on a ' +
  'stronger model. This is a transient model stall, not a data problem — your ' +
  'API-scanned roles are unaffected. Try Agent Scan again, or set Agent Scan to ' +
  'Sonnet in Setup → Models & cost.';

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
function runClaudeAgent(jobId, mode, target, opts = {}) {
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
    // Single-rail: this run bills the key iff a key is saved AND billing = key.
    // Governs the key-strip + billedTo below for EVERY mode (power is only the
    // eval-throughput boost, pipeline/deep only).
    const billsKey = apiKeyActive();
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
    // A caller-forced model wins over the per-mode default. Used by the scan stall
    // guard to re-run a stalled Haiku discovery on Sonnet, which does not
    // narrate-and-quit on the open-ended WebSearch step. Passes through the same
    // allow-list below, so a bad value simply falls back to the CLI default.
    if (opts.forceModel) rawModelPref = String(opts.forceModel).trim();
    // SECURITY: modelPref becomes a bare argv element and, under shell:true on
    // Windows (below), args are concatenated UNESCAPED — an attacker-supplied
    // value like `sonnet& <command>` would break out and run arbitrary commands.
    // Allow-list the model id to the known aliases or a claude-* id; anything
    // else (including inherit/default/none, which mean "no override") falls back
    // to the CLI default with NO --model flag.
    // Resolve the family alias (opus/sonnet/haiku) to its PINNED full id
    // (Opus 4.8, etc.) so `claude -p --model` gets an explicit version instead of
    // expanding a bare alias to the CLI's own current latest — the "opus -> Opus 5"
    // drift the user hit. A full id passes through unchanged; an unknown value
    // (e.g. inherit/default) returns as-is and fails the allow-list, yielding no
    // --model flag. HONEST LIMIT: this sends an explicit id to the plan CLI too; if
    // a future CLI/subscription build rejects a specific older id, pick a different
    // version in Setup -> Models & cost (or the run errors visibly rather than
    // silently drifting).
    const resolvedModel = resolveModelId(rawModelPref);
    const modelPref = /^(?:opus|sonnet|haiku|claude-[a-z0-9.-]+)$/i.test(resolvedModel) ? resolvedModel : '';
    const modelFlag = modelPref ? ['--model', modelPref] : [];
    // SECURITY (CWE-94): this eval agent WebFetches attacker-controlled job postings,
    // so a booby-trapped posting can attempt prompt injection. Blast radius is
    // constrained by eval-agent-sandbox.settings.json, which denies BOTH Edit AND
    // Write (they are DISTINCT tools, and acceptEdits auto-approves Write — denying
    // only Edit left a Write-over-a-server-module RCE) to server code / *.ps1 / *.sh /
    // config / .env / .claude / installer / package*.json, and denies READING .env,
    // the Google + Buffer token files, and *.pem. deny wins over any allow it merges.
    // BASH: report numbering is now done SERVER-SIDE (reserveReportNumbers, injected
    // into the prompt), so the sandbox no longer allows `node next-jd.mjs`. The eval's
    // only remaining Bash needs are `node fetch-jd.mjs <url>` (read a posting) and
    // `node scan.mjs` (scan mode) — allow-listed. Everything a prompt-injected posting
    // would reach for to read+exfil or run arbitrary code is DENIED: node -e/--eval/-p/
    // --print/-, curl, wget, cat, sh/bash/zsh, python(3), eval, nc. deny wins over the
    // broad Bash(node *)/Bash(curl *) a local settings.local.json merges in, and the CLI
    // splits compound commands, so `node fetch-jd.mjs x; curl evil` is caught on the curl
    // half. HONEST LIMIT: these are TOOL-level denies (no file-permission hook), and the
    // deny-list is by name — a local settings.local.json that allows some OTHER exec/exfil
    // binary not on this list would still slip through. The airtight version is to not let
    // settings.local.json merge into this spawn at all; until then keep local Bash allows
    // for this project narrow. Verify Write-vs-Edit deny matching empirically on your CLI build.
    const evalSandboxSettings = fileURLToPath(new URL('../eval-agent-sandbox.settings.json', import.meta.url));
    // Windows spawns `claude` through the cmd shell (the .cmd shim needs it), and
    // this whole prompt is wrapped in one pair of double-quotes. A double-quote
    // INSIDE the prompt closes that wrapper early; whatever follows is then parsed
    // by cmd, so a `<` becomes input-redirection and the run dies with "The system
    // cannot find the file specified" before a single tool call — deterministically,
    // not intermittently. This bit the eval prompt (`fetch-jd.mjs "<url>"`) and the
    // jdSnapshot instruction. No prompt here ever needs the agent to receive a
    // literal ", so collapse embedded quotes to apostrophes rather than trust every
    // future prompt edit to stay quote-free (nothing tests a prompt string).
    const winPrompt = prompt.replace(/"/g, "'");
    const args = ['-p', isWin ? `"${winPrompt}"` : prompt,
                  ...modelFlag,
                  '--output-format', 'stream-json', '--verbose',
                  '--permission-mode', 'acceptEdits',
                  '--settings', isWin ? `"${evalSandboxSettings}"` : evalSandboxSettings];

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

    // billedTo reflects the RAIL this run actually bills. Under single-rail billing
    // that is exactly apiKeyActive(): in key mode the key is kept in the spawn env
    // below and Claude Code bills it; in plan mode the key is stripped and the flat
    // Claude subscription is billed. `cost` (set later from the CLI) is a local
    // token estimate, not the actual API invoice.
    update({ billedTo: billsKey ? 'api' : 'plan', evalModel: modelFlag.length ? modelPref : 'default', batch: mode === 'pipeline' ? evalBatchSize(power) : undefined });

    let child;
    // SINGLE-RAIL: keep the key in the `claude -p` environment iff this run bills
    // the key (key saved AND billing = key). Claude Code bills the key whenever it
    // sees it, so keeping it is what actually moves the whole workflow — Triage and
    // Agent Scan included — onto the key. In plan mode the key is stripped, so the
    // run bills the flat Claude subscription and nothing touches the key.
    const claudeEnv = { ...process.env };
    if (!billsKey) delete claudeEnv.ANTHROPIC_API_KEY;
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
      // Record it as a diagnostic flag, NOT a user-facing warning: a transient blip
      // during a run that then completes fine must not surface as "usage limit".
      // The close handler promotes this to PRESSURE_WARNING only if the run errored.
      if (PRESSURE_RE.test(text)) patch.sawPressure = true;
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
        // Count WebSearch calls SEPARATELY from toolCalls, which is sliced to the
        // last 50 for display — a 59-turn scan would drop its early searches from
        // that window, so a count derived from it would undercount. This is the
        // discriminator the scan stall guard reads (see scanDiscoveryStalled): a
        // scan that issued zero searches narrated-and-quit; one that searched and
        // found nothing did honest work.
        let webSearchCount = job.webSearchCount || 0;
        let activity = job.activity;
        for (const block of ev.message.content) {
          if (block.type === 'text' && block.text) {
            activity = block.text.trim().split('\n')[0].slice(0, 160);
          } else if (block.type === 'tool_use') {
            const s = summarizeToolUse(block);
            toolCalls.push(s);
            toolCount += 1;
            if (block.name === 'WebSearch') webSearchCount += 1;
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
        update({ toolCalls: toolCalls.slice(-50), toolCount, webSearchCount, evaluationsDone, activity });
        return;
      }
      if (ev.type === 'result') {
        resultText = (ev.result != null ? ev.result : (ev.subtype || '')).toString();
        isError = !!ev.is_error || ev.subtype === 'error_max_turns' || ev.subtype === 'error_during_execution';
        // The CLI's result event carries the run's real wall-clock time
        // (duration_ms) and the portion spent in Anthropic API calls
        // (duration_api_ms). Capture both so each log line records machine time
        // and the weekly post-mortem never has to estimate it from the gaps
        // between run timestamps. Coerce to a finite number or drop the field.
        const durMs = Number(ev.duration_ms);
        const durApiMs = Number(ev.duration_api_ms);
        update({
          turns: ev.num_turns,
          cost: ev.total_cost_usd,
          durationMs: Number.isFinite(durMs) ? durMs : undefined,
          durationApiMs: Number.isFinite(durApiMs) ? durApiMs : undefined,
        });
        return;
      }
      // Genuine pressure surfaces in `system` events (or stderr, handled above)
      // with precise tokens — never from assistant text or a fetched JD that
      // merely mentions "rate limiting". Do NOT scan `user`/tool_result content.
      if (ev.type === 'system' && PRESSURE_RE.test(JSON.stringify(ev))) {
        update({ sawPressure: true });
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
      // A pressure blip only becomes a user-facing warning when the run actually
      // stopped early (errored). On a clean finish it stays a silent diagnostic —
      // the run completed, so "the run stopped early" would be a lie.
      const warning = (!ok && job.sawPressure) ? PRESSURE_WARNING : job.warning;
      agentJobs.set(jobId, {
        ...job,
        status: ok ? 'done' : 'error',
        summary: ok ? (resultText ? agentTail(resultText) : (job.activity || 'Agent finished')) : undefined,
        error: ok ? undefined : err,
        warning,
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
        durationMs: job.durationMs ?? null,
        durationApiMs: job.durationApiMs ?? null,
        model: job.evalModel || null,
        billedTo: job.billedTo || null,
        warning: warning || null,
        sawPressure: job.sawPressure || false,
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

// After the server adds newly-discovered companies to portals.yml, surface their
// REAL live roles by re-running the zero-token scanner over just those boards.
// This is what makes the discovery half honest: the roles come from the actual
// ATS API (deduped, title/geo-filtered by scan.mjs), never from the agent's
// WebSearch — which invents "live" roles it never read (two phantom Director
// roles on 2026-08-10, neither on its board). One `scan.mjs --company <name>` per
// added company (small N); returns the total new offers written to pipeline.md.
function scanOneCompany(name) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(process.execPath, ['scan.mjs', '--company', name], { cwd: ROOT_DIR, windowsHide: true });
    } catch { return resolve(0); }
    if (child.stdin) { try { child.stdin.end(); } catch { /* already closed */ } }
    child.stdout && child.stdout.on('data', (c) => { out += c.toString(); });
    child.on('error', () => resolve(0));
    child.on('close', () => {
      const m = out.match(/New offers added:\s*(\d+)/);
      resolve(m ? parseInt(m[1], 10) : 0);
    });
  });
}
async function scanNewCompanies(entries) {
  let total = 0;
  for (const e of entries) total += await scanOneCompany(e.name);
  return total;
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
    progressTotal: mode === 'pipeline' ? pipelineEvalTotal(effectivePower(target, mode)) : (mode === 'deep' ? 1 : null), evaluationsDone: 0 });
  persistJobs();   // capture the running record immediately so a restart can mark it interrupted
  const before = probeArtifacts(mode);
  // Rolling Evaluate (7.1): reset the Stop flag for this new chain, run the first
  // batch, then auto-continue in the same job until the queue drains / the cap is
  // hit / Stop. res becomes the LAST batch's result so the post-run block reports
  // on the whole chain. Non-pipeline modes run exactly one batch as before.
  if (mode === 'pipeline') rollingStop = false;
  let res = await runClaudeAgent(jobId, mode, target);
  if (mode === 'pipeline') res = await rollPipeline(jobId, target, res);

  // TRIAGE: the agent never touches triage-results.tsv itself (see
  // lib/triage-results.mjs's file header for why). It emits its scores as a
  // structured JSON block in its final response; the server parses and
  // appends here, deterministically, append-only. This is computed BEFORE the
  // generic wroteSomething logic below because triage's own truth is this
  // append's real return value, not a before/after file-size probe (removed
  // from AGENT_ARTIFACTS for this mode on purpose).
  let triageAppend = null;
  let triageParseErrors = [];
  if (mode === 'triage' && res.ok) {
    try {
      const { rows, errors } = parseTriageOutput(res.result || '');
      triageParseErrors = errors;
      triageAppend = appendTriageResults(path.join(DATA_DIR, 'triage-results.tsv'), rows);
    } catch (e) {
      triageParseErrors = [`append failed: ${(e && e.message) || e}`];
      triageAppend = { appended: 0, skippedDuplicate: 0 };
    }
  }

  // SCAN discovery: the agent no longer writes portals.yml (the shared eval
  // sandbox denies it, and its WebSearch invents phantom companies/roles). It
  // emits discovered companies as a structured PORTAL_ADDITIONS block; the server
  // validates them (ATS allow-list + safe slug + live-board check), CONSTRUCTS
  // every careers_url/api from the slug so no supplied host is ever fetched, and
  // merges them deterministically — then scans those new boards for real live
  // roles. Same agent-emits-structured-output / server-writes pattern as triage.
  let portalMerge = null;
  if (mode === 'scan' && res.ok) {
    // runClaudeAgent already flipped this job to 'done'. Hold it at 'running'
    // through the server-side merge + per-company scans (the live-board checks and
    // up to a dozen scan.mjs spawns take tens of seconds): the single-flight guard
    // keys on status==='running', so a premature 'done' would let a second agent
    // run start and race this one's portals.yml/pipeline.md writes. Flipped back to
    // 'done' in the scan-summary block below. Same reasoning as deep mode's merge.
    const j0 = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, { ...j0, status: 'running', activity: 'Adding discovered companies to your scan list…' });
    // Parse the agent's PORTAL_ADDITIONS block, merge validated companies into
    // portals.yml, then scan their real boards. Reused verbatim for the retry.
    const mergeDiscovery = async (resultText) => {
      try {
        const { companies, errors } = parsePortalAdditions(resultText || '');
        const m = await mergePortalAdditions(path.join(ROOT_DIR, 'portals.yml'), companies, { today: new Date().toISOString().slice(0, 10) });
        m.parseErrors = errors;
        m.rolesAdded = m.entries.length ? await scanNewCompanies(m.entries) : 0;
        return m;
      } catch (e) {
        return { added: 0, entries: [], skippedDuplicate: 0, skippedDead: 0, collisions: [], rolesAdded: 0, error: (e && e.message) || String(e) };
      }
    };
    portalMerge = await mergeDiscovery(res.result || '');

    // STALL GUARD (the enforced half of the fix; the prompt lines are advisory).
    // A small model sometimes narrates the open-ended discovery step and ends the
    // turn without issuing a single WebSearch. scanDiscoveryStalled reads the
    // WebSearch count — zero searches AND nothing produced — to tell that apart
    // from a legitimate run that searched and found no new company. On a stall,
    // re-run the whole scan ONCE on Sonnet (which does not narrate-and-quit here).
    // scan.mjs is idempotent (re-dedups to 0 new), so re-running the full prompt
    // is safe; the extra API-tier pass is cheap next to a wasted widen.
    const searches1 = (agentJobs.get(jobId) || {}).webSearchCount || 0;
    if (scanDiscoveryStalled({ webSearchCount: searches1, added: portalMerge.added, rolesAdded: portalMerge.rolesAdded })) {
      const j1 = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...j1, status: 'running', scanStalled: true, scanRetried: true, activity: 'Discovery stalled — retrying on a stronger model…', warning: SCAN_STALL_RETRY_WHY });
      const retry = await runClaudeAgent(jobId, mode, target, { forceModel: 'sonnet' });
      if (retry.ok) {
        const j2 = agentJobs.get(jobId) || {};
        agentJobs.set(jobId, { ...j2, status: 'running', activity: 'Adding discovered companies to your scan list…' });
        portalMerge = await mergeDiscovery(retry.result || '');
      }
      // Did the retry break the stall? webSearchCount is cumulative across both
      // runClaudeAgent calls on this job, so a non-zero total means the retry did
      // search. Clear the interim warning on success; name the failure on a
      // second stall so the UI stops sending the user hunting.
      const searches2 = (agentJobs.get(jobId) || {}).webSearchCount || 0;
      const stillStalled = scanDiscoveryStalled({ webSearchCount: searches2, added: portalMerge.added, rolesAdded: portalMerge.rolesAdded });
      const j3 = agentJobs.get(jobId) || {};
      agentJobs.set(jobId, { ...j3, warning: stillStalled ? SCAN_STALL_FAILED_WHY : undefined });
    }
  }

  // Only claim work when the artifact grew. `before === null` means we have no
  // probe for this mode, so fall back to trusting the exit code rather than
  // inventing a failure. Triage is the one exception: its probe was removed,
  // so its truth is triageAppend.appended directly. Scan is a second exception:
  // growing portals.yml (more companies tracked for every future free scan) is
  // real work even when no posting lands in pipeline.md this instant, so a run
  // that added companies must not report "wrote nothing".
  const grew = before === null || (probeArtifacts(mode) ?? 0) > before;
  const wroteSomething = mode === 'triage'
    ? !!(triageAppend && triageAppend.appended > 0)
    : mode === 'scan'
      ? (grew || !!(portalMerge && (portalMerge.added > 0 || portalMerge.rolesAdded > 0)))
      : grew;

  // SELF-HEALING (the permanent fix for the recurring "queue clogged" bug): after
  // EVERY run, check off any pipeline row that is already evaluated, dismissed,
  // staged, deferred, or triage-scored. This does not depend on any single writer
  // (the LLM's in-prompt check-off, merge-tracker, the dismiss route) having
  // worked — whichever one misfired, the queue self-corrects here. Same helper the
  // rolling chain calls between batches, so there is one reconcile implementation.
  reconcilePipelineQueue();

  // Tier-B text hygiene: evaluation reports and interview prep are authored by the
  // `claude` agent SUBPROCESS, so that text never passed through the server's
  // in-process hygiene layer (dashboard-web/server/lib/text-hygiene.mjs). Clean the
  // files this mode wrote, here, after the run. Fire-and-forget, idempotent, scoped
  // by mode; a hygiene failure never affects the run. The CLI batch path is covered
  // separately by a step in CLAUDE.md's "one true batch workflow".
  try {
    const hygieneDirs = [];
    if (mode === 'pipeline' || mode === 'deep') hygieneDirs.push(path.join(ROOT_DIR, 'reports'));
    if (mode === 'interview' || mode === 'cheat-sheet' || mode === 'runsheet' || mode === 'interview-prep') {
      hygieneDirs.push(path.join(ROOT_DIR, 'interview-prep'));
    }
    for (const d of hygieneDirs) {
      const child = spawn(process.execPath, ['clean-generated-text.mjs', d, '--apply'], { cwd: ROOT_DIR, stdio: 'ignore' });
      child.on('error', () => {});   // never surface a spawn error
      child.unref();
    }
  } catch { /* hygiene is best-effort; never break a run */ }

  // Activation log: whether a run produced anything is the outcome worth
  // knowing, and the server already computed it just above. Counts and an enum
  // only — never what was found. No-ops unless the user opted in.
  if (mode === 'scan' || mode === 'pipeline' || mode === 'deep') {
    const job = agentJobs.get(jobId) || {};
    recordActivation(mode === 'scan' ? 'scan_finished' : 'evaluate_finished', {
      // For a rolling chain the meaningful count is the whole-chain total, not the
      // last batch's per-batch count.
      count: job.rollTotal != null ? job.rollTotal : job.evaluationsDone,
      detail: !res.ok ? 'error' : (wroteSomething ? 'ok' : 'empty'),
    });
  }

  // Triage gets its own summary, separate from the generic AGENT_ARTIFACTS
  // path below (which no longer covers 'triage' — see the note where it's
  // defined): the real, honest count is triageAppend's return value, not a
  // guess from file size, and it's worth surfacing skippedDuplicate and any
  // parse errors too so a run that silently produced nothing usable is visible
  // instead of looking identical to a run that scored zero *new* roles.
  if (mode === 'triage' && res.ok) {
    const job = agentJobs.get(jobId) || {};
    if (wroteSomething) {
      const dupNote = triageAppend.skippedDuplicate ? ` (${triageAppend.skippedDuplicate} already scored, skipped)` : '';
      agentJobs.set(jobId, { ...job, summary: `${job.summary ? job.summary + ' · ' : ''}Triage appended ${triageAppend.appended} score${triageAppend.appended === 1 ? '' : 's'}${dupNote}.` });
    } else {
      const why = triageParseErrors.length
        ? `Could not persist any scores: ${triageParseErrors.slice(0, 3).join('; ')}${triageParseErrors.length > 3 ? '…' : ''}`
        : (triageAppend && triageAppend.skippedDuplicate
          ? `All ${triageAppend.skippedDuplicate} scored role(s) this run were already in triage-results.tsv.`
          : 'No triage scores were produced this run.');
      agentJobs.set(jobId, { ...job, summary: why, warning: job.warning || WROTE_NOTHING_WHY });
    }
  }

  if (res.ok && !wroteSomething && AGENT_ARTIFACTS[mode]) {
    const job = agentJobs.get(jobId) || {};
    agentJobs.set(jobId, {
      ...job,
      summary: `No ${AGENT_ARTIFACTS[mode].noun} were written this run.`,
      warning: job.warning || WROTE_NOTHING_WHY,
    });
  }

  // Scan discovery summary: report what the server did with the agent's
  // PORTAL_ADDITIONS block — companies added, real roles surfaced from their
  // boards, and every candidate that was skipped and WHY (already tracked, dead
  // board, or a name-collision only a human can resolve). Runs after the generic
  // empty-summary block so it can either replace it (something was added) or
  // append the "why nothing landed" detail onto it (nothing was).
  if (mode === 'scan' && res.ok && portalMerge) {
    const job = agentJobs.get(jobId) || {};
    const wins = [];
    if (portalMerge.added) wins.push(`${portalMerge.added} new compan${portalMerge.added === 1 ? 'y' : 'ies'} added to your scan list`);
    if (portalMerge.rolesAdded) wins.push(`${portalMerge.rolesAdded} live role${portalMerge.rolesAdded === 1 ? '' : 's'} added to your pipeline`);
    const skips = [];
    if (portalMerge.skippedDuplicate) skips.push(`${portalMerge.skippedDuplicate} already tracked`);
    if (portalMerge.skippedDead) skips.push(`${portalMerge.skippedDead} unreachable board${portalMerge.skippedDead === 1 ? '' : 's'} skipped`);
    if (portalMerge.collisions && portalMerge.collisions.length) skips.push(`${portalMerge.collisions.length} name-collision${portalMerge.collisions.length === 1 ? '' : 's'} left for you to check`);
    let line = wins.join(' · ');
    if (skips.length) line += `${line ? ' ' : ''}(${skips.join(', ')})`;
    const summary = line ? (job.summary ? `${job.summary} · ${line}` : line) : job.summary;
    // Flip back to 'done' (the merge block held it at 'running' so the single-
    // flight guard covered the server-side write). finishedAt marks the true end.
    agentJobs.set(jobId, { ...job, status: 'done', summary, finishedAt: Date.now() });
    persistJobs();
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
      //
      // A "local:jds/<slug>.md" snapshot path is ALSO a valid target: resolve-jds
      // writes these for SPA-hosted postings and triage records them, so a Deep dive
      // on such a card arrives here as "local:jds/acme-vp-revops.md". The deep
      // prompt reads a local:jds/ path directly (and the paste path constructs the
      // same shape at line ~740), so accept it. Constrained to a FLAT filename
      // (no "/" after jds/, so no "../" traversal) of safe slug chars ending in .md.
      const isHttp = /^https?:\/\/[^\s]+$/i.test(url);
      const isLocalJd = /^local:jds\/[A-Za-z0-9._-]+\.md$/.test(url);
      if (/["`]/.test(url)) {
        return res.status(400).json({ error: 'Provide a valid http(s) URL or local:jds/ path (no quote or backtick characters).' });
      }
      if (/[\x00-\x1f]/.test(url) || (!isHttp && !isLocalJd)) {
        return res.status(400).json({ error: 'Provide a valid http(s) URL or a local:jds/ path.' });
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

// POST /api/agent/roll/stop — stop the rolling Evaluate chain after the current
// batch. It cannot interrupt a batch already in flight (there is no safe way to
// kill `claude -p` mid-eval here), so it clears the rolling flag and the chain
// ends once the running batch closes. Idempotent: fine to call when nothing rolls.
router.post('/api/agent/roll/stop', (req, res) => {
  rollingStop = true;
  res.json({ ok: true, stopping: true });
});

// GET /api/agent/roll-config — the rolling cap and whether a chain is active now.
// The spend gate reads rollMax to price the whole walk-away run (up to the cap),
// not just one batch; the UI reads `active` to show a Stop control.
router.get('/api/agent/roll-config', (req, res) => {
  let active = false;
  for (const job of agentJobs.values()) {
    if (job.mode === 'pipeline' && job.status === 'running' && job.rolling) { active = true; break; }
  }
  res.json({ rollMax: rollMax(), batch: evalBatchSize(apiKeyActive()), active });
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
      rolling: job.rolling, rollTotal: job.rollTotal, rollBatches: job.rollBatches, rollCap: job.rollCap,
      rollCost: job.rollCost, rollPending: job.rollPending, rollEndReason: job.rollEndReason, cost: job.cost,
      rollRetries: job.rollRetries,
    });
  }
  out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  res.json(out);
});


// GET /api/agent/cost-history — recent real per-run costs, read from the
// rotating logs/agent-runs.*.log files (via agent-log.mjs, the single reader).
// Powers the "recent actual runs" table in the Models & Cost settings, so the
// user sees what runs really cost (from the CLI's total_cost_usd) next to the
// estimates.
//
// ?groupBy=day switches to the per-day cost/machine-time rollup that the weekly
// post-mortem reads: { days: [...], total, from, to }, one day per bucket with
// cost, machine time (wall + API), run count, and a per-mode split. Optional
// inclusive `from`/`to` (YYYY-MM-DD) scope it to a week or any range. This is the
// one lookup that replaces hand-parsing the logs for the post-mortem's numbers.
router.get('/api/agent/cost-history', (req, res) => {
  const records = readAgentRuns();

  if (String(req.query.groupBy || '') === 'day') {
    const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : undefined);
    const from = iso(req.query.from);
    const to = iso(req.query.to);
    const days = rollupByDay(records, { from, to });
    res.json({ days, total: sumRollup(days), from: from || null, to: to || null });
    return;
  }

  const out = [];
  for (const rec of records) {
    if (rec && typeof rec.cost === 'number') {
      out.push({
        ts: rec.ts, mode: rec.mode, cost: rec.cost,
        model: rec.model || null, billedTo: rec.billedTo || null,
        turns: rec.turns ?? null, durationMs: rec.durationMs ?? null,
      });
    }
  }
  // readAgentRuns already sorts newest-first; keep the 20 most recent.
  res.json(out.slice(0, 20));
});

export { agentJobs, batchRetries, batchRetryable };

