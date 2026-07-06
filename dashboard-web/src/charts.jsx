// Charts — pure SVG, no external lib. Bloomberg-flavored.
const { useMemo, useState } = React;

// ---------- Funnel ----------
window.FunnelChart = function FunnelChart({ data, height = 220 }) {
  // data: [{label, value, color, apps?: []}]
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);
  const max = Math.max(...data.map(d => d.value), 1);
  const W = 520, H = height;
  const stepW = W / data.length;
  const total = data[0]?.value || 1;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="funnelGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="var(--accent)" stopOpacity="0.85"/>
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.35"/>
          </linearGradient>
        </defs>
        {data.map((d, i) => {
          const h = (d.value / max) * (H - 60);
          const x = i * stepW + 16;
          const w = stepW - 32;
          const y = H - 30 - h;
          const isHover = hover?.i === i;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={w} height={h} rx="3" fill={d.color || "url(#funnelGrad)"} className={`hover-target ${isHover ? "on bar-hl" : ""}`} />
              <text x={x + w / 2} y={y - 8} textAnchor="middle" fill="var(--text)" fontSize="14" fontWeight="600" fontFamily="JetBrains Mono, monospace">{d.value}</text>
              <text x={x + w / 2} y={H - 12} textAnchor="middle" fill="var(--text-dim)" fontSize="10" fontFamily="JetBrains Mono, monospace" letterSpacing="0.08em">{(d.short || d.label).toUpperCase()}</text>
              {/* invisible hover region */}
              <rect x={i * stepW} y={0} width={stepW} height={H - 28} className="hover-region"
                onMouseMove={(e) => {
                  const rect = wrapRef.current.getBoundingClientRect();
                  setHover({ i, px: e.clientX - rect.left, py: y });
                }} />
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        const d = data[hover.i];
        const next = data[hover.i + 1];
        const drop = next ? Math.round((d.value - next.value) / Math.max(d.value, 1) * 100) : null;
        const conv = total ? Math.round((d.value / total) * 100) : 0;
        const topApps = (d.apps || []).slice().sort((a, b) => b.score - a.score).slice(0, 3);
        const avgScore = (d.apps || []).length ? ((d.apps.reduce((s, a) => s + a.score, 0) / d.apps.length)).toFixed(2) : "—";
        const insight = hover.i === 0
          ? `Entry point: every logged role lands here.`
          : !next
            ? `Final stage. Conversion from entry: ${conv}%.`
            : drop > 60
              ? `Steep drop: ${drop}% don't continue. Worth investigating.`
              : drop > 40
                ? `Moderate fall-off (${drop}%).`
                : `Healthy passthrough (${100 - drop}% advance).`;
        return (
          <div className="tip" style={{ left: hover.px, top: hover.py }}>
            <div className="tip-head"><b>{d.label}</b><span>{conv}% of entry</span></div>
            <div className="tip-row"><span className="l">Reached this stage</span><span className="v">{d.value}</span></div>
            <div className="tip-row"><span className="l">Avg score here</span><span className="v">{avgScore}</span></div>
            {drop != null && <div className="tip-row"><span className="l">Drop to next</span><span className="v" style={{ color: drop > 50 ? "var(--red)" : drop > 30 ? "var(--orange)" : "var(--green)" }}>−{drop}%</span></div>}
            {topApps.length > 0 && <div className="tip-co">Top here: {topApps.map((a, i) => <span key={a.id}><b>{a.company}</b>{i < topApps.length - 1 ? ", " : ""}</span>)}</div>}
            <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
          </div>
        );
      })()}
    </div>
  );
};

// ---------- Histogram ----------
window.Histogram = function Histogram({ apps, height = 180 }) {
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);

  const buckets = useMemo(() => {
    const b = {};
    for (let s = 1.0; s <= 5.0 + 1e-9; s += 0.5) b[s.toFixed(1)] = [];
    apps.forEach(a => {
      const k = (Math.floor(a.score * 2) / 2).toFixed(1);
      if (b[k] != null) b[k].push(a);
    });
    return Object.entries(b);
  }, [apps]);

  const max = Math.max(...buckets.map(b => b[1].length), 1);
  const W = 520, H = height;
  const padL = 32, padR = 8, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const barW = innerW / buckets.length - 4;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        {[0, 0.25, 0.5, 0.75, 1].map(p => {
          const y = padT + innerH * (1 - p);
          return <line key={p} x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />;
        })}
        {buckets.map(([k, items], i) => {
          const v = items.length;
          const score = parseFloat(k);
          const color = score >= 4.0 ? "var(--green)" : score >= 3.0 ? "var(--yellow)" : "var(--red)";
          const h = (v / max) * innerH;
          const x = padL + i * (barW + 4);
          const y = padT + innerH - h;
          const isHover = hover?.i === i;
          return (
            <g key={k}>
              <rect x={x} y={y} width={barW} height={h} rx="2" fill={color} fillOpacity={isHover ? "0.95" : "0.7"} stroke={color} strokeWidth={isHover ? "1.5" : "1"} />
              {v > 0 && <text x={x + barW / 2} y={y - 4} textAnchor="middle" fill="var(--text-dim)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{v}</text>}
              <text x={x + barW / 2} y={H - 10} textAnchor="middle" fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{k}</text>
              <rect x={padL + i * (barW + 4) - 2} y={padT} width={barW + 4} height={innerH} className="hover-region"
                onMouseMove={(e) => {
                  const r = wrapRef.current.getBoundingClientRect();
                  setHover({ i, px: e.clientX - r.left, py: y });
                }} />
            </g>
          );
        })}
        {[0, max].map(v => (
          <text key={v} x={padL - 6} y={padT + innerH * (1 - v/max) + 3} textAnchor="end" fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{v}</text>
        ))}
        <line x1={padL + ((3.0 - 1.0) / 4.0) * innerW} x2={padL + ((3.0 - 1.0) / 4.0) * innerW} y1={padT} y2={padT + innerH} stroke="var(--red)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
        <line x1={padL + ((4.0 - 1.0) / 4.0) * innerW} x2={padL + ((4.0 - 1.0) / 4.0) * innerW} y1={padT} y2={padT + innerH} stroke="var(--green)" strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
      </svg>
      {hover && (() => {
        const [k, items] = buckets[hover.i];
        const score = parseFloat(k);
        const bucketLabel = `${k}-${(score + 0.4).toFixed(1)}`;
        const verdict = score >= 4.0 ? "strong match" : score >= 3.0 ? "borderline" : "weak";
        const verdictColor = score >= 4.0 ? "var(--green)" : score >= 3.0 ? "var(--yellow)" : "var(--red)";
        const top = items.slice().sort((a, b) => b.score - a.score).slice(0, 4);
        const applied = items.filter(a => !["Evaluated","Discarded","SKIP","Closed","Not a Fit"].includes(a.status)).length;
        const pct = apps.length ? Math.round((items.length / apps.length) * 100) : 0;
        const insight = items.length === 0
          ? "No roles in this band."
          : score >= 4.0 && applied < items.length
            ? `${items.length - applied} hot role${items.length - applied === 1 ? "" : "s"} here haven't been applied to.`
            : score < 3.0 && items.length > 0
              ? `Weak band. Consider tightening sourcing criteria.`
              : `${applied}/${items.length} progressed past Evaluated.`;
        return (
          <div className="tip" style={{ left: hover.px, top: hover.py }}>
            <div className="tip-head"><b>Score {bucketLabel}</b><span style={{ color: verdictColor }}>{verdict}</span></div>
            <div className="tip-row"><span className="l">Roles in band</span><span className="v">{items.length} <span style={{ color: "var(--text-mute)" }}>({pct}%)</span></span></div>
            <div className="tip-row"><span className="l">Past Evaluated</span><span className="v">{applied}/{items.length}</span></div>
            {top.length > 0 && <div className="tip-co">{top.map((a, i) => <span key={a.id}><b>{a.company}</b> {window.fmtScore(a.score)}{i < top.length - 1 ? " · " : ""}</span>)}</div>}
            <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
          </div>
        );
      })()}
    </div>
  );
};

// ---------- Activity Timeline (daily counts) ----------
window.Timeline = function Timeline({ apps, days = 28, height = 160 }) {
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);

  const data = useMemo(() => {
    const counts = {};
    const lists = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(window.TODAY); d.setUTCDate(d.getUTCDate() - (days - 1 - i));
      const k = d.toISOString().slice(0, 10);
      counts[k] = 0; lists[k] = [];
    }
    apps.forEach(a => { if (counts[a.date] != null) { counts[a.date]++; lists[a.date].push(a); } });
    return Object.keys(counts).map(k => ({ date: k, count: counts[k], items: lists[k] }));
  }, [apps, days]);

  const max = Math.max(...data.map(d => d.count), 3);
  const W = 720, H = height;
  const padL = 28, padR = 8, padT = 12, padB = 24;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const stepX = innerW / (data.length - 1);

  const points = data.map((d, i) => [padL + i * stepX, padT + innerH - (d.count / max) * innerH]);
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const areaPath = `${linePath} L ${padL + innerW} ${padT + innerH} L ${padL} ${padT + innerH} Z`;

  // total + best day insight
  const total = data.reduce((s, d) => s + d.count, 0);
  const peak = data.reduce((m, d) => d.count > m.count ? d : m, data[0]);

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="tlGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="var(--accent)" stopOpacity="0.4"/>
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0"/>
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(p => {
          const y = padT + innerH * (1 - p);
          return (
            <g key={p}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--grid)" strokeWidth="1" />
              <text x={padL - 6} y={y + 3} textAnchor="end" fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{Math.round(max * p)}</text>
            </g>
          );
        })}
        <path d={areaPath} fill="url(#tlGrad)" />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="1.5" />
        {points.map((p, i) => data[i].count > 0 && (
          <circle key={i} cx={p[0]} cy={p[1]} r={hover?.i === i ? "4.5" : "2.5"} fill="var(--accent)" stroke={hover?.i === i ? "var(--text)" : "var(--bg)"} strokeWidth={hover?.i === i ? "2" : "1"} />
        ))}
        {hover && (
          <line x1={points[hover.i][0]} x2={points[hover.i][0]} y1={padT} y2={padT + innerH} stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
        )}
        {/* X labels */}
        {data.filter((_, i) => i % 7 === 0 || i === data.length - 1).map((d, k, arr) => {
          const idx = data.findIndex(x => x.date === d.date);
          const x = padL + idx * stepX;
          return <text key={d.date} x={x} y={H - 8} textAnchor={k === 0 ? "start" : k === arr.length - 1 ? "end" : "middle"} fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{d.date.slice(5)}</text>;
        })}
        {/* hover columns — invisible, full height */}
        {data.map((d, i) => (
          <rect key={i} x={padL + (i - 0.5) * stepX} y={0} width={stepX} height={H - 20} className="hover-region"
            onMouseMove={(e) => {
              const r = wrapRef.current.getBoundingClientRect();
              setHover({ i, px: e.clientX - r.left, py: points[i][1] });
            }} />
        ))}
      </svg>
      {hover && (() => {
        const d = data[hover.i];
        const dateObj = new Date(d.date + "T00:00:00Z");
        const dow = dateObj.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
        const labeled = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const items = d.items;
        const top = items.slice().sort((a, b) => b.score - a.score).slice(0, 3);
        const avg = items.length ? (items.reduce((s, a) => s + a.score, 0) / items.length).toFixed(2) : "—";
        const dAgo = window.daysAgo(d.date);
        const insight = items.length === 0
          ? "Quiet day. No roles logged."
          : d.count === peak.count
            ? `Peak day in this window.`
            : items.filter(a => a.score >= 4.0).length > 0
              ? `${items.filter(a => a.score >= 4.0).length} hot lead${items.filter(a => a.score >= 4.0).length === 1 ? "" : "s"} (≥4.0) sourced.`
              : `Average sourcing day.`;
        return (
          <div className="tip" style={{ left: hover.px, top: hover.py }}>
            <div className="tip-head"><b>{dow} · {labeled}</b><span>{dAgo}d ago</span></div>
            <div className="tip-row"><span className="l">Roles logged</span><span className="v">{d.count}</span></div>
            <div className="tip-row"><span className="l">Avg score</span><span className="v">{avg}</span></div>
            {top.length > 0 && <div className="tip-co">{top.map((a, i) => <span key={a.id}><b>{a.company}</b> {window.fmtScore(a.score)}{i < top.length - 1 ? " · " : ""}</span>)}{items.length > 3 ? ` +${items.length - 3}` : ""}</div>}
            <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
          </div>
        );
      })()}
    </div>
  );
};

// ---------- Bar chart (horizontal, by archetype) ----------
window.HBars = function HBars({ data, height = 200, format = (v) => v.toFixed(2), tooltipMeta }) {
  // data: [{label, value, sub?, color?, items?: []}]
  // tooltipMeta: { kind: "score" | "response", unit?: string }
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);
  const max = Math.max(...data.map(d => d.value), 1);
  const rowH = height / data.length;
  const labelW = 120;
  const W = 520;
  const barMaxW = W - labelW - 60;

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} style={{ display: "block" }}>
        {data.map((d, i) => {
          const y = i * rowH;
          const w = (d.value / max) * barMaxW;
          const isHover = hover?.i === i;
          return (
            <g key={d.label}>
              <text x={labelW - 8} y={y + rowH/2 + 4} textAnchor="end" fill="var(--text-dim)" fontSize="11" fontFamily="JetBrains Mono, monospace">{d.label}</text>
              <rect x={labelW} y={y + rowH/2 - 8} width={barMaxW} height="16" rx="2" fill="var(--border)" />
              <rect x={labelW} y={y + rowH/2 - 8} width={w} height="16" rx="2" fill={d.color || "var(--accent)"} fillOpacity={isHover ? "1" : "0.8"} stroke={d.color || "var(--accent)"} strokeWidth={isHover ? "1" : "0"} />
              <text x={labelW + w + 8} y={y + rowH/2 + 4} fill="var(--text)" fontSize="11" fontFamily="JetBrains Mono, monospace" fontWeight="600">{format(d.value)}</text>
              {d.sub && <text x={labelW + w + 50} y={y + rowH/2 + 4} fill="var(--text-mute)" fontSize="10" fontFamily="JetBrains Mono, monospace">{d.sub}</text>}
              {/* hover region across the row */}
              <rect x={0} y={y} width={W} height={rowH} className="hover-region"
                onMouseMove={(e) => {
                  const r = wrapRef.current.getBoundingClientRect();
                  setHover({ i, px: e.clientX - r.left, py: y + rowH/2 });
                }} />
            </g>
          );
        })}
      </svg>
      {hover && tooltipMeta && (() => {
        const d = data[hover.i];
        const items = d.items || [];
        if (tooltipMeta.kind === "score") {
          const top = items.slice().sort((a,b)=>b.score-a.score).slice(0,3);
          const strong = items.filter(a => a.score >= 4.0).length;
          const rank = hover.i + 1;
          const insight = items.length === 0 ? "No roles in this archetype yet."
            : rank === 1 ? `Highest-scoring archetype. Lean into it.`
            : strong > items.length / 2 ? `Strong yield: ${strong}/${items.length} score ≥4.0.`
            : strong === 0 ? `No ≥4.0 hits. Sourcing here may be off.`
            : `${strong}/${items.length} hot. Mixed signal.`;
          return (
            <div className="tip" style={{ left: hover.px, top: hover.py }}>
              <div className="tip-head"><b>{d.label}</b><span style={{ color: d.color }}>avg {d.value.toFixed(2)}</span></div>
              <div className="tip-row"><span className="l">Roles</span><span className="v">{items.length}</span></div>
              <div className="tip-row"><span className="l">Strong (≥4.0)</span><span className="v">{strong}</span></div>
              {top.length > 0 && <div className="tip-co">{top.map((a,i)=><span key={a.id}><b>{a.company}</b> {window.fmtScore(a.score)}{i<top.length-1?" · ":""}</span>)}</div>}
              <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
            </div>
          );
        }
        if (tooltipMeta.kind === "response") {
          const top = items.slice().sort((a,b)=>b.score-a.score).slice(0,3);
          const insight = items.length === 0 ? "No applications in this sector yet."
            : d.value >= 50 ? `Outstanding response rate: high-signal sector.`
            : d.value >= 30 ? `Healthy response rate.`
            : d.value >= 15 ? `Below-average reply rate. Prioritize warm-intro paths.`
            : `Cold sector. Applications mostly silent.`;
          return (
            <div className="tip" style={{ left: hover.px, top: hover.py }}>
              <div className="tip-head"><b>{d.label}</b><span style={{ color: d.color }}>{Math.round(d.value)}%</span></div>
              <div className="tip-row"><span className="l">Replied / applied</span><span className="v">{d.sub}</span></div>
              <div className="tip-row"><span className="l">Roles tracked</span><span className="v">{items.length}</span></div>
              {top.length > 0 && <div className="tip-co">{top.map((a,i)=><span key={a.id}><b>{a.company}</b> {window.fmtScore(a.score)}{i<top.length-1?" · ":""}</span>)}</div>}
              <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
            </div>
          );
        }
        // Generic count-based tooltip — for buckets where the bar value is a
        // count (or %) and the insight is about share-of-total + sample list.
        //   tooltipMeta.kind = "count"
        //   tooltipMeta.unit (optional) = "%", "roles", "entries" (default "items")
        //   tooltipMeta.totalLabel (optional) = label override for the share-of-total row
        //   tooltipMeta.compareTotal (optional) = denominator for share-of-total %
        if (tooltipMeta.kind === "count") {
          const unit = tooltipMeta.unit || "items";
          const total = tooltipMeta.compareTotal != null
            ? tooltipMeta.compareTotal
            : data.reduce((s, x) => s + x.value, 0);
          const sharePct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          // Show top 3 companies if items have score, otherwise just first 3
          const sorted = items.slice().sort((a, b) => {
            const as = typeof a.score === "number" ? a.score : 0;
            const bs = typeof b.score === "number" ? b.score : 0;
            return bs - as;
          });
          const top = sorted.slice(0, 3);
          const insight = items.length === 0 ? "No entries in this bucket yet."
            : sharePct >= 40 ? `Dominant bucket: ${sharePct}% of total. Watch for concentration risk.`
            : sharePct >= 20 ? `Meaningful share (${sharePct}%) of the total mix.`
            : `Small slice (${sharePct}%) of the total mix.`;
          return (
            <div className="tip" style={{ left: hover.px, top: hover.py }}>
              <div className="tip-head"><b>{d.label}</b><span style={{ color: d.color }}>{format(d.value)}</span></div>
              <div className="tip-row"><span className="l">{tooltipMeta.totalLabel || `Share of total`}</span><span className="v">{sharePct}%</span></div>
              {d.sub && <div className="tip-row"><span className="l">Detail</span><span className="v">{d.sub}</span></div>}
              <div className="tip-row"><span className="l">{unit} in bucket</span><span className="v">{items.length}</span></div>
              {top.length > 0 && <div className="tip-co">{top.map((a, i) => (
                <span key={a.id || i}>
                  <b>{a.company || a.label || "—"}</b>
                  {typeof a.score === "number" ? ` ${window.fmtScore(a.score)}` : ""}
                  {i < top.length - 1 ? " · " : ""}
                </span>
              ))}</div>}
              <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
            </div>
          );
        }
        return null;
      })()}
    </div>
  );
};

// ---------- Velocity (rolling N-day) ----------
window.Velocity = function Velocity({ apps, windowDays = 7, color = "var(--cyan)" }) {
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);
  const points_to_plot = windowDays === 7 ? 28 : 45; // longer trail for 30d

  const { series } = useMemo(() => {
    const counts = {};
    const lists = {};
    const totalDays = points_to_plot + windowDays;
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(window.TODAY); d.setUTCDate(d.getUTCDate() - (totalDays - 1 - i));
      const k = d.toISOString().slice(0,10);
      counts[k] = 0; lists[k] = [];
    }
    apps.filter(a => !["Evaluated","Discarded","SKIP","Closed","Not a Fit"].includes(a.status))
      .forEach(a => { if (counts[a.date] != null) { counts[a.date]++; lists[a.date].push(a); } });
    const dates = Object.keys(counts).sort();
    const roll = [];
    for (let i = windowDays - 1; i < dates.length; i++) {
      let sum = 0;
      const items = [];
      for (let j = i - (windowDays - 1); j <= i; j++) { sum += counts[dates[j]]; items.push(...lists[dates[j]]); }
      roll.push({ date: dates[i], sum, items });
    }
    return { series: roll };
  }, [apps, windowDays, points_to_plot]);

  const max = Math.max(...series.map(s => s.sum), windowDays === 7 ? 5 : 15);
  const W = 480, H = 120;
  const padL = 24, padR = 8, padT = 8, padB = 18;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const stepX = innerW / (series.length - 1);
  const points = series.map((s, i) => [padL + i * stepX, padT + innerH - (s.sum / max) * innerH]);
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1][0]} ${padT + innerH} L ${padL} ${padT + innerH} Z`;
  const last = series[series.length - 1]?.sum ?? 0;
  const prev = series[Math.max(0, series.length - 1 - windowDays)]?.sum ?? 0;
  const targetLow = windowDays === 7 ? 4 : 17;
  const targetHigh = windowDays === 7 ? 6 : 26;
  const periodLabel = windowDays === 7 ? "7d" : "30d";
  const gradId = `velGrad-${windowDays}`;

  return (
    <div className="chart-wrap" ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.03em" }}>{last}</span>
        <span className="mono dim" style={{ fontSize: 11 }}>apps / {periodLabel}</span>
        <span className="mono" style={{ fontSize: 11, color: last >= prev ? "var(--green)" : "var(--red)" }}>
          {last >= prev ? "▲" : "▼"} {Math.abs(last - prev)} vs prev {periodLabel}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.4"/>
            <stop offset="100%" stopColor={color} stopOpacity="0"/>
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="1.5" />
        {hover && (
          <line x1={points[hover.i][0]} x2={points[hover.i][0]} y1={padT} y2={padT + innerH} stroke={color} strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />
        )}
        {points.map((p, i) => (i === points.length - 1 || hover?.i === i) && (
          <circle key={i} cx={p[0]} cy={p[1]} r={hover?.i === i ? "4.5" : "3.5"} fill={color} stroke="var(--bg)" strokeWidth="1.5" />
        ))}
        {series.map((s, i) => (
          <rect key={i} x={padL + (i - 0.5) * stepX} y={0} width={stepX} height={H - 18} className="hover-region"
            onMouseMove={(e) => {
              const r = wrapRef.current.getBoundingClientRect();
              setHover({ i, px: e.clientX - r.left, py: points[i][1] + 30 });
            }} />
        ))}
      </svg>
      {hover && (() => {
        const s = series[hover.i];
        const dateObj = new Date(s.date + "T00:00:00Z");
        const labeled = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
        const top = s.items.slice().sort((a,b)=>b.score-a.score).slice(0,3);
        const avgS = s.items.length ? (s.items.reduce((a,b)=>a+b.score,0)/s.items.length).toFixed(2) : "—";
        const prevS = series[hover.i - windowDays]?.sum;
        const wow = prevS != null ? s.sum - prevS : null;
        const insight = s.sum === 0 ? `No activity in this ${periodLabel} window.`
          : s.sum < targetLow ? `Below sustainable cadence (${targetLow}-${targetHigh}/${periodLabel}).`
          : s.sum > targetHigh ? `Above target. Watch quality.`
          : `On pace. Sustainable cadence.`;
        return (
          <div className="tip" style={{ left: hover.px, top: hover.py }}>
            <div className="tip-head"><b>Window ending {labeled}</b><span style={{ color }}>{s.sum}</span></div>
            <div className="tip-row"><span className="l">Apps sent ({periodLabel})</span><span className="v">{s.sum}</span></div>
            <div className="tip-row"><span className="l">Avg score</span><span className="v">{avgS}</span></div>
            {wow != null && <div className="tip-row"><span className="l">Vs prior {periodLabel}</span><span className="v" style={{ color: wow >= 0 ? "var(--green)" : "var(--red)" }}>{wow >= 0 ? "+" : ""}{wow}</span></div>}
            {top.length > 0 && <div className="tip-co">Top: {top.map((a,i)=><span key={a.id}><b>{a.company}</b>{i<top.length-1?" · ":""}</span>)}</div>}
            <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
          </div>
        );
      })()}
    </div>
  );
};

// ---------- Comp gap horizontal scatter ----------
window.CompGap = function CompGap({ apps }) {
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);
  const W = 520, H = 220;
  const padL = 28, padR = 12, padT = 12, padB = 28;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const xs = apps.map(a => a.salary - a.target);
  const min = Math.min(...xs, -50), max = Math.max(...xs, 50);
  const range = max - min;
  const xScale = (v) => padL + ((v - min) / range) * innerW;

  const archIdx = window.ARCHETYPES.reduce((m, a, i) => (m[a] = i, m), {});
  const yScale = (a) => padT + (archIdx[a] + 0.5) * (innerH / window.ARCHETYPES.length);

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: "block" }}>
        <line x1={xScale(0)} x2={xScale(0)} y1={padT} y2={padT + innerH} stroke="var(--border-2)" strokeWidth="1" strokeDasharray="3 3" />
        <text x={xScale(0)} y={H - 10} textAnchor="middle" fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">target</text>
        {window.ARCHETYPES.map((a, i) => {
          const archApps = apps.filter(x => x.archetype === a);
          const above = archApps.filter(x => x.salary >= x.target).length;
          const isHover = hover?.kind === "row" && hover.label === a;
          return (
            <g key={a}>
              <text x={padL - 6} y={yScale(a) + 3} textAnchor="end" fill={isHover ? "var(--text)" : "var(--text-dim)"} fontSize="10" fontFamily="JetBrains Mono, monospace" fontWeight={isHover ? 600 : 400}>{a}</text>
              <line x1={padL} x2={W - padR} y1={yScale(a)} y2={yScale(a)} stroke={isHover ? "var(--accent)" : "var(--grid)"} strokeWidth="1" strokeOpacity={isHover ? 0.4 : 1} />
              <rect x={padL - 24} y={yScale(a) - innerH / window.ARCHETYPES.length / 2} width={W - padL - padR + 24} height={innerH / window.ARCHETYPES.length} className="hover-region"
                onMouseMove={(e) => {
                  const r = wrapRef.current.getBoundingClientRect();
                  setHover({ kind: "row", label: a, items: archApps, above, px: e.clientX - r.left, py: yScale(a) });
                }} />
            </g>
          );
        })}
        {[-40, -20, 0, 20, 40].map(t => (
          <text key={t} x={xScale(t)} y={H - 10} textAnchor="middle" fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace">{t > 0 ? `+${t}k` : t < 0 ? `${t}k` : ""}</text>
        ))}
        {apps.map(a => {
          const gap = a.salary - a.target;
          const x = xScale(gap);
          const y = yScale(a.archetype);
          const fill = gap >= 0 ? "var(--green)" : "var(--red)";
          const isHover = hover?.kind === "dot" && hover.id === a.id;
          return (
            <circle key={a.id} cx={x} cy={y} r={isHover ? 6 : 4} fill={fill} fillOpacity={isHover ? 1 : 0.7} stroke={isHover ? "var(--text)" : fill} strokeWidth={isHover ? 1.5 : 0.5}
              onMouseMove={(e) => {
                const r = wrapRef.current.getBoundingClientRect();
                e.stopPropagation();
                setHover({ kind: "dot", id: a.id, app: a, px: e.clientX - r.left, py: y });
              }} />
          );
        })}
      </svg>
      {hover && (() => {
        if (hover.kind === "dot") {
          const a = hover.app;
          const gap = a.salary - a.target;
          const pct = Math.round((gap / a.target) * 100);
          const insight = gap >= 20 ? "Well above target. Strong negotiating leverage."
            : gap >= 0 ? "At or above target. Proceed."
            : gap >= -15 ? "Just below target, negotiable."
            : "Significantly below band. Likely a skip unless equity sweetens.";
          return (
            <div className="tip" style={{ left: hover.px, top: hover.py }}>
              <div className="tip-head"><b>{a.company}</b><span style={{ color: gap >= 0 ? "var(--green)" : "var(--red)" }}>{gap >= 0 ? "+" : ""}{gap}k ({pct >= 0 ? "+" : ""}{pct}%)</span></div>
              <div className="tip-row"><span className="l">Role</span><span className="v" style={{ fontFamily: "inherit" }}>{a.role}</span></div>
              <div className="tip-row"><span className="l">Posted</span><span className="v">{a.salary}k</span></div>
              <div className="tip-row"><span className="l">Your target</span><span className="v">{a.target}k</span></div>
              <div className="tip-row"><span className="l">Status</span><span className="v">{a.status}</span></div>
              <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
            </div>
          );
        }
        const items = hover.items;
        const above = hover.above;
        const below = items.length - above;
        const avgGap = items.length ? items.reduce((s,x)=>s+(x.salary-x.target),0)/items.length : 0;
        const insight = items.length === 0 ? "No roles in this archetype yet."
          : avgGap >= 10 ? "Pays above your target on average: high-leverage archetype."
          : avgGap >= 0 ? "Pays at-or-near target."
          : avgGap >= -10 ? "Slightly under target, negotiate up."
          : "Consistently under-band. Widen target or de-prioritize.";
        return (
          <div className="tip" style={{ left: hover.px, top: hover.py }}>
            <div className="tip-head"><b>{hover.label}</b><span style={{ color: avgGap >= 0 ? "var(--green)" : "var(--red)" }}>{avgGap >= 0 ? "+" : ""}{avgGap.toFixed(1)}k avg</span></div>
            <div className="tip-row"><span className="l">Roles</span><span className="v">{items.length}</span></div>
            <div className="tip-row"><span className="l">At/above target</span><span className="v" style={{ color: "var(--green)" }}>{above}</span></div>
            <div className="tip-row"><span className="l">Below target</span><span className="v" style={{ color: "var(--red)" }}>{below}</span></div>
            <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
          </div>
        );
      })()}
    </div>
  );
};

// ---------- Sankey: Identified → Offer ----------
window.Sankey = function Sankey({ apps }) {
  const [hover, setHover] = useState(null);
  const wrapRef = React.useRef(null);

  // Per-rung flow, fully derived from window.FUNNEL_ORDER so the interview ladder
  // is never re-hardcoded. Columns left → right:
  //   Col 0: Archetypes (source)
  //   Col 1: Evaluated (entered funnel) + Dismissed + Backfill Closed (triage)
  //   Col i+1 (i = 1..N-1): "reached rung i" main node (Applied … Offer)
  //   Col i+2 (i = 0..N-2): Lost @ rung i + Live-in rung i — share the next main col
  //
  // Closed entries honor the [reached: X] notes tag — see data.js helpers.
  // `eff()` returns the furthest funnel stage reached:
  //   - status=Rejected with [reached:2nd Interview] → "2nd Interview"
  //   - status=Rejected with no tag                  → "Applied" (sent, then closed)
  //   - status=2nd Interview (live)                  → "2nd Interview"
  const flow = useMemo(() => {
    const all = apps.slice();
    const STAGES = window.FUNNEL_ORDER;          // Evaluated … Offer (9 rungs)
    const N = STAGES.length;
    const idxOf = {};
    STAGES.forEach((s, i) => { idxOf[s] = i; });

    const eff = (a) => {
      const r = window.reachedStage(a); // e.g. '2nd Interview' for Rejected with [reached:X]
      if (r) return r;
      // Rejected (no tag) and No Response (ghosted) both mean an application was
      // sent that then closed at Applied.
      if (a.status === "Rejected" || a.status === "No Response") return "Applied";
      return a.status;
    };
    const effIdx = (a) => idxOf[eff(a)] ?? -1;

    const inEval = a => ["Evaluated","Applied","Responded","Offer","Rejected","No Response"].includes(a.status) || window.isInterviewStage(a.status);
    const dropped = a => ["Discarded","SKIP","Not a Fit"].includes(a.status);
    const aged = a => a.status === "Closed";
    // "Lost" terminal statuses. No Response can only land at Applied (eff caps it
    // there), so it shows as a loss at Applied, never deeper.
    const isRej = a => a.status === "Rejected" || a.status === "No Response";

    const evaluated = all.filter(inEval);
    const discarded = all.filter(dropped);
    const agedOut = all.filter(aged);

    // For each rung i: reachedAt[i] = funnel apps with effIdx >= i (the main node).
    // Apps that STOP at rung i split into lostAt[i] (terminal reject) and
    // liveAt[i] (currently sitting at that rung). reachedAt[i+1] = advanced.
    const reachedAt = STAGES.map((_, i) => evaluated.filter(a => effIdx(a) >= i));
    const lostAt = STAGES.map((s, i) => evaluated.filter(a => effIdx(a) === i && isRej(a)));
    const liveAt = STAGES.map((s, i) => evaluated.filter(a => effIdx(a) === i && a.status === s));

    // Archetype palette + source column
    const archColors = {
      RevOps: "#5b8def", SalesOps: "#22d3ee", Analytics: "#a78bfa",
      BizDev: "#f59e0b", SalesDev: "#22c55e", Strategy: "#ec4899",
    };
    const archNodes = window.ARCHETYPES.map(a => {
      const items = all.filter(x => x.archetype === a);
      return { id: `arch-${a}`, col: 0, label: a, count: items.length, items, accent: archColors[a] || "var(--accent)" };
    });
    const archLinks = [];
    archNodes.forEach(an => {
      const ev = an.items.filter(inEval);
      const dr = an.items.filter(dropped);
      const ag = an.items.filter(aged);
      if (ev.length) archLinks.push({ from: an.id, to: "evaluated", count: ev.length, items: ev, color: an.accent });
      if (dr.length) archLinks.push({ from: an.id, to: "discarded", count: dr.length, items: dr, color: an.accent });
      if (ag.length) archLinks.push({ from: an.id, to: "agedOut",  count: ag.length, items: ag, color: an.accent });
    });

    const meta = window.STATUS_META || {};
    const stageColor = (s) => (meta[s] && meta[s].color) || "var(--accent)";
    // Concise node labels so 10 columns stay legible (column headers carry the
    // full stage name). Lost = "✕ <short>", live = a friendly "still here" line.
    const SHORT = { "Phone Screen": "Screen", "1st Interview": "1st", "2nd Interview": "2nd", "3rd Interview": "3rd", "4th Interview": "4th" };
    const shortOf = (s) => SHORT[s] || s;
    const liveLabel = (s, i) => i === 0 ? "Still Evaluating" : i === 1 ? "Awaiting Reply" : i === 2 ? "In Reply" : `In ${shortOf(s)}`;
    const mainId = (i) => i === 0 ? "evaluated" : `reached-${i}`;

    const nz = (n) => n.count > 0;

    const nodes = [
      ...archNodes,                                                                                                  // col 0
      { id: "discarded", col: 1, label: "Dismissed",       count: discarded.length, items: discarded, accent: "#71717a" },
      { id: "agedOut",   col: 1, label: "Backfill Closed", count: agedOut.length,   items: agedOut,   accent: "#52525b" },
    ];
    // Main "reached" node per rung.
    STAGES.forEach((s, i) => {
      nodes.push({ id: mainId(i), col: i + 1, label: s, count: reachedAt[i].length, items: reachedAt[i], accent: stageColor(s) });
    });
    // Lost + live branch nodes share the column of the next main node (i + 2).
    for (let i = 0; i < N - 1; i++) {
      nodes.push({ id: `lost-${i}`, col: i + 2, label: `✕ ${shortOf(STAGES[i])}`, count: lostAt[i].length, items: lostAt[i], accent: "#ef4444" });
      nodes.push({ id: `live-${i}`, col: i + 2, label: liveLabel(STAGES[i], i), count: liveAt[i].length, items: liveAt[i], accent: i <= 2 ? stageColor(STAGES[i]) : "#52525b" });
    }
    const allNodes = nodes.filter(nz);

    const links = [...archLinks];
    for (let i = 0; i < N - 1; i++) {
      const from = mainId(i);
      links.push({ from, to: mainId(i + 1), count: reachedAt[i + 1].length, items: reachedAt[i + 1] });
      links.push({ from, to: `lost-${i}`,   count: lostAt[i].length,        items: lostAt[i] });
      links.push({ from, to: `live-${i}`,   count: liveAt[i].length,        items: liveAt[i] });
    }
    const allLinks = links.filter(nz);
    return { nodes: allNodes, links: allLinks, total: all.length };
  }, [apps]);

  // Columns derived from the funnel ladder: archetype source + one per rung.
  const SANKEY_STAGES = window.FUNNEL_ORDER;
  const COL_SHORT = { "Evaluated": "TRIAGED", "Applied": "APPLIED", "Responded": "REPLIED", "Phone Screen": "SCREEN", "1st Interview": "1ST", "2nd Interview": "2ND", "3rd Interview": "3RD", "4th Interview": "4TH", "Offer": "OFFER" };
  const colHeaders = ["ARCHETYPE", ...SANKEY_STAGES.map(s => COL_SHORT[s] || s.toUpperCase())];

  const W = 1280, H = 480;
  const padL = 16, padR = 16, padT = 20, padB = 30;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const cols = colHeaders.length;
  const colX = c => padL + (c / (cols - 1)) * innerW;
  const nodeW = 12;

  // layout per column: stack nodes proportionally to count, centered
  const layout = useMemo(() => {
    const byCol = {};
    flow.nodes.forEach(n => { (byCol[n.col] ||= []).push(n); });
    const nodeRects = {};
    Object.entries(byCol).forEach(([cStr, list]) => {
      const c = +cStr;
      const sum = list.reduce((s, n) => s + n.count, 0) || 1;
      // total drawing height = innerH minus gaps between nodes
      const gap = 6;
      const totalGap = (list.length - 1) * gap;
      const drawH = innerH - totalGap;
      const startY = padT + (innerH - (drawH * (sum / Math.max(sum, 1)) + totalGap)) / 2;
      let y = startY;
      list.sort((a, b) => b.count - a.count); // biggest top
      list.forEach(n => {
        const h = Math.max(2, (n.count / sum) * drawH);
        nodeRects[n.id] = { x: colX(c) - nodeW / 2, y, h, w: nodeW, node: n };
        y += h + gap;
      });
    });
    // For links, assign source/target offsets (stack them within node)
    const linkSourceOff = {}; // id -> offset accumulator
    const linkTargetOff = {};
    const linkPaths = flow.links.map(l => {
      const s = nodeRects[l.from], t = nodeRects[l.to];
      if (!s || !t || l.count === 0) return null;
      const sH = (l.count / s.node.count) * s.h;
      const tH = (l.count / t.node.count) * t.h;
      const sy = s.y + (linkSourceOff[l.from] || 0);
      const ty = t.y + (linkTargetOff[l.to] || 0);
      linkSourceOff[l.from] = (linkSourceOff[l.from] || 0) + sH;
      linkTargetOff[l.to]   = (linkTargetOff[l.to]   || 0) + tH;
      const x0 = s.x + s.w, x1 = t.x;
      const cx = (x0 + x1) / 2;
      const path = `M ${x0} ${sy} C ${cx} ${sy} ${cx} ${ty} ${x1} ${ty} L ${x1} ${ty + tH} C ${cx} ${ty + tH} ${cx} ${sy + sH} ${x0} ${sy + sH} Z`;
      return { ...l, path, color: t.node.accent, sourceNode: s.node, targetNode: t.node };
    }).filter(Boolean);
    return { nodeRects, linkPaths };
  }, [flow]);

  const showTip = (kind, key, e, payload) => {
    const r = wrapRef.current.getBoundingClientRect();
    setHover({ kind, key, payload, px: e.clientX - r.left, py: e.clientY - r.top });
  };

  return (
    <div className="chart-wrap" ref={wrapRef} onMouseMove={(e) => {
      if (hover) {
        const r = wrapRef.current.getBoundingClientRect();
        setHover(h => ({ ...h, px: e.clientX - r.left, py: e.clientY - r.top }));
      }
    }} onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs>
          {layout.linkPaths.map((l, i) => (
            <linearGradient key={i} id={`sankey-grad-${i}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor={l.sourceNode.accent} stopOpacity="0.45"/>
              <stop offset="100%" stopColor={l.targetNode.accent} stopOpacity="0.55"/>
            </linearGradient>
          ))}
        </defs>
        {/* Column headers */}
        {colHeaders.map((label, i) => (
          <text key={label + i} x={colX(i)} y={12} textAnchor="middle" fill="var(--text-mute)" fontSize="9.5" fontFamily="JetBrains Mono, monospace" letterSpacing="0.1em">{label}</text>
        ))}
        {/* Links */}
        {layout.linkPaths.map((l, i) => {
          const isHover = hover?.kind === "link" && hover.key === `${l.from}->${l.to}`;
          return (
            <path key={i} d={l.path} fill={`url(#sankey-grad-${i})`} stroke={l.color} strokeWidth={isHover ? "0.8" : "0"} strokeOpacity="0.6" opacity={hover && hover.kind === "link" && !isHover ? 0.25 : isHover ? 1 : 0.7}
              style={{ cursor: "pointer", transition: "opacity 0.12s" }}
              onMouseEnter={(e) => showTip("link", `${l.from}->${l.to}`, e, l)} />
          );
        })}
        {/* Nodes */}
        {Object.values(layout.nodeRects).map((r) => {
          const isHover = hover?.kind === "node" && hover.key === r.node.id;
          return (
            <g key={r.node.id}>
              <rect x={r.x} y={r.y} width={r.w} height={r.h} rx="2" fill={r.node.accent} fillOpacity={isHover ? "1" : "0.85"} stroke="var(--bg)" strokeWidth="1"
                style={{ cursor: "pointer" }}
                onMouseEnter={(e) => showTip("node", r.node.id, e, r.node)} />
              <text x={r.node.col === cols - 1 ? r.x - 6 : r.x + r.w + 6} y={r.y + r.h / 2 + 3.5}
                textAnchor={r.node.col === cols - 1 ? "end" : "start"}
                fill="var(--text)" fontSize="10.5" fontWeight="500" style={{ pointerEvents: "none" }}>
                {r.node.label} <tspan fill="var(--text-mute)" fontFamily="JetBrains Mono, monospace" fontSize="10">{r.node.count}</tspan>
              </text>
            </g>
          );
        })}
      </svg>
      {hover && (() => {
        if (hover.kind === "node") {
          const n = hover.payload;
          const pct = flow.total ? Math.round((n.count / flow.total) * 100) : 0;
          const top = n.items.slice().sort((a,b)=>b.score-a.score).slice(0,3);
          const avgS = n.items.length ? (n.items.reduce((s,a)=>s+a.score,0)/n.items.length).toFixed(2) : "—";
          const lastReached = "reached-" + (window.FUNNEL_ORDER.length - 1);
          const insight = n.id.startsWith("arch-") ? `Source archetype: ${pct}% of total roles tracked.`
            : n.id === "discarded" ? "Dismissed: SKIP, Not a Fit, or Discarded, filtered before applying."
            : n.id === "agedOut" ? "Posting closed before you could act, aged out of the pipeline."
            : n.id === "live-0" ? "Sitting in queue. Pick or skip; don't park indefinitely."
            : n.id === "live-1" ? "Applied with no reply. Consider warmer paths."
            : n.id === lastReached ? "Bottom of the funnel. Negotiate confidently."
            : n.id.startsWith("lost-") ? "Pipeline dropped at this rung. Track for pattern (sector, archetype, round)."
            : n.id.startsWith("live-") ? "Live in this round. Keep momentum and prep the next step."
            : `${pct}% of total roles reach this stage.`;
          return (
            <div className="tip" style={{ left: hover.px, top: hover.py }}>
              <div className="tip-head"><b>{n.label}</b><span style={{ color: n.accent }}>{pct}%</span></div>
              <div className="tip-row"><span className="l">Roles</span><span className="v">{n.count}</span></div>
              <div className="tip-row"><span className="l">Avg score</span><span className="v">{avgS}</span></div>
              {top.length > 0 && <div className="tip-co">{top.map((a,i)=><span key={a.id}><b>{a.company}</b> {window.fmtScore(a.score)}{i<top.length-1?" · ":""}</span>)}</div>}
              <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
            </div>
          );
        }
        if (hover.kind === "link") {
          const l = hover.payload;
          const sCount = l.sourceNode.count;
          const passRate = sCount ? Math.round((l.count / sCount) * 100) : 0;
          const top = l.items.slice().sort((a,b)=>b.score-a.score).slice(0,3);
          const insight = l.count === 0 ? "No roles took this path."
            : passRate >= 70 ? `Strong throughput: most ${l.sourceNode.label} flow here.`
            : passRate >= 40 ? `Moderate split.`
            : `Narrow path: only ${passRate}% of ${l.sourceNode.label} continue here.`;
          return (
            <div className="tip" style={{ left: hover.px, top: hover.py }}>
              <div className="tip-head"><b>{l.sourceNode.label} → {l.targetNode.label}</b><span style={{ color: l.targetNode.accent }}>{passRate}%</span></div>
              <div className="tip-row"><span className="l">Roles</span><span className="v">{l.count} / {sCount}</span></div>
              {top.length > 0 && <div className="tip-co">{top.map((a,i)=><span key={a.id}><b>{a.company}</b> {window.fmtScore(a.score)}{i<top.length-1?" · ":""}</span>)}</div>}
              <div className="tip-co" style={{ marginTop: 6, fontStyle: "italic", color: "var(--text-mute)" }}>{insight}</div>
            </div>
          );
        }
      })()}
    </div>
  );
};

// Interview stage funnel + rejection-by-stage. Fetches /api/insights/stage-funnel
// (derived from the dated status-event log): how many apps reached each rung, and
// for every closed row (Rejected / No Response) which interview round it exited at.
window.StageFunnel = function StageFunnel() {
  const [data, setData] = React.useState(null);
  const [err, setErr] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    fetch('/api/insights/stage-funnel')
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { if (alive) setData(d); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
  }, []);

  if (err) return <div className="dim" style={{ fontSize: 12, padding: 12 }}>Stage funnel unavailable.</div>;
  if (!data) return <div className="dim" style={{ fontSize: 12, padding: 12 }}>Loading stage funnel…</div>;

  const order = data.funnelOrder || [];
  const reached = data.reached || {};
  const meta = window.STATUS_META || {};
  const maxReached = Math.max(1, ...order.map(s => reached[s] || 0));
  const convByTo = {};
  (data.conversion || []).forEach(c => { convByTo[c.to] = c.rate; });

  const rej = data.rejections || { byStage: {}, preInterview: 0, unknownStage: 0, total: 0 };
  const ivStages = data.interviewStages || [];
  const rejRows = [
    ...ivStages.map(s => ({ label: s, n: (rej.byStage || {})[s] || 0, color: (meta[s] && meta[s].color) || '#f59e0b' })),
    { label: 'Pre-interview', n: rej.preInterview || 0, color: '#60a5fa' },
    { label: 'Stage unknown', n: rej.unknownStage || 0, color: '#71717a' },
  ];
  const maxRej = Math.max(1, ...rejRows.map(r => r.n));

  const Bar = ({ n, max, color }) => (
    <div style={{ height: 6, borderRadius: 4, background: 'var(--border)' }}>
      <div style={{ height: '100%', borderRadius: 4, width: `${Math.max(2, Math.round((n / max) * 100))}%`, background: color }} />
    </div>
  );

  return (
    <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 280 }}>
        <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Reached each stage</div>
        <div className="col" style={{ gap: 7 }}>
          {order.map(s => {
            const n = reached[s] || 0;
            const conv = convByTo[s];
            return (
              <div key={s}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                  <span>{s}</span>
                  <span className="mono dim">{n}{conv != null ? ` · ${conv}%` : ''}</span>
                </div>
                <Bar n={n} max={maxReached} color={(meta[s] && meta[s].color) || 'var(--accent)'} />
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 280 }}>
        <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Where we lose them · {rej.total} closed</div>
        <div className="col" style={{ gap: 7 }}>
          {rejRows.map(r => (
            <div key={r.label}>
              <div className="row" style={{ justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
                <span>{r.label}</span>
                <span className="mono dim">{r.n}</span>
              </div>
              <Bar n={r.n} max={maxRej} color={r.color} />
            </div>
          ))}
        </div>
        <div className="mono dim" style={{ fontSize: 10.5, marginTop: 10, lineHeight: 1.5 }}>
          Attributed from {data.eventsTracked || 0} logged status changes. Losses recorded before this view existed, with no tracked progression, show as "Stage unknown" and fill in over time.
        </div>
      </div>
    </div>
  );
};

// Simple sparkline
window.Sparkline = function Sparkline({ data, color = "var(--accent)", width = 80, height = 22 }) {
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const range = (max - min) || 1;
  const stepX = width / (data.length - 1);
  const points = data.map((v, i) => [i * stepX, height - ((v - min) / range) * height]);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block" }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
};
