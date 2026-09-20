// E-1: the scheduling prompt. Fires whenever a role is moved into an interview stage (from app.jsx's
// handleAction or Pipeline's own advance), which set window.tjkScheduleInterview(app, stage) once mounted here.
// Asks for the date and time (required), who runs it, and the channel; resolves with that object, or null if
// the person backs out, so the status change never happens on its own. Standalone + window-attached, same
// pattern as DebriefModal.
const { useState: useStateSch } = React;

const CHANNEL_OPTIONS = ['Phone', 'Video', 'Onsite'];
const ORGANIZER_OPTIONS = [
  { value: 'recruiter_ta', label: 'Recruiter / TA' },
  { value: 'hiring_manager_panel', label: 'Hiring manager / panel' },
];

window.ScheduleModal = function ScheduleModal({ prompt, onClose }) {
  const [f, setF] = useStateSch({ date: '', time: '', organizerName: '', organizerType: 'recruiter_ta', channel: 'Phone' });
  if (!prompt) return null;
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const ready = f.date && f.time && f.organizerName.trim();

  const save = () => { if (ready) onClose({ ...f, organizerName: f.organizerName.trim() }); };

  return (
    <div onClick={() => onClose(null)}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" onClick={e => e.stopPropagation()} style={{ width: 'min(440px, 92vw)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Schedule: {prompt.stage}</h3>
          <span className="dim mono" style={{ fontSize: 12 }}>{prompt.app && prompt.app.company}</span>
        </div>
        <p className="dim" style={{ fontSize: 12, marginTop: 2, marginBottom: 12 }}>
          The status becomes {prompt.stage} now. This is not counted as held until you confirm it happened.
        </p>
        <div className="row" style={{ gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Date</label>
            <input type="date" value={f.date} onChange={e => set('date', e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 12, fontWeight: 600 }}>Time</label>
            <input type="time" value={f.time} onChange={e => set('time', e.target.value)}
              style={{ width: '100%', marginTop: 4, padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Who runs it</label>
          <input value={f.organizerName} onChange={e => set('organizerName', e.target.value)} placeholder="Name"
            style={{ width: '100%', marginTop: 4, marginBottom: 6, padding: '6px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box' }} />
          <div className="row" style={{ gap: 12 }}>
            {ORGANIZER_OPTIONS.map(o => (
              <label key={o.value} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input type="radio" name="organizerType" checked={f.organizerType === o.value} onChange={() => set('organizerType', o.value)} />
                {o.label}
              </label>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600 }}>Channel</label>
          <div className="row" style={{ gap: 10, marginTop: 4 }}>
            {CHANNEL_OPTIONS.map(c => (
              <label key={c} style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                <input type="radio" name="channel" checked={f.channel === c} onChange={() => set('channel', c)} />
                {c}
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn ghost" onClick={() => onClose(null)}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={!ready}>Save</button>
        </div>
      </div>
    </div>
  );
};
