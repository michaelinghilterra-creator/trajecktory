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
// Every figure is a Playwright capture of the real UI over invented data
// (docs/onboarding/capture-guide.mjs), so labels in the text match the screen.
const CHAPTERS = [
  {
    id: 'map', mk: '01', label: 'A map of the app', title: 'A map of the app, and what to ignore at first',
    body: (
      <>
        <p className="dg-lead">trajecktory has seven places you can go down the left side, plus Setup at the
        bottom. That sounds like a lot, and on your first morning it is. So here is the honest version:
        <b> you only need two of them to start</b>. The rest fill in as your search grows, and they will still be
        here when you need them. Nothing breaks if you ignore a tab for a month.</p>
        <Shot src="guide-map.png" alt="The full dashboard with the menu down the left side"
          caption="The menu down the left is the whole app. The small numbers are gentle nudges, not alarms. Today counts blocks still to do plus overdue to-dos, Pipeline counts roles waiting for your decision, and Network counts contacts you can act on right now." />
        <h3>Start with these two</h3>
        <ul>
          <li><b>Today</b> is your plan for the day and your to-do list.</li>
          <li><b>Pipeline</b> is every role you are tracking, and where each one stands.</li>
        </ul>
        <h3>Add these as you go</h3>
        <ul>
          <li><b>Interview</b> when you land one, and <b>Network</b> once you start talking to people. Network is
          also where follow-ups live.</li>
          <li><b>Social</b> once you start building visibility.</li>
          <li><b>AI Coach</b> any time you want a second opinion, and <b>Insights</b> once you have enough
          history to learn from.</li>
          <li><b>Setup</b> sits at the bottom once you have finished the Launchpad. Until then it is called
          <b> Launchpad</b>, sits at the top, and shows how many steps are left.</li>
        </ul>
        <Why>Every tab except Today is built from the same list of roles. Insights cannot tell you what is
        working until you have worked a few roles, and Network has nothing to chase until you have applied.
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
          <li><b>Open Today.</b> It shows the blocks of your day and your to-dos, with anything overdue marked in red.</li>
          <li><b>Clear what is due.</b> Network, Follow-ups is one ranked queue of the people worth a touch, with
          the message drafted for you. Send the ones that are ready, then press Mark sent.</li>
          <li><b>Look at new roles.</b> Run a Scan, review the queue, and evaluate only the strongest.</li>
          <li><b>Tailor and track one.</b> Pick the best fit, let trajecktory tailor a resume and cover letter,
          and move it into your Pipeline.</li>
        </ul>
        <Tip>You do not have to do all four every day. On a slow day, clearing the follow-up queue is the single
        highest-value thing you can do, because a warm thread that goes cold is far harder to restart than to keep alive.</Tip>
      </>
    ),
  },
  {
    id: 'today', mk: '03', label: 'Today', title: 'Today: what to work on right now',
    body: (
      <>
        <p className="dg-lead">The <b>Today</b> tab is your command center for the day. It has two sub-tabs,
        <b> Today</b> and <b>Schedule</b>, plus a focus timer, a streak, and a to-do list wired to your applications.</p>
        <Shot src="today.png" alt="The Today tab: streak, calendar, time blocks, and to-dos"
          caption="Today shows your streak, your time blocks with a Start button for each, and to-dos linked to real roles in your pipeline. A Google Calendar card appears above the blocks once you connect it." />
        <ul>
          <li><b>Today</b> is the day's plan. The streak strip shows your current and best run of days plus the last
          seven days (green is a full day, orange partial, faint a rest day). Each time block has a checkbox and a
          <b> Start</b> button that opens a focus timer with Pause, Skip and Stop. A work interval is the length of the
          block and a break is five minutes, or fifteen on every fourth round.</li>
          <li><b>Google Calendar</b> appears as a card only if you have connected Google and allowed calendar read
          access. If Google is connected without it, the card offers a one-time Reconnect.</li>
          <li><b>Did it happen?</b> appears when an interview slot has ended and you have not said how it went.
          See the Interview chapter.</li>
          <li><b>To-do list</b> has chips for Open, Today, Overdue, Done and All, a priority (High, Med, Low) and an
          optional due date. The pencil opens notes and edits.</li>
          <li><b>Schedule</b> is the weekly time-blocked cadence: pick the days, a start time, a length and how many
          focus rounds for each block. It is a rhythm, not a cage. Save schedule applies your changes, and Archive
          removes a block from Today without losing its history.</li>
        </ul>
        <Tip>To-dos can be attached to a specific role, so "Send the 2nd follow-up to Acme Robotics" shows the
        company as a chip. Add one from the Notes tab of any role's report and it appears here, linked to that role.</Tip>
      </>
    ),
  },
  {
    id: 'workflow', mk: '04', label: 'Finding roles: Scan & Evaluate', title: 'How new jobs arrive: Scan, Gate, Evaluate',
    body: (
      <>
        <p className="dg-lead">New roles come in through the sidebar <b>Workflow</b>. It is a short pipeline, and
        each step is cheaper than the one after it, on purpose, so you never spend on a role before it has earned it.</p>
        <Shot src="workflow.png" alt="The sidebar workflow: Expand Coverage, API Scan, Agent Scan, Liveness Gate, Evaluate"
          caption="The workflow runs top to bottom. Free steps first, paid reasoning last, so nothing costs you until it is worth reading. Under Advanced are the clean-up steps." />
        <ul>
          <li><b>Expand Coverage</b> registers new companies from your pipeline (and, with a Brave key, from the open web).</li>
          <li><b>API Scan</b> is free and uses no AI. It reads the job boards (Greenhouse, Ashby, Lever) for the
          companies you track and pulls fresh postings.</li>
          <li><b>Agent Scan</b> searches the open web with Claude for postings the boards miss. It runs on your
          Claude plan.</li>
          <li><b>Liveness Gate</b> removes closed and unreadable postings before evaluation.</li>
          <li><b>Evaluate</b> reads each role against your resume and writes the full report. This is the expensive,
          careful step, which is why it comes last. It rolls through the queue in batches of five on your plan and
          stops when the queue is empty or you press Stop. A confirm box tells you how many roles will be evaluated
          before anything runs.</li>
          <li><b>Advanced</b> holds Merge Tracker, Verify Actionable and Health Check. When an Evaluate run finishes,
          the scoring, merge and health steps run for you, so you rarely need these by hand.</li>
        </ul>
        <p>The first time, the panel shows a <b>Sign in to Claude</b> button. Press it once and sign in. Below the
        steps, <b>Paste a JD</b> lets you evaluate a single posting by pasting its link or text. Postings the reader
        could not open are listed under <b>Couldn't read</b> so you can paste them in by hand.</p>
        <Why>Dead postings are liveness-checked out before evaluation. A big scan is free, and the careful read
        happens only on the roles you choose to evaluate.</Why>
        <Tip>Postings on modern career sites (Ashby, Workday, SmartRecruiters) are JavaScript apps that a plain
        reader sees as blank. trajecktory snapshots the real job description through the site's own API first, so
        Evaluate can read the role instead of skipping it.</Tip>
      </>
    ),
  },
  {
    id: 'pipeline', mk: '05', label: 'Pipeline', title: 'Pipeline: your working list and its diagnostics',
    body: (
      <>
        <p className="dg-lead">The <b>Pipeline</b> tab is the heart of the app: every role you are tracking, in one
        place. It has four sub-tabs: <b>Overview</b>, <b>Roles</b>, <b>Discovery</b> and <b>Analytics</b>.</p>
        <Shot src="pipeline-overview.png" alt="Pipeline Overview: this-week tiles and result rates"
          caption="Overview is your daily read: this week against your floors, then the results of everything you have applied to. The line under the title says whether all the numbers on the page tie out." />
        <h3>Overview</h3>
        <ul>
          <li><b>This week</b> (Sunday to Saturday) has five tiles: Applications, Follow-ups, LinkedIn touches,
          Screens held and Unserviced. A tile turns orange below its floor and green once it meets it. Hover any
          tile to see its definition and how it is worked out.</li>
          <li><b>Results, all applications</b> has four rates: Response rate, Positive reply rate, Interview rate and
          Referral share. With too few applications a rate shows "k of n" and "too few to rate" instead of a
          percentage.</li>
          <li>The <b>weekly chart</b> groups applications by the week you sent them and shows how each group turned
          out. A dashed bar marked "maturing" is too young to judge. Below it are the <b>application funnel</b> and
          <b> Score vs apply decision</b>, which shows where you applied against the 3.5 line.</li>
        </ul>
        <Shot src="pipeline-roles.png" alt="Pipeline Roles: status chips, filters and the sortable table"
          caption="Roles is the working list. Status chips carry live counts, and you can combine them with the archetype, minimum score and date filters." />
        <h3>Roles, Discovery and Analytics</h3>
        <ul>
          <li><b>Roles</b> is the list you work from, with every status in one table. Click a status chip to filter
          (you can pick several), use the minimum-score buttons, and sort any column. Click a row to open its report.
          Export CSV downloads whatever the filters show.</li>
          <li><b>Discovery</b> is the queue of scanned roles before they become evaluations: pending, gated (with the
          reason, for example the posting was removed) and done. Nothing is lost: a pending role simply has not been
          evaluated yet.</li>
          <li><b>Analytics</b> is the diagnostics: how many are active and interviewing, your silence rate, response
          progress, where your comp sits against your target, and which role types and sources actually convert.</li>
        </ul>
        <Shot src="pipeline-analytics.png" alt="Pipeline Analytics: silence rate, response progress, comp positioning"
          caption="Analytics answers 'where is it going wrong'. Groups with fewer than ten applications are not rated, so one lucky reply cannot mislead you." />
        <Why>Roles shows every status in one list on purpose, with chips to narrow it, so nothing is hidden from
        you. A role you close is never deleted. If it comes back to life, Reopen moves it right back to Evaluated.</Why>
      </>
    ),
  },
  {
    id: 'report', mk: '06', label: 'Reading a report', title: 'The report drawer: is this role worth it?',
    body: (
      <>
        <p className="dg-lead">Click any role and a drawer opens with the full evaluation as a cheat sheet. It is
        organized so the answer, "should I spend time on this," is at the top, and the evidence is one click below.</p>
        <Shot src="report-drawer.png" alt="The per-role report drawer open over the Roles table"
          caption="The drawer opens on a TL;DR, the headline score and its breakdown, and the stage track. Everything else is a tab away." />
        <p>The drawer's tabs walk the full report: <b>Overview</b>, <b>Resume Match</b> (your resume mapped to the
        role's real requirements), <b>Comp</b>, <b>Interview</b> (a lead story plus STAR stories tuned to the role),
        <b> Customize</b>, <b>Legitimacy</b> (is the posting real), <b>Posting</b> (the saved job description),
        <b> Notes</b>, <b>Contacts</b> and <b>Follow-up</b>. Follow-up appears only once the role is Applied or in an
        interview stage.</p>
        <h3>Where the score comes from</h3>
        <Shot src="score-explainer.png" alt="The score breakdown and the How is this scored panel"
          caption="The headline score is computed by code from the dimensions you see, and the line under the bars shows the sum. Comp and Build Depth are rated, but deliberately kept from moving the score." />
        <p>The number is not a vibe. It is derived from named dimensions with weights you can see, so a 4.2 always
        adds up from the same parts. <b>How is this scored?</b> opens the plain-language rubric. Four and a half or
        higher is a strong match, 4.0 to 4.4 is good, 3.5 to 3.9 is decent but not ideal, and below 3.5 the report
        recommends against applying. Most jobs are not a 4.</p>
        <h3>Moving a role along</h3>
        <Shot src="stage-track.png" alt="The stage track with the Booked date, Back and Advance"
          caption="Seven stages from Evaluated to Offer. The Booked date records when the change was made or announced, not when the interview happens." />
        <p>The stage track has seven rungs: Eval, Applied, Screen, 1st, 2nd, 3rd and Offer. Click a rung, or use
        <b> Back</b> and <b>Advance</b>. The <b>Booked</b> date defaults to today and cannot be in the future. When a
        role is closed the track stops being clickable and shows where it was lost.</p>
        <h3>The buttons at the bottom</h3>
        <Shot src="drawer-footer.png" alt="The drawer footer for an Evaluated role"
          caption="The footer changes with the status. This is an Evaluated role, so the apply buttons are showing." />
        <ul>
          <li>On an <b>Evaluated</b> role: <b>Tailor resume</b> builds an ATS-clean Word resume for this posting and
          opens the posting. <b>Claude Apply</b> does that plus the form answers. <b>Already Applied</b> logs it with
          nothing generated. <b>Cover Letter</b> drafts one and changes nothing else. The closers <b>Skip</b>,
          <b> Not a Fit</b> and <b>Closed</b> take it off your list.</li>
          <li>On an <b>Applied</b> or interview role the main button reads <b>Move to</b> the next stage, with
          <b> Rejected</b>, <b>No Response</b>, <b>Not a Fit</b> and <b>Closed</b> beside it. Moving into an interview
          stage asks for the date first (see the Interview chapter).</li>
          <li>On an <b>Offer</b> the button is <b>Accept Offer</b>. On a closed role it is <b>Reopen to Evaluated</b>,
          and a low-scoring discard can also be re-evaluated.</li>
          <li><b>Rejected</b> checks the facts: if no rejection email is on file it asks for the date you were told
          no, and if the employer has written since you applied it shows you their message before you mark
          <b> No Response</b>.</li>
        </ul>
        <Warn>trajecktory never submits an application for you. Every button prepares work and then hands it back.
        The final click is always yours.</Warn>
      </>
    ),
  },
  {
    id: 'followups', mk: '07', label: 'Follow-ups', title: 'Follow-ups: the queue that saves applications',
    body: (
      <>
        <p className="dg-lead">Most applications are not lost to a bad resume. They are lost to silence. Follow-ups
        used to be its own tab. It is now the first sub-tab of <b>Network</b>, and it is one ranked queue of the people
        worth a touch, with the message drafted for you.</p>
        <Shot src="followups.png" alt="Network, Follow-ups: the ranked queue with channel and contact-type filters"
          caption="One queue, ranked by importance and then by how overdue the last touch is. Nothing is sent from here: you draft, send by hand, then press Mark sent." />
        <ul>
          <li><b>Channel</b> chips (All, LinkedIn, Email, Both) and <b>Contact type</b> chips (All, Referral, TA,
          Influencer) filter the queue. Each card shows why the person is there (Reach out, Follow up, Just
          connected), whether they can influence the hire (HIGH VALUE, PRINCIPAL), and what you have already sent.</li>
          <li>Each channel has its own lane. LinkedIn drafts a 300-character invite or a message, email drafts a
          subject and body. <b>Mark sent</b> logs the touch and clears the row. <b>14d</b> snoozes for two weeks and
          <b> Done for now</b> takes the person off the queue until you restore them.</li>
          <li>The bar under the filters tells you who is hidden and why. Contacts return on their own when the hold
          clears: another contact at the same company was already queued today, the gap between touches has not
          passed, or they have been contacted the maximum number of times without a reply.</li>
          <li>Further down the page: <b>Recently accepted? Confirm</b> catches LinkedIn invites that were probably
          accepted, <b>Possible duplicate contacts</b> offers to merge the same person filed twice, <b>Find a
          contact</b> lists applied roles with nobody to talk to, and <b>Reach a decision-maker</b> lists roles where
          you only know recruiters.</li>
        </ul>
        <Tip>Applications that have gone quiet are no longer in this queue. They are marked stale in Pipeline and
        show a Follow-up tab in their own report, where you can draft a nudge or log a touch.</Tip>
        <Why>The rules are on your side. By default a contact is not queued again for three days, you get a rest
        day after any touch, and a company is capped at three contacts a day so you never look like a blast.</Why>
      </>
    ),
  },
  {
    id: 'network', mk: '08', label: 'Network', title: 'Network: the relationships that compound',
    body: (
      <>
        <p className="dg-lead">The <b>Network</b> tab is where you manage the relationships that compound.
        It has five sub-tabs: <b>Follow-ups</b>, <b>Referrals</b>, <b>Decision Makers</b>,
        <b> TA Outreach</b> and <b>Influencers</b>. Every message here is AI-drafted in
        your voice and fully editable before it goes anywhere.</p>
        <Shot src="network-referrals.png" alt="Network, Referrals: Stage 1 people inside companies you are pursuing"
          caption="Referrals is your warm intro channel, built from your LinkedIn connections. Stage 1 is people inside a company where you have a live application." />
        <ul>
          <li><b>Referrals</b> is your warm channel. Import your LinkedIn Connections.csv once and trajecktory sorts
          it into <b>Stage 1</b> (someone you know inside a company you have applied to), <b>Stage 2</b> (everyone
          else) and <b>All</b>, with <b>Archived</b> for the rest. The status ladder runs from Not Asked through Asked
          and Intro Made to Applied w/ Referral. <b>Reconcile</b> rescans your connections against your pipeline,
          <b> Clean up stale</b> archives people at companies you have dropped, and <b>Find emails</b> looks up
          missing addresses.</li>
        </ul>
        <Shot src="network-decision-makers.png" alt="Network, Decision Makers"
          caption="Decision Makers are the people who can say yes to the hire: hiring managers, skip-level executives and functional peers." />
        <ul>
          <li><b>Decision Makers</b> and <b>TA Outreach</b> are two views of the same contact book, split by the
          contact's role in the hire. Decision Makers holds hiring managers, executives and peers. TA Outreach
          holds talent acquisition and agency recruiters, who move you through the process but do not decide. Both
          have Import CSV, a CSV Template and a <b>Reconcile</b> that retires contacts at closed companies and finds
          people for the companies where you have nobody. Only Decision Makers has <b>Find decision-makers</b>.</li>
          <li>Open any contact to see where they sit in a six-step pipeline, whether you are connected on LinkedIn,
          and an outreach sequence you can start. Each step is a draft you approve. Nothing sends automatically.</li>
        </ul>
        <Shot src="network-influencers.png" alt="Network, Influencers"
          caption="Influencers are people worth engaging with to build visibility, not to apply. The three letters show Following, Connected and Engaged." />
        <ul>
          <li><b>Influencers</b> lists people in your field worth engaging on LinkedIn. The status letters are F
          (following), C (connected) and E (engaged), and the Next motion column tells you the next small step.
          Each influencer's drawer has an <b>AI Response</b> to their post, an <b>AI Connect</b> note and an
          <b> AI Reply</b>. All drafts, all editable, none sent automatically.</li>
        </ul>
        <Tip>Referrals and TA contacts share one record per person. If the same person is filed twice at a company,
        Follow-ups offers to merge them into one history so you never write to someone twice.</Tip>
      </>
    ),
  },
  {
    id: 'social', mk: '09', label: 'Social', title: 'Social: be visible before you apply',
    body: (
      <>
        <p className="dg-lead">The best inbound is the kind that arrives because someone already knows your name.
        The <b>Social</b> tab helps you build that while you work outbound. It has four sub-tabs:
        <b> Posts</b>, <b>Content</b>, <b>Influencers</b> and <b>Activity Log</b>.</p>
        <Shot src="posts.png" alt="Social, Posts: the composer, the queue and the drafts"
          caption="Write your own post or have Claude draft one, edit it, give it a Publish time and queue it. Nothing publishes by itself." />
        <ul>
          <li><b>Posts</b> is the composer. Pick a lane (Professional or trajecktory, the build-in-public one), write
          or press <b>Draft with Claude</b>, and save. Drafts have a Publish time and a <b>Queue</b> button, and the
          queue has <b>Mark scheduled</b> and <b>Unqueue</b>. Nothing is sent from this tab.</li>
          <li><b>Content</b> is where posts are published and measured. <b>Publish</b> pushes queued posts to
          LinkedIn through Buffer, after a dry-run <b>Preview</b>. <b>Tracker</b> records how each post performed
          and can pull numbers back from Buffer. <b>Reply</b> drafts an on-message answer to a comment you paste in.
          <b> What works</b> averages engagement by post type.</li>
          <li><b>Influencers</b> is the same list as in Network, and <b>Activity Log</b> is where you record each
          comment, message or connection request so the weekly numbers are real.</li>
        </ul>
        <Shot src="social-content.png" alt="Social, Content, Tracker"
          caption="The Tracker rolls up each post with its engagement rate. Buffer fills in impressions and reactions about a day after a post goes out." />
        <Warn>Publishing runs through Buffer and only on the schedule you set. You add your own Buffer key once, in
        Setup under API keys, Social posting. As everywhere in trajecktory, a draft is a draft until you send it.
        The X channel has been stood down, so both lanes post to LinkedIn, even though some on-screen text in Social still mentions X.</Warn>
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
          caption="The Coach is conversational and grounded in your real pipeline. It opens with a short brief for today, and the Quick starts on the right are one tap away." />
        <ul>
          <li>Ask it anything about your search. It reads your pipeline, not the open internet, so its answers are
          about you. <b>Quick starts</b> give you seven common questions, such as "What should I do today?" and "I got
          a rejection, what now?"</li>
          <li>It can propose one small action, such as marking a role Rejected or adding a to-do, as a button that
          reads "Mark ... as Rejected". Nothing happens until you press it.</li>
          <li>A floating Coach button follows you on every tab, so a question is always one click away without
          leaving what you are doing.</li>
        </ul>
        <Tip>The Coach is the fastest way to learn the app. If you are not sure where a feature lives or what a
        number means, ask it in plain language rather than hunting through tabs.</Tip>
      </>
    ),
  },
  {
    id: 'interview', mk: '11', label: 'Interview', title: 'Interview: schedule, prep, a board for the call, and the debrief',
    body: (
      <>
        <p className="dg-lead">When a role turns into an interview, trajecktory follows it from the booking to the
        debrief. The <b>Interview</b> tab holds the preparation, in two modes: <b>Prep</b> for the days before and
        <b> Live</b> for the call itself.</p>
        <Shot src="interview-schedule.png" alt="The Schedule modal that opens when you move a role into an interview stage"
          caption="Moving a role into Phone Screen or an interview stage asks for the date, time, who runs it and the channel. Cancel changes nothing." />
        <h3>The whole loop</h3>
        <ul>
          <li><b>Schedule.</b> Move a role to an interview stage and the Schedule modal asks for the Date, Time, Who
          runs it (Recruiter / TA or Hiring manager / panel) and Channel (Phone, Video, Onsite). Saving does not
          count the interview as held.</li>
          <li><b>Prep.</b> A role appears in the Interview tab as soon as it reaches an interview stage. Prep is
          written by your own Claude Code: the tab shows the command to copy, for example
          <code> /trajecktory interview-prep Company round 1</code>.</li>
          <li><b>Live.</b> A second command compiles a click-a-cue board for the round. Cues sit on one side and your
          answer is a click away, so you glance instead of scramble. <b>Present</b> makes the board fullscreen.</li>
          <li><b>Did it happen?</b> Thirty minutes after the slot ends, Today asks: <b>Held</b>, <b>Rescheduled</b>,
          <b> Cancelled by employer</b>, <b>Withdrew</b>, <b>No-show</b> or <b>Call dropped</b>. Only Held counts as
          an interview, and it opens the debrief.</li>
          <li><b>Debrief.</b> Capture it while it is fresh. The two fields marked most important are the objection and
          the likely reason. Skipping leaves the round on the Debriefs due list in Insights, Review.</li>
        </ul>
        <Shot src="interview-prep.png" alt="Interview, Prep: the sections rail and the prep document"
          caption="Prep is durable research per company: the opening, the hero story, what not to do, and what to ask. A Cram sheet prints the essentials on one or two pages." />
        <Shot src="interview-live.png" alt="Interview, Live: the click-a-cue board"
          caption="Live is a performance script, stripped down to glanceable cues. Click a cue to see the answer; click it again, or press Esc, to clear it." />
        <Why>Prep and Live are separate because they are used at different moments. Prep is something you build and
        revise calmly beforehand. Live is a performance script you want stripped down to glanceable cues when your
        heart rate is up. A round number and a stage are independent: round 3 can be your 2nd Interview.</Why>
      </>
    ),
  },
  {
    id: 'insights', mk: '12', label: 'Insights', title: 'Insights: what your search is telling you',
    body: (
      <>
        <p className="dg-lead">The <b>Insights</b> tab is the honest read on how your search is going. It has two
        sub-tabs: <b>Review</b>, which opens first, and <b>Insights</b>, the coaching analysis.</p>
        <Shot src="insights-review.png" alt="Insights, Review: weekly floors and week over week"
          caption="Review freezes each week's numbers against your floors. A grey dash means 'not logged', never zero." />
        <ul>
          <li><b>Weekly review</b> shows three floors for the week: Follow-ups sent (13), LinkedIn connection requests
          sent (50) and Cadence adherence (70%). <b>Run weekly review</b> freezes this week into the log, and the
          <b> Week over week</b> table keeps the history. Tiles are green on track, red below the floor and grey when
          nothing was logged.</li>
          <li><b>Build cap</b> is the rolling version of the follow-up floor: your verified touches over the last
          seven days against the floor. When you are behind, improvement work is locked until you catch up. You can
          mark days off, and use one monthly reset.</li>
          <li><b>Gmail sync</b> is optional and read-only. It catches replies and bounces and offers to log each one
          against the right application. It never sends anything.</li>
          <li><b>Debriefs due</b> lists interview rounds with no debrief yet, and <b>Log a LinkedIn connect</b> records
          a connection request you sent by hand so the weekly floor is real.</li>
        </ul>
        <Shot src="insights.png" alt="Insights: a generated analysis"
          caption="Press Generate Analysis for a read across your whole pipeline. It cites specific roles, and thin samples are flagged as too few to rate rather than guessed." />
        <ul>
          <li><b>Insights</b> starts empty. <b>Generate Analysis</b> reads your pipeline and returns an
          <b> Overview</b> with this week's focus list, then <b>What's working</b>, <b>What's not</b> and
          <b> Recommended moves</b>. A banner reads "Snapshot, not live" when the analysis is a day old or your
          tracker has changed since.</li>
        </ul>
        <Why>Conversion is reported by the furthest stage each role ever reached, and thin samples are labeled "too
        few to rate" rather than guessed. There are no invented benchmarks anywhere. That honesty is the point: a
        number you cannot trust is worse than no number, because it sends you chasing the wrong fix.</Why>
      </>
    ),
  },
  {
    id: 'setup', mk: '13', label: 'Setup', title: 'Setup: the Launchpad and everything behind it',
    body: (
      <>
        <p className="dg-lead">Setup is where you tell trajecktory who you are and how you work. On day one it is
        called <b>Launchpad</b> and opens by itself. It has nine sub-tabs: <b>Launchpad</b>, <b>Customize</b>,
        <b> Day-to-day guide</b> (this page), <b>Tell Me About Yourself</b>, <b>Activity Tracker</b>,
        <b> Weekly review</b>, <b>Data storage</b>, <b>Change Log</b> and <b>About</b>.</p>
        <Shot src="setup-launchpad.png" alt="The Launchpad right after the resume is in"
          caption="Only the resume is required. Once it is in, the green banner says you can start, and the rest of the steps are optional ways to sharpen your results." />
        <ul>
          <li><b>Launchpad</b> walks you through a Preflight check, your resume, identity, roles, your edge,
          compensation, location, evaluation tuning, the companies to track, and where files are saved, then a
          Health check. Steps that need writing are handed to your own Claude Code as a prompt you copy. Press
          <b> Check if it saved</b> afterwards.</li>
          <li><b>Customize</b> lists eleven deeper settings, from scoring priorities to the article digest, each
          with a ready-made prompt and a Configured or At defaults tag.</li>
          <li><b>Tell Me About Yourself</b> builds your spoken pitch. <b>Activity Tracker</b> keeps a work-search log
          you can download. <b>Weekly review</b> lists flagged items from the past weeks. <b>Data storage</b> explains
          where your data lives and what would change before you switch anything. <b>Change Log</b> shows what each
          version did, and <b>About</b> has the answers to common questions.</li>
          <li><b>Optional boosters</b> sit under the steps: API keys (an AI draft key, web discovery keys, contact
          email checking and Buffer), Models and cost, Email replies (Gmail), Obsidian vault, language modes, search
          intensity, Help improve setup, and Import past applications.</li>
        </ul>
        <Tip>Editing a setup step only updates your configuration. Your applications, reports and scan history are
        never touched, and you can edit any step again later.</Tip>
      </>
    ),
  },
  {
    id: 'cost', mk: '14', label: 'Models & cost', title: 'The API key, and controlling what you spend',
    body: (
      <>
        <p className="dg-lead">Everything trajecktory does runs on your Claude plan by default, with no per-token
        cost and no API key required. Setup's <b>Models &amp; cost</b> panel is where you tune that, if you ever want to.</p>
        <Shot src="models-cost.png" alt="Setup: Models & cost panel"
          caption="Pick which Claude model runs each step, see an approximate cost per run, and flip billing between your plan and an optional API key." />
        <ul>
          <li>Choose the Claude model for each step (Agent Scan, Evaluate, Insights, Drafts). The defaults
          are the cheaper, calibrated choices, so most people never touch this.</li>
          <li>An optional Anthropic API key is a faster path. When you switch billing to it, the whole workflow
          (not just the writing features) bills your key. It is never required, and you can add or remove it any time.</li>
          <li>The "Bill workflow &amp; drafts to" toggle appears once a key is saved and switches between your Claude
          plan and the key. The dollar estimates apply only to the key path; on the plan there is no per-token cost.</li>
        </ul>
        <Tip>Discovery (Scan) is broad and free. Evaluate runs in small batches rather than reading every scanned
        role at once, so a new user with hundreds of roles does not burn a whole quota in one run. You can change
        the batch size right here.</Tip>
      </>
    ),
  },
  {
    id: 'trouble', mk: '15', label: 'When something looks wrong', title: 'When something looks wrong',
    body: (
      <>
        <p className="dg-lead">A few things look like errors but are not. Here are the common ones, so you do not
        lose time on them.</p>
        <ul>
          <li><b>"0 new" after a scan.</b> Usually correct: nothing new was posted, or the extra web-discovery keys
          are not set. You still get full discovery from API Scan and Agent Scan.</li>
          <li><b>A grey dash in Review.</b> It means "not logged", not zero. The source has no data yet, so it is
          neither a pass nor a miss.</li>
          <li><b>"Some numbers do not tie out" on the Pipeline Overview.</b> Hover the line to see which check
          failed. Treat the affected tiles as suspect until it is fixed.</li>
          <li><b>A contact is missing from the follow-up queue.</b> Open the bar under the filters. They are probably
          held for the day, resting after a cold-outreach cap, or marked Done for now, and they return on their own.</li>
          <li><b>A Claude usage or limit notice.</b> You hit your Claude plan's rolling five-hour usage limit,
          usually from heavy use. Wait a bit and try again. It is not a trajecktory error.</li>
          <li><b>A role you did not expect was closed.</b> Roles that close before you act are marked closed, and
          low-fit roles are recommended against. Reopen moves any of them back to Evaluated.</li>
        </ul>
        <Tip>When in doubt, ask the AI Coach. Describe what you are seeing in plain words and it will tell you
        whether it is expected, and what to do next.</Tip>
      </>
    ),
  },
  {
    id: 'palette', mk: '16', label: 'Command Palette & search', title: 'Command Palette and search: everything, one keystroke away',
    body: (
      <>
        <p className="dg-lead">Press <b>Cmd+K</b> (Mac) or <b>Ctrl+K</b> (Windows) anywhere in the app and
        the command palette opens. Press <b>/</b> to jump to the search box in the top bar. Together they are the
        fastest way to reach any tab or role without using the mouse.</p>
        <Shot src="palette.png" alt="The command palette"
          caption="Type a few letters and the palette filters. Arrow keys move, Enter runs, Esc closes." />
        <ul>
          <li><b>Navigate</b> jumps straight to Pipeline, Follow-Ups, Interview, Roles, Referrals, TA Outreach,
          Insights or Setup.</li>
          <li><b>Jump to role</b> lists your roles as "Company: Role" with the status beside each, so you can open
          any report by typing part of the company name.</li>
          <li>The <b>search box</b> in the top bar searches the screen you are on. On Pipeline it finds roles. On
          Network it finds contacts. As you type, results group into People and Companies, and a click opens the
          contact or the report.</li>
        </ul>
        <Tip>You do not need to remember where anything lives. Type the first two or three letters of what you want
        and the palette finds it.</Tip>
        <Why>trajecktory has seven places to navigate and dozens of actions. A mouse-driven workflow means three to
        five clicks for anything non-obvious. The palette collapses that to one keystroke and two characters.</Why>
      </>
    ),
  },
  {
    id: 'summary', mk: '17', label: 'The whole thing, on one page', title: 'The whole thing, on one page',
    body: (
      <>
        <p className="dg-lead">If you remember nothing else, remember this.</p>
        <ul>
          <li>Start in <b>Today</b> and <b>Pipeline</b>. Add the other tabs as your search grows.</li>
          <li>Let roles flow in through <b>Scan</b>, then evaluate only the strongest.</li>
          <li>Read a report top-down: the score answers "worth it," the tabs hold the evidence.</li>
          <li>Work the queue in <b>Network, Follow-ups</b> before threads go cold. That is the highest-value habit.</li>
          <li>Warm beats cold: use <b>Referrals</b>, <b>Decision Makers</b> and <b>TA Outreach</b>, and build
          visibility in <b>Social</b>.</li>
          <li>Schedule interviews when you book them, answer "Did it happen?" and write the debrief while it is fresh.</li>
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
