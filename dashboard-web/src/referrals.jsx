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
const { useState, useEffect, useMemo, useCallback, useRef } = React;

// The Stage 1 / Stage 2 subtabs. Stage is derived server-side (a LinkedIn
// contact inside an active-pipeline company is Stage 1, any other LinkedIn
// contact is Stage 2, a manually-added person is "other") and returned per row,
// so these are pure filters. "All" also shows manually-added people.
const REF_SUBTABS = [
  { id: 'stage1', label: 'Stage 1', hint: 'Inside a company you are targeting — warm path into a live opening' },
  { id: 'stage2', label: 'Stage 2', hint: 'Warm referrers elsewhere in your network' },
  { id: 'all', label: 'All', hint: 'Everyone, including people you added by hand' },
];

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
    title: 'Template 1: reconnect, no ask yet',
    hint: 'Use first for anyone you have lost touch with. It opens the door; the ask comes after they reply.',
    body: `Subject: Long overdue hello

Hi [First],

It has been too long. I have been heads-down building out [your focus / what you are working on], and I am exploring the next chapter now.

No agenda on this one, I would just genuinely like to catch up and hear what you are working on. Are you around for a quick call in the next week or two?

[Your name]`,
  },
  {
    id: 'ask',
    title: 'Template 2: the referral ask',
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
    hint: 'A two-line summary they can forward. Fill in from your own CV. No invented numbers.',
    body: `[Your headline identity in one line, e.g. "Supply chain operations leader."] [One or two quantified proof points taken verbatim from your CV.] Targeting [target titles], [location or remote]. Resume attached.`,
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
  const [subtab, setSubtab] = useState('stage1');
  const [drawerId, setDrawerId] = useState(null);   // open contact drawer
  const [linkedin, setLinkedin] = useState({ count: 0, importedAt: null });
  const [reconciling, setReconciling] = useState(false);
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState(null);   // persistent import summary
  const [findingId, setFindingId] = useState(null);     // per-contact email find in flight
  const [findingBulk, setFindingBulk] = useState(false);
  const fileRef = useRef(null);
  const toast = window.tjkToast || (() => {});

  const load = useCallback(() => {
    fetch('/api/referrals')
      .then(r => r.json())
      .then(d => { setRows(d.referrals || []); setStatuses(d.statuses || []); setLinkedin(d.linkedin || { count: 0 }); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const stageCounts = useMemo(() => ({
    stage1: rows.filter(r => r.stage === 'stage1').length,
    stage2: rows.filter(r => r.stage === 'stage2').length,
    all: rows.length,
  }), [rows]);

  const filtered = useMemo(() => {
    const q = (search || '').trim().toLowerCase();
    let out = subtab === 'all' ? rows : rows.filter(r => r.stage === subtab);
    if (q) out = out.filter(r => [r.name, r.how, r.where, r.target, r.notes].some(v => (v || '').toLowerCase().includes(q)));
    return out;
  }, [rows, search, subtab]);

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

  // Re-scan the stored LinkedIn haystack against the current pipeline and pull in
  // new Stage-1 warm paths (companies you have sourced since the last run).
  const reconcileLinkedin = () => {
    setReconciling(true);
    window.tjkMutate('/api/referrals/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(r => r.json()).then(d => {
        setReconciling(false);
        if (d.ok) { toast(d.stage1Added ? `+${d.stage1Added} new Stage-1 warm path${d.stage1Added === 1 ? '' : 's'}` : 'Reconciled — no new matches', 'success'); load(); }
        else toast(d.error || 'Reconcile failed', 'error');
      }).catch(() => { setReconciling(false); toast('Reconcile failed', 'error'); });
  };

  // Upload a fresh LinkedIn Connections.csv: replaces the haystack, then seeds
  // Stage 1 + Stage 2. Read client-side as text and POSTed (no multipart needed).
  const importCsv = (file) => {
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = () => {
      window.tjkMutate('/api/referrals/import-linkedin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv: String(reader.result || '') }) })
        .then(r => r.json()).then(d => {
          setImporting(false);
          if (d.ok) { setLastImport({ ...d, at: new Date() }); toast(`Imported ${d.imported} connections · +${d.stage1Added} Stage 1, +${d.stage2Added} Stage 2`, 'success'); load(); }
          else toast(d.error || 'Import failed', 'error');
        }).catch(() => { setImporting(false); toast('Import failed', 'error'); });
    };
    reader.onerror = () => { setImporting(false); toast('Could not read file', 'error'); };
    reader.readAsText(file);
  };

  // Find + verify an email for ONE referral (Hunter Email Finder → MillionVerifier).
  // Writes only a verified address; a warm path with no email becomes reachable.
  const findEmailOne = (row) => {
    setFindingId(row.id);
    window.tjkMutate('/api/referrals/find-emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [row.id] }) })
      .then(r => r.json()).then(d => {
        setFindingId(null);
        if (!d.ok) { toast(d.error || 'Email lookup failed', 'error'); return; }
        const res = (d.results || [])[0];
        if (res && res.email) toast(`Found ${res.email} · ${res.state}`, 'success');
        else toast(res ? `No verified email (${res.state})` : 'No email found', 'warn');
        load();
      }).catch(() => { setFindingId(null); toast('Email lookup failed', 'error'); });
  };

  // Bulk find + verify for referrals missing an address, capped per run by the
  // Hunter credit budget so a big list can't drain the free tier in one click.
  const findEmailsBulk = () => {
    if (!window.confirm('Find + verify an email for every referral missing one? Runs the whole list in a single pass using your Hunter and MillionVerifier credits.')) return;
    setFindingBulk(true);
    window.tjkMutate('/api/referrals/find-emails', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      .then(r => r.json()).then(d => {
        setFindingBulk(false);
        if (!d.ok) { toast(d.error || 'Email lookup failed', 'error'); return; }
        toast(`Checked ${d.checked} · ${d.written} verified email${d.written === 1 ? '' : 's'}`, 'success');
        load();
      }).catch(() => { setFindingBulk(false); toast('Email lookup failed', 'error'); });
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

        {/* LinkedIn warm-channel controls */}
        <div className="row" style={{ gap: 10, marginTop: 14, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span className="mono dim" style={{ fontSize: 11 }}>
            LinkedIn haystack: {linkedin.count ? `${Number(linkedin.count).toLocaleString()} connections` : 'none imported yet'}
            {linkedin.importedAt ? ` · ${String(linkedin.importedAt).slice(0, 10)}` : ''}
          </span>
          <button className="btn sm" onClick={reconcileLinkedin} disabled={reconciling || !linkedin.count}
            title="Re-scan your stored connections against your current pipeline and pull in new Stage-1 warm paths">
            {reconciling ? 'Reconciling…' : '↻ Reconcile'}
          </button>
          <button className="btn sm" onClick={() => fileRef.current && fileRef.current.click()} disabled={importing}
            title="Upload a fresh LinkedIn Connections.csv export (Settings → Data Privacy → Get a copy of your data → Connections)">
            {importing ? 'Importing…' : '⭱ Import LinkedIn CSV'}
          </button>
          <button className="btn sm" onClick={findEmailsBulk} disabled={findingBulk || !rows.length}
            title="Find + verify an email for every referral missing one, in a single pass (Hunter + MillionVerifier)">
            {findingBulk ? 'Finding emails…' : '✉ Find emails'}
          </button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; importCsv(f); }} />
        </div>

        {/* Persistent import summary — the "did it work, what changed" receipt */}
        {lastImport && (
          <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
            <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 12 }}>✓ Import complete</span>
            <span className="mono dim" style={{ fontSize: 11.5 }}>
              {Number(lastImport.imported).toLocaleString()} connections read · +{lastImport.stage1Added} Stage 1 · +{lastImport.stage2Added} Stage 2 · {Number(lastImport.stage2Available || 0).toLocaleString()} warm referrers matched · scanned against {lastImport.activeCompanies} active companies
            </span>
            <button className="icon-btn" onClick={() => setLastImport(null)} title="Dismiss" style={{ marginLeft: 'auto' }}>✕</button>
          </div>
        )}
      </div>

      {/* Add form */}
      {adding && (
        <div className="card padded-lg col" style={{ gap: 10 }}>
          <div className="card-title" style={{ fontSize: 13 }}>Add someone to your network list</div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="inp" aria-label="Name" placeholder="Name *" value={form.name} style={{ minWidth: 160 }}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))} onKeyDown={e => e.key === 'Enter' && add()} />
            <input className="inp" aria-label="How you know them" placeholder="How you know them (e.g. Acme Corp, 2015-2019)" value={form.how} style={{ minWidth: 220, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, how: e.target.value }))} />
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <input className="inp" aria-label="Where they are now" placeholder="Where they are now (their reach)" value={form.where} style={{ minWidth: 220, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, where: e.target.value }))} />
            <input className="inp" aria-label="Target company or role" placeholder="Target company or role you want in" value={form.target} style={{ minWidth: 220, flex: 1 }}
              onChange={e => setForm(f => ({ ...f, target: e.target.value }))} />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <input className="inp" aria-label="Notes" placeholder="Notes" value={form.notes} style={{ flex: 1 }}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} onKeyDown={e => e.key === 'Enter' && add()} />
            <button className="btn primary sm" onClick={add}>Add</button>
          </div>
        </div>
      )}

      {/* Stage subtabs */}
      <div className="subtabs">
        {REF_SUBTABS.map(s => (
          <button type="button" key={s.id} className={'subtab' + (subtab === s.id ? ' active' : '')}
            onClick={() => setSubtab(s.id)} title={s.hint}>
            {s.label}<span className="mono dim" style={{ marginLeft: 6, fontSize: 10 }}>{stageCounts[s.id] ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        {filtered.length === 0 ? (
          <div className="no-data" style={{ padding: 28, textAlign: 'center' }}>
            {rows.length === 0
              ? 'No one added yet. Import your LinkedIn connections to auto-build Stage 1 and Stage 2, or add people by hand.'
              : subtab === 'stage1'
                ? 'No Stage-1 paths in view. These are connections already inside a company you are targeting — reconcile after sourcing new JDs, or import a fresh LinkedIn CSV.'
                : subtab === 'stage2'
                  ? 'No Stage-2 referrers in view. Import your LinkedIn CSV to seed the warm-referrer pool.'
                  : 'No matches for your search.'}
          </div>
        ) : (
          <table className="tbl ssi-tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th style={{ width: 210 }}>Name</th>
                <th style={{ width: 220 }}>How you know them</th>
                <th style={{ width: 200 }}>Where now / reach</th>
                <th style={{ width: 180 }}>Target</th>
                <th style={{ width: 150 }}>Status</th>
                <th style={{ width: 110 }}>Last touch</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <tr key={row.id} className={drawerId === row.id ? 'selected' : ''} tabIndex={0}
                  onKeyDown={window.kbdActivate(() => setDrawerId(row.id))} onClick={() => setDrawerId(row.id)}>
                  <td>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                      <div className="mono-av sm" style={{ borderColor: REF_STATUS_COLORS[row.status] || 'var(--border)', color: REF_STATUS_COLORS[row.status] || 'var(--text-dim)', flex: 'none' }}>{refInitials(row.name)}</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name || '(no name)'}</div>
                      {row.stage === 'stage1' && <span title="Inside a company you are targeting" style={{ flex: 'none', fontSize: 9, fontWeight: 700, letterSpacing: '.4px', padding: '1px 5px', borderRadius: 4, background: 'rgba(34,197,94,0.16)', color: '#22c55e' }}>S1</span>}
                    </div>
                  </td>
                  <td title={row.how || ''}><span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.how || '-'}</span></td>
                  <td title={row.where || ''}><span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.where || '-'}</span></td>
                  <td title={row.target || ''}><span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.target || '-'}</span></td>
                  <td><span className="status-badge" style={{ color: REF_STATUS_COLORS[row.status] || 'var(--text)', borderColor: 'var(--border)', fontSize: 9.5, padding: '2px 7px' }}><span className="sb-dot" style={{ background: REF_STATUS_COLORS[row.status] || 'var(--text-mute)' }} />{row.status}</span></td>
                  <td><span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: row.lastTouch ? 'var(--text-dim)' : 'var(--text-mute)' }}>{row.lastTouch || '-'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawerId != null && (
        <ReferralDrawer
          row={rows.find(r => r.id === drawerId)}
          statuses={statuses}
          onClose={() => setDrawerId(null)}
          onPatch={patch}
          onLogToday={logToday}
          onFindEmail={findEmailOne}
          finding={findingId === drawerId}
          onChanged={load}
          onRemove={(r) => { remove(r); setDrawerId(null); }}
        />
      )}

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

function RefStat({ n, label, accent }) {
  return (
    <div className="col" style={{ gap: 2 }}>
      <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: accent || 'var(--text)' }}>{n}</div>
      <div className="dim mono" style={{ fontSize: 11 }}>{label}</div>
    </div>
  );
}

// Exposed so the unified Contacts table (network.jsx) can open a referral in the
// same drawer used inside the Referrals subtab.
window.ReferralDrawer = ReferralDrawer;
window.REF_STATUS_COLORS = REF_STATUS_COLORS;

function refInitials(name) {
  const parts = String(name || '').replace(/['"]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

// ─── Contact drawer ───────────────────────────────────────────────────────────
// Same slide-over chrome as the TA and Recruiter drawers, so a referral is a
// clickable contact card like every other book. Referral-specific fields (how you
// know them, their reach, the target you want in) instead of email/correspondence,
// since this channel is warm-intro / template driven, not direct outreach.
function ReferralDrawer({ row, statuses, onClose, onPatch, onLogToday, onFindEmail, finding, onChanged, onRemove }) {
  const open = !!row;
  return (
    <>
      <div className={"drawer-backdrop" + (open ? " open" : "")} onClick={onClose}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }} />
      <div className={"drawer" + (open ? " open" : "")} style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}>
        {open && <ReferralPanel row={row} statuses={statuses} onClose={onClose} onPatch={onPatch} onLogToday={onLogToday} onFindEmail={onFindEmail} finding={finding} onChanged={onChanged} onRemove={onRemove} />}
      </div>
    </>
  );
}

// One correspondence entry, rendered like the TA/recruiter timeline.
function RefMsg({ m }) {
  const dir = m.direction || 'Sent';
  const isSent = dir === 'Sent';
  const c = dir === 'Received' ? '#22d3ee' : dir === 'Draft' ? 'var(--text-mute)' : '#a78bfa';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '8px 0' }}>
      <div style={{ flex: 'none', width: 22, display: 'flex', justifyContent: 'center', color: c, fontSize: 12 }}>{isSent ? '↑' : dir === 'Received' ? '↓' : '✎'}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.5px', padding: '1px 6px', borderRadius: 4, border: `1px solid ${c}`, color: c }}>{dir.toUpperCase()}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{m.subject || '(no subject)'}</span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-mute)' }}>{m.timestamp}</span>
        </div>
        {m.body && <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-dim)', whiteSpace: 'pre-wrap', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px' }}>{m.body}</div>}
      </div>
    </div>
  );
}

// Deliverability badge colors, shared vocabulary with lib/email-verify.mjs.
const REF_VERIFY_COLORS = {
  ok: '#22c55e', risky: '#f59e0b', unverified: 'var(--text-mute)',
  invalid: 'var(--red)', blocked: 'var(--red)', bounced: 'var(--red)',
};

function ReferralPanel({ row, statuses, onClose, onPatch, onLogToday, onFindEmail, finding, onChanged, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState({});
  const [detail, setDetail] = useState(null);
  const [compose, setCompose] = useState(null);   // { direction, subject, body } | null
  const [saving, setSaving] = useState(false);
  const toast = window.tjkToast || (() => {});
  const FIELDS = [
    { k: 'name', label: 'Name' },
    { k: 'how', label: 'How you know them' },
    { k: 'where', label: 'Where they are now / their reach' },
    { k: 'target', label: 'Target company or role you want in' },
    { k: 'linkedin', label: 'LinkedIn URL' },
    { k: 'email', label: 'Email' },
    { k: 'notes', label: 'Notes', textarea: true },
  ];

  const loadDetail = useCallback(() => {
    fetch(`/api/referrals/${row.id}/detail`).then(r => r.json()).then(setDetail).catch(() => setDetail({ error: true }));
  }, [row.id]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const startEdit = () => { setEdit(Object.fromEntries(FIELDS.map(f => [f.k, row[f.k] || '']))); setEditing(true); };
  const saveEdit = () => {
    const payload = {};
    for (const f of FIELDS) { const v = (edit[f.k] || '').trim(); if (v !== (row[f.k] || '')) payload[f.k] = v; }
    if (Object.keys(payload).length) onPatch(row.id, payload);
    setEditing(false);
  };
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const submitMessage = () => {
    if (!compose || !compose.body.trim()) { toast('Add the message text first', 'warn'); return; }
    setSaving(true);
    window.tjkMutate(`/api/referrals/${row.id}/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: compose.direction, subject: compose.subject, body: compose.body }),
    }).then(r => r.json()).then(d => {
      setSaving(false);
      if (!d.ok) { toast(d.error || 'Could not log', 'error'); return; }
      setCompose(null); loadDetail(); onChanged && onChanged();
      toast(d.linkedTo ? `Logged to your ${d.linkedTo.source === 'ta' ? 'TA' : 'recruiter'} timeline for this person` : `Logged ${compose.direction.toLowerCase()}`, 'success');
    }).catch(() => { setSaving(false); toast('Could not log', 'error'); });
  };

  const color = REF_STATUS_COLORS[row.status] || 'var(--text)';
  const inputStyle = { background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text)', fontSize: 12, width: '100%' };
  const link = detail && detail.link;
  const corr = (detail && detail.correspondence) || [];
  const relatedApps = (detail && detail.relatedApps) || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {row.stage === 'stage1' && <span className="tag" style={{ background: 'rgba(34,197,94,0.16)', color: '#22c55e' }}>Stage 1 · warm path into a target</span>}
          {row.stage === 'stage2' && <span className="tag">Stage 2 · warm referrer</span>}
          {link && <span className="tag" style={{ background: link.source === 'ta' ? 'rgba(34,211,238,0.14)' : 'rgba(167,139,250,0.14)', color: link.source === 'ta' ? '#22d3ee' : '#a78bfa' }}>Also {link.source === 'ta' ? 'TA' : 'Recruiter'} #{link.id} · shared timeline</span>}
          <button className="icon-btn" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span className="mono-av" style={{ width: 44, height: 44, fontSize: 14, borderRadius: 10, borderColor: color, color }}>{refInitials(row.name)}</span>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{row.name || '(no name)'}</h3>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{(link && link.title) || row.where || 'reach not recorded'}</div>
            <div style={{ fontSize: 12, color, marginTop: 3, fontWeight: 600 }}>{row.status}</div>
          </div>
        </div>
      </div>

      <div className="drawer-body" style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
        {/* Details */}
        <div className="ds-section">
          <div className="ds-label">
            Details
            {!editing && <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={startEdit}>Edit</button>}
          </div>
          {editing ? (
            <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {FIELDS.map(f => (
                <div key={f.k} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <label style={{ fontSize: 10.5, color: 'var(--text-mute)', letterSpacing: '.04em' }}>{f.label}</label>
                  {f.textarea
                    ? <textarea value={edit[f.k] || ''} onChange={e => setEdit(p => ({ ...p, [f.k]: e.target.value }))} rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                    : <input value={edit[f.k] || ''} onChange={e => setEdit(p => ({ ...p, [f.k]: e.target.value }))} style={inputStyle} />}
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                <button className="btn primary sm" onClick={saveEdit}>Save</button>
                <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="info-card">
              <div className="info-row"><span className="ik">How you know them</span><span className="iv">{row.how || '—'}</span><span /></div>
              <div className="info-row"><span className="ik">Where now / reach</span><span className="iv">{row.where || '—'}</span><span /></div>
              <div className="info-row">
                <span className="ik">LinkedIn</span>
                <span className="iv">{row.linkedin
                  ? <a href={row.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>{row.linkedin.replace(/^https?:\/\/(www\.)?/, '')}</a>
                  : '—'}</span>
                <span>{row.linkedin && <RefCopyBtn text={row.linkedin} label="Copy" />}</span>
              </div>
              <div className="info-row">
                <span className="ik">Email</span>
                <span className="iv" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {row.email
                    ? <>
                        <a href={`mailto:${row.email}`} style={{ color: 'var(--accent)' }}>{row.email}</a>
                        {row.verified && row.verified.state && row.verified.state !== 'unverified' && (
                          <span title={`Deliverability: ${row.verified.state}${row.verified.source ? ' · ' + row.verified.source : ''}`}
                            style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, border: `1px solid ${REF_VERIFY_COLORS[row.verified.state] || 'var(--border)'}`, color: REF_VERIFY_COLORS[row.verified.state] || 'var(--text-dim)' }}>{row.verified.state}</span>
                        )}
                      </>
                    : <span style={{ color: 'var(--text-mute)' }}>—</span>}
                </span>
                <button className="btn ghost sm" disabled={finding} onClick={() => onFindEmail(row)}
                  title="Find + verify an email via Hunter and MillionVerifier">
                  {finding ? 'Finding…' : (row.email ? 'Re-find' : 'Find email')}
                </button>
              </div>
              <div className="info-row"><span className="ik">Target</span><span className="iv">{row.target || '—'}</span><span /></div>
              <div className="info-row"><span className="ik">Notes</span><span className="iv">{row.notes || '—'}</span><span /></div>
            </div>
          )}
        </div>

        {/* Related applications — same company match the TA drawer uses */}
        {relatedApps.length > 0 && (
          <div className="ds-section">
            <div className="ds-label">Related applications at {row.where}<span className="r">{relatedApps.length}</span></div>
            <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {relatedApps.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)' }}>#{a.id}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.role || '(role)'}</span>
                  {a.score != null && <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{a.score}/5</span>}
                  <span className="status-badge" style={{ fontSize: 9, padding: '2px 6px' }}>{a.status}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Status + touch */}
        <div className="ds-section">
          <div className="ds-label">Status</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {statuses.map(s => {
              const on = row.status === s;
              const c = REF_STATUS_COLORS[s] || 'var(--text)';
              return (
                <button key={s} className="btn sm" onClick={() => onPatch(row.id, { status: s })}
                  style={{ color: c, borderColor: on ? c : 'var(--border)', background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : 'transparent', fontWeight: on ? 600 : 400 }}>
                  {s}
                </button>
              );
            })}
          </div>
          <div className="info-row">
            <span className="ik">Last touch</span>
            <span className="iv" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.lastTouch || 'Never'}</span>
            <button className="btn ghost sm" onClick={() => onLogToday(row)} title="Log a warm touch today (a reconnect or an ask both count)">Log touch today</button>
          </div>
        </div>

        {/* Correspondence */}
        <div className="ds-section">
          <div className="ds-label">
            Correspondence<span className="r">{corr.length} message{corr.length !== 1 ? 's' : ''}</span>
            {!compose && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className="btn ghost sm" onClick={() => setCompose({ direction: 'Sent', subject: '', body: '' })}>↑ Log sent</button>
                <button className="btn ghost sm" onClick={() => setCompose({ direction: 'Received', subject: '', body: '' })}>↓ Log reply</button>
              </span>
            )}
          </div>

          {link && (
            <div className="dim mono" style={{ fontSize: 10.5, marginBottom: 8 }}>
              Shared with this person's {link.source === 'ta' ? 'TA Outreach' : 'Recruiter'} record — messages logged here appear on both cards.
            </div>
          )}

          {compose && (
            <div className="info-card" style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: compose.direction === 'Sent' ? '#a78bfa' : '#22d3ee' }}>
                {compose.direction === 'Sent' ? 'Log a message you sent' : 'Log a reply you received'}
              </div>
              <input className="inp" placeholder="Subject (optional)" value={compose.subject} style={inputStyle}
                onChange={e => setCompose(c => ({ ...c, subject: e.target.value }))} />
              <textarea placeholder="What was said…" value={compose.body} rows={4} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                onChange={e => setCompose(c => ({ ...c, body: e.target.value }))} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn primary sm" disabled={saving} onClick={submitMessage}>{saving ? 'Saving…' : 'Save to timeline'}</button>
                <button className="btn ghost sm" onClick={() => setCompose(null)}>Cancel</button>
              </div>
            </div>
          )}

          {corr.length === 0 && !compose
            ? <div className="dim mono" style={{ fontSize: 11 }}>No messages logged yet. Use Log sent / Log reply to build the history{link ? ', or open their ' + (link.source === 'ta' ? 'TA' : 'recruiter') + ' card' : ''}.</div>
            : <div>{corr.slice().reverse().map((m, i) => <RefMsg key={i} m={m} />)}</div>}
        </div>

        {/* Danger zone */}
        <div className="ds-section">
          <button className="btn ghost sm" style={{ color: 'var(--red)' }} onClick={() => onRemove(row)}>Remove from tracker</button>
        </div>
      </div>
    </div>
  );
}

})();
