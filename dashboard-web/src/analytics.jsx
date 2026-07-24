// Insights Tab — Claude-generated synthesis across every dashboard surface.
// Replaces the old Analytics tab (charts moved into Overview subtabs). Hits
// /api/insights/generate on click; result is cached server-side so reloads
// are instant.
//
// The synthesis is broken into sub-tabs so it reads one idea-cluster at a time
// instead of one overwhelming scroll:
//   Overview         — coach summary + interactive "this week's focus" + jump-to
//   What's working   — wins, stat strip, a "double down" action per item
//   What's not       — guardrail framing, stat strip, a "fix" action per item
//   Recommended moves— numbered, one-at-a-time action cards
// The header (title, metadata, Regenerate) is persistent above the sub-tab bar.

const { useState: useStateI, useEffect: useEffectI } = React;

// Self-contained icon renderer (analytics.jsx has no access to pipeline's PIcon).
const INS_ICONS = {
  overview: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  working:  'M3 17l6-6 4 4 7-7 M17 7h4v4',
  not:      'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  moves:    'M5 12h14 M12 5l7 7-7 7',
  check:    'M20 6 9 17l-5-5',
  trend:    'M7 17 17 7 M9 7h8v8',
  fix:      'M9 18l6-6-6-6',
  shield:   'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
};
function InsIcon({ name, size = 14 }) {
  const d = INS_ICONS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

function insAgeLabel(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

// insAgeLabel() alone is evaluated once at render, so a tab left open kept
// reporting the age it had at mount — "2h ago" indefinitely. Isolated in its own
// component like SyncIndicator so only this text re-renders on each tick.
function InsAge({ iso }) {
  const [, setTick] = useStateI(0);
  useEffectI(() => {
    const t = setInterval(() => setTick(x => x + 1), 60000);
    return () => clearInterval(t);
  }, []);
  return <>{insAgeLabel(iso)}</>;
}

const INS_SUBTABS = [
  { id: 'overview', label: 'Overview',          icon: 'overview' },
  { id: 'working',  label: "What's working",    icon: 'working' },
  { id: 'not',      label: "What's not",        icon: 'not' },
  { id: 'moves',    label: 'Recommended moves', icon: 'moves' },
];

// Outer section switcher: Review (moved from the sidebar) is the first subtab,
// then the Insights analysis. Both are always reachable. The Insights analysis
// keeps its own inner subtabs (Overview / What's working / ...) once generated,
// so on that section you see this switcher above the analysis's own subtab row.
window.AnalyticsTab = function InsightsSection({ apps, onOpen, toast }) {
  const [section, setSection] = useStateI('review');
  const SECTION_TABS = [
    { id: 'review',   label: 'Review',   icon: window.ICON.scale },
    { id: 'insights', label: 'Insights', icon: window.ICON.spark },
  ];
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {SECTION_TABS.map(s => (
          <div key={s.id} className={'subtab' + (section === s.id ? ' active' : '')} onClick={() => setSection(s.id)}>
            <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
            </span>
            {s.label}
          </div>
        ))}
      </div>
      <div className="col" style={{ gap: 16, paddingTop: 14 }}>
        {section === 'review'   && <window.ReviewTab toast={toast} />}
        {section === 'insights' && <InsightsBody apps={apps} onOpen={onOpen} />}
      </div>
    </div>
  );
};

function InsightsBody({ apps: rawApps, onOpen }) {
  const [insights, setInsights] = useStateI(null);
  const [loading, setLoading]   = useStateI(false);
  const [error, setError]       = useStateI(null);
  const [view, setView]         = useStateI('overview');

  useEffectI(() => {
    fetch('/api/insights/latest')
      .then(r => r.json())
      .then(d => { if (d && d.generated_at) setInsights(d); })
      .catch(() => {});
  }, []);

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const r = await window.tjkMutate('/api/insights/generate', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Generation failed');
      setInsights(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // The full tracker, deliberately unfiltered. This array is used ONLY to resolve
  // #NNN citations and for the entry count below, so filtering out Closed rows
  // bought nothing and silently degraded every citation pointing at one of them
  // to inert grey text. It also made this tab quote two different totals.
  const apps = rawApps || [];

  // The insights payload is a snapshot written on Generate, while every
  // neighbouring tab recomputes live. Say so when it has drifted, rather than
  // presenting frozen percentages as current.
  const snapAgeMs = insights?.generated_at ? Date.now() - new Date(insights.generated_at).getTime() : 0;
  const snapStale = !!insights && (snapAgeMs > 24 * 3600 * 1000 || insights.pipeline_size !== apps.length);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>Insights</h1>
          <div className="sub">
            {insights?.generated_at
              ? <>Last analysis <InsAge iso={insights.generated_at} /> · across {insights.pipeline_size} entries · {insights.model}</>
              : <>Run a Claude-powered synthesis across every tab: pipeline, follow-ups, TA, recruiters, LinkedIn.</>}
          </div>
        </div>
        <div className="act">
          <button className="btn primary sm" onClick={generate} disabled={loading}>
            {loading ? 'Analyzing…' : (insights ? '↻ Regenerate' : 'Generate Analysis')}
          </button>
        </div>
      </div>

      {error && (
        <div className="card padded-lg" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
          <div className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>Error: {error}</div>
        </div>
      )}

      {snapStale && (
        <div className="card" style={{ padding: '10px 14px', borderLeft: '3px solid var(--amber, #fbbf24)' }}>
          <div className="mono" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            <b>Snapshot, not live.</b> Every number on this tab is from the analysis generated{' '}
            <InsAge iso={insights.generated_at} /> across {insights.pipeline_size} entries.
            {insights.pipeline_size !== apps.length && <> Your tracker now holds <b>{apps.length}</b>.</>}
            {' '}Regenerate to refresh.
          </div>
        </div>
      )}

      {!insights && !loading && (
        <div className="card padded-lg">
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No analysis yet.</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            Click <b>Generate Analysis</b> and Claude will read your full pipeline ({apps.length} entries),
            stale touchpoints, TA Outreach, recruiter rolodex, and engagement data, then return a tight
            synthesis: what's working, what's not, recommended moves, and a focus list for this week.
            Each insight cites the specific rows or signals it's based on. Re-run anytime to refresh.
          </div>
        </div>
      )}

      {loading && (
        <div className="card padded-lg">
          <div className="mono dim" style={{ fontSize: 12 }}>
            Reading pipeline · synthesizing patterns · drafting recommendations…
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>This usually takes 15-30 seconds.</div>
        </div>
      )}

      {insights && (
        <>
          <div className="subtabs">
            {INS_SUBTABS.map(s => (
              <div key={s.id} className={'subtab' + (view === s.id ? ' active' : '')} onClick={() => setView(s.id)}>
                <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
                  <InsIcon name={s.icon} size={14} />
                </span>
                {s.label}
              </div>
            ))}
          </div>

          {view === 'overview' && <OverviewPanel insights={insights} apps={apps} onOpen={onOpen} setView={setView} />}
          {view === 'working'  && <WorkingPanel  insights={insights} apps={apps} onOpen={onOpen} />}
          {view === 'not'      && <NotPanel      insights={insights} apps={apps} onOpen={onOpen} />}
          {view === 'moves'    && <MovesPanel    insights={insights} apps={apps} onOpen={onOpen} />}
        </>
      )}
    </div>
  );
};

// ─── Overview ──────────────────────────────────────────────────────────────
function OverviewPanel({ insights, apps, onOpen, setView }) {
  const hasCoach = insights.coach || insights.headline || insights.summary;
  const prior = insights.prior_summary;
  const priorText = prior && (prior.coach?.improve || prior.headline || prior.summary);
  return (
    <div className="col" style={{ gap: 18 }}>
      {hasCoach && (
        <div style={{
          padding: '14px 16px',
          borderLeft: '3px solid var(--accent)',
          borderRadius: '0 6px 6px 0',
          background: 'var(--accent-bg)',
        }}>
          {insights.coach ? (
            <div className="col" style={{ gap: 10 }}>
              {insights.coach.win && <CoachLine kind="win" text={insights.coach.win} apps={apps} onOpen={onOpen} />}
              {insights.coach.improve && <CoachLine kind="improve" text={insights.coach.improve} apps={apps} onOpen={onOpen} />}
            </div>
          ) : (
            <>
              {insights.headline && <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{insights.headline}</div>}
              {insights.summary && <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)', marginTop: insights.headline ? 6 : 0 }}><Linkify text={insights.summary} apps={apps} onOpen={onOpen} /></div>}
            </>
          )}
          {priorText && (
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 12, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', lineHeight: 1.5 }}>
              Previous ({insAgeLabel(prior.generated_at)}): {priorText}
            </div>
          )}
        </div>
      )}

      <FocusChecklist items={insights.this_week_focus} keyId={insights.generated_at} apps={apps} onOpen={onOpen} />

      <JumpTo insights={insights} setView={setView} />
    </div>
  );
}

function JumpTo({ insights, setView }) {
  const cards = [
    { go: 'working', label: "What's working",    color: 'var(--green)',  n: (insights.whats_working || []).length },
    { go: 'not',     label: "What's not",        color: 'var(--red)',    n: (insights.whats_not || []).length },
    { go: 'moves',   label: 'Recommended moves', color: 'var(--accent)', n: (insights.recommended_moves || []).length },
  ];
  return (
    <div>
      <div className="mono dim" style={{ fontSize: 11, letterSpacing: '0.08em', marginBottom: 10 }}>JUMP TO</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        {cards.map(c => (
          <div key={c.go} className="ins-teaser" onClick={() => setView(c.go)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="row" style={{ gap: 8, fontSize: 13 }}><span className="dot" style={{ background: c.color }} />{c.label}</span>
              <span className="mono dim" style={{ fontSize: 12 }}>{c.n}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Interactive "this week's focus" checklist. Checked indices persist in
// localStorage keyed by generated_at, so a new analysis (new timestamp) starts
// fresh automatically. Toggles persist eagerly to avoid clobbering on key change.
function FocusChecklist({ items, keyId, apps, onOpen }) {
  const list = items || [];
  const storageKey = 'insights-focus-' + (keyId || 'none');
  const [done, setDone] = useStateI([]);
  useEffectI(() => {
    let v = [];
    try { const raw = localStorage.getItem(storageKey); if (raw) v = JSON.parse(raw); } catch (_) {}
    setDone(Array.isArray(v) ? v : []);
  }, [storageKey]);
  const persist = (next) => {
    setDone(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) {}
  };
  const toggle = (i) => persist(done.includes(i) ? done.filter(x => x !== i) : [...done, i]);
  const doneCount = done.filter(i => i >= 0 && i < list.length).length;

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="card-title"><span className="dot" style={{ background: 'var(--yellow)' }} />This week's focus</span>
        <span className="mono dim" style={{ fontSize: 11 }}>{doneCount} of {list.length} done</span>
      </div>
      {list.length === 0 && <div className="dim" style={{ fontSize: 12 }}>Nothing surfaced.</div>}
      <div className="col" style={{ gap: 8 }}>
        {list.map((it, i) => {
          const isDone = done.includes(i);
          return (
            <div key={i} className={'ins-focus-row' + (isDone ? ' done' : '')} onClick={() => toggle(i)}>
              <span className="ins-check">{isDone ? <InsIcon name="check" size={12} /> : null}</span>
              <span style={{ flex: 1 }}>
                <span className="ins-focus-lbl" style={{ fontSize: 13, fontWeight: 600 }}><Linkify text={it.action} apps={apps} onOpen={onOpen} /></span>
                {it.target && <span className="mono dim" style={{ fontSize: 11 }}> → <Linkify text={it.target} apps={apps} onOpen={onOpen} /></span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── What's working ──────────────────────────────────────────────────────────
function WorkingPanel({ insights, apps, onOpen }) {
  const items = insights.whats_working || [];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        This is your signal. The move is to do more of what's already earning replies, not to celebrate and stop.
      </div>
      <StatStrip metrics={insights.metrics} which="working" />
      <div className="col" style={{ gap: 12 }}>
        {items.length === 0 && <div className="dim" style={{ fontSize: 12 }}>Nothing surfaced.</div>}
        {items.map((it, i) => (
          <div key={i} className="ins-item" style={{ borderLeft: '3px solid var(--green)' }}>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}><Linkify text={it.insight} apps={apps} onOpen={onOpen} /></div>
            <Citations items={it.citations} apps={apps} onOpen={onOpen} />
            {it.double_down && (
              <div className="ins-action" style={{ color: 'var(--green)' }}>
                <InsIcon name="trend" size={13} />
                <span><Linkify text={it.double_down} apps={apps} onOpen={onOpen} /></span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── What's not ──────────────────────────────────────────────────────────────
function NotPanel({ insights, apps, onOpen }) {
  const items = insights.whats_not || [];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ins-guardrail">
        <InsIcon name="shield" size={15} />
        <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-dim)' }}>
          This is signal, not a scorecard. Every item below has a concrete fix. You're not behind, you're being shown exactly where to steer.
        </div>
      </div>
      <StatStrip metrics={insights.metrics} which="not" />
      <div className="col" style={{ gap: 12 }}>
        {items.length === 0 && <div className="dim" style={{ fontSize: 12 }}>Nothing surfaced.</div>}
        {items.map((it, i) => (
          <div key={i} className="ins-item" style={{ borderLeft: '3px solid var(--red)' }}>
            <div style={{ fontSize: 13, lineHeight: 1.55 }}><Linkify text={it.insight} apps={apps} onOpen={onOpen} /></div>
            <Citations items={it.citations} apps={apps} onOpen={onOpen} />
            {it.fix && (
              <div className="ins-action" style={{ color: 'var(--yellow)' }}>
                <InsIcon name="fix" size={13} />
                <span><Linkify text={it.fix} apps={apps} onOpen={onOpen} /></span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Recommended moves ───────────────────────────────────────────────────────
function MovesPanel({ insights, apps, onOpen }) {
  const items = insights.recommended_moves || [];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        In priority order. Each one is small enough to finish today.
      </div>
      <div className="col" style={{ gap: 12 }}>
        {items.length === 0 && <div className="dim" style={{ fontSize: 12 }}>Nothing surfaced.</div>}
        {items.map((it, i) => (
          <div key={i} className="ins-item" style={{ borderLeft: '3px solid var(--accent)' }}>
            <div className="row" style={{ gap: 11, alignItems: 'flex-start' }}>
              <span className="mono" style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700, flexShrink: 0 }}>{String(i + 1).padStart(2, '0')}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}><Linkify text={it.move} apps={apps} onOpen={onOpen} /></div>
                {it.why && <div className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}><Linkify text={it.why} apps={apps} onOpen={onOpen} /></div>}
                <Citations items={it.citations} apps={apps} onOpen={onOpen} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Stat strip — small metric cards built from the deterministic `metrics` block
// the server persists alongside the analysis. Returns null on older payloads.
function StatStrip({ metrics, which }) {
  if (!metrics) return null;
  const need = metrics.minSample || 10;
  // Render a rate honestly against the server's sample gate (lib/rate-confidence).
  // Below the gate we refuse the percent and show the raw fraction ("3/7, too few");
  // at or above it we show the rate WITH its 95% band, so a wide band on a passing-
  // but-thin cohort reads as uncertainty, not a hard number. No conf (an old cached
  // payload) means no card; regenerating insights repopulates it.
  const rateCard = ({ label, conf, prefix = '', color, subExtra = '' }) => {
    if (!conf) return null;
    if (!conf.sufficient) return { label, value: conf.k + '/' + conf.n, sub: `too few to rate (need ${need}+)` + subExtra };
    return { label, value: prefix + conf.rate + '%', sub: `${conf.k} of ${conf.n} · ${conf.lo}-${conf.hi}%` + subExtra, color };
  };
  const cards = [];
  if (which === 'working') {
    const ta = (metrics.topArchetypes || [])[0];
    const ts = (metrics.topSectors || [])[0];
    if (ta) cards.push(rateCard({ label: ta.archetype + ' response', conf: ta.conf, color: 'var(--green)' }));
    if (metrics.recruiter && metrics.recruiter.sent) cards.push(rateCard({ label: 'Recruiter channel', conf: metrics.recruiter.conf, color: 'var(--green)' }));
    if (ts) cards.push(rateCard({ label: ts.sector + ' sector', conf: ts.conf, color: 'var(--green)' }));
  } else if (which === 'not') {
    if (metrics.staleTotal != null) cards.push({ label: 'Stale touchpoints', value: String(metrics.staleTotal), sub: 'awaiting follow-up', color: 'var(--yellow)' });
    if (metrics.worstArchetype) cards.push(rateCard({ label: metrics.worstArchetype.archetype + ' (overweight)', conf: metrics.worstArchetype.conf, color: 'var(--red)' }));
    // Archiving overwrote the prior status on {archivedTouched} contacts, so their
    // replies are unrecoverable and this rate is a lower bound, not a measurement.
    if (metrics.talent && metrics.talent.sent) cards.push(rateCard({
      label: 'TA outreach',
      conf: metrics.talent.conf,
      prefix: metrics.talent.repliedIsFloor ? '≥' : '',
      color: 'var(--red)',
      subExtra: metrics.talent.repliedIsFloor ? ` · floor, ${metrics.talent.archivedTouched} archived replies not preserved` : '',
    }));
  }
  const shown = cards.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      {shown.map((c, i) => (
        <div key={i} className="ins-stat">
          <div className="dim" style={{ fontSize: 11, marginBottom: 5 }}>{c.label}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: c.color || 'var(--text)' }}>{c.value}</div>
          {c.sub && <div className="mono dim" style={{ fontSize: 10.5, marginTop: 2 }}>{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

function InsightCard({ title, accent, items, renderItem }) {
  return (
    <div className="card padded-lg">
      <div className="card-head">
        <span className="card-title"><span className="dot" style={{ background: accent }} />{title}</span>
        <span className="card-meta mono">{(items || []).length}</span>
      </div>
      <div className="col" style={{ gap: 12, marginTop: 4 }}>
        {(!items || items.length === 0) && (
          <div className="dim" style={{ fontSize: 12 }}>Nothing surfaced.</div>
        )}
        {(items || []).map((it, i) => (
          <div key={i} style={{ paddingBottom: 10, borderBottom: i < (items.length - 1) ? '1px solid var(--border)' : 'none' }}>
            {renderItem(it)}
          </div>
        ))}
      </div>
    </div>
  );
}

// CoachLine — one warm coach sentence (win or improve), with inline #NNN links.
function CoachLine({ kind, text, apps, onOpen }) {
  const isWin = kind === 'win';
  const color = isWin ? 'var(--green)' : 'var(--yellow)';
  const label = isWin ? 'WORKING' : 'NEXT';
  return (
    <div className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
      <span className="mono" style={{
        fontSize: 9.5, letterSpacing: '0.12em',
        color, border: `1px solid ${color}`,
        padding: '2px 7px', borderRadius: 4,
        flexShrink: 0, marginTop: 2,
      }}>{label}</span>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, color: 'var(--text)' }}>
        <Linkify text={text} apps={apps} onOpen={onOpen} />
      </div>
    </div>
  );
}

// Linkify — turn any "#NNN [Company]" reference in body text into a clickable
// span that opens the application drawer. Used inside coach lines, insights,
// moves, focus targets — everywhere Claude writes prose.
function Linkify({ text, apps, onOpen }) {
  if (!text) return null;
  // Match "#NNN" plus an optional trailing "Company" name (up to 4 capitalized words).
  const re = /#(\d{1,4})(\s+[A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,3})?/g;
  const parts = [];
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const id = parseInt(m[1], 10);
    const app = (apps || []).find(a => a.id === id);
    const full = '#' + m[1] + (m[2] || '');
    if (app && onOpen) {
      parts.push({ app, label: full, key: m.index });
    } else {
      parts.push(full);
    }
    last = re.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === 'string') return <React.Fragment key={i}>{p}</React.Fragment>;
        return (
          <span
            key={i}
            onClick={(e) => { e.stopPropagation(); onOpen(p.app); }}
            title={`Open ${p.app.company}: ${p.app.role}`}
            style={{
              color: 'var(--accent)',
              cursor: 'pointer',
              fontWeight: 600,
              textDecoration: 'underline',
              textDecorationStyle: 'dotted',
              textUnderlineOffset: 2,
            }}
          >{p.label}</span>
        );
      })}
    </>
  );
}

function Citations({ items, apps, onOpen }) {
  if (!items || !items.length) return null;
  // Parse a leading #NNN out of the citation. If found and the app exists,
  // the pill becomes a clickable button that opens that row's drawer.
  const resolve = (text) => {
    const m = /^#(\d{1,4})\b/.exec(text);
    if (!m) return null;
    const id = parseInt(m[1], 10);
    return (apps || []).find(a => a.id === id) || null;
  };
  return (
    <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
      {items.map((c, i) => {
        const app = resolve(c);
        const clickable = !!(app && onOpen);
        return (
          <span
            key={i}
            className="mono"
            onClick={clickable ? (e) => { e.stopPropagation(); onOpen(app); } : undefined}
            title={clickable ? `Open #${app.id} ${app.company}: ${app.role}` : c}
            style={{
              fontSize: 10,
              color: clickable ? 'var(--accent)' : 'var(--text-mute)',
              background: clickable ? 'rgba(167,139,250,0.14)' : 'var(--panel-2)',
              border: '1px solid ' + (clickable ? 'rgba(167,139,250,0.55)' : 'var(--border)'),
              padding: '2px 7px',
              borderRadius: 4,
              cursor: clickable ? 'pointer' : 'default',
              fontWeight: clickable ? 600 : 400,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {c}
            {clickable && <span style={{ fontSize: 9, opacity: 0.8 }}>↗</span>}
          </span>
        );
      })}
    </div>
  );
}
