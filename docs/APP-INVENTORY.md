# trajecktory app inventory

This reference describes the dashboard as implemented. It is intended for a designer preparing a case-study session. Behavior, routes, file dependencies, screenshot names, and recent changes are grounded in the listed JSX, route, capture, and root-script sources. No user data was read to produce it.

## 1. Nav tree (full)

- App-level (global)
  - Command Palette (`Cmd+K` / `Ctrl+K`)
  - Workflow Runner (sidebar)
  - Update Banner
  - App Map
- Today
  - Today subtab
  - Schedule subtab
- AI Coach
  - Chat (full page)
  - Floating Coach (overlay, available on all tabs)
- Pipeline
  - Overview
  - Roles
    - Active
    - All
  - Discovery
    - Pending
    - Gated
    - Evaluating
  - Analytics
  - Role Drawer (per-role panel)
    - Overview / Score explainer
    - Resume Match
    - Comp
    - Interview
    - Customize
      - CV
      - LinkedIn
    - Legitimacy
    - Posting
    - Notes
    - Contacts
    - Follow-up
- Network
  - Follow-ups
  - Referrals
    - Stage 1
    - Stage 2
    - All
    - LinkedIn import
  - Decision Makers
    - Reconcile
    - Find decision-makers
  - TA Outreach
    - Contact drawer
    - Sequence
    - Log message
  - Influencers
    - AI Response
    - AI Connect
    - AI Reply
- Social
  - Dashboard
  - Posts (composer)
  - Content
    - Publish
    - Tracker
    - Reply to a comment
    - What works
  - Activity
- Interview
  - Prep
  - Live (click-a-cue board)
  - Debrief modal
- Insights
  - Review
    - Gmail sync: replies
    - Gmail sync: bounces
  - Insights
    - Overview
    - What's working
    - What's not working
    - Recommended moves
- Setup (Launchpad)
  - Readiness meter
  - Identity
  - Handoff prompt
  - Integrations
- Setup (other)
  - Models & cost
  - Health check
  - Customize
  - Day-to-day guide
    - 01 A map of the app
    - 02 Your day in ~20 minutes
    - 03 Today
    - 04 Finding roles: Scan & Triage
    - 05 Pipeline
    - 06 Reading a report
    - 07 Follow-Ups
    - 08 Network
    - 09 Social
    - 10 AI Coach
    - 11 Interview
    - 12 Insights
    - 13 Models & cost
    - 14 When something looks wrong
    - 15 Command Palette
    - 16 The whole thing, on one page
  - Tell Me About Yourself (pitch editor)
  - Activity Tracker
  - Change Log
  - About

The Social component currently opens on Posts and also exposes Influencers. The tree above treats the Social shell as its dashboard and keeps Influencers under Network, where the same influencer workflow is also mounted. Drawers, modals, the floating coach, and presentation mode are overlays rather than URL routes, but they are navigable product surfaces.

## 2. Per-surface inventory table

`New/changed?` is based only on the most recent 40 commit subjects. `Unknown` means the source proves the current behavior but the available subjects do not establish when it arrived.

| Surface | What it does | Why it exists | Persona | Primary user action | Key API endpoints | Data source | New/changed? |
|---|---|---|---|---|---|---|---|
| Command Palette | Searches roles, people, and destinations from anywhere. | Removes navigation friction as the tracker grows. | Shared | Search, then open a result or destination. | `/api/search` | `data/applications.md`, `data/target-talent.md`, `data/referrals.md` | No |
| Workflow Runner | Runs discovery, scanning, liveness, evaluation, merge, verification, and health steps with job progress. | Turns root scripts and AI modes into one visible operating loop. | RevOps | Start a step and monitor it to completion. | `/api/workflow/:step`<br>`/api/agent/:mode`<br>`/api/agent/status/:jobId` | `data/pipeline.md`, tracker additions, reports, derived/live jobs | Yes |
| Update Banner | Checks for an update, applies or dismisses it, and offers restart when required. | Makes system maintenance visible while preserving user-layer data. | Shared | Apply or dismiss the available update. | `/api/system/update-check`<br>`/api/system/update-apply`<br>`/api/system/update-dismiss` | derived/live version and update process | No |
| App Map | Explains the product's main areas and the path between them. | Gives new users a mental model before they operate the pipeline. | Shared | Open the map and choose the next area. | None | derived/live from bundled guide content | No |
| Today: Today | Shows today's cadence blocks, focus timer, calendar, streak, and to-dos. | Converts the job search into a finite daily plan. | Shared | Start or complete the next block. | `/api/cadence/today`<br>`/api/google/calendar/today`<br>`/api/todos` | `data/cadence.json`, `data/cadence-log.json`, `data/todos.json`, derived/live calendar | Yes |
| Today: Schedule | Edits the weekly cadence, presets, ordering, duration, and archived blocks. | Keeps planning separate from daily execution. | Shared | Edit and save the recurring schedule. | `/api/cadence`<br>`/api/cadence/log` | `data/cadence.json`, `data/cadence-log.json` | Yes |
| AI Coach: Chat | Displays a daily brief, conversation history, prompts, and confirmable actions. | Adds contextual guidance without silently changing data. | Shared | Ask a question or confirm a proposed action. | `/api/coach/brief`<br>`/api/coach/message`<br>`/api/coach/act` | `data/coach-conversations.json`, derived/live dashboard context | Unknown |
| AI Coach: Floating Coach | Opens the same coach context as an overlay on working screens. | Keeps help available without leaving the current task. | Shared | Open the floating panel and send a message. | `/api/coach/history`<br>`/api/coach/message` | `data/coach-conversations.json`, derived/live dashboard context | Unknown |
| Pipeline: Overview | Summarizes operating KPIs, funnel shape, score distribution, actions, and cohorts. | Shows whether the search is producing useful movement before row-level work. | RevOps | Inspect a KPI or open a role from the action queue. | `/api/metrics/weekly`<br>`/api/activity/actions`<br>`/api/activity/cohorts` | `data/applications.md`, status and activity sidecars, derived/live metrics | Yes |
| Pipeline: Roles, Active | Shows non-terminal evaluated roles with status, score, source, date, and filters. | Keeps current opportunities in a focused working ledger. | RevOps | Filter or open an active role. | `/api/applications`<br>`/api/triage/results` | `data/applications.md`, `data/triage-results.tsv`, reports | Yes |
| Pipeline: Roles, All | Shows the complete evaluated ledger, including terminal outcomes. | Preserves history for audit, comparison, and analysis. | RevOps | Search, filter, export, or open any role. | `/api/applications`<br>`/api/applications/:id` | `data/applications.md`, reports, status sidecars | Yes |
| Pipeline: Discovery, Pending | Lists unchecked roles waiting for evaluation. | Makes the incoming queue visible before AI spend. | RevOps | Open the source or start a deep evaluation. | `/api/pipeline/inbox`<br>`/api/triage/results` | `data/pipeline.md`, `data/scan-history.tsv`, `data/triage-results.tsv` | Yes |
| Pipeline: Discovery, Gated | Shows dead, uncertain, decided, or duplicate postings with reasons. | Prevents wasted evaluation effort while retaining an audit trail. | RevOps | Review the gate reason or resolve a manual item. | `/api/pipeline/inbox`<br>`/api/pipeline/needs-manual`<br>`/api/pipeline/needs-manual/resolve` | `data/pipeline.md`, `data/gate-history.tsv`, `data/needs-manual-jd.tsv` | Yes |
| Pipeline: Discovery, Evaluating | Shows a deep-evaluation job in progress and its result state. | Makes long-running AI work observable. | RevOps | Start evaluation and monitor progress. | `/api/agent/:mode`<br>`/api/agent/status/:jobId` | `data/pipeline.md`, reports, tracker additions, derived/live job | Yes |
| Pipeline: Analytics | Breaks results down by response, compensation, source, archetype, flow, and interview stage. | Helps the user change targeting based on outcomes, not volume. | RevOps | Compare cohorts, sources, and conversion paths. | `/api/insights/response-progress`<br>`/api/insights/rejection-timing`<br>`/api/insights/stage-funnel` | `data/applications.md`, reports, `data/status-events.tsv`, `config/profile.yml` | Yes |
| Role Drawer: Overview / Score explainer | Presents summary, stage track, score provenance, dimensions, recommendation, artifacts, and status actions. | Puts the decision packet and lifecycle controls around one role. | Shared | Inspect the score, then advance, close, or start application work. | `/api/report-body/:id`<br>`/api/artifacts/:id`<br>`/api/applications/:id` | `data/applications.md`, reports, output artifacts, status sidecars | Yes |
| Role Drawer: Resume Match | Maps requirements to CV evidence, gaps, mitigation, and level fit. | Shows whether tailoring can close the important gaps. | Shared | Review evidence and decide whether to tailor. | `/api/cheatsheets/:id`<br>`/api/report-body/:id` | `cv.md`, reports | Unknown |
| Role Drawer: Comp | Compares posted compensation with profile targets and explains the verdict. | Makes compensation fit explicit before investing time. | Shared | Review the range and fit band. | `/api/report-body/:id`<br>`/api/setup/state` | reports, `config/profile.yml` | Unknown |
| Role Drawer: Interview | Surfaces the lead story and relevant STAR+R preparation. | Bridges evaluation evidence into interview preparation. | Shared | Expand and rehearse a story. | `/api/cheatsheets/:id`<br>`/api/interview/sessions` | reports, `interview-prep/story-bank.md`, interview-prep files | Yes |
| Role Drawer: Customize, CV | Shows proposed CV changes with rationale. | Makes resume tailoring inspectable before generation. | Shared | Review the proposed changes and start tailoring. | `/api/report-body/:id`<br>`/api/apply/:id` | reports, `cv.md`, `templates/cv-master.docx`, output artifacts | Yes |
| Role Drawer: Customize, LinkedIn | Shows role-specific LinkedIn positioning recommendations. | Aligns public positioning with a target role without changing it automatically. | Sales Dev | Review and copy the recommendations. | `/api/report-body/:id` | reports, `config/profile.yml` | Yes |
| Role Drawer: Legitimacy | Explains freshness, quality, reposting, and other posting signals. | Separates role fit from confidence that the posting is worth acting on. | Shared | Review the conclusion and source signals. | `/api/report-body/:id`<br>`/api/jd/:id` | reports, `jds/`, `data/gate-history.tsv` | Unknown |
| Role Drawer: Posting | Displays the captured job description and source link. | Preserves the evaluated evidence even if the live page changes. | Shared | Read the saved posting or open the source. | `/api/jd/:id` | `jds/`, report frontmatter | Unknown |
| Role Drawer: Notes | Maintains timestamped notes and can create a linked to-do. | Keeps application context next to the role. | Shared | Add a note or a linked task. | `/api/notes/:id`<br>`/api/todos` | `data/app-notes.json`, `data/todos.json` | Unknown |
| Role Drawer: Contacts | Lists related contacts and opens contact discovery or a contact drawer. | Connects role decisions to relationship work. | Sales Dev | Open an existing contact or find one. | `/api/target-talent/by-company/:company`<br>`/api/tt-reconcile/discover-run` | `data/target-talent.md`, correspondence and contact sidecars | Yes |
| Role Drawer: Follow-up | Builds and reviews an editable role follow-up draft. | Prevents good applications from going silent while preserving human review. | Sales Dev | Edit, review, copy, or log the draft. | `/api/followups/:appNum/draft`<br>`/api/drafts/review`<br>`/api/followups` | `data/applications.md`, `data/follow-ups.md`, reports, contact correspondence | Yes |
| Network: Follow-ups | Ranks due application, contact, referral, and acceptance work in one queue. | Creates one operational list for relationship maintenance. | Sales Dev | Draft, snooze, mute, restore, merge, or log a touch. | `/api/followups/queue`<br>`/api/followups/stale`<br>`/api/followups/snooze` | applications, follow-ups, referrals, target talent, snooze and mute sidecars | Yes |
| Network: Referrals, Stage 1 | Tracks early referral relationships and first outreach. | Separates relationship building from the later ask. | Sales Dev | Open a person and draft the next message. | `/api/referrals`<br>`/api/referrals/:id/draft` | `data/referrals.md`, referral correspondence | Yes |
| Network: Referrals, Stage 2 | Tracks referral-ready relationships and follow-ups. | Focuses attention on contacts where an ask is appropriate. | Sales Dev | Draft or log the referral ask. | `/api/referrals/followups`<br>`/api/referrals/:id/correspondence` | `data/referrals.md`, referral correspondence, snooze sidecar | Yes |
| Network: Referrals, All | Shows active and archived referral records with detail. | Preserves the relationship history behind referral outcomes. | Sales Dev | Filter, update, archive, or open a referral. | `/api/referrals`<br>`/api/referrals/:id/detail`<br>`/api/referrals/:id` | `data/referrals.md`, target talent links, correspondence | Yes |
| Network: Referrals, LinkedIn import | Imports connection data and reconciles it with referral records. | Turns manual LinkedIn state into durable workflow state. | Sales Dev | Upload an export and reconcile matches. | `/api/referrals/import-linkedin`<br>`/api/referrals/reconcile`<br>`/api/referrals/linkedin-status` | `data/referrals.md`, LinkedIn connection import and status sidecars | Yes |
| Network: Decision Makers, Reconcile | Previews suggested additions, archives stale records, and merges contacts. | Keeps the contact book accurate without silent identity changes. | RevOps | Review suggestions and confirm selected changes. | `/api/tt-reconcile/preview`<br>`/api/tt-reconcile/bulk-add`<br>`/api/tt-reconcile/archive` | `data/target-talent.md`, `data/applications.md`, reconcile sidecars | Yes |
| Network: Decision Makers, Find decision-makers | Searches target companies for hiring principals and ranks them by influence. | Helps the user reach people who can affect the hiring decision. | Sales Dev | Run discovery, review provenance, and add selected people. | `/api/tt-reconcile/discover-run`<br>`/api/tt-reconcile/discover-principal`<br>`/api/tt-reconcile/find-emails` | `data/applications.md`, `data/target-talent.md`, derived/live provider results | Yes |
| Network: TA Outreach, Contact drawer | Shows a recruiter or TA contact, related roles, shared timeline, and draft actions. | Gives each person one context-rich workspace. | Sales Dev | Open a contact and choose the next touch. | `/api/target-talent/:id`<br>`/api/target-talent/:id/correspondence` | `data/target-talent.md`, target-talent correspondence, applications | Yes |
| Network: TA Outreach, Sequence | Starts, advances, pauses, or resumes a channel-specific outreach sequence. | Makes multi-touch outreach deliberate and bounded. | Sales Dev | Start or advance the selected sequence. | `/api/sequences/:source/:id`<br>`/api/sequences/:source/:id/start`<br>`/api/sequences/:source/:id/advance` | `templates/outreach-sequences.json`, contact and correspondence state | Yes |
| Network: TA Outreach, Log message | Records sent or received correspondence and optional cross-links. | Keeps reachability and cadence based on real touches. | Sales Dev | Log a message with direction and related records. | `/api/target-talent/:id/correspondence`<br>`/api/followups` | target-talent correspondence, `data/follow-ups.md`, applications | Yes |
| Network: Influencers, AI Response | Drafts an editable response to an influencer's post and can log it. | Supports thoughtful visibility around relevant people. | Sales Dev | Generate, edit, copy, and log a response. | `/api/linkedin-ssi/generate-response`<br>`/api/linkedin-ssi/engagement-log` | `data/linkedin-ssi/influencers.json`, `data/linkedin-ssi/engagement-log.md` | Yes |
| Network: Influencers, AI Connect | Drafts an editable connection request grounded in influencer context. | Converts prior engagement into a human-reviewed connection step. | Sales Dev | Generate, edit, copy, and log the request. | `/api/linkedin-ssi/generate-connect-request`<br>`/api/linkedin-ssi/engagement-log` | influencer list and engagement log, `config/profile.yml` | Yes |
| Network: Influencers, AI Reply | Drafts a reply using prior conversation and engagement context. | Maintains continuity after an inbound response. | Sales Dev | Generate, edit, copy, and log the reply. | `/api/linkedin-ssi/generate-reply`<br>`/api/linkedin-ssi/engagement-log` | influencer list and engagement log | Yes |
| Social: Dashboard | Frames the Social workspace with tracked-influencer and weekly-engagement counts. | Provides context for content and visibility work. | Sales Dev | Choose Posts, Content, Influencers, or Activity. | `/api/linkedin-ssi/influencers`<br>`/api/linkedin-ssi/engagement-log` | `data/linkedin-ssi/influencers.json`, `data/linkedin-ssi/engagement-log.md` | Unknown |
| Social: Posts | Creates, edits, schedules, generates, and deletes professional post drafts. | Maintains a human-reviewed content backlog. | Sales Dev | Write or generate a post, then set its schedule. | `/api/posts`<br>`/api/posts/:id`<br>`/api/posts/generate` | `data/posts.json`, `cv.md`, `article-digest.md`, profile | Unknown |
| Social Content: Publish | Previews eligible posts and pushes selected items to Buffer. | Makes external publishing explicit and inspectable. | Sales Dev | Preview, select, then push to Buffer. | `/api/posts/queue`<br>`/api/posts/push-to-buffer`<br>`/api/buffer/status` | `data/posts.json`, `data/buffer-token.json`, derived/live Buffer | Unknown |
| Social Content: Tracker | Records post metrics and pulls available Buffer performance. | Connects publishing effort to outcomes. | Sales Dev | Update or pull post metrics. | `/api/posts`<br>`/api/posts/pull-metrics` | `data/posts.json`, derived/live Buffer | Unknown |
| Social Content: Reply | Generates an editable reply to a pasted comment. | Speeds response drafting while preserving user control. | Sales Dev | Paste a comment and generate a reply. | `/api/posts/reply` | `config/profile.yml`, derived/live model output | Unknown |
| Social Content: What works | Aggregates results by content type and inbound outcome. | Shows which content patterns deserve repetition. | Sales Dev | Compare performance categories. | `/api/posts` | `data/posts.json` | Unknown |
| Social: Activity | Logs engagement and shows the recent activity stream. | Makes off-platform social work measurable. | Sales Dev | Log a new activity. | `/api/linkedin-ssi/engagement-log`<br>`/api/linkedin-ssi/summary` | `data/linkedin-ssi/engagement-log.md`, influencer list | Yes |
| Interview: Prep | Selects a company and round, then renders structured prep documents. | Brings durable research and rehearsal material into one place. | Shared | Choose a round and review or print prep. | `/api/interview/sessions`<br>`/api/interview/prep/:id/:round`<br>`/api/interview/doc/:id/:key` | `interview-prep/`, `data/applications.md`, reports | Yes |
| Interview: Live | Renders the click-a-cue run sheet, panic section, collision warnings, and presentation view. | Supports fast recall during the interview itself. | Shared | Open cues and enter presentation mode. | `/api/interview/runsheet/:id/:round`<br>`/api/interview/sessions` | `interview-prep/**/*.run.md`, `interview-prep/story-bank.md` | Yes |
| Interview: Debrief modal | Captures outcome, answer quality, objections, notes, and next step after a round. | Preserves fresh interview evidence for later preparation and analysis. | Shared | Complete and save the debrief. | `/api/interview/debriefs/template`<br>`/api/interview/debriefs/:id` | `data/app-notes.json`, applications, run-sheet debriefs | Yes |
| Insights Review: Gmail replies | Reads inbound replies, classifies them, and offers explicit record updates. | Turns inbox signals into pipeline truth without sending email. | Sales Dev | Review a reply and apply a classification. | `/api/google/replies`<br>`/api/google/replies/:msgId/:action`<br>`/api/google/health` | derived/live Gmail, `data/google-tokens.json`, applications and contact records | Yes |
| Insights Review: Gmail bounces | Dry-runs bounce detection before applying status or verification changes. | Prevents bad addresses from corrupting outreach metrics. | Sales Dev | Preview bounces, then apply selected changes. | `/api/google/scan-bounces`<br>`/api/google/apply-bounce` | derived/live Gmail, `data/google-sync.json`, applications and contact records | Yes |
| Insights: Overview | Shows the latest win, improvement area, previous summary, and weekly checklist. | Converts recent evidence into a compact review. | Shared | Generate or read the latest insight. | `/api/insights/latest`<br>`/api/insights/generate` | `data/insights/latest.json`, applications, activity and profile data | Unknown |
| Insights: What's working | Shows supported strengths with confidence, sample size, and citations. | Identifies tactics worth repeating. | RevOps | Inspect the evidence and open a cited role. | `/api/insights/latest`<br>`/api/insights/history` | `data/insights/*.json`, applications, reports, activity data | Unknown |
| Insights: What's not working | Shows bottlenecks and guards low-sample conclusions. | Prevents overreaction to anecdotes. | RevOps | Review the evidence behind a weak area. | `/api/insights/latest`<br>`/api/insights/rejection-timing` | `data/insights/*.json`, applications, status events | Unknown |
| Insights: Recommended moves | Ranks evidence-linked experiments and next actions. | Converts diagnosis into concrete changes. | RevOps | Choose a recommended move to test. | `/api/insights/latest`<br>`/api/insights/generate` | `data/insights/*.json`, profile and pipeline context | Unknown |
| Setup Launchpad: Readiness meter | Summarizes required and optional setup completion and gates first use. | Makes onboarding progress legible. | Shared | Open the next incomplete setup section. | `/api/setup/state`<br>`/api/setup/preflight` | `cv.md`, `config/profile.yml`, `modes/_profile.md`, `portals.yml` | Yes |
| Setup Launchpad: Identity | Edits contact details and professional links as structured fields. | Establishes the identity used in documents and outreach. | Shared | Fill and save identity fields. | `/api/setup/state`<br>`/api/setup/save/:section` | `config/profile.yml` | Unknown |
| Setup Launchpad: Handoff prompt | Produces copyable prompts for generative setup tasks such as CV parsing, narrative, roles, geo, and companies. | Keeps deterministic writes in the dashboard and generative work in the user's agent session. | Shared | Copy a section prompt and run it in the agent. | `/api/setup/handoff/:section`<br>`/api/setup/stage/:key` | staged setup JSON, profile, portals, CV | Unknown |
| Setup Launchpad: Integrations | Configures optional AI, discovery, email, contact verification, social, and vault connections. | Centralizes capabilities that require keys or external authorization. | Shared | Connect or verify an integration. | `/api/setup/verify-keys`<br>`/api/google/health`<br>`/api/buffer/status` | `dashboard-web/.env`, Google and Buffer token sidecars, `config/profile.yml` | Unknown |
| Setup: Models & cost | Chooses models, billing rail, batch size, and shows recent run costs. | Makes AI cost and execution tradeoffs explicit. | Shared | Change a model or billing setting. | `/api/setup/models`<br>`/api/agent/cost-history`<br>`/api/agent/roll-config` | `dashboard-web/.env`, agent run log, derived/live pricing | Unknown |
| Setup: Health check | Runs preflight and verification scripts and presents pass, warning, or failure states. | Detects broken prerequisites and data drift before they affect work. | Shared | Run checks and follow remediation. | `/api/setup/healthcheck`<br>`/api/setup/preflight` | CV, profile, portals, applications, reports, interview prep, derived/live diagnostics | Yes |
| Setup: Customize | Shows 11 personalization areas and whether each is configured or still at defaults. | Guides post-onboarding tuning without editing YAML directly. | Shared | Open a card and copy its focused customization prompt. | `/api/setup/customize`<br>`/api/setup/handoff/:section` | `config/profile.yml`, `modes/_profile.md`, `portals.yml`, templates, story bank | Yes |
| Guide 01: A map of the app | Introduces the product areas and what to ignore at first. | Reduces first-use cognitive load. | Shared | Read the orientation and choose a starting tab. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 02: Your day in ~20 minutes | Presents a short cross-surface daily operating loop. | Gives the user a practical routine. | Shared | Follow the daily sequence. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 03: Today | Explains cadence, focus, calendar, and to-dos. | Teaches daily execution. | Shared | Read the Today walkthrough. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 04: Finding roles: Scan & Triage | Explains API Scan, Agent Scan, JD resolution, triage, and evaluation. | Clarifies how roles enter the system and where AI is used. | Shared | Read the acquisition workflow. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 05: Pipeline | Explains Overview, Roles, Discovery, and Analytics. | Teaches the core working ledger. | Shared | Read the Pipeline walkthrough. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 06: Reading a report | Explains the role drawer and its evidence tabs. | Helps users interpret an evaluation consistently. | Shared | Read the report top to bottom. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 07: Follow-Ups | Explains the ranked queue and cadence controls. | Teaches how to keep applications and relationships warm. | Shared | Read and apply the queue workflow. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 08: Network | Explains referrals, decision makers, TA outreach, and influencers. | Shows how the relationship books fit together. | Shared | Read the network workflow. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 09: Social | Explains posts, publishing, performance, and engagement. | Connects visibility work to the broader search. | Shared | Read the Social walkthrough. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 10: AI Coach | Explains chat context and action confirmation. | Sets expectations for conversational guidance. | Shared | Read the coach walkthrough. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 11: Interview | Explains prep documents, run sheets, and debriefs. | Teaches the transition from research to live performance. | Shared | Read the interview workflow. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 12: Insights | Explains reviews, evidence, and recommended moves. | Helps the user interpret patterns cautiously. | Shared | Read the Insights walkthrough. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 13: Models & cost | Explains model selection and the single billing rail. | Makes optional cost controls understandable. | Shared | Read before changing model settings. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 14: When something looks wrong | Points to health checks and common setup limitations. | Gives users a recovery path. | Shared | Diagnose the symptom with the guide. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 15: Command Palette | Explains keyboard navigation and common destinations. | Makes frequent navigation faster. | Shared | Open the palette and search. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Guide 16: The whole thing, on one page | Summarizes the complete operating model. | Provides a compact refresher. | Shared | Review the end-to-end summary. | None | derived/live from `dashboard-web/src/guide.jsx` | No |
| Setup: Tell Me About Yourself | Generates, edits, parameterizes, and saves an interview pitch. | Turns profile and CV evidence into a reusable spoken introduction. | Shared | Generate, edit, and save the pitch. | `/api/setup/pitch`<br>`/api/setup/pitch/generate`<br>`/api/setup/pitch/save` | `data/elevator-pitch.json`, `cv.md`, `config/profile.yml` | Unknown |
| Setup: Activity Tracker | Builds a dated work-search activity report and can enrich employer details. | Produces an auditable record from existing actions. | Shared | Choose dates, review, enrich, or export. | `/api/setup/twc`<br>`/api/setup/twc/enrich`<br>`/api/setup/twc/export` | applications, apply dates, correspondence, follow-ups, connects, `data/employer-directory.json` | Yes |
| Setup: Change Log | Displays recent release notes and version history. | Explains product changes in plain language. | Shared | Read a release card. | `/api/setup/changelog`<br>`/api/system/version` | `data/release-notes-cache.json`, derived/live release data | Unknown |
| Setup: About | Shows version, operating principles, and project links. | Establishes product identity and trust boundaries. | Shared | Review principles or open a project link. | `/api/system/version` | derived/live version and bundled content | Unknown |

## 3. Agent and pipeline map

Dry-run behavior is stated where it is the default. Writes are limited to what each script does when invoked in its write or apply mode.

| Script | Purpose | Reads | Writes | When to run |
|---|---|---|---|---|
| `scan.mjs` | Scans configured ATS boards with title, age, location, and duplicate filters at zero AI-token cost. | `portals.yml`, `data/scan-history.tsv`, `data/pipeline.md`, `data/applications.md`, live ATS APIs | Adds roles to `data/pipeline.md`; appends `data/scan-history.tsv`; updates `data/scan-coverage.json` | Run API Scan when refreshing known company boards. |
| `resolve-jds.mjs` | Resolves supported SPA job pages through ATS APIs and replaces queue URLs with local snapshots. | `data/pipeline.md`, `portals.yml`, `data/resolve-fail-counts.json`, ATS APIs | `jds/*.md`, updated `data/pipeline.md`, fail counts, `data/gate-history.tsv` | Run before triage or evaluation so agents can read the full JD. |
| `gate-pipeline.mjs` | Classifies pending postings as live, dead, uncertain, already decided, or reposts. | `data/pipeline.md`, `portals.yml`, `data/applications.md`, live pages, identity rules | Updates pipeline markers; appends `data/gate-history.tsv` and `data/merge-drops.tsv` | Run after JD resolution and before evaluation. |
| `reconcile-triage.mjs` | Marks queue rows already covered by triage or full evaluation as done. | `data/pipeline.md`, `data/triage-results.tsv`, `data/applications.md` | Updates `data/pipeline.md` only with `--apply` | Run after a triage batch or when pending counts look stale. |
| `compute-scores.mjs` | Deterministically derives a report headline score from keyed dimensions and configured weights. | One report or `reports/*.md`, scoring policy from profile/defaults | Rewrites report JSON frontmatter only with `--apply` | Run after evaluation and before tracker merge; use `--all` for backfill. |
| `clean-generated-text.mjs` | Applies Markdown-aware text hygiene while preserving frontmatter, code, URLs, and run sheets. | Explicit Markdown files or directories | Rewrites changed `.md` files only with `--apply` | Run after agent-written reports or interview prep. |
| `merge-tracker.mjs` | Validates, deduplicates, and merges batch evaluation rows into the canonical tracker. | `batch/tracker-additions/*.tsv`, applications, reports, pipeline, states, identity rules | Updates applications and pipeline; moves TSVs to `merged/` or `dropped/`; appends audit logs | Run after a batch evaluation, before verification. |
| `verify-actionable.mjs` | Liveness-checks evaluated tracker rows and identifies stale or non-actionable postings. | `data/applications.md`, report or row URLs, `check-liveness.mjs` results | Changes eligible statuses to Discarded only with `--apply` | Run before acting on the Evaluated queue or opening a work session. |
| `discover.mjs` | Expands coverage from observed ATS URLs plus optional web-discovery providers. | `portals.yml`, pipeline, scan history, applications, optional provider keys | Adds companies to `portals.yml`; adds URLs to pipeline and scan history unless `--dry-run` | Run Expand Coverage to find boards and roles beyond the known scanner list. |
| `analyze-patterns.mjs` | Calculates funnel, score-by-outcome, blocker, location, gap, and targeting patterns. | `data/applications.md`, linked reports | None, outputs JSON or a console summary | Run when reviewing rejections or refining targeting. |
| `followup-cadence.mjs` | Calculates due and overdue follow-ups for active applications. | `data/applications.md`, `data/follow-ups.md` | None, outputs JSON or a console summary | Run for a headless cadence review or overdue-only list. |
| `next-jd.mjs` | Issues a persistent, monotonic report and tracker identifier. | `data/jd-counter.txt`, applications, reports, merged TSV names | Advances `data/jd-counter.txt`, except with `--peek` | Run before creating a report outside the server's pre-reserved batch flow. |
| `generate-docx-from-template.mjs` | Copies the master Word CV and surgically replaces configured text slots. | `templates/cv-master.docx`, slot configuration, swap JSON | A tailored `.docx` in the requested output path | Run after CV swap content passes validation. |
| `render-runsheet.mjs` | Parses a run-sheet sidecar, derives collision data, and renders the standalone live board. | One `interview-prep/**/*.run.md` file and bundled assets | A standalone HTML board at the requested or default path | Run after generating or updating a round run sheet. |
| `organize-interview-prep.mjs` | Moves legacy flat interview-prep files into per-company folders without overwriting. | Flat files in the configured interview-prep directory, applications/profile hints | Moves files into company folders only with `--apply` | Run once when migrating older prep artifacts; use `--check` in QA. |
| `verify-pipeline.mjs` | Checks statuses, duplicate identity, report links, score format, row shape, and pending TSVs. | applications, pipeline, reports, tracker additions, `templates/states.yml` | No business-data writes; may ensure required working directories exist | Run in the Verify or Health step after merges. |
| `verify-reports.mjs` | Confirms each report parses into the dashboard sections it claims to contain and checks queue invariants. | `reports/*.md`, pipeline, applications, dismissal and manual-JD state | None | Run after evaluations and before relying on drawer content. |
| `verify-score-drift.mjs` | Detects disagreement between derived report scores and tracker score cells. | `data/applications.md`, linked v1 reports | None | Run after scoring and merge; repair with the dedicated resync script if needed. |
| `verify-report-numbering.mjs` | Detects report filename/frontmatter mismatch and linked-report ID collisions. | `data/applications.md`, linked reports | None | Run after report creation or merge. |
| `verify-interview-prep.mjs` | Validates required section headings in standardized round cheat sheets. | Recursive `interview-prep/**/*.md`, excluding story bank and run sheets | None | Run after generating or reorganizing interview prep. |
| `verify-runsheets.mjs` | Validates run-sheet schema, stage, cue and answer references, caps, panic section, and story IDs. | `interview-prep/**/*.run.md`, `interview-prep/story-bank.md`, shipped examples, states | None | Run before rendering or using a live board. |
| `check-liveness.mjs` | Uses Playwright and ATS-specific logic to classify supplied posting URLs. | URL arguments or a URL file, live pages | None, outputs verdicts | Run for ad hoc verification or through `verify-actionable.mjs`. |
| `cv-sync-check.mjs` | Checks CV/profile presence, prompt metric hygiene, and article-digest freshness. | `cv.md`, `config/profile.yml`, `modes/_shared.md`, `batch/batch-prompt.md`, optional `article-digest.md` | None | Run during Health checks or after updating candidate materials. |

## 4. Screenshot shot-list

These are the 88 case-study captures defined by `docs/onboarding/capture-case-study.mjs`, numbered 29 through 116 inclusive.

| # | Filename | What it shows |
|---:|---|---|
| 29 | `29-app-map.png` | Full app map with global navigation and badges visible. |
| 30 | `30-command-palette.png` | Open command palette with a role-oriented query and grouped results. |
| 31 | `31-workflow-runner.png` | Workflow runner with Liveness Gate in progress, earlier steps complete, and Evaluate queued. |
| 32 | `32-update-banner.png` | Available-update banner with safe-data message, Update, and Dismiss. |
| 33 | `33-today-focus.png` | Populated Today view with a running focus timer and cadence blocks. |
| 34 | `34-today-calendar.png` | Connected Google Calendar card with scheduled events and locations. |
| 35 | `35-today-empty.png` | Today empty state after the day's work is complete. |
| 36 | `36-schedule-editor.png` | Weekly schedule editor with presets and an edited block. |
| 37 | `37-coach-page.png` | Full AI Coach page with daily brief and pipeline conversation. |
| 38 | `38-coach-confirm-action.png` | Coach-proposed action waiting for explicit confirmation. |
| 39 | `39-coach-floating.png` | Floating Coach open over the Pipeline. |
| 40 | `40-pipeline-overview-kpis.png` | Pipeline Overview operating KPIs and explanatory tooltips. |
| 41 | `41-pipeline-overview-charts.png` | Pipeline funnel and score distribution charts. |
| 42 | `42-pipeline-roles.png` | Populated evaluated-role ledger with the current columns. |
| 43 | `43-pipeline-roles-filtered.png` | Roles filtered to a strong-fit, status, archetype, and date slice. |
| 44 | `44-pipeline-provisional.png` | Provisional triage rows with Deep dive, Open JD, and Dismiss actions. |
| 45 | `45-discovery-pending.png` | Discovery roles pending evaluation with added dates. |
| 46 | `46-discovery-gated.png` | Gated roles with dead, uncertain, or repost reasons distinguished. |
| 47 | `47-discovery-evaluating.png` | Deep evaluation running with job progress. |
| 48 | `48-analytics-top.png` | Analytics KPI cards and Response Progress. |
| 49 | `49-analytics-drivers.png` | Compensation, Source Effectiveness, and Archetype Conversion. |
| 50 | `50-analytics-flows.png` | Archetype-to-outcome flow and interview-stage funnel. |
| 51 | `51-role-drawer-overview.png` | Strong-fit role drawer with stage track, score, and recommendation. |
| 52 | `52-score-explainer.png` | Score breakdown with dimensions, weights, caps, and provenance. |
| 53 | `53-role-drawer-applied.png` | Applied role state with artifacts and follow-up-aware actions. |
| 54 | `54-resume-match.png` | Requirement evidence strengths, gaps, mitigation, and level match. |
| 55 | `55-role-comp.png` | Posted compensation compared with target and walk-away bands. |
| 56 | `56-role-interview.png` | Lead interview story and an expanded STAR+R example. |
| 57 | `57-role-customize-cv.png` | CV change plan showing current text, proposed change, and rationale. |
| 58 | `58-role-customize-linkedin.png` | Role-specific LinkedIn positioning recommendations. |
| 59 | `59-role-legitimacy.png` | Mixed legitimacy signals, conclusion, and source links. |
| 60 | `60-role-posting.png` | Saved job-description snapshot. |
| 61 | `61-role-notes.png` | Note history and linked to-do composer. |
| 62 | `62-role-contacts.png` | Related company contacts, influence tiers, and Find contacts action. |
| 63 | `63-role-followup-draft.png` | Editable role follow-up draft with independent review. |
| 64 | `64-followups-queue.png` | Follow-up KPIs and ranked mixed-source queue with filters. |
| 65 | `65-followups-accepted.png` | Recently accepted connection confirmation and promotion option. |
| 66 | `66-followups-merge.png` | Possible-person merge suggestion with explicit choices. |
| 67 | `67-followups-snoozed.png` | Snoozed and muted restoration controls. |
| 68 | `68-followups-find-contact.png` | Applied roles missing contacts and the discovery action. |
| 69 | `69-followups-decision-maker.png` | High-score role missing a hiring decision-maker. |
| 70 | `70-referrals-overview.png` | Referral KPIs, follow-up-now queue, and referral table. |
| 71 | `71-referral-drawer.png` | Referral drawer with shared identity, timeline, and editable ask draft. |
| 72 | `72-decision-makers.png` | Decision-maker table with influence tiers and provider credits. |
| 73 | `73-reconcile-contacts.png` | Contact reconciliation preview with archives and selected additions. |
| 74 | `74-ta-outreach.png` | TA Outreach table with contact and LinkedIn status axes. |
| 75 | `75-contact-drawer.png` | Contact drawer with related roles and shared timeline. |
| 76 | `76-contact-sequence.png` | Active contact sequence, editable message, and review grade. |
| 77 | `77-log-message-modal.png` | Log-message modal with direction and cross-log selections. |
| 78 | `78-influencers-list.png` | Influencer list with weekly engagement goal, tiers, and next motions. |
| 79 | `79-influencer-ai-response.png` | AI Response view with post context and editable response. |
| 80 | `80-influencer-ai-connect.png` | AI Connect view with editable request and copy/log actions. |
| 81 | `81-influencer-ai-reply.png` | AI Reply view with prior context and editable reply. |
| 82 | `82-posts-composer.png` | Professional post composer and historical secondary-channel lane. |
| 83 | `83-content-publish-disconnected.png` | Publish view when Buffer is disconnected. |
| 84 | `84-content-publish-preview.png` | Selected scheduled post in an exact dry-run Buffer preview. |
| 85 | `85-content-publish-result.png` | Buffer push result with scheduled and deduplicated cards. |
| 86 | `86-content-tracker.png` | Content metric cards and populated post performance rows. |
| 87 | `87-comment-reply.png` | Comment input with an editable generated reply. |
| 88 | `88-content-what-works.png` | Comparative content-type performance table with inbound outcomes. |
| 89 | `89-social-activity-log.png` | New-activity form and recent social engagement history. |
| 90 | `90-interview-prep.png` | Interview session and round rail with structured prep. |
| 91 | `91-interview-needs-prep.png` | Interview session that needs prep and offers an agent handoff. |
| 92 | `92-interview-live.png` | Live cue board with hero answer, warnings, and one open answer. |
| 93 | `93-interview-panic.png` | Panic section selected with a collision warning. |
| 94 | `94-interview-present.png` | Fullscreen, camera-calibrated presentation board. |
| 95 | `95-interview-debrief.png` | Filled interview debrief before save. |
| 96 | `96-review-floor.png` | On-pace rolling floor, weekly deltas, and leading indicators. |
| 97 | `97-review-behind.png` | Behind-pace state with a concrete recovery gap. |
| 98 | `98-review-gmail-replies.png` | Read-only Gmail reply queue with classification actions. |
| 99 | `99-review-bounces.png` | Gmail bounce dry-run preview before changes are applied. |
| 100 | `100-insights-overview.png` | Insight overview with win, improvement, prior summary, and checklist. |
| 101 | `101-insights-working.png` | What's working cards with confidence, sample size, and citations. |
| 102 | `102-insights-not-working.png` | Evidence-linked bottlenecks with a low-sample guardrail. |
| 103 | `103-insights-moves.png` | Ranked and cited recommended experiments. |
| 104 | `104-launchpad-readiness.png` | Mostly complete Launchpad readiness rail. |
| 105 | `105-launchpad-identity.png` | Populated deterministic Identity & Links form. |
| 106 | `106-launchpad-handoff.png` | Copyable generative setup handoff prompt. |
| 107 | `107-launchpad-integrations.png` | Integration key categories with connected and missing states. |
| 108 | `108-models-cost.png` | Billing rail, model versions, batch size, and cost history. |
| 109 | `109-health-check.png` | Health diagnostics with pass, warning, failure, and remediation states. |
| 110 | `110-customize.png` | All 11 customization cards with mixed configuration states. |
| 111 | `111-guide-rail.png` | Full 16-chapter Day-to-day guide rail. |
| 112 | `112-guide-daily-loop.png` | Cross-surface 20-minute daily-loop chapter. |
| 113 | `113-pitch-editor.png` | Generated editable pitch with controls and word count. |
| 114 | `114-activity-tracker.png` | Weekly activity report with employer enrichment. |
| 115 | `115-changelog.png` | Current and prior release cards. |
| 116 | `116-about.png` | Version, operating principles, and project links. |

## 5. Changelog (recent significant changes)

Only `feat:` and `fix:` commits from `git log --oneline -40` are included. Entries are grouped by product theme, with the newest themes and commits first.

### Outreach, contacts, and referrals

- `8aa9b4e`: Grounded outreach drafts in the rubric and company research, with enforced asks.
- `d3d8564`: Added outreach self-critique and independent grading.
- `12680e0`: Added referral archiving and cooldowns, and ranked referral opportunities by role fit.
- `e16aade`: Added the Customize surface and tightened outreach and interview behavior.
- `c735b6e`: Hardened Network contact search targeting and result consumption.
- `830958b`: Aligned email and LinkedIn follow-up asks around a lower-friction next step.

### Pipeline safety and data integrity

- `5a46f76`: Added deletion safety and regression coverage for gated-role pruning.
- `1cf4391`: Closed remaining ignore-rule exposure gaps across generated and installer data.
- `69d0974`: Expanded report ignore coverage to nested generated content.
- `a7dfafe`: Removed unused columns from Pipeline and contact tables.
- `56242d6`: Added batch-evaluation prep and cleanup scripts and corrected the bounce-apply cursor.

### Dashboard reliability and workflow behavior

- `5732e0f`: Hardened debrief detection, corrected bounce state changes, split reconciliation, and removed an inaccurate overdue label.
- `bae2b5d`: Added persistent server logs and crash diagnostics.
- `b4e34d5`: Applied broad beta feedback across stages, reconciliation, referrals, Discovery, and Today.

### Activity reporting

- `b8547bb`: Counted every logged LinkedIn connection in the Activity Tracker.
