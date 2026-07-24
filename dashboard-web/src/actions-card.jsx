// ActionsCard — what the USER did, plus application cohorts by send-week.
//
// Split out of overview.jsx because it owns two fetches and a fair amount of
// rendering, and the Overview was already the largest component in the app.
//
// The distinction this card exists to make: every other time-series on the page
// counts rows ENTERING THE TRACKER, which is scanner output. That line rises on a
// day of no work because a scheduled scan ran, and stays flat on a day of ten
// hand-sent applications. Actions are the things you actually did.
const { useState: useStateA, useEffect: useEffectA } = React;

window.ActionsCard = function ActionsCard() {
  const [actions, setActions] = useStateA(null);
  const [cohorts, setCohorts] = useStateA(null);
  const [err, setErr] = useStateA(null);

  useEffectA(() => {
    let live = true;
    Promise.all([
      fetch('/api/activity/actions?days=60', { headers: { accept: 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject(new Error(`actions ${r.status}`))),
      fetch('/api/activity/cohorts?weeks=8', { headers: { accept: 'application/json' } }).then(r => r.ok ? r.json() : Promise.reject(new Error(`cohorts ${r.status}`))),
    ]).then(([a, c]) => { if (!live) return; setActions(a); setCohorts(c); })
      .catch(e => { if (live) setErr(e.message); });
    return () => { live = false; };
  }, []);

  if (err) {
    return (
      <div className="card padded-lg">
        <div className="card-head"><span className="card-title">Actions</span></div>
        <div className="no-data">Could not load actions ({err}).</div>
      </div>
    );
  }
  if (!actions || !cohorts) {
    return (
      <div className="card padded-lg">
        <div className="card-head"><span className="card-title">Actions</span></div>
        <div className="no-data">Loading actions…</div>
      </div>
    );
  }

  const applied = actions.series.find(s => s.key === 'applications') || { points: [], total: 0 };
  const pending = actions.series.filter(s => s.available === false);
  const pts = applied.points || [];
  const max = Math.max(1, ...pts.map(p => p.value));
  const W = 100, H = 34;

  // Last 7 vs prior 7, on ACTIONS rather than intake.
  const tail = pts.slice(-14);
  const last7 = tail.slice(-7).reduce((a, p) => a + p.value, 0);
  const prior7 = tail.slice(0, 7).reduce((a, p) => a + p.value, 0);
  const trend = last7 - prior7;

  const weeks = cohorts.weeks || [];
  // A cohort younger than ~7 days cannot be judged: the plan's own observation is
  // that positive responses arrive within days (6-day median), so a fresh week with
  // no replies yet is not a failed week. Marking it prevents reading a zero that
  // has not had time to become anything else.
  const todayYmd = actions.end;
  const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

  return (
    <div className="card padded-lg" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-head">
        <span className="card-title">Actions · last 60 days</span>
        <span className="card-meta mono">
          {applied.total} applications sent &nbsp;·&nbsp;
          Last 7d <span style={{ color: 'var(--accent)' }}>{last7}</span>&nbsp;·&nbsp;
          Prior 7d <span style={{ color: 'var(--text-dim)' }}>{prior7}</span>
          <span style={{ color: trend > 0 ? 'var(--green)' : trend < 0 ? 'var(--red)' : 'var(--text-dim)', marginLeft: 6 }}>
            {trend > 0 ? `▲ +${trend}` : trend < 0 ? `▼ ${trend}` : '— flat'}
          </span>
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 56, display: 'block' }} role="img"
        aria-label={`Applications sent per day over the last 60 days, ${applied.total} total`}>
        {pts.map((p, i) => {
          if (!p.value) return null;
          const bw = W / pts.length;
          const h = (p.value / max) * (H - 2);
          return <rect key={p.date} x={i * bw} y={H - h} width={Math.max(0.6, bw - 0.4)} height={h}
            rx="0.4" fill="var(--accent)" opacity="0.85"><title>{`${p.date}: ${p.value} sent`}</title></rect>;
        })}
      </svg>

      {pending.length > 0 && (
        <div className="mono" style={{ marginTop: 8, fontSize: 10.5, color: 'var(--text-mute)' }}>
          {pending.map(s => `${s.label}: not logged yet (${s.source})`).join(' · ')}
        </div>
      )}

      {/* ── Cohorts ─────────────────────────────────────────────────────────
          The only view on this page that can compare one week's approach against
          another's. Everything else is a snapshot of where things stand now. */}
      <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
        <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', marginBottom: 6 }}>
          BY SEND WEEK · what became of each week's applications
        </div>
        {weeks.length === 0 ? (
          <div className="no-data">No dated applications yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="mono" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ color: 'var(--text-mute)', textAlign: 'right' }}>
                  <th style={{ textAlign: 'left', fontWeight: 400, paddingBottom: 4 }}>Week of</th>
                  <th style={{ fontWeight: 400 }}>Sent</th>
                  <th style={{ fontWeight: 400 }}>Replied</th>
                  <th style={{ fontWeight: 400 }}>Screened</th>
                  <th style={{ fontWeight: 400 }}>Reply %</th>
                </tr>
              </thead>
              <tbody>
                {weeks.slice().reverse().map(w => {
                  const age = daysBetween(w.week, todayYmd);
                  const tooYoung = age < 7;
                  return (
                    <tr key={w.week} style={{ textAlign: 'right', color: tooYoung ? 'var(--text-mute)' : 'var(--text-dim)' }}
                      title={tooYoung ? 'Less than a week old. Replies arrive within days, so this cannot be judged yet.' : undefined}>
                      <td style={{ textAlign: 'left', padding: '3px 0' }}>
                        {w.week}{tooYoung ? ' ·  in flight' : ''}
                      </td>
                      <td>{w.sent}</td>
                      <td>{w.replied}</td>
                      <td>{w.screened}</td>
                      <td style={{ color: tooYoung ? 'var(--text-mute)' : w.replyPct >= 3.6 ? 'var(--green)' : 'var(--orange)' }}>
                        {tooYoung ? '—' : `${w.replyPct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
