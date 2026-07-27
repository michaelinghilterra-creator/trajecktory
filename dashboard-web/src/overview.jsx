// Overview Tab — landing + worklist (Actions module merged in 2026-06-07).
const { useMemo: useMemoO, useState: useStateO } = React;

// Days shown in the Overview "Activity" band. Trimmed to 60 so the sparkline
// stays dense (older history left long empty stretches). Drives the window
// filters, the Avg/wk divisor, the card title, and the Timeline prop.
const ACTIVITY_WINDOW = 60;

const DAILY_QUOTES = [
  { text: "The impediment to action advances action. What stands in the way becomes the way.", author: "Marcus Aurelius" },
  { text: "We suffer more in imagination than in reality.", author: "Seneca" },
  { text: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
  { text: "Make the best use of what is in your power, and take the rest as it happens.", author: "Epictetus" },
  { text: "The mind that is anxious about future events is miserable.", author: "Seneca" },
  { text: "You have power over your mind, not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela" },
  { text: "Our greatest glory is not in never falling, but in rising every time we fall.", author: "Confucius" },
  { text: "Fall seven times, stand up eight.", author: "Japanese proverb" },
  { text: "The only way out is through.", author: "Robert Frost" },
  { text: "A ship in harbor is safe, but that is not what ships are built for.", author: "John A. Shedd" },
  { text: "The best time to plant a tree was 20 years ago. The second best time is now.", author: "Chinese proverb" },
  { text: "Start where you are. Use what you have. Do what you can.", author: "Arthur Ashe" },
  { text: "Success is stumbling from failure to failure with no loss of enthusiasm.", author: "Winston Churchill" },
  { text: "The credit belongs to the man who is actually in the arena.", author: "Theodore Roosevelt" },
  { text: "Whatever you are, be a good one.", author: "Abraham Lincoln" },
  { text: "Give me six hours to chop down a tree and I will spend the first four sharpening the axe.", author: "Abraham Lincoln" },
  { text: "Courage doesn't always roar. Sometimes it's the quiet voice at the end of the day saying, I will try again tomorrow.", author: "Mary Anne Radmacher" },
  { text: "It does not matter how slowly you go as long as you do not stop.", author: "Confucius" },
  { text: "The harder the conflict, the greater the triumph.", author: "George Washington" },
  { text: "You are allowed to be both a masterpiece and a work in progress simultaneously.", author: "Sophia Bush" },
  { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
  { text: "It is not that I'm so smart. But I stay with the questions much longer.", author: "Albert Einstein" },
  { text: "Success usually comes to those who are too busy to be looking for it.", author: "Henry David Thoreau" },
  { text: "Quality is not an act, it is a habit.", author: "Aristotle" },
  { text: "Excellence is never an accident.", author: "Aristotle" },
  { text: "Either write something worth reading or do something worth writing.", author: "Benjamin Franklin" },
  { text: "I'm a great believer in luck, and I find the harder I work, the more I have of it.", author: "Thomas Jefferson" },
  { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
  { text: "The two most important days in your life are the day you are born and the day you find out why.", author: "Mark Twain" },
  { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
  { text: "To be yourself in a world that is constantly trying to make you something else is the greatest accomplishment.", author: "Ralph Waldo Emerson" },
  { text: "Do not go where the path may lead; go instead where there is no path and leave a trail.", author: "Ralph Waldo Emerson" },
  { text: "Gratitude turns what we have into enough.", author: "Aesop" },
  { text: "This too shall pass.", author: "Persian adage" },
  { text: "Not all those who wander are lost.", author: "J.R.R. Tolkien" },
  { text: "Opportunities are usually disguised as hard work, so most people don't recognize them.", author: "Ann Landers" },
  { text: "The brick walls are there to give us a chance to show how badly we want something.", author: "Randy Pausch" },
  { text: "Persistence and resilience only come from having been given the chance to work through difficult problems.", author: "Gever Tulley" },
  { text: "We can't become what we need to be by remaining what we are.", author: "Oprah Winfrey" },
  { text: "Life is 10% what happens to you and 90% how you react to it.", author: "Charles R. Swindoll" },
  { text: "The real gift of gratitude is that the more grateful you are, the more present you become.", author: "Robert Holden" },
  { text: "Do what you do so well that they will want to see it again and bring their friends.", author: "Walt Disney" },
  { text: "Nothing in the world can take the place of persistence. Talent will not. Genius will not. Education will not. Persistence and determination alone are omnipotent.", author: "Calvin Coolidge" },
  { text: "Hard work beats talent when talent doesn't work hard.", author: "Tim Notke" },
  { text: "Believe you can and you're halfway there.", author: "Theodore Roosevelt" },
  { text: "You don't have to see the whole staircase, just take the first step.", author: "Martin Luther King Jr." },
  { text: "The cave you fear to enter holds the treasure you seek.", author: "Joseph Campbell" },
  { text: "Everything you've ever wanted is on the other side of fear.", author: "George Addair" },
  { text: "There is nothing either good or bad, but thinking makes it so.", author: "Shakespeare" },
  { text: "What we fear doing most is usually what we most need to do.", author: "Tim Ferriss" },
  { text: "Don't count the days, make the days count.", author: "Muhammad Ali" },
  { text: "I've missed more than 9,000 shots in my career. I've lost almost 300 games. Twenty-six times I've been trusted to take the game-winning shot and missed. I've failed over and over again in my life. And that is why I succeed.", author: "Michael Jordan" },
  { text: "The question isn't who is going to let me; it's who is going to stop me.", author: "Ayn Rand" },
  { text: "You miss 100% of the shots you never take.", author: "Wayne Gretzky" },
  { text: "It always takes longer than you expect, even when you take into account that it takes longer than you expect.", author: "Hofstadter's Law" },
  { text: "Someone is sitting in the shade today because someone planted a tree a long time ago.", author: "Warren Buffett" },
  { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu" },
  { text: "Be not afraid of going slowly; be afraid only of standing still.", author: "Chinese proverb" },
  { text: "What lies behind us and what lies before us are tiny matters compared to what lies within us.", author: "Ralph Waldo Emerson" },
  { text: "Act as if what you do makes a difference. It does.", author: "William James" },
];

// WARM vs COLD. The relaunch plan's central finding is that these two channels
// convert very differently: a handful of warm touches produced almost as many
// screens as two orders of magnitude more cold applications. At equal rates that
// warm result would be a roughly 1-in-64,000 coincidence.
//
// A pooled funnel cannot show that, and pooling is not harmless. Dividing all
// screens by all applications yields a flattering blended figure that hides a
// cold rate sitting BELOW the market median, so the pooled number reads as
// "performing fine" when the channel carrying nearly all the volume is not.
// (Rates described, not printed: this is a tracked file in a public repo and the
// user's conversion performance is his, not the product's.)
//
// Warm = contact with a PERSON existed before or alongside the application, in
// either direction. Three sub-types, and the split between them is the most
// strategically loaded distinction in the tracker:
//   inbound   — they found him. Real, but not scalable: you cannot make it happen.
//   outbound  — he reached them. The ONLY scalable warm channel, and the one the
//               40-touch test is measuring.
//   referral  — introduced. Highest yield in the market data, currently zero rows.
// Everything else is cold. Deliberately strict: a row is warm only if TAGGED warm,
// so an untagged row is under-counted rather than silently counted as cold.
const isWarmApp = (a) => a && (a.inbound === true || a.outbound === true || a.source === 'Referral');
const warmKind = (a) => !a ? null
  : a.source === 'Referral' ? 'referral'
  : a.outbound === true ? 'outbound'
  : a.inbound === true ? 'inbound' : null;

// Cold apply to screen, median, from Ashby's ~100M-application dataset (carried in
// the relaunch plan). Used as the ONLY benchmark on this page: it is sourced, and
// it is channel-specific, which the retired "22% benchmark" was neither.
const COLD_APPLY_BENCHMARK = { lo: 3.6, hi: 4.7, label: '3.6-4.7% market median' };

window.OverviewTab = function OverviewTab({ apps, onOpen, onAction, setTab, search }) {
  // The weekly scorecard: the seven metrics the relaunch plan says to manage to.
  // They already existed, two clicks deep on Insights -> Review, while this page
  // led with counts of what the SCANNER produced. The plan decided what to look
  // at; this makes the landing page agree with it.
  const [weekly, setWeekly] = useStateO(null);
  React.useEffect(() => {
    let live = true;
    fetch('/api/metrics/weekly', { headers: { accept: 'application/json' } })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (live && d) setWeekly(d); })
      .catch(() => {});
    return () => { live = false; };
  }, []);
  // Funnel data — cumulative-ish (Applied = applied + responded + interview + offer, etc.)
  // Actually the brief says Evaluated → Applied → Responded → Interview → Offer
  // Treat as a count of items that have at least reached that stage.
  const funnel = useMemoO(() => {
    // Short axis labels so the 9-rung ladder doesn't overlap on the x-axis.
    // `label` keeps the full name for tooltips + the conversion rows below.
    const SHORT = {
      "Evaluated": "Eval", "Applied": "Applied", "Responded": "Replied",
      "Phone Screen": "Screen", "1st Interview": "1st", "2nd Interview": "2nd",
      "3rd Interview": "3rd", "4th Interview": "4th", "Offer": "Offer",
    };
    // The FIRST rung is membership, not progression. Every tracked row was
    // evaluated: an evaluation is what creates the row. Asking
    // appReached(a, "Evaluated") scored every evaluated-then-declined row
    // (Discarded, SKIP, Not a Fit) as never-evaluated, because none of those sit
    // on FUNNEL_ORDER. The rung collapsed onto Applied, both reading the same count,
    // and the chart reported a 100% evaluate-to-apply conversion while hiding the single
    // largest drop in the pipeline. An earlier pass swung the other way and
    // counted every row including Closed. window.enteredFunnel is the one rule
    // now, mirroring enteredFunnel() on the server so the two cannot disagree.
    // Every LATER rung still counts rows that actually reached it. This
    // reconciles with the Sankey rather than contradicting it: that diagram
    // partitions the same rows into progressed + dismissed + aged-out, and this
    // rung is the first two of those three added together.
    // Applied additionally credits Rejected / No Response, since either implies
    // an application was sent.
    return window.FUNNEL_ORDER.map((stage, i) => {
      let stageApps;
      if (i === 0) {
        stageApps = apps.filter(a => window.enteredFunnel(a));
      } else if (stage === "Applied") {
        stageApps = apps.filter(a => window.appReached(a, "Applied") || a.status === "Rejected" || a.status === "No Response");
      } else {
        stageApps = apps.filter(a => window.appReached(a, stage));
      }
      return {
        label: stage,
        short: SHORT[stage] || stage,
        value: stageApps.length,
        apps: stageApps,
        // ONE HUE, stepped. A funnel is an ORDERED sequence, and ordered data takes a
        // sequential encoding: one hue, light to dark. It used to take its bar colour
        // from STATUS_META, which gives every rung a different hue — violet, blue,
        // cyan, four ambers, green. That reads as "nine different kinds of thing" for
        // what is nine stages of one thing, and it failed a CVD validator three ways:
        // Evaluated and Applied came out ΔE 0.3 apart for deuteranopes (identical, and
        // they are the two largest bars), and two of the amber rungs were ΔE 4.8 apart
        // in NORMAL vision, which nobody can separate. Height already carries the
        // magnitude, so the hue was decorative and actively misleading.
        //
        // The alpha floor is 0.75, not lower: below that the palest rungs drop under
        // 3:1 against the light themes' white panels. Checked across all nine.
        // STATUS_META keeps its per-status hues — those are identity for badges and
        // pills, where distinguishing Rejected from Offer at a glance is the job.
        color: `rgba(var(--accent-rgb), ${(1 - (i * 0.25) / (window.FUNNEL_ORDER.length - 1)).toFixed(3)})`,
      };
    });
  }, [apps]);

  // Action Required = score >= 4.0 AND status === "Evaluated"
  const actionRequired = useMemoO(
    () => apps.filter(a => a.score >= 4.0 && a.status === "Evaluated").sort((a, b) => b.score - a.score),
    [apps]
  );

  // Active apps = exclude Closed (aged-out, not user-actioned).
  const activeApps = useMemoO(() => apps.filter(a => a.status !== "Closed"), [apps]);

  // Recent activity (last 14d, active apps only)
  const recent = useMemoO(() => activeApps.filter(a => window.daysAgo(a.date) <= 14).length, [activeApps]);
  // Read the same rungs the funnel below renders so the card and the funnel can
  // never disagree. Counting live status instead would undercount: anyone who
  // replied and was later rejected drops out of the numerator (they now read
  // "Rejected") while still sitting in the denominator.
  const { responded, appliedN, responseRate } = useMemoO(() => {
    const at = stage => funnel.find(f => f.label === stage)?.value || 0;
    const appliedN = at("Applied"), responded = at("Responded");
    return { responded, appliedN, responseRate: appliedN ? Math.round((responded / appliedN) * 100) : 0 };
  }, [funnel]);
  const avgScore = useMemoO(() => {
    const scored = activeApps.filter(a => a.score != null);
    if (!scored.length) return "-";
    return (scored.reduce((s, a) => s + a.score, 0) / scored.length).toFixed(2);
  }, [activeApps]);


  // Score distribution insights
  const scoreInsights = useMemoO(() => {
    const appliedStatuses = ["Applied", "Responded", "Offer", "Rejected", "No Response", ...window.INTERVIEW_STAGES];
    const bands = [
      { label: "Strong",  min: 4.0, max: Infinity, color: "var(--green)"  },
      { label: "Border",  min: 3.0, max: 4.0,      color: "var(--yellow)" },
      { label: "Weak",    min: 0,   max: 3.0,       color: "var(--red)"   },
    ];
    const appliedApps = apps.filter(a => appliedStatuses.includes(a.status) && a.score != null);
    const appliedAvg = appliedApps.length
      ? (appliedApps.reduce((s, a) => s + a.score, 0) / appliedApps.length).toFixed(1)
      : "-";
    const scoredApps = apps.filter(a => a.score != null);
    const portfolioAvg = scoredApps.length
      ? (scoredApps.reduce((s, a) => s + a.score, 0) / scoredApps.length).toFixed(1)
      : "-";
    return {
      bands: bands.map(b => {
        const total = apps.filter(a => a.score != null && a.score >= b.min && a.score < b.max).length;
        const applied = apps.filter(a => a.score != null && a.score >= b.min && a.score < b.max && appliedStatuses.includes(a.status)).length;
        const rate = total ? Math.round((applied / total) * 100) : 0;
        return { ...b, total, applied, rate };
      }),
      appliedAvg,
      portfolioAvg,
    };
  }, [apps]);

  // Activity insights (ACTIVITY_WINDOW-day window)
  const activityInsights = useMemoO(() => {
    const last7  = apps.filter(a => window.daysAgo(a.date) <= 6).length;
    const prior7 = apps.filter(a => window.daysAgo(a.date) >= 7 && window.daysAgo(a.date) <= 13).length;
    const windowCount = apps.filter(a => window.daysAgo(a.date) <= ACTIVITY_WINDOW - 1).length;
    const avgPerWeek = (windowCount * 7 / ACTIVITY_WINDOW).toFixed(1);
    const trend = last7 - prior7;
    // Peak day in window
    const dayCounts = {};
    apps.forEach(a => { if (window.daysAgo(a.date) <= ACTIVITY_WINDOW - 1) dayCounts[a.date] = (dayCounts[a.date] || 0) + 1; });
    const peakDate = Object.keys(dayCounts).reduce((m, k) => (dayCounts[k] > (dayCounts[m] || 0) ? k : m), Object.keys(dayCounts)[0] || null);
    const peakCount = peakDate ? dayCounts[peakDate] : 0;
    const peakLabel = peakDate
      ? new Date(peakDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
      : "-";
    return { last7, prior7, trend, avgPerWeek, peakCount, peakLabel };
  }, [apps]);

  // Daily quote — rotates by day-of-year so it changes each day, stable within a session
  const dailyQuote = useMemoO(() => {
    const start = new Date(window.TODAY.getFullYear(), 0, 0);
    const dayOfYear = Math.floor((window.TODAY - start) / 86400000);
    return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length];
  }, []);

  // Shared callout styling so the coach line and the daily quote render
  // identically (accent left-border, accent-bg fill, rounded right corners).
  const calloutBoxStyle = {
    borderLeft: "3px solid var(--accent)",
    padding: "10px 16px",
    background: "var(--accent-bg)",
    borderRadius: "0 6px 6px 0",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  };
  const calloutTextStyle = { fontStyle: "italic", color: "var(--text)", fontSize: 13, lineHeight: 1.55 };

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* Greeting */}
      <div className="greeting">
        <h1>{(() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })()}</h1>
        <span className="sub">{window.TODAY.toUTCString().slice(0, 16)} · {apps.length} entries tracked</span>
      </div>

      {/* Daily quote */}
      <div style={calloutBoxStyle}>
        <span style={calloutTextStyle}>
          "{dailyQuote.text}"
        </span>
        <span style={{ color: "var(--text-mute)", fontSize: 11 }}>· {dailyQuote.author}</span>
      </div>

      {/* ── THIS WEEK: the plan's floors, the controllable inputs ──────────────
          These four replaced Total Tracked / Pending Decision / Response Rate /
          Avg Score. Three of those four counted what the SCANNER produced, which
          rises whether or not you do anything, so the page reported progress from
          a machine running unattended while the behaviours that actually produce
          offers were invisible. The relaunch plan names seven metrics to manage
          to; they lived two clicks deep on Insights -> Review. A landing page
          should answer "am I on pace" first, and it now does. */}
      <div className="grid cols-4">
        {(() => {
          const m = weekly && weekly.metrics ? weekly.metrics : null;
          const floors = (weekly && weekly.floors) || {};
          const cell = (key, label, floor, fmt = (v) => v) => {
            const d = m ? m[key] : null;
            // "not logged" is NOT zero. A blank source must never read as a miss,
            // which is the whole reason collectWeeklyMetrics carries `available`.
            const unlogged = d && d.available === false;
            const v = d ? d.value : null;
            const under = !unlogged && floor != null && typeof v === 'number' && v < floor;
            // A metric with NO floor is neither met nor missed, so it stays neutral.
            // Colouring it green because it failed a comparison it never had made
            // "Screens booked 0" render as a success in green, which is the exact
            // false-confidence this dashboard is being cleaned of.
            const hasVerdict = floor != null && !unlogged;
            const color = unlogged ? 'var(--text-mute)'
              : !hasVerdict ? 'var(--text)'
              : under ? 'var(--orange)' : 'var(--green)';
            return (
              <div className="kpi" key={key} title={d ? d.source : 'loading'}>
                <span className="kpi-label">{label}</span>
                <span className="kpi-value" style={{ color }}>
                  {!m ? '·' : unlogged ? '-' : fmt(v)}
                </span>
                <span className="kpi-delta">
                  {floor != null ? `floor ${fmt(floor)}` : 'this week'}
                  {!m ? '' : unlogged ? ' · not logged' : !hasVerdict ? '' : under ? ' · below floor' : ' · met'}
                </span>
              </div>
            );
          };
          return [
            cell('verifiedTouches', 'Verified touches', floors.verifiedTouches ?? 13),
            cell('linkedinConnects', 'LinkedIn connects', floors.linkedinConnects ?? 50),
            cell('cadencePct', 'Cadence adherence', floors.cadencePct ?? 70, v => `${v}%`),
            cell('screensBooked', 'Screens booked', null),
          ];
        })()}
      </div>

      {/* ── OUTCOMES: lagging, and honest about which channel produced them ──── */}
      <div className="grid cols-4" style={{ marginTop: 12 }}>
        {(() => {
          const iApplied = window.FUNNEL_ORDER.indexOf('Applied');
          const iResp = window.FUNNEL_ORDER.indexOf('Responded');
          const sent = apps.filter(a => window.FUNNEL_ORDER.indexOf(a.reached) >= iApplied);
          const rate = (rows) => {
            const n = rows.length;
            const k = rows.filter(a => window.FUNNEL_ORDER.indexOf(a.reached) >= iResp).length;
            return { n, k, pct: n ? Math.round((k / n) * 1000) / 10 : null };
          };
          const warm = rate(sent.filter(isWarmApp));
          const cold = rate(sent.filter(a => !isWarmApp(a)));
          const closed = apps.filter(a => a.status === 'Closed').length;
          const stalePct = apps.length ? Math.round((closed / apps.length) * 100) : 0;
          // Coverage guard. Only 2 rows in the tracker carry an [inbound] tag and
          // none carry [referral:], while the plan reconstructs 3-4 real warm
          // touches. So the warm column is UNDER-COUNTED, and saying so is the
          // difference between a split funnel and a fabricated one.
          const warmTagged = apps.filter(isWarmApp).length;
          const undercounted = warmTagged < 4;
          // Break warm into its sub-types for the tooltip. Inbound and outbound
          // are both "warm" for the rate, but only outbound answers the question
          // the next three weeks are asking.
          const kinds = sent.filter(isWarmApp).reduce((m, a) => {
            const k = warmKind(a); if (k) m[k] = (m[k] || 0) + 1; return m;
          }, {});
          const kindLabel = Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ') || 'none tagged';
          return [
            <div className="kpi" key="cold" title="Applications with no prior contact. Benchmark is Ashby's cold-apply-to-screen median across ~100M applications.">
              <span className="kpi-label">Cold reply rate</span>
              <span className="kpi-value" style={{ color: cold.pct != null && cold.pct >= COLD_APPLY_BENCHMARK.lo ? 'var(--green)' : 'var(--orange)' }}>
                {cold.pct == null ? '-' : `${cold.pct}%`}
              </span>
              <span className="kpi-delta">{cold.k} of {cold.n} · {COLD_APPLY_BENCHMARK.label}</span>
            </div>,
            <div className="kpi" key="warm" title={`Contact with a person existed before the application, either direction. Tagged: ${kindLabel}. Only the outbound share is scalable.`}>
              <span className="kpi-label">Warm reply rate</span>
              <span className="kpi-value" style={{ color: undercounted ? 'var(--text-mute)' : 'var(--green)' }}>
                {warm.n ? `${warm.pct}%` : '-'}
              </span>
              <span className="kpi-delta">
                {warm.k} of {warm.n} · {kindLabel}
              </span>
            </div>,
            <div className="kpi" key="stale" title="Postings that closed before you could act. Evaluation effort spent on roles that expired.">
              <span className="kpi-label">Expired before action</span>
              <span className="kpi-value" style={{ color: stalePct > 10 ? 'var(--orange)' : 'var(--green)' }}>{stalePct}%</span>
              <span className="kpi-delta">{closed} of {apps.length} · target under 10%</span>
            </div>,
            <div className="kpi" key="wip" title="Applications sent but not serviced. The plan's WIP limit, which governs volume in place of a cap.">
              <span className="kpi-label">Unserviced (WIP)</span>
              <span className="kpi-value">{weekly && weekly.metrics && weekly.metrics.unservicedApplications ? weekly.metrics.unservicedApplications.value : '·'}</span>
              <span className="kpi-delta">{apps.filter(a => a.status === 'Evaluated').length} pending decision</span>
            </div>,
          ];
        })()}
      </div>

      {/* ── ACTIONS: what YOU did, and cohorts by send-week ──────────────────
          The band below still plots tracker entries, which is scanner output: it
          rises on a day you did nothing because a scheduled scan added rows, and
          stays flat on a day you sent ten applications by hand. This card counts
          actions instead. Touches and connects are DECLARED with available:false
          rather than omitted, because "you sent none" and "nothing logs this yet"
          are different facts and only one of them is your fault. Both series
          start filling with the outreach motion. */}
      {/* Full-width Actions band. Tracker intake removed 2026-07-27: it plotted
          total scanner volume, which the user explicitly does not track. */}
      <window.ActionsCard />

      {/* Pipeline Funnel · Score Distribution — 50/50 below the activity band */}
      <div className="grid cols-2" style={{ alignItems: "stretch" }}>
        <div className="card padded-lg" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <span className="card-title">Pipeline Funnel</span>
            <span className="card-meta">Evaluated → Offer</span>
          </div>
          <window.FunnelChart data={funnel} height={160} />
          <div className="row" style={{ marginTop: "auto", paddingTop: 14, gap: 12, flexWrap: "wrap" }}>
            {funnel.slice(0, 4).map((f, i) => {
              const next = funnel[i + 1];
              if (!next) return null;
              const conv = Math.round((next.value / Math.max(f.value, 1)) * 100);
              return (
                <div key={f.label} className="row mono" style={{ fontSize: 10.5, color: "var(--text-mute)", gap: 4 }}>
                  {f.label} <span style={{ color: "var(--text-dim)" }}>→</span> {next.label}
                  <span className="mono" style={{ color: "var(--green)", marginLeft: 4 }}>{conv}% adv</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card padded-lg" style={{ display: "flex", flexDirection: "column" }}>
          <div className="card-head">
            <span className="card-title">Score Distribution</span>
            <span className="card-meta mono">
              <span style={{ color: "var(--green)" }}>● </span>{apps.filter(a => a.score >= 4.0).length} strong &nbsp;
              <span style={{ color: "var(--yellow)" }}>● </span>{apps.filter(a => a.score >= 3.0 && a.score < 4.0).length} borderline &nbsp;
              <span style={{ color: "var(--red)" }}>● </span>{apps.filter(a => a.score != null && a.score < 3.0).length} weak
            </span>
          </div>
          <window.Histogram apps={apps} height={160} />
          <div className="col" style={{ marginTop: "auto", paddingTop: 14, gap: 6 }}>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              {scoreInsights.bands.map(b => (
                <div key={b.label} className="row mono" style={{ fontSize: 10.5, color: "var(--text-mute)", gap: 4 }}>
                  <span style={{ color: b.color }}>●</span> {b.label}
                  <span className="mono" style={{ color: b.rate > 0 ? "var(--green)" : "var(--text-dim)", marginLeft: 2 }}>{b.rate}% applied</span>
                  <span style={{ color: "var(--text-dim)" }}>·</span>
                  <span className="mono">{b.total} roles</span>
                </div>
              ))}
            </div>
            <div className="row mono" style={{ fontSize: 10.5, color: "var(--text-mute)", gap: 4 }}>
              Applied avg
              <span className="mono" style={{ color: "var(--accent)", marginLeft: 2 }}>{scoreInsights.appliedAvg}</span>
              <span style={{ color: "var(--text-dim)" }}>·</span>
              Portfolio avg
              <span className="mono" style={{ color: "var(--text-dim)" }}>{scoreInsights.portfolioAvg}</span>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
