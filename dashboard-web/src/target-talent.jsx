// TA Outreach — redesigned with card grid, subtabs (Contacts/Companies/Analytics),
// pipeline micro-track, redesigned drawer, and 3-step reconcile wizard.
// Adapted from Claude Design handoff to work with live API endpoints.

const { useState, useEffect, useMemo, useCallback } = React;

// ── Status pipeline ──────────────────────────────────────────────────────────
const TT_STATUS = [
  { id: "Not Contacted", short: "New", color: "var(--text-mute)", rgb: "113,113,122", stage: 0, pipeline: true },
  { id: "Drafted", short: "Drafted", color: "var(--accent)", rgb: "167,139,250", stage: 1, pipeline: true },
  { id: "Sent", short: "Sent", color: "var(--blue)", rgb: "96,165,250", stage: 2, pipeline: true },
  { id: "Replied", short: "Replied", color: "var(--cyan)", rgb: "34,211,238", stage: 3, pipeline: true },
  { id: "Meeting Scheduled", short: "Meeting", color: "var(--orange)", rgb: "245,158,11", stage: 4, pipeline: true },
  { id: "Connected", short: "Connected", color: "var(--green)", rgb: "34,197,94", stage: 5, pipeline: true },
  { id: "Dormant", short: "Dormant", color: "#71717a", rgb: "113,113,122", stage: -1, pipeline: false },
  { id: "Archived", short: "Archived", color: "#52525b", rgb: "82,82,91", stage: -1, pipeline: false },
];
const TT_STATUS_MAP = Object.fromEntries(TT_STATUS.map(s => [s.id, s]));
const TT_PIPELINE = TT_STATUS.filter(s => s.pipeline);

// ── Icons (stroke paths, 24x24 viewBox) ──────────────────────────────────────
// Canonical paths in shared.jsx (window.ICON). Local TI alias preserves call sites.
const TI = window.ICON;

function TIcon({ d, size = 16, stroke = 1.6, style }) {
  return React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", style }, React.createElement("path", { d }));
}

function ttInitials(name) {
  const parts = name.replace(/['"]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ttDomain(email) {
  if (!email) return "";
  const parts = email.split("@");
  return parts.length > 1 ? parts[1] : "";
}

function relTouch(d) {
  if (!d) return "—";
  const now = new Date();
  const then = new Date(d);
  const days = Math.round((now - then) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return days + "d ago";
  if (days < 30) return Math.floor(days / 7) + "w ago";
  return Math.floor(days / 30) + "mo ago";
}

// ── Shared components ────────────────────────────────────────────────────────
function StatusBadge({ status, size = "md" }) {
  const m = TT_STATUS_MAP[status] || TT_STATUS_MAP["Not Contacted"];
  const sm = size === "sm";
  return React.createElement("span", {
    className: "status-badge",
    style: {
      color: m.color,
      borderColor: `rgba(${m.rgb},0.42)`,
      background: `rgba(${m.rgb},0.12)`,
      fontSize: sm ? 9.5 : 10.5,
      padding: sm ? "2px 7px" : "3px 9px",
    }
  },
    React.createElement("span", {
      className: "sb-dot",
      style: { background: m.color, boxShadow: m.stage >= 0 ? `0 0 6px ${m.color}` : "none" }
    }),
    m.id
  );
}

// ── Contacts view ────────────────────────────────────────────────────────────
function StatusBreakdown({ contacts, filter, setFilter }) {
  const active = contacts.filter(c => c.status !== "Archived");
  return (
    <div className="statline">
      {TT_STATUS.map(s => {
        if (s.id === "Archived") return null;
        const n = active.filter(c => c.status === s.id).length;
        const on = filter === s.id;
        return (
          <button key={s.id} className={"stat-chip" + (on ? " on" : "") + (n === 0 ? " zero" : "")}
            onClick={() => setFilter(on ? null : s.id)}>
            <span className="sc-dot" style={{ background: s.color, boxShadow: n && s.stage >= 0 ? `0 0 6px ${s.color}` : "none" }} />
            {s.id}<span className="sc-n">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

// Consolidated Contacts + Companies into one sortable table (SSI-influencer
// look & feel). Company is a sortable column, so grouping/coverage is reachable
// by sorting on it — no separate Companies subtab needed.
function ContactsTableView({ contacts, onOpen, selId, onReconcile, search, onImported }) {
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [sortKey, setSortKey] = useState("status");
  const [sortDir, setSortDir] = useState("desc");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const q = search || "";

  const setSort = (k) => {
    if (sortKey === k) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "last" || k === "status" ? "desc" : "asc"); }
  };

  const active = useMemo(() => contacts.filter(c => c.status !== "Archived"), [contacts]);
  const archivedCount = contacts.length - active.length;
  const companies = useMemo(() => [...new Set(contacts.map(c => c.company))].sort(), [contacts]);

  const rows = useMemo(() => {
    let r = showArchived ? contacts : active;
    if (statusFilter) r = r.filter(c => c.status === statusFilter);
    if (companyFilter) r = r.filter(c => c.company === companyFilter);
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter(c => `${c.first} ${c.last} ${c.company} ${c.title}`.toLowerCase().includes(t));
    }
    return r;
  }, [contacts, active, showArchived, statusFilter, companyFilter, q]);

  const sortVal = (c, key) => {
    switch (key) {
      case "name":     return `${c.first || ""} ${c.last || ""}`.toLowerCase();
      case "title":    return (c.title || "").toLowerCase();
      case "company":  return (c.company || "").toLowerCase();
      case "location": return `${c.state || ""} ${c.city || ""}`.toLowerCase();
      case "status":   return (TT_STATUS_MAP[c.status] || { stage: -2 }).stage;
      case "last":     return c.lastTouch || "";
      default:         return "";
    }
  };
  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      // Stable tiebreak: company, then name.
      const ac = (a.company || "").localeCompare(b.company || "");
      if (ac !== 0) return ac;
      return `${a.first || ""} ${a.last || ""}`.localeCompare(`${b.first || ""} ${b.last || ""}`);
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const hasFilters = statusFilter || companyFilter || q.trim();

  // Bulk-import contacts from a CSV (the "Excel floor" for non-power users).
  // Reads the file as text and posts it to /api/tt-reconcile/bulk-import.
  function handleImport(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;
    setImporting(true); setImportMsg("");
    const reader = new FileReader();
    reader.onload = () => {
      window.tjkMutate("/api/tt-reconcile/bulk-import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: String(reader.result || "") }) })
        .then(r => r.json().then(b => ({ ok: r.ok, b })))
        .then(({ ok, b }) => {
          setImporting(false);
          if (!ok || b.error) { setImportMsg(b.error || "Import failed."); return; }
          setImportMsg(`Imported ${b.imported}${b.duplicates ? `, ${b.duplicates} duplicate${b.duplicates === 1 ? "" : "s"} skipped` : ""}.`);
          onImported && onImported();
        })
        .catch(err => { setImporting(false); setImportMsg(err.message); });
    };
    reader.onerror = () => { setImporting(false); setImportMsg("Could not read the file."); };
    reader.readAsText(file);
  }

  const cols = [
    { k: "name",     label: "Contact",    w: 210 },
    { k: "title",    label: "Title",      w: 220 },
    { k: "company",  label: "Company",    w: 180 },
    { k: "location", label: "Location",   w: 140 },
    { k: "status",   label: "Status",     w: 150 },
    { k: "last",     label: "Last touch", w: 110 },
  ];

  return (
    <div className="fade-up">
      <div className="ta-head">
        <div>
          <h1>TA Outreach</h1>
          <div className="sub">{active.length} active contacts &middot; {companies.length} companies &middot; {archivedCount} archived</div>
        </div>
        <div className="act">
          <label className="btn" style={{ cursor: "pointer" }}>
            <span onClick={e => { e.preventDefault(); setShowArchived(v => !v); }}
              style={{ width: 14, height: 14, border: "1.5px solid var(--border-2)", borderRadius: 3, display: "inline-grid", placeItems: "center", background: showArchived ? "var(--accent)" : "transparent", borderColor: showArchived ? "var(--accent)" : "var(--border-2)" }}>
              {showArchived && <TIcon d={TI.check} size={9} style={{ color: "#15101f" }} stroke={3} />}
            </span>
            Show archived ({archivedCount})
          </label>
          <a className="btn" href="/api/tt-reconcile/template" download style={{ textDecoration: "none" }} title="Download the CSV template (company, first, last, title, ...)">Template</a>
          <label className="btn" style={{ cursor: importing ? "default" : "pointer", opacity: importing ? 0.6 : 1 }} title="Bulk-import contacts from a CSV file">
            {importing ? "Importing…" : "Import CSV"}
            <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={importing} onChange={handleImport} />
          </label>
          <button className="btn primary" onClick={onReconcile}><TIcon d={TI.refresh} size={14} /> Reconcile</button>
        </div>
      </div>
      {importMsg && <div style={{ fontSize: 12, color: "var(--text-mute)", margin: "0 0 10px" }}>{importMsg}</div>}

      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title">Contacts</span>
          <span className="card-meta mono">{sorted.length} of {active.length} &middot; {companies.length} companies</span>
        </div>

        <StatusBreakdown contacts={contacts} filter={statusFilter} setFilter={setStatusFilter} />

        <div className="ta-filters" style={{ marginTop: 10 }}>
          <select className="sel" value={companyFilter} onChange={e => setCompanyFilter(e.target.value)}>
            <option value="">All companies</option>
            {companies.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => { setStatusFilter(null); setCompanyFilter(""); }}>
              <TIcon d={TI.x} size={12} /> Clear
            </button>
          )}
          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-mute)", letterSpacing: ".06em" }}>
            sorted by {cols.find(c => c.k === sortKey)?.label.toLowerCase()} &middot; click a row for details
          </span>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: "calc(100vh - 360px)", border: "none", borderRadius: 0, background: "transparent" }}>
          <table className="tbl ssi-tbl">
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? "sorted" : ""} onClick={() => setSort(c.k)}>
                    {c.label}<span className="sort-ind">{sortKey === c.k ? (sortDir === "asc" ? "↑" : "↓") : "·"}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 && (
                <tr><td colSpan={cols.length}><div className="no-data" style={{ padding: 40, textAlign: "center" }}>No contacts match these filters.</div></td></tr>
              )}
              {sorted.map(c => {
                const m = TT_STATUS_MAP[c.status] || TT_STATUS[0];
                const loc = [c.city, c.state].filter(Boolean).join(", ");
                return (
                  <tr key={c.id} className={selId === c.id ? "selected" : ""} onClick={() => onOpen(c.id)}>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                        <div className="mono-av sm" style={{ borderColor: m.color, color: m.color, flex: "none" }}>{ttInitials(c.first + " " + c.last)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.first} {c.last}</div>
                      </div>
                    </td>
                    <td title={c.title || ""}>
                      <span style={{ fontSize: 12, color: "var(--text-dim)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "—"}</span>
                    </td>
                    <td title={c.company || ""}>
                      <span style={{ fontWeight: 600, fontSize: 12.5, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: loc ? "var(--text-dim)" : "var(--text-mute)" }}>{loc || "—"}</span>
                    </td>
                    <td><StatusBadge status={c.status} size="sm" /></td>
                    <td>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: c.lastTouch ? "var(--text-dim)" : "var(--text-mute)" }}>{c.lastTouch ? relTouch(c.lastTouch) : "—"}</span>
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

// ── Overview view ───────────────────────────────────────────────────────────
// 4 KPIs + 3 visuals + Next Actions. Each card carries a one-line coaching
// insight (mirrors Pipeline/Follow-Ups Overview pattern).

function TAKpi({ label, value, sub, tone = 'neutral' }) {
  const COLOR = { neutral: 'var(--text)', good: 'var(--green)', warn: 'var(--yellow)', danger: 'var(--red)', accent: 'var(--accent)' };
  return (
    <div className="card" style={{ padding: '14px 16px', flex: 1, minWidth: 170 }}>
      <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 600, color: COLOR[tone], lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function TABar({ label, n, total, color }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5 }}>
        <span style={{ color }}>{label}</span>
        <span className="mono dim">{n} · {pct}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────
function CopyBtn({ value }) {
  const [done, setDone] = useState(false);
  const copy = e => {
    e.stopPropagation();
    try { navigator.clipboard.writeText(value); } catch (_) {}
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return (
    <button className={"copy-btn" + (done ? " done" : "")} onClick={copy}>
      <TIcon d={done ? TI.check : TI.copy} size={11} />{done ? "Copied" : "Copy"}
    </button>
  );
}

function PipelineTrack({ contact, onChange }) {
  const cur = TT_STATUS_MAP[contact.status] || TT_STATUS[0];
  return (
    <div>
      <div className="pipe-track">
        {TT_PIPELINE.map(s => {
          const cls = cur.stage > s.stage ? "done" : cur.stage === s.stage ? "cur" : "";
          return (
            <button key={s.id} className={"pipe-step " + cls} onClick={() => onChange(s.id)}>
              <span className="pipe-bar" />
              <span className="pipe-lbl">{s.short}</span>
            </button>
          );
        })}
      </div>
      <div className="pipe-foot">
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Stage {Math.max(cur.stage, 0) + 1} of 6 &middot; <span style={{ color: cur.color }}>{contact.status}</span>
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn ghost sm" onClick={() => onChange("Dormant")} style={{ color: contact.status === "Dormant" ? "var(--orange)" : undefined }}>Dormant</button>
          <button className="btn ghost sm" onClick={() => onChange("Archived")}>Archive</button>
        </div>
      </div>
    </div>
  );
}

function MsgNode({ m }) {
  const dir = m.direction === "Received" ? "in" : m.direction === "Draft" ? "draft" : "out";
  const icon = dir === "in" ? TI.inbound : dir === "draft" ? TI.pen : TI.outbound;
  const color = dir === "in" ? "var(--cyan)" : dir === "draft" ? "var(--accent)" : "var(--blue)";
  const label = dir === "in" ? "Received" : dir === "draft" ? "Draft" : "Sent";
  return (
    <div className="msg">
      <div className="msg-node" style={{ borderColor: color, color }}><TIcon d={icon} size={11} /></div>
      <div className="msg-head">
        <span className={"msg-dir " + dir}>{label}</span>
        <span className="msg-subj">{m.subject}</span>
        <span className="msg-date">{m.timestamp || "not sent"}</span>
      </div>
      <div className={"msg-body" + (dir === "draft" ? " draftbox" : "")}>{m.body}</div>
    </div>
  );
}

// Map an application status to a sensible default outreach stage. The status now
// carries the exact interview round, so we default the stage precisely; the user
// can still refine it in the dropdown.
function stageFromApps(apps) {
  const top = (apps || []).find(a => window.isInterviewStage(a.status) || ["Responded", "Applied", "Evaluated"].includes(a.status)) || (apps || [])[0];
  if (!top) return "general";
  if (window.isInterviewStage(top.status)) return top.status;
  return "general";
}

const TT_STAGE_OPTS = [
  { v: "general",       l: "General" },
  { v: "Phone Screen",  l: "Phone Screen" },
  { v: "1st Interview", l: "1st Interview" },
  { v: "2nd Interview", l: "2nd Interview" },
  { v: "3rd Interview", l: "3rd Interview" },
  { v: "4th Interview", l: "4th Interview" },
];

// ── Contact panel (shared body) ───────────────────────────────────────────────
// The full single-contact management UI: header, contact info, pipeline stage
// track, related apps, notes, stage-tuned outreach drafting, correspondence
// thread, and the log-message modal. Rendered both inside the TA Outreach drawer
// (TTDrawer) and inline in the Pipeline drawer's Contacts tab (via
// window.ContactPanel) so there is a single implementation. When `embedded`, it
// drops the drawer chrome (head/body classes, ESC-to-close) and shows a "Back"
// control instead of a close X.
function ContactPanel({ id, onClose, onUpdate, embedded = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState(null);
  const [draftStage, setDraftStage] = useState("general");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [editingWeb, setEditingWeb] = useState(false);
  const [logModal, setLogModal] = useState(null);
  // Multi-app cross-log: every related application at the company is checked
  // by default so a TA touch propagates to all of them in one step. User can
  // uncheck any individual app for the rare case where the touch is not
  // about that specific role.
  const [crossLogAppIds, setCrossLogAppIds] = useState(new Set());

  const load = useCallback(() => {
    if (id == null) return;
    setLoading(true);
    fetch(`/api/target-talent/${id}`)
      .then(r => r.json())
      .then(d => {
        setData(d);
        setNotes(d.notes || "");
        setWebsite(d.website || "");
        setEditingWeb(false);
        // Pre-check every ACTIVE related application (Evaluated/Applied/Responded/interview rounds).
        // Closed-state apps (Rejected/Discarded/Closed/SKIP/Not a Fit) start unchecked.
        const ACTIVE = new Set(["Evaluated", "Applied", "Responded", ...window.INTERVIEW_STAGES]);
        const preChecked = new Set(
          (d.relatedApps || []).filter(a => ACTIVE.has(a.status)).map(a => a.id)
        );
        setCrossLogAppIds(preChecked);
        // Default the outreach stage from where the user actually is.
        setDraftStage(stageFromApps(d.relatedApps));
        setLoading(false);
        setComposing(false);
        setDraftResult(null);
      })
      .catch(() => setLoading(false));
  }, [id]);
  const toggleCrossLogApp = (appId) => setCrossLogAppIds(prev => {
    const n = new Set(prev);
    n.has(appId) ? n.delete(appId) : n.add(appId);
    return n;
  });
  useEffect(() => { load(); }, [load]);

  // ESC closes the standalone drawer. Skip in embedded mode so the host (the
  // Pipeline drawer) owns ESC and one keypress doesn't collapse both layers.
  useEffect(() => {
    if (embedded) return;
    const onKey = e => { if (e.key === "Escape" && !logModal && onClose) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, logModal, embedded]);

  const updateStatus = status => {
    window.tjkMutate(`/api/target-talent/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
      .then(() => { load(); onUpdate?.(); });
  };
  const saveNotes = () => {
    window.tjkMutate(`/api/target-talent/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) })
      .then(() => { load(); onUpdate?.(); });
  };
  const saveWebsite = () => {
    window.tjkMutate(`/api/target-talent/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website: website.trim() }) })
      .then(() => { setEditingWeb(false); load(); onUpdate?.(); });
  };
  const generateDraft = () => {
    setDrafting(true); setDraftResult(null);
    window.tjkMutate(`/api/target-talent/${id}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewStage: draftStage }),
    })
      .then(r => r.json())
      .then(d => { setDrafting(false); if (d.draft) setDraftResult(d.draft); })
      .catch(() => setDrafting(false));
  };
  const saveCorrAndClose = msg => {
    const appIds = (msg.direction === "Sent") ? Array.from(crossLogAppIds) : [];
    const body = {
      ...msg,
      alsoLogToAppNums: appIds.length ? appIds : undefined,
      // Backwards-compat: keep the single-id field populated with the first selected
      // app so server endpoints that only support one id still work.
      alsoLogToAppNum: appIds.length ? appIds[0] : undefined,
      alsoLogChannel: "Email",
    };
    window.tjkMutate(`/api/target-talent/${id}/correspondence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(() => { load(); onUpdate?.(); setLogModal(null); setDraftResult(null); });
  };

  if (loading || !data) {
    return <div style={{ padding: embedded ? "16px 2px" : 24, color: "var(--text-mute)" }}>Loading…</div>;
  }

  const corr = data.correspondence || [];
  const headStyle = embedded ? { paddingBottom: 12, borderBottom: "1px solid var(--border)" } : undefined;
  const bodyStyle = embedded
    ? { display: "flex", flexDirection: "column", gap: 20, paddingTop: 14 }
    : { flex: 1, overflow: "auto", padding: "18px 20px 28px", display: "flex", flexDirection: "column", gap: 20 };

  return (
    <>
      <div className={embedded ? "" : "drawer-head"} style={headStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>#{data.id}</span>
          <StatusBadge status={data.status} size="sm" />
          {data.relatedApps?.length > 0 && (
            <span className="tag accent">{data.relatedApps.length} related app{data.relatedApps.length !== 1 ? "s" : ""}</span>
          )}
          {onClose && (embedded
            ? <button className="btn ghost sm" onClick={onClose} style={{ marginLeft: "auto" }}>← Back</button>
            : <button className="icon-btn" onClick={onClose} style={{ marginLeft: "auto" }}><TIcon d={TI.x} size={15} /></button>)}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 13 }}>
          <span className="mono-av" style={{ width: 44, height: 44, fontSize: 14, borderRadius: 10, borderColor: (TT_STATUS_MAP[data.status] || {}).color, color: (TT_STATUS_MAP[data.status] || {}).color }}>{ttInitials(data.first + " " + data.last)}</span>
          <div>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{data.salute} {data.first} {data.last}</h3>
            <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginTop: 2 }}>{data.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--accent)", marginTop: 3, fontWeight: 500 }}>{data.company}</div>
          </div>
        </div>
      </div>
      <div className={embedded ? "" : "drawer-body"} style={bodyStyle}>
        {/* Contact info */}
        <div className="ds-section">
          <div className="ds-label"><TIcon d={TI.building} size={12} /> Contact</div>
          <div className="info-card">
            <div className="info-row">
              <span className="ik">Website</span>
              {editingWeb ? (
                <>
                  <input className="iv" value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://company.com"
                    style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 6px", color: "var(--text)", fontSize: 12, minWidth: 0 }} />
                  <button className="btn primary sm" onClick={saveWebsite}>Save</button>
                </>
              ) : (() => {
                const stored = (data.website || "").trim();
                const guess = ttDomain(data.email);
                const href = stored ? (stored.startsWith("http") ? stored : "https://" + stored) : (guess ? "https://" + guess : "");
                return (
                  <>
                    {href
                      ? <a className="iv link" href={href} target="_blank" rel="noreferrer">{stored || guess}{!stored && guess ? <span style={{ color: "var(--text-mute)", marginLeft: 5, fontSize: 10 }}>(from email)</span> : null}</a>
                      : <span className="iv" style={{ color: "var(--text-mute)" }}>—</span>}
                    <button className="copy-btn" onClick={() => { setWebsite(stored); setEditingWeb(true); }}><TIcon d={TI.pen} size={11} /> Edit</button>
                  </>
                );
              })()}
            </div>
            <div className="info-row">
              <span className="ik">Email</span>
              <span className="iv">
                {data.email || "—"}
                {(() => {
                  const n = data.notes || "";
                  const bounced  = /EMAIL BOUNCED|bounced/i.test(n);
                  const unverified = !bounced && /email unverified|pattern-med|pattern-low|auto-synthesized/i.test(n);
                  if (!data.email && !bounced) return null;
                  if (bounced) return <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 4, background: "rgba(239,68,68,0.18)", color: "#fca5a5", fontSize: 10, fontWeight: 600, letterSpacing: 0.4 }} title="See notes for details">BOUNCED</span>;
                  if (unverified) return <span style={{ marginLeft: 8, padding: "1px 6px", borderRadius: 4, background: "rgba(234,179,8,0.18)", color: "#fde68a", fontSize: 10, fontWeight: 600, letterSpacing: 0.4 }} title="Auto-synthesized. Confirm before sending">UNVERIFIED</span>;
                  return null;
                })()}
              </span>
              {data.email && <CopyBtn value={data.email} />}
            </div>
            {data.phone && (
              <div className="info-row">
                <span className="ik">Phone</span>
                <span className="iv">{data.phone}</span>
                <CopyBtn value={data.phone} />
              </div>
            )}
            <div className="info-row">
              <span className="ik">Location</span>
              <span className="iv">{[data.city, data.state].filter(Boolean).join(", ") || "—"}</span>
              <span />
            </div>
            <div className="info-row">
              <span className="ik">LinkedIn</span>
              {data.linkedin
                ? <a className="iv link" href={data.linkedin} target="_blank" rel="noreferrer">View profile</a>
                : <span className="iv" style={{ color: "var(--text-mute)" }}>—</span>}
              {data.linkedin && <a className="copy-btn" href={data.linkedin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}><TIcon d={TI.ext} size={11} /> Open</a>}
            </div>
            <div className="info-row">
              <span className="ik">Last touch</span>
              <span className="iv" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{data.lastTouch || "—"}</span>
              <span />
            </div>
          </div>
        </div>
        {/* Pipeline */}
        <div className="ds-section">
          <div className="ds-label"><TIcon d={TI.trend} size={12} /> Pipeline stage</div>
          <PipelineTrack contact={data} onChange={updateStatus} />
        </div>
        {/* Related apps */}
        {data.relatedApps?.length > 0 && (
          <div className="ds-section">
            <div className="ds-label"><TIcon d={TI.briefcase} size={12} /> Related applications at {data.company}<span className="r">{data.relatedApps.length}</span></div>
            {data.relatedApps.map((a, i) => (
              <div className="relapp" key={i}>
                <span className="ra-id">#{a.id}</span>
                <span className="ra-role">{a.role}</span>
                <span className="ra-score">
                  <span className="ra-bar"><i style={{ width: `${(parseFloat(a.score) / 5) * 100}%` }} /></span>{a.score}
                </span>
                <span className="tag">{a.status}</span>
              </div>
            ))}
          </div>
        )}
        {/* Notes */}
        <div className="ds-section">
          <div className="ds-label"><TIcon d={TI.pen} size={12} /> Notes{notes !== (data.notes || "") && <button className="btn primary sm" style={{ marginLeft: "auto" }} onClick={saveNotes}>Save</button>}</div>
          <textarea className="notes-ta" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add a note…" />
        </div>
        {/* Outreach */}
        <div className="ds-section">
          <div className="ds-label">
            <TIcon d={TI.spark} size={12} /> Outreach
            <select value={draftStage} onChange={e => setDraftStage(e.target.value)} title="Tune the draft for where you are in the process"
              style={{ marginLeft: "auto", fontSize: 11.5, padding: "3px 6px", borderRadius: 5, background: "var(--panel-2)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
              {TT_STAGE_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          {!composing && !draftResult && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary sm" onClick={() => { setComposing(true); generateDraft(); }}><TIcon d={TI.spark} size={12} /> Draft</button>
              <button className="btn sm" onClick={() => setLogModal({ direction: "Sent", subject: "", body: "" })}><TIcon d={TI.outbound} size={12} /> Log sent</button>
              <button className="btn sm" onClick={() => setLogModal({ direction: "Received", subject: "", body: "" })}><TIcon d={TI.inbound} size={12} /> Log reply</button>
            </div>
          )}
          {composing && drafting && (
            <div className="ai-loading"><span className="scan-ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> drafting…</div>
          )}
          {draftResult && (() => {
            const cleanBody = (draftResult.body || "").replace(/^\s+/, "");
            const fullEmail = `Hi ${data.first},\n\n${cleanBody}\n\n${window.myEmailSignature()}`;
            return (
            <div className="ai-compose">
              <div className="ai-head"><TIcon d={TI.spark} size={13} /> AI draft</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                <span>Subject: {draftResult.subject}</span>
                <CopyBtn value={draftResult.subject || ""} />
              </div>
              <div style={{ position: "relative" }}>
                <div className="ai-out">{fullEmail}</div>
                <div style={{ position: "absolute", top: 8, right: 8 }}>
                  <CopyBtn value={fullEmail} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn primary sm" onClick={() => setLogModal({ direction: "Sent", subject: draftResult.subject, body: fullEmail })}><TIcon d={TI.check} size={12} /> I sent this</button>
                <button className="btn sm" onClick={() => saveCorrAndClose({ direction: "Draft", subject: draftResult.subject, body: fullEmail })}><TIcon d={TI.pen} size={12} /> Save as draft</button>
                <button className="btn sm" onClick={generateDraft}><TIcon d={TI.refresh} size={12} /> Regen</button>
              </div>
            </div>
            );
          })()}
        </div>
        {/* Correspondence */}
        <div className="ds-section">
          <div className="ds-label"><TIcon d={TI.mail} size={12} /> Correspondence<span className="r">{corr.length} message{corr.length !== 1 ? "s" : ""}</span></div>
          {corr.length === 0
            ? <div className="empty" style={{ padding: "8px 2px" }}>No messages yet. Draft one to get started.</div>
            : <div className="thread">{corr.slice().reverse().map((m, i) => <MsgNode key={i} m={m} />)}</div>}
        </div>
      </div>
      {/* Log modal */}
      {logModal && (
        <div className="modal-back" onClick={() => setLogModal(null)}>
          <div className="modal" style={{ width: 600 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head" style={{ padding: "18px 22px 14px" }}>
              <div className="modal-head-top"><h2>Log {logModal.direction} Message</h2>
                <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={() => setLogModal(null)}><TIcon d={TI.x} size={15} /></button>
              </div>
            </div>
            <div className="modal-body" style={{ padding: "14px 22px" }}>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Subject</label>
                <input className="inp" value={logModal.subject} onChange={e => setLogModal({ ...logModal, subject: e.target.value })} placeholder="Subject" />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Message body</label>
                <textarea className="ta" value={logModal.body} onChange={e => setLogModal({ ...logModal, body: e.target.value })} placeholder="Message body…" rows={8} />
              </div>
              {logModal.direction === "Sent" && data?.relatedApps?.length > 0 && (
                <div style={{ padding: 12, background: "var(--panel)", borderRadius: 8, marginBottom: 12 }}>
                  <div className="ds-label" style={{ marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                    <span>Cross-log as follow-up</span>
                    <span className="mono dim" style={{ fontSize: 10.5 }}>
                      {crossLogAppIds.size}/{data.relatedApps.length} selected
                    </span>
                  </div>
                  <div className="dim mono" style={{ fontSize: 10.5, marginBottom: 8 }}>
                    This touch will also be logged as a follow-up on each selected application. Active roles pre-checked.
                  </div>
                  <div className="col" style={{ gap: 5 }}>
                    {data.relatedApps.map(a => {
                      const checked = crossLogAppIds.has(a.id);
                      return (
                        <label key={a.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "7px 9px", background: "var(--panel-2)",
                            borderRadius: 4, cursor: "pointer",
                            borderLeft: `3px solid ${checked ? "var(--green)" : "var(--text-mute)"}`,
                          }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleCrossLogApp(a.id)} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              #{a.id} · {a.role}
                            </div>
                            <div className="dim" style={{ fontSize: 10.5, marginTop: 1 }}>
                              Status: {a.status}{a.score != null ? ` · Score ${a.score}` : ""}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
            <div className="modal-foot">
              <div className="right">
                <button className="btn" onClick={() => setLogModal(null)}>Cancel</button>
                <button className="btn primary" onClick={() => saveCorrAndClose(logModal)} disabled={!logModal.subject || !logModal.body}>
                  Save{logModal.direction === "Sent" && crossLogAppIds.size > 0
                    ? ` + log ${crossLogAppIds.size} follow-up${crossLogAppIds.size === 1 ? "" : "s"}`
                    : ""}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
// Shared so the Pipeline drawer's Contacts tab renders the same panel inline.
window.ContactPanel = ContactPanel;

// Thin drawer shell around ContactPanel for the TA Outreach tab.
function TTDrawer({ id, onClose, onUpdate }) {
  const open = id != null;
  return (
    <>
      <div className={"drawer-backdrop" + (open ? " open" : "")} onClick={onClose} style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }} />
      <div className={"drawer wide" + (open ? " open" : "")} style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}>
        {open && <ContactPanel id={id} onClose={onClose} onUpdate={onUpdate} />}
      </div>
    </>
  );
}

// ── Reconcile modal ──────────────────────────────────────────────────────────
function RecRow({ checked, onToggle, av, name, meta, reason, right }) {
  return (
    <div className={"rec-row" + (checked ? " on" : "")} onClick={onToggle}>
      <span style={{ width: 16, height: 16, border: "1.5px solid var(--border-2)", borderRadius: 4, display: "grid", placeItems: "center", background: checked ? "var(--accent)" : "transparent", borderColor: checked ? "var(--accent)" : "var(--border-2)" }}>
        {checked && <TIcon d={TI.check} size={10} style={{ color: "#15101f" }} stroke={3} />}
      </span>
      <span className="mono-av sm" style={{ background: "var(--panel)", color: "var(--accent)", borderRadius: 7 }}>{av}</span>
      <div style={{ minWidth: 0 }}>
        <div className="rr-name">{name}</div>
        {meta && <div className="rr-meta">{meta}</div>}
        {reason && <div className="rr-reason">{reason}</div>}
      </div>
      <div>{right}</div>
    </div>
  );
}

// ── Per-company contact finder ────────────────────────────────────────────────
// A compact discover→pick→add flow scoped to ONE company. Used inline in the
// Pipeline drawer's Contacts tab so the user can fill a single company's gap
// (~3K tokens) instead of running the full multi-company batch Reconcile.
// Exposed on window so the Pipeline drawer can render it.
function FindContactsPanel({ company, exampleRole, onAdded, onCancel }) {
  const [phase, setPhase] = useState("idle"); // idle | scanning | review | adding | done
  const [suggestions, setSuggestions] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [error, setError] = useState(null);
  const [addedCount, setAddedCount] = useState(0);

  const keyOf = (s) => `${s.first || ""} ${s.last || ""}`.trim();

  const runDiscover = () => {
    setPhase("scanning"); setError(null);
    window.tjkMutate("/api/tt-reconcile/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies: [{ company, exampleRole: exampleRole || "" }] }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || d.error) { setError(d.error || "Discovery failed."); setPhase("idle"); return; }
        const sug = (d.results || []).flatMap(r => r.suggestions || []);
        setSuggestions(sug);
        const pre = new Set(sug.filter(s => ["high", "medium"].includes((s.confidence || "low").toLowerCase())).map(keyOf));
        setSel(pre);
        setPhase("review");
      })
      .catch(e => { setError(e.message); setPhase("idle"); });
  };

  const toggle = (k) => setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const add = () => {
    const contacts = suggestions.filter(s => sel.has(keyOf(s))).map(s => ({
      company, first: s.first || "", last: s.last || "", title: s.title || "",
      city: s.city || "", state: s.state || "", linkedin: s.linkedin || "",
      notes: [s.notes, `Added via Find contacts (confidence: ${s.confidence || "unknown"})`].filter(Boolean).join(" · "),
    }));
    if (contacts.length === 0) { onCancel?.(); return; }
    setPhase("adding");
    window.tjkMutate("/api/tt-reconcile/bulk-add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts }) })
      .then(r => r.json())
      .then(d => { setAddedCount(d.written || contacts.length); setPhase("done"); onAdded?.(); })
      .catch(e => { setError(e.message); setPhase("review"); });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--panel)" }}>
      <div className="ds-label" style={{ marginBottom: 8 }}>
        <TIcon d={TI.users} size={12} /> Find contacts at {company}
        {onCancel && phase !== "done" && <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onCancel}>Cancel</button>}
      </div>
      {error && <div style={{ padding: 8, background: "rgba(239,68,68,0.12)", color: "var(--red)", borderRadius: 4, marginBottom: 8, fontSize: 11.5 }}>{error}</div>}

      {phase === "idle" && (
        <>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
            Search the web for 2-3 current Talent Acquisition contacts at this one company. One lookup, low usage.
          </div>
          <button className="btn primary sm" onClick={runDiscover}><TIcon d={TI.spark} size={12} /> Find contacts</button>
        </>
      )}

      {phase === "scanning" && (
        <div className="scan" style={{ padding: "10px 0" }}>
          <div className="scan-ring" />
          <div className="scan-log">Searching for TA contacts at {company}…</div>
        </div>
      )}

      {phase === "review" && (
        <>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
            {suggestions.length === 0 ? "No reliable contacts found." : `Found ${suggestions.length} · ${sel.size} selected`}
          </div>
          {suggestions.map((s, i) => {
            const k = keyOf(s);
            const conf = s.confidence || "Medium";
            return (
              <RecRow key={k + i} checked={sel.has(k)} onToggle={() => toggle(k)}
                av={ttInitials((s.first || "?") + " " + (s.last || "?"))} name={`${s.first} ${s.last}`}
                meta={s.title}
                reason={s.linkedin ? <a className="link" href={s.linkedin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", fontSize: 11 }}>LinkedIn ↗</a> : null}
                right={<span className={"conf " + conf}>{conf}</span>} />
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn primary sm" onClick={add} disabled={sel.size === 0}>Add {sel.size || ""} contact{sel.size === 1 ? "" : "s"}</button>
            <button className="btn sm" onClick={runDiscover}><TIcon d={TI.refresh} size={12} /> Search again</button>
          </div>
        </>
      )}

      {phase === "adding" && <div className="ai-loading"><span className="scan-ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> Adding…</div>}

      {phase === "done" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12.5, color: "var(--green)" }}><TIcon d={TI.check} size={13} /> Added {addedCount} contact{addedCount === 1 ? "" : "s"}.</span>
          {onCancel && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onCancel}>Done</button>}
        </div>
      )}
    </div>
  );
}
window.FindContactsPanel = FindContactsPanel;

const STEPS = ["Preview", "Discover", "Apply"];

function ReconcileModal({ onClose, onApplied }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState({ toArchive: [], companiesNeedingContacts: [] });
  const [archSel, setArchSel] = useState(new Set());
  const [gapSel, setGapSel] = useState(new Set());
  const [discoveries, setDiscoveries] = useState([]);
  const [discSel, setDiscSel] = useState(new Set());
  const [outcome, setOutcome] = useState(null);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    fetch("/api/tt-reconcile/preview")
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setLoading(false); return; }
        setPreview(d);
        setArchSel(new Set((d.toArchive || []).map(x => x.id)));
        setGapSel(new Set((d.companiesNeedingContacts || []).map(c => c.company)));
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const toggleSet = (setter, key) => setter(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const runDiscover = async () => {
    setStep(1); setScanning(true); setError(null);
    const companies = preview.companiesNeedingContacts
      .filter(c => gapSel.has(c.company))
      .map(c => ({ company: c.company, exampleRole: c.exampleRole }));
    if (companies.length === 0) { setScanning(false); setDiscoveries([]); return; }
    // Server caps each call at 15 companies. Batch sequentially so very large
    // pipelines still complete without tripping the rate-limit guard, and
    // surface partial-failure errors instead of silently returning 0 contacts.
    const BATCH = 15;
    const all = [];
    const errs = [];
    try {
      for (let i = 0; i < companies.length; i += BATCH) {
        const slice = companies.slice(i, i + BATCH);
        const res = await window.tjkMutate("/api/tt-reconcile/discover", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: slice }),
        });
        const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        if (!res.ok || d.error) {
          errs.push(`batch ${Math.floor(i / BATCH) + 1}: ${d.error || `HTTP ${res.status}`}`);
          continue;
        }
        for (const r of (d.results || [])) all.push(r);
      }
      setDiscoveries(all);
      const pre = new Set();
      for (const r of all) {
        for (const s of (r.suggestions || [])) {
          const conf = (s.confidence || "low").toLowerCase();
          if (conf === "high" || conf === "medium") pre.add(`${r.company}::${s.first || ""} ${s.last || ""}`);
        }
      }
      setDiscSel(pre);
      if (errs.length) setError(`Discover finished with ${errs.length} partial error(s): ${errs.join("; ")}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  };

  const apply = async () => {
    setStep(2); setLoading(true);
    try {
      let archived = 0, added = 0, emailsFound = 0, verifierKeys = true;
      if (archSel.size > 0) {
        const r = await window.tjkMutate("/api/tt-reconcile/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: Array.from(archSel) }) });
        const d = await r.json();
        archived = d.archived || 0;
      }
      const toAdd = [];
      for (const r of discoveries) {
        for (const s of (r.suggestions || [])) {
          const key = `${r.company}::${s.first || ""} ${s.last || ""}`;
          if (!discSel.has(key)) continue;
          toAdd.push({ company: r.company, first: s.first || "", last: s.last || "", title: s.title || "", city: s.city || "", state: s.state || "", linkedin: s.linkedin || "", notes: [s.notes, `Auto-added via Reconcile (confidence: ${s.confidence || "unknown"})`].filter(Boolean).join(" · ") });
        }
      }
      if (toAdd.length > 0) {
        const r = await window.tjkMutate("/api/tt-reconcile/bulk-add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contacts: toAdd }) });
        const d = await r.json();
        added = d.written || 0;
        emailsFound = d.emailsFound || 0;
        verifierKeys = d.verifierKeys !== false;
      }
      setOutcome({ archived, added, emailsFound, verifierKeys });
      setLoading(false);
      onApplied?.();
    } catch (e) { setError(e.message); setLoading(false); }
  };

  const confColor = { High: "var(--green)", Medium: "var(--orange)", Low: "var(--red)" };

  return (
    <div className="modal-back" onClick={() => !scanning && !loading && onClose()}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-head-top">
            <span className="mono-av sm" style={{ background: "var(--accent-bg)", color: "var(--accent)", borderRadius: 7, borderColor: "rgba(167,139,250,0.4)" }}><TIcon d={TI.refresh} size={14} /></span>
            <div><h2>Reconcile contacts</h2><div className="sub">sync your TA list against the live application pipeline</div></div>
            <button className="icon-btn" style={{ marginLeft: "auto" }} onClick={onClose}><TIcon d={TI.x} size={15} /></button>
          </div>
          <div className="stepper">
            {STEPS.map((label, i) => (
              <React.Fragment key={label}>
                <div className={"step" + (i === step ? " active" : i < step ? " done" : "")}>
                  <span className="step-dot">{i < step ? <TIcon d={TI.check} size={13} stroke={3} /> : i + 1}</span>
                  <span className="step-lbl">{label}</span>
                </div>
                {i < STEPS.length - 1 && <span className={"step-line" + (i < step ? " done" : "")} />}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div className="modal-body">
          {error && <div style={{ padding: 10, background: "rgba(239,68,68,0.12)", color: "var(--red)", borderRadius: 4, marginBottom: 12, fontSize: 12 }}>Error: {error}</div>}

          {step === 0 && (
            <div className="fade-up">
              {loading ? <div className="ai-loading"><span className="scan-ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> Analyzing applications + TA contacts…</div> : <>
                <div className="rec-section-label"><TIcon d={TI.flag} size={12} /> Archive candidates &middot; {archSel.size} selected</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>Contacts at companies with no active applications.</div>
                {preview.toArchive.length === 0
                  ? <div className="empty" style={{ padding: "12px 0" }}>No contacts to archive.</div>
                  : preview.toArchive.map(c => (
                    <RecRow key={c.id} checked={archSel.has(c.id)} onToggle={() => toggleSet(setArchSel, c.id)}
                      av={ttInitials((c.first || "") + " " + (c.last || ""))} name={`${c.first} ${c.last}`}
                      meta={`${c.title} · ${c.company}`} right={<StatusBadge status={c.status || "Dormant"} size="sm" />} />
                  ))}
                <div className="rec-section-label" style={{ marginTop: 22 }}><TIcon d={TI.building} size={12} /> Companies needing contacts &middot; {gapSel.size} selected</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>Companies in your pipeline with no TA contact yet.</div>
                {preview.companiesNeedingContacts.length === 0
                  ? <div className="empty" style={{ padding: "12px 0" }}>All companies covered.</div>
                  : preview.companiesNeedingContacts.map(c => (
                    <RecRow key={c.company} checked={gapSel.has(c.company)} onToggle={() => toggleSet(setGapSel, c.company)}
                      av={<TIcon d={TI.building} size={13} />} name={c.company}
                      meta={`${c.exampleRole} (${c.mostRecentApp?.status || "?"} · ${c.mostRecentApp?.date || "?"})`}
                      reason={`${c.appCount} active app${c.appCount === 1 ? "" : "s"}, no TA contact`}
                      right={<span className="tag accent">{c.appCount} app{c.appCount !== 1 ? "s" : ""}</span>} />
                  ))}
              </>}
            </div>
          )}
          {step === 1 && (
            <div className="fade-up">
              {scanning ? (
                <div className="scan">
                  <div className="scan-ring" />
                  <div className="scan-log">Searching for TA contacts at {gapSel.size} companies…</div>
                </div>
              ) : (
                <>
                  <div className="rec-section-label"><TIcon d={TI.users} size={12} /> Discovered contacts &middot; {discSel.size} selected</div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>Found {discoveries.reduce((n, r) => n + (r.suggestions || []).length, 0)} contacts.</div>
                  {discoveries.map(r => (r.suggestions || []).map((s, i) => {
                    const key = `${r.company}::${s.first || ""} ${s.last || ""}`;
                    const conf = s.confidence || "Medium";
                    return (
                      <RecRow key={key} checked={discSel.has(key)} onToggle={() => toggleSet(setDiscSel, key)}
                        av={ttInitials((s.first || "?") + " " + (s.last || "?"))} name={`${s.first} ${s.last}`}
                        meta={`${s.title} · ${r.company}`}
                        reason={s.linkedin ? <a className="link" href={s.linkedin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", fontSize: 11 }}>LinkedIn ↗</a> : null}
                        right={<span className={"conf " + conf}>{conf}</span>} />
                    );
                  }))}
                </>
              )}
            </div>
          )}
          {step === 2 && (
            <div className="fade-up" style={{ textAlign: "center", padding: "12px 0" }}>
              {loading ? <div className="ai-loading" style={{ justifyContent: "center" }}><span className="scan-ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> Applying changes and verifying emails…</div> : <>
                <div className="apply-done-icon"><TIcon d={TI.check} size={26} stroke={3} /></div>
                <h2 style={{ fontSize: 17, margin: "0 0 6px" }}>Reconcile complete</h2>
                <div style={{ fontSize: 12.5, color: "var(--text-dim)", marginBottom: 18 }}>
                  Your TA list is now in sync with the application pipeline.
                </div>
                {outcome && (
                  <div className="apply-grid" style={{ maxWidth: 480, margin: "0 auto" }}>
                    <div className="apply-tile"><div className="at-v" style={{ color: "var(--orange)" }}>{outcome.archived}</div><div className="at-k">Archived</div></div>
                    <div className="apply-tile"><div className="at-v" style={{ color: "var(--green)" }}>{outcome.added}</div><div className="at-k">Contacts added</div></div>
                    <div className="apply-tile"><div className="at-v" style={{ color: "var(--accent)" }}>{outcome.emailsFound || 0}</div><div className="at-k">Emails verified</div></div>
                  </div>
                )}
                {outcome && outcome.verifierKeys === false && outcome.added > 0 && (
                  <div style={{ fontSize: 11.5, color: "var(--orange)", maxWidth: 440, margin: "12px auto 0", lineHeight: 1.6 }}>
                    Email finding was skipped. Set <b>HUNTER_API_KEY</b> and <b>MILLIONVERIFIER_API_KEY</b> in
                    dashboard-web/.env to auto-find and verify addresses for new contacts.
                  </div>
                )}
                {outcome && (outcome.archived > 0 || outcome.added > 0) && (
                  <div style={{ fontSize: 11.5, color: "var(--text-mute)", maxWidth: 440, margin: "16px auto 0", lineHeight: 1.65 }}>
                    These changes are saved. New contacts got a <b>verified</b> email wherever one could be
                    found and confirmed deliverable (Hunter into MillionVerifier); anyone without one goes
                    to the LinkedIn fallback. Archived contacts are not deleted: they stay behind <b>Show
                    archived</b>. To change either, open the contact and set its stage.
                  </div>
                )}
              </>}
            </div>
          )}
        </div>
        <div className="modal-foot">
          {step > 0 && step < 2 && <button className="btn" onClick={() => setStep(s => s - 1)}><TIcon d={TI.undo} size={13} /> Back</button>}
          {step === 0 && !loading && <span className="mono" style={{ fontSize: 11, color: "var(--text-mute)" }}>{archSel.size} to archive &middot; {gapSel.size} to search</span>}
          <div className="right" style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {step === 0 && !loading && <button className="btn primary" onClick={runDiscover}>Discover contacts <TIcon d={TI.arrowR} size={13} /></button>}
            {step === 1 && !scanning && <button className="btn primary" onClick={apply}>Apply changes <TIcon d={TI.arrowR} size={13} /></button>}
            {/* No Undo. It used to flip a local boolean and assert "Changes
                reverted" while the archive and bulk-add writes stayed on disk;
                there is no revert endpoint, and inventing one would have to
                invert two different writes against a user-layer file. The
                completion panel now states plainly what changed and where to
                adjust it instead. */}
            {step === 2 && !loading && <button className="btn primary" onClick={onClose}>Done</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Root component ───────────────────────────────────────────────────────────
// TA Outreach is a single view (the Contacts table). The old Overview subtab was
// removed, so the tab opens straight to the contacts list — no subtab bar.
window.TargetTalentTab = function TargetTalentTab({ initialOpenId, onInitialOpenConsumed, search } = {}) {
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drawerId, setDrawerId] = useState(null);
  const [reconcileOpen, setReconcileOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/target-talent")
      .then(r => r.json())
      .then(data => { setContacts(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Honor `initialOpenId` from a cross-tab hand-off (e.g. a Follow-Ups TA row
  // click). Open the drawer once, then notify the parent so the prop clears.
  useEffect(() => {
    if (initialOpenId != null) {
      setDrawerId(initialOpenId);
      onInitialOpenConsumed && onInitialOpenConsumed();
    }
  }, [initialOpenId, onInitialOpenConsumed]);

  if (loading && contacts.length === 0) return <div style={{ padding: 20, color: "var(--text-dim)" }}>Loading TA Outreach data…</div>;

  return (
    <div style={{ flex: 1, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <ContactsTableView contacts={contacts} onOpen={setDrawerId} selId={drawerId} onReconcile={() => setReconcileOpen(true)} search={search} onImported={load} />

      {drawerId != null && <TTDrawer id={drawerId} onClose={() => setDrawerId(null)} onUpdate={load} />}
      {reconcileOpen && <ReconcileModal onClose={() => setReconcileOpen(false)} onApplied={load} />}
    </div>
  );
};

// Legacy exports for compatibility
window.TargetTalentDrawer = TTDrawer;
window.ReconcileModal = ReconcileModal;
