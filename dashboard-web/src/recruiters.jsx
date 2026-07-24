// Recruiters Module — Console redesign.
// 4 sub-tabs (Contacts default · Firms · Activity · Analytics).
// Cold-start as designed state: gauge hero + coaching banner + funnel.
// Drawer (legacy) still mounted on row click; Phase 2 rewires it.
// NOTE: target-talent.jsx loads AFTER this file and declares its own
// top-level `ContactsView`, `AnalyticsView`, `StatusBadge`, etc. — all
// recruiters helpers MUST be prefixed `Rec*` / `rec*` to avoid being
// overwritten in the shared global scope.

(function () {
const { useState: useStateR, useEffect: useEffectR, useMemo: useMemoR, useCallback: useCallbackR } = React;

// ─── Status metadata ────────────────────────────────────────────────────────
// `contacted` is deliberately separate from `stage`. Dormant and Bounced are
// states a contact enters AFTER an email went out, but they sit off the ladder
// (stage -1), so a `stage >= 2` test silently erased every row in those two
// states — understating outreach and, because those rows are denominator-only,
// OVERSTATING the reply rate. Note the sign is opposite to the applications bug:
// there, live status suppressed the numerator.
const REC_STATUS = [
  { id: 'Not Contacted',     short: 'New',       color: 'var(--text-mute)', rgb: '93,93,102',   stage: 0,  pipeline: true,  contacted: false },
  { id: 'Drafted',           short: 'Drafted',   color: 'var(--accent)',    rgb: '167,139,250', stage: 1,  pipeline: true,  contacted: false },
  { id: 'Sent',              short: 'Sent',      color: 'var(--blue)',      rgb: '96,165,250',  stage: 2,  pipeline: true,  contacted: true },
  { id: 'Replied',           short: 'Replied',   color: 'var(--cyan)',      rgb: '34,211,238',  stage: 3,  pipeline: true,  contacted: true },
  { id: 'Meeting Scheduled', short: 'Meeting',   color: 'var(--orange)',    rgb: '245,158,11',  stage: 4,  pipeline: true,  contacted: true },
  { id: 'Connected',         short: 'Connected', color: 'var(--green)',     rgb: '34,197,94',   stage: 5,  pipeline: true,  contacted: true },
  { id: 'Dormant',           short: 'Dormant',   color: 'var(--text-mute)', rgb: '93,93,102',   stage: -1, pipeline: false, contacted: true },
  // Occurs in real data but was previously in no ladder at all, so it fell
  // through `?.stage || 0` and rendered with the "Not Contacted" badge — telling
  // the user a hard-bounced address had never been contacted.
  { id: 'Bounced',           short: 'Bounced',   color: 'var(--red)',       rgb: '239,68,68',   stage: -1, pipeline: false, contacted: true },
];
const REC_STATUS_MAP = Object.fromEntries(REC_STATUS.map(s => [s.id, s]));
const REC_PIPELINE = REC_STATUS.filter(s => s.pipeline);
const wasContacted = (c) => !!REC_STATUS_MAP[c.status]?.contacted;

// Local calendar date. toISOString() is UTC and rolls over around 5-7pm US time,
// so an evening "Sent" was stamped with TOMORROW's date — which then reads back
// as "today" forever, since the relative-time helper floors negative ages at 0.
const localTodayRec = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function initials(name) {
  const parts = String(name).replace(/['"]/g, '').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function firmMono(name) {
  const stop = new Set(['a','the','of','and','&','company','co','group','partners','llc']);
  const words = String(name).replace(/[—–-]/g, ' ').split(/\s+/)
    .map(w => w.replace(/[^A-Za-z]/g, '')).filter(w => w && !stop.has(w.toLowerCase()));
  if (!words.length) return name.slice(0, 2).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
function firmIdFromName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
function locStr(c) {
  if (!c.city) return '—';
  if (!c.state || c.state === '—') return c.city;
  return `${c.city}, ${c.state}`;
}
function relTouch(d) {
  if (!d) return '—';
  const today = new Date();
  const days = Math.round((today - new Date(d)) / 864e5);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}

// ─── Icons ──────────────────────────────────────────────────────────────────
// Canonical paths in shared.jsx (window.ICON). Local REC_I alias preserves call sites.
const REC_I = window.ICON;
function RecIcon({ d, size = 16, fill = false, stroke = 1.6, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={d} />
    </svg>
  );
}

// ─── StatusBadge (outlined mono pill with dot + glow) ───────────────────────
function RecStatusBadge({ status, size = 'md' }) {
  const m = REC_STATUS_MAP[status] || REC_STATUS_MAP['Not Contacted'];
  const sm = size === 'sm';
  return (
    <span className="status-badge" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'var(--mono)', fontWeight: 500, letterSpacing: '0.03em',
      border: `1px solid rgba(${m.rgb},0.42)`,
      background: `rgba(${m.rgb},0.12)`,
      color: m.color, borderRadius: 4, whiteSpace: 'nowrap',
      fontSize: sm ? 9.5 : 10.5, padding: sm ? '2px 7px' : '3px 9px',
    }}>
      <span className="sb-dot" style={{
        width: 6, height: 6, borderRadius: 999, background: m.color,
        boxShadow: m.stage >= 1 ? `0 0 6px ${m.color}` : 'none',
      }} />
      {m.id}
    </span>
  );
}

// ─── Radial coverage gauge ──────────────────────────────────────────────────
function RadialGauge({ pct, value, label, color = 'var(--accent)', size = 116 }) {
  const r = (size - 16) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, pct / 100)));
  const cx = size / 2;
  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--panel-2)" strokeWidth="8" />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} transform={`rotate(-90 ${cx} ${cx})`}
          style={{ transition: 'stroke-dashoffset .6s cubic-bezier(.2,.7,.3,1)', filter: pct > 0 ? `drop-shadow(0 0 5px ${color})` : 'none' }} />
        <circle cx={cx} cy="8" r="2.4" fill={pct > 0 ? color : 'var(--text-mute)'} />
      </svg>
      <div className="gv">
        <div>
          <div className="num" style={{ color: pct > 0 ? color : 'var(--text)' }}>{value}</div>
          <div className="lbl">{label}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Stacked funnel strip ───────────────────────────────────────────────────
function StackedFunnel({ contacts, filter, setFilter, note }) {
  const total = contacts.length || 1;
  const counts = REC_STATUS.map(s => ({ s, n: contacts.filter(c => c.status === s.id).length }));
  const active = counts.filter(x => x.n > 0);
  return (
    <div className="funnelbar">
      <div className="fb-head">
        <div className="fb-title"><span className="dot" />Pipeline funnel</div>
        <div className="fb-note">{note}</div>
      </div>
      <div className="fb-track">
        {active.map(({ s, n }) => {
          const pct = (n / total) * 100;
          const on = filter === s.id;
          return (
            <div key={s.id} className={'fb-seg' + (pct < 6 ? ' thin' : '') + (on ? ' on' : '')}
              style={{ width: `${pct}%`, background: s.color, opacity: s.stage < 0 ? 0.5 : 1 }}
              title={`${s.id}: ${n}`} onClick={() => setFilter(on ? null : s.id)}>
              <span className="fb-c">{n}</span>
            </div>
          );
        })}
      </div>
      <div className="fb-legend">
        {counts.map(({ s, n }) => {
          const on = filter === s.id;
          return (
            <div key={s.id} className={'fb-leg' + (n === 0 ? ' off' : '')}
              onClick={() => n && setFilter(on ? null : s.id)}>
              <span className="ld" style={{ background: s.color, opacity: s.stage < 0 ? 0.6 : 1 }} />
              {s.id}<span className="ln">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Mini-KPI card ──────────────────────────────────────────────────────────
function MiniKpi({ icon, k, v, sub, color }) {
  return (
    <div className="rec-kpi">
      <div className="rk-row">
        {icon && <span className="rk-ico"><RecIcon d={icon} size={13} /></span>}
        <span className="rk-k">{k}</span>
      </div>
      <span className="rk-v" style={color ? { color } : null}>{v}</span>
      {sub && <span className="rk-sub">{sub}</span>}
    </div>
  );
}

// ─── KPI hero (gauge + 3 minis) ─────────────────────────────────────────────
function KpiHero({ kpis }) {
  return (
    <div className="kpi-hero">
      <div className="gauge-card">
        <RadialGauge pct={kpis.coverage} value={`${kpis.coverage}%`} label="coverage" />
        <div className="gauge-meta">
          <div className="gm-k">Outreach coverage</div>
          <div className="gm-v">{kpis.touched} / {kpis.total}</div>
          <div className="gm-sub">contacts reached at least once across {kpis.firms} firms</div>
          <div className="gm-row"><RecIcon d={REC_I.clock} size={12} /> {kpis.recentSent} sent in the last 7 days</div>
        </div>
      </div>
      <div className="kpi-mini-col">
        <MiniKpi icon={REC_I.inbound} k="Response Rate"
          v={kpis.touched ? `${kpis.response}%` : '—'}
          sub={kpis.touched ? `${kpis.replied} replied of ${kpis.touched}` : 'awaiting first send'} />
        <MiniKpi icon={REC_I.msg} k="Active Convos" v={kpis.inFlight}
          sub="replied · meeting · connected"
          color={kpis.inFlight ? 'var(--cyan)' : null} />
        <MiniKpi icon={REC_I.building} k="Firms Engaged"
          v={`${kpis.firmsEngaged}/${kpis.firms}`}
          sub={kpis.firmsEngaged ? 'with ≥1 sent' : 'no firm contacted yet'} />
      </div>
    </div>
  );
}

// ─── Cold-start coaching banner ─────────────────────────────────────────────
function ColdCoaching({ firms, onBatch, coverage }) {
  const top = firms.filter(f => f.contacts.every(c => c.status === 'Not Contacted'))
    .sort((a, b) => b.n - a.n).slice(0, 3);
  if (top.length === 0) return null;
  const names = top.map(f => f.name.split(' — ')[0]).join(', ').replace(/, ([^,]*)$/, ' & $1');
  const isCold = coverage === 0;
  return (
    <div className="coach">
      <div className="coach-ico"><RecIcon d={REC_I.rocket} size={20} /></div>
      <div>
        <div className="coach-eyebrow">{isCold ? 'Start here · 0% worked' : `Next batch · ${coverage}% worked`}</div>
        <div className="coach-title">
          {isCold ? 'Your pipeline is cold. Start the outreach motion.' : 'Keep momentum. These firms are still 100% untouched.'}
        </div>
        <div className="coach-sub">{names} each hold {top[top.length - 1].n}+ contacts. {isCold ? 'Pick one firm and batch a first round of outreach to build momentum fast.' : 'Batch one to spread reach across new firms.'}</div>
      </div>
      <div className="coach-actions">
        {top.map(f => (
          <button key={f.id} className="coach-chip" onClick={() => onBatch(f)}>
            <span className="cc-av">{firmMono(f.name)}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name.split(' — ')[0]}</span>
            <span className="cc-n">{f.n}</span>
            <span className="cc-go"><RecIcon d={REC_I.chevR} size={13} /></span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Quick actions ──────────────────────────────────────────────────────────
function QuickActions({ c, onCompose, onQuickSent, starred, toggleStar }) {
  const isStar = starred.has(c.firmId);
  return (
    <div className="qa">
      <button className="qa-btn acc" title="Start draft" onClick={e => { e.stopPropagation(); onCompose(c); }}>
        <RecIcon d={REC_I.spark} size={13} />
      </button>
      <button className="qa-btn blue" title="Mark sent" onClick={e => { e.stopPropagation(); onQuickSent(c); }}>
        <RecIcon d={REC_I.outbound} size={13} />
      </button>
      <button className={'qa-btn star' + (isStar ? ' on' : '')} title="Star firm" onClick={e => { e.stopPropagation(); toggleStar(c.firmId); }}>
        <RecIcon d={REC_I.star} size={13} fill={isStar} />
      </button>
    </div>
  );
}

// ─── Flat row ───────────────────────────────────────────────────────────────
function FlatRow({ c, onOpen, selId, qaFor }) {
  const m = REC_STATUS_MAP[c.status] || REC_STATUS_MAP['Not Contacted'];
  return (
    <div className={'flat-row' + (selId === c.id ? ' sel' : '')} onClick={() => onOpen(c)}>
      <span className="flat-av" style={{ borderColor: m.color, color: m.color }}>{initials(c.first + ' ' + c.last)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="flat-name">{c.salute} {c.first} {c.last}</div>
        <div className="flat-title">{c.title}</div>
      </div>
      <div className="flat-firm" style={{ minWidth: 0 }}>
        <span className="flat-firm-av">{firmMono(c.firm)}</span>
        <span className="flat-firm-name">{c.firm.split(' — ')[0]}</span>
      </div>
      <span className="flat-loc">{locStr(c)}</span>
      <span className="flat-status"><RecStatusBadge status={c.status} size="sm" /></span>
      {qaFor(c)}
    </div>
  );
}

// ─── KPI computation ────────────────────────────────────────────────────────
function computeKpis(contacts, firmsLen) {
  const total = contacts.length;
  const touched = contacts.filter(c => wasContacted(c)).length;
  const replied = contacts.filter(c => (REC_STATUS_MAP[c.status]?.stage || 0) >= 3).length;
  const inFlight = contacts.filter(c => ['Replied','Meeting Scheduled','Connected'].includes(c.status)).length;
  const firmsEngaged = new Set(contacts.filter(c => wasContacted(c)).map(c => c.firmId)).size;
  const coverage = total ? Math.round((touched / total) * 100) : 0;
  const response = touched ? Math.round((replied / touched) * 100) : 0;
  const today = new Date();
  const recentSent = contacts.filter(c => {
    if (!c.lastTouch) return false;
    const d = (today - new Date(c.lastTouch)) / 864e5;
    return d <= 7 && wasContacted(c);
  }).length;
  return { total, touched, replied, inFlight, firmsEngaged, coverage, response, firms: firmsLen, recentSent };
}

// ─── Contacts sub-tab ──────────────────────────────────────────────────────
function ContactsView({ contacts, firms, kpis, landing, onOpen, onCompose, onQuickSent, onBatch, starred, toggleStar, selId, search }) {
  const q = search || '';
  const [firmFilter, setFirmFilter] = useStateR('');
  const [statusFilter, setStatusFilter] = useStateR('');
  const [sort, setSort] = useStateR('firm');

  const firmList = useMemoR(() => [...firms].sort((a, b) => a.name.localeCompare(b.name)), [firms]);

  const rows = useMemoR(() => {
    const t = q.trim().toLowerCase();
    const list = contacts.filter(c => {
      if (firmFilter && c.firm !== firmFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (t && !`${c.first} ${c.last} ${c.firm} ${c.title} ${c.city} ${c.email}`.toLowerCase().includes(t)) return false;
      return true;
    });
    list.sort((a, b) => {
      if (sort === 'name') return a.last.localeCompare(b.last) || a.first.localeCompare(b.first);
      if (sort === 'status') {
        const sa = REC_STATUS_MAP[a.status]?.stage || 0;
        const sb = REC_STATUS_MAP[b.status]?.stage || 0;
        return sb - sa || a.firm.localeCompare(b.firm);
      }
      return a.firm.localeCompare(b.firm) || (a.last || '').localeCompare(b.last || '');
    });
    return list;
  }, [contacts, q, firmFilter, statusFilter, sort]);

  const firmsShown = useMemoR(() => new Set(rows.map(c => c.firmId)).size, [rows]);
  const hasFilter = q || firmFilter || statusFilter;
  const qaFor = c => <QuickActions c={c} onCompose={onCompose} onQuickSent={onQuickSent} starred={starred} toggleStar={toggleStar} />;

  return (
    <div className="fade-up">
      <div className="rec-head">
        <div>
          <h1>{landing ? 'Recruiters' : 'Contacts'}</h1>
          <div className="sub">
            {rows.length} of {contacts.length} contacts · {firmsShown} firms{landing && kpis.coverage === 0 ? ' · 100% not contacted' : ''}
          </div>
        </div>
        <div className="act">
          <div className="rec-seg">
            <button className={sort === 'firm' ? 'on' : ''} onClick={() => setSort('firm')}>
              <RecIcon d={REC_I.building} size={13} /> Firm
            </button>
            <button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')}>A-Z</button>
            <button className={sort === 'status' ? 'on' : ''} onClick={() => setSort('status')}>
              <RecIcon d={REC_I.trend} size={13} /> Stage
            </button>
          </div>
        </div>
      </div>

      {landing && <ColdCoaching firms={firms} onBatch={onBatch} coverage={kpis.coverage} />}
      {landing && <KpiHero kpis={kpis} />}
      {landing && (
        <StackedFunnel contacts={contacts} filter={statusFilter || null}
          setFilter={s => setStatusFilter(s || '')}
          note={kpis.touched ? `${kpis.touched} of ${kpis.total} reached` : `${kpis.total} awaiting first outreach`} />
      )}

      <div className="ta-filters" style={{ margin: '0 0 14px' }}>
        <select className="sel" value={firmFilter} onChange={e => setFirmFilter(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
          <option value="">All firms</option>
          {firmList.map(f => <option key={f.id} value={f.name}>{f.name.split(' — ')[0]} ({f.n})</option>)}
        </select>
        <select className="sel" value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={{ width: 'auto', minWidth: 140 }}>
          <option value="">All states</option>
          {REC_STATUS.map(s => <option key={s.id} value={s.id}>{s.id}</option>)}
        </select>
        {hasFilter && (
          <button className="btn ghost sm" onClick={() => { setFirmFilter(''); setStatusFilter(''); }}>
            <RecIcon d={REC_I.x} size={12} /> Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>{rows.length} shown</span>
      </div>

      {rows.length === 0 ? (
        <div className="rec-empty-pad">No contacts match these filters.</div>
      ) : (
        <div className="flatlist">
          <div className="flat-head">
            <span />
            <span>Contact</span>
            <span>Firm</span>
            <span>Location</span>
            <span style={{ justifySelf: 'end' }}>Stage</span>
            <span />
          </div>
          {rows.map(c => <FlatRow key={c.id} c={c} onOpen={onOpen} selId={selId} qaFor={qaFor} />)}
        </div>
      )}
    </div>
  );
}

// ─── Firms view ─────────────────────────────────────────────────────────────
function recFirmSegments(f) {
  const order = ['Connected','Meeting Scheduled','Replied','Sent','Drafted','Not Contacted','Dormant'];
  return order
    .map(s => ({ s, n: f.contacts.filter(c => c.status === s).length, color: REC_STATUS_MAP[s]?.color }))
    .filter(x => x.n > 0);
}
function RecFirmCard({ f, onOpen, onCompose, starred, toggleStar }) {
  const segs = recFirmSegments(f);
  const total = f.n;
  const touched = f.contacts.filter(c => wasContacted(c)).length;
  const isStar = starred.has(f.id);
  return (
    <div className="firm-card" onClick={() => onOpen(f.contacts[0])}>
      <div className="firm-top">
        <span className="firm-av">{firmMono(f.name)}</span>
        <div style={{ minWidth: 0 }}>
          <div className="firm-name">{f.name}</div>
          <div className="firm-sub">{locStr(f.contacts[0])}</div>
        </div>
        <div className="firm-count">
          <div className="fc-n">{total}</div>
          <div className="fc-k">contacts</div>
        </div>
      </div>
      <div className="firm-mix">
        {segs.map((sg, i) => (
          <span key={i} className="fm-seg" title={`${sg.s}: ${sg.n}`}
            style={{
              width: `${(sg.n / total) * 100}%`,
              background: sg.color,
              opacity: (REC_STATUS_MAP[sg.s]?.stage ?? 0) < 0 ? 0.5 : 1,
            }} />
        ))}
      </div>
      <div className="firm-foot">
        <span className="firm-cov">
          <span className="cov-dot" style={touched ? { background: 'var(--green)' } : null} />
          {touched} of {total} contacted
        </span>
        <div className="qa">
          <button className={'qa-btn star' + (isStar ? ' on' : '')} title="Star firm"
            onClick={e => { e.stopPropagation(); toggleStar(f.id); }}>
            <RecIcon d={REC_I.star} size={13} fill={isStar} />
          </button>
        </div>
        <button className="firm-cta" onClick={e => { e.stopPropagation(); onCompose(f.contacts[0]); }}>
          <RecIcon d={REC_I.spark} size={12} /> Start outreach
        </button>
      </div>
    </div>
  );
}
function RecFirmsView({ firms, onOpen, onCompose, starred, toggleStar, search }) {
  const q = search || '';
  const [sort, setSort] = useStateR('count');

  const list = useMemoR(() => {
    let arr = [...firms];
    if (q.trim()) {
      const t = q.toLowerCase();
      arr = arr.filter(f => f.name.toLowerCase().includes(t));
    }
    if (sort === 'starred') arr = arr.filter(f => starred.has(f.id));
    arr.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'starred') return (starred.has(b.id) - starred.has(a.id)) || b.n - a.n;
      return b.n - a.n || a.name.localeCompare(b.name);
    });
    return arr;
  }, [firms, q, sort, starred]);

  return (
    <div className="fade-up">
      <div className="rec-head">
        <div>
          <h1>Firms</h1>
          <div className="sub">{firms.length} firms · {firms.reduce((s, f) => s + f.n, 0)} contacts</div>
        </div>
        <div className="act">
          <div className="rec-seg">
            <button className={sort === 'count' ? 'on' : ''} onClick={() => setSort('count')}>
              <RecIcon d={REC_I.sort} size={13} /> By volume
            </button>
            <button className={sort === 'starred' ? 'on' : ''} onClick={() => setSort('starred')}>
              <RecIcon d={REC_I.star} size={13} /> Starred
            </button>
            <button className={sort === 'name' ? 'on' : ''} onClick={() => setSort('name')}>A-Z</button>
          </div>
        </div>
      </div>

      <div className="ta-filters" style={{ margin: '0 0 14px' }}>
        {sort === 'starred' && (
          <button className="btn ghost sm" onClick={() => setSort('count')}>
            <RecIcon d={REC_I.x} size={12} /> Clear
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-mute)' }}>
          {list.length} firms
        </span>
      </div>

      {list.length === 0 ? (
        <div className="rec-empty-pad">No firms match.</div>
      ) : (
        <div className="firm-grid">
          {list.map(f => (
            <RecFirmCard key={f.id} f={f} onOpen={onOpen} onCompose={onCompose}
              starred={starred} toggleStar={toggleStar} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Activity view ──────────────────────────────────────────────────────────
function RecActivityView({ recruiters, onBatch, onOpen, jumpView }) {
  // Use lastTouch as proxy — full per-contact correspondence fetch would be too
  // expensive at 515 contacts. Touched contacts show as feed items with the
  // status as the most recent action.
  const touched = useMemoR(() => recruiters
    .filter(c => c.lastTouch)
    .sort((a, b) => (b.lastTouch || '').localeCompare(a.lastTouch || '')), [recruiters]);

  if (touched.length === 0) {
    // Two distinct empty states. With no recruiters at all, "send a first
    // outreach" is impossible advice — there is nobody to send it to — and the
    // real next step is Directory, which is where contacts get imported. The
    // single generic state used to point everyone at a batch that could not
    // exist yet.
    const noContacts = recruiters.length === 0;
    return (
      <div className="fade-up">
        <div className="rec-head">
          <div>
            <h1>Activity</h1>
            <div className="sub">outreach, replies & meetings across all firms</div>
          </div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <div className="feed-empty">
            <div className="fe-ico"><RecIcon d={REC_I.clock} size={26} /></div>
            <div className="fe-title">{noContacts ? 'No recruiters yet' : 'No activity yet'}</div>
            <div className="fe-sub">
              {noContacts
                ? 'This timeline is built from the messages you exchange, so it needs your recruiter list first. Add them in Directory, and every outreach, reply and meeting will stream here automatically.'
                : 'Every message you send, reply you receive, and meeting you book will stream here as a timeline. Your pipeline is at the starting line. Send a first outreach to light it up.'}
            </div>
            <button
              className="btn primary"
              onClick={() => (noContacts ? (jumpView && jumpView('directory')) : onBatch(null))}
            >
              <RecIcon d={REC_I.rocket} size={14} /> {noContacts ? 'Add recruiters in Directory' : 'Start the recommended batch'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Group by day
  const byDay = new Map();
  for (const c of touched) {
    const d = c.lastTouch;
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(c);
  }

  return (
    <div className="fade-up">
      <div className="rec-head">
        <div>
          <h1>Activity</h1>
          <div className="sub">{touched.length} touchpoint{touched.length === 1 ? '' : 's'} logged · most recent first</div>
        </div>
      </div>
      <div className="card">
        {[...byDay.entries()].map(([day, items]) => (
          <div key={day}>
            <div className="feed-day">{day}</div>
            <div className="feed">
              {items.map(c => {
                const m = REC_STATUS_MAP[c.status] || REC_STATUS_MAP['Not Contacted'];
                const isInbound = c.status === 'Replied';
                const icon = isInbound ? REC_I.inbound : REC_I.outbound;
                const color = isInbound ? 'var(--cyan)' : m.color;
                return (
                  <div key={c.id} className="feed-item" onClick={() => onOpen(c)} style={{ cursor: 'pointer' }}>
                    <div className="feed-node" style={{ borderColor: color, color }}>
                      <RecIcon d={icon} size={13} />
                    </div>
                    <div className="feed-main">
                      <div className="fi-txt">
                        <b>{c.status}</b> · {c.first} {c.last}
                        <span style={{ color: 'var(--text-mute)' }}> · {c.firm.split(' — ')[0]}</span>
                      </div>
                      <div className="fi-sub">{c.title}</div>
                    </div>
                    <div className="feed-time">{relTouch(c.lastTouch)}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Overview view ─────────────────────────────────────────────────────────
function RecKpi({ label, value, sub, tone = 'neutral' }) {
  const COLOR = { neutral: 'var(--text)', good: 'var(--green)', warn: 'var(--yellow)', danger: 'var(--red)', accent: 'var(--accent)' };
  return (
    <div className="card" style={{ padding: '14px 16px', flex: 1, minWidth: 170 }}>
      <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 600, color: COLOR[tone], lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function RecBar({ label, n, total, color }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color }}>{label}</span>
        <span className="mono dim">{n} · {pct}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function RecOverviewView({ recruiters, firms, onOpen, jumpView }) {
  const total = recruiters.length;
  // `?? -1` not `|| 0`: an unknown status must not silently read as stage 0
  // ("Not Contacted"), which is how Bounced hid for a month.
  const stageOf = (c) => REC_STATUS_MAP[c.status]?.stage ?? -1;
  const sent      = recruiters.filter(wasContacted).length;
  const replied   = recruiters.filter(c => stageOf(c) >= 3).length;
  const meeting   = recruiters.filter(c => stageOf(c) >= 4).length;
  const connected = recruiters.filter(c => c.status === 'Connected').length;
  const notContacted = recruiters.filter(c => c.status === 'Not Contacted').length;
  const firmsEngaged = new Set(recruiters.filter(wasContacted).map(c => c.firmId)).size;
  const responseRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
  const outreachRate = total > 0 ? Math.round((sent / total) * 100) : 0;
  const activeConvos = replied + meeting;
  const firmCoverage = firms.length > 0 ? Math.round((firmsEngaged / firms.length) * 100) : 0;

  const outreachTone = outreachRate >= 40 ? 'good' : outreachRate >= 20 ? 'neutral' : 'warn';
  const responseTone = responseRate >= 10 ? 'good' : responseRate >= 5 ? 'accent' : 'warn';
  const convoTone    = activeConvos > 0 ? 'good' : 'neutral';
  const coverageTone = firmCoverage >= 40 ? 'good' : firmCoverage >= 20 ? 'accent' : 'neutral';

  // Cumulative funnel
  const cum = REC_PIPELINE.map(s => ({ s, reached: recruiters.filter(c => stageOf(c) >= s.stage).length }));
  const maxReached = cum[0]?.reached || 1;

  // Coverage by firm (top 6 by total contacts)
  const byFirm = [...firms]
    .map(f => ({ key: (f.name || '').split(' — ')[0] || 'Unknown', total: f.n, engaged: f.contacts.filter(c => wasContacted(c)).length }))
    .sort((a, b) => b.total - a.total).slice(0, 6);

  // Action items: Replied (book), Sent stale, Not Contacted at firms with engaged peers
  const firmHasEngaged = new Set(recruiters.filter(c => wasContacted(c)).map(c => c.firmId));
  const actionScore = (c) => {
    let s = 0;
    if (c.status === 'Replied') s += 100;
    if (c.status === 'Meeting Scheduled') s += 60;
    if (c.status === 'Not Contacted' && firmHasEngaged.has(c.firmId)) s += 40;
    if (c.status === 'Sent') s += 20;
    return s;
  };
  const actions = [...recruiters]
    .filter(c => actionScore(c) > 0)
    .sort((a, b) => actionScore(b) - actionScore(a))
    .slice(0, 6);

  const verdict = (c) => {
    if (c.status === 'Replied') return 'Hot. Book a meeting today';
    if (c.status === 'Meeting Scheduled') return 'Confirm + share roles you want';
    if (c.status === 'Not Contacted' && firmHasEngaged.has(c.firmId)) return 'Same firm already engaged, easy intro';
    if (c.status === 'Sent') return 'Awaiting reply. Nudge if 7d+';
    return '';
  };

  const funnelInsight = sent === 0
    ? 'Whole base sits at Not Contacted. Draft the first 5 today to seed the funnel.'
    : responseRate < 5
      ? 'Sent → Replied is leaking. Tighten the opener, name the specific role, drop the boilerplate.'
      : responseRate < 10
        ? `Replies are coming in (${responseRate}%). Push volume, the message works.`
        : `${responseRate}% reply rate. Now make every Replied land a meeting.`;
  const firmInsight = byFirm.length === 0
    ? 'No firm data yet.'
    : byFirm[0].engaged > 0
      ? `${byFirm[0].key}: ${byFirm[0].engaged}/${byFirm[0].total} engaged. Your strongest firm relationship.`
      : `${byFirm[0].key} has the most contacts (${byFirm[0].total}) but no replies. Try a fresh angle.`;
  const stageInsight = notContacted > total * 0.5
    ? `${notContacted} contacts untouched. Pick 5 to draft today.`
    : 'Healthy distribution. Keep weekly volume up.';

  return (
    <div className="fade-up col" style={{ gap: 16 }}>
      <div className="rec-head">
        <div>
          <h1>Recruiters</h1>
          <div className="sub">{total} contacts · {firms.length} firms · {connected} connected</div>
        </div>
      </div>

      {/* GRID, not a wrapping flex row. With flex:1 children a wrap leaves the last
          line holding one card that grows to fill the ENTIRE line: between roughly
          600 and 700px this rendered three cards at 225px and a fourth at 700px.
          auto-fit + minmax keeps every column equal at every width, and wraps with
          no orphan to stretch. */}
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <RecKpi label="Outreach Rate" value={`${outreachRate}%`}
          sub={outreachRate >= 40 ? 'Steady cadence, keep it up' : 'Below 40%. Draft a few more this week'}
          tone={outreachTone} />
        {/* These thresholds are working targets you set, not industry benchmarks,
            and the copy says so. The word "benchmark" used to be here and it made a
            local rule of thumb sound like an external standard nobody could cite. */}
        <RecKpi label="Response Rate" value={sent ? `${responseRate}%` : '—'}
          sub={sent === 0 ? 'Send your first batch this week'
             : responseRate >= 10 ? 'Above your 10% target, your hook works'
             : responseRate >= 5 ? 'Around your 5% floor, sharpen openers'
             : 'Under your 5% floor. Rewrite hook, lead with the role'}
          tone={responseTone} />
        <RecKpi label="Active Convos" value={activeConvos}
          sub={activeConvos > 0 ? `${replied} replied · ${meeting} meetings. Work the warm pipeline` : 'No live convos. Replies fill this column'}
          tone={convoTone} />
        <RecKpi label="Firm Coverage" value={`${firmCoverage}%`}
          sub={firmCoverage >= 40 ? `${firmsEngaged} of ${firms.length} firms warm` : `Only ${firmsEngaged} of ${firms.length} firms touched. Broaden reach`}
          tone={coverageTone} />
      </div>

      <div className="row" style={{ gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: 14, flex: 1.4, minWidth: 320 }}>
          <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Outreach Funnel</div>
          {cum.map(({ s, reached }) => {
            const pct = Math.round((reached / maxReached) * 100);
            return (
              <div className="funnel-row" key={s.id}>
                <span className="funnel-lbl"><span style={{ width: 7, height: 7, borderRadius: 99, background: s.color, display: 'inline-block' }} />{s.id}</span>
                <div className="funnel-track">
                  <div className="funnel-fill" style={{ width: `${Math.max(pct, reached ? 7 : 0)}%`, background: s.color }}>{reached > 0 ? reached : ''}</div>
                </div>
                <span className="funnel-val">{pct}%</span>
              </div>
            );
          })}
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>{funnelInsight}</div>
        </div>

        <div className="card" style={{ padding: 14, flex: 1, minWidth: 260 }}>
          <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Coverage by Firm</div>
          <div className="col" style={{ gap: 10 }}>
            {byFirm.length === 0 && <span className="dim" style={{ fontSize: 12 }}>No firm data yet.</span>}
            {byFirm.map(v => (
              <RecBar key={v.key} label={`${v.key} · ${v.engaged}/${v.total} engaged`} n={v.total} total={(cum[0]?.reached) || 1} color="#a78bfa" />
            ))}
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>{firmInsight}</div>
        </div>

        <div className="card" style={{ padding: 14, flex: 1, minWidth: 240 }}>
          <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>Stage Mix</div>
          <div className="col" style={{ gap: 10 }}>
            {REC_PIPELINE.map(s => (
              <RecBar key={s.id} label={s.id} n={recruiters.filter(c => c.status === s.id).length} total={total} color={s.color} />
            ))}
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>{stageInsight}</div>
        </div>
      </div>

      {/* Needs Attention — same row layout as Pipeline → Overview */}
      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title"><span className="dot" />Needs Attention</span>
          <span className="card-meta mono">{actions.length} items</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {actions.length === 0 && <div className="no-data" style={{ padding: '8px 0' }}>No prioritized actions. Start a draft for a top firm.</div>}
          {actions.map(c => {
            const status = c.status;
            const iconPath = status === 'Replied'           ? window.ICON.msg
                            : status === 'Meeting Scheduled' ? window.ICON.briefcase
                            : status === 'Sent'              ? window.ICON.clock
                                                              : window.ICON.send;
            const color = status === 'Replied'           ? 'var(--red)'
                         : status === 'Meeting Scheduled' ? 'var(--orange)'
                         : status === 'Sent'              ? 'var(--yellow)'
                                                          : 'var(--accent)';
            const fullName = `${c.first || c.firstName || ''} ${c.last || c.lastName || ''}`.trim() || c.firm;
            const sub = [c.title || c.role, c.firm].filter(Boolean).join(' · ');
            return (
              <div key={c.id} onClick={() => onOpen(c)}
                style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto auto', gap: 12, alignItems: 'center',
                  padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
                  background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center',
                  background: 'var(--panel)', border: '1px solid var(--border)', color }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPath} /></svg>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sub || '—'}</div>
                </div>
                <span className="mono" style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>{verdict(c)}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <RecStatusBadge status={c.status} size="sm" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Analytics view (deprecated — replaced by Overview) ──────────────────
function RecAnalyticsView({ recruiters, firms }) {
  const total = recruiters.length;
  const stages = REC_PIPELINE;
  const cum = stages.map(s => ({
    s,
    reached: recruiters.filter(c => (REC_STATUS_MAP[c.status]?.stage || 0) >= s.stage).length,
  }));
  const maxReached = cum[0]?.reached || 1;
  const sent = recruiters.filter(c => wasContacted(c)).length;
  const replied = recruiters.filter(c => (REC_STATUS_MAP[c.status]?.stage || 0) >= 3).length;
  const meeting = recruiters.filter(c => (REC_STATUS_MAP[c.status]?.stage || 0) >= 4).length;
  const connected = recruiters.filter(c => c.status === 'Connected').length;

  // "Coverage by Firm" — live data has no `focus` field; firm is the right grouping
  const byFirm = [...firms]
    .map(f => ({
      key: f.name.split(' — ')[0],
      total: f.n,
      engaged: f.contacts.filter(c => wasContacted(c)).length,
    }))
    .sort((a, b) => b.total - a.total).slice(0, 9);
  const maxFirm = Math.max(...byFirm.map(v => v.total), 1);

  return (
    <div className="fade-up">
      <div className="rec-head">
        <div>
          <h1>Analytics</h1>
          <div className="sub">outreach performance across {total} contacts · {firms.length} firms</div>
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <MiniKpi icon={REC_I.outbound} k="Sent → Replied"
          v={sent ? Math.round((replied / sent) * 100) + '%' : '—'}
          sub={sent ? `${replied} of ${sent} sent` : 'no outreach sent yet'} />
        <MiniKpi icon={REC_I.clock} k="Replied → Meeting"
          v={replied ? Math.round((meeting / replied) * 100) + '%' : '—'}
          sub={`${meeting} meetings booked`} />
        <MiniKpi icon={REC_I.clock} k="Avg Days to Reply" v="—" sub="from first outreach" />
        <MiniKpi icon={REC_I.users} k="Connected" v={connected} sub="relationships established" />
      </div>

      <div className="grid" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: 14, alignItems: 'start' }}>
        <div className="card">
          <div className="card-head"><span className="card-title"><span className="dot" />Outreach Funnel</span></div>
          <div style={{ marginTop: 2 }}>
            {cum.map(({ s, reached }, i) => {
              const pct = Math.round((reached / maxReached) * 100);
              const drop = i > 0 ? cum[i - 1].reached - reached : 0;
              return (
                <div className="funnel-row" key={s.id}>
                  <span className="funnel-lbl">
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: s.color, display: 'inline-block' }} />
                    {s.id}
                  </span>
                  <div className="funnel-track">
                    <div className="funnel-fill"
                      style={{ width: `${Math.max(pct, reached ? 7 : 0)}%`, background: s.color }}>
                      {reached > 0 ? reached : ''}
                    </div>
                  </div>
                  <span className="funnel-val">
                    {i > 0 ? (drop > 0 ? <span style={{ color: 'var(--text-mute)' }}>−{drop}</span> : '0') : pct + '%'}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="divider" />
          <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {sent === 0
              ? <>The entire base sits at <span style={{ color: 'var(--text)' }}>Not Contacted</span>. The first and largest opportunity is the <span style={{ color: 'var(--accent-2)' }}>Not Contacted → Drafted</span> step. That's where to focus first.</>
              : <>Conversion at each step: aim to keep <span style={{ color: 'var(--accent-2)' }}>Sent → Replied</span> above 20% and <span style={{ color: 'var(--accent-2)' }}>Replied → Meeting</span> above 50%.</>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><span className="card-title"><span className="dot" />Coverage by Firm</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 2 }}>
            {byFirm.map(v => (
              <div key={v.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
                  <span>{v.key}</span>
                  <span className="mono" style={{ color: 'var(--text-mute)', fontSize: 11 }}>{v.engaged}/{v.total} engaged</span>
                </div>
                <div className="bar" style={{ position: 'relative' }}>
                  <span style={{ width: `${(v.total / maxFirm) * 100}%`, background: 'var(--panel-3)', position: 'absolute', inset: 0, borderRadius: 99 }} />
                  <span style={{ width: `${(v.engaged / maxFirm) * 100}%`, position: 'relative' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-tabs ───────────────────────────────────────────────────────────────
// ─── Directory (unified sortable table — replaces Contacts + Firms) ─────────
// One sortable contact table; firm is a sortable/filterable column so it covers
// the old Firms view too. Look and feel modeled on Pipeline → Table.
function RecDirectoryView({ contacts, firms, onOpen, onCompose, onQuickSent, starred, toggleStar, selId, search, onImported }) {
  const q = search || '';
  const [firmFilter, setFirmFilter] = useStateR('');
  const [statusFilter, setStatusFilter] = useStateR('');
  const [sortKey, setSortKey] = useStateR('firm');
  const [sortDir, setSortDir] = useStateR('asc');
  const [importing, setImporting] = useStateR(false);
  const [importMsg, setImportMsg] = useStateR('');

  // Bulk-import recruiter contacts from a CSV (shared template with TA Outreach).
  function handleImport(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    setImporting(true); setImportMsg('');
    const reader = new FileReader();
    reader.onload = () => {
      window.tjkMutate('/api/recruiters/bulk-import', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ csv: String(reader.result || '') }) })
        .then(r => r.json().then(b => ({ ok: r.ok, b })))
        .then(({ ok, b }) => {
          setImporting(false);
          if (!ok || b.error) { setImportMsg(b.error || 'Import failed.'); return; }
          setImportMsg(`Imported ${b.imported}${b.duplicates ? `, ${b.duplicates} duplicate${b.duplicates === 1 ? '' : 's'} skipped` : ''}.`);
          onImported && onImported();
        })
        .catch(err => { setImporting(false); setImportMsg(err.message); });
    };
    reader.onerror = () => { setImporting(false); setImportMsg('Could not read the file.'); };
    reader.readAsText(file);
  }

  const setSort = (k) => {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir(k === 'lastTouch' || k === 'status' ? 'desc' : 'asc'); }
  };

  const firmList = useMemoR(() => [...firms].sort((a, b) => a.name.localeCompare(b.name)), [firms]);

  const rows = useMemoR(() => {
    const t = q.trim().toLowerCase();
    const list = contacts.filter(c => {
      if (firmFilter && c.firm !== firmFilter) return false;
      if (statusFilter && c.status !== statusFilter) return false;
      if (t && !`${c.first} ${c.last} ${c.firm} ${c.title} ${c.city} ${c.email}`.toLowerCase().includes(t)) return false;
      return true;
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let av, bv;
      if (sortKey === 'name')        { av = (a.last || '').toLowerCase(); bv = (b.last || '').toLowerCase(); }
      else if (sortKey === 'firm')   { av = (a.firm || '').toLowerCase(); bv = (b.firm || '').toLowerCase(); }
      else if (sortKey === 'loc')    { av = locStr(a).toLowerCase();      bv = locStr(b).toLowerCase(); }
      else if (sortKey === 'status') { av = REC_STATUS_MAP[a.status]?.stage ?? 0; bv = REC_STATUS_MAP[b.status]?.stage ?? 0; }
      else if (sortKey === 'lastTouch') { av = a.lastTouch || ''; bv = b.lastTouch || ''; }
      else { av = (a[sortKey] || '').toString().toLowerCase(); bv = (b[sortKey] || '').toString().toLowerCase(); }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return (a.firm || '').localeCompare(b.firm || '') || (a.last || '').localeCompare(b.last || '');
    });
    return list;
  }, [contacts, q, firmFilter, statusFilter, sortKey, sortDir]);

  const firmsShown = useMemoR(() => new Set(rows.map(c => c.firmId)).size, [rows]);
  const hasFilter = q || firmFilter || statusFilter;

  const cols = [
    { k: 'name',      label: 'Contact',    w: 200 },
    { k: 'title',     label: 'Title',      w: 220 },
    { k: 'firm',      label: 'Firm',       w: 190 },
    { k: 'loc',       label: 'Location',   w: 150 },
    { k: 'status',    label: 'Stage',      w: 140 },
    { k: 'lastTouch', label: 'Last Touch', w: 110 },
  ];

  return (
    <div className="fade-up">
      <div className="rec-head">
        <div>
          <h1>Directory</h1>
          <div className="sub">{rows.length} of {contacts.length} contacts · {firmsShown} firms</div>
        </div>
        <div className="act">
          {importMsg && <span className="dim" style={{ fontSize: 11 }}>{importMsg}</span>}
          <a className="btn" href="/api/recruiters/template" download style={{ textDecoration: 'none' }} title="Download the CSV template (company, first, last, title, phone, linkedin, website, ...)">Template</a>
          <label className="btn" style={{ cursor: importing ? 'default' : 'pointer', opacity: importing ? 0.6 : 1 }} title="Bulk-import recruiter contacts from a CSV file">
            {importing ? 'Importing…' : 'Import CSV'}
            <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} disabled={importing} onChange={handleImport} />
          </label>
        </div>
      </div>

      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title">Contacts</span>
          <span className="card-meta mono">{rows.length} of {contacts.length} · {firmsShown} firms</span>
        </div>

        {/* Status filter chips (mirrors TA Outreach StatusBreakdown) */}
        <div className="statline">
          {REC_STATUS.map(s => {
            const n = contacts.filter(c => c.status === s.id).length;
            const on = statusFilter === s.id;
            return (
              <button key={s.id} className={'stat-chip' + (on ? ' on' : '') + (n === 0 ? ' zero' : '')}
                onClick={() => setStatusFilter(on ? '' : s.id)}>
                <span className="sc-dot" style={{ background: s.color, boxShadow: n && s.stage >= 1 ? `0 0 6px ${s.color}` : 'none' }} />
                {s.id}<span className="sc-n">{n}</span>
              </button>
            );
          })}
        </div>

        <div className="ta-filters" style={{ marginTop: 10 }}>
          <select className="sel" value={firmFilter} onChange={e => setFirmFilter(e.target.value)} style={{ width: 'auto', minWidth: 150 }}>
            <option value="">All firms</option>
            {firmList.map(f => <option key={f.id} value={f.name}>{f.name.split(' — ')[0]} ({f.n})</option>)}
          </select>
          {hasFilter && (
            <button className="btn ghost sm" onClick={() => { setFirmFilter(''); setStatusFilter(''); }}>
              <RecIcon d={REC_I.x} size={12} /> Clear
            </button>
          )}
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--mono)', fontSize: 10.5, color: 'var(--text-mute)', letterSpacing: '.06em' }}>
            sorted by {cols.find(c => c.k === sortKey)?.label.toLowerCase()} · click a row for details
          </span>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 360px)', border: 'none', borderRadius: 0, background: 'transparent' }}>
          <table className="tbl ssi-tbl">
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? 'sorted' : ''}
                    onClick={() => !c.noSort && setSort(c.k)}>
                    {c.label}{!c.noSort && <span className="sort-ind">{sortKey === c.k ? (sortDir === 'asc' ? '↑' : '↓') : '·'}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={cols.length}><div className="no-data" style={{ padding: 40, textAlign: 'center' }}>No contacts match these filters.</div></td></tr>
              )}
              {rows.map(c => {
                const m = REC_STATUS_MAP[c.status] || REC_STATUS_MAP['Not Contacted'];
                return (
                  <tr key={c.id} className={selId === c.id ? 'selected' : ''} onClick={() => onOpen(c)}>
                    <td>
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                        <div className="mono-av sm" style={{ borderColor: m.color, color: m.color, flex: 'none' }}>{initials(c.first + ' ' + c.last)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first} {c.last}</div>
                      </div>
                    </td>
                    <td title={c.title || ''}>
                      <span style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title || '—'}</span>
                    </td>
                    <td title={c.firm || ''}>
                      <span style={{ fontWeight: 600, fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.firm.split(' — ')[0]}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: locStr(c) === '—' ? 'var(--text-mute)' : 'var(--text-dim)' }}>{locStr(c)}</span>
                    </td>
                    <td><RecStatusBadge status={c.status} size="sm" /></td>
                    <td>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 10.5, color: c.lastTouch ? 'var(--text-dim)' : 'var(--text-mute)' }}>{c.lastTouch ? relTouch(c.lastTouch) : '—'}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const REC_SUBTABS = [
  { id: 'overview',  label: 'Overview',  icon: REC_I.pulse },
  { id: 'directory', label: 'Directory', icon: REC_I.users },
  { id: 'activity',  label: 'Activity',  icon: REC_I.clock },
];

// ─── Root module ────────────────────────────────────────────────────────────
window.RecruitersTab = function RecruitersTab({ search } = {}) {
  const [recruiters, setRecruiters] = useStateR([]);
  const [loading, setLoading] = useStateR(true);
  const [view, setView] = useStateR('overview');
  const [selected, setSelected] = useStateR(null);
  const [starred, setStarred] = useStateR(() => new Set());

  const load = useCallbackR(() => {
    setLoading(true);
    fetch('/api/recruiters')
      .then(r => r.json())
      .then(data => {
        const enriched = data.map(r => ({ ...r, firmId: firmIdFromName(r.firm) }));
        setRecruiters(enriched);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);
  useEffectR(() => { load(); }, [load]);

  const firms = useMemoR(() => {
    const m = new Map();
    for (const c of recruiters) {
      const id = c.firmId;
      if (!m.has(id)) m.set(id, { id, name: c.firm, contacts: [], n: 0 });
      const f = m.get(id);
      f.contacts.push(c);
      f.n++;
    }
    return [...m.values()];
  }, [recruiters]);

  const kpis = useMemoR(() => computeKpis(recruiters, firms.length), [recruiters, firms.length]);

  const onOpen = (c) => setSelected(c.id);
  const onCompose = (c) => setSelected(c.id);
  const onQuickSent = (c) => {
    window.tjkMutate(`/api/recruiters/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'Sent', lastTouch: localTodayRec() }),
    }).then(load);
  };
  // `f` may be null: the Activity empty state has no firm to hand over, it just
  // means "open whoever I should contact first". Dereferencing it threw a
  // TypeError, and because React does not route event-handler errors to an error
  // boundary the button simply appeared dead.
  const onBatch = (f) => {
    const first = (f && f.contacts && f.contacts[0]) || recruiters[0];
    if (first) setSelected(first.id);
  };
  const toggleStar = (id) => setStarred(s => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  if (loading && !recruiters.length) {
    return <div className="rec-empty-pad">Loading recruiters…</div>;
  }

  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {REC_SUBTABS.map(s => (
          <div key={s.id} className={'subtab' + (view === s.id ? ' active' : '')} onClick={() => setView(s.id)}>
            <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
              <RecIcon d={s.icon} size={14} />
            </span>
            {s.label}
          </div>
        ))}
      </div>

      {view === 'overview' && <RecOverviewView recruiters={recruiters} firms={firms} onOpen={onOpen} jumpView={setView} />}
      {view === 'directory' && (
        <RecDirectoryView
          contacts={recruiters} firms={firms}
          onOpen={onOpen} onCompose={onCompose} onQuickSent={onQuickSent}
          starred={starred} toggleStar={toggleStar} selId={selected} search={search}
          onImported={load}
        />
      )}
      {view === 'activity' && <RecActivityView recruiters={recruiters} onBatch={onBatch} onOpen={onOpen} jumpView={setView} />}

      {selected != null && (
        <window.RecruiterDrawer
          id={selected} firms={firms}
          onClose={() => setSelected(null)}
          onUpdate={(nextId) => { load(); if (typeof nextId === 'number') setSelected(nextId); }}
        />
      )}
    </div>
  );
};

// ─── New drawer (Phase 2) ───────────────────────────────────────────────────
const REC_TONES = ['Warm', 'Direct', 'Curious', 'Concise'];

function RecCopyField({ value }) {
  const [done, setDone] = useStateR(false);
  const copy = (e) => {
    e.stopPropagation();
    try { navigator.clipboard.writeText(value); } catch (_) {}
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return (
    <button className={'copy-btn' + (done ? ' done' : '')} onClick={copy}>
      <RecIcon d={done ? REC_I.spark : REC_I.outbound} size={11} />{done ? 'Copied' : 'Copy'}
    </button>
  );
}

function RecPipelineUI({ contact, onChange, style }) {
  const cur = REC_STATUS_MAP[contact.status] || REC_STATUS_MAP['Not Contacted'];
  const pipe = REC_PIPELINE;
  if (style === 'track') {
    return (
      <div>
        <div className="pipe-track">
          {pipe.map(s => {
            const cls = cur.stage > s.stage ? 'done' : cur.stage === s.stage ? 'cur' : '';
            return (
              <button key={s.id} className={'pipe-step ' + cls} onClick={() => onChange(s.id)}>
                <span className="pipe-bar" />
                <span className="pipe-lbl">{s.short}</span>
              </button>
            );
          })}
        </div>
        <div className="pipe-foot">
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Stage {Math.max(cur.stage, 0) + 1} of 6 · <span style={{ color: cur.color }}>{contact.status}</span>
          </span>
          <button className="btn ghost sm" onClick={() => onChange('Dormant')}
            style={{ color: contact.status === 'Dormant' ? 'var(--orange)' : undefined }}>Mark dormant</button>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="stepper-pipe">
        {pipe.map((s, i) => {
          const done = cur.stage > s.stage;
          const isCur = cur.stage === s.stage;
          return (
            <button key={s.id}
              className={'sp-step' + (done ? ' done' : '') + (isCur ? ' cur' : '')}
              onClick={() => onChange(s.id)}>
              <span className="sp-line" />
              <span className="sp-node">{done ? '✓' : i + 1}</span>
              <span className="sp-lbl">{s.short}</span>
            </button>
          );
        })}
      </div>
      <div className="sp-foot">
        <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Stage {Math.max(cur.stage, 0) + 1} of 6 · <span style={{ color: cur.color }}>{contact.status}</span>
        </span>
        <button className="btn ghost sm" onClick={() => onChange('Dormant')}
          style={{ color: contact.status === 'Dormant' ? 'var(--orange)' : undefined }}>Mark dormant</button>
      </div>
    </div>
  );
}

function RecAICompose({ contact, contactId, onSaveDraft, onLogSent, onToast }) {
  const [tone, setTone] = useStateR('Warm');
  const [busy, setBusy] = useStateR(false);
  const [out, setOut] = useStateR('');
  const [subject, setSubject] = useStateR(`Intro: ${contact.first}, exploring leadership mandates`);

  const gen = useCallbackR(() => {
    setBusy(true); setOut('');
    window.tjkMutate(`/api/recruiters/${contactId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tone }),
    })
      .then(r => r.json())
      .then(d => {
        setBusy(false);
        if (d.draft) {
          setSubject(d.draft.subject || subject);
          setOut(d.draft.body || '');
        } else {
          onToast(d.error || 'Draft failed', 'warn');
        }
      })
      .catch(err => { setBusy(false); onToast(err.message, 'warn'); });
  }, [contactId, tone]);

  useEffectR(() => { gen(); }, [contactId]);

  return (
    <div className="ai-compose">
      <div className="ai-head"><RecIcon d={REC_I.spark} size={13} /> AI outreach composer · resume voice</div>
      <div className="ai-tone">
        {REC_TONES.map(t => (
          <button key={t} className={'chip' + (tone === t ? ' on' : '')} onClick={() => setTone(t)}>{t}</button>
        ))}
        <button className="btn ghost sm" onClick={gen} style={{ marginLeft: 'auto' }}>
          <RecIcon d={REC_I.refresh} size={12} /> Regenerate
        </button>
      </div>
      {busy && (
        <div className="ai-loading">
          <span className="scan-ring" style={{ width: 16, height: 16, borderWidth: 2 }} />
          drafting a {tone.toLowerCase()} outreach…
        </div>
      )}
      {out && !busy && (() => {
        const cleanBody = (out || '').replace(/^\s+/, '');
        const fullEmail = `Hi ${contact.first},\n\n${cleanBody}\n\n${window.myEmailSignature()}`;
        return (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text-dim)', padding: '2px 2px 0' }}>
            <span><span style={{ color: 'var(--text-mute)' }}>Subject:</span> {subject}</span>
            <RecCopyField value={subject || ''} />
          </div>
          <div style={{ position: 'relative' }}>
            <div className="ai-out">{fullEmail}</div>
            <div style={{ position: 'absolute', top: 8, right: 8 }}>
              <RecCopyField value={fullEmail} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn primary sm" onClick={() => onLogSent(subject, fullEmail)}>
              <RecIcon d={REC_I.outbound} size={12} /> I sent this. Log it
            </button>
            <button className="btn sm" onClick={() => onSaveDraft(subject, fullEmail)}>
              <RecIcon d={REC_I.spark} size={12} /> Save as draft only
            </button>
            <window.GmailDraftBtn to={contact.email} subject={subject} body={fullEmail} />
          </div>
        </>
        );
      })()}
    </div>
  );
}

function RecMsgNode({ m }) {
  const dir = m.direction === 'Received' ? 'in' : m.direction === 'Draft' ? 'draft' : 'out';
  const icon = dir === 'in' ? REC_I.inbound : dir === 'draft' ? REC_I.spark : REC_I.outbound;
  const color = dir === 'in' ? 'var(--cyan)' : dir === 'draft' ? 'var(--accent-2)' : 'var(--blue)';
  const label = dir === 'in' ? 'Received' : dir === 'draft' ? 'Draft' : 'Sent';
  return (
    <div className="msg">
      <div className="msg-node" style={{ borderColor: color, color }}><RecIcon d={icon} size={11} /></div>
      <div className="msg-head">
        <span className={'msg-dir ' + dir}>{label}</span>
        <span className="msg-subj">{m.subject}</span>
        <span className="msg-date">{m.timestamp || 'just now'}</span>
      </div>
      <div className={'msg-body' + (dir === 'draft' ? ' draftbox' : '')}>{m.body}</div>
    </div>
  );
}

function RecLogModal({ direction, subject, body, onSave, onClose }) {
  const [subj, setSubj] = useStateR(subject || '');
  const [bod, setBod] = useStateR(body || '');
  const sent = direction === 'Sent';
  useEffectR(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && subj.trim() && bod.trim()) onSave(subj, bod);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [subj, bod]);
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="logmodal" onClick={e => e.stopPropagation()}>
        <div className={'log-head ' + (sent ? 'sent' : 'received')}>
          <span className="lh-ico"><RecIcon d={sent ? REC_I.outbound : REC_I.inbound} size={17} /></span>
          <div>
            <h2>Log {sent ? 'Sent' : 'Received'} Message</h2>
            <div className="lh-sub">{sent ? 'records an outbound touch & advances to Sent' : 'records a reply & advances to Replied'}</div>
          </div>
          <button className="icon-btn" style={{ marginLeft: 'auto' }} onClick={onClose}>
            <RecIcon d={REC_I.x} size={15} />
          </button>
        </div>
        <div className="log-body">
          <div className="field">
            <label>Subject</label>
            <input className="inp" value={subj} onChange={e => setSubj(e.target.value)} placeholder="Subject line…" autoFocus />
          </div>
          <div className="field">
            <label>Message</label>
            <textarea className="ta" style={{ minHeight: 150 }} value={bod} onChange={e => setBod(e.target.value)} placeholder="Paste or write the message…" />
          </div>
        </div>
        <div className="log-foot">
          <span className="kbd">⌘ + Enter to save</span>
          <div className="right">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary"
              disabled={!subj.trim() || !bod.trim()}
              style={{ opacity: (!subj.trim() || !bod.trim()) ? 0.5 : 1 }}
              onClick={() => onSave(subj, bod)}>Save message</button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.RecruiterDrawer = function RecruiterDrawer({ id, onClose, onUpdate, firms = [] }) {
  const [data, setData] = useStateR(null);
  const [loading, setLoading] = useStateR(true);
  const [notesDraft, setNotesDraft] = useStateR('');
  const [website, setWebsite] = useStateR('');
  const [editingWeb, setEditingWeb] = useStateR(false);
  const [linkedin, setLinkedin] = useStateR('');
  const [editingLi, setEditingLi] = useStateR(false);
  const [composing, setComposing] = useStateR(false);
  const [log, setLog] = useStateR(null);
  const [toast, setToastMsg] = useStateR(null);
  const [pipeStyle, setPipeStyle] = useStateR('stepper');

  const showToast = useCallbackR((msg, kind) => {
    setToastMsg({ msg, kind });
    setTimeout(() => setToastMsg(null), 2400);
  }, []);

  const load = () => {
    setLoading(true);
    fetch(`/api/recruiters/${id}`)
      .then(r => r.json())
      .then(d => {
        setData({ ...d, firmId: firmIdFromName(d.firm) });
        setNotesDraft(d.notes || '');
        setWebsite(d.website || '');
        setLinkedin(d.linkedin || '');
        setEditingWeb(false);
        setEditingLi(false);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };
  useEffectR(() => { load(); setComposing(false); setLog(null); }, [id]);

  useEffectR(() => {
    const onKey = e => { if (e.key === 'Escape' && !log) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, log]);

  const updateStatus = (status) => {
    const body = { status };
    if (REC_STATUS_MAP[status]?.contacted) body.lastTouch = localTodayRec();
    window.tjkMutate(`/api/recruiters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => { load(); onUpdate?.(); });
  };
  const saveNotes = () => {
    window.tjkMutate(`/api/recruiters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesDraft }),
    }).then(() => { load(); onUpdate?.(); showToast('Notes saved', 'success'); });
  };
  const saveWebsite = () => {
    window.tjkMutate(`/api/recruiters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ website: website.trim() }),
    }).then(() => { setEditingWeb(false); load(); onUpdate?.(); showToast('Firm site saved', 'success'); });
  };
  const saveLinkedin = () => {
    window.tjkMutate(`/api/recruiters/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ linkedin: linkedin.trim() }),
    }).then(() => { setEditingLi(false); load(); onUpdate?.(); showToast('LinkedIn saved', 'success'); });
  };
  const saveCorrespondence = (direction, subject, body) => {
    window.tjkMutate(`/api/recruiters/${id}/correspondence`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction, subject, body }),
    }).then(() => {
      const next = direction === 'Sent' ? 'Sent' : direction === 'Received' ? 'Replied' : 'Drafted';
      updateStatus(next);
      setLog(null); setComposing(false);
      showToast(`Logged ${direction.toLowerCase()} message`, 'success');
    });
  };

  if (loading || !data) {
    return (
      <>
        <div className="drawer-backdrop open" onClick={onClose}></div>
        <div className="drawer wide open">
          <div style={{ padding: 24, color: 'var(--text-mute)' }}>Loading…</div>
        </div>
      </>
    );
  }

  const firm = firms.find(f => f.id === data.firmId);
  const peers = firm ? firm.contacts.filter(c => c.id !== data.id).slice(0, 5) : [];
  const touched = firm ? firm.contacts.filter(c => wasContacted(c)).length : 0;
  const corr = data.correspondence || [];
  const m = REC_STATUS_MAP[data.status] || REC_STATUS_MAP['Not Contacted'];
  const domain = (data.email || '').split('@')[1] || '';
  const liQuery = `https://www.google.com/search?q=` +
    encodeURIComponent(`"${data.first} ${data.last}" "${data.firm.split(' — ')[0]}" site:linkedin.com/in`);

  return (
    <>
      <div className="drawer-backdrop open" onClick={onClose}></div>
      <div className="drawer wide open">
        <div className="drawer-head">
          <div className="drawer-head-top">
            <span className="mono dim" style={{ fontSize: 11 }}>#{String(data.id).padStart(3, '0')}</span>
            <RecStatusBadge status={data.status} size="sm" />
            {firm && <span className="tag accent">{firm.n} at firm</span>}
            <button className="icon-btn x" onClick={onClose} title="Close (Esc)">
              <RecIcon d={REC_I.x} size={15} />
            </button>
          </div>
          <div className="drawer-id-block">
            <span className="mono-av" style={{ width: 44, height: 44, fontSize: 14, borderColor: m.color, color: m.color }}>
              {initials(data.first + ' ' + data.last)}
            </span>
            <div style={{ minWidth: 0 }}>
              <h3>{data.salute} {data.first} {data.last}</h3>
              <div className="role">{data.title}</div>
              <div className="co">{data.firm}</div>
            </div>
          </div>
        </div>

        <div className="drawer-body">
          {/* Contact info */}
          <div className="ds-section">
            <div className="ds-label"><RecIcon d={REC_I.building} size={12} /> Contact</div>
            <div className="info-card">
              <div className="info-row">
                <span className="ik">Firm site</span>
                {editingWeb ? (
                  <>
                    <input className="iv" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://firm.com"
                      style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', color: 'var(--text)', fontSize: 12, minWidth: 0 }} />
                    <button className="btn primary sm" onClick={saveWebsite}>Save</button>
                  </>
                ) : (() => {
                  const stored = (data.website || '').trim();
                  const href = stored ? (stored.startsWith('http') ? stored : 'https://' + stored) : (domain ? `https://${domain}` : '');
                  return (
                    <>
                      {href
                        ? <a className="iv link" href={href} target="_blank" rel="noreferrer">{stored || domain}{!stored && domain ? <span style={{ color: 'var(--text-mute)', marginLeft: 5, fontSize: 10.5 }}>(from email)</span> : null}</a>
                        : <span className="iv" style={{ color: 'var(--text-mute)' }}>—</span>}
                      <button className="copy-btn" onClick={() => { setWebsite(stored); setEditingWeb(true); }}><RecIcon d={REC_I.pen} size={11} /> Edit</button>
                    </>
                  );
                })()}
              </div>
              <div className="info-row">
                <span className="ik">Email</span>
                <span className="iv">{data.email}</span>
                <RecCopyField value={data.email} />
              </div>
              {data.phone && (
                <div className="info-row">
                  <span className="ik">Phone</span>
                  <span className="iv">{data.phone}</span>
                  <RecCopyField value={data.phone} />
                </div>
              )}
              <div className="info-row">
                <span className="ik">Location</span>
                <span className="iv">{[data.city, data.state, data.zip].filter(Boolean).join(', ')}</span>
                <span />
              </div>
              <div className="info-row">
                <span className="ik">LinkedIn</span>
                {editingLi ? (
                  <>
                    <input className="iv" value={linkedin} onChange={e => setLinkedin(e.target.value)} placeholder="https://linkedin.com/in/…"
                      style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', color: 'var(--text)', fontSize: 12, minWidth: 0 }} />
                    <button className="btn primary sm" onClick={saveLinkedin}>Save</button>
                  </>
                ) : data.linkedin ? (
                  <>
                    <a className="iv link" href={data.linkedin} target="_blank" rel="noreferrer">View profile</a>
                    <button className="copy-btn" onClick={() => { setLinkedin(data.linkedin || ''); setEditingLi(true); }}><RecIcon d={REC_I.pen} size={11} /> Edit</button>
                  </>
                ) : (
                  <>
                    <a className="iv link" href={liQuery} target="_blank" rel="noreferrer">Find on LinkedIn</a>
                    <button className="copy-btn" onClick={() => { setLinkedin(''); setEditingLi(true); }}><RecIcon d={REC_I.pen} size={11} /> Add</button>
                  </>
                )}
              </div>
              <div className="info-row">
                <span className="ik">Last touch</span>
                <span className="iv mono" style={{ color: 'var(--text-mute)' }}>{data.lastTouch || 'Never'}</span>
                <span />
              </div>
            </div>
            <div className="li-fallback">
              <RecIcon d={REC_I.search} size={11} /> LinkedIn searched via Google. Paste a profile URL once found.
            </div>
          </div>

          {/* Pipeline */}
          <div className="ds-section">
            <div className="ds-label">
              <RecIcon d={REC_I.trend} size={12} /> Pipeline stage
              <span className="r" style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button className={'btn ghost sm' + (pipeStyle === 'stepper' ? '' : '')}
                  style={{ fontSize: 10.5, padding: '2px 7px', opacity: pipeStyle === 'stepper' ? 1 : 0.55 }}
                  onClick={() => setPipeStyle('stepper')}>Stepper</button>
                <button className="btn ghost sm"
                  style={{ fontSize: 10.5, padding: '2px 7px', opacity: pipeStyle === 'track' ? 1 : 0.55 }}
                  onClick={() => setPipeStyle('track')}>Track</button>
              </span>
            </div>
            <RecPipelineUI contact={data} onChange={updateStatus} style={pipeStyle} />
          </div>

          {/* Firm at a glance */}
          {firm && (
            <div className="ds-section">
              <div className="ds-label">
                <RecIcon d={REC_I.building} size={12} /> {data.firm.split(' — ')[0]} at a glance
                <span className="r">{firm.n} contacts</span>
              </div>
              <div className="firm-glance">
                <div className="fg-row">
                  <span className="fg-k">Coverage</span>
                  <div className="fg-cov-bar"><i style={{ width: `${(touched / firm.n) * 100}%` }} /></div>
                  <span className="fg-v" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{touched}/{firm.n}</span>
                </div>
                <div className="fg-row">
                  <span className="fg-k">Location</span>
                  <span className="fg-v">{locStr(data)}</span>
                </div>
                {peers.length > 0 && (
                  <div className="fg-peers">
                    {peers.map(p => (
                      <div className="fg-peer" key={p.id} onClick={() => { onClose(); setTimeout(() => onUpdate && onUpdate(p.id), 50); }}>
                        <span className="fp-av">{initials(p.first + ' ' + p.last)}</span>
                        <div style={{ minWidth: 0 }}>
                          <span className="fp-name">{p.first} {p.last}</span>
                          <div className="fp-title">{p.title}</div>
                        </div>
                        <RecStatusBadge status={p.status} size="sm" />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="ds-section">
            <div className="ds-label">
              <RecIcon d={REC_I.spark} size={12} /> Notes
              {notesDraft !== (data.notes || '') && (
                <span className="r"><button className="btn primary sm" onClick={saveNotes}>Save</button></span>
              )}
            </div>
            <textarea className="notes-ta" value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
              placeholder="Add a note about this recruiter…" />
          </div>

          {/* Outreach */}
          <div className="ds-section">
            <div className="ds-label"><RecIcon d={REC_I.spark} size={12} /> Outreach</div>
            {!composing ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn primary sm" onClick={() => setComposing(true)}>
                  <RecIcon d={REC_I.spark} size={12} /> {corr.length ? 'Draft follow-up' : 'Draft first outreach'}
                </button>
                <button className="btn sm" onClick={() => setLog({ direction: 'Sent', subject: '', body: '' })}>
                  <RecIcon d={REC_I.outbound} size={12} /> Log sent
                </button>
                <button className="btn sm" onClick={() => setLog({ direction: 'Received', subject: '', body: '' })}>
                  <RecIcon d={REC_I.inbound} size={12} /> Log received
                </button>
              </div>
            ) : (
              <RecAICompose
                contact={data} contactId={id}
                onSaveDraft={(subject, body) => saveCorrespondence('Draft', subject, body)}
                onLogSent={(subject, body) => setLog({ direction: 'Sent', subject, body })}
                onToast={showToast}
              />
            )}
          </div>

          {/* Correspondence */}
          <div className="ds-section">
            <div className="ds-label">
              <RecIcon d={REC_I.outbound} size={12} /> Correspondence
              <span className="r">{corr.length} message{corr.length === 1 ? '' : 's'}</span>
            </div>
            {corr.length === 0 ? (
              <div className="empty" style={{ padding: '8px 2px' }}>
                No correspondence yet. Draft a first outreach to get started.
              </div>
            ) : (
              <div className="thread">
                {corr.slice().reverse().map((msg, i) => <RecMsgNode key={i} m={msg} />)}
              </div>
            )}
          </div>
        </div>
      </div>

      {log && (
        <RecLogModal
          direction={log.direction} subject={log.subject} body={log.body}
          onSave={(s, b) => saveCorrespondence(log.direction, s, b)}
          onClose={() => setLog(null)}
        />
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 200,
          background: 'var(--panel)', border: '1px solid var(--border-2)',
          borderLeft: `3px solid ${toast.kind === 'success' ? 'var(--green)' : toast.kind === 'warn' ? 'var(--orange)' : 'var(--accent)'}`,
          borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'var(--text)',
          boxShadow: '0 12px 28px -12px rgba(0,0,0,0.6)',
        }}>{toast.msg}</div>
      )}
    </>
  );
};
})(); // end recruiters IIFE
