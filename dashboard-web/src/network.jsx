// Contacts Module — the consolidated home for every 1:1 contact.
// Referrals, TA Outreach, and Recruiters are the same interaction model (a contact
// list + a status ladder + a detail drawer), so they live under one parent. The
// default "All contacts" subtab is a single unified table across all three books
// (type = Referral / TA / Recruiter), with per-type drawers; the three original
// subtabs are kept as secondary views so each book's own tools survive (recruiter
// analytics/activity, referral LinkedIn-import + warm-intro templates, reconcile).
(function () {
const { useState, useEffect, useMemo } = React;

const NET_SUBTABS = [
  { id: 'all',        label: 'All contacts' },
  { id: 'referrals',  label: 'Referrals' },
  { id: 'ta',         label: 'TA Outreach' },
  { id: 'recruiters', label: 'Recruiters' },
];

// Per-type visual identity for the badge/avatar in the unified table.
const TYPE_META = {
  referral:  { label: 'Referral',  color: '#22c55e', rgb: '34,197,94' },
  ta:        { label: 'TA',         color: '#22d3ee', rgb: '34,211,238' },
  recruiter: { label: 'Recruiter',  color: '#a78bfa', rgb: '167,139,250' },
};

function uInitials(name) {
  const p = String(name || '').replace(/['"]/g, '').split(/\s+/).filter(Boolean);
  if (!p.length) return '?';
  return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}
function uToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Unified "All contacts" table ──────────────────────────────────────────────
function AllContactsView({ search }) {
  const [ta, setTa] = useState(null);
  const [rec, setRec] = useState(null);
  const [ref, setRef] = useState(null);
  const [refStatuses, setRefStatuses] = useState([]);
  const [typeFilter, setTypeFilter] = useState('all');
  const [hvOnly, setHvOnly] = useState(false);
  const [drawer, setDrawer] = useState(null);       // { type, id }
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');

  const loadTa = () => fetch('/api/target-talent').then(r => r.json()).then(d => setTa(Array.isArray(d) ? d : [])).catch(() => setTa([]));
  const loadRec = () => fetch('/api/recruiters').then(r => r.json()).then(d => setRec(Array.isArray(d) ? d : [])).catch(() => setRec([]));
  const loadRef = () => fetch('/api/referrals').then(r => r.json()).then(d => { setRef(d.referrals || []); setRefStatuses(d.statuses || []); }).catch(() => setRef([]));
  useEffect(() => { loadTa(); loadRec(); loadRef(); }, []);

  const rows = useMemo(() => {
    const out = [];
    for (const c of (ta || [])) {
      if (c.status === 'Archived') continue;
      out.push({ type: 'ta', id: c.id, name: `${c.first || ''} ${c.last || ''}`.trim(), role: c.title || '', org: c.company || '', status: c.status || '', hv: !!c.isHighValue, lastTouch: c.lastTouch || '' });
    }
    for (const c of (rec || [])) {
      out.push({ type: 'recruiter', id: c.id, name: `${c.first || ''} ${c.last || ''}`.trim(), role: c.title || '', org: c.firm || '', status: c.status || '', hv: !!c.isHighValue, lastTouch: c.lastTouch || '' });
    }
    for (const c of (ref || [])) {
      out.push({ type: 'referral', id: c.id, name: c.name || '', role: c.how || '', org: c.where || '', status: c.status || '', hv: false, lastTouch: c.lastTouch || '' });
    }
    return out;
  }, [ta, rec, ref]);

  const filtered = useMemo(() => {
    let r = rows;
    if (typeFilter !== 'all') r = r.filter(x => x.type === typeFilter);
    if (hvOnly) r = r.filter(x => x.hv);
    const q = (search || '').trim().toLowerCase();
    if (q) r = r.filter(x => `${x.name} ${x.org} ${x.role} ${x.status}`.toLowerCase().includes(q));
    const dir = sortDir === 'asc' ? 1 : -1;
    const val = x => sortKey === 'last' ? (x.lastTouch || '')
      : sortKey === 'org' ? (x.org || '').toLowerCase()
      : sortKey === 'type' ? x.type
      : sortKey === 'status' ? (x.status || '').toLowerCase()
      : sortKey === 'role' ? (x.role || '').toLowerCase()
      : (x.name || '').toLowerCase();
    return [...r].sort((a, b) => { const av = val(a), bv = val(b); if (av < bv) return -dir; if (av > bv) return dir; return (a.name || '').localeCompare(b.name || ''); });
  }, [rows, typeFilter, hvOnly, search, sortKey, sortDir]);

  const counts = useMemo(() => ({
    all: rows.length,
    referral: rows.filter(x => x.type === 'referral').length,
    ta: rows.filter(x => x.type === 'ta').length,
    recruiter: rows.filter(x => x.type === 'recruiter').length,
  }), [rows]);
  const hvCount = useMemo(() => rows.filter(x => x.hv).length, [rows]);

  // Referral drawer handlers (referrals have no single-GET endpoint, so the drawer
  // gets the live row from `ref` state and edits go through the same PATCH/DELETE).
  const patchRef = (id, updates) => {
    setRef(prev => (prev || []).map(r => r.id === id ? { ...r, ...updates } : r));
    window.tjkMutate(`/api/referrals/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }).then(() => loadRef()).catch(() => loadRef());
  };
  const logTodayRef = (row) => { const u = { lastTouch: uToday() }; if (row.status === 'Not Asked') u.status = 'Catching Up'; patchRef(row.id, u); };
  const removeRef = (row) => {
    if (!window.confirm(`Remove ${row.name || 'this person'} from your referral tracker?`)) return;
    window.tjkMutate(`/api/referrals/${row.id}`, { method: 'DELETE' }).then(() => { loadRef(); setDrawer(null); }).catch(() => loadRef());
  };
  const [findingRefId, setFindingRefId] = useState(null);
  const findEmailRef = (row) => {
    setFindingRefId(row.id);
    window.tjkMutate('/api/referrals/find-emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [row.id] }) })
      .then(r => r.json()).then(d => {
        setFindingRefId(null);
        const res = d.ok && (d.results || [])[0];
        if (res && res.email) window.tjkToast && window.tjkToast(`Found ${res.email} · ${res.state}`, 'success');
        else if (d.ok) window.tjkToast && window.tjkToast('No verified email found', 'warn');
        else window.tjkToast && window.tjkToast(d.error || 'Lookup failed', 'error');
        loadRef();
      }).catch(() => { setFindingRefId(null); window.tjkToast && window.tjkToast('Lookup failed', 'error'); });
  };

  const setSort = k => { if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortKey(k); setSortDir(k === 'last' ? 'desc' : 'asc'); } };

  if (ta === null || rec === null || ref === null) return <div className="dim" style={{ padding: 28 }}>Loading contacts…</div>;

  const cols = [
    { k: 'name',   label: 'Name',            w: 220 },
    { k: 'type',   label: 'Type',            w: 110 },
    { k: 'role',   label: 'Role / how',      w: 200 },
    { k: 'org',    label: 'Company / reach', w: 190 },
    { k: 'status', label: 'Status',          w: 150 },
    { k: 'last',   label: 'Last touch',      w: 110 },
  ];
  const CHIPS = [
    { id: 'all', label: 'All' },
    { id: 'referral', label: 'Referrals' },
    { id: 'ta', label: 'TA' },
    { id: 'recruiter', label: 'Recruiters' },
  ];
  const drawerRow = drawer && drawer.type === 'referral' ? (ref || []).find(r => r.id === drawer.id) : null;

  return (
    <div className="fade-up" style={{ padding: '6px 0' }}>
      <div className="ta-head">
        <div>
          <h1>All contacts</h1>
          <div className="sub">{filtered.length} of {rows.length} across referrals, TA, and recruiters &middot; click a row for the full card</div>
        </div>
      </div>

      <div className="card padded-lg">
        <div className="ta-filters" style={{ marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          {CHIPS.map(ch => {
            const on = typeFilter === ch.id;
            return (
              <span key={ch.id} onClick={() => setTypeFilter(ch.id)} style={{
                cursor: 'pointer', padding: '4px 11px', borderRadius: 5, fontSize: 11.5, fontWeight: 600,
                background: on ? 'var(--accent)' : 'var(--panel-2)', color: on ? '#15101f' : 'var(--text-dim)',
                border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
              }}>{ch.label} <span style={{ opacity: 0.7, marginLeft: 2 }}>{counts[ch.id]}</span></span>
            );
          })}
          <button className="btn ghost sm" onClick={() => setHvOnly(v => !v)}
            title="High value = reachable both ways (a verified email and a LinkedIn handle)."
            style={hvOnly ? { color: 'var(--yellow)', borderColor: 'var(--yellow)' } : undefined}>
            ★ High value <span className="mono" style={{ opacity: 0.7, marginLeft: 2 }}>{hvCount}</span>
          </button>
          {(typeFilter !== 'all' || hvOnly) && (
            <button className="btn ghost sm" onClick={() => { setTypeFilter('all'); setHvOnly(false); }}>Clear</button>
          )}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>{filtered.length} shown</span>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 320px)', border: 'none', borderRadius: 0, background: 'transparent' }}>
          <table className="tbl ssi-tbl">
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? 'sorted' : ''} role="button" tabIndex={0}
                    onClick={() => setSort(c.k)} onKeyDown={window.kbdActivate(() => setSort(c.k))}>
                    {c.label}<span className="sort-ind">{sortKey === c.k ? (sortDir === 'asc' ? '↑' : '↓') : '·'}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={cols.length}><div className="no-data" style={{ padding: 40, textAlign: 'center' }}>No contacts match these filters.</div></td></tr>
              )}
              {filtered.map(c => {
                const tm = TYPE_META[c.type];
                return (
                  <tr key={`${c.type}:${c.id}`} className={drawer && drawer.type === c.type && drawer.id === c.id ? 'selected' : ''}
                    tabIndex={0} onKeyDown={window.kbdActivate(() => setDrawer({ type: c.type, id: c.id }))} onClick={() => setDrawer({ type: c.type, id: c.id })}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                        <div className="mono-av sm" style={{ borderColor: tm.color, color: tm.color, flex: 'none' }}>{uInitials(c.name)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name || '(no name)'}</div>
                        {c.hv && <span title="High value: reachable both ways (verified email + LinkedIn)." style={{ flex: 'none', color: 'var(--yellow)', fontSize: 12 }}>★</span>}
                      </div>
                    </td>
                    <td>
                      <span className="status-badge" style={{ color: tm.color, borderColor: `rgba(${tm.rgb},0.42)`, background: `rgba(${tm.rgb},0.12)`, fontSize: 9.5, padding: '2px 7px' }}>{tm.label}</span>
                    </td>
                    <td title={c.role || ''}><span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.role || '-'}</span></td>
                    <td title={c.org || ''}><span style={{ fontWeight: 600, fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.org || '-'}</span></td>
                    <td><span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{c.status || '-'}</span></td>
                    <td><span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: c.lastTouch ? 'var(--text-dim)' : 'var(--text-mute)' }}>{c.lastTouch || '-'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-type drawers — reuse each book's existing detail drawer. */}
      {drawer && drawer.type === 'ta' && window.TargetTalentDrawer && (
        <window.TargetTalentDrawer id={drawer.id} onClose={() => setDrawer(null)} onUpdate={loadTa} />
      )}
      {drawer && drawer.type === 'recruiter' && window.RecruiterDrawer && (
        <window.RecruiterDrawer id={drawer.id} onClose={() => setDrawer(null)} onUpdate={loadRec} />
      )}
      {drawer && drawer.type === 'referral' && drawerRow && window.ReferralDrawer && (
        <window.ReferralDrawer row={drawerRow} statuses={refStatuses} onClose={() => setDrawer(null)}
          onPatch={patchRef} onLogToday={logTodayRef} onFindEmail={findEmailRef} finding={findingRefId === drawerRow.id}
          onChanged={loadRef} onRemove={removeRef} />
      )}
    </div>
  );
}

window.NetworkTab = function NetworkTab({ view, setView, search, pendingTaOpen, onTaOpenConsumed, pendingRecruiterOpen, onRecruiterOpenConsumed, openTaContact, openRecruiter, toast } = {}) {
  // Fall back to the unified All view for an unknown/stale saved view.
  const active = NET_SUBTABS.some(s => s.id === view) ? view : 'all';
  // "All contacts" is the primary landing view — one list of everyone, with a type
  // badge and a type filter, so you never have to guess a person's book or click
  // between tabs to find them. The three book tabs are demoted to secondary tools:
  // they only exist for each channel's own extras (recruiter analytics, referral
  // LinkedIn import / reconcile, TA sequences), not for finding a contact.
  const books = NET_SUBTABS.filter(s => s.id !== 'all');
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs" style={{ alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" className={'subtab' + (active === 'all' ? ' active' : '')} onClick={() => setView('all')}
          style={{ fontWeight: 600 }}>
          All contacts
        </button>
        <span style={{ flex: 'none', width: 1, height: 18, background: 'var(--border)', margin: '0 6px' }} />
        <span style={{ flex: 'none', fontSize: 10, fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--text-mute)' }} title="Each book's own tools live here — you don't need them to find a person.">Books</span>
        {books.map(s => (
          <button type="button" key={s.id} className={'subtab sm' + (active === s.id ? ' active' : '')} onClick={() => setView(s.id)}
            style={{ fontSize: 12, opacity: active === s.id ? 1 : 0.8 }}>
            {s.label}
          </button>
        ))}
      </div>
      {active === 'all' && (
        <div className="dim mono" style={{ fontSize: 10.5, padding: '2px 2px 8px' }}>
          Everyone across referrals, TA, and recruiters in one list. Filter by type, or open the Books above for a channel's own tools.
        </div>
      )}

      {active === 'all'        && <AllContactsView search={search} />}
      {active === 'referrals'  && window.ReferralsTab && <window.ReferralsTab search={search} />}
      {active === 'recruiters' && window.RecruitersTab && <window.RecruitersTab search={search} initialOpenId={pendingRecruiterOpen} onInitialOpenConsumed={onRecruiterOpenConsumed} />}
      {active === 'ta'         && window.TargetTalentTab && (
        <window.TargetTalentTab
          initialOpenId={pendingTaOpen}
          onInitialOpenConsumed={onTaOpenConsumed}
          search={search}
        />
      )}
    </div>
  );
};

})();
