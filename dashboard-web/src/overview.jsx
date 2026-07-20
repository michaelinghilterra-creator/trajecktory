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

window.OverviewTab = function OverviewTab({ apps, onOpen, onAction, setTab, search }) {
  const [selected, setSelected] = useStateO(new Set());
  const [scoreFilter, setScoreFilter] = useStateO(0);
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
    // Every rung, Evaluated included, counts rows that actually REACHED it.
    // Evaluated previously counted every row in the tracker, folding in every row
    // that never entered the funnel at all (Discarded, Closed, SKIP, Not a Fit).
    // That understates the first conversion by the ratio of tracked rows to
    // evaluated ones, which on a well-filtered tracker is several-fold. It also
    // skewed every downstream "% of entry" in the chart tooltip, which divides by
    // this bar. The server's stageFunnelStats has always computed it this way;
    // this makes the two agree.
    // Applied additionally credits Rejected / No Response, since either implies
    // an application was sent.
    return window.FUNNEL_ORDER.map(stage => {
      let stageApps;
      if (stage === "Applied") {
        stageApps = apps.filter(a => window.appReached(a, "Applied") || a.status === "Rejected" || a.status === "No Response");
      } else {
        stageApps = apps.filter(a => window.appReached(a, stage));
      }
      return {
        label: stage,
        short: SHORT[stage] || stage,
        value: stageApps.length,
        apps: stageApps,
        color: window.STATUS_META[stage]?.color || "var(--accent)",
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
    if (!scored.length) return "—";
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
      : "—";
    const scoredApps = apps.filter(a => a.score != null);
    const portfolioAvg = scoredApps.length
      ? (scoredApps.reduce((s, a) => s + a.score, 0) / scoredApps.length).toFixed(1)
      : "—";
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
      : "—";
    return { last7, prior7, trend, avgPerWeek, peakCount, peakLabel };
  }, [apps]);

  // ── Worklist (merged from Actions module) ──────────────────────────────
  // All Evaluated entries filtered by chip score + global search, sorted by
  // score desc, recency desc. The list below the chart row replaces the
  // former "Action Required" card and the standalone Actions tab.
  const pending = useMemoO(() => {
    return apps
      .filter(a => a.status === "Evaluated")
      .filter(a => a.score >= scoreFilter)
      .filter(a => {
        if (!search) return true;
        const ql = search.toLowerCase();
        return `${a.company} ${a.role} ${a.archetype}`.toLowerCase().includes(ql);
      })
      .sort((a, b) => b.score - a.score || window.daysAgo(b.date) - window.daysAgo(a.date));
  }, [apps, scoreFilter, search]);

const toggleRow = (id) => setSelected(s => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const toggleAll = () => {
    if (selected.size === pending.length) setSelected(new Set());
    else setSelected(new Set(pending.map(a => a.id)));
  };
  const allChk = selected.size === pending.length && pending.length > 0;
  const someChk = selected.size > 0 && !allChk;
  const bulk = (newStatus) => {
    pending.filter(a => selected.has(a.id)).forEach(a => onAction(a, newStatus, true));
    setSelected(new Set());
  };

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

      {/* KPIs */}
      <div className="grid cols-4">
        <div className="kpi">
          {/* Counts every tracked row, matching the header and the funnel's base.
              This card used to exclude Closed while both of those included it,
              so the page showed two different totals with nothing explaining the
              gap. Closed stays visible as a sub-note instead of a silent subtraction. */}
          <span className="kpi-label">Total Tracked</span>
          <span className="kpi-value">{apps.length}</span>
          <span className="kpi-delta">{recent} added in last 14d · {apps.filter(a => a.status === "Closed").length} closed before you could act</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Pending Decision</span>
          <span className="kpi-value" style={{ color: "var(--accent)" }}>{apps.filter(a => a.status === "Evaluated").length}</span>
          <span className="kpi-delta">{actionRequired.length} marked hot (≥4.0)</span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Response Rate</span>
          <span className="kpi-value">{responseRate}%</span>
          <span className={`kpi-delta ${responseRate >= 22 ? "up" : "down"}`}>
            {responded} of {appliedN} replied · {responseRate >= 22 ? "▲ above" : "▼ below"} 22% benchmark
          </span>
        </div>
        <div className="kpi">
          <span className="kpi-label">Avg Score</span>
          <span className="kpi-value">{avgScore}</span>
          <span className="kpi-delta">across all logged roles</span>
        </div>
      </div>

      {/* Activity · last N days — full-width band on top */}
      <div className="card padded-lg" style={{ display: "flex", flexDirection: "column" }}>
        <div className="card-head">
          <span className="card-title">Activity · last {ACTIVITY_WINDOW} days</span>
          <span className="card-meta mono">
            {apps.filter(a => window.daysAgo(a.date) <= ACTIVITY_WINDOW - 1).length} entries &nbsp;·&nbsp;
            Last 7d <span style={{ color: "var(--accent)" }}>{activityInsights.last7}</span>&nbsp;·&nbsp;
            Prior 7d <span style={{ color: "var(--text-dim)" }}>{activityInsights.prior7}</span>
            <span style={{ color: activityInsights.trend > 0 ? "var(--green)" : activityInsights.trend < 0 ? "var(--red)" : "var(--text-dim)", marginLeft: 6 }}>
              {activityInsights.trend > 0 ? `▲ +${activityInsights.trend}` : activityInsights.trend < 0 ? `▼ ${activityInsights.trend}` : "— flat"}
            </span>
          </span>
        </div>
        <window.Timeline apps={apps} days={ACTIVITY_WINDOW} height={72} />
        <div className="row mono" style={{ marginTop: 10, fontSize: 10.5, color: "var(--text-mute)", gap: 4 }}>
          Avg/wk
          <span className="mono" style={{ color: "var(--text-dim)", marginLeft: 2 }}>{activityInsights.avgPerWeek}</span>
          <span style={{ color: "var(--text-dim)" }}>·</span>
          Peak
          <span className="mono" style={{ color: "var(--text-dim)" }}>{activityInsights.peakCount} on {activityInsights.peakLabel}</span>
        </div>
      </div>

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

      {/* Pending Roles — compact Needs-Attention row layout */}
      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title"><span className="dot" />Pending Roles</span>
          <span className="card-meta mono">{pending.length} item{pending.length === 1 ? "" : "s"}</span>
        </div>

        <div className="row" style={{ gap: 8, marginBottom: 10, marginTop: 6 }}>
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em" }}>Score ≥</span>
          {[0, 3.0, 3.5, 4.0, 4.5].map(s => (
            <span key={s} className={`chip ${scoreFilter === s ? "on" : ""}`} onClick={() => setScoreFilter(s)}>{s === 0 ? "any" : s.toFixed(1)}</span>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {pending.length === 0 && <div className="no-data" style={{ padding: "8px 0" }}>No pending decisions match your filter.</div>}
          {pending.map(a => {
            const sit = window.daysAgo(a.date);
            const sc = a.score;
            const color = sc != null && sc >= 4.0 ? "var(--accent)"
                        : sc != null && sc >= 3.5 ? "var(--yellow)"
                        : "var(--text-mute)";
            const label = sit === 0 ? "Scored today. Apply or skip"
                        : sit <= 3  ? `Scored ${sit}d ago, still fresh`
                        : sit <= 7  ? `Scored ${sit}d ago, decide soon`
                                    : `${sit}d silent, getting stale`;
            const labelColor = sit > 7 ? "var(--red)" : sit > 3 ? "var(--yellow)" : "var(--accent)";
            return (
              <div key={a.id} onClick={() => onOpen(a)}
                style={{ display: "grid", gridTemplateColumns: "28px 1fr auto auto", gap: 12, alignItems: "center",
                  padding: "9px 11px", borderRadius: 9, cursor: "pointer",
                  background: "var(--panel-2)", border: "1px solid var(--border)" }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, display: "grid", placeItems: "center",
                  background: "var(--panel)", border: "1px solid var(--border)", color }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={window.ICON.briefcase} /></svg>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.company}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-mute)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.role}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color: labelColor, whiteSpace: "nowrap" }}>{label}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <window.ScoreChip score={a.score} />
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn primary sm" onClick={(e) => { e.stopPropagation(); onOpen(a); }}>Apply</button>
                    <button className="btn sm" onClick={(e) => { e.stopPropagation(); onAction(a, "SKIP"); }}>Skip</button>
                    <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); onOpen(a); }}>Review</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
