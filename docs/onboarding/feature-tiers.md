# trajecktory feature tiers: what runs on your plan, and what a key adds

A quick high-level map of what a new user gets with just the Claude sign-in, and
what the two optional API keys add. The headline: **everything trajecktory does,
including every AI writing draft, runs on your Claude subscription by default. No
Anthropic API key is required for anything. The optional keys only add a faster path
and an extra discovery channel, nothing core.**

## The two billing paths

By default everything runs on the Claude subscription. The API key is an optional
faster path you can switch on or off without deleting it:

- **Claude subscription** (Pro/Max, via a one-time `claude login`): the rolling
  5-hour usage quota, no per-token dollar cost. By default it powers everything:
  onboarding, Agent Scan, Triage, Evaluate, and every AI writing draft (cover
  letters, CV tailoring, recruiter and TA outreach, follow-ups, LinkedIn, and the
  Insights report).
- **Anthropic API key** (optional, pasted into the dashboard): billed per token on
  your own API account. Nothing requires it. When a key is saved and billing is set
  to it, the workflow and drafts run on the key instead of the plan quota, which is
  a bit faster and unlocks the fuller "power" workflow.

You choose which path runs, and which Claude model each step uses, in Setup, under
**Models & cost** (see the next section).

## Models & cost (Setup, Launchpad, Optional boosters)

The Launchpad's Optional boosters include a **Models & cost** panel. You pick the
Claude model for each workflow step and see an approximate cost per run:

| Step | Model choices | Default |
|---|---|---|
| Triage | Haiku, Sonnet | Haiku |
| Agent Scan | Haiku, Sonnet, Opus | Haiku |
| Evaluate (batch) | Sonnet, Opus, Haiku | Sonnet |
| Insights | Sonnet, Opus | Sonnet |
| Drafts & Outreach | Haiku, Sonnet | Haiku |

The defaults are the cheaper, calibrated choices. Each option shows a rough `~$/run`
estimate, plus an "Estimated total per full run (Triage + Evaluate batch)" and a small
"Recent runs (actual cost)" table of your real recent costs. Those dollar figures apply
only to the API-key path; on the Claude plan there is no per-token cost.

A **"Bill workflow & drafts to"** toggle switches between **API key** and **Claude
plan**. Setting it to **Claude plan** routes the whole workflow plus drafts to the
flat subscription (no per-token cost) even while your key stays saved, and also uses
the leaner plan workflow. Flip it back to **API key** any time. (The old "Deep mode
(Opus)" checkbox is gone: choose Opus for Evaluate here instead, or click a per-role
**Deep dive** on a triage card for a one-off Opus run.)

Env keys behind the panel (for reference): `TJK_TRIAGE_MODEL`, `TJK_SCAN_MODEL`,
`TJK_EVAL_MODEL`, `TJK_INSIGHTS_MODEL`, `TJK_DRAFT_MODEL`, `TJK_BILLING_MODE`
(`key`/`plan`), and the batch sizes `TJK_EVAL_BATCH` (plan, default 5) /
`TJK_EVAL_BATCH_KEY` (key, default 10).

## Tier 1: out of the box (Claude sign-in only)

The installer bundles the Claude CLI; the user signs in once with their existing
Claude Pro/Max account. Everything here runs with no API key.

| Feature / section | What it does | Runs on |
|---|---|---|
| Onboarding / Launchpad setup | Parse CV, draft profile, roles, narrative, location, companies | Claude subscription (runs in your Claude Desktop, on whatever model it is set to) |
| API Scan | Finds postings from Greenhouse / Ashby / Lever job boards for your tracked companies | Pure Node, no Claude, no cost |
| Triage | Cheap first-pass scoring of your best pipeline matches, so you deep-dive only the strongest | Claude subscription, defaults to Haiku |
| Agent Scan | Web-searches the open web for new postings (Claude's WebSearch) | Claude subscription, defaults to Haiku |
| Expand Coverage (Phase 1) | Registers companies already sitting in your pipeline into your tracked list | Pure Node, no cost |
| Evaluate Pipeline | Scores each JD and writes the full report (Overview, CV Match, Comp, Interview, Customize, Legitimacy) | Claude subscription, defaults to Sonnet |
| Drafts & Outreach | Cover letters, CV tailoring, recruiter / TA / LinkedIn outreach, follow-up emails | Claude subscription by default, defaults to Haiku (API key optional) |
| Insights | A career-strategy narrative synthesized over your whole pipeline | Claude subscription by default, defaults to Sonnet |
| Liveness Gate, Merge Tracker, Verify, Health Check | Pipeline hygiene (dead-link check, dedup, validation) | Pure Node, no cost |
| All dashboard views + report drawer | Pipeline, Overview, Insights, Follow-Ups, reading reports | Pure display, no cost |

Onboarding is the heaviest one-time subscription burn, because each setup paste runs
a full Claude pass in the user's own Claude Desktop. Steady-state use (scan, triage,
evaluate) is much lighter.

**First-run scaling.** Discovery (scan) is broad and free, but Evaluate processes a
**batch per run** (5 on the plan, 10 on the API-key path) rather than every pending
posting, so a new user with hundreds of scanned roles does not burn their whole quota
at once. On the plan, Triage scores the top matches cheaply first (Haiku), and you
click **Deep dive** on the strongest to write a full Sonnet report. Change the batch
size in Models & cost or with `TJK_EVAL_BATCH` in `dashboard-web/.env`.

## Tier 2: add an Anthropic API key (optional, a faster path)

Pasted into the dashboard's **AI draft key** field (Launchpad, Optional boosters).
Billed per token on your API account, separate from the 5-hour quota. **You do not
need it:** every feature below already runs on your Claude subscription. Adding a key
(and setting billing to it in Models & cost) just runs them on the key instead, which
is a bit faster and switches the sidebar to the fuller "power" workflow (Agent Scan
plus a batch Evaluate, in place of the plan's Triage-first flow).

| Feature | What it does | Default model |
|---|---|---|
| Apply | Tailored cover letter, tailored CV content, application-form answers | Haiku |
| Follow-up drafts | Follow-up emails for stale applications | Haiku |
| Recruiter outreach | Cold-outreach emails to recruiters | Haiku |
| Target Talent outreach | Warm emails to internal TA contacts | Haiku |
| TA Reconcile | Web search to find missing TA contacts | Haiku |
| LinkedIn SSI | Comment replies and connection notes | Haiku |
| Insights | A career-strategy report synthesized over your whole pipeline | Sonnet |

(These are the Drafts & Outreach and Insights sections in Models & cost; change their
model there. The dollar estimates shown apply to this API-key path.)

## Tier 3: add a Brave (and optional Muse) key (optional)

Pasted into the dashboard's **Web discovery keys** field (Launchpad, Optional
boosters). Stored in `dashboard-web/.env`; read by Expand Coverage on its next run.

| Unlocked feature | What it does |
|---|---|
| Expand Coverage (Phase 2, Brave) | Web-searches for brand-new companies and postings to grow your tracked list |
| Expand Coverage (Phase 3, Muse) | Pulls Director / VP roles from The Muse into your pipeline |

**Discovery is not gated on these keys.** Without them, Expand Coverage still runs
(Phase 1) but does not reach the open web, so it usually reports "0 new." That is
expected, not a bug: users still get full discovery from API Scan (free) plus Agent
Scan (Claude sign-in). Brave/Muse are an extra web-sweep channel that grows the
company list automatically.

## What needs no credentials at all

API Scan, Liveness Gate, Merge Tracker, Verify, Health Check, Expand Coverage
Phase 1, every Launchpad form (identity, compensation, location, output folders),
Preflight, and all the dashboard data views run as pure Node with no Claude and no
keys. They cost nothing against either path.
