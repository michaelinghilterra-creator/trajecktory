// Pipeline Module — Console redesign with sub-tabs.
// Overview (default) · Table · All · Analytics.
// Reuses the existing window.Drawer for the application drawer.
//
// NOTE: wrapped in an IIFE so locals don't collide with other modules
// (target-talent.jsx declares ContactsView/AnalyticsView etc; the IIFE
// keeps our 'Analytics', 'PipelineTable' etc. private).

(function () {
const { useState: useStateP, useMemo: useMemoP, useEffect: useEffectP, useRef: useRefP, useCallback: useCallbackP } = React;

// ─── Status / Source / Engine metadata ─────────────────────────────────────
const STATUS = [
  { id: 'Evaluated',     short: 'Eval',    color: 'var(--accent)', hex: '#a78bfa', rgb: '167,139,250', stage: 0, icon: '◆' },
  { id: 'Applied',       short: 'Applied', color: 'var(--blue)',   hex: '#60a5fa', rgb: '96,165,250',  stage: 1, icon: '↗' },
  { id: 'Responded',     short: 'Replied', color: 'var(--cyan)',   hex: '#22d3ee', rgb: '34,211,238',  stage: 2, icon: '↩' },
  { id: 'Phone Screen',  short: 'Screen',  color: '#fcd34d',       hex: '#fcd34d', rgb: '252,211,77',  stage: 3, icon: '☎' },
  { id: '1st Interview', short: '1st',     color: '#fbbf24',       hex: '#fbbf24', rgb: '251,191,36',  stage: 4, icon: '①' },
  { id: '2nd Interview', short: '2nd',     color: 'var(--orange)', hex: '#f59e0b', rgb: '245,158,11',  stage: 5, icon: '②' },
  { id: '3rd Interview', short: '3rd',     color: '#f97316',       hex: '#f97316', rgb: '249,115,22',  stage: 6, icon: '③' },
  { id: '4th Interview', short: '4th',     color: '#ea580c',       hex: '#ea580c', rgb: '234,88,12',   stage: 7, icon: '④' },
  { id: 'Offer',         short: 'Offer',   color: 'var(--green)',  hex: '#22c55e', rgb: '34,197,94',   stage: 8, icon: '★' },
];
const STATUS_MAP = Object.fromEntries(STATUS.map(s => [s.id, s]));
const ACTIVE_STATUSES = STATUS.map(s => s.id);
const LAST_STAGE = STATUS.length - 1; // Offer

const SOURCE = {
  'Self-sourced': { short: 'Self',   color: 'var(--accent)', hex: '#a78bfa', rgb: '167,139,250' },
  'Referral':     { short: 'Ref',    color: 'var(--green)',  hex: '#22c55e', rgb: '34,197,94' },
  'CoWork':       { short: 'CoWork', color: 'var(--pink)',   hex: '#ec4899', rgb: '236,72,153' },
  'API Scan':     { short: 'API',    color: 'var(--blue)',   hex: '#60a5fa', rgb: '96,165,250' },
  'Agent Scan':   { short: 'Agent',  color: 'var(--orange)', hex: '#f59e0b', rgb: '245,158,11' },
};

const ENGINE_META = {
  'CareerOps':   { color: 'var(--accent)', hex: '#a78bfa', rgb: '167,139,250' },
  'Claude':      { color: 'var(--orange)', hex: '#f59e0b', rgb: '245,158,11' },
  'Cowork':      { color: 'var(--cyan)',   hex: '#22d3ee', rgb: '34,211,238' },
  'CoWork':      { color: 'var(--green)',  hex: '#22c55e', rgb: '34,197,94' },
  'CoWorkv32':   { color: 'var(--blue)',   hex: '#60a5fa', rgb: '96,165,250' },
  'trajecktory': { color: 'var(--accent)', hex: '#a78bfa', rgb: '167,139,250' },
};

const STALE_DAYS = 14;

// ─── Helpers ───────────────────────────────────────────────────────────────
const daysAgo = (iso) => {
  if (!iso) return 0;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
};
const fmtScore = (s) => s == null ? 'N/A' : s.toFixed(1);
const scoreBucket = (s) => s == null ? 'na' : s >= 4.0 ? 'strong' : s >= 3.0 ? 'border' : 'weak';
const scoreColor = (s) => s == null ? 'var(--text-mute)' : s >= 4.0 ? 'var(--green)' : s >= 3.0 ? 'var(--yellow)' : 'var(--red)';

function shortenComp(raw) {
  if (!raw) return '—';
  const nums = (raw.match(/\$[\d,]+/g) || []).map(s => parseInt(s.replace(/[^\d]/g, ''), 10));
  if (nums.length === 0) return raw.length > 22 ? raw.slice(0, 21) + '…' : raw;
  const k = (n) => (n >= 1000 ? '$' + Math.round(n / 1000) + 'K' : '$' + n);
  if (nums.length === 1) return k(nums[0]);
  return `${k(nums[0])}-${k(nums[1])}`;
}

// Compact comp display for tables: a single midpoint dollar amount when comp
// is disclosed, "Not Stated" when it isn't. Reads the parsed `salary` field
// (midpoint in $K) populated at app load time by window.parseComp.
function formatCompMidpoint(a) {
  if (a.salary == null || a.salary <= 0) return 'Not Stated';
  return '$' + (a.salary * 1000).toLocaleString('en-US');
}

function relAge(days) {
  if (days <= 0) return 'today';
  if (days === 1) return '1d';
  if (days < 14) return days + 'd';
  if (days < 60) return Math.round(days / 7) + 'w';
  return Math.round(days / 30) + 'mo';
}

function monogram(name) {
  const clean = (name || '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (!parts.length) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// Live `resume` field can be: a known engine name ("CareerOps", "trajecktory"),
// a filename ("Jane_Doe_Resume_Acme_06-07-2026.docx"), or empty.
// Returns whatever identifier is most useful for display. Falls back to the
// raw string for unrecognized values (so new engines populate without code
// changes); only `null` for truly missing data.
function engineOf(resume) {
  if (!resume) return null;
  const cleaned = String(resume).trim();
  if (!cleaned || cleaned === '—' || cleaned === '-') return null;
  if (ENGINE_META[cleaned]) return cleaned; // known engine
  // Filenames map to the default generator
  if (/\.docx$/i.test(cleaned)) return 'CareerOps';
  // Unknown but non-empty: render the raw value (EnginePill grey-falls-back)
  return cleaned;
}

// ─── Icons ─────────────────────────────────────────────────────────────────
// Canonical icon paths live in shared.jsx (window.ICON). Local PI alias kept
// for the existing call sites that read PI.foo.
const PI = window.ICON;

function PIcon({ d, size = 16, stroke = 1.6, style, fill = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24"
      fill={fill ? 'currentColor' : 'none'}
      stroke={fill ? 'none' : 'currentColor'}
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d={d} />
    </svg>
  );
}

// ─── Primitives ────────────────────────────────────────────────────────────
// `provisional` marks a Haiku triage score: dashed border, lower opacity, and a
// "~" prefix so a triage 4.2 never reads like a full Sonnet 4.2.
function ScoreChip({ score, provisional = false }) {
  const b = scoreBucket(score);
  if (b === 'na') return <span className="score-chip na">N/A</span>;
  const c = scoreColor(score);
  const rgb = b === 'strong' ? '34,197,94' : b === 'border' ? '234,179,8' : '239,68,68';
  return (
    <span className="score-chip"
      title={provisional ? 'Provisional Haiku triage score. Run Deep Dive for the full evaluation' : undefined}
      style={{
        color: c, borderColor: `rgba(${rgb},${provisional ? 0.5 : 0.42})`, background: `rgba(${rgb},${provisional ? 0.06 : 0.12})`,
        borderStyle: provisional ? 'dashed' : 'solid', opacity: provisional ? 0.9 : 1,
      }}>{provisional ? '~' : ''}{score.toFixed(1)}</span>
  );
}

function StatusBadge({ status, size = 'md' }) {
  const m = STATUS_MAP[status] || { hex: '#5d5d66', rgb: '93,93,102', id: status, color: 'var(--text-mute)' };
  const sm = size === 'sm';
  return (
    <span className="status-badge" style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontFamily: 'var(--mono)', fontWeight: 500, letterSpacing: '0.03em',
      border: '1px solid', borderRadius: 4, whiteSpace: 'nowrap',
      color: m.color, borderColor: `rgba(${m.rgb},0.42)`, background: `rgba(${m.rgb},0.12)`,
      fontSize: sm ? 9.5 : 10.5, padding: sm ? '2px 8px' : '3px 9px',
    }}>
      <span className="sb-dot" style={{
        width: 6, height: 6, borderRadius: 999, background: m.color,
        boxShadow: `0 0 6px ${m.color}`,
      }} />
      {status}
    </span>
  );
}

function SourcePill({ source }) {
  const s = SOURCE[source] || { short: source || '—', color: 'var(--text-dim)', rgb: '139,139,148' };
  return (
    <span className="src-pill" style={{ color: s.color, borderColor: `rgba(${s.rgb},0.38)`, background: `rgba(${s.rgb},0.1)` }}>
      <span className="sp-dot" style={{ background: s.color }} />
      {s.short}
    </span>
  );
}

function EnginePill({ engine }) {
  if (!engine) return <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>;
  const e = ENGINE_META[engine] || { color: 'var(--text-dim)', rgb: '139,139,148' };
  return (
    <span className="src-pill" style={{ color: e.color, borderColor: `rgba(${e.rgb},0.38)`, background: `rgba(${e.rgb},0.1)` }}>
      <span className="sp-dot" style={{ background: e.color }} />
      {engine}
    </span>
  );
}

function SitBadge({ days, stale }) {
  const cls = stale ? 'danger' : days > 7 ? 'warn' : '';
  return <span className={'sit-badge ' + cls}>{days}d</span>;
}

function Kpi({ k, v, sub, icon, color }) {
  return (
    <div className="kpi">
      {icon && <span className="ico"><PIcon d={icon} size={15} /></span>}
      <span className="kpi-label">{k}</span>
      <span className="kpi-value" style={color ? { color } : null}>{v}</span>
      {sub && <span className="kpi-delta">{sub}</span>}
    </div>
  );
}

// ─── Overview sub-tab ──────────────────────────────────────────────────────
function OverviewKpis({ apps, isStale = () => false }) {
  const inFlight = apps.filter(a => ['Responded', 'Offer'].includes(a.status) || window.isInterviewStage(a.status)).length;
  const scored = apps.filter(a => a.score != null);
  const avg = scored.length ? (scored.reduce((s, a) => s + a.score, 0) / scored.length).toFixed(2) : '—';
  const strong = scored.filter(a => a.score >= 4.0).length;
  const stale = apps.filter(a => isStale(a)).length;
  const interviews = apps.filter(a => window.isInterviewStage(a.status)).length;
  return (
    <div className="grid cols-4" style={{ marginBottom: 16 }}>
      <Kpi k="Active Roles" v={apps.length} sub={`${inFlight} in flight · ${interviews} interviewing`} icon={PI.layers} color="var(--accent-2)" />
      <Kpi k="Strong Fits" v={strong} sub={`score ≥ 4.0 · avg ${avg}`} icon={PI.star} />
      <Kpi k="Interviewing" v={interviews} sub="active loops in progress" icon={PI.briefcase} color="var(--orange)" />
      <Kpi k="Stale" v={stale} sub="per Follow-Ups engine" icon={PI.clock} color={stale ? 'var(--red)' : 'var(--text)'} />
    </div>
  );
}

function NeedsAttention({ apps, onOpen, selId, isStale = () => false, staleDays = () => null }) {
  // Stale rows come from the canonical Follow-Ups engine — same data the
  // parent PipelineTab fetched once and now shares with every sub-view.
  const hot = apps.filter(a => a.status === 'Evaluated' && a.score != null && a.score >= 4.0)
    .map(a => ({ a, label: 'Hot lead, apply', icon: PI.zap, color: 'var(--accent)' }));
  const stale = apps.filter(a => isStale(a))
    .sort((x, y) => (staleDays(y) || 0) - (staleDays(x) || 0))
    .map(a => ({ a, label: `Follow up · ${staleDays(a) ?? daysAgo(a.date)}d silent`, icon: PI.send, color: 'var(--red)' }));
  const intv = apps.filter(a => window.isInterviewStage(a.status))
    .map(a => ({ a, label: 'Interview prep due', icon: PI.briefcase, color: 'var(--orange)' }));
  // Dedupe by app id — a row that's both Interview status AND stale by the
  // Follow-Ups engine would otherwise produce a duplicate-key React warning.
  // Priority order: hot > stale > interview-prep.
  const seen = new Set();
  const queue = [];
  for (const item of [...hot, ...stale, ...intv]) {
    if (seen.has(item.a.id)) continue;
    seen.add(item.a.id);
    queue.push(item);
    if (queue.length >= 7) break;
  }

  return (
    <div className="card padded-lg">
      <div className="card-head">
        <span className="card-title"><span className="dot" />Needs Attention</span>
        <span className="card-meta mono">{queue.length} items</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {queue.length === 0 && <div className="no-data" style={{ padding: '8px 0' }}>Nothing urgent. Pipeline is clear.</div>}
        {queue.map(({ a, label, icon, color }) => (
          <div key={a.id} onClick={() => onOpen(a)}
            style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto auto', gap: 12, alignItems: 'center',
              padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
              background: selId === a.id ? 'var(--accent-bg)' : 'var(--panel-2)',
              border: '1px solid var(--border)' }}>
            <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center',
              background: 'var(--panel)', border: '1px solid var(--border)', color }}>
              <PIcon d={icon} size={14} />
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.company}</div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.role}</div>
            </div>
            <span className="mono" style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>{label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusBadge status={a.status} size="sm" />
              <ScoreChip score={a.score} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FunnelSnapshot({ apps }) {
  const counts = STATUS.map(s => ({ s, n: apps.filter(a => a.status === s.id).length }));
  const max = Math.max(...counts.map(c => c.n), 1);
  return (
    <div className="card padded-lg">
      <div className="card-head">
        <span className="card-title"><span className="dot" />Funnel Snapshot</span>
        <span className="card-meta mono">active stages</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginTop: 2 }}>
        {counts.map(({ s, n }) => (
          <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '92px 1fr 34px', gap: 11, alignItems: 'center' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 7 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: s.color }} />{s.id}
            </span>
            <div style={{ height: 10, borderRadius: 99, background: 'var(--panel-2)', overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.max((n / max) * 100, n ? 6 : 0)}%`, background: s.color, opacity: 0.85, borderRadius: 99 }} />
            </div>
            <span className="mono" style={{ fontSize: 12, textAlign: 'right', color: n ? 'var(--text)' : 'var(--text-mute)' }}>{n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Pipeline → Overview is the dashboard home: it reuses the self-contained
// window.OverviewTab (greeting, quote, KPIs, charts, Pending Roles) but wires it
// to the Pipeline drawer (onOpen) and the app-level status handler (onAction).
// `apps` is the FULL tracker array — OverviewTab's funnel/score/activity span
// every entry, not just active ones.
function OverviewView({ apps, onOpen, onAction, search }) {
  return (
    <div className="fade-up">
      <window.OverviewTab apps={apps} onOpen={onOpen} onAction={onAction} search={search} />
    </div>
  );
}

// ─── Filter toolbar (shared by Board + Table) ──────────────────────────────
const ARCHETYPES = ['RevOps', 'SalesOps', 'Analytics', 'BizDev', 'SalesDev', 'Strategy', 'Unclassified'];

function applyFilters(apps, filters, search) {
  return apps.filter(a => {
    if (filters.statuses.length && !filters.statuses.includes(a.status)) return false;
    if (filters.archetype && a.archetype !== filters.archetype) return false;
    if (filters.scoreMin && (a.score == null || a.score < filters.scoreMin)) return false;
    if (search && search.trim()) {
      const q = search.toLowerCase();
      const hay = `${a.company} ${a.role} ${a.status} ${a.archetype} ${a.sector || ''} ${a.source || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function FilterBar({ apps, filtered, filters, setFilters, search, setSearch, right }) {
  const toggleStatus = (s) => setFilters(f => ({ ...f, statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s] }));
  const active = filters.statuses.length || filters.archetype || filters.scoreMin || (search && search.trim());
  const scoreSteps = [0, 3.0, 3.5, 4.0, 4.5];
  return (
    <div className="pl-toolbar">
      <div className="tb-row">
        <div className="statline">
          {STATUS.map(s => {
            const n = apps.filter(a => a.status === s.id).length;
            const on = filters.statuses.includes(s.id);
            return (
              <button key={s.id} className={'stat-chip' + (on ? ' on' : '') + (n === 0 ? ' zero' : '')} onClick={() => toggleStatus(s.id)}>
                <span className="sc-dot" style={{ background: s.color, boxShadow: n ? `0 0 6px ${s.color}` : 'none' }} />
                {s.id}<span className="sc-n">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="tb-row">
        <select className="sel" value={filters.archetype} onChange={(e) => setFilters(f => ({ ...f, archetype: e.target.value }))}>
          <option value="">All archetypes</option>
          {ARCHETYPES.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="score-seg" title="Minimum score">
          {scoreSteps.map(s => (
            <button key={s} className={filters.scoreMin === s ? 'on' : ''} onClick={() => setFilters(f => ({ ...f, scoreMin: s }))}>
              {s === 0 ? 'any' : '≥' + s.toFixed(1)}
            </button>
          ))}
        </div>
        {active ? (
          <button className="btn ghost sm" onClick={() => setFilters({ statuses: [], archetype: '', scoreMin: 0 })}>
            <PIcon d={PI.x} size={12} /> Clear
          </button>
        ) : null}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="pl-count">{filtered.length} of {apps.length}</span>
          {right}
        </div>
      </div>
    </div>
  );
}

// ─── Triage (Option B virtual rows) ─────────────────────────────────────────
// Triage results live in their own scratch store (data/triage-results.tsv), not
// applications.md. We surface them as provisional rows in the Table + All views
// so a scanned-but-unevaluated role is visible where users look, without
// polluting the tracker or analytics.
//
// THIS FUNCTION DOES NOT DEDUP. It used to, with its own URL normalizer, and
// that was the bug: the server, this view, and the workflow sidebar each had a
// different idea of what "same posting" meant, so the same triage results
// rendered a different count in each place, and none of them was
// right. The one that got away most often was a URL ending in /application,
// which this file stripped the query from but not the trailing segment.
//
// /api/triage/results now returns only actionable cards, already filtered
// against the tracker by lib/identity.mjs (canonical URL, with a role fallback
// for tracker rows that have no resolvable URL). Client-side esbuild runs with
// bundle:false, so this file cannot import that module — which is precisely why
// it must not re-implement it. The server decides; this renders.
function buildTriageRows(cards) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = [];
  for (const c of (cards || [])) {
    if (!c || !c.url) continue;
    rows.push({
      id: 'tri-' + c.url, _triage: true,
      date: c.date || today, company: c.company, role: c.title,
      archetype: '—', score: c.score, status: 'Triage', source: null,
      url: c.url, rationale: c.rationale,
      report: null, resume: null, compStated: null, salary: null,
      sector: '', sectorRaw: '', legitimacy: null, target: null, size: null,
    });
  }
  return rows;
}

// Inline actions for a provisional triage row: run the full Sonnet deep dive
// (auto-promotes to a real Evaluated row), open the JD, or dismiss ("not a
// match"). The wrapper stops click propagation so the row's own click never fires.
function TriageRowActions({ row, job, onDeep, onDismiss }) {
  const s = job && job.status;
  if (s === 'running') {
    return <div className="row" style={{ gap: 6, marginTop: 4 }} onClick={e => e.stopPropagation()}>
      <span className="mono dim" style={{ fontSize: 10 }}>⧖ deep dive running…</span>
    </div>;
  }
  if (s === 'done') {
    return <div className="row" style={{ gap: 6, marginTop: 4 }} onClick={e => e.stopPropagation()}>
      <span className="mono" style={{ fontSize: 10, color: 'var(--green)' }}>✓ promoted to a full evaluation</span>
    </div>;
  }
  return (
    <div className="row" style={{ gap: 6, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
      <button className="btn sm" style={{ padding: '2px 8px', fontSize: 10.5 }}
        title="Run the full Sonnet deep evaluation and add it to your pipeline" onClick={() => onDeep(row)}>
        <PIcon d={PI.zap} size={11} /> Deep dive
      </button>
      {row.url && /^https?:\/\//i.test(row.url) && (
        <a className="btn ghost sm" style={{ padding: '2px 8px', fontSize: 10.5 }} href={row.url} target="_blank" rel="noreferrer"
          onClick={e => e.stopPropagation()}>open JD <PIcon d={PI.arrowR} size={10} /></a>
      )}
      <button className="btn ghost sm" style={{ padding: '2px 7px', fontSize: 10.5 }}
        title="Not a match. Dismiss (it won't come back on the next scan)" onClick={() => onDismiss(row)}>✕ dismiss</button>
      {s === 'error' && <span className="mono" style={{ fontSize: 10, color: 'var(--red)' }} title={job.error}>failed, retry</span>}
    </div>
  );
}

// ─── Table view ────────────────────────────────────────────────────────────
function TableView({ apps, filtered, filters, setFilters, search, setSearch, onOpen, selId, onExport, isStale = () => false, staleDays = () => null, triage = null }) {
  const [sortKey, setSortKey] = useStateP('date');
  const [sortDir, setSortDir] = useStateP('desc');
  const setSort = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'score' || k === 'date' ? 'desc' : 'asc'); }
  };
  const sorted = useMemoP(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (sortKey === 'score') { av = av == null ? -1 : av; bv = bv == null ? -1 : bv; }
      if (sortKey === 'status') { av = STATUS_MAP[a.status]?.stage ?? 99; bv = STATUS_MAP[b.status]?.stage ?? 99; }
      if (sortKey === 'salary')  { av = a.salary || 0; bv = b.salary || 0; }
      if (sortKey === 'id')      { av = a._triage ? Number.MAX_SAFE_INTEGER : a.id; bv = b._triage ? Number.MAX_SAFE_INTEGER : b.id; }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return (b.score || 0) - (a.score || 0);
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const cols = [
    { k: 'id',        label: '#',         w: 42,  cls: 'id' },
    { k: 'date',      label: 'Date',      w: 90,  cls: 't-date' },
    { k: 'company',   label: 'Company',   w: 190 },
    { k: 'role',      label: 'Role',      w: 210, cls: 't-role' },
    { k: 'archetype', label: 'Archetype', w: 90,  cls: 't-arch' },
    { k: 'salary',    label: 'Comp',      w: 112, cls: 't-comp' },
    { k: 'status',    label: 'Status',    w: 116 },
    { k: 'score',     label: 'Score',     w: 80 },
    { k: 'source',    label: 'Source',    w: 92 },
  ];

  return (
    <div className="fade-up card padded-lg">
      <div className="card-head">
        <span className="card-title">Active Roles</span>
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <span className="card-meta mono">{sorted.length} of {apps.length} item{sorted.length === 1 ? '' : 's'}</span>
          {onExport && <button className="btn sm" onClick={onExport}><PIcon d={PI.download} size={13} /> Export CSV</button>}
        </div>
      </div>
      <FilterBar apps={apps} filtered={filtered} filters={filters} setFilters={setFilters} search={search} setSearch={setSearch} />
      <div className="tbl-wrap"
        style={{ maxHeight: 'calc(100vh - 360px)', border: 'none', borderRadius: 0, background: 'transparent', marginTop: 8 }}>
        <table className="tbl pl-tbl">
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? 'sorted' : ''} onClick={() => setSort(c.k)}>
                  {c.label}<span className="sort-ind">{sortKey === c.k ? (sortDir === 'asc' ? '↑' : '↓') : '·'}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={cols.length}><div className="no-data" style={{ padding: 40, textAlign: 'center' }}>No matches. Try clearing filters.</div></td></tr>
            )}
            {sorted.map(a => {
              const sit = daysAgo(a.date);
              const stale = isStale(a);
              const gap = (a.salary || 0) - (a.target || 0);
              return (
                <tr key={a.id} className={(selId === a.id ? 'selected ' : '') + (stale ? 'stale' : '')}
                  style={a._triage ? { cursor: 'default', background: 'rgba(148,163,184,0.05)' } : undefined}
                  onClick={() => onOpen(a)}>
                  <td className="id">{a._triage ? '—' : String(a.id).padStart(3, '0')}</td>
                  <td className="t-date">{a.date?.slice(5)}<span className="age">{relAge(sit)}</span></td>
                  <td className="t-co-cell">
                    <div className="co-cell">
                      <span className="co-name">{a.company}</span>
                      {stale && (
                        <span className="stale-tag" title="Flagged by Follow-Ups engine, overdue for a nudge">
                          ↻ {staleDays(a) ?? sit}d overdue
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="t-role">
                    {a.role}
                    {a._triage && (
                      <>
                        <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.04em', color: 'var(--text-mute)', marginTop: 2, textTransform: 'uppercase' }}>initial pass · Haiku triage</div>
                        {a.rationale && <div className="dim" style={{ fontSize: 10.5, marginTop: 2, whiteSpace: 'normal', lineHeight: 1.35 }}>{a.rationale}</div>}
                        {triage && <TriageRowActions row={a} job={triage.deepJobs[a.id]} onDeep={triage.onDeep} onDismiss={triage.onDismiss} />}
                      </>
                    )}
                  </td>
                  <td className="t-arch">{a.archetype}</td>
                  <td className="t-comp" title={a.compStated || 'Not Stated'}>
                    {formatCompMidpoint(a)}
                  </td>
                  <td><StatusBadge status={a.status} /></td>
                  <td><ScoreChip score={a.score} provisional={a._triage} /></td>
                  <td><SourcePill source={a.source} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Analytics view ────────────────────────────────────────────────────────
function Insight({ children, kind }) {
  const ic = kind === 'warn' ? PI.flag : kind === 'good' ? PI.star : PI.zap;
  return (
    <>
      <div className="divider" />
      <div className={'insight' + (kind === 'warn' ? ' warn' : '')}>
        <span className="ic"><PIcon d={ic} size={15} /></span>
        <span className="tx">{children}</span>
      </div>
    </>
  );
}

// Comp Positioning visual — four-band stacked bar driven by user's
// walk-away / target-floor / target-ceiling thresholds (from Tweaks).
function CompPositioningCard(props) {
  const { apps, withComp, belowWalk, stretch, inTarget, aboveTgt, avgComp, inOrAbovePct, walkAway, targetLow, targetHigh } = props;
  const bands = [
    { n: belowWalk.length, color: 'var(--red)',    label: 'walk-away' },
    { n: stretch.length,   color: 'var(--yellow)', label: 'stretch' },
    { n: inTarget.length,  color: 'var(--green)',  label: 'on target' },
    { n: aboveTgt.length,  color: 'var(--accent)', label: 'above target' },
  ];
  const dollar = (n) => '$' + n + 'K';
  return (
    <div className="card padded-lg">
      <div className="card-head">
        <span className="card-title"><span className="dot" />Comp Positioning</span>
        <span className="card-meta mono">{withComp.length} of {apps.length} active have stated comp</span>
      </div>
      {withComp.length === 0 ? (
        <div className="empty" style={{ padding: '16px 4px', color: 'var(--text-mute)', fontSize: 12.5 }}>
          No active roles have JD-stated comp yet. Roles without disclosed salary aren't plotted.
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden', background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
            {bands.filter(b => b.n > 0).map((b, i) => (
              <div key={i} title={b.label + ': ' + b.n}
                   style={{ flex: b.n, background: b.color, opacity: 0.85, display: 'grid', placeItems: 'center',
                            color: 'var(--bg)', fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700 }}>
                {b.n}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginTop: 8, fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '.04em' }}>
            <div style={{ color: 'var(--red)' }}>
              {'< ' + dollar(walkAway)}
              <div style={{ color: 'var(--text-mute)', fontSize: 9.5, marginTop: 2 }}>walk-away</div>
            </div>
            <div style={{ color: 'var(--yellow)' }}>
              {dollar(walkAway) + '-' + dollar(targetLow)}
              <div style={{ color: 'var(--text-mute)', fontSize: 9.5, marginTop: 2 }}>stretch</div>
            </div>
            <div style={{ color: 'var(--green)' }}>
              {dollar(targetLow) + '-' + dollar(targetHigh)}
              <div style={{ color: 'var(--text-mute)', fontSize: 9.5, marginTop: 2 }}>target band</div>
            </div>
            <div style={{ color: 'var(--accent)' }}>
              {'> ' + dollar(targetHigh)}
              <div style={{ color: 'var(--text-mute)', fontSize: 9.5, marginTop: 2 }}>above target</div>
            </div>
          </div>
          <Insight kind={inOrAbovePct < 40 ? 'warn' : null}>
            <b>{inOrAbovePct + '%'}</b>{' of active roles sit in or above your target band (' + dollar(targetLow) + '-' + dollar(targetHigh) + '). Avg posted comp '}<b>{dollar(avgComp)}</b>{'.' + (belowWalk.length > 0 ? ' ' + belowWalk.length + ' role' + (belowWalk.length === 1 ? '' : 's') + ' below your walk-away.' : '')}
          </Insight>
        </div>
      )}
    </div>
  );
}

function AnalyticsView({ apps, allApps, compTweaks, onOpen, isStale = () => false }) {
  // Neutral placeholder fallbacks — real comp targets come from compTweaks
  // (Tweaks panel) and the gitignored config/profile.yml. Never hardcode a
  // real walk-away or target band here; this file ships to every user.
  const walkAway = compTweaks?.walkAway ?? 90;
  const targetLow = compTweaks?.targetLow ?? 100;
  const targetHigh = compTweaks?.targetHigh ?? 140;
  // Furthest rung ever reached, not the live status. STATUS_MAP has no key for
  // Rejected, so the old local rule returned -1 for every closed row: the "Adv"
  // column and the archetype bars counted only the rows still live on the
  // funnel, silently dropping every closed row that had already advanced.
  // window.appReached reads the server-stamped `reached` field.
  const STAGE_AT = window.FUNNEL_ORDER;
  const reached = (a, s) => window.appReached(a, STAGE_AT[s]);

  // The full tracker. Every historical measure on this view (rates, source
  // effectiveness, archetype conversion) runs over this rather than the active
  // subset the snapshot tiles use. `apps` is activeApps; `allApps` is everything.
  const ratePool = allApps || apps;

  // Time-to-rejection: days from application to the date a row was marked
  // Rejected, served from the status-event sidecar (fills in over time).
  const [rejTiming, setRejTiming] = useStateP(null);
  useEffectP(() => {
    let alive = true;
    fetch('/api/insights/rejection-timing')
      .then(r => r.json())
      .then(d => { if (alive) setRejTiming(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Both panels answer historical questions — "which channel produces roles that
  // advance" and "which archetype converts" — so they run over the whole tracker,
  // not the active subset. Scoped to active roles the advance counts collapse to
  // almost nothing across every channel, because advancing usually ends in a
  // rejection and a rejection leaves the active pool.
  const srcKeys = Object.keys(SOURCE);
  const bySource = srcKeys.map(k => {
    const items = ratePool.filter(a => a.source === k);
    const scored = items.filter(a => a.score != null);
    const avg = scored.length ? scored.reduce((s, a) => s + a.score, 0) / scored.length : 0;
    const strong = items.filter(a => a.score != null && a.score >= 4.0).length;
    const advanced = items.filter(a => reached(a, 2)).length;
    const strongRate = items.length ? Math.round((strong / items.length) * 100) : 0;
    return { k, meta: SOURCE[k], n: items.length, avg, strong, strongRate, advanced };
  }).filter(s => s.n > 0).sort((a, b) => b.avg - a.avg);
  const bestSource = [...bySource].sort((a, b) => b.strongRate - a.strongRate)[0];

  const byArch = ARCHETYPES.map(k => {
    const items = ratePool.filter(a => a.archetype === k);
    const applied = items.filter(a => reached(a, 1)).length;
    const interviewed = items.filter(a => reached(a, 3)).length;
    const conv = applied ? Math.round((interviewed / applied) * 100) : 0;
    return { k, n: items.length, applied, interviewed, conv };
  }).filter(a => a.n > 0).sort((a, b) => b.conv - a.conv);
  // Needs a real sample before it gets to recommend anything. At the old >= 2 gate
  // a single interview off two applications became "this archetype converts best,
  // weight your applications toward it". 5 matches the server's own thin-sample
  // floor in insights.mjs.
  const MIN_ARCH_SAMPLE = 5;
  // Never recommend the catch-all: "Unclassified converts best" would be advice
  // to target a gap in the matching rules.
  const bestArch = byArch.find(a => a.applied >= MIN_ARCH_SAMPLE && a.k !== 'Unclassified') || null;

  // Comp positioning: bucket each role's midpoint salary into four bands.
  // walkAway / targetLow / targetHigh come from the Tweaks panel.
  const withComp = apps.filter(a => a.salary != null && a.salary > 0);
  const belowWalk = withComp.filter(a => a.salary < walkAway);
  const stretch  = withComp.filter(a => a.salary >= walkAway && a.salary < targetLow);
  const inTarget = withComp.filter(a => a.salary >= targetLow && a.salary <= targetHigh);
  const aboveTgt = withComp.filter(a => a.salary > targetHigh);
  const avgComp  = withComp.length ? Math.round(withComp.reduce((s, a) => s + a.salary, 0) / withComp.length) : 0;
  const inOrAbovePct = withComp.length ? Math.round(((inTarget.length + aboveTgt.length) / withComp.length) * 100) : 0;

  const vel = STATUS.map(s => {
    const items = apps.filter(a => a.status === s.id);
    const avgAge = items.length ? Math.round(items.reduce((x, a) => x + daysAgo(a.date), 0) / items.length) : 0;
    return { s, avgAge, n: items.length };
  });
  const maxAge = Math.max(...vel.map(v => v.avgAge), 1);
  const bottleneck = [...vel].filter(v => v.n > 0 && v.s.stage < LAST_STAGE).sort((a, b) => b.avgAge - a.avgAge)[0];

  // Rates are ALL-TIME over the full tracker, not the active subset the rest of
  // this view uses. Scoping them to active roles deleted every reply that later
  // became a rejection — which is the outcome the metric most wants to count —
  // so the number decayed toward zero as the pipeline aged regardless of how
  // well things were going, reading a fraction of the true rate.
  // window.appReached reads the server-stamped `reached` rung (live status maxed
  // with the event log and the [reached:] tag), the same engine the Overview uses.
  const appliedAll = ratePool.filter(a => window.appReached(a, 'Applied')).length;
  const respAll = ratePool.filter(a => window.appReached(a, 'Responded')).length;
  const intvAll = ratePool.filter(a => window.appReached(a, 'Phone Screen')).length;
  const respRate = appliedAll ? Math.round((respAll / appliedAll) * 100) : 0;
  const intvRate = appliedAll ? Math.round((intvAll / appliedAll) * 100) : 0;

  return (
    <div className="fade-up">
      <div className="pl-head">
        <div>
          <h1>Pipeline Analytics</h1>
          <div className="sub"><span className="refresh-dot" /><span>what's working & where to focus across <b>{apps.length}</b> active roles</span></div>
        </div>
      </div>

      <OverviewKpis apps={apps} isStale={isStale} />

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        {/* Labelled "all time" because every other tile on this view is scoped to
            the active roles named in the heading above. */}
        <Kpi k="Response Rate" v={respRate + '%'} sub={`${respAll} of ${appliedAll} applied · all time`} icon={PI.msg} />
        <Kpi k="Interview Rate" v={intvRate + '%'} sub={`${intvAll} reached a screen · all time`} icon={PI.briefcase} />
        <Kpi
          k="Avg Days to Rejection"
          v={rejTiming && rejTiming.n > 0 ? rejTiming.avgDays + 'd' : '—'}
          sub={rejTiming && rejTiming.n > 0
            ? `median ${rejTiming.medianDays}d · n=${rejTiming.n}${rejTiming.excluded ? ` · ${rejTiming.excluded} excluded (date conflict)` : ''}`
            : 'fills as you mark rejections'}
          icon={PI.clock}
        />
        <Kpi k="On / Above Target" v={inOrAbovePct + '%'} sub={`avg posted comp $${avgComp}K`} color={inOrAbovePct < 40 ? 'var(--red)' : 'var(--text)'} icon={PI.trend} />
      </div>

      <div className="grid cols-2" style={{ marginBottom: 14 }}>
        <div className="card padded-lg">
          <div className="card-head"><span className="card-title"><span className="dot" />Source Effectiveness</span><span className="card-meta mono">quality by channel</span></div>
          <table className="atbl" style={{ marginTop: 2 }}>
            <thead><tr><th>Source</th><th>Roles</th><th>Avg</th><th>Strong</th><th>Adv</th></tr></thead>
            <tbody>
              {bySource.map(s => (
                <tr key={s.k} className={bestSource && s.k === bestSource.k ? 'top' : ''}>
                  <td><span className="s-name"><span className="d" style={{ background: s.meta.color }} />{s.k}</span></td>
                  <td>{s.n}</td>
                  <td>{s.avg.toFixed(1)}</td>
                  <td className={s.strongRate >= 60 ? 'pos' : ''}>{s.strongRate}%</td>
                  <td className="mut">{s.advanced}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {bestSource && (
            <Insight>
              <b>{bestSource.k}</b> surfaces the highest-quality roles ({bestSource.strongRate}% score ≥4.0). Spend more sourcing time here.
            </Insight>
          )}
        </div>

        <div className="card padded-lg">
          <div className="card-head"><span className="card-title"><span className="dot" />Archetype Conversion</span><span className="card-meta mono">apply → interview</span></div>
          <div className="afun" style={{ marginTop: 2 }}>
            {byArch.map(a => (
              <div className="afun-row" key={a.k}>
                <span className="afun-lbl"><span className="d" />{a.k}</span>
                <div className="afun-track">
                  <div className="afun-applied" />
                  <div className="afun-intv" style={{ width: `${Math.max(a.conv, 4)}%` }}>{a.conv >= 16 ? a.conv + '%' : ''}</div>
                </div>
                <span className="afun-cap">{a.conv < 16 ? <b>{a.conv}% · </b> : null}<b>{a.interviewed}</b>/{a.applied} to intv</span>
              </div>
            ))}
          </div>
          {bestArch && (
            <Insight kind="good">
              <b>{bestArch.k}</b> roles convert best: {bestArch.conv}% reach interview. Weight your daily applications toward {bestArch.k}.
            </Insight>
          )}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <CompPositioningCard
          apps={apps}
          withComp={withComp}
          belowWalk={belowWalk}
          stretch={stretch}
          inTarget={inTarget}
          aboveTgt={aboveTgt}
          avgComp={avgComp}
          inOrAbovePct={inOrAbovePct}
          walkAway={walkAway}
          targetLow={targetLow}
          targetHigh={targetHigh}
        />
      </div>

      <div className="card padded-lg">
        <div className="card-head"><span className="card-title"><span className="dot" />Time in Stage</span><span className="card-meta mono">avg age · bottleneck finder</span></div>
        <div className="pl-histo" style={{ marginTop: 4 }}>
          {vel.map(({ s, avgAge, n }) => (
            <div className="pl-histo-col" key={s.id}>
              <div className="pl-histo-bar" style={{ height: `${n ? Math.max((avgAge / maxAge) * 100, 4) : 0}%`, background: s.color, opacity: 0.85 }}>
                <span className="hn">{n ? avgAge + 'd' : '—'}</span>
              </div>
              <span className="pl-histo-x" style={{ color: s.color }}>{s.id}</span>
            </div>
          ))}
        </div>
        <Insight kind="warn">
          {bottleneck ? <>Roles pile up longest in <b>{bottleneck.s.id}</b> (avg {bottleneck.avgAge}d). That's your bottleneck: {bottleneck.s.id === 'Applied' ? 'send follow-up nudges on anything past 14 days' : bottleneck.s.id === 'Evaluated' ? 'decide and apply on the oldest sitting reports today' : 'chase the stalled threads to keep momentum'}.</> : 'Pipeline is moving cleanly. No stage is aging out.'}
        </Insight>
      </div>

      {/* Pipeline Flow Sankey — moved from main Analytics tab per user request */}
      <div className="card padded-lg" style={{ marginTop: 14 }}>
        <div className="card-head">
          <span className="card-title">Pipeline Flow · archetype → offer</span>
          <span className="card-meta mono">how every role moved through the funnel, by archetype</span>
        </div>
        {window.Sankey ? <window.Sankey apps={allApps || apps} /> : <div className="dim" style={{ fontSize: 12, padding: 12 }}>Sankey unavailable.</div>}
      </div>

      {/* Interview stage funnel — per-round reach + rejection-by-stage attribution */}
      <div className="card padded-lg" style={{ marginTop: 14 }}>
        <div className="card-head">
          <span className="card-title">Interview Stage Funnel · where we lose them</span>
          <span className="card-meta mono">reached per round + which round each rejection exited at</span>
        </div>
        {window.StageFunnel ? <window.StageFunnel /> : <div className="dim" style={{ fontSize: 12, padding: 12 }}>Stage funnel unavailable.</div>}
      </div>
    </div>
  );
}

// ─── CSV export ────────────────────────────────────────────────────────────
function exportCSV(rows) {
  const cols = ['id', 'date', 'company', 'role', 'archetype', 'score', 'status', 'compStated', 'salary', 'target', 'sector', 'source', 'resume'];
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  rows.filter(a => !a._triage).forEach(a => lines.push(cols.map(c => esc(a[c])).join(','))); // skip provisional triage ghosts
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `pipeline_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ─── Sub-tabs ──────────────────────────────────────────────────────────────
const PL_SUBTABS = [
  { id: 'overview',  label: 'Overview',  icon: PI.pulse },
  { id: 'table',     label: 'Active',    icon: PI.list },
  { id: 'all',       label: 'All',       icon: PI.list },
  { id: 'analytics', label: 'Analytics', icon: PI.chart },
];

// ─── All Entries sub-tab ───────────────────────────────────────────────────
// Unfiltered view of every row across every status, including closed-state
// (SKIP / Rejected / Closed / Discarded / Not a Fit). Mirrors the legacy
// /tracker tab's filter UI and table, but routes opens through Pipeline's
// local drawer so users can Reopen a row back to Evaluated in one click.
const ALL_ENTRIES_STATUSES = [
  'Evaluated', 'Applied', 'Responded', ...window.INTERVIEW_STAGES, 'Offer',
  'Rejected', 'Discarded', 'SKIP', 'Closed', 'Not a Fit', 'No Response',
];
function AllEntriesView({ apps, onOpen, search, isStale = () => false, staleDays = () => null, triage = null }) {
  const [sortKey, setSortKey] = useStateP('date');
  const [sortDir, setSortDir] = useStateP('desc');
  const [filters, setFilters] = useStateP({ statuses: [], archetypes: [], scoreMin: 0 });

  const filtered = useMemoP(() => {
    return apps.filter(a => {
      if (filters.statuses.length && !filters.statuses.includes(a.status)) return false;
      if (filters.archetypes.length && !filters.archetypes.includes(a.archetype)) return false;
      if (filters.scoreMin && a.score < filters.scoreMin) return false;
      if (search) {
        const ql = search.toLowerCase();
        const hay = `${a.company} ${a.role} ${a.status} ${a.archetype} ${a.sector}`.toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      return true;
    });
  }, [apps, filters, search]);

  const sorted = useMemoP(() => {
    const arr = [...filtered];
    const dir = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'id') {
        cmp = (a._triage ? Number.MAX_SAFE_INTEGER : (a.id || 0)) - (b._triage ? Number.MAX_SAFE_INTEGER : (b.id || 0));
      } else if (sortKey === 'score') {
        const as = a.score != null ? a.score : -1;
        const bs = b.score != null ? b.score : -1;
        cmp = as - bs;
      } else if (sortKey === 'date') {
        cmp = (a.date || '').localeCompare(b.date || '');
        if (cmp === 0) {
          const as = a.score != null ? a.score : -1;
          const bs = b.score != null ? b.score : -1;
          return bs - as;
        }
      } else {
        const av = (a[sortKey] || '').toString().toLowerCase();
        const bv = (b[sortKey] || '').toString().toLowerCase();
        cmp = av.localeCompare(bv);
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleStatus = (s) => setFilters(f => ({ ...f, statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s] }));
  const toggleArch = (a) => setFilters(f => ({ ...f, archetypes: f.archetypes.includes(a) ? f.archetypes.filter(x => x !== a) : [...f.archetypes, a] }));
  const setSort = (k) => {
    if (sortKey === k) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'score' || k === 'date' ? 'desc' : 'asc'); }
  };

  const breakdown = useMemoP(() => {
    return ALL_ENTRIES_STATUSES
      .map(s => ({ s, n: apps.filter(a => a.status === s).length, meta: window.STATUS_META[s] }))
      .filter(x => x.n > 0 && x.meta);
  }, [apps]);

  const archetypes = useMemoP(() => window.ARCHETYPES || [], []);

  return (
    <div className="fade-up card padded-lg">
      <div className="card-head">
        <span className="card-title">All Entries</span>
        <span className="card-meta mono">{sorted.length} of {apps.length} item{sorted.length === 1 ? '' : 's'}</span>
      </div>

      {/* Status breakdown — flat row, no inner card */}
      <div className="row" style={{ flexWrap: 'wrap', gap: 14, marginBottom: 10 }}>
        {breakdown.map(({ s, n, meta }) => (
          <span key={s} className="row mono" style={{ gap: 6, fontSize: 11.5, color: 'var(--text-dim)', cursor: 'pointer' }} onClick={() => toggleStatus(s)}>
            <span style={{ width: 7, height: 7, borderRadius: 50, background: meta.color, display: 'inline-block', flexShrink: 0 }}></span>
            {s}
            <span style={{ color: filters.statuses.includes(s) ? 'var(--accent)' : 'var(--text)' }}>{n}</span>
          </span>
        ))}
        <span className="mono dim" style={{ fontSize: 11, marginLeft: 'auto' }}>click to filter</span>
      </div>

      {/* Filter chips — flat, no inner card */}
      <div className="col" style={{ gap: 8, marginBottom: 10 }}>
        <div className="filterbar">
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Status</span>
          {ALL_ENTRIES_STATUSES.map(s => window.STATUS_META[s] && (
            <span key={s} className={`chip ${filters.statuses.includes(s) ? 'on' : ''}`} onClick={() => toggleStatus(s)}>
              <span className="dot" style={{ width: 6, height: 6, borderRadius: 50, background: window.STATUS_META[s].color, display: 'inline-block' }}></span>
              {s}
            </span>
          ))}
        </div>
        <div className="filterbar">
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Archetype</span>
          {archetypes.map(a => (
            <span key={a} className={`chip ${filters.archetypes.includes(a) ? 'on' : ''}`} onClick={() => toggleArch(a)}>{a}</span>
          ))}
        </div>
        <div className="filterbar">
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Score ≥</span>
          {[0, 3.0, 3.5, 4.0, 4.5].map(s => (
            <span key={s} className={`chip ${filters.scoreMin === s ? 'on' : ''}`} onClick={() => setFilters(f => ({ ...f, scoreMin: s }))}>{s === 0 ? 'any' : s.toFixed(1)}</span>
          ))}
          {(filters.statuses.length || filters.archetypes.length || filters.scoreMin) ? (
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setFilters({ statuses: [], archetypes: [], scoreMin: 0 })}>Clear all</button>
          ) : null}
        </div>
      </div>

      <window.PipelineTable rows={sorted} sortKey={sortKey} sortDir={sortDir} setSort={setSort} onOpen={onOpen} isStale={isStale} staleDays={staleDays} triage={triage} flat />
    </div>
  );
}

// ─── Pipeline Drawer (760px) — inline evaluation report ──────────────────
const DRAWER_TABS = [
  { id: 'overview',  label: 'Overview',   icon: PI.pulse },
  { id: 'cv',        label: 'Resume Match',   icon: PI.briefcase },
  { id: 'comp',      label: 'Comp',       icon: PI.trend },
  { id: 'interview', label: 'Interview',  icon: PI.msg },
  { id: 'customize', label: 'Customize',  icon: PI.flag },
  { id: 'legit',     label: 'Legitimacy', icon: PI.check },
  { id: 'posting',   label: 'Posting',    icon: PI.briefcase },
  { id: 'notes',     label: 'Notes',      icon: PI.pen },
  { id: 'contacts',  label: 'Contacts',   icon: PI.users },
  { id: 'followup',  label: 'Follow-up',  icon: PI.send },
];
// The Follow-up tab only makes sense once an application is out the door.
const FOLLOWUP_TAB_STATUSES = ['Applied', 'Responded', ...window.INTERVIEW_STAGES];

// Today in the user's LOCAL timezone. Deliberately not toISOString().slice(0,10),
// which is UTC and rolls over around 5-7pm US time — pre-filling a status change
// with tomorrow's date is exactly the silent wrongness this field exists to fix.
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function PipelineDrawer({ app, onClose, onAction, onStatusChange, isStale = () => false, onFollowupChange = () => {} }) {
  const [tab, setTab] = useStateP('overview');
  const [explainScore, setExplainScore] = useStateP(false);
  // Structured cheat-sheet object from /api/cheatsheets/:id — exactly the
  // shape Claude Design's prototype consumed (PIPE_CHEATS).
  const [cs, setCs] = useStateP(null);
  const [loading, setLoading] = useStateP(false);
  const [starOpen, setStarOpen] = useStateP(0);
  const [customWhich, setCustomWhich] = useStateP('cv');
  const [applyJob, setApplyJob] = useStateP(null);     // { mode, status: 'running'|'error', error? }
  const [applyResult, setApplyResult] = useStateP(null); // completed job data
  const [elapsed, setElapsed] = useStateP(0);
  // Interview/meeting notes — append-only timestamped log from /api/notes/:id
  const [notes, setNotes] = useStateP([]);
  const [noteDraft, setNoteDraft] = useStateP('');
  const [savingNote, setSavingNote] = useStateP(false);
  // Quick "add a to-do for this application" — posts to the Today tab's to-do
  // list with source:'app' so it links back to this company.
  const [todoDraft, setTodoDraft] = useStateP('');
  const [todoDue, setTodoDue] = useStateP('');
  const [todoAdded, setTodoAdded] = useStateP(false);
  // This company's TA contacts (from /api/target-talent/by-company/:company),
  // managed inline via the shared window.ContactPanel.
  const [contacts, setContacts] = useStateP([]);
  const [selContact, setSelContact] = useStateP(null);  // contact id open in the inline panel
  const [findOpen, setFindOpen] = useStateP(false);     // per-company finder open
  // When a status change actually happened — specifically when it was booked or
  // notified, not when it was conducted, and not when it was typed in. Every
  // status event before this field existed recorded the day of the click, so the
  // timing analytics measured data entry rather than the job search.
  const [eventDate, setEventDate] = useStateP(localToday);

  useEffectP(() => {
    setTab('overview'); setStarOpen(0); setCustomWhich('cv');
    setApplyJob(null); setApplyResult(null); setElapsed(0);
    setNotes([]); setNoteDraft('');
    setTodoDraft(''); setTodoDue(''); setTodoAdded(false);
    setContacts([]); setSelContact(null); setFindOpen(false);
    setEventDate(localToday());
  }, [app && app.id]);

  // Load this company's TA contacts when the drawer opens / switches roles.
  const loadContacts = () => {
    if (!app || !app.company) return;
    fetch(`/api/target-talent/by-company/${encodeURIComponent(app.company)}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setContacts(Array.isArray(d) ? d : []))
      .catch(() => setContacts([]));
  };
  useEffectP(() => { loadContacts(); }, [app && app.id]);

  useEffectP(() => {
    if (!applyJob || applyJob.status !== 'running') { setElapsed(0); return; }
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [applyJob && applyJob.status]);

  function startApply(mode) {
    // window.open must fire synchronously inside the click gesture or browsers
    // block it as a popup. Skip for BYO — user has already applied elsewhere.
    if (app && app.url && mode !== 'byo' && mode !== 'cover') window.open(app.url, '_blank');
    setApplyJob({ mode, status: 'running' });
    setApplyResult(null);
    window.tjkMutate(`/api/apply/${app.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, company: app.company }),
    })
      .then(r => r.json())
      .then(({ jobId, error }) => {
        if (!jobId) { setApplyJob({ mode, status: 'error', error: error || 'Failed to start' }); return; }
        const poll = setInterval(() => {
          fetch(`/api/apply/status/${jobId}`)
            .then(r => r.json())
            .then(job => {
              if (job.status === 'done') {
                clearInterval(poll);
                setApplyJob(null);
                setApplyResult({ ...job, mode });
                // Advance status to Applied (parent handles tracker + drawerApp update).
                // Cover-letter runs are not an apply action — leave status untouched.
                if (mode !== 'cover' && onAction) onAction(app, 'already_applied', eventDate);
              } else if (job.status === 'error') {
                clearInterval(poll);
                setApplyJob({ mode, status: 'error', error: job.error || 'Generation failed' });
              }
            })
            .catch(() => { clearInterval(poll); setApplyJob({ mode, status: 'error', error: 'Poll failed' }); });
        }, 2000);
      })
      .catch(err => setApplyJob({ mode, status: 'error', error: err.message }));
  }

  const APPLY_MODES = { apply_manual: 'manual', apply_claude: 'claude', already_applied: 'byo', apply_cover: 'cover' };
  const handleFooterClick = (b) => {
    const mode = APPLY_MODES[b.id];
    if (mode) { startApply(mode); return; }
    if (onAction) onAction(app, b.id, eventDate);
  };

  useEffectP(() => {
    if (!app) return;
    setLoading(true);
    fetch(`/api/cheatsheets/${app.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { setCs(d); setLoading(false); })
      .catch(() => { setCs(null); setLoading(false); });
  }, [app && app.id]);

  // Load this role's note history when the drawer opens / switches roles.
  useEffectP(() => {
    if (!app) return;
    fetch(`/api/notes/${app.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(d => setNotes(Array.isArray(d) ? d : []))
      .catch(() => setNotes([]));
  }, [app && app.id]);

  const saveNote = () => {
    const text = noteDraft.trim();
    if (!text || savingNote) return;
    setSavingNote(true);
    window.tjkMutate(`/api/notes/${app.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { setNotes(Array.isArray(d) ? d : []); setNoteDraft(''); })
      .catch(() => { /* keep draft so nothing is lost */ })
      .finally(() => setSavingNote(false));
  };

  const saveTodo = () => {
    const text = todoDraft.trim();
    if (!text) return;
    window.tjkMutate('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, dueDate: todoDue || null, appId: app.id, company: app.company }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { setTodoDraft(''); setTodoDue(''); setTodoAdded(true); setTimeout(() => setTodoAdded(false), 2600); })
      .catch(() => { /* keep draft so nothing is lost */ });
  };

  const deleteNote = (timestamp) => {
    window.tjkMutate(`/api/notes/${app.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp }),
    })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setNotes(Array.isArray(d) ? d : []))
      .catch(() => {});
  };

  useEffectP(() => {
    if (!app) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app, onClose]);

  if (!app) {
    return (
      <div className="pl-drawer-overlay">
        <div className="drawer-backdrop" onClick={onClose}></div>
        <div className="pl-drawer"></div>
      </div>
    );
  }

  const m = STATUS_MAP[app.status] || { color: 'var(--text-mute)', rgb: '93,93,102', stage: 0 };
  const sit = daysAgo(app.date);
  const stale = isStale(app);
  const engine = engineOf(app.resume);
  const engMeta = engine ? ENGINE_META[engine] : { hex: '#8b8b94', rgb: '139,139,148' };

  // status-aware footer. The primary CTA advances one rung along the funnel
  // (Applied → Responded → Phone Screen → 1st → 2nd → 3rd → 4th → Offer); the
  // button id IS the next canonical status, dispatched via onAction's MAP.
  const st = app.status;
  const stIdx = window.FUNNEL_ORDER.indexOf(st);
  let primary = [];
  if (st === 'Evaluated') {
    primary = [
      { id: 'apply_manual', label: 'Tailor resume', cls: 'primary' },
      { id: 'apply_claude', label: 'Claude Apply', cls: 'claude', spark: true },
      { id: 'already_applied', label: 'Already Applied', check: true },
    ];
  } else if (st === 'Offer') {
    primary = [{ id: 'accept', label: 'Accept Offer', cls: 'success', check: true }];
  } else if (stIdx >= 1 && stIdx < window.FUNNEL_ORDER.length - 1) {
    const next = window.FUNNEL_ORDER[stIdx + 1];
    primary = [{ id: next, label: next === 'Responded' ? 'Mark Responded' : `Move to ${next}`, cls: 'primary', check: true }];
  } else if (['SKIP', 'Rejected', 'Closed', 'Discarded', 'Not a Fit', 'No Response'].includes(st)) {
    primary = [{ id: 'reopen', label: 'Reopen → Evaluated', cls: 'primary', check: true }];
  }
  // Cover letter is an on-demand, decoupled action available while deciding
  // (Evaluated) and right after applying (Applied). It never changes status.
  if (st === 'Evaluated' || st === 'Applied') {
    primary.push({ id: 'apply_cover', label: 'Cover Letter', cls: 'ghost' });
  }
  const closers = st === 'Evaluated'
    ? [{ id: 'SKIP', label: 'Skip' }, { id: 'Not a Fit', label: 'Not a Fit' }, { id: 'Closed', label: 'Closed' }]
    : [{ id: 'Rejected', label: 'Rejected', danger: true }, { id: 'No Response', label: 'No Response' }, { id: 'Not a Fit', label: 'Not a Fit' }, { id: 'Closed', label: 'Closed' }];

  const gap = (app.salary || 0) - (app.target || 0);
  const remoteChip = (cs && cs.remote) || (app.size ? `${app.size}-stage` : null);
  // Real structured fields from /api/cheatsheets/:id when present
  const tldr = cs && cs.tldr;
  const recommendation = cs && cs.recommendation;
  const companyBrief = cs && cs.companyBrief;
  const keywords = (cs && cs.keywords) || [];
  const globalScore = (cs && Array.isArray(cs.globalScore)) ? cs.globalScore : [];
  const cvMatch = (cs && Array.isArray(cs.cvMatch)) ? cs.cvMatch : [];
  const gaps = (cs && Array.isArray(cs.gaps)) ? cs.gaps : [];
  const levelMatch = (cs && cs.levelMatch) || null;
  const sellSenior = (cs && Array.isArray(cs.sellSenior)) ? cs.sellSenior : [];
  const downlevelPlan = cs && cs.downlevelPlan;
  const comp = (cs && cs.comp) || null;
  const customizationCV = (cs && Array.isArray(cs.customizationCV)) ? cs.customizationCV : [];
  const customizationLI = (cs && Array.isArray(cs.customizationLI)) ? cs.customizationLI : [];
  const starStories = (cs && Array.isArray(cs.starStories)) ? cs.starStories : [];
  const leadStory = cs && cs.leadStory;
  const redFlagQs = (cs && Array.isArray(cs.redFlagQs)) ? cs.redFlagQs : [];
  const legitSignals = (cs && Array.isArray(cs.legitimacySignals)) ? cs.legitimacySignals : [];
  const legitConclusion = cs && cs.legitimacyConclusion;
  const sectorRaw = (cs && cs.domain) || app.sectorRaw;

  return (
    <div className="pl-drawer-overlay">
      <div className={'drawer-backdrop' + (app ? ' open' : '')} onClick={onClose}></div>
      <div className={'pl-drawer' + (app ? ' open' : '')}>
        <div className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="row" style={{ gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
              <span className="mono dim" style={{ fontSize: 11 }}>#{String(app.id).padStart(3, '0')}</span>
              <window.StatusPill status={app.status} />
              {app.legitimacy && <span className="legit-pill mono">✓ {app.legitimacy}</span>}
              {stale && <span className="legit-pill mono" style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,0.25)', background: 'rgba(239,68,68,0.12)' }}>stale · {sit}d</span>}
            </div>
            <h3>{app.company}</h3>
            <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{app.role}</div>
            <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              {(cs && cs.remote) && <span className="meta-chip">{cs.remote}</span>}
              {sectorRaw && <span className="meta-chip">{sectorRaw}</span>}
              {(cs && cs.seniority) && <span className="meta-chip">{cs.seniority.split('(')[0].trim()}</span>}
              {app.url && <a className="meta-chip link" href={app.url} target="_blank" rel="noreferrer">JD ↗</a>}
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <PIcon d={PI.x} size={15} />
          </button>
        </div>

        <div className="drawer-body">
          {/* Stage track. The 4th-round rung stays hidden until something reaches
              it (variable loop length) — Advance still reveals it when needed. */}
          {(() => {
            // For a CLOSED row (Rejected / No Response / Discarded / etc.) the live
            // status isn't on the funnel, so reflect the FURTHEST stage reached
            // instead of defaulting to Eval: read the [reached: <round>] tag, else
            // Rejected / No Response imply at least Applied. The drop-off rung is
            // marked red so a glance reads "got to here, then lost", not "Evaluated".
            const isClosed = window.FUNNEL_ORDER.indexOf(app.status) < 0;
            const reachedLabel = window.reachedStage(app);
            let dropStage = -1;
            if (isClosed) {
              if (reachedLabel && STATUS_MAP[reachedLabel]) dropStage = STATUS_MAP[reachedLabel].stage;
              else if (app.status === 'Rejected' || app.status === 'No Response') dropStage = STATUS_MAP['Applied'].stage;
            }
            const fillStage = isClosed ? dropStage : m.stage;
            const dropLabel = (dropStage >= 0 && STATUS[dropStage]) ? STATUS[dropStage].id : null;
            const statusColor = window.STATUS_META[app.status]?.color || m.color;
            const FOURTH = STATUS_MAP['4th Interview'].stage;
            const track = STATUS.filter(s => s.stage !== FOURTH || fillStage >= FOURTH);
            return (
          <div className="ds-section">
            <div className="ds-label"><PIcon d={PI.trend} size={12} /> Pipeline stage <span className="r">{isClosed ? (dropLabel ? `lost at ${dropLabel}` : app.status.toLowerCase()) : `stage ${m.stage + 1}/${STATUS.length}`}</span></div>
            <div className="pipe-track">
              {track.map(s => {
                let cls = '';
                if (s.stage < fillStage) cls = 'done';
                else if (s.stage === fillStage) cls = isClosed ? 'lost' : 'cur';
                return (
                  <button key={s.id} className={'pipe-step ' + cls} style={isClosed ? { cursor: 'default', pointerEvents: 'none' } : null} onClick={() => { if (!isClosed && onStatusChange) onStatusChange(app, s.id, eventDate); }}>
                    <span className="pipe-bar" />
                    <span className="pipe-lbl">{s.short}</span>
                  </button>
                );
              })}
            </div>
            <div className="pipe-foot">
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                {isClosed
                  ? <>{dropLabel ? <>Reached {dropLabel} · stage {dropStage + 1} of {STATUS.length} · </> : null}<span style={{ color: statusColor }}>{app.status}</span></>
                  : <>Stage {m.stage + 1} of {STATUS.length} · <span style={{ color: m.color }}>{app.status}</span></>}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {/* Governs every status change made from this drawer: the stage
                    track above and the action buttons in the footer. Quiet and
                    pre-filled, because same-day is the common case. */}
                <label className="mono" style={{ fontSize: 10, color: 'var(--text-mute)', letterSpacing: '.06em', textTransform: 'uppercase' }}>Booked</label>
                <input
                  type="date"
                  className="dr-todo-due"
                  value={eventDate}
                  max={localToday()}
                  onChange={e => setEventDate(e.target.value)}
                  title="When this was booked or notified — not when it was conducted, and not when you're typing it in. Defaults to today."
                />
                {!isClosed && m.stage > 0 && <button className="btn ghost sm" onClick={() => onStatusChange && onStatusChange(app, STATUS[m.stage - 1].id, eventDate)}>← Back</button>}
                {!isClosed && m.stage < LAST_STAGE && <button className="btn ghost sm" style={{ color: 'var(--accent-2)' }} onClick={() => onStatusChange && onStatusChange(app, STATUS[m.stage + 1].id, eventDate)}>Advance →</button>}
              </div>
            </div>
          </div>
            );
          })()}

          {/* Engine attribution banner */}
          <div className="rp-engine">
            <span className="ico" style={{ background: `rgba(${engMeta.rgb},0.14)`, color: engMeta.hex }}>
              <PIcon d={PI.zap} size={15} />
            </span>
            <span className="tx">
              {engine
                ? <>Résumé &amp; report generated by the <b>{engine}</b> engine · sourced via {app.source || 'unknown'}</>
                : <>Sourced via <b>{app.source || 'unknown'}</b> · no résumé generated yet</>}
            </span>
            {app.resume && app.resume !== engine && (
              <span className="mono" style={{ fontSize: 10, color: 'var(--text-mute)' }}>{app.resume}</span>
            )}
          </div>

          {/* Report tab strip */}
          <div className="dr-tabs">
            {DRAWER_TABS.filter(t => t.id !== 'followup' || FOLLOWUP_TAB_STATUSES.includes(app.status)).map(t => (
              <button key={t.id} className={'dr-tab' + (tab === t.id ? ' on' : '')} onClick={() => setTab(t.id)}>
                <PIcon d={t.icon} size={13} />{t.label}
              </button>
            ))}
          </div>

          {/* Durable links to whatever this application produced. Deliberately
              ABOVE the tab content so it shows on every tab: the pre-existing
              "Source Links" block sits under Legitimacy, which is not a place
              anyone looks for their own tailored resume. Renders nothing when
              there is nothing to link. */}
          {window.ApplyArtifacts && (
            <div style={{ margin: '10px 0 2px' }}>
              <window.ApplyArtifacts app={app} />
            </div>
          )}

          {/* Tab content — all sourced from structured cheat-sheet (cs) */}
          {tab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {tldr && (
                <div className="rp-callout accent">
                  <div className="rp-callout-label">TL;DR</div>
                  <div className="rp-callout-body">{tldr}</div>
                </div>
              )}

              <div className="rp-snap-grid">
                <div className="rp-snap">
                  <div className="rp-snap-label">Score</div>
                  <div className="rp-snap-value" style={{ color: scoreColor(app.score) }}>
                    {fmtScore(app.score)}<span style={{ color: 'var(--text-mute)', fontSize: 11, marginLeft: 3 }}>{app.score != null ? '/5' : ''}</span>
                  </div>
                  <div className="rp-snap-sub">
                    {scoreBucket(app.score) === 'na' ? 'unscored' : scoreBucket(app.score) + ' match'}
                    {cs && (cs.scoreSource === 'derived'
                      ? <span title="Computed from the dimensions below times your saved weights, minus the red-flag penalty." style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, background: 'var(--accent-bg)', color: 'var(--accent)', fontSize: 10, fontWeight: 600 }}>derived</span>
                      : <span title="Authored under the older rubric. Kept as-is and not recomputed, so it is not directly comparable to a derived score." style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, background: 'var(--panel)', color: 'var(--text-mute)', fontSize: 10, fontWeight: 600, border: '1px solid var(--border)' }}>legacy</span>)}
                  </div>
                </div>
                <div className="rp-snap">
                  <div className="rp-snap-label">Comp</div>
                  <div className="rp-snap-value mono" style={{ fontSize: 16 }}>
                    {comp && comp.stated ? (comp.stated.length > 16 ? comp.stated.slice(0, 15) + '…' : comp.stated) : (app.salary != null ? `$${app.salary}k` : '—')}
                  </div>
                  {app.salary != null && app.target != null && (
                    <div className="rp-snap-sub" style={{ color: gap >= 0 ? 'var(--green)' : 'var(--red)' }}>{gap >= 0 ? '+' : ''}{gap}k vs target</div>
                  )}
                </div>
                <div className="rp-snap">
                  <div className="rp-snap-label">Domain</div>
                  <div className="rp-snap-value sm">{app.sector || '—'}</div>
                  <div className="rp-snap-sub">{(cs && cs.archetypeDetected) || app.archetype || ''}</div>
                </div>
                <div className="rp-snap">
                  <div className="rp-snap-label">Setup</div>
                  <div className="rp-snap-value sm">{(cs && cs.remote) || app.status}</div>
                  <div className="rp-snap-sub">{app.size ? `${app.size}-stage` : relAge(sit) + ' ago'}</div>
                </div>
              </div>

              {globalScore.length > 0 && (
                <div className="rp-section">
                  {/* For a DERIVED report the headline is the weighted sum of these
                      dimensions minus the red-flag penalty, so the formula is shown.
                      For a LEGACY report the headline was authored separately, so the
                      bars are the reasoning, not the maths. */}
                  <div className="rp-section-head">
                    <span>Score Breakdown</span>
                    <button className="btn ghost sm" onClick={() => setExplainScore(v => !v)}>How is this scored?</button>
                  </div>
                  <div className="rp-bars">
                    {globalScore.map((d, i) => {
                      const neg = d.val < 0;
                      const pct = neg ? 18 : (d.val / d.max) * 100;
                      const col = neg ? 'var(--red)' : pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--yellow)' : 'var(--orange)';
                      return (
                        <div key={d.key || d.dim || i} className="rp-bar-row">
                          <span className="rp-bar-label" title={d.evidence || undefined} style={d.evidence ? { cursor: 'help' } : undefined}>{d.dim}{d.note && <span style={{ color: 'var(--text-mute)', fontSize: 10 }}> · {d.note}</span>}</span>
                          <div className="rp-bar-track"><div className="rp-bar-fill" style={{ width: `${pct}%`, background: col }} /></div>
                          <span className="rp-bar-val" style={{ color: neg ? 'var(--red)' : 'var(--text)' }}>{neg ? d.val : `${d.val}/${d.max}`}</span>
                        </div>
                      );
                    })}
                  </div>
                  {cs && cs.scoreSource === 'derived' && cs.scoreBasis ? (
                    <div className="mono" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.7, color: 'var(--text-dim)' }}>
                      {fmtScore(app.score)} = {(cs.scoreBasis.contributions || []).map(c => {
                        const label = (globalScore.find(d => d.key === c.key) || {}).dim || c.key;
                        return `${label} ${c.val}×${c.weight}`;
                      }).join(' + ')}{cs.scoreBasis.penalty ? ` − ${cs.scoreBasis.penalty} red flags` : ''}
                    </div>
                  ) : (
                    <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
                      Legacy score, authored under the older rubric. The bars are the reasoning, not the maths, so they will not add up to it.
                    </div>
                  )}
                  {window.ScoreExplainer && <window.ScoreExplainer open={explainScore} onClose={() => setExplainScore(false)} scoreSource={cs && cs.scoreSource} />}
                </div>
              )}

              {recommendation && (
                <div className="rp-callout accent">
                  <div className="rp-callout-label">Recommendation</div>
                  <div className="rp-callout-body">{recommendation}</div>
                </div>
              )}

              {companyBrief && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Company Brief</span></div>
                  <p className="rp-prose">{companyBrief}</p>
                </div>
              )}

              {keywords.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Extracted Keywords</span><span className="meta">{keywords.length}</span></div>
                  <div className="rp-kw">
                    {keywords.map(k => <span key={k} className="rp-kw-tag">{k}</span>)}
                  </div>
                </div>
              )}

              {loading && <div className="no-data" style={{ padding: 14 }}>Loading report…</div>}
              {!loading && !cs && <div className="no-data" style={{ padding: 14 }}>No report attached.</div>}
            </div>
          )}

          {tab === 'cv' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {cvMatch.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head">
                    <span>JD Requirements → Resume Evidence</span>
                    <span className="meta">
                      <span style={{ color: 'var(--green)' }}>● {cvMatch.filter(m => m.strength === 'strong').length}</span>
                      {' · '}<span style={{ color: 'var(--yellow)' }}>{cvMatch.filter(m => m.strength === 'moderate').length}</span>
                      {' · '}<span style={{ color: 'var(--red)' }}>{cvMatch.filter(m => m.strength === 'weak').length}</span>
                    </span>
                  </div>
                  <div className="rp-match">
                    {cvMatch.map((mr, i) => (
                      <div key={i} className="rp-match-row">
                        <span className={'rp-strength ' + mr.strength}>{mr.strength === 'strong' ? '✓' : mr.strength === 'moderate' ? '~' : '!'}</span>
                        <div>
                          <div className="rp-match-req">{mr.req}</div>
                          <div className="rp-match-ev">{mr.evidence}</div>
                          {mr.note && <div className="rp-match-note">{mr.note}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {gaps.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Gaps &amp; Mitigation</span><span className="meta">{gaps.length} flagged</span></div>
                  <table className="rp-table">
                    <thead><tr><th>Gap</th><th>Blocker?</th><th>Mitigation</th></tr></thead>
                    <tbody>
                      {gaps.map((g, i) => (
                        <tr key={i}><td><b>{g.gap}</b></td><td><span className="blk">{g.blocker}</span></td><td className="dim">{g.mitigation}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {levelMatch && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Level Match</span></div>
                  <div className="info-card">
                    <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}><span className="ik">JD level</span><span className="iv">{levelMatch.jdLevel}</span></div>
                    <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}><span className="ik">Natural level</span><span className="iv">{levelMatch.naturalLevel}</span></div>
                    <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}><span className="ik">Read</span><span className="iv">{levelMatch.verdict}</span></div>
                  </div>
                </div>
              )}

              {sellSenior.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Sell senior without lying</span></div>
                  <div>
                    {sellSenior.map((s, i) => (
                      <div key={i} className="rp-sell">
                        <div className="rp-sell-claim"><span className="n">{String(i + 1).padStart(2, '0')}</span>{s.claim}</div>
                        <div className="rp-sell-proof"><span className="l">proof</span>{s.proof}</div>
                        <blockquote className="rp-sell-phrase">"{s.phrase}"</blockquote>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {downlevelPlan && (
                <div className="rp-callout warn">
                  <div className="rp-callout-label">If they downlevel</div>
                  <div className="rp-callout-body">{downlevelPlan}</div>
                </div>
              )}

              {!cvMatch.length && !gaps.length && !levelMatch && !sellSenior.length && (
                <div className="rp-callout">
                  <div className="rp-callout-label">No structured resume match data</div>
                  <div className="rp-callout-body">This report doesn't expose resume match dimensions. A detailed breakdown requires structured report data.</div>
                </div>
              )}
            </div>
          )}

          {tab === 'comp' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {comp ? (
                <>
                  <div className="rp-snap-grid three">
                    <div className="rp-snap"><div className="rp-snap-label">Stated OTE</div><div className="rp-snap-value sm">{comp.stated || '—'}</div>{comp.score && <div className="rp-snap-sub">{comp.score}/5 comp score</div>}</div>
                    <div className="rp-snap"><div className="rp-snap-label">Posted vs target</div><div className="rp-snap-value mono" style={{ fontSize: 18, color: gap >= 0 ? 'var(--green)' : 'var(--red)' }}>{gap >= 0 ? '+' : '−'}{Math.abs(gap)}k</div>{app.salary != null && app.target != null && <div className="rp-snap-sub">${app.salary}k · ${app.target}k tgt</div>}</div>
                    {comp.walkaway && <div className="rp-snap"><div className="rp-snap-label">Walk-away</div><div className="rp-snap-value mono" style={{ fontSize: 18 }}>${comp.walkaway}k</div><div className="rp-snap-sub" style={{ color: app.salary >= comp.walkaway ? 'var(--green)' : 'var(--red)' }}>{app.salary >= comp.walkaway ? 'cleared' : 'below'}</div></div>}
                  </div>
                  {Array.isArray(comp.sources) && comp.sources.length > 0 && (
                    <div className="rp-section">
                      <div className="rp-section-head"><span>Sources &amp; Benchmarks</span></div>
                      <table className="rp-table">
                        <thead><tr><th>Source</th><th>Data</th><th>Notes</th></tr></thead>
                        <tbody>
                          {comp.sources.map((s, i) => (
                            <tr key={i}><td><b>{s.src}</b></td><td className="dim">{s.data}</td><td className="dim">{s.note}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {comp.verdict && (
                    <div className="rp-callout"><div className="rp-callout-label">Verdict</div><div className="rp-callout-body">{comp.verdict}</div></div>
                  )}
                  {comp.market && (
                    <div className="rp-callout accent"><div className="rp-callout-label">Market Context</div><div className="rp-callout-body">{comp.market}</div></div>
                  )}
                </>
              ) : (
                <div className="rp-callout">
                  <div className="rp-callout-label">No structured comp data</div>
                  <div className="rp-callout-body">This report doesn't include a comp breakdown. {app.compStated && <>JD-stated: <b>{app.compStated}</b></>}</div>
                </div>
              )}
            </div>
          )}

          {tab === 'interview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {leadStory && (
                <div className="rp-callout accent">
                  <div className="rp-callout-label">▶ Lead with: {leadStory.title}</div>
                  <div className="rp-callout-body" style={{ marginBottom: 8 }}>{leadStory.reason}</div>
                  {leadStory.script && <blockquote className="rp-sell-phrase" style={{ borderLeftColor: 'rgba(var(--accent-rgb),0.6)' }}>"{leadStory.script}"</blockquote>}
                </div>
              )}
              {starStories.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>STAR Stories</span><span className="meta">{starStories.length} mapped</span></div>
                  <div>
                    {starStories.map((s, i) => (
                      <div key={i} className="rp-star">
                        <button className="rp-star-head" onClick={() => setStarOpen(starOpen === i ? -1 : i)}>
                          <span className="n">{String(i + 1).padStart(2, '0')}</span>
                          <span className="rp-star-title">{s.title}</span>
                          <span className="rp-star-req">{s.req}</span>
                          <span className="rp-star-tog">{starOpen === i ? '−' : '+'}</span>
                        </button>
                        {starOpen === i && (
                          <div className="rp-star-body">
                            {[['S', s.S], ['T', s.T], ['A', s.A]].map(([k, v]) => v ? <div key={k} className="rp-star-row"><span className="rp-star-tag">{k}</span><span>{v}</span></div> : null)}
                            {s.R && <div className="rp-star-row"><span className="rp-star-tag result">R</span><span>{s.R}</span></div>}
                            {s.Reflection && <div className="rp-star-row"><span className="rp-star-tag">▸</span><span style={{ fontStyle: 'italic', color: 'var(--text-mute)' }}>{s.Reflection}</span></div>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {redFlagQs.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Red-Flag Questions</span><span className="meta">{redFlagQs.length} prepped</span></div>
                  <div>
                    {redFlagQs.map((q, i) => (
                      <details key={i} className="rp-rf">
                        <summary><span className="q">?</span><span>{q.q}</span></summary>
                        <div className="rp-rf-body">
                          {q.behind && <div className="rp-rf-behind"><span className="l">behind: </span>{q.behind}</div>}
                          <div className="rp-rf-answer">{q.a}</div>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}
              {!leadStory && !starStories.length && !redFlagQs.length && (
                <div className="rp-callout">
                  <div className="rp-callout-label">No structured interview prep</div>
                  <div className="rp-callout-body">This report doesn't include STAR stories or red-flag question prep.</div>
                </div>
              )}
            </div>
          )}

          {tab === 'customize' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(customizationCV.length > 0 || customizationLI.length > 0) ? (
                <>
                  <div className="rp-seg">
                    <button className={customWhich === 'cv' ? 'on' : ''} onClick={() => setCustomWhich('cv')}>CV Changes ({customizationCV.length})</button>
                    <button className={customWhich === 'li' ? 'on' : ''} onClick={() => setCustomWhich('li')}>LinkedIn ({customizationLI.length})</button>
                  </div>
                  <div>
                    {(customWhich === 'cv' ? customizationCV : customizationLI).map((c, i) => (
                      <div key={i} className="rp-custom">
                        <div className="rp-custom-head"><span className="n">{String(i + 1).padStart(2, '0')}</span><span className="sec">{c.section}</span></div>
                        {c.current && <div className="rp-custom-row"><span className="rp-ctag current">current</span><span style={{ color: 'var(--text-dim)' }}>{c.current}</span></div>}
                        <div className="rp-custom-row"><span className="rp-ctag change">change</span><span>{c.change}</span></div>
                        <div className="rp-custom-row"><span className="rp-ctag why">why</span><span style={{ color: 'var(--text-dim)' }}>{c.why}</span></div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="rp-callout">
                  <div className="rp-callout-label">No personalization plan</div>
                  <div className="rp-callout-body">This report doesn't include resume or LinkedIn tailoring steps.</div>
                </div>
              )}
            </div>
          )}

          {tab === 'legit' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {(app.legitimacy || legitConclusion) && (
                <div className="rp-callout accent">
                  <div className="rp-callout-label">✓ {app.legitimacy || 'Assessment'}</div>
                  {legitConclusion && <div className="rp-callout-body">{legitConclusion}</div>}
                </div>
              )}
              {legitSignals.length > 0 && (
                <div className="rp-section">
                  <div className="rp-section-head"><span>Signal Analysis</span></div>
                  <div>
                    {legitSignals.map((s, i) => (
                      <div key={i} className="rp-signal">
                        <span className={'rp-signal-dot ' + (s.good ? 'good' : 'bad')}>{s.good ? '✓' : '✕'}</span>
                        <div>
                          <div className="rp-signal-label">{s.signal}</div>
                          {s.finding && <div className="rp-signal-finding">{s.finding}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rp-section">
                <div className="rp-section-head"><span>Source Links</span></div>
                <div className="info-card">
                  {app.url && (
                    <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}>
                      <span className="ik">JD URL</span>
                      <a className="iv link" href={app.url} target="_blank" rel="noreferrer" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{app.url}</a>
                    </div>
                  )}
                  {app.resume && (
                    <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}>
                      <span className="ik">Resume engine</span>
                      <span className="iv mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>{app.resume}</span>
                    </div>
                  )}
                  {app.source && (
                    <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}>
                      <span className="ik">Source</span>
                      <span><SourcePill source={app.source} /></span>
                    </div>
                  )}
                  <div className="info-row" style={{ gridTemplateColumns: '116px 1fr' }}>
                    <span className="ik">Résumé engine</span>
                    <span>{engine ? <EnginePill engine={engine} /> : <span style={{ color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 11 }}>not generated</span>}</span>
                  </div>
                </div>
              </div>
              {!legitSignals.length && !legitConclusion && !app.legitimacy && (
                <div className="rp-callout">
                  <div className="rp-callout-label">No legitimacy assessment</div>
                  <div className="rp-callout-body">This report doesn't include a legitimacy signal breakdown.</div>
                </div>
              )}
            </div>
          )}

          {tab === 'posting' && window.PostingPanel && <window.PostingPanel app={app} />}

          {tab === 'notes' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div className="rp-section">
                <div className="rp-section-head">
                  <span>Add a to-do</span>
                  {todoAdded ? <span className="mono" style={{ fontSize: 10.5, color: 'var(--green)' }}>added to Today ✓</span> : null}
                </div>
                <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                  <input
                    className="dr-note-input"
                    style={{ minHeight: 0, height: 34, resize: 'none', flex: 1 }}
                    placeholder={`e.g. Prep for ${app.company} screen`}
                    value={todoDraft}
                    onChange={(e) => setTodoDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveTodo(); } }}
                  />
                  <input type="date" className="dr-todo-due" value={todoDue} onChange={(e) => setTodoDue(e.target.value)} title="Due date (optional)" />
                  <button className="btn accent sm" disabled={!todoDraft.trim()} onClick={saveTodo}>Add</button>
                </div>
                <div className="mono dim" style={{ fontSize: 10.5, marginTop: 6 }}>Shows up on the <strong>Today</strong> tab, linked to {app.company}.</div>
              </div>

              <div className="rp-section">
                <div className="rp-section-head"><span>Add a note</span></div>
                <textarea
                  className="dr-note-input"
                  placeholder="Paste or type interview notes, a recruiter-call recap, next steps…"
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveNote(); }}
                />
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                  <span className="mono dim" style={{ fontSize: 10.5 }}>⌘/Ctrl + Enter to save</span>
                  <button className="btn primary sm" disabled={!noteDraft.trim() || savingNote} onClick={saveNote}>
                    {savingNote ? 'Saving…' : 'Save note'}
                  </button>
                </div>
              </div>

              <div className="rp-section">
                <div className="rp-section-head">
                  <span>History</span>
                  <span className="card-meta mono">{notes.length} entr{notes.length === 1 ? 'y' : 'ies'}</span>
                </div>
                {notes.length === 0 ? (
                  <div className="rp-callout">
                    <div className="rp-callout-body">No notes yet. Save one above to start tracking this conversation.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[...notes].reverse().map((n) => (
                      <div key={n.timestamp} className="dr-note">
                        <div className="dr-note-head">
                          <span className="dr-note-ts">{new Date(n.timestamp).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>
                          <button className="dr-note-del" title="Delete this note" onClick={() => deleteNote(n.timestamp)}>
                            <PIcon d={PI.x} size={12} />
                          </button>
                        </div>
                        <div className="dr-note-body">{n.text}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'contacts' && (() => {
            const ContactPanel = window.ContactPanel;
            const FindContactsPanel = window.FindContactsPanel;
            if (selContact != null && ContactPanel) {
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <ContactPanel id={selContact} embedded onClose={() => setSelContact(null)} onUpdate={loadContacts} />
                </div>
              );
            }
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div className="rp-section">
                  <div className="rp-section-head">
                    <span>TA contacts at {app.company}</span>
                    <span className="card-meta mono">{contacts.length}</span>
                  </div>
                  {contacts.length === 0 ? (
                    <div className="rp-callout">
                      <div className="rp-callout-body">No TA contacts yet for {app.company}. Find a few below to start outreach.</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {contacts.map(c => (
                        <button key={c.id} onClick={() => setSelContact(c.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', cursor: 'pointer', color: 'inherit' }}>
                          <span className="mono-av sm" style={{ borderRadius: 7 }}>{((c.first || '')[0] || '') + ((c.last || '')[0] || '')}</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.first} {c.last}</div>
                            <div className="dim" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                          </div>
                          <span className="dim mono" style={{ fontSize: 10.5 }}>{c.status || 'New'}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rp-section">
                  {findOpen && FindContactsPanel ? (
                    <FindContactsPanel company={app.company} exampleRole={app.role}
                      onAdded={loadContacts} onCancel={() => setFindOpen(false)} />
                  ) : (
                    <button className="btn sm" onClick={() => setFindOpen(true)}>
                      <PIcon d={PI.users} size={13} /> Find contacts at {app.company}
                    </button>
                  )}
                </div>

                {!ContactPanel && (
                  <div className="rp-callout">
                    <div className="rp-callout-body">Contact panel failed to load. Reload the page and try again.</div>
                  </div>
                )}
              </div>
            );
          })()}

          {tab === 'followup' && window.FollowupPanel && (
            <window.FollowupPanel app={app} onUpdate={onFollowupChange} />
          )}
        </div>

        {/* Apply-job banner (running / error / result) */}
        {applyJob && applyJob.status === 'running' && (
          <div className="dr-foot" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>
              ⟳ {applyJob.mode === 'claude' ? 'Generating resume + form responses…'
                : applyJob.mode === 'byo'    ? 'Logging application…'
                : applyJob.mode === 'cover'  ? 'Drafting cover letter…'
                :                              'Generating tailored CV…'} {elapsed > 0 && `(${elapsed}s)`}
            </span>
          </div>
        )}
        {applyJob && applyJob.status === 'error' && (
          <div className="dr-foot" style={{ borderTop: '1px solid var(--border)' }}>
            <span className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>✕ {applyJob.error}</span>
            <button className="btn sm ghost" onClick={() => setApplyJob(null)}>Dismiss</button>
          </div>
        )}
        {applyResult && (() => {
          const r = applyResult.result || {};
          const fileName = p => p ? p.replace(/\\/g, '/').split('/').pop() : null;
          const hrefFor = p => {
            if (!p) return null;
            const f = fileName(p);
            return f.endsWith('.md') ? `/output-preview/${f}` : `/output/${f}`;
          };
          const isByo = r.byo === true;
          const isCover = r.coverOnly === true;
          return (
            <div className="dr-foot" style={{ borderTop: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ color: 'var(--green)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                {isCover ? `✓ Cover letter ready for ${app.company}`
                  : isByo ? `✓ Logged as applied to ${app.company} (no assets generated)`
                  : `✓ Applied to ${app.company}`}
              </span>
              {(r.docx || r.pdf) && <a className="btn sm" href={hrefFor(r.docx || r.pdf)} target="_blank" rel="noreferrer">{r.docx ? 'Resume DOCX ↗' : 'Resume PDF ↗'}</a>}
              {r.cover && <a className="btn sm" href={hrefFor(r.cover)} target="_blank" rel="noreferrer">Cover Letter ↗</a>}
              {r.apply && <a className="btn sm accent" href={hrefFor(r.apply)} target="_blank" rel="noreferrer">Form Responses ↗</a>}
              {app.url && <a className="btn sm" href={app.url} target="_blank" rel="noreferrer">JD ↗</a>}
              <button className="btn sm ghost" onClick={() => setApplyResult(null)}>✕</button>
            </div>
          );
        })()}

        {/* Quick-copy contact bar — same shared component the Overview drawer uses */}
        <window.QuickCopyBar />

        {/* Sticky action footer */}
        <div className="dr-foot">
          {primary.map(b => (
            <button key={b.id} className={'btn ' + (b.cls || '')} disabled={applyJob && applyJob.status === 'running'} onClick={() => handleFooterClick(b)}>
              {b.spark && <PIcon d={PI.zap} size={12} />}{b.label}{b.check && <PIcon d={PI.check} size={12} style={{ marginLeft: 4 }} />}
            </button>
          ))}
          {primary.length > 0 && closers.length > 0 && <span className="dr-foot-div" />}
          {closers.map(b => (
            <button key={b.id} className={'btn ghost' + (b.danger ? ' danger' : '')} onClick={() => onAction && onAction(app, b.id, eventDate)}>
              {b.label}
            </button>
          ))}
          {app.url && <a className="btn ghost jd" href={app.url} target="_blank" rel="noreferrer">Open JD <PIcon d={PI.arrowR} size={12} /></a>}
        </div>
      </div>
    </div>
  );
}
// Shared so the Follow-Ups section can open the full Pipeline drawer instead of
// its own thinner one.
window.PipelineDrawer = PipelineDrawer;

// ─── Root: PipelineTab (replaces the existing) ─────────────────────────────
window.PipelineTab = function PipelineTab({ apps, view, setView, filters, setFilters, onOpen, onQuickAction, onDataChanged, search, compTweaks }) {
  // Use the external view prop when it matches a known subtab, otherwise default to 'overview'.
  // This lets the command palette in app.jsx jump directly to the All subtab.
  const VALID_SUBVIEWS = ['overview', 'table', 'all', 'analytics'];
  const initialSub = VALID_SUBVIEWS.includes(view) ? view : 'overview';
  const [subView, setSubViewRaw] = useStateP(initialSub);
  const setSubView = (s) => { setSubViewRaw(s); if (setView) setView(s); };
  useEffectP(() => { if (VALID_SUBVIEWS.includes(view) && view !== subView) setSubViewRaw(view); }, [view]);
  const [drawerApp, setDrawerApp] = useStateP(null);

  const activeApps = useMemoP(() => apps.filter(a => ACTIVE_STATUSES.includes(a.status)), [apps]);
  const filtered = useMemoP(() => applyFilters(activeApps, filters, search), [activeApps, filters, search]);

  // ── Triage (Option B): provisional rows from data/triage-results.tsv ───────
  // Surfaced in the Table + All views so a scanned-but-unevaluated role is
  // visible where users look. NEVER written to applications.md, so Overview /
  // Analytics (which read `apps` / `activeApps`) are unaffected by construction.
  const [triageCards, setTriageCards] = useStateP([]);
  const [deepJobs, setDeepJobs] = useStateP({}); // keyed by row.id ('tri-'+url)
  const deepPollers = useRefP({});
  const loadTriage = useCallbackP(() => {
    fetch('/api/triage/results').then(r => r.json()).then(d => setTriageCards(d.cards || [])).catch(() => {});
  }, []);
  useEffectP(() => { loadTriage(); }, [loadTriage]);
  useEffectP(() => () => { Object.values(deepPollers.current).forEach(clearInterval); }, []);

  const triageRows = useMemoP(() => buildTriageRows(triageCards), [triageCards]);
  // Which triage rows show in the Table subtab: hidden when a status/archetype
  // filter is active (Triage isn't a tracked status), else filtered by score + search.
  const triageInTable = useMemoP(() => {
    if (filters && (filters.statuses?.length || filters.archetype || filters.archetypes?.length)) return [];
    let rows = triageRows;
    if (filters && filters.scoreMin) rows = rows.filter(r => r.score != null && r.score >= filters.scoreMin);
    if (search) { const ql = search.toLowerCase(); rows = rows.filter(r => `${r.company} ${r.role}`.toLowerCase().includes(ql)); }
    return rows;
  }, [triageRows, filters, search]);

  const setDeepJob = (id, patch) => setDeepJobs(j => ({ ...j, [id]: { ...(j[id] || {}), ...patch } }));
  // Dismiss a triage row ("not a match"): drop it locally now, persist so the
  // next scan won't resurface it. Never touches applications.md.
  const dismissTriage = (row) => {
    setTriageCards(cards => cards.filter(c => c.url !== row.url));
    window.tjkMutate('/api/triage/dismiss', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: row.url }),
    }).catch(() => loadTriage());
  };
  // Run the full Sonnet deep eval for one triage row. The server auto-merges it,
  // so on success we refresh apps (the new Evaluated row appears) and retire the
  // promoted card durably via dismiss (robust even if the report URL canonicalizes
  // away from the triage URL). deepPollers doubles as a synchronous re-entrancy
  // guard so a rapid double-click can't start two jobs or leak an interval.
  const triggerDeep = (row) => {
    if (deepPollers.current[row.id]) return;
    deepPollers.current[row.id] = true; // placeholder until the real interval handle exists
    setDeepJob(row.id, { status: 'running' });
    const clear = () => { clearInterval(deepPollers.current[row.id]); delete deepPollers.current[row.id]; };
    window.tjkMutate('/api/agent/deep', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: row.url, company: row.company, title: row.role }),
    })
      .then(r => r.json())
      .then(({ jobId, error }) => {
        if (!jobId) { delete deepPollers.current[row.id]; setDeepJob(row.id, { status: 'error', error: error || 'Failed to start' }); return; }
        deepPollers.current[row.id] = setInterval(() => {
          fetch(`/api/agent/status/${jobId}`)
            .then(r => r.json())
            .then(job => {
              if (job.status === 'done') {
                clear();
                setDeepJob(row.id, { status: 'done' });
                if (onDataChanged) onDataChanged();
                dismissTriage(row); // retire the promoted card (durable; survives URL canonicalization)
              } else if (job.status === 'error') {
                clear();
                setDeepJob(row.id, { status: 'error', error: job.error || 'Deep eval failed' });
              }
            })
            .catch(() => { clear(); setDeepJob(row.id, { status: 'error', error: 'Poll failed' }); });
        }, 2500);
      })
      .catch(err => { delete deepPollers.current[row.id]; setDeepJob(row.id, { status: 'error', error: err.message }); });
  };
  const triage = { deepJobs, onDeep: triggerDeep, onDismiss: dismissTriage };

  // Canonical "stale by the Follow-Ups engine" data — shared across every
  // sub-view (Table / Board / Pipeline Overview / Drawer / Analytics) so they
  // all agree. Replaces the naive `daysAgo(applyDate) > 14` check that was
  // flagging rows the user had already cross-logged TA touches against.
  const [staleSet, setStaleSet] = useStateP(new Set());
  const [staleMeta, setStaleMeta] = useStateP(new Map());
  useEffectP(() => {
    let cancelled = false;
    fetch('/api/followups/stale')
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        const ids = new Set();
        const meta = new Map();
        for (const it of (d.items || [])) {
          if (it.source !== 'app') continue;
          ids.add(it.id);
          meta.set(it.id, { days: it.daysSinceLastTouch, verdict: it.coachVerdict });
        }
        setStaleSet(ids);
        setStaleMeta(meta);
      })
      .catch(() => { if (!cancelled) { setStaleSet(new Set()); setStaleMeta(new Map()); } });
    return () => { cancelled = true; };
  }, [apps.length]);
  const isStale = (a) => staleSet.has(a.id);
  const staleDays = (a) => staleMeta.get(a.id)?.days ?? null;

  const selId = drawerApp && drawerApp.id;
  // Local drawer: don't bubble up to the shared window.Drawer for Pipeline rows.
  // Triage rows have no report and a synthetic id, so they never open the heavy
  // report drawer — their Deep Dive / dismiss / open-JD actions live in the row.
  const handleOpen = (a) => { if (a && a._triage) return; setDrawerApp(a); };

  const onExport = () => {
    const rows = subView === 'table' ? filtered : activeApps;
    exportCSV(rows);
  };

  // Drawer action handlers — primary actions advance status via API PATCH
  const advance = async (a, newStatus, eventDate) => {
    try {
      const body = { status: newStatus };
      if (eventDate) body.eventDate = eventDate;
      // Auto-attribute the exit stage: closing from an interview round (or
      // Responded/Offer) stamps [reached: <stage>] so the funnel + rejections-
      // by-stage analytics credit the right rung. Mirrors app.jsx handleAction.
      if (newStatus === 'Rejected' || newStatus === 'No Response') {
        const fi = window.FUNNEL_ORDER.indexOf(a.status);
        if (fi >= window.FUNNEL_ORDER.indexOf('Responded')) {
          const tag = `[reached: ${a.status}]`;
          const stripped = (a.notes || '').trim().replace(/^\[reached:\s*[^\]]+\]\s*/i, '').trim();
          body.notes = stripped ? `${tag} ${stripped}` : tag;
          a.notes = body.notes;
        }
      }
      const res = await window.tjkMutate(`/api/applications/${a.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      // The server now 400s an invalid eventDate. Without this check a rejected
      // date would fail silently while the UI showed the new status anyway.
      if (res && !res.ok) {
        const msg = await res.json().then(j => j.error).catch(() => `HTTP ${res.status}`);
        if (window.tjkToast) window.tjkToast(`Save failed for ${a.company}: ${msg}`, 'error');
        return;
      }
      // Update local app object for instant visual feedback
      a.status = newStatus;
      setDrawerApp({ ...a });
      // Lift the change to the parent so every list view (All / Table / Overview)
      // re-reads the server, not just the drawer. Without this the in-place
      // mutation gets stranded the moment refreshApps() (e.g. on window focus)
      // swaps in fresh app objects, leaving the list showing a stale status
      // (e.g. a Rejected row still rendering as Evaluated after a multi-step move).
      if (onDataChanged) onDataChanged();
    } catch (err) { /* swallow — toast comes from parent */ }
  };

  const onAction = (a, actionId, eventDate) => {
    const MAP = {
      apply_manual: 'Applied', apply_claude: 'Applied', already_applied: 'Applied',
      responded: 'Responded', offer: 'Offer', accept: 'Offer',
      reopen: 'Evaluated',
      // funnel statuses (the advance CTA sets id = next canonical status) + closers map to themselves
      Applied: 'Applied', Responded: 'Responded', Offer: 'Offer',
      'Phone Screen': 'Phone Screen', '1st Interview': '1st Interview', '2nd Interview': '2nd Interview', '3rd Interview': '3rd Interview', '4th Interview': '4th Interview',
      SKIP: 'SKIP', 'Not a Fit': 'Not a Fit', Closed: 'Closed', Rejected: 'Rejected', Discarded: 'Discarded', 'No Response': 'No Response',
    };
    const next = MAP[actionId];
    if (!next) return;
    advance(a, next, eventDate).then(() => {
      // Closed states leave the pipeline
      if (!ACTIVE_STATUSES.includes(next)) setDrawerApp(null);
    });
  };

  const onStatusChange = (a, newStatus, eventDate) => advance(a, newStatus, eventDate);

  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {PL_SUBTABS.map(s => (
          <div key={s.id} className={'subtab' + (subView === s.id ? ' active' : '')} onClick={() => setSubView(s.id)}>
            <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
              <PIcon d={s.icon} size={14} />
            </span>
            {s.label}
          </div>
        ))}
      </div>

      {subView === 'overview' && (
        <OverviewView apps={apps} onOpen={handleOpen} onAction={onQuickAction} search={search} />
      )}
      {subView === 'table' && (
        <TableView apps={[...activeApps, ...triageRows]} filtered={[...filtered, ...triageInTable]} filters={filters} setFilters={setFilters} search={search} setSearch={() => {}} onOpen={handleOpen} selId={selId} onExport={onExport} isStale={isStale} staleDays={staleDays} triage={triage} />
      )}
      {subView === 'all' && (
        <AllEntriesView apps={[...apps, ...triageRows]} onOpen={handleOpen} search={search} isStale={isStale} staleDays={staleDays} triage={triage} />
      )}
      {subView === 'analytics' && (
        <AnalyticsView apps={activeApps} allApps={apps} compTweaks={compTweaks} onOpen={handleOpen} isStale={isStale} />
      )}

      {drawerApp && (
        <PipelineDrawer
          app={drawerApp}
          onClose={() => setDrawerApp(null)}
          onAction={onAction}
          onStatusChange={onStatusChange}
          isStale={isStale}
        />
      )}
    </div>
  );
};

// Backwards-compat: expose the new TableView under the legacy
// window.PipelineTable name with the old call signature
// ({ rows, sortKey, sortDir, setSort, onOpen }) so tracker.jsx (which
// renders the full All-Entries view including closed statuses) keeps
// working without modification. The legacy signature is sort-controlled
// by the parent; our internal TableView is filter/sort-controlled by
// itself, so we render a parallel minimal table here matching the old
// columns + behavior.
window.PipelineTable = function PipelineTableCompat({ rows, sortKey, sortDir, setSort, onOpen, isStale = () => false, staleDays = () => null, flat = false, triage = null }) {
  const cols = [
    { k: 'id',         label: '#',         w: 50 },
    { k: 'date',       label: 'Date',      w: 80 },
    { k: 'company',    label: 'Company',   w: 210 },
    { k: 'role',       label: 'Role',      w: 250 },
    { k: 'archetype',  label: 'Archetype', w: 90 },
    { k: 'compStated', label: 'Comp',      w: 110 },
    { k: 'sector',     label: 'Sector',    w: 110 },
    { k: 'status',     label: 'Status',    w: 116 },
    { k: 'score',      label: 'Score',     w: 80 },
    { k: 'source',     label: 'Source',    w: 92 },
  ];
  return (
    <div className="tbl-wrap" style={{
      maxHeight: 'calc(100vh - ' + (flat ? '360px' : '280px') + ')',
      ...(flat ? { border: 'none', borderRadius: 0, background: 'transparent', marginTop: 8 } : {}),
    }}>
      <table className="tbl">
        <thead>
          <tr>
            {cols.map(c => (
              <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? 'sorted' : ''} onClick={() => setSort(c.k)}>
                {c.label}
                <span className="sort-ind">{sortKey === c.k ? (sortDir === 'asc' ? '↑' : '↓') : '·'}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={cols.length}><div className="no-data">No matches. Try clearing filters.</div></td></tr>
          )}
          {rows.map(a => {
            const stale = isStale(a);
            return (
            <tr key={a.id} className={stale ? 'stale' : ''}
              style={a._triage ? { cursor: 'default', background: 'rgba(148,163,184,0.05)' } : undefined}
              onClick={() => onOpen(a)}>
              <td className="id">{a._triage ? '—' : String(a.id).padStart(3, '0')}</td>
              <td className="date">{a.date?.slice(5)}</td>
              <td className="company t-co-cell">
                <div className="co-cell">
                  <span className="co-name">{a.company}</span>
                  {stale && (
                    <span className="stale-tag" title="Flagged by Follow-Ups engine, overdue for a nudge">
                      ↻ {staleDays(a) ?? ''}{staleDays(a) != null ? 'd overdue' : 'overdue'}
                    </span>
                  )}
                </div>
              </td>
              <td className="role" title={a.role}
                style={a._triage ? { whiteSpace: 'normal', maxWidth: 360 } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 250 }}>
                {a.role}
                {a._triage && (
                  <>
                    <div className="mono" style={{ fontSize: 9.5, letterSpacing: '0.04em', color: 'var(--text-mute)', marginTop: 2, textTransform: 'uppercase' }}>initial pass · Haiku triage</div>
                    {a.rationale && <div className="dim" style={{ fontSize: 10.5, marginTop: 2, whiteSpace: 'normal', lineHeight: 1.35 }}>{a.rationale}</div>}
                    {triage && <TriageRowActions row={a} job={triage.deepJobs[a.id]} onDeep={triage.onDeep} onDismiss={triage.onDismiss} />}
                  </>
                )}
              </td>
              <td><span className="mono dim" style={{ fontSize: 11 }}>{a.archetype}</span></td>
              <td className="mono dim" style={{ fontSize: 11 }} title={a.compStated || 'Not Stated'}>
                {formatCompMidpoint(a)}
              </td>
              <td className="dim" style={{ fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 }}
                title={a.sectorRaw || a.sector || ''}>
                {a.sector || '—'}
              </td>
              <td><StatusBadge status={a.status} /></td>
              <td><ScoreChip score={a.score} provisional={a._triage} /></td>
              <td><SourcePill source={a.source} /></td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

})(); // end pipeline IIFE
