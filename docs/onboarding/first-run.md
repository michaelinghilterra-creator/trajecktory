# First run: what to expect

A quick map of your first session, from installing trajecktory to your first
evaluated role. The Windows installer and the in-app Launchpad do the heavy
lifting; you mostly review and confirm.

**What you need:** a Windows PC and a paid [Claude](https://claude.ai) plan (Pro
or Max). No Anthropic API key, and no manual Node, Git, or Chromium setup: the
installer bundles all of it.

For the full illustrated walkthrough, see `guide1.html` and `guide2.html` in this
folder. For what each feature costs (free, Claude sign-in, or an optional API
key), see `feature-tiers.md`.

## The seven steps

1. **Install.** Download the installer from the
   [latest release](https://github.com/michaelinghilterra-creator/trajecktory/releases/latest)
   and run it. It bundles Node, Chromium, Claude Code, and Git and installs in a
   few clicks. The `.exe` is not code-signed yet, so Windows SmartScreen may warn
   "unknown publisher": click **More info -> Run anyway**. If setup asks you to
   restart, do it, so Git lands on your PATH (Claude Code needs it).

2. **Launch.** Open trajecktory from the desktop or Start Menu shortcut, or open
   Claude Desktop in Code mode on the installed folder and say "Start the live
   dashboard." Either way it starts a local server and opens the dashboard in your
   default browser at http://localhost:3333. (Set Chrome as your default browser
   for the smoothest experience.)

3. **Take any update.** If an "Update available" banner appears, click **Update
   now**. Updates are one-click: the dashboard pulls system files only, so your CV,
   profile, tracker, and reports are never touched, then restarts and reloads
   itself. The running version shows at the bottom of the left sidebar.

4. **Work the Launchpad.** The Setup tab is a guided setup with a readiness meter.
   Paste your CV (or a LinkedIn URL, or upload a `.docx`/`.pdf`), then review and
   confirm your identity, target roles, your edge, compensation, location rules,
   evaluation tuning, and the companies to track. The generative steps (parsing
   your CV, drafting your edge, suggesting roles and companies) hand you a
   copy-paste prompt to run in your own Claude Code; the deterministic fields you
   fill in and save right in the dashboard. Each section shows a plain-English
   summary of what it configured so you can tweak with confidence.

5. **Sign in to Claude.** Click "Sign in to Claude" in the left sidebar once. This
   runs the bundled `claude login` on your own Claude plan and is what lets
   Evaluate and Scan run. No API key is required: everything runs on your Claude
   subscription. An optional Anthropic API key is only a faster path for the
   writing features (drafts, cover letters, Insights), added later in Setup if you
   want it.

6. **(Optional) Models and cost.** Under Setup -> Models & cost you can choose
   which Claude model runs each workflow step, see an approximate cost per run for
   each choice plus your real recent-run costs, and flip billing between your
   Claude plan and an API key. Sensible, cheaper defaults are already applied, so
   most people can skip this and come back later.

7. **Run your first search.** From the left sidebar: **API Scan** (free, no AI)
   pulls fresh roles from Greenhouse, Ashby, and Lever, then **Triage** scores the
   best-fit ones cheaply (the API-key workflow uses **Agent Scan** and **Evaluate**
   instead). Review the scored roles, deep-dive the strongest for a full A-F report,
   let trajecktory tailor an ATS resume and cover letter, and track it. From there
   it schedules follow-ups so nothing goes stale.

## What trajecktory will not do

It never submits an application for you and it recommends against applying below
4.0/5. You always have the final call. trajecktory is a filter that surfaces the
few roles worth your time, not a spray-and-pray blaster.
