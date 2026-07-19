/* LinkedIn SSI Management Module — Redesigned per design handoff */
const { useState, useEffect, useMemo, useCallback } = React;

// Order activity newest-first by when it was logged (loggedAt), falling back to the
// activity date for legacy rows that predate the loggedAt stamp. This makes a just-
// logged touch float to the top even when several entries share the same calendar day.
const byLoggedAtDesc = (a, b) =>
  (b.loggedAt || b.date || "").localeCompare(a.loggedAt || a.date || "");

// Alphabetical by name (A-Z). Full-name compare sorts by first name first, which
// is the natural order for the influencer picker dropdowns.
const byNameAsc = (a, b) => (a.name || "").localeCompare(b.name || "");

/* Radial gauge: 270° arc, value out of max, with target tick. */
function RadialGauge({ value, max = 100, target, size = 196, stroke = 14 }) {
  const r = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const START = 135, SWEEP = 270;
  const toXY = (deg) => {
    const a = (deg * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  const arcPath = (fromDeg, toDeg) => {
    const [x1, y1] = toXY(fromDeg);
    const [x2, y2] = toXY(toDeg);
    const large = toDeg - fromDeg > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  };
  const frac = Math.max(0, Math.min(1, value / max));
  const endDeg = START + SWEEP * frac;
  const targetDeg = target != null ? START + SWEEP * (target / max) : null;
  const [tx, ty] = targetDeg != null ? toXY(targetDeg) : [0, 0];

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="gaugeGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
      <path d={arcPath(START, START + SWEEP)} fill="none" stroke="var(--panel-2)" strokeWidth={stroke} strokeLinecap="round" />
      <path d={arcPath(START, endDeg)} fill="none" stroke="url(#gaugeGrad)" strokeWidth={stroke} strokeLinecap="round"
        style={{ filter: "drop-shadow(0 0 6px rgba(167,139,250,.45))" }} />
      {targetDeg != null && (
        <line x1={cx + (r - stroke / 1.4) * Math.cos((targetDeg * Math.PI) / 180)}
              y1={cy + (r - stroke / 1.4) * Math.sin((targetDeg * Math.PI) / 180)}
              x2={cx + (r + stroke / 1.4) * Math.cos((targetDeg * Math.PI) / 180)}
              y2={cy + (r + stroke / 1.4) * Math.sin((targetDeg * Math.PI) / 180)}
              stroke="var(--text-dim)" strokeWidth={2} strokeLinecap="round" />
      )}
    </svg>
  );
}

/* Sparkline from array of numbers */
function Sparkline({ data, w = 120, h = 32, color = "var(--accent)" }) {
  const vals = data.filter((d) => d != null);
  if (vals.length < 2) return <svg width={w} height={h} />;
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const step = w / (data.length - 1);
  const pts = data.map((d, i) => {
    if (d == null) return null;
    const x = i * step;
    const y = h - 4 - ((d - min) / span) * (h - 8);
    return [x, y];
  }).filter(Boolean);
  const dPath = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = dPath + ` L ${pts[pts.length - 1][0].toFixed(1)} ${h} L ${pts[0][0].toFixed(1)} ${h} Z`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <defs>
        <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#spark)" />
      <path d={dPath} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {pts.length > 0 && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.6" fill={color} />}
    </svg>
  );
}

/* Weekly trend chart */
function WeekTrend({ weeks, target, height = 120 }) {
  const totals = weeks.map((w) =>
    w.brand == null ? null : w.brand + w.people + w.engage + w.rel
  );
  const max = 100;
  return (
    <div style={{ position: "relative", height }}>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: (target / max) * height,
        borderTop: "1px dashed rgba(139,139,148,.4)", height: 0 }}>
        <span style={{ position: "absolute", right: 0, top: -16, fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-mute)" }}>
          target {target}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: "100%" }}>
        {weeks.map((w, i) => {
          const t = totals[i];
          const hPct = t == null ? 0 : (t / max) * 100;
          return (
            <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", justifyContent: "flex-end", gap: 6 }}>
              {t == null ? (
                <div style={{ width: "100%", height: 3, borderRadius: 2, background: "var(--panel-2)" }} />
              ) : (
                <div style={{
                  width: "100%", height: `${hPct}%`, minHeight: 4, borderRadius: "4px 4px 2px 2px",
                  background: "linear-gradient(180deg, var(--accent), rgba(167,139,250,.35))",
                }} />
              )}
              <span style={{ fontFamily: "var(--mono)", fontSize: 8.5, color: "var(--text-mute)" }}>{w.wk}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LinkedInSSITab() {
  const [ssiData, setSsiData] = useState(null);
  const [influencers, setInfluencers] = useState([]);
  const [engagementLog, setEngagementLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("dashboard");
  const [selectedInfluencer, setSelectedInfluencer] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/linkedin-ssi/summary').then(r => r.json()).catch(e => { console.error('Summary fetch:', e); return { currentSsi: null, targetSsi: 60, weeks: [] }; }),
      fetch('/api/linkedin-ssi/influencers').then(r => r.json()).catch(e => { console.error('Influencers fetch:', e); return []; }),
      fetch('/api/linkedin-ssi/engagement-log').then(r => r.json()).catch(e => { console.error('Log fetch:', e); return []; })
    ]).then(([ssi, infl, log]) => {
      // Normalize data: map API names to design spec names.
      // score and prevScore are null until the user has actually recorded weeks.
      // They used to fall back to 39 and a literal 35, so a fresh install showed a
      // 39/100 gauge and a green "+4 this wk" for a measurement nobody had taken.
      const weeks = (ssi.weeks || []).map(w => ({
        wk: w.weekNum,
        date: w.weekOf,
        brand: w.brand,
        people: w.findPeople,
        engage: w.engageInsights,
        rel: w.relationships
      }));
      const totals = weeks
        .filter(w => w.brand != null && w.people != null && w.engage != null && w.rel != null)
        .map(w => w.brand + w.people + w.engage + w.rel);
      const normalized = {
        score: (ssi.currentSsi === null || ssi.currentSsi === undefined) ? null : ssi.currentSsi,
        target: ssi.targetSsi || 60,
        weeks,
        // Only meaningful with two recorded weeks to compare.
        prevScore: totals.length >= 2 ? totals[totals.length - 2] : null,
      };
      setSsiData(normalized);
      setInfluencers(infl);
      setEngagementLog([...(log || [])].sort(byLoggedAtDesc));
      setLoading(false);
    });
  }, []);

  const stats = useMemo(() => {
    if (!influencers.length) return { following: 0, connected: 0, engaged: 0 };
    return {
      following: influencers.filter(i => i.following).length,
      connected: influencers.filter(i => i.connected).length,
      engaged: influencers.filter(i => i.engaged).length
    };
  }, [influencers]);

  if (loading) return <div style={{ padding: "20px", color: "var(--text-dim)" }}>Loading LinkedIn SSI data…</div>;
  if (!ssiData) return <div style={{ padding: "20px", color: "var(--text-dim)" }}>Failed to load SSI data. Please refresh.</div>;

  return (
    <div style={{ flex: 1, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <div>
        {/* Subtabs */}
        <div className="subtabs">
          <button className={"subtab" + (activeView === "dashboard" ? " active" : "")} onClick={() => setActiveView("dashboard")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", display: "inline-block"}}><path d={window.ICON.pulse} /></svg>
            Overview
          </button>
          <button className={"subtab" + (activeView === "influencers" ? " active" : "")} onClick={() => setActiveView("influencers")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "6px", display: "inline-block"}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Influencers
          </button>
          <button className={"subtab" + (activeView === "activity" ? " active" : "")} onClick={() => setActiveView("activity")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "6px", display: "inline-block"}}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Activity Log
          </button>
          <button className={"subtab" + (activeView === "weekly" ? " active" : "")} onClick={() => setActiveView("weekly")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "6px", display: "inline-block"}}><path d="M4 9h16M4 9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2M4 9v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9M9 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2H9V5z"/></svg>
            Weekly Tracker
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div className="ta-head">
          <div>
            <h1>LinkedIn SSI</h1>
            <div className="sub">
              score {ssiData?.score ?? '—'} / 100 · target {ssiData?.target ?? 60} · {influencers.length} influencers tracked · {engagementLog.filter(a => new Date(a.date) >= new Date(Date.now() - 7*24*60*60*1000)).length} touchpoints this week
            </div>
          </div>
        </div>

        {/* DASHBOARD */}
        {activeView === "dashboard" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Row 1: KPIs */}
            <div className="grid cols-4">
              <div className="kpi">
                <span className="k">Following</span>
                <span className="v">{stats.following}</span>
                <span className="sub">{stats.following}/{influencers.length} influencers</span>
              </div>
              <div className="kpi">
                <span className="k">Connected</span>
                <span className="v">{stats.connected}</span>
                <span className="sub">LinkedIn connections</span>
              </div>
              <div className="kpi">
                <span className="k">Engaged</span>
                <span className="v">{stats.engaged}</span>
                <span className="sub">with recent activity</span>
              </div>
              <div className="kpi">
                <span className="k">This Week</span>
                <span className="v">{engagementLog.filter(a => new Date(a.date) >= new Date(Date.now() - 7*24*60*60*1000)).length}</span>
                <span className="sub">touchpoints logged</span>
              </div>
            </div>

            {/* Row 2: Score + Breakdown */}
            <div className="grid" style={{ gridTemplateColumns: "1fr 1.1fr" }}>
              <div className="card fade-up" style={{ minWidth: 0 }}>
                <div className="card-head">
                  <div className="card-title"><span className="dot" />LinkedIn SSI Score</div>
                </div>
                {(() => {
                  // Everything below is gated on an actually-recorded score. The
                  // gauge, the weekly delta and the sparkline all used to render
                  // from hardcoded fallbacks, so a fresh install showed a measured
                  // number and a week-on-week gain that had never happened.
                  const hasScore = ssiData?.score != null;
                  const target = ssiData?.target || 60;
                  const delta = (hasScore && ssiData?.prevScore != null) ? ssiData.score - ssiData.prevScore : null;
                  const totals = (ssiData?.weeks || [])
                    .filter(w => w.brand != null && w.people != null && w.engage != null && w.rel != null)
                    .map(w => w.brand + w.people + w.engage + w.rel);
                  return (
                    <>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "6px 0 2px" }}>
                        <div style={{ position: "relative" }}>
                          <RadialGauge value={hasScore ? ssiData.score : 0} max={100} target={target} size={200} stroke={15} />
                          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                            {hasScore ? (
                              <>
                                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 52, lineHeight: 1, color: "var(--accent-2)" }}>{ssiData.score}</div>
                                <div style={{ fontFamily: "var(--mono)", fontSize: 12, color: "var(--text-mute)", letterSpacing: ".06em" }}>/ 100</div>
                              </>
                            ) : (
                              <>
                                <div style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 19, lineHeight: 1.2, color: "var(--text-mute)", textAlign: "center" }}>Not measured</div>
                                <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)", letterSpacing: ".06em", marginTop: 3 }}>yet</div>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="divider" />

                      {hasScore ? (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)", letterSpacing: ".1em" }}>TARGET {target}</span>
                              {delta != null && (
                                <span className={"pill " + (delta >= 0 ? "green" : "red")}><span className="d" />{delta >= 0 ? "+" : ""}{delta} this wk</span>
                              )}
                            </div>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-dim)" }}>
                              <span style={{ color: "var(--accent-2)" }}>{Math.round((ssiData.score / target) * 100)}%</span> to goal &middot; {Math.max(0, target - ssiData.score)} pts to go
                            </div>
                          </div>
                          {totals.length >= 2 && (
                            <div style={{ textAlign: "right" }}>
                              <div style={{ fontFamily: "var(--mono)", fontSize: 9, color: "var(--text-mute)", letterSpacing: ".12em", marginBottom: 2 }}>LAST 3 WEEKS</div>
                              <Sparkline data={totals.slice(-3)} w={130} h={34} />
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{ fontSize: 11.5, color: "var(--text-mute)", lineHeight: 1.7 }}>
                          Your SSI is a score LinkedIn calculates, so trajecktory cannot read it for
                          you. Open your SSI page on LinkedIn, then record the four pillar scores under{" "}
                          <b>Weekly Tracker</b>. This gauge starts tracking from your first entry, and
                          shows a week-on-week trend once you have two.
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>

              {(() => {
                const recorded = (ssiData?.weeks || []).filter(w => w.brand != null);
                const lastWeek = recorded.slice(-1)[0] || { brand: 0, people: 0, engage: 0, rel: 0 };
                const prevWeek = recorded.length >= 2 ? recorded.slice(-2)[0] : lastWeek;

                const pillars = [
                  { key: "brand", label: "Establish Brand", color: "var(--accent)", value: lastWeek.brand || 0, hint: "Profile, content, thought leadership" },
                  { key: "people", label: "Find Right People", color: "var(--blue)", value: lastWeek.people || 0, hint: "Search, targeting, prospect lists" },
                  { key: "engage", label: "Engage with Insights", color: "var(--cyan)", value: lastWeek.engage || 0, hint: "Comments, shares, reactions" },
                  { key: "rel", label: "Build Relationships", color: "var(--green)", value: lastWeek.rel || 0, hint: "Connections, DMs, conversations" },
                ];
                return (
                  <div className="card fade-up" style={{ animationDelay: ".05s", minWidth: 0 }}>
                    <div className="card-head">
                      <div className="card-title"><span className="dot" />Score Breakdown</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                      {pillars.map((p) => {
                        const pct = (p.value / 25) * 100;
                        const prevVal = prevWeek[p.key] || 0;
                        const delta = p.value - prevVal;
                        return (
                          <div key={p.key}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
                              <span style={{ width: 8, height: 8, borderRadius: 99, background: p.color, flex: "none" }} />
                              <span style={{ fontSize: 13, color: "var(--text)" }}>{p.label}</span>
                              <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontWeight: 700, fontSize: 13 }}>
                                {p.value % 1 === 0 ? p.value : p.value.toFixed(1)}
                                <span style={{ color: "var(--text-mute)", fontWeight: 400 }}> / 25</span>
                              </span>
                              {delta !== 0 && (
                                <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: delta > 0 ? "var(--green)" : "var(--text-mute)", width: 34, textAlign: "right" }}>
                                  {delta > 0 ? "+" : ""}{delta.toFixed(1)}
                                </span>
                              )}
                            </div>
                            <div className="bar"><span style={{ width: `${pct}%`, background: p.color, opacity: pct === 0 ? 0 : 1 }} /></div>
                            <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mute)", marginTop: 6, marginLeft: 16 }}>{p.hint}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Row 3: Recent Activity + Momentum */}
            <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
              <div className="card fade-up" style={{ minWidth: 0 }}>
                <div className="card-head">
                  <div className="card-title"><span className="dot" />Recent Activity</div>
                  <div className="act"><button className="btn ghost sm" onClick={() => setActiveView("activity")}>View log →</button></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {(engagementLog || []).slice(0, 3).map((a, i) => (
                    <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", minWidth: 0 }}>
                      <div className="mono-av sm" style={{ flex: "none" }}>
                        {(a.influencer || "?").split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("").toUpperCase()}
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                          <span style={{ fontSize: 12.5, color: "var(--text)", fontWeight: 500, overflowWrap: "anywhere" }}>{a.influencer}</span>
                          <span className="tag accent">{a.actionType}</span>
                          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mute)" }}>{a.date?.slice(5) || ""}</span>
                        </div>
                        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 3, lineHeight: 1.45, overflowWrap: "anywhere" }}>{a.message}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card fade-up" style={{ minWidth: 0 }}>
                <div className="card-head">
                  <div className="card-title"><span className="dot" />Weekly Momentum</div>
                  <div className="act"><button className="btn ghost sm" onClick={() => setActiveView("weekly")}>Open tracker →</button></div>
                </div>
                <WeekTrend weeks={ssiData?.weeks || []} target={ssiData?.target || 60} height={132} />
              </div>
            </div>
          </div>
        )}

        {/* INFLUENCERS */}
        {activeView === "influencers" && (
          <InfluencersView influencers={influencers} setInfluencers={setInfluencers} onOpen={setSelectedInfluencer} />
        )}

        {/* ACTIVITY */}
        {activeView === "activity" && (
          <ActivityView influencers={influencers} engagementLog={engagementLog} setEngagementLog={setEngagementLog} />
        )}

        {/* WEEKLY */}
        {activeView === "weekly" && ssiData && (
          <WeeklyView weeks={ssiData?.weeks || []} target={ssiData?.target || 60} setSsiData={setSsiData} />
        )}
      </div>

      <InfluencerDrawer
        influencer={selectedInfluencer}
        influencers={influencers}
        engagementLog={engagementLog}
        setEngagementLog={setEngagementLog}
        onClose={() => setSelectedInfluencer(null)}
        onUpdate={(updated) => {
          setInfluencers(updated);
          // Keep the drawer in sync with the updated influencer record
          const me = updated.find((x) => x.id === selectedInfluencer?.id);
          if (me) setSelectedInfluencer(me);
        }}
      />
    </div>
  );
}

// Tier metadata: color, display label, and sort rank (Tier 1 = highest priority).
function tierMeta(tier) {
  if (tier === "Tier 1") return { color: "var(--accent)", label: "Tier 1", rank: 1 };
  if (tier === "Tier 2") return { color: "var(--blue)",   label: "Tier 2", rank: 2 };
  if (tier === "Tier 3") return { color: "var(--cyan)",   label: "Tier 3", rank: 3 };
  return { color: "var(--orange)", label: "Local", rank: 4 };
}

// Relationship funnel: Following → Connected → Engaged. Higher stage = further along.
const STAGE_OF = (p) => (p.engaged ? 3 : p.connected ? 2 : p.following ? 1 : 0);
// Derived next action per funnel stage, with an urgency color.
const NEXT_MOTION = [
  { text: "Follow + study feed",   color: "var(--orange)" },
  { text: "Comment, then connect", color: "var(--accent)" },
  { text: "Engage with a post",    color: "var(--blue)" },
  { text: "Nurture / DM",          color: "var(--green)" },
];
const lastTouch = (p) => p.lastEngagement || p.last || "";
// Composite priority: high tier + early funnel stage = act first (lower = more urgent).
const PRIORITY_OF = (p) => tierMeta(p.tier).rank * 4 + STAGE_OF(p);
const initialsOf = (name) =>
  (name?.split(" ").filter(Boolean).map((w, i, a) => (i === 0 || i === a.length - 1 ? w[0] : "")).join("") || "??").toUpperCase();

function InfluencersView({ influencers, setInfluencers, onOpen }) {
  const [filter, setFilter] = useState("all");
  // Adding people used to be impossible from the UI: there was no create route and
  // no form, so the only way to populate this tab was to hand-author
  // data/linkedin-ssi/influencers.json.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", role: "", tier: "local", track: "", location: "", linkedin: "", whyFollow: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const submitNew = async () => {
    if (!draft.name.trim() || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await window.tjkMutate("/api/linkedin-ssi/influencers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const list = await r.json();
      if (!Array.isArray(list)) throw new Error(list.error || "Could not add.");
      setInfluencers(list);
      setDraft({ name: "", role: "", tier: "local", track: "", location: "", linkedin: "", whyFollow: "" });
      setAdding(false);
      setMsg("Added.");
    } catch (e) { setMsg(e.message || "Could not add."); }
    finally { setBusy(false); }
  };

  const importCsv = async (file) => {
    if (!file || busy) return;
    setBusy(true); setMsg("");
    try {
      const csv = await file.text();
      const r = await window.tjkMutate("/api/linkedin-ssi/influencers/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Import failed.");
      if (Array.isArray(d.influencers)) setInfluencers(d.influencers);
      setMsg(`Imported ${d.imported}${d.duplicates ? `, ${d.duplicates} duplicates skipped` : ""}.`);
    } catch (e) { setMsg(e.message || "Could not read the file."); }
    finally { setBusy(false); }
  };

  // Default sort surfaces the highest-value contacts that still need a motion.
  const [sortKey, setSortKey] = useState("priority");
  const [sortDir, setSortDir] = useState("asc");
  const setSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "last" || k === "stage" ? "desc" : "asc"); }
  };

  const tiers = useMemo(() => {
    const unique = new Set(influencers.map(i => {
      if (i.tier === "local") return "local";
      return i.tier; // returns "Tier 1", "Tier 2", etc.
    }));
    return ["all", ...Array.from(unique).sort()];
  }, [influencers]);
  const counts = useMemo(() => ({
    all: influencers.length,
    ...Object.fromEntries(tiers.slice(1).map(t => [t, influencers.filter(i => {
      if (t === "local") return i.tier === "local";
      return i.tier === t;
    }).length]))
  }), [influencers, tiers]);
  const filtered = useMemo(() => {
    if (filter === "all") return influencers;
    if (filter === "local") return influencers.filter(i => i.tier === "local");
    return influencers.filter(i => i.tier === filter);
  }, [influencers, filter]);

  const sortVal = (p, key) => {
    switch (key) {
      case "name":  return (p.name || "").toLowerCase();
      case "title": return (p.role || "").toLowerCase();
      case "tier":  return tierMeta(p.tier).rank;
      case "track": return (p.track || "").toLowerCase();
      case "stage": return STAGE_OF(p);
      case "last":  return lastTouch(p);
      case "priority": return PRIORITY_OF(p);
      default: return "";
    }
  };
  const shown = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      // Stable tiebreak: priority, then name.
      const ap = PRIORITY_OF(a), bp = PRIORITY_OF(b);
      if (ap !== bp) return ap - bp;
      return (a.name || "").localeCompare(b.name || "");
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const cols = [
    { k: "name",     label: "Influencer",  w: 190 },
    { k: "title",    label: "Title",       w: 210 },
    { k: "tier",     label: "Tier",        w: 86 },
    { k: "track",    label: "Track",       w: 150 },
    { k: "stage",    label: "Status",      w: 132 },
    { k: "last",     label: "Last touch",  w: 104 },
    { k: "priority", label: "Next motion", w: 196 },
  ];

  return (
    <div className="fade-up">
      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title">Influencers</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {msg && <span className="mono" style={{ fontSize: 10.5, color: "var(--text-mute)" }}>{msg}</span>}
            <span className="card-meta mono">
              {shown.length} of {influencers.length} · {influencers.filter(i => i.following).length} followed
            </span>
            <a className="btn" href="/api/linkedin-ssi/influencers/template" title="Download the CSV template (name, role, track, tier, location, linkedin, ...)">Template</a>
            <label className="btn" style={{ cursor: busy ? "default" : "pointer" }} title="Bulk-import influencers from a CSV file">
              {busy ? "Working…" : "Import CSV"}
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={busy}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importCsv(f); }} />
            </label>
            <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "+ Add influencer"}</button>
          </div>
        </div>

        {adding && (
          <div className="card" style={{ padding: "12px 14px", margin: "6px 0 12px" }}>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-mute)", letterSpacing: ".08em", marginBottom: 9 }}>NEW INFLUENCER</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 9 }}>
              <input className="inp" placeholder="Name (required)" value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") submitNew(); }} autoFocus />
              <input className="inp" placeholder="Role, e.g. VP of Revenue Operations" value={draft.role}
                onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} />
              <input className="inp" placeholder="Track, e.g. revops" value={draft.track}
                onChange={e => setDraft(d => ({ ...d, track: e.target.value }))} />
              <input className="inp" placeholder="Tier, e.g. local" value={draft.tier}
                onChange={e => setDraft(d => ({ ...d, tier: e.target.value }))} />
              <input className="inp" placeholder="Location" value={draft.location}
                onChange={e => setDraft(d => ({ ...d, location: e.target.value }))} />
              <input className="inp" placeholder="LinkedIn profile URL" value={draft.linkedin}
                onChange={e => setDraft(d => ({ ...d, linkedin: e.target.value }))} />
            </div>
            <input className="inp" style={{ marginTop: 9, width: "100%" }} placeholder="Why follow them? (what they post about, and your angle)"
              value={draft.whyFollow} onChange={e => setDraft(d => ({ ...d, whyFollow: e.target.value }))} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <button className="btn primary" onClick={submitNew} disabled={!draft.name.trim() || busy}>{busy ? "Saving…" : "Save influencer"}</button>
              <span style={{ fontSize: 11, color: "var(--text-mute)" }}>
                Only the name is required. The rest sharpens the drafts Claude writes for you later,
                so it is worth filling in when you know it.
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", margin: "4px 0 10px", gap: 12, flexWrap: "wrap" }}>
          <div className="chips">
            <button key="all" className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")} style={{ border: "none", background: "none", cursor: "pointer" }}>
              All<span className="ct">{counts["all"] ?? 0}</span>
            </button>
            {tiers.slice(1).map((t) => (
              <button key={t} className={"chip" + (filter === t ? " on" : "")} onClick={() => setFilter(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                {t === "local" ? "Local" : t}
                <span className="ct">{counts[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: ".06em" }}>
            sorted by {cols.find(c => c.k === sortKey)?.label.toLowerCase()} · click a row for details
          </div>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: "calc(100vh - 340px)", border: "none", borderRadius: 0, background: "transparent" }}>
          <table className="tbl ssi-tbl">
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? "sorted" : ""} onClick={() => setSort(c.k)}>
                    {c.label}<span className="sort-ind">{sortKey === c.k ? (sortDir === "asc" ? "↑" : "↓") : "·"}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 && (
                <tr><td colSpan={cols.length}><div className="no-data" style={{ padding: 40, textAlign: "center", lineHeight: 1.7 }}>
                  {influencers.length === 0 ? (
                    <>
                      No influencers yet.<br />
                      <span style={{ fontSize: 11.5, color: "var(--text-mute)" }}>
                        These are the people whose posts you want to show up under. Add a few with
                        <b> + Add influencer</b>, or import a list with <b>Import CSV</b>. Everything
                        else on this tab (your activity log, the AI drafts, your weekly score) is
                        built from this list, so it is the place to start.
                      </span>
                    </>
                  ) : "No influencers in this tier."}
                </div></td></tr>
              )}
              {shown.map((p) => {
                const tm = tierMeta(p.tier);
                const stage = STAGE_OF(p);
                const motion = NEXT_MOTION[stage];
                const lt = lastTouch(p);
                return (
                  <tr key={p.id ?? p.name} onClick={() => onOpen && onOpen(p)} style={{ cursor: onOpen ? "pointer" : "default" }}>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                        <div className="mono-av sm" style={{ borderColor: tm.color, color: tm.color, flex: "none" }}>{initialsOf(p.name)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      </div>
                    </td>
                    <td className="ssi-title" title={p.role || ""}>
                      <span style={{ fontSize: 12, color: "var(--text-dim)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.role || "—"}</span>
                    </td>
                    <td>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: tm.color, border: `1px solid ${tm.color}`, padding: "2px 7px", borderRadius: 5, opacity: .9, whiteSpace: "nowrap" }}>{tm.label}</span>
                    </td>
                    <td>{p.track ? <span className="tag">{p.track}</span> : <span style={{ color: "var(--text-mute)" }}>—</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 5 }}>
                        {[
                          { ltr: "F", on: p.following, c: "var(--accent)", title: "Following" },
                          { ltr: "C", on: p.connected, c: "var(--green)",  title: "Connected" },
                          { ltr: "E", on: p.engaged,   c: "var(--blue)",   title: "Engaged" },
                        ].map((s) => (
                          <span key={s.ltr} title={s.title + (s.on ? "" : " (not yet)")}
                            style={{ width: 19, height: 19, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "var(--mono)", fontSize: 9.5, fontWeight: 700,
                              color: s.on ? s.c : "var(--text-mute)", border: `1px solid ${s.on ? s.c : "var(--border)"}`,
                              opacity: s.on ? 1 : .5 }}>{s.ltr}</span>
                        ))}
                      </div>
                    </td>
                    <td><span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: lt ? "var(--text-dim)" : "var(--text-mute)" }}>{lt ? lt.slice(5) : "—"}</span></td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-dim)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: motion.color, flex: "none" }} />
                        {motion.text}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ActivityView({ influencers, engagementLog, setEngagementLog }) {
  const ACTIVITY_TYPES = ["Commented", "Posted", "Messaged", "Responded", "Reposted", "Connection request"];
  const typeColor = (t) => ({ Commented: "var(--accent)", Posted: "var(--blue)", Messaged: "var(--cyan)", Responded: "var(--green)", Reposted: "var(--orange)", "Connection request": "var(--accent-2)" }[t] || "var(--text-mute)");

  const today = new Date().toISOString().split('T')[0];
  const [type, setType] = useState("Commented");
  const [date, setDate] = useState(today);
  const [influencerId, setInfluencerId] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [responseReceived, setResponseReceived] = useState("No");
  const [connectionMade, setConnectionMade] = useState("Pending");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setType("Commented");
    setDate(new Date().toISOString().split('T')[0]);
    setInfluencerId("");
    setTopic("");
    setMessage("");
    setResponseReceived("No");
    setConnectionMade("Pending");
    setNotes("");
    setError("");
  };

  const submit = async () => {
    setError("");
    if (!influencerId) { setError("Pick an influencer."); return; }
    if (!date) { setError("Date is required."); return; }
    if (!topic.trim()) { setError("Topic is required."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/engagement-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencerId: parseInt(influencerId, 10),
          date,
          actionType: type,
          topic: topic.trim(),
          message: message.trim(),
          responseReceived,
          connectionMade,
          notes: notes.trim(),
        }),
      });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const entries = await res.json();
      setEngagementLog([...(entries || [])].sort(byLoggedAtDesc));
      reset();
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "2fr 3fr", alignItems: "start", gap: 24 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Log New Activity</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field"><label>Date</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field"><label>Influencer</label>
              <select className="sel" value={influencerId} onChange={(e) => setInfluencerId(e.target.value)}>
                <option value="" disabled>Select…</option>
                {[...(influencers || [])].sort(byNameAsc).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Activity type</label>
            <div className="chips">
              {ACTIVITY_TYPES.map((t) => (
                <button key={t} className={"chip" + (type === t ? " on" : "")} onClick={() => setType(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: typeColor(t) }} />{t}
                </button>
              ))}
            </div>
          </div>
          <div className="field"><label>Topic</label><input className="inp" placeholder="e.g. Category framing" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
          <div className="field"><label>Your message</label><textarea className="ta" placeholder="What you said (keep it short)" value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field"><label>Got a response?</label>
              <select className="sel" value={responseReceived} onChange={(e) => setResponseReceived(e.target.value)}>
                <option>No</option><option>Yes</option>
              </select>
            </div>
            <div className="field"><label>Connection</label>
              <select className="sel" value={connectionMade} onChange={(e) => setConnectionMade(e.target.value)}>
                <option>Pending</option><option>Connected</option><option>Following</option>
              </select>
            </div>
          </div>
          <div className="field"><label>Notes <span style={{ color: "var(--text-mute)", fontSize: 10.5, fontWeight: 400 }}>(optional)</span></label>
            <input className="inp" placeholder="Follow-up plan, context, etc." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div style={{ fontSize: 11.5, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary block" style={{ flex: 1 }} onClick={submit} disabled={busy}>{busy ? "Saving…" : "+ Log Activity"}</button>
            <button className="btn" onClick={reset} disabled={busy}>Reset</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Recent Activity</div>
          <span className="mute2 mono" style={{ marginLeft: "auto", fontSize: 10 }}>{(engagementLog || []).length} entries</span>
        </div>
        <div style={{ position: "relative", paddingLeft: 6 }}>
          <div style={{ position: "absolute", left: 22, top: 8, bottom: 8, width: 1, background: "var(--border)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(engagementLog || []).map((a, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: 12, position: "relative", padding: "10px 0" }}>
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div className="mono-av sm" style={{ background: "var(--panel)", borderColor: typeColor(a.actionType), color: typeColor(a.actionType) }}>
                    {((a.influencer || "?").split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") || "??").toUpperCase()}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.influencer}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: typeColor(a.actionType), border: `1px solid ${typeColor(a.actionType)}`, opacity: .85, padding: "1px 7px", borderRadius: 5 }}>{a.actionType}</span>
                    <span className="tag">{a.topic}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mute)" }}>{a.date}</span>
                  </div>
                  <div style={{ fontSize: 12.5, color: "var(--text-dim)", margin: "5px 0 7px", lineHeight: 1.55 }}>{a.message}</div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <span className={"pill " + (a.responseReceived === "Yes" ? "green" : "")} style={{ opacity: a.responseReceived === "Yes" ? 1 : .45 }}><span className="d" />{a.responseReceived === "Yes" ? "Response received" : "No response"}</span>
                    <span className={"pill " + (a.connectionMade === "Connected" ? "accent" : "")} style={{ opacity: a.connectionMade === "Connected" ? 1 : .45 }}><span className="d" />{a.connectionMade === "Connected" ? "Connected" : "Not connected"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function WeeklyView({ weeks, target, setSsiData }) {
  const PILLAR_FIELDS = [
    { key: "brand", label: "Brand", color: "var(--accent)", apiKey: "brand" },
    { key: "people", label: "Find People", color: "var(--blue)", apiKey: "findPeople" },
    { key: "engage", label: "Engage", color: "var(--cyan)", apiKey: "engageInsights" },
    { key: "rel", label: "Relationships", color: "var(--green)", apiKey: "relationships" },
  ];
  const recordedCount = (weeks || []).filter((w) => w.brand != null).length;

  // On a fresh install `weeks` is empty, which left the dropdown with no options,
  // selectedWk stuck at null, and Save permanently disabled: the tracker could
  // never be started at all. Offer this week plus the next eleven so there is
  // always something to record against. Real weeks win as soon as any exist.
  const weekOptions = useMemo(() => {
    if (weeks && weeks.length) return weeks;
    const monday = new Date();
    monday.setHours(0, 0, 0, 0);
    monday.setDate(monday.getDate() - ((monday.getDay() || 7) - 1));
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i * 7);
      return { wk: i + 1, date: ymd(d), brand: null, people: null, engage: null, rel: null };
    });
  }, [weeks]);

  // Default the form to the first un-recorded week; fall back to the first week.
  const defaultWeekNum = useMemo(() => {
    if (!weekOptions.length) return null;
    const firstEmpty = weekOptions.find((w) => w.brand == null);
    return (firstEmpty || weekOptions[0]).wk;
  }, [weekOptions]);

  const [selectedWk, setSelectedWk] = useState(defaultWeekNum);
  const [form, setForm] = useState({ brand: "", people: "", engage: "", rel: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveOk, setSaveOk] = useState(false);

  // Keep selectedWk in sync when weeks load asynchronously
  useEffect(() => {
    if (selectedWk == null && defaultWeekNum != null) setSelectedWk(defaultWeekNum);
  }, [defaultWeekNum]);

  // Prefill the form whenever the selected week changes (preserves existing values for re-edit)
  useEffect(() => {
    if (selectedWk == null) return;
    const w = weekOptions.find((x) => x.wk === selectedWk);
    if (!w) return;
    setForm({
      brand: w.brand != null ? String(w.brand) : "",
      people: w.people != null ? String(w.people) : "",
      engage: w.engage != null ? String(w.engage) : "",
      rel: w.rel != null ? String(w.rel) : "",
      notes: w.notes || "",
    });
    setSaveError("");
    setSaveOk(false);
  }, [selectedWk, weeks]);

  const updateField = (key, val) => {
    setForm((f) => ({ ...f, [key]: val }));
    setSaveOk(false);
  };

  const save = async () => {
    if (selectedWk == null) return;
    setSaving(true);
    setSaveError("");
    setSaveOk(false);
    try {
      const payload = {
        weekNum: selectedWk,
        // Carried so the server can create the week when it does not exist yet.
        weekOf: (weekOptions.find((w) => w.wk === selectedWk) || {}).date || "",
        brand: form.brand === "" ? null : Number(form.brand),
        findPeople: form.people === "" ? null : Number(form.people),
        engageInsights: form.engage === "" ? null : Number(form.engage),
        relationships: form.rel === "" ? null : Number(form.rel),
        notes: form.notes,
      };
      const res = await window.tjkMutate('/api/linkedin-ssi/tracker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      // Renormalize the server's response into the shape the page uses. Must match
      // the initial fetch exactly, including the null handling: falling back to 39
      // and 35 here would reintroduce the invented score on the very first save.
      const nextWeeks = (data.weeks || []).map((w) => ({
        wk: w.weekNum, date: w.weekOf,
        brand: w.brand, people: w.findPeople,
        engage: w.engageInsights, rel: w.relationships,
        notes: w.notes,
      }));
      const nextTotals = nextWeeks
        .filter((w) => w.brand != null && w.people != null && w.engage != null && w.rel != null)
        .map((w) => w.brand + w.people + w.engage + w.rel);
      const normalized = {
        score: (data.currentSsi === null || data.currentSsi === undefined) ? null : data.currentSsi,
        target: data.targetSsi || 60,
        weeks: nextWeeks,
        prevScore: nextTotals.length >= 2 ? nextTotals[nextTotals.length - 2] : null,
      };
      setSsiData(normalized);
      setSaveOk(true);
    } catch (e) {
      setSaveError(e.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="grid" style={{ gridTemplateColumns: "1fr minmax(0, 380px)", alignItems: "start" }}>
        <div className="card">
          <div className="card-head">
            <div className="card-title"><span className="dot" />Momentum</div>
            <span className="mute2 mono" style={{ marginLeft: "auto", fontSize: 10 }}>{recordedCount}/12 weeks logged</span>
          </div>
          <WeekTrend weeks={weeks || []} target={target} height={148} />
          <div className="chips" style={{ marginTop: 16, gap: 12 }}>
            {PILLAR_FIELDS.map((p) => (
              <span key={p.key} className="pill" style={{ color: "var(--text-dim)" }}>
                <span className="d" style={{ background: p.color, boxShadow: "none" }} />{p.label}
              </span>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title"><span className="dot" />Record Weekly Update</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="field"><label>Week</label>
              <select className="sel" value={selectedWk ?? ""} onChange={(e) => setSelectedWk(Number(e.target.value))}>
                {weekOptions.map((w) => (
                  <option key={w.wk} value={w.wk}>
                    Week {w.wk} · {w.date}{w.brand != null ? " · ✓ recorded" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid cols-2" style={{ gap: 10 }}>
              {PILLAR_FIELDS.map((p) => (
                <div className="field" key={p.key}>
                  <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: p.color }} />{p.label} (0-25)
                  </label>
                  <input
                    className="inp" type="number" min="0" max="25" placeholder="0"
                    value={form[p.key]}
                    onChange={(e) => updateField(p.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div className="field"><label>Weekly notes</label>
              <textarea
                className="ta" style={{ minHeight: 70 }}
                placeholder="What moved the needle this week?"
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
              />
            </div>
            {saveError && (
              <div style={{ fontSize: 11.5, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{saveError}</div>
            )}
            {saveOk && (
              <div style={{ fontSize: 11.5, color: "var(--green)", fontFamily: "var(--mono)" }}>
                ✓ Saved · SSI score recalculated
              </div>
            )}
            <button className="btn primary block" onClick={save} disabled={saving || selectedWk == null}>
              {saving ? "Saving…" : "Save Weekly Update"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        {weekOptions.map((w, i) => {
          const recorded = w.brand != null;
          const total = recorded ? w.brand + w.people + w.engage + w.rel : null;
          return (
            <div key={w.wk} className="card" style={{ padding: 13, display: "flex", flexDirection: "column", gap: 10, opacity: recorded ? 1 : 0.66 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: recorded ? "var(--text)" : "var(--text-dim)" }}>Week {w.wk}</span>
                <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mute)" }}>{w.date?.slice(5) || ""}</span>
              </div>
              {recorded ? (
                <>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontFamily: "var(--mono)", fontWeight: 700, fontSize: 22, color: "var(--accent-2)" }}>{total.toFixed(0)}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)" }}>/ 100</span>
                  </div>
                  <div style={{ display: "flex", height: 6, borderRadius: 99, overflow: "hidden", background: "var(--panel-2)" }}>
                    {PILLAR_FIELDS.map((p) => (
                      <div key={p.key} title={`${p.label}: ${w[p.key]}`} style={{ width: `${(w[p.key] / 100) * 100}%`, background: p.color }} />
                    ))}
                  </div>
                </>
              ) : (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 44, color: "var(--text-mute)", fontFamily: "var(--mono)", fontSize: 12 }}>
                  — not recorded
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AIResponseView({ influencers, lockedInfluencer, onLog }) {
  const [post, setPost] = useState("");
  const [who, setWho] = useState(lockedInfluencer?.name || "");
  const [tone, setTone] = useState("Insightful");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);
  const [logErr, setLogErr] = useState("");
  const TONES = ["Insightful", "Supportive", "Contrarian", "Curious"];
  useEffect(() => { if (lockedInfluencer) setWho(lockedInfluencer.name); }, [lockedInfluencer?.name]);

  const logIt = async () => {
    if (!onLog || !out) return;
    setLogErr(""); setLogging(true);
    const snippet = post.trim();
    const topic = snippet ? ("Re: " + snippet.slice(0, 48) + (snippet.length > 48 ? "…" : "")) : "Comment reply";
    try {
      await onLog({ topic, message: out });
    } catch (e) {
      setLogErr(e.message || "Failed to log."); setLogging(false);
    }
  };

  const generate = async () => {
    setError("");
    if (!post.trim()) { setError("Paste the LinkedIn post first."); return; }
    if (!who) { setError("Pick who you're responding to."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/generate-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postText: post, influencerName: who, tone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setOut(data.response || '');
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "1fr", alignItems: "start", gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Generate LinkedIn Response</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field"><label>LinkedIn post</label>
            <textarea className="ta" style={{ minHeight: 132 }} value={post} onChange={(e) => setPost(e.target.value)} placeholder="Paste the post you want to respond to…" />
          </div>
          {!lockedInfluencer && (
            <div className="field"><label>Responding to</label>
              <select className="sel" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Select an influencer…</option>
                {[...influencers].sort(byNameAsc).map((i) => <option key={i.name}>{i.name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label>Tone</label>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + (tone === t ? " on" : "")} onClick={() => setTone(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize: 11.5, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={generate} disabled={busy}>{busy ? "Generating with Claude…" : "Generate Response"}</button>
            <button className="btn" onClick={() => { setPost(""); if (!lockedInfluencer) setWho(""); setOut(""); setError(""); }}>Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Suggested Reply</div>
          {out && <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(out)}>Copy</button>}
        </div>
        {!out && !busy && (
          <div style={{ minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", padding: 20 }}>
            <div className="empty">Paste a post, pick who you're replying to, and Claude will draft a {tone.toLowerCase()} reply grounded in that specific post.</div>
          </div>
        )}
        {busy && (
          <div style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
            drafting a {tone.toLowerCase()} reply with Claude…
          </div>
        )}
        {out && !busy && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
              <div className="mono-av sm">{who ? who.split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") : "??"}</div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{who || "Unspecified"}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mute)" }}>{tone} · reply draft</div>
              </div>
            </div>
            <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "14px 15px", fontSize: 13, lineHeight: 1.65, color: "var(--text)" }}>{out}</div>
            {logErr && <div style={{ fontSize: 11.5, color: "var(--red, #e06262)", fontFamily: "var(--mono)", marginTop: 10 }}>{logErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {onLog && lockedInfluencer && (
                <button className="btn primary sm" onClick={logIt} disabled={logging}>{logging ? "Logging…" : "✓ Log to timeline"}</button>
              )}
              <button className="btn sm" onClick={generate} disabled={logging}>Regenerate</button>
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(out)}>Copy reply</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AIConnectView({ influencers, lockedInfluencer, onLog }) {
  const [who, setWho] = useState(lockedInfluencer?.name || "");
  const [priorEngagement, setPriorEngagement] = useState("");
  const [theirRole, setTheirRole] = useState(lockedInfluencer?.role || "");
  const [tone, setTone] = useState("Warm");
  const [angle, setAngle] = useState("Reference Post");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);
  const [logErr, setLogErr] = useState("");
  useEffect(() => {
    if (lockedInfluencer) {
      setWho(lockedInfluencer.name);
      setTheirRole(lockedInfluencer.role || "");
    }
  }, [lockedInfluencer?.name]);

  const logIt = async () => {
    if (!onLog || !out) return;
    setLogErr(""); setLogging(true);
    const ref = priorEngagement.trim();
    const topic = ref ? (angle + " · " + ref.slice(0, 36) + (ref.length > 36 ? "…" : "")) : angle;
    try {
      await onLog({ topic, message: out });
    } catch (e) {
      setLogErr(e.message || "Failed to log."); setLogging(false);
    }
  };

  const TONES = ["Warm", "Concise", "Professional", "Curious"];
  const ANGLES = ["Reference Post", "Mutual Interest", "Shared Network", "Career Stage"];
  const LIMIT = 300; // LinkedIn connection note cap

  const generate = async () => {
    setError("");
    if (!who) { setError("Pick an influencer first."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/generate-connect-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencerName: who,
          theirRole: theirRole.trim(),
          priorEngagement: priorEngagement.trim(),
          angle,
          tone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setOut(data.response || '');
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setBusy(false);
    }
    return; // skip the mock template fallback below

    // (legacy mock retained below for reference but unreachable)
    setTimeout(() => {
      const firstName = (who || "there").split(" ")[0];
      const refSnippet = priorEngagement
        ? `your post on ${priorEngagement.length > 40 ? priorEngagement.slice(0, 40) + "…" : priorEngagement}`
        : "your recent post";

      // Pre-baked templates by (angle x tone). Mock generator. Kept under ~280 chars to leave room for a sign-off.
      const lib = {
        "Reference Post": {
          Warm: `Hi ${firstName}, really enjoyed ${refSnippet} and wanted to connect properly. Working in RevOps / GTM analytics myself, and would value following more of your thinking. Thanks, ${window.myIdentity().firstName}`,
          Concise: `${firstName}, commented on ${refSnippet}. Director-level RevOps / BI background, would like to stay in touch. Thanks, ${window.myIdentity().firstName}`,
          Professional: `Hello ${firstName}, I appreciated the perspective in ${refSnippet} and the conversation it sparked. I lead BI & Revenue Operations work and would welcome the connection. Thanks, ${window.myIdentity().firstName}`,
          Curious: `${firstName}, ${refSnippet} got me thinking. I'd love to connect and learn more about how you approach this. RevOps and BI background here. Thanks, ${window.myIdentity().firstName}`,
        },
        "Mutual Interest": {
          Warm: `Hi ${firstName}, fellow ${theirRole || "GTM analytics / RevOps"} traveler here. I've been following your work and would love to connect. Thanks, ${window.myIdentity().firstName}`,
          Concise: `${firstName}, overlap in ${theirRole || "RevOps / analytics"}. Would like to connect. Thanks, ${window.myIdentity().firstName}`,
          Professional: `Hello ${firstName}, your work in ${theirRole || "GTM / RevOps"} aligns closely with what I lead. I'd welcome the connection. Thanks, ${window.myIdentity().firstName}`,
          Curious: `${firstName}, saw your focus on ${theirRole || "RevOps / GTM analytics"} and have questions I'd love to bring you over time. Mind if we connect? Thanks, ${window.myIdentity().firstName}`,
        },
        "Shared Network": {
          Warm: `Hi ${firstName}, we've got a few people in common in the ${theirRole || "RevOps"} space. Would be great to connect directly. Thanks, ${window.myIdentity().firstName}`,
          Concise: `${firstName}, mutual connections in the ${theirRole || "RevOps"} world. Let's connect. Thanks, ${window.myIdentity().firstName}`,
          Professional: `Hello ${firstName}, we share several mutual connections across the ${theirRole || "GTM analytics"} community. I'd welcome a direct connection. Thanks, ${window.myIdentity().firstName}`,
          Curious: `${firstName}, we keep showing up in the same network corners (${theirRole || "RevOps / GTM"}). Curious about your work, and would love to connect. Thanks, ${window.myIdentity().firstName}`,
        },
        "Career Stage": {
          Warm: `Hi ${firstName}, Director-level BI/RevOps leader exploring what's next. Your trajectory in ${theirRole || "this space"} is exactly the kind I follow closely. Would love to connect. Thanks, ${window.myIdentity().firstName}`,
          Concise: `${firstName}, Director, BI & RevOps. In market. Would value the connection. Thanks, ${window.myIdentity().firstName}`,
          Professional: `Hello ${firstName}, I lead BI & Revenue Operations at the Director level and am currently exploring next-step opportunities. I'd welcome a connection. Thanks, ${window.myIdentity().firstName}`,
          Curious: `${firstName}, Director, BI & RevOps here, thinking about what's next. Would love to learn how you ended up in ${theirRole || "your current role"}. Can we connect? Thanks, ${window.myIdentity().firstName}`,
        },
      };

      const draft = (lib[angle] && lib[angle][tone]) || lib["Reference Post"]["Warm"];
      // Hard-cap at LIMIT
      setOut(draft.length > LIMIT ? draft.slice(0, LIMIT - 1) + "…" : draft);
      setBusy(false);
    }, 650);
  };

  const charCount = out.length;
  const charStatus = charCount === 0 ? "" : charCount <= LIMIT ? "ok" : "over";

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "1fr", alignItems: "start", gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Generate Connection Request</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!lockedInfluencer && (
            <div className="field"><label>Connecting with</label>
              <select className="sel" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Select an influencer…</option>
                {[...influencers].sort(byNameAsc).map((i) => <option key={i.name}>{i.name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label>Their role / focus area <span style={{ color: "var(--text-mute)", fontSize: 10.5, fontWeight: 400 }}>(optional, used in some angles)</span></label>
            <input className="sel" type="text" value={theirRole} onChange={(e) => setTheirRole(e.target.value)} placeholder="e.g. RevOps leadership, GTM analytics" />
          </div>
          <div className="field"><label>Prior engagement reference <span style={{ color: "var(--text-mute)", fontSize: 10.5, fontWeight: 400 }}>(the post topic you already commented on)</span></label>
            <textarea className="ta" style={{ minHeight: 64 }} value={priorEngagement} onChange={(e) => setPriorEngagement(e.target.value)} placeholder="e.g. RevOps tooling vs. process, MEDDPICC adoption…" />
          </div>
          <div className="field"><label>Angle</label>
            <div className="chips">
              {ANGLES.map((a) => (
                <button key={a} className={"chip" + (angle === a ? " on" : "")} onClick={() => setAngle(a)} style={{ border: "none", background: "none", cursor: "pointer" }}>{a}</button>
              ))}
            </div>
          </div>
          <div className="field"><label>Tone</label>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + (tone === t ? " on" : "")} onClick={() => setTone(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize: 11.5, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={generate} disabled={busy || !who}>{busy ? "Generating with Claude…" : "Generate Request"}</button>
            <button className="btn" onClick={() => { if (!lockedInfluencer) { setWho(""); setTheirRole(""); } setPriorEngagement(""); setOut(""); setError(""); }}>Clear</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)", lineHeight: 1.55 }}>
            LinkedIn caps connection notes at <b>300 characters</b>. Drafts target ~280 with safety margin; if Claude overshoots, the note is trimmed at the last sentence and the sign-off is preserved.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Suggested Connection Note</div>
          {out && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: charStatus === "over" ? "var(--red, #e06262)" : "var(--text-mute)" }}>
                {charCount} / {LIMIT}
              </span>
              <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(out)}>Copy</button>
            </div>
          )}
        </div>
        {!out && !busy && (
          <div style={{ minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", padding: 20 }}>
            <div className="empty">Pick who you're connecting with, paste the post topic you already commented on, then generate a {tone.toLowerCase()} request.</div>
          </div>
        )}
        {busy && (
          <div style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
            drafting a {tone.toLowerCase()} connection note…
          </div>
        )}
        {out && !busy && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
              <div className="mono-av sm">{who ? who.split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") : "??"}</div>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600 }}>{who || "Unspecified"}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 9.5, color: "var(--text-mute)" }}>{angle} · {tone.toLowerCase()}</div>
              </div>
            </div>
            <div style={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "14px 15px", fontSize: 13, lineHeight: 1.65, color: "var(--text)" }}>{out}</div>
            {logErr && <div style={{ fontSize: 11.5, color: "var(--red, #e06262)", fontFamily: "var(--mono)", marginTop: 10 }}>{logErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {onLog && lockedInfluencer && (
                <button className="btn primary sm" onClick={logIt} disabled={logging}>{logging ? "Logging…" : "✓ Log to timeline"}</button>
              )}
              <button className="btn sm" onClick={generate} disabled={logging}>Regenerate</button>
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(out)}>Copy note</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Influencer Drawer ─────────────────────────────────────────────────────
// Slide-in side panel that mirrors the TA Outreach drawer (.drawer.wide) so
// the look-and-feel matches across the dashboard. Three inner tabs:
// Overview (intel + per-influencer activity) · AI Response · AI Connect.
function InfluencerDrawer({ influencer, influencers, engagementLog, setEngagementLog, onClose, onUpdate }) {
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const open = influencer != null;

  // Reset to overview whenever a new influencer is opened
  useEffect(() => { if (influencer) setTab("overview"); }, [influencer?.id]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!influencer) {
    return (
      <>
        <div className="drawer-backdrop" style={{ opacity: 0, pointerEvents: "none" }} />
        <div className="drawer wide" style={{ transform: "translateX(100%)" }} />
      </>
    );
  }

  const tierColor =
    influencer.tier === "Tier 1" ? "var(--accent)" :
    influencer.tier === "Tier 2" ? "var(--blue)" :
    influencer.tier === "Tier 3" ? "var(--cyan)" : "var(--orange)";
  const tierLabel = influencer.tier === "local" ? "Local" : influencer.tier;
  const initials = (influencer.name?.split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") || "??").toUpperCase();

  // Filter the engagement log to this influencer, newest first
  const myEngagement = [...(engagementLog || [])]
    .filter((e) => e.influencer === influencer.name)
    .sort(byLoggedAtDesc);

  const patchInfluencer = async (updates) => {
    setBusy(true);
    try {
      const res = await window.tjkMutate(`/api/linkedin-ssi/influencers/${influencer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data) && onUpdate) onUpdate(data);
    } catch {} finally { setBusy(false); }
  };

  const toggleFollowing = () => patchInfluencer({ following: !influencer.following });
  const toggleConnected = () => patchInfluencer({ connected: !influencer.connected });
  const toggleEngaged = () => patchInfluencer({ engaged: !influencer.engaged });

  // Log a generated AI draft (comment reply or connection note) straight into the
  // shared engagement log, which surfaces in the Overview timeline. Then advance the
  // influencer's status + last touch, and flip to Overview so the new entry is visible.
  const logToTimeline = async ({ actionType, topic, message, statusUpdates = {} }) => {
    const today = new Date().toISOString().split("T")[0];
    const res = await window.tjkMutate("/api/linkedin-ssi/engagement-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        influencerId: influencer.id,
        date: today,
        actionType,
        topic: topic || "",
        message: message || "",
        responseReceived: "No",
        connectionMade: influencer.connected ? "Connected" : "Pending",
        notes: "",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ("HTTP " + res.status));
    }
    const entries = await res.json();
    if (setEngagementLog) {
      setEngagementLog([...(entries || [])].sort(byLoggedAtDesc));
    }
    // Stamp last touch + bump count, plus any funnel advance the caller requested.
    await patchInfluencer({
      lastEngagement: today,
      engagementCount: (influencer.engagementCount || 0) + 1,
      ...statusUpdates,
    });
    setTab("overview");
  };

  return (
    <>
      <div
        className={"drawer-backdrop" + (open ? " open" : "")}
        onClick={onClose}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      />
      <div
        className={"drawer wide" + (open ? " open" : "")}
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
      >
        <div className="drawer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>#{influencer.id}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: ".08em", textTransform: "uppercase", color: tierColor, border: `1px solid ${tierColor}`, padding: "2px 7px", borderRadius: 5, opacity: .9 }}>{tierLabel}</span>
            {influencer.track && <span className="tag accent">{influencer.track}</span>}
            <button className="icon-btn" onClick={onClose} style={{ marginLeft: "auto" }} title="Close (Esc)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
            <span className="mono-av" style={{ width: 44, height: 44, fontSize: 14, borderRadius: 10, borderColor: tierColor, color: tierColor, flex: "none" }}>{initials}</span>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{influencer.name}</h3>
              <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>{influencer.role}</div>
              {influencer.location && (
                <div style={{ fontSize: 11.5, color: "var(--text-mute)", marginTop: 3, fontFamily: "var(--mono)" }}>{influencer.location}</div>
              )}
            </div>
          </div>
        </div>

        <div className="drawer-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Inner tab strip — sits at the top of the body, with breathing room above the header */}
          <div className="subtabs" style={{ margin: "0 -20px 6px", padding: "0 20px" }}>
            <button className={"subtab" + (tab === "overview" ? " active" : "")} onClick={() => setTab("overview")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.pulse} /></svg>
              Overview
            </button>
            <button className={"subtab" + (tab === "ai-response" ? " active" : "")} onClick={() => setTab("ai-response")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.msg} /></svg>
              AI Response
            </button>
            <button className={"subtab" + (tab === "ai-connect" ? " active" : "")} onClick={() => setTab("ai-connect")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.users} /></svg>
              AI Connect
            </button>
          </div>

          {tab === "overview" && (
            <>
              {/* Status pills + toggles */}
              <div className="ds-section">
                <div className="ds-label">Status</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className={"pill " + (influencer.following ? "accent" : "")}
                    onClick={toggleFollowing}
                    disabled={busy}
                    style={{ opacity: influencer.following ? 1 : 0.5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}
                    title={influencer.following ? "Click to unfollow" : "Click to follow"}>
                    <span className="d" />{influencer.following ? "Following" : "Not following"}
                  </button>
                  <button
                    className={"pill " + (influencer.connected ? "green" : "")}
                    onClick={toggleConnected}
                    disabled={busy}
                    style={{ opacity: influencer.connected ? 1 : 0.5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}
                    title={influencer.connected ? "Click to mark not connected" : "Click to mark connected"}>
                    <span className="d" />{influencer.connected ? "Connected" : "Not connected"}
                  </button>
                  <button
                    className={"pill " + (influencer.engaged ? "blue" : "")}
                    onClick={toggleEngaged}
                    disabled={busy}
                    style={{ opacity: influencer.engaged ? 1 : 0.5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}
                    title={influencer.engaged ? "Click to mark not engaged" : "Click to mark engaged"}>
                    <span className="d" />{influencer.engaged ? "Engaged" : "Not engaged"}
                  </button>
                  {influencer.engagementCount > 0 && (
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)", alignSelf: "center" }}>
                      {influencer.engagementCount} touch{influencer.engagementCount !== 1 ? "es" : ""} logged
                    </span>
                  )}
                </div>
              </div>

              {/* Intelligence */}
              <div className="ds-section">
                <div className="ds-label">Intelligence</div>
                <div className="info-card">
                  {influencer.whyFollow && (
                    <div className="info-row">
                      <span className="ik">Why follow</span>
                      <span className="iv" style={{ whiteSpace: "normal" }}>{influencer.whyFollow}</span>
                      <span />
                    </div>
                  )}
                  {influencer.engagementTip && (
                    <div className="info-row">
                      <span className="ik">Engagement tip</span>
                      <span className="iv" style={{ whiteSpace: "normal", color: "var(--accent-2)" }}>{influencer.engagementTip}</span>
                      <span />
                    </div>
                  )}
                  {influencer.track && (
                    <div className="info-row">
                      <span className="ik">Track</span>
                      <span className="iv">{influencer.track}</span>
                      <span />
                    </div>
                  )}
                  {influencer.tier && (
                    <div className="info-row">
                      <span className="ik">Tier</span>
                      <span className="iv" style={{ color: tierColor }}>{tierLabel}</span>
                      <span />
                    </div>
                  )}
                  {influencer.location && (
                    <div className="info-row">
                      <span className="ik">Location</span>
                      <span className="iv">{influencer.location}</span>
                      <span />
                    </div>
                  )}
                  {influencer.linkedinUrl && (
                    <div className="info-row">
                      <span className="ik">LinkedIn</span>
                      <a className="iv link" href={influencer.linkedinUrl} target="_blank" rel="noreferrer">Open profile ↗</a>
                      <span />
                    </div>
                  )}
                  {influencer.lastEngagement && (
                    <div className="info-row">
                      <span className="ik">Last touch</span>
                      <span className="iv" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{influencer.lastEngagement}</span>
                      <span />
                    </div>
                  )}
                </div>
              </div>

              {/* Activity stream */}
              <div className="ds-section">
                <div className="ds-label">
                  Activity
                  <span className="r">{myEngagement.length} touch{myEngagement.length !== 1 ? "es" : ""}</span>
                </div>
                {myEngagement.length === 0 ? (
                  <div className="empty" style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-mute)" }}>
                    No engagement logged yet. Use AI Response or AI Connect to draft your first touch.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {myEngagement.map((a, i) => (
                      <div key={i} style={{ padding: "11px 13px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap", marginBottom: 5 }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 9.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent-2)", border: "1px solid var(--border)", padding: "1px 7px", borderRadius: 5 }}>{a.actionType}</span>
                          {a.topic && <span className="tag">{a.topic}</span>}
                          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)" }}>{a.date}</span>
                        </div>
                        {a.message && <div style={{ fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.55, overflowWrap: "anywhere" }}>{a.message}</div>}
                        <div style={{ display: "flex", gap: 12, marginTop: 7 }}>
                          <span className={"pill sm " + (a.responseReceived === "Yes" ? "green" : "")} style={{ opacity: a.responseReceived === "Yes" ? 1 : 0.45 }}><span className="d" />{a.responseReceived === "Yes" ? "Response" : "No response"}</span>
                          <span className={"pill sm " + (a.connectionMade === "Connected" ? "accent" : "")} style={{ opacity: a.connectionMade === "Connected" ? 1 : 0.45 }}><span className="d" />{a.connectionMade === "Connected" ? "Connected" : "Not connected"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "ai-response" && (
            <AIResponseView
              influencers={influencers}
              lockedInfluencer={influencer}
              onLog={({ topic, message }) => logToTimeline({ actionType: "Commented", topic, message, statusUpdates: { engaged: true } })}
            />
          )}

          {tab === "ai-connect" && (
            <AIConnectView
              influencers={influencers}
              lockedInfluencer={influencer}
              onLog={({ topic, message }) => logToTimeline({ actionType: "Connection request", topic, message })}
            />
          )}
        </div>
      </div>
    </>
  );
}

window.LinkedInSSITab = LinkedInSSITab;
