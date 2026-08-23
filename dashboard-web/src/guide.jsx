// guide.jsx — the in-app "Day-to-day guide" panel (Setup -> Day-to-day guide).
//
// A scrollable, illustrated manual with a sticky left rail of chapters that act
// as hotlinks, plus a scrollspy that tracks where you are. It mirrors the printed
// "Using trajecktory day to day" PDF, but lives in the app so it never goes stale
// on the shelf and can be updated far more often than the PDF.
//
// Reuses the interview PrepDoc pattern: the rail/scrollspy classes (ib-prepwrap,
// ib-preprail, ib-navitem) and the .ib-prep document typography already in
// styles.css. Everything is theme-safe (CSS variables only), so it inherits all
// nine themes for free. No new npm dependency.
//
// Screenshots resolve from /guide/<name>.png (served from dashboard-web/src/guide/,
// which express.static exposes at the web root). Every one is 100% invented data.
// If a shot is missing, Shot renders a labeled placeholder rather than a broken
// image, so the guide always reads as intentional.

const { useState, useEffect, useRef } = React;

// ── small presentational helpers ────────────────────────────────────────────
function Shot({ src, alt, caption }) {
  const [err, setErr] = useState(false);
  return (
    <figure className="dg-figure">
      {err
        ? <div className="dg-shot-ph" role="img" aria-label={alt}><span>{alt}</span></div>
        : <img className="dg-shot" src={`/guide/${src}`} alt={alt} loading="lazy" onError={() => setErr(true)} />}
      {caption && <figcaption className="dg-cap">{caption}</figcaption>}
    </figure>
  );
}

function Tip({ children })  { return <div className="dg-note dg-tip"><span className="dg-note-k">Tip</span><div>{children}</div></div>; }
function Warn({ children }) { return <div className="dg-note dg-warn"><span className="dg-note-k">Heads up</span><div>{children}</div></div>; }
function Why({ children })  { return <blockquote className="dg-why"><span className="dg-why-k">Why this order</span>{children}</blockquote>; }

// ── chapters ─────────────────────────────────────────────────────────────────
// Each chapter is { id, mk (rail marker), label (rail text), title, body }.
// Keep ids stable: they are the anchor targets and the scrollspy keys.
const CHAPTERS = [
  {
    id: 'map', mk: '01', label: 'A map of the app', title: 'A map of the app, and what to ignore at first',
    body: (
      <>
        <p className="dg-lead">trajecktory has nine places you can go down the left side. That sounds like a lot,
        and on your first morning it is. So here is the honest version: <b>you only need two of them to start</b>.
        The rest fill in as your search grows, and they will still be here when you need them. Nothing breaks if
        you ignore a tab for a month.</p>
        <Shot src="guide-map.png" alt="The full dashboard with the menu down the left side"
          caption="The menu down the left is the whole app. The small numbers are gentle nudges, not alarms: they count things waiting on you today. Setup sits at the bottom once you have finished it." />
        <h3>Start with these two</h3>
        <ul>
          <li><b>Today</b> is your plan for the day and your to-do list.</li>
          <li><b>Pipeline</b> is every role you are tracking, and where each one stands.</li>
        </ul>
        <h3>Add these as you go</h3>
        <ul>
          <li><b>Follow-Ups</b> when threads go quiet, <b>Interview</b> when you land one.</li>
          <li><b>Network</b> and <b>Social</b> once you start talking to people and building visibility.</li>
          <li><b>AI Coach</b> any time you want a second opinion, and <b>Insights</b> once you have enough
          history to learn from.</li>
        </ul>
        <Why>Every tab except Today is built from the same list of roles. Insights cannot tell you what is
        working until you have worked a few roles, and Follow-Ups has nothing to chase until you have applied.
        So the app is deliberately front-loaded: get roles into the Pipeline first, and the rest of the tabs
        become useful in the order you naturally reach them.</Why>
      </>
    ),
  },
  {
    id: 'day', mk: '02', label: 'Your day in ~20 minutes', title: 'Your day, in about twenty minutes',
    body: (
      <>
        <p className="dg-lead">A good day on trajecktory is short and repeatable. You are not meant to live in it.
        The whole loop is about twenty minutes, and most of that is you deciding, not typing.</p>
        <ul>
          <li><b>Open Today.</b> It shows the one or two things that actually matter right now, plus your to-dos.</li>
          <li><b>Clear what is overdue.</b> Follow-Ups surfaces the threads about to go cold, with the nudge
          already drafted. Send the ones that are ready.</li>
          <li><b>Look at new roles.</b> Run a Scan, let Triage rank them, and deep-dive only the strongest.</li>
          <li><b>Tailor and track one.</b> Pick the best fit, let trajecktory tailor a resume and cover letter,
          and move it into your Pipeline.</li>
        </ul>
        <Tip>You do not have to do all four every day. On a slow day, clearing overdue follow-ups is the single
        highest-value thing you can do, because a warm thread that goes cold is far harder to restart than to keep alive.</Tip>
      </>
    ),
  },
  {
    id: 'today', mk: '03', label: 'Today', title: 'Today: what to work on right now',
    body: (
      <>
        <p className="dg-lead">The <b>Today</b> tab is your command center for the day. It has two subtabs,
        <b> Today</b> and <b>Schedule</b>, plus a focus timer, a streak, and a to-do list wired to your applications.</p>
        <Shot src="today.png" alt="The Today tab: cadence, focus timer, streak, and to-dos"
          caption="Today shows your weekly cadence for the current block, a pomodoro-style focus timer, your streak, and to-dos linked to real roles in your pipeline." />
        <ul>
          <li><b>Today</b> is the day's plan: what block you are in, the focus timer, and the to-dos due now,
          overdue, or open.</li>
          <li><b>Schedule</b> is the weekly time-blocked cadence: when you source, when you apply, when you
          follow up. It is a rhythm, not a cage. Move the blocks to fit your life.</li>
        </ul>
        <Tip>To-dos can be attached to a specific role, so "follow up with Contoso" links straight to that
        application. Checking it off is logged, which is part of what your weekly scorecard reads.</Tip>
      </>
    ),
  },
  {
    id: 'workflow', mk: '04', label: 'Finding roles: Scan & Triage', title: 'How new jobs arrive: Scan, Triage, Evaluate',
    body: (
      <>
        <p className="dg-lead">New roles come in through the sidebar <b>Workflow</b>. It is a short pipeline, and
        each step is cheaper than the one after it, on purpose, so you never spend on a role before it has earned it.</p>
        <Shot src="workflow.png" alt="The sidebar workflow: Scan, Triage, Evaluate"
          caption="The workflow runs top to bottom. Free steps first, paid reasoning last, so nothing costs you until it is worth reading." />
        <ul>
          <li><b>API Scan</b> is free and uses no AI. It reads the job boards (Greenhouse, Ashby, Lever,
          SmartRecruiters, Workable) for the companies you track and pulls fresh postings.</li>
          <li><b>Agent Scan</b> searches the open web with Claude for postings the boards miss. It runs on your
          Claude plan.</li>
          <li><b>Triage</b> scores your best pipeline matches cheaply so you deep-dive only the strongest, rather
          than paying for a full read on every one.</li>
          <li><b>Evaluate</b> reads each role against your CV and writes the full report. This is the expensive,
          careful step, which is why it comes last and runs in small batches.</li>
        </ul>
        <Why>Dead postings are liveness-checked out before any AI spend, and a role is Triaged before it is
        Evaluated. That ordering is the whole cost-control story: a big scan is free, a quick rank is cheap, and
        the deep read only happens on the handful you chose.</Why>
        <Tip>Postings on modern career sites (Ashby, Workday, SmartRecruiters) are JavaScript apps that a plain
        reader sees as blank. trajecktory snapshots the real job description through the site's own API first, so
        Triage and Evaluate actually read the role instead of skipping it.</Tip>
      </>
    ),
  },
  {
    id: 'pipeline', mk: '05', label: 'Pipeline', title: 'Pipeline: your working list and its diagnostics',
    body: (
      <>
        <p className="dg-lead">The <b>Pipeline</b> tab is the heart of the app: every role you are tracking, in one
        place. It has four subtabs.</p>
        <Shot src="pipeline-overview.png" alt="Pipeline Overview: KPI cards and this-week floors"
          caption="Overview is your daily read: KPI cards, activity and intake trends, and the floors you are aiming to clear this week." />
        <ul>
          <li><b>Overview</b> is the glance: how many roles are in play, what came in, and whether you are on pace.</li>
          <li><b>Active</b> is the working board across the full stage taxonomy, from Evaluated to Offer. This is
          where you move roles along.</li>
          <li><b>All</b> is everything, including the roles you closed or discarded, when you need the full history.</li>
          <li><b>Analytics</b> is the diagnostics: stage conversion, source effectiveness, and where roles are
          getting stuck.</li>
        </ul>
        <Shot src="pipeline-analytics.png" alt="Pipeline Analytics: conversion and source effectiveness"
          caption="Analytics answers 'where is it going wrong': which stage leaks, which source actually converts, and how your targeting is drifting." />
        <Why>Active shows only live roles on purpose, so the board stays a to-do list, not an archive. A role you
        close moves to All, out of your daily eyeline, but never gets deleted. If it comes back to life, Reopen
        moves it right back to Evaluated.</Why>
      </>
    ),
  },
  {
    id: 'report', mk: '06', label: 'Reading a report', title: 'The report drawer: is this role worth it?',
    body: (
      <>
        <p className="dg-lead">Click any role and a drawer opens with the full evaluation as a cheat sheet. It is
        organized so the answer, "should I spend time on this," is at the top, and the evidence is one click below.</p>
        <Shot src="report-drawer.png" alt="The per-role report drawer with TL;DR, score, and stage tracker"
          caption="The drawer opens on a TL;DR, the headline score and its breakdown, and the stage tracker. Everything else is a tab away." />
        <p>The drawer's own tabs walk the full report: <b>Overview</b>, <b>Resume Match</b> (your CV mapped to the
        role's real requirements), <b>Comp</b>, <b>Interview</b> (a lead story plus STAR stories tuned to the role),
        <b> Customize</b>, <b>Legitimacy</b> (is the posting real), <b>Posting</b> (the snapshotted job description),
        <b> Notes</b>, <b>Contacts</b>, and <b>Follow-up</b>.</p>
        <h3>Where the score comes from</h3>
        <Shot src="score-explainer.png" alt="The score breakdown by dimension"
          caption="The headline score is computed by code from keyed dimensions, so it cannot drift from its own evidence. Pay is rated, but deliberately kept from moving the score." />
        <p>The number is not a vibe. It is derived from named dimensions with weights you can see, so a 4.2 always
        adds up from the same parts. Pay is shown and rated, but it does not push the score up or down, because a
        great-paying role that is a poor fit is still a poor fit.</p>
        <h3>The four buttons</h3>
        <ul>
          <li><b>Tailor resume</b> produces an ATS-clean Word resume tuned to this posting, bullets reordered to
          lead with what the role cares about.</li>
          <li><b>Cover letter</b> drafts one you can edit before it goes anywhere.</li>
          <li><b>Apply</b> fills the form and drafts the answers, then stops so you press submit.</li>
          <li><b>Track</b> moves the role along and starts its follow-up clock.</li>
        </ul>
        <Warn>trajecktory never submits an application for you. Every button prepares work and then hands it back.
        The final click is always yours.</Warn>
      </>
    ),
  },
  {
    id: 'followups', mk: '07', label: 'Follow-Ups', title: 'Follow-Ups: the tab that saves applications',
    body: (
      <>
        <p className="dg-lead">Most applications are not lost to a bad resume. They are lost to silence. The
        <b> Follow-Ups</b> tab is the action queue that keeps that from happening, with the nudge already drafted.</p>
        <Shot src="followups.png" alt="Follow-Ups: warm threads with speed-to-lead and ghosting cues"
          caption="Follow-Ups shows what is overdue, what is about to go cold, and who to give up on, with an editable nudge ready for each." />
        <p>Its subtabs split the work up:</p>
        <ul>
          <li><b>Overview</b> summarizes what's overdue, ranked by how warm and how urgent.</li>
          <li><b>Follow-ups</b> is one ranked queue of everyone worth a touch. Use the channel chips
          (LinkedIn / Email / Both) to filter; contacts you've already reached who have gone quiet appear
          under "Going quiet" below the queue.</li>
          <li><b>Find a contact</b> flags applied roles where you have nobody to talk to yet.</li>
        </ul>
        <Why>Follow-Ups is about chasing <em>people</em>. An application that has gone quiet with no reply is a
        different thing — that lives in <b>Pipeline → Awaiting response</b>, so the two don't blur together.</Why>
      </>
    ),
  },
  {
    id: 'network', mk: '08', label: 'Network', title: 'Network: the relationships that compound',
    body: (
      <>
        <p className="dg-lead">The <b>Network</b> tab is where you manage relationship follow-ups, because the people around a role
        matter as much as the role. The Follow-ups, Referrals, TA Outreach and Influencers subtabs each keep their own tools. Every message here is AI-drafted
        in your voice and fully editable before it goes.</p>
        <Shot src="network-referrals.png" alt="Network: Referrals and TA Outreach"
          caption="Network brings follow-ups and three relationship books together: warm intros, internal contacts and influencers." />
        <ul>
          <li><b>Referrals</b> is your warm channel, built from your LinkedIn connections. It splits into
          <b> Stage 1</b> (people already inside a company you are pursuing) and <b>Stage 2</b> (your wider
          referrer pool). A warm intro beats a cold application every time.</li>
          <li><b>TA Outreach</b> is the in-network talent-acquisition contacts: a real person at the company,
          reached warmly, not a portal.</li>
        </ul>
        <Tip>Import your LinkedIn connections once and trajecktory reconciles them into the Referrals channel,
        flagging who sits inside a company you already track. That is where Stage 1 comes from.</Tip>
      </>
    ),
  },
  {
    id: 'social', mk: '09', label: 'Social', title: 'Social: be visible before you apply',
    body: (
      <>
        <p className="dg-lead">The best inbound is the kind that arrives because someone already knows your name.
        The <b>Social</b> tab helps you build that while you work outbound. It has a dashboard plus several views.</p>
        <Shot src="social-dashboard.png" alt="Social dashboard: the visibility tracker"
          caption="The Social dashboard tracks your visibility (your LinkedIn Social Selling Index over time) and your connection and engagement queues." />
        <ul>
          <li><b>Dashboard</b> is the visibility tracker: your LinkedIn Social Selling Index and how it is trending,
          plus your connect and engagement queues.</li>
          <li><b>Posts</b> is the composer: write your own or have Claude draft them in your voice, edit either,
          then queue them.</li>
          <li><b>Content</b> is where posts get published and measured. Its inner views are <b>Publish</b> (schedule
          to LinkedIn and X through Buffer), <b>Tracker</b> (what is scheduled and what went out), <b>Reply</b>
          (drafted replies to comments), and <b>What works</b> (which posts actually landed).</li>
          <li><b>Influencers</b>, <b>Activity</b>, and <b>Weekly</b> round it out: who to engage with, what you have
          been doing, and a weekly read of your visibility.</li>
        </ul>
        <Shot src="posts.png" alt="The Posts composer with an AI-drafted post"
          caption="Write your own post or have Claude draft one, edit it, and queue it. Nothing auto-publishes without you scheduling it." />
        <Warn>Publishing runs through Buffer and only on the schedule you set. As everywhere in trajecktory, a draft
        is a draft until you send it.</Warn>
      </>
    ),
  },
  {
    id: 'coach', mk: '10', label: 'AI Coach', title: 'AI Coach: a second opinion, any time',
    body: (
      <>
        <p className="dg-lead">The <b>AI Coach</b> is a chat that knows your search. Unlike the reports, which are
        about one role, the Coach can see across your whole pipeline and answer the fuzzy questions: "which of these
        two should I chase," "what is my week actually telling me," "help me word this reply."</p>
        <Shot src="coach.png" alt="The AI Coach chat"
          caption="The Coach is conversational and grounded in your real pipeline. It can also offer one-tap actions you confirm, and a short 'today' brief." />
        <ul>
          <li>Ask it anything about your search. It reads your pipeline, not the open internet, so its answers are
          about you.</li>
          <li>It can propose a small action (draft this, move that) that you confirm with one tap. It never acts
          silently.</li>
          <li>A floating Coach button follows you on every tab, so a question is always one click away without
          leaving what you are doing.</li>
        </ul>
        <Tip>The Coach is the fastest way to learn the app. If you are not sure where a feature lives or what a
        number means, ask it in plain language rather than hunting through tabs.</Tip>
      </>
    ),
  },
  {
    id: 'interview', mk: '11', label: 'Interview', title: 'Interview: prep, and a board for the call itself',
    body: (
      <>
        <p className="dg-lead">When a role turns into an interview, the <b>Interview</b> tab has two modes:
        <b> Prep</b> for the days before, and <b>Live</b> for the call itself.</p>
        <Shot src="interview-prep.png" alt="Interview Prep: per-company research and stories"
          caption="Prep is durable research per company: who you are meeting, the likely questions, and your STAR stories tuned to this role." />
        <ul>
          <li><b>Prep</b> is your research and story bank for the company: the opening, the one story to lead with,
          and the reset if it goes sideways. Read it once, keep it nearby.</li>
          <li><b>Live</b> is a click-a-cue board for the round you are about to run: cues on one side, your answer a
          click away, so you can glance instead of scramble mid-call.</li>
        </ul>
        <Why>Prep and Live are separate because they are used at different moments. Prep is something you build and
        revise calmly beforehand. Live is a performance script you want stripped down to glanceable cues when your
        heart rate is up. Keeping them apart means neither gets in the other's way.</Why>
      </>
    ),
  },
  {
    id: 'insights', mk: '12', label: 'Insights', title: 'Insights: what your search is telling you',
    body: (
      <>
        <p className="dg-lead">The <b>Insights</b> tab is the honest read on how your search is going. It has two
        halves: <b>Review</b> (your inbox) and <b>Insights</b> (the coaching analytics).</p>
        <Shot src="insights.png" alt="Insights: an honest weekly coaching read"
          caption="Insights cites specific roles, not fabricated benchmarks. Thin samples are flagged as too few to rate rather than guessed." />
        <ul>
          <li><b>Review</b> holds the optional, read-only Gmail sync: it catches replies and bounces, logs each
          against the right application, and drafts your response. It never sends anything on its own.</li>
          <li><b>Insights</b> is the weekly scorecard and its detail: <b>Overview</b>, <b>What's working</b>,
          <b> What's not</b>, and <b>Recommended moves</b>.</li>
        </ul>
        <Why>Conversion is reported by the furthest stage each role ever reached, and thin samples are labeled "too
        few to rate" rather than guessed. There are no invented benchmarks anywhere. That honesty is the point: a
        number you cannot trust is worse than no number, because it sends you chasing the wrong fix.</Why>
      </>
    ),
  },
  {
    id: 'cost', mk: '13', label: 'Models & cost', title: 'The API key, and controlling what you spend',
    body: (
      <>
        <p className="dg-lead">Everything trajecktory does runs on your Claude plan by default, with no per-token
        cost and no API key required. Setup's <b>Models &amp; cost</b> panel is where you tune that, if you ever want to.</p>
        <Shot src="models-cost.png" alt="Setup: Models & cost panel"
          caption="Pick which Claude model runs each step, see an approximate cost per run, and flip billing between your plan and an optional API key." />
        <ul>
          <li>Choose the Claude model for each step (Triage, Agent Scan, Evaluate, Insights, Drafts). The defaults
          are the cheaper, calibrated choices, so most people never touch this.</li>
          <li>An optional Anthropic API key is a faster path. When you switch billing to it, the whole workflow
          (not just the writing features) bills your key. It is never required, and you can add or remove it any time.</li>
          <li>The "Bill workflow &amp; drafts to" toggle switches between your Claude plan and the key. The dollar
          estimates apply only to the key path; on the plan there is no per-token cost.</li>
        </ul>
        <Tip>Discovery (Scan) is broad and free. Evaluate runs in small batches rather than reading every scanned
        role at once, so a new user with hundreds of roles does not burn a whole quota in one run. You can change
        the batch size right here.</Tip>
      </>
    ),
  },
  {
    id: 'trouble', mk: '14', label: 'When something looks wrong', title: 'When something looks wrong',
    body: (
      <>
        <p className="dg-lead">A few things look like errors but are not. Here are the common ones, so you do not
        lose time on them.</p>
        <ul>
          <li><b>"0 new" after a scan.</b> Usually correct: nothing new was posted, or the extra web-discovery keys
          are not set. You still get full discovery from API Scan and Agent Scan.</li>
          <li><b>The sidebar shows a name instead of a version.</b> The app is still starting and has not read its
          own version yet. Give it a second.</li>
          <li><b>A Claude usage or limit notice.</b> You hit your Claude plan's rolling five-hour usage limit,
          usually from heavy use. Wait a bit and try again. It is not a trajecktory error.</li>
          <li><b>A role you did not expect got discarded.</b> Roles that close before you act are marked closed, and
          low-fit roles are recommended against. Reopen moves any of them back to Evaluated.</li>
        </ul>
        <Tip>When in doubt, ask the AI Coach. Describe what you are seeing in plain words and it will tell you
        whether it is expected, and what to do next.</Tip>
      </>
    ),
  },
  {
    id: 'summary', mk: '15', label: 'The whole thing, on one page', title: 'The whole thing, on one page',
    body: (
      <>
        <p className="dg-lead">If you remember nothing else, remember this.</p>
        <ul>
          <li>Start in <b>Today</b> and <b>Pipeline</b>. Add the other tabs as your search grows.</li>
          <li>Let roles flow in through <b>Scan</b> and <b>Triage</b>, and only Evaluate the strongest.</li>
          <li>Read a report top-down: the score answers "worth it," the tabs hold the evidence.</li>
          <li>Chase warm threads in <b>Follow-Ups</b> before they go cold. That is the highest-value habit.</li>
          <li>Work the people in <b>Network</b> and build visibility in <b>Social</b>. Warm beats cold.</li>
          <li>Trust the honest numbers in <b>Insights</b>, and ask the <b>AI Coach</b> when you are unsure.</li>
        </ul>
        <p>Everything trajecktory produces is yours to edit, and it never submits anything on your behalf. It is a
        filter that surfaces the few roles worth your time, not a firehose. Be honest with the statuses, chase the
        warm ones, and let the numbers tell you where to aim next.</p>
      </>
    ),
  },
];

const DG_CSS = `
.dg-wrap .ib-preprail .ib-railttl{margin-bottom:9px}
.dg-lead{font-size:14px !important;color:var(--text) !important;line-height:1.6 !important;margin:2px 0 12px !important}
.dg-figure{margin:14px 0 4px}
/* Captures are 2x density and vary in shape: wide full-window shots vs narrow,
   tall panel crops (the sidebar workflow, the report drawer). Never force width
   (that upscaled the narrow ones to a blurry full-column giant). Bound by both
   axes and center, so every image downscales to fit and stays crisp. */
.dg-shot{display:block;max-width:100%;max-height:520px;width:auto;height:auto;margin:2px auto 0;
         border:1px solid var(--border);border-radius:10px;
         background:var(--panel-2);box-shadow:0 1px 3px rgba(0,0,0,.10)}
.dg-shot-ph{display:flex;align-items:center;justify-content:center;text-align:center;min-height:150px;
            max-width:100%;margin:2px auto 0;
            border:1px dashed var(--border-2);border-radius:10px;background:var(--panel-2);
            color:var(--text-mute);font-size:12px;padding:18px;line-height:1.5}
.dg-cap{font-size:11.5px;color:var(--text-mute);line-height:1.5;margin-top:7px}
.dg-note{display:flex;gap:10px;align-items:flex-start;border-radius:8px;padding:9px 12px;margin:11px 0;
         font-size:12.5px;line-height:1.55;color:var(--text)}
.dg-note-k{font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;
           font-weight:700;padding:2px 7px;border-radius:99px;flex:none;margin-top:1px}
.dg-tip{background:var(--accent-bg);border:1px solid rgba(var(--accent-rgb),.30)}
.dg-tip .dg-note-k{background:var(--accent);color:#fff}
.dg-warn{background:var(--panel-3);border:1px solid var(--border-2)}
.dg-warn .dg-note-k{background:var(--text-mute);color:var(--panel)}
.dg-why{font-style:normal !important}
.dg-why-k{display:block;font-family:var(--mono);font-size:9.5px;text-transform:uppercase;letter-spacing:.1em;
          font-weight:700;color:var(--accent-2);margin-bottom:3px}
`;

window.DayToDayGuidePanel = function DayToDayGuidePanel() {
  const [active, setActive] = useState(CHAPTERS[0].id);
  const nodes = useRef({});

  // Scrollspy: the main .content area is the scroll container, so the viewport is
  // the right observer root (mirrors the interview PrepDoc). The margins bias the
  // active band toward the upper third, so the highlight matches what you read.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const els = CHAPTERS.map(c => nodes.current[c.id]).filter(Boolean);
    if (!els.length) return;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => seen.set(e.target.id, e));
      let best = null;
      seen.forEach(e => {
        if (!e.isIntersecting) return;
        if (!best || e.boundingClientRect.top < best.boundingClientRect.top) best = e;
      });
      if (best) setActive(best.target.id);
    }, { rootMargin: '-8% 0px -70% 0px', threshold: 0 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const jump = (id) => {
    const el = nodes.current[id];
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <div className="col dg-wrap" style={{ gap: 16 }}>
      <style>{DG_CSS}</style>
      <div className="ta-head">
        <div>
          <h1>Day-to-day guide</h1>
          <div className="sub">How to actually use trajecktory, one tab at a time. Click a chapter to jump, or just scroll.</div>
        </div>
      </div>

      <div className="ib-prepwrap">
        <nav className="ib-preprail">
          <div className="ib-railttl">Chapters</div>
          {CHAPTERS.map(c => (
            <div key={c.id} className={'ib-navitem' + (active === c.id ? ' on' : '')}
              onClick={() => jump(c.id)} title={c.title}>
              <span className="mk">{c.mk}</span>
              <span className="lb">{c.label}</span>
            </div>
          ))}
        </nav>

        <div className="ib-prep">
          {CHAPTERS.map(c => (
            <section key={c.id} id={c.id} ref={el => { nodes.current[c.id] = el; }} className="ib-sec">
              <div className="ib-sechead">
                <span className="ib-secmk">{c.mk}</span>
                <h1 style={{ margin: 0 }}>{c.title}</h1>
              </div>
              {c.body}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
