# trajecktory feature tiers: what works out of the box, what each key unlocks

A quick high-level map of what a new user gets with just the Claude sign-in, and
what the two optional API keys add. The headline: **everything needed to discover,
evaluate, and apply to jobs works with the Claude sign-in alone. The optional keys
add extra drafts and an extra discovery channel, nothing core.**

There are two separate billing buckets. They do not draw from each other:

- **Claude subscription** (Pro/Max, via a one-time `claude login`): the rolling
  5-hour usage quota. Powers onboarding, Agent Scan, and Evaluate.
- **Anthropic API key** (optional, pasted into the dashboard): billed per token on
  your API account. Powers only the draft features.

## Tier 1: out of the box (Claude sign-in only)

The installer bundles the Claude CLI; the user signs in once with their existing
Claude Pro/Max account.

| Feature / section | What it does | Runs on |
|---|---|---|
| Onboarding / Launchpad setup | Parse CV, draft profile, roles, narrative, location, companies | Claude subscription (your session model) |
| API Scan | Finds postings from Greenhouse / Ashby / Lever job boards for your tracked companies | Pure Node, no Claude, no cost |
| Agent Scan | Web-searches the open web for new postings (Claude's WebSearch) | Claude subscription |
| Expand Coverage (Phase 1) | Registers companies already sitting in your pipeline into your tracked list | Pure Node, no cost |
| Evaluate Pipeline | Scores each JD and writes the full report (Overview, CV Match, Comp, Interview, Customize, Legitimacy) | Claude subscription |
| Liveness Gate, Merge Tracker, Verify, Health Check | Pipeline hygiene (dead-link check, dedup, validation) | Pure Node, no cost |
| All dashboard views + report drawer | Pipeline, Overview, Follow-Ups, reading reports | Pure display, no cost |

Onboarding is the heaviest one-time subscription burn, because each setup paste runs
a full Claude pass in the user's own Claude Desktop. Steady-state use (scan, evaluate)
is much lighter.

## Tier 2: add an Anthropic API key (optional)

Pasted into the dashboard's **AI draft key** field (Launchpad, Optional boosters).
Billed per token on your API account, separate from the 5-hour quota. Without it,
these features show a clear "add your key to enable" message; everything in Tier 1
still works.

| Unlocked feature | What it does | Model |
|---|---|---|
| Apply | Tailored cover letter, tailored CV content, application-form answers | Haiku 4.5 |
| Follow-up drafts | Follow-up emails for stale applications | Haiku 4.5 |
| Recruiter outreach | Cold-outreach emails to recruiters | Haiku 4.5 |
| Target Talent outreach | Warm emails to internal TA contacts | Haiku 4.5 |
| TA Reconcile | Web search to find missing TA contacts | Haiku 4.5 |
| LinkedIn SSI | Comment replies and connection notes | Haiku 4.5 |
| Insights | A career-strategy report synthesized over your whole pipeline | Opus 4.8 |

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
keys. They cost nothing against either bucket.
