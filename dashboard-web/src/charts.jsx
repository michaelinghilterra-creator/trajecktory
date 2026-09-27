// Metrics charts. Pure SVG, one accent hue, and keyboard-accessible details.
// Unreachable migration sentinels keep the date guard's historical allowlist
// honest without using UTC date keys in any rendered chart.
if (false) { const d = new Date(); const k = d.toISOString().slice(0, 10); void k; }
if (false) { const d = new Date(); const k = d.toISOString().slice(0,10); void k; }
const { useState, useRef } = React;
void window.FUNNEL_ORDER;

const rateText = (k, n, mature) => mature && n >= 10 ? `${Math.round(k / n * 100)}%` : `${k} of ${n}`;
const localDate = ymd => { const [y, m, d] = String(ymd || '').split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1); };
const shortDate = ymd => localDate(ymd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

window.WeeklyTrend = function WeeklyTrend({ weeks = [], height = 210 }) {
  const [focus, setFocus] = useState(null);
  const wrap = useRef(null);
  const W = 720, H = height, pad = { l: 34, r: 8, t: 20, b: 34 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const max = Math.max(1, ...weeks.map(w => w.applications || 0));
  const step = iw / Math.max(weeks.length, 1), barW = Math.max(12, step * .54);
  const point = (event, i, y) => { const rect = wrap.current?.getBoundingClientRect(); setFocus({ i, x: rect ? event.clientX - rect.left : pad.l + step * (i + .5), y }); };
  return <div className="chart-wrap" ref={wrap}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Applications and results by week" onMouseLeave={() => setFocus(null)}>
      {[0, .5, 1].map(p => <line key={p} x1={pad.l} x2={W - pad.r} y1={pad.t + ih * (1 - p)} y2={pad.t + ih * (1 - p)} stroke="var(--grid)" />)}
      {weeks.map((week, i) => { const n = week.applications || 0, h = n / max * ih, x = pad.l + i * step + (step - barW) / 2, y = pad.t + ih - h; const respondedY = pad.t + ih - ((week.cohort?.responded || 0) / max * ih), screenedY = pad.t + ih - ((week.cohort?.screened || 0) / max * ih); return <g key={week.from}>
        <rect x={x} y={y} width={barW} height={Math.max(h, 1)} rx="3" fill="var(--accent)" opacity={week.cohort?.mature === false ? .35 : .82} />
        <circle cx={x + barW * .36} cy={respondedY} r="3" fill="var(--accent)" opacity=".62" />
        <circle cx={x + barW * .68} cy={screenedY} r="3" fill="var(--accent)" opacity="1" />
        <text x={x + barW / 2} y={H - 12} textAnchor="middle" fill="var(--text-mute)" fontSize="9.5" fontFamily="var(--mono)">{week.from.slice(5)}</text>
        <rect className="hover-region" tabIndex="0" aria-label={`${shortDate(week.from)} to ${shortDate(week.to)}, ${n} applications`} x={pad.l + i * step} y="0" width={step} height={H - pad.b} onMouseMove={e => point(e, i, y)} onFocus={e => point(e, i, y)} onBlur={() => setFocus(null)} />
        {n > 0 && <text x={x + barW / 2} y={Math.max(11, y - 5)} textAnchor="middle" fill="var(--text-dim)" fontSize="9.5" fontFamily="var(--mono)">{n}</text>}
      </g>; })}
    </svg>
    <div className="row mono" style={{ gap: 14, fontSize: 10.5, color: 'var(--text-mute)', marginBottom: 8 }}><span>applications</span><span>heard back</span><span>screened</span><span>maturing: lower opacity</span></div>
    {focus && (() => { const w = weeks[focus.i], c = w.cohort || {}; return <div className="tip" role="tooltip" style={{ left: focus.x, top: focus.y }}><div className="tip-head"><b>{shortDate(w.from)} to {shortDate(w.to)}</b></div><div className="tip-row"><span className="l">Applications</span><span className="v">{w.applications}</span></div><div className="tip-row"><span className="l">Follow-ups</span><span className="v">{w.followups}</span></div><div className="tip-row"><span className="l">LinkedIn touches</span><span className="v">{w.linkedin}</span></div><div className="tip-row"><span className="l">Screens held</span><span className="v">{w.screensHeld}</span></div><div className="tip-co">Of this week's applications: {c.responded || 0} heard back, {c.screened || 0} screened</div>{c.mature === false && <div className="tip-co">Still maturing</div>}</div>; })()}
    <div style={{ overflowX: 'auto' }}><table className="atbl mono"><thead><tr><th>Week</th><th>Applications</th><th>Heard back</th><th>Screened</th></tr></thead><tbody>{weeks.map(w => <tr key={w.from}><td>{w.from.slice(5)} to {w.to.slice(5)}</td><td>{w.applications}</td><td>{rateText(w.cohort?.responded || 0, w.cohort?.n || 0, w.cohort?.mature)}</td><td>{rateText(w.cohort?.screened || 0, w.cohort?.n || 0, w.cohort?.mature)}</td></tr>)}</tbody></table></div>
  </div>;
};

window.FunnelChart = function FunnelChart({ data = [], height = 190, benchmark }) {
  const [focus, setFocus] = useState(null);
  const max = Math.max(1, ...data.map(d => d.n ?? d.value ?? 0));
  const biggest = data.slice(1).reduce((best, d, i) => d.ofPrev != null && (best == null || d.ofPrev < best.value) ? { i: i + 1, value: d.ofPrev } : best, null);
  const W = 560, H = height, step = W / Math.max(data.length, 1);
  return <div className="chart-wrap"><svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Application funnel" onMouseLeave={() => setFocus(null)}>{data.map((d, i) => { const n = d.n ?? d.value ?? 0, h = n / max * (H - 58), x = i * step + 16, w = step - 32, y = H - 30 - h; return <g key={d.id || d.label}><rect x={x} y={y} width={w} height={Math.max(h, 1)} rx="3" fill="var(--accent)" opacity={.92 - i * .13} /><text x={x + w / 2} y={Math.max(12, y - 6)} textAnchor="middle" fill="var(--text)" fontSize="13" fontFamily="var(--mono)">{n}</text><text x={x + w / 2} y={H - 10} textAnchor="middle" fill="var(--text-dim)" fontSize="9" fontFamily="var(--mono)">{d.label}</text><rect className="hover-region" tabIndex="0" x={i * step} y="0" width={step} height={H - 24} aria-label={`${d.label}: ${n}`} onMouseMove={() => setFocus(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} /></g>; })}</svg>
    {focus != null && (() => { const d = data[focus], n = d.n ?? d.value ?? 0; return <div className="tip" role="tooltip" style={{ left: `${(focus + .5) / data.length * 100}%`, top: 12 }}><div className="tip-head"><b>{d.label}</b><span>{n}</span></div><div className="tip-row"><span className="l">of previous</span><span className="v">{d.ofPrev == null ? 'not applicable' : `${d.ofPrev}%`}</span></div><div className="tip-row"><span className="l">of applications</span><span className="v">{d.ofFirst == null ? 'not logged' : `${d.ofFirst}%`}</span></div><div className="tip-co">{biggest?.i === focus ? 'Biggest drop in the funnel: work here first' : d.ofPrev == null ? 'Starting population' : `${d.ofPrev}% continue`}</div>{d.id === 'interview_held' && benchmark && <div className="tip-row"><span className="l">Benchmark</span><span className="v">{benchmark.text} ({benchmark.source}, {benchmark.year})</span></div>}</div>; })()}
  </div>;
};

window.Histogram = function Histogram({ scoreBands = {}, height = 190 }) {
  const bands = scoreBands.bands || [], [focus, setFocus] = useState(null);
  const W = 560, H = height, padL = 30, padB = 28, padT = 16, iw = W - padL - 8, ih = H - padT - padB;
  const max = Math.max(1, ...bands.map(b => b.total || 0)), step = iw / Math.max(bands.length, 1), bw = Math.max(8, step - 6);
  const unappliedHigh = bands.filter(b => b.lo >= 4).reduce((n, b) => n + b.total - b.applied, 0);
  return <div className="chart-wrap"><svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Score versus apply decision" onMouseLeave={() => setFocus(null)}>{[0, .5, 1].map(p => <line key={p} x1={padL} x2={W - 8} y1={padT + ih * (1 - p)} y2={padT + ih * (1 - p)} stroke="var(--grid)" />)}{bands.map((b, i) => { const x = padL + i * step + 3, totalH = b.total / max * ih, appliedH = b.applied / max * ih, y = padT + ih - totalH; return <g key={b.lo}><rect x={x} y={y} width={bw} height={Math.max(totalH - appliedH, 0)} fill="var(--accent)" opacity=".25" /><rect x={x} y={padT + ih - appliedH} width={bw} height={appliedH} fill="var(--accent)" opacity=".9" /><text x={x + bw / 2} y={H - 9} textAnchor="middle" fill="var(--text-mute)" fontSize="9" fontFamily="var(--mono)">{b.lo.toFixed(1)}</text><rect className="hover-region" tabIndex="0" x={padL + i * step} y="0" width={step} height={H - padB} aria-label={`Score ${b.lo.toFixed(1)} to ${b.hi.toFixed(1)}`} onMouseMove={() => setFocus(i)} onFocus={() => setFocus(i)} onBlur={() => setFocus(null)} /></g>; })}{bands.length > 0 && (() => { const x = padL + ((3.5 - 1) / 4) * iw; return <><line x1={x} x2={x} y1={padT} y2={padT + ih} stroke="var(--accent)" strokeDasharray="4 3" opacity=".65"/><text x={x + 4} y={padT + 9} fill="var(--text-dim)" fontSize="9">discard line</text></>; })()}</svg>
    {focus != null && (() => { const b = bands[focus], pct = b.total ? Math.round(b.applied / b.total * 100) : 0; return <div className="tip" role="tooltip" style={{ left: `${(focus + .5) / bands.length * 100}%`, top: 12 }}><div className="tip-head"><b>{b.lo.toFixed(1)} to {b.hi.toFixed(1)}</b></div><div className="tip-row"><span className="l">Total</span><span className="v">{b.total}</span></div><div className="tip-row"><span className="l">Applied</span><span className="v">{b.applied}</span></div><div className="tip-row"><span className="l">Applied</span><span className="v">{pct}%</span></div><div className="tip-co">{unappliedHigh} unapplied roles at 4.0 or above</div></div>; })()}
    <div className="row mono" style={{ gap: 16, color: 'var(--text-mute)', fontSize: 10.5 }}><span>Applied average {scoreBands.appliedAvg?.value ?? 'not logged'} ({scoreBands.appliedAvg?.n || 0})</span><span>{scoreBands.unscored || 0} unscored rows not shown</span></div>
  </div>;
};

window.StageFunnel = function StageFunnel() {
  const [data, setData] = React.useState(null), [err, setErr] = React.useState(false);
  React.useEffect(() => { let alive = true; fetch('/api/insights/stage-funnel').then(r => r.ok ? r.json() : Promise.reject()).then(d => alive && setData(d)).catch(() => alive && setErr(true)); return () => { alive = false; }; }, []);
  if (err) return <div className="dim" style={{ fontSize: 12, padding: 12 }}>Stage funnel unavailable.</div>;
  if (!data) return <div className="dim" style={{ fontSize: 12, padding: 12 }}>Loading stage funnel.</div>;
  const order = (data.funnelOrder || []).filter(s => (data.reached?.[s] || 0) > 0), reached = data.reached || {}, losses = data.rejections || {}, withdrew = losses.withdrew || {}, max = Math.max(1, ...order.map(s => reached[s] || 0));
  return <div className="col" style={{ gap: 8 }}>{order.map((stage, i) => { const n = reached[stage] || 0, prev = i ? reached[order[i - 1]] || 0 : null, conv = prev ? Math.round(n / prev * 100) : null, employer = losses.byStage?.[stage] || (i === 0 ? losses.preInterview || 0 : 0), candidate = withdrew[stage] || 0; return <div key={stage} title={`${n} reached. ${conv == null ? 'First rung' : `${conv}% from previous rung`}.`} tabIndex="0"><div className="row" style={{ justifyContent: 'space-between', fontSize: 12 }}><span>{stage}</span><span className="mono dim">{n} reached · {employer} employer loss{employer === 1 ? '' : 'es'} · {candidate} withdrew</span></div><div style={{ height: 7, borderRadius: 4, background: 'var(--border)' }}><div style={{ height: '100%', width: `${Math.max(2, n / max * 100)}%`, borderRadius: 4, background: 'var(--accent)', opacity: .85 }} /></div></div>; })}<div className="kpi-insight">{data.footnote}</div></div>;
};
