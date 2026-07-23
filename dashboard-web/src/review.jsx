// Review tab — the weekly tracking view. The three floors with teeth, the
// leading indicators, the build-lock state, and a one-field LinkedIn-connect
// logger. Reads the same numbers weekly-review.mjs reviews (GET
// /api/metrics/weekly and /api/review/status), so the screen and the CLI can
// never disagree. A blank source shows "not logged", never a fake zero.
const { useState: useStateRv, useEffect: useEffectRv, useCallback: useCallbackRv } = React;

function floorTone(r) {
  if (!r.available) return { color: 'var(--text-mute)', label: 'not logged' };
  return r.met
    ? { color: 'var(--green)', label: 'on track' }
    : { color: 'var(--red)', label: 'below floor' };
}

function ReviewFloor({ r }) {
  const t = floorTone(r);
  return (
    <div className="kpi">
      <span className="kpi-label">{r.label}</span>
      <span className="kpi-value" style={{ color: t.color }}>{r.available ? `${r.value}${r.unit || ''}` : '—'}</span>
      <span className="dim mono" style={{ fontSize: 11 }}>
        floor {r.floor}{r.unit || ''} · <span style={{ color: t.color }}>{t.label}</span>
      </span>
    </div>
  );
}

function ReviewIndicator({ label, m }) {
  const avail = m && m.available;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: avail ? 'var(--text)' : 'var(--text-mute)' }}>
        {avail ? m.value : 'not logged'}
      </span>
    </div>
  );
}

window.ReviewTab = function ReviewTab({ toast }) {
  const [data, setData] = useStateRv(null);
  const [status, setStatus] = useStateRv(null);
  const [err, setErr] = useStateRv(null);
  const [name, setName] = useStateRv('');

  const load = useCallbackRv(() => {
    fetch('/api/metrics/weekly').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setData(d); })
      .catch(e => setErr(e.message));
    fetch('/api/review/status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);
  useEffectRv(() => { load(); }, [load]);

  const logConnect = () => {
    fetch('/api/linkedin/connects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source: 'manual' }),
    }).then(r => r.json())
      .then(res => { setName(''); toast && toast(`Connect logged (${res.total} this campaign)`, 'success'); load(); })
      .catch(e => toast && toast(e.message, 'error'));
  };

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the weekly review: {err}</div>;
  if (!data) return <div className="dim" style={{ padding: 28 }}>Loading weekly review…</div>;

  const m = data.metrics || {};
  const floors = (data.floors && data.floors.results) || [];
  const locked = status && status.lock && status.lock.locked;

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
        <h2 style={{ margin: 0 }}>Weekly review</h2>
        <span className="dim mono" style={{ fontSize: 12 }}>{data.weekStart} → {data.weekEnd}</span>
      </div>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        Leading indicators, not applications. A blank source reads "not logged", never zero.
      </p>

      {locked ? (
        <div className="card" style={{ borderLeft: '3px solid var(--red)', marginBottom: 18 }}>
          <strong style={{ color: 'var(--red)' }}>Build lock engaged.</strong>{' '}
          <span className="dim">{status.lock.reason}</span>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            Improvement work is locked. Break-fix, data integrity, live-process work, and sub-30-minute unblocks stay allowed.
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 24 }}>
        {floors.map(r => <ReviewFloor key={r.key} r={r} />)}
      </div>

      <h3 style={{ margin: '0 0 4px' }}>Leading indicators</h3>
      <div className="card" style={{ padding: '4px 16px', marginBottom: 24 }}>
        <ReviewIndicator label="Replies on delivered mail" m={m.replies} />
        <ReviewIndicator label="Delivered reply rate % (cumulative)" m={m.deliveredReplyRatePct} />
        <ReviewIndicator label="Screens booked" m={m.screensBooked} />
        <ReviewIndicator label="Screen objections logged" m={m.objectionsLogged} />
        <ReviewIndicator label="Unserviced applications (WIP)" m={m.unservicedApplications} />
      </div>

      <h3 style={{ margin: '0 0 4px' }}>Log a LinkedIn connect</h3>
      <p className="dim" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
        Connections are sent by hand. Log each one so the weekly floor is real, not a guess.
      </p>
      <div style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name or note (optional)"
          onKeyDown={e => { if (e.key === 'Enter') logConnect(); }}
          style={{ flex: 1, padding: '7px 10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }} />
        <button className="btn primary" onClick={logConnect}>+ Log connect</button>
      </div>
    </div>
  );
};
