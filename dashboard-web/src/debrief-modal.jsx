// Debrief modal — the screen-wall instrumentation. Fires when a round concludes
// (any transition OUT of an interview stage) so the objection is captured in the
// moment instead of reconstructed weeks later, and is reachable from the
// "debriefs due" list for rounds that slipped by. Writes a structured note via
// POST /api/interview/debriefs/:id. Skipping is fine: the round stays on the
// pending list until captured. Standalone + window-attached so any tab can open it.
const { useState: useStateDb } = React;

const DEBRIEF_FIELDS = [
  { key: 'outcome',   label: 'Outcome',                     placeholder: 'advanced / rejected / pending, and how it felt in one line', rows: 2 },
  { key: 'objection', label: 'The objection (most important)', placeholder: 'Their answer to: is there anything in my background that gives you pause? Verbatim if you can. If nothing was raised, say so.', rows: 3, emphasize: true },
  { key: 'landed',    label: 'What landed',                 placeholder: 'The stories or points that clearly connected', rows: 2 },
  { key: 'change',    label: 'What I would change',         placeholder: 'Anything that fell flat, ran long, or that I fumbled', rows: 2 },
  { key: 'intel',     label: 'Intel captured',             placeholder: 'Facts about the seat, team, process, or people to reuse next round', rows: 2 },
  { key: 'next',      label: 'Next steps',                  placeholder: 'Who follows up with whom, and by when', rows: 1 },
];

window.DebriefModal = function DebriefModal({ prompt, onClose, toast }) {
  const [f, setF] = useStateDb({});
  const [saving, setSaving] = useStateDb(false);
  if (!prompt) return null;
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));

  const save = () => {
    setSaving(true);
    fetch(`/api/interview/debriefs/${prompt.appId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: prompt.stage, fields: f }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setSaving(false); }
        else { toast && toast('Debrief saved', 'success'); onClose(true); }
      })
      .catch(e => { toast && toast(e.message, 'error'); setSaving(false); });
  };

  return (
    <div onClick={() => onClose(false)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" onClick={e => e.stopPropagation()} style={{ width: 'min(560px, 92vw)', maxHeight: '88vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Debrief: {prompt.stage}</h3>
          <span className="dim mono" style={{ fontSize: 12 }}>{prompt.company}</span>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 2, marginBottom: 12 }}>
          Capture it while it is fresh. The objection is the whole point. Skip if you must; it stays on the pending list.
        </p>
        {DEBRIEF_FIELDS.map(fl => (
          <div key={fl.key} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: fl.emphasize ? 'var(--accent)' : 'var(--text)' }}>{fl.label}</label>
            <textarea value={f[fl.key] || ''} onChange={e => set(fl.key, e.target.value)} placeholder={fl.placeholder} rows={fl.rows}
              style={{ width: '100%', marginTop: 4, padding: '7px 9px', background: 'var(--panel-2)', border: `1px solid ${fl.emphasize ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 6, color: 'var(--text)', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }} />
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
          <button className="btn ghost" onClick={() => onClose(false)}>Skip for now</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save debrief'}</button>
        </div>
      </div>
    </div>
  );
};
