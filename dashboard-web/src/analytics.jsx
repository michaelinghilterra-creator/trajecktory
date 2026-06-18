// Insights Tab — Claude-generated synthesis across every dashboard surface.
// Replaces the old Analytics tab (charts moved into Overview subtabs). Hits
// /api/insights/generate on click; result is cached server-side so reloads
// are instant.

const { useState: useStateI, useEffect: useEffectI } = React;

window.AnalyticsTab = function InsightsTab({ apps: rawApps, onOpen }) {
  const [insights, setInsights] = useStateI(null);
  const [loading, setLoading]   = useStateI(false);
  const [error, setError]       = useStateI(null);

  useEffectI(() => {
    fetch('/api/insights/latest')
      .then(r => r.json())
      .then(d => { if (d && d.generated_at) setInsights(d); })
      .catch(() => {});
  }, []);

  const generate = async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/insights/generate', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Generation failed');
      setInsights(d);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const apps = (rawApps || []).filter(a => a.status !== 'Closed');
  const ageLabel = (iso) => {
    if (!iso) return null;
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  };

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>Insights</h1>
          <div className="sub">
            {insights?.generated_at
              ? <>Last analysis {ageLabel(insights.generated_at)} · across {insights.pipeline_size} entries · {insights.model}</>
              : <>Run a Claude-powered synthesis across every tab — pipeline, follow-ups, TA, recruiters, LinkedIn.</>}
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

      {!insights && !loading && (
        <div className="card padded-lg">
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No analysis yet.</div>
          <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            Click <b>Generate Analysis</b> and Claude will read your full pipeline ({apps.length} entries),
            stale touchpoints, TA Outreach, recruiter rolodex, and engagement data — then return a tight
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
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>This usually takes 15–30 seconds.</div>
        </div>
      )}

      {insights && (
        <>
          {(insights.coach || insights.headline || insights.summary) && (
            <div style={{
              padding: '14px 16px',
              borderLeft: '3px solid var(--accent)',
              borderRadius: '0 6px 6px 0',
              background: 'var(--accent-bg)',
            }}>
              {insights.coach ? (
                <div className="col" style={{ gap: 10 }}>
                  {insights.coach.win && (
                    <CoachLine kind="win" text={insights.coach.win} apps={apps} onOpen={onOpen} />
                  )}
                  {insights.coach.improve && (
                    <CoachLine kind="improve" text={insights.coach.improve} apps={apps} onOpen={onOpen} />
                  )}
                </div>
              ) : (
                <>
                  {insights.headline && (
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.3, color: 'var(--text)' }}>{insights.headline}</div>
                  )}
                  {insights.summary && (
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--text-dim)', marginTop: insights.headline ? 6 : 0 }}>
                      <Linkify text={insights.summary} apps={apps} onOpen={onOpen} />
                    </div>
                  )}
                </>
              )}
              {insights.prior_summary && (insights.prior_summary.coach?.improve || insights.prior_summary.headline || insights.prior_summary.summary) && (
                <div className="mono dim" style={{ fontSize: 10.5, marginTop: 12, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)', lineHeight: 1.5 }}>
                  Previous ({ageLabel(insights.prior_summary.generated_at)}): {insights.prior_summary.coach?.improve || insights.prior_summary.headline || insights.prior_summary.summary}
                </div>
              )}
            </div>
          )}

          <div className="grid cols-2">
            <InsightCard
              title="What's working"
              accent="var(--green)"
              items={insights.whats_working}
              renderItem={(it) => (
                <>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}><Linkify text={it.insight} apps={apps} onOpen={onOpen} /></div>
                  <Citations items={it.citations} apps={apps} onOpen={onOpen} />
                </>
              )}
            />
            <InsightCard
              title="What's not"
              accent="var(--red)"
              items={insights.whats_not}
              renderItem={(it) => (
                <>
                  <div style={{ fontSize: 13, lineHeight: 1.5 }}><Linkify text={it.insight} apps={apps} onOpen={onOpen} /></div>
                  <Citations items={it.citations} apps={apps} onOpen={onOpen} />
                </>
              )}
            />
          </div>

          <InsightCard
            title="Recommended moves"
            accent="var(--accent)"
            items={insights.recommended_moves}
            renderItem={(it) => (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}><Linkify text={it.move} apps={apps} onOpen={onOpen} /></div>
                <div className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}><Linkify text={it.why} apps={apps} onOpen={onOpen} /></div>
                <Citations items={it.citations} apps={apps} onOpen={onOpen} />
              </>
            )}
          />

          <InsightCard
            title="This week's focus"
            accent="var(--yellow)"
            items={insights.this_week_focus}
            renderItem={(it) => (
              <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}><Linkify text={it.action} apps={apps} onOpen={onOpen} /></span>
                {it.target && <span className="mono dim" style={{ fontSize: 11 }}>→ <Linkify text={it.target} apps={apps} onOpen={onOpen} /></span>}
              </div>
            )}
          />
        </>
      )}
    </div>
  );
};

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
            title={`Open ${p.app.company} — ${p.app.role}`}
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
            title={clickable ? `Open #${app.id} ${app.company} — ${app.role}` : c}
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
