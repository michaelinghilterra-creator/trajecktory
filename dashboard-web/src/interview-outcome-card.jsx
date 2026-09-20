// E-2: what happened to a scheduled interview. Polls GET /api/interviews/pending-outcome and asks "did it
// happen?" for every round whose slot has been over for 30 minutes (D-2), and keeps asking whenever the app is
// next opened (the server never stops flagging one due until it is answered). Held opens the debrief via
// window.tjkOpenDebrief, which app.jsx wires to the same DebriefModal every other Held path uses. Standalone +
// window-attached; mounted once in the Today tab, the place a person naturally checks daily.
const { useState: useStateOc, useEffect: useEffectOc } = React;

const OUTCOME_BUTTONS = [
  { id: 'held', label: 'Held' },
  { id: 'rescheduled', label: 'Rescheduled' },
  { id: 'cancelled_by_employer', label: 'Cancelled by employer' },
  { id: 'withdrew', label: 'Withdrew' },
  { id: 'no_show', label: 'No-show' },
  { id: 'dropped', label: 'Call dropped' },
];
const RESULT_OPTIONS = [
  { value: 'advanced', label: 'Advanced' },
  { value: 'not_advancing', label: 'Not advancing' },
  { value: 'pending', label: 'Pending' },
];
const POLL_MS = 5 * 60 * 1000;
const todayYmd = () => new Date().toLocaleDateString('en-CA');

function OutcomeItem({ item, onDone }) {
  const [open, setOpen] = useStateOc(null); // 'held' | 'rescheduled' | null
  const [busy, setBusy] = useStateOc(false);
  const [heldOn, setHeldOn] = useStateOc(todayYmd());
  const [result, setResult] = useStateOc('advanced');
  const [newDate, setNewDate] = useStateOc('');
  const [newTime, setNewTime] = useStateOc('');

  const post = (body) => {
    setBusy(true);
    window.tjkMutate('/api/interviews/outcome', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: item.appId, stage: item.stage, ...body }),
    }).then(async r => {
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || 'Could not save that.');
      if (res.debrief && window.tjkOpenDebrief) {
        window.tjkOpenDebrief({ appId: item.appId, company: item.company, role: item.role, stage: item.stage });
      }
      window.tjkToast && window.tjkToast(`${item.company}: ${item.stage} ${body.outcome.replace(/_/g, ' ')}`, 'success');
      onDone();
    }).catch(e => { window.tjkToast && window.tjkToast(e.message, 'error'); setBusy(false); });
  };

  const click = (outcome) => {
    if (outcome === 'held') { setOpen('held'); return; }
    if (outcome === 'rescheduled') { setOpen('rescheduled'); return; }
    if (!window.confirm(`Mark ${item.company} · ${item.stage} as ${outcome.replace(/_/g, ' ')}?`)) return;
    post({ outcome });
  };

  return (
    <div style={{ padding: '6px 2px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span>{item.company}{item.role ? <span className="dim"> · {item.role}</span> : null} <span className="dim mono">· {item.stage}</span></span>
        <span className="dim mono" style={{ fontSize: 11 }}>{item.due ? 'due now' : `scheduled ${item.scheduledFor}`}</span>
      </div>
      {open === 'held' ? (
        <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={heldOn} max={todayYmd()} onChange={e => setHeldOn(e.target.value)}
            style={{ fontSize: 12, padding: '3px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)' }} />
          <select value={result} onChange={e => setResult(e.target.value)}
            style={{ fontSize: 12, padding: '3px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)' }}>
            {RESULT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button className="btn sm" disabled={busy || !heldOn} onClick={() => post({ outcome: 'held', heldOn, result })}>Save</button>
          <button className="btn ghost sm" onClick={() => setOpen(null)}>Cancel</button>
        </div>
      ) : open === 'rescheduled' ? (
        <div className="row" style={{ gap: 8, marginTop: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)}
            style={{ fontSize: 12, padding: '3px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)' }} />
          <input type="time" value={newTime} onChange={e => setNewTime(e.target.value)}
            style={{ fontSize: 12, padding: '3px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)' }} />
          <button className="btn sm" disabled={busy || !newDate || !newTime} onClick={() => post({ outcome: 'rescheduled', newDate, newTime })}>Save</button>
          <button className="btn ghost sm" onClick={() => setOpen(null)}>Cancel</button>
        </div>
      ) : (
        <div className="row" style={{ gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
          {OUTCOME_BUTTONS.map(b => (
            <button key={b.id} className="btn ghost sm" disabled={busy} onClick={() => click(b.id)}>{b.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

window.InterviewOutcomeCard = function InterviewOutcomeCard() {
  const [data, setData] = useStateOc(null);
  const load = () => fetch('/api/interviews/pending-outcome').then(r => r.json()).then(setData).catch(() => {});
  useEffectOc(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    return () => clearInterval(timer);
  }, []);
  if (!data || !data.enabled || data.items.length === 0) return null;
  const due = data.items.filter(it => it.due);
  const upcoming = data.items.filter(it => !it.due);
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>🗓 Did it happen?</div>
        <span className="dim mono" style={{ fontSize: 10.5 }}>{due.length} to answer{upcoming.length ? `, ${upcoming.length} upcoming` : ''}</span>
      </div>
      {due.length === 0
        ? <div className="dim" style={{ fontSize: 12 }}>Nothing to answer yet. Asked once a slot has been over for 30 minutes.</div>
        : due.map(it => <OutcomeItem key={`${it.appId}|${it.stage}`} item={it} onDone={load} />)}
      {upcoming.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary className="dim" style={{ fontSize: 11.5, cursor: 'pointer' }}>{upcoming.length} still upcoming</summary>
          {upcoming.map(it => <OutcomeItem key={`${it.appId}|${it.stage}`} item={it} onDone={load} />)}
        </details>
      )}
    </div>
  );
};
