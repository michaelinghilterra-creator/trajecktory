// Referrals Module — the warm channel.
// People in the user's OWN network who can introduce them or flag an application
// internally. Referred candidates clear the recruiter screen far more often than
// cold applicants, so this is the single highest-leverage, entirely-warm channel.
//
// Deliberately lighter than the Recruiters CRM: a tracker table plus reconnect /
// ask templates the user personalizes and sends themselves. No LLM, no per-person
// correspondence log. Data lives in data/referrals.md via /api/referrals.
//
// This file is TRACKED (ships in the repo + installer payload), so the templates
// below use generic placeholders only — never a real name, company, or metric.
// The user fills those in per person, which is the point.
(function () {
const { useState, useEffect, useMemo, useCallback } = React;

const REF_STATUS_COLORS = {
  'Not Asked': 'var(--text-mute)',
  'Catching Up': '#38bdf8',
  'Asked': '#a78bfa',
  'Intro Made': '#f59e0b',
  'Applied w/ Referral': '#22c55e',
  'No': 'var(--text-mute)',
  'Dormant': 'var(--text-mute)',
};

function refLocalToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function RefCopyBtn({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = () => {
    try { navigator.clipboard.writeText(text); } catch (_) {}
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return <button className="btn ghost sm" onClick={copy}>{done ? 'Copied ✓' : (label || 'Copy')}</button>;
}

// Reconnect + ask templates. Generic by design (see file header).
const REF_TEMPLATES = [
  {
    id: 'reconnect',
    title: 'Template 1 — reconnect, no ask yet',
    hint: 'Use first for anyone you have lost touch with. It opens the door; the ask comes after they reply.',
    body: `Subject: Long overdue hello

Hi [First],

It has been too long. I have been heads-down building out [your focus / what you are working on], and I am exploring the next chapter now.

No agenda on this one, I would just genuinely like to catch up and hear what you are working on. Are you around for a quick call in the next week or two?

[Your name]`,
  },
  {
    id: 'ask',
    title: 'Template 2 — the referral ask',
    hint: 'Use once you are back in touch, or for someone you are already close with. Make it specific and easy to say yes to.',
    body: `Hi [First],

Good catching up. Quick, easy-to-decline ask: I am targeting [your target roles], and I noticed [Company] has [a relevant opening / a team you would know well]. If you think it is a fit and you are comfortable, would you be open to a quick intro to [name, or "whoever runs the team"], or to flagging my application internally?

Happy to send a short blurb and my resume to make it a two-minute forward for you. And if the timing or fit is not right, no problem at all.

Thanks either way,
[Your name]`,
  },
  {
    id: 'blurb',
    title: 'Blurb to attach',
    hint: 'A two-line summary they can forward. Fill in from your own CV — no invented numbers.',
    body: `[Your headline identity, e.g. "Revenue Operations and analytics leader."] [One or two quantified proof points taken verbatim from your CV.] Targeting [target titles], [location or remote]. Resume attached.`,
  },
];

// ─── The tab ────────────────────────────────────────────────────────────────
window.ReferralsTab = function ReferralsTab({ search } = {}) {
  const [rows, setRows] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', how: '', where: '', target: '', notes: '' });
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const toast = window.tjkToast || (() => {});

  const load = useCallback(() => {
    fetch('/api/referrals')
      .then(r => r.json())
      .then(d => { setRows(d.referrals || []); setStatuses(d.statuses || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      [r.name, r.how, r.where, r.target, r.notes].some(v => (v || '').toLowerCase().includes(q))
    );
  }, [rows, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    notAsked: rows.filter(r => r.status === 'Not Asked').length,
    asked: rows.filter(r => ['Asked', 'Catching Up'].includes(r.status)).length,
    intros: rows.filter(r => r.status === 'Intro Made').length,
    applied: rows.filter(r => r.status === 'Applied w/ Referral').length,
  }), [rows]);

  const patch = (id, updates) => {
    // optimistic
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
    window.tjkMutate(`/api/referrals/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates),
    }).then(r => { if (!r.ok) { toast('Save failed', 'error'); load(); } })
      .catch(() => { toast('Save failed', 'error'); load(); });
  };

  const add = () => {
    if (!form.name.trim()) { toast('A name is required.', 'warn'); return; }
    window.tjkMutate('/api/referrals', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    }).then(r => r.json()).then(() => {
      setForm({ name: '', how: '', where: '', target: '', notes: '' });
      setAdding(false); load();
      toast('Added to your referral tracker', 'success');
    }).catch(() => toast('Could not add', 'error'));
  };

  const remove = (row) => {
    if (!window.confirm(`Remove ${row.name || 'this person'} from your referral tracker?`)) return;
    setRows(prev => prev.filter(r => r.id !== row.id));
    window.tjkMutate(`/api/referrals/${row.id}`, { method: 'DELETE' })
      .then(r => { if (!r.ok) { toast('Delete failed', 'error'); load(); } })
      .catch(() => { toast('Delete failed', 'error'); load(); });
  };

  const logToday = (row) => {
    const updates = { lastTouch: refLocalToday() };
    // A first touch on a "Not Asked" row is a reconnect: nudge it to Catching Up.
    if (row.status === 'Not Asked') updates.status = 'Catching Up';
    patch(row.id, updates);
  };

  if (loading) return <div className="no-data" style={{ padding: 24 }}>Loading referrals…</div>;

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* Header */}
      <div className="card padded-lg">
        <div className="card-head">
          <div>
            <div className="card-title">Referrals</div>
            <div className="card-meta mono" style={{ marginTop: 4, maxWidth: 640 }}>
              Your warmest channel. Referred candidates clear the recruiter screen far more often than cold applicants, and one warm intro is worth roughly forty cold applications. Add people from your network, reconnect first, then ask who they know.
            </div>
          </div>
          <button className="btn primary sm" onClick={() => setAdding(a => !a)}>
            {adding ? 'Cancel' : '+ Add person'}
          </button>
        </div>

        {/* Stats strip */}
        <div className="row" style={{ gap: 20, marginTop: 14, flexWrap: 'wrap' }}>
          <RefStat n={stats.total} label="People" />
          <RefStat n={stats.notAsked} label="Not asked" />
          <RefStat n={stats.asked} label="In conversation" />
          <RefStat n={stats.intros} label="Intros made" />
          <RefStat n={stats.applied} label="Applied w/ referral" accent="#22c55e" />
        </div>
      </div>

      {/* Add form */}
      {adding && (
        <div className="card padded-lg col" style={{ gap: 10 }}>
          <div className="card-title" style={{ fontSize: 13 }}>Add someone to your network list</div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="inp" placeholder="Name *" value={form.name} style={{ minWidth: 160 }}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && add()} />
            <input className="inp" placeholder="How you know them (e.g. Acme Corp, 2015-2019)" value={form.how} style={{ minWidth: 220, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, how: e.target.value }))} />
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="inp" placeholder="Where they are now (their reach)" value={form.where} style={{ minWidth: 220, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, where: e.target.value }))} />
            <input className="inp" placeholder="Target company or role you want in" value={form.target} style={{ minWidth: 220, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, target: e.target.value }))} />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <input className="inp" placeholder="Notes" value={form.notes} style={{ flex: 1 }}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} onKeyDown={e => e.key === 'Enter' && add()} />
            <button className="btn primary sm" onClick={add}>Add</button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="no-data" style={{ padding: 28, textAlign: 'center' }}>
            {rows.length === 0
              ? 'No one added yet. Start with former colleagues, your alumni network, and anyone from a past role now at a company you are targeting.'
              : 'No matches for your search.'}
          </div>
        ) : (
          <table className="ref-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 11 }}>
                <th style={refTh}>Name</th>
                <th style={refTh}>How you know them</th>
                <th style={refTh}>Where now / reach</th>
                <th style={refTh}>Target</th>
                <th style={refTh}>Status</th>
                <th style={refTh}>Last touch</th>
                <th style={refTh}>Notes</th>
                <th style={refTh}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={refTd}>
                    <input className="ref-cell" defaultValue={row.name} placeholder="—"
                      onBlur={e => e.target.value !== row.name && patch(row.id, { name: e.target.value })} />
                  </td>
                  <td style={refTd}>
                    <input className="ref-cell" defaultValue={row.how} placeholder="—"
                      onBlur={e => e.target.value !== row.how && patch(row.id, { how: e.target.value })} />
                  </td>
                  <td style={refTd}>
                    <input className="ref-cell" defaultValue={row.where} placeholder="—"
                      onBlur={e => e.target.value !== row.where && patch(row.id, { where: e.target.value })} />
                  </td>
                  <td style={refTd}>
                    <input className="ref-cell" defaultValue={row.target} placeholder="—"
                      onBlur={e => e.target.value !== row.target && patch(row.id, { target: e.target.value })} />
                  </td>
                  <td style={refTd}>
                    <select className="sel" value={row.status}
                      style={{ color: REF_STATUS_COLORS[row.status] || 'var(--text)', fontWeight: 600 }}
                      onChange={e => patch(row.id, { status: e.target.value })}>
                      {statuses.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={refTd}>
                    <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                      <span className="mono dim" style={{ fontSize: 11, minWidth: 68 }}>{row.lastTouch || '—'}</span>
                      <button className="btn ghost sm" title="Log a touch today" onClick={() => logToday(row)}>Today</button>
                    </div>
                  </td>
                  <td style={refTd}>
                    <input className="ref-cell" defaultValue={row.notes} placeholder="—"
                      onBlur={e => e.target.value !== row.notes && patch(row.id, { notes: e.target.value })} />
                  </td>
                  <td style={refTd}>
                    <button className="btn ghost sm" title="Remove" onClick={() => remove(row)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Templates */}
      <div className="card padded-lg">
        <div className="card-head" style={{ cursor: 'pointer' }} onClick={() => setTemplatesOpen(o => !o)}>
          <div className="card-title">Reconnect &amp; ask templates</div>
          <button className="btn ghost sm">{templatesOpen ? 'Hide' : 'Show'}</button>
        </div>
        {templatesOpen && (
          <div className="col" style={{ gap: 16, marginTop: 12 }}>
            {REF_TEMPLATES.map(t => (
              <div key={t.id} className="col" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <div className="mono" style={{ fontWeight: 600, fontSize: 12 }}>{t.title}</div>
                  <RefCopyBtn text={t.body} />
                </div>
                <div className="dim mono" style={{ fontSize: 11 }}>{t.hint}</div>
                <pre className="ai-out" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--panel-2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)', margin: 0 }}>{t.body}</pre>
              </div>
            ))}
            <div className="dim mono" style={{ fontSize: 11 }}>
              A referral ask still counts as a warm touch. Log it in your weekly review's verified-touch count. Real names, real relationships, no invented numbers.
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const refTh = { padding: '8px 10px', fontWeight: 600, whiteSpace: 'nowrap' };
const refTd = { padding: '4px 10px', verticalAlign: 'middle' };

function RefStat({ n, label, accent }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--text)' }}>{n}</div>
      <div className="dim mono" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}

})();
