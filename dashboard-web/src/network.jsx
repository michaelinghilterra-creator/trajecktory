// Network Module — the consolidated home for the three 1:1 contact channels.
// Referrals, Recruiters, and TA Outreach are the same interaction model (a
// contact list + a status ladder + AI-drafted messages), so they live under one
// parent instead of three sibling top-level tabs. Ordered by warmth: Referrals
// (your own network, highest-yield per the post-mortem) is first and the default.
//
// This is a thin shell — it renders a subtab bar and hands off to the existing
// ReferralsTab / RecruitersTab / TargetTalentTab components unchanged. Recruiters
// keeps its own internal subtabs, so on that subtab you'll see two rows of nav
// (section + module); that's the accepted cost of grouping.
(function () {

const NET_SUBTABS = [
  { id: 'referrals',  label: 'Referrals' },
  { id: 'ta',         label: 'TA Outreach' },
  { id: 'recruiters', label: 'Recruiters' },
  { id: 'highvalue',  label: 'High value' },
];

const { useState: useStateHv, useEffect: useEffectHv, useMemo: useMemoHv } = React;

// High value — the directory of dual-channel contacts (a verified email AND a
// LinkedIn handle), drawn from both the TA and recruiter books. These are the
// contacts worth a two-channel multithread. Read-only directory with its own
// search + source/status filters; the actual outreach happens in Follow-Ups →
// High value. Backed by GET /api/network/high-value.
function HighValueTab({ search }) {
  const [rows, setRows] = useStateHv(null);
  const [err, setErr] = useStateHv(null);
  const [q, setQ] = useStateHv('');
  const [sourceFilter, setSourceFilter] = useStateHv('');   // '' | 'ta' | 'recruiter'
  const [statusFilter, setStatusFilter] = useStateHv('');

  useEffectHv(() => {
    fetch('/api/network/high-value').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setRows(d.contacts || []); })
      .catch(e => setErr(e.message));
  }, []);

  const statuses = useMemoHv(() => {
    const s = new Set((rows || []).map(r => r.status).filter(Boolean));
    return [...s].sort();
  }, [rows]);

  const filtered = useMemoHv(() => {
    let r = rows || [];
    const term = `${q} ${search || ''}`.trim().toLowerCase();
    if (sourceFilter) r = r.filter(x => x.source === sourceFilter);
    if (statusFilter) r = r.filter(x => x.status === statusFilter);
    if (term) r = r.filter(x => `${x.name} ${x.company} ${x.title} ${x.email}`.toLowerCase().includes(term));
    return r;
  }, [rows, q, search, sourceFilter, statusFilter]);

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load high-value contacts: {err}</div>;
  if (!rows) return <div className="dim" style={{ padding: 28 }}>Loading high-value contacts…</div>;

  const hrefOf = (li) => li ? (/^https?:/.test(li) ? li : `https://${li}`) : null;
  const inputStyle = { fontSize: 13, padding: '6px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' };

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ margin: '0 0 2px' }}>High-value contacts</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 14 }}>
        {filtered.length} of {rows.length} contact{rows.length === 1 ? '' : 's'} reachable BOTH ways (a verified
        email and a LinkedIn handle), across your TA and recruiter books. Work them on both channels from
        Follow-Ups → High value.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, company, title, email…"
          style={{ ...inputStyle, flex: '1 1 260px', minWidth: 200 }} />
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value)} style={inputStyle}>
          <option value="">All sources</option>
          <option value="ta">TA</option>
          <option value="recruiter">Recruiters</option>
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inputStyle}>
          <option value="">All statuses</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="card dim">
          {rows.length === 0
            ? 'No dual-channel contacts yet. A contact appears here once it has both a verified email and a LinkedIn handle on file.'
            : 'No contacts match these filters.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '8px 10px' }}>Name</th>
                <th style={{ padding: '8px 10px' }}>Title</th>
                <th style={{ padding: '8px 10px' }}>Company</th>
                <th style={{ padding: '8px 10px' }}>Source</th>
                <th style={{ padding: '8px 10px' }}>Email</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}>Channels</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => {
                const href = hrefOf(c.linkedin);
                const mailto = c.email ? `mailto:${c.email}` : null;
                const loc = [c.city, c.state].filter(Boolean).join(', ');
                return (
                  <tr key={`${c.source}:${c.id}`} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{c.name || '(no name)'}{loc ? <div className="dim" style={{ fontWeight: 400, fontSize: 11 }}>{loc}</div> : null}</td>
                    <td style={{ padding: '8px 10px' }}>{c.title || '-'}</td>
                    <td style={{ padding: '8px 10px' }}>{c.company || '-'}</td>
                    <td style={{ padding: '8px 10px' }}><span className="mono dim">{c.source}</span></td>
                    <td style={{ padding: '8px 10px' }}>
                      {mailto ? <a href={mailto} className="mono" style={{ color: 'var(--accent)' }}>{c.email}</a> : '-'}
                      {c.emailState === 'risky' ? <span className="dim" title="Catch-all domain: usually deliverable."> · risky</span> : null}
                    </td>
                    <td style={{ padding: '8px 10px' }}>{c.status || '-'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                      <span title="Verified email on file" style={{ marginRight: 6 }}>✉</span>
                      {href ? <a href={href} target="_blank" rel="noreferrer" title="Open LinkedIn profile" style={{ color: 'var(--accent)' }}>in ↗</a> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

window.NetworkTab = function NetworkTab({ view, setView, search, pendingTaOpen, onTaOpenConsumed, toast } = {}) {
  const active = view || 'referrals';
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {NET_SUBTABS.map(s => (
          <button type="button" key={s.id} className={'subtab' + (active === s.id ? ' active' : '')} onClick={() => setView(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {active === 'referrals'  && window.ReferralsTab && <window.ReferralsTab search={search} />}
      {active === 'recruiters' && window.RecruitersTab && <window.RecruitersTab search={search} />}
      {active === 'ta'         && window.TargetTalentTab && (
        <window.TargetTalentTab
          initialOpenId={pendingTaOpen}
          onInitialOpenConsumed={onTaOpenConsumed}
          search={search}
        />
      )}
      {active === 'highvalue'  && <HighValueTab search={search} />}
    </div>
  );
};

})();
