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

const INFLUENCE_TIER_LABELS = Object.freeze({
  hm: "Hiring manager",
  exec: "Skip-level exec",
  peer: "Functional peer",
  ta: "Talent acquisition",
  agency: "Agency recruiter",
});
const INFLUENCE_TIER_SHORT_LABELS = Object.freeze({
  hm: "HM",
  exec: "Exec",
  peer: "Peer",
  ta: "TA",
  agency: "Agency",
});

function InfluenceTierBadge({ tier, source }) {
  const confirmed = source === "tag";
  return (
    <span className="tag" title={confirmed ? "Set by you" : "Not confirmed yet"}
      style={{ flex: "none", fontSize: 9.5, opacity: confirmed ? 1 : 0.5 }}>
      {INFLUENCE_TIER_SHORT_LABELS[tier] || tier || "?"}
    </span>
  );
}

// ── LinkedIn connection axis ──────────────────────────────────────────────────
// SEPARATE from the outreach pipeline above. The pipeline tracks how far the
// CONVERSATION has progressed; this tracks whether they accepted your LinkedIn
// invite — a different question (someone can accept while the conversation is
// still at "Sent, no reply"). LinkedIn-brand blue for the connected state, so it
// never reads as the pipeline's green "Connected". Stored server-side in a
// sidecar (server/lib/tt-linkedin.mjs), not in the contact row.
const TT_LINKEDIN = [
  { id: "Not Connected",  short: "Not connected",  color: "var(--text-mute)", rgb: "113,113,122" },
  { id: "Invite Pending", short: "Invite pending", color: "var(--yellow)",    rgb: "234,179,8"   },
  { id: "Connected",      short: "Connected",      color: "var(--blue)",      rgb: "96,165,250"  },
];
const TT_LINKEDIN_MAP = Object.fromEntries(TT_LINKEDIN.map(s => [s.id, s]));
const TT_LINKEDIN_RANK = Object.fromEntries(TT_LINKEDIN.map((s, i) => [s.id, i]));

function LinkedInBadge({ status, size = "md" }) {
  const m = TT_LINKEDIN_MAP[status] || TT_LINKEDIN_MAP["Not Connected"];
  const sm = size === "sm";
  const connected = m.id !== "Not Connected";
  return React.createElement("span", {
    className: "status-badge",
    title: m.id === "Connected" ? "You're connected on LinkedIn"
      : m.id === "Invite Pending" ? "Invite sent, not yet accepted"
      : "No LinkedIn connection",
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
      style: { background: m.color, boxShadow: connected ? `0 0 6px ${m.color}` : "none" }
    }),
    m.short
  );
}

// ── Icons (stroke paths, 24x24 viewBox) ──────────────────────────────────────
// Canonical paths in shared.jsx (window.ICON). Local TI alias preserves call sites.
const TI = window.ICON;

function TIcon({ d, size = 16, stroke = 1.6, style }) {
  return React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: stroke, strokeLinecap: "round", strokeLinejoin: "round", style }, React.createElement("path", { d }));
}

function ttInitials(name) {
  const parts = String(name || "").replace(/['"]/g, "").split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function ttDomain(email) {
  if (!email) return "";
  const parts = email.split("@");
  return parts.length > 1 ? parts[1] : "";
}

function relTouch(d) {
  if (!d) return "-";
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
// Live Hunter (email-finder searches) + MillionVerifier (verifications) credit
// balances, so you know when to top up before a reconcile drains them. Fetched
// once on mount. Each side is { configured, left }: no key, unknown (key set but
// balance unreadable), or a number that goes orange when low and red at zero.
function CreditBalances() {
  const [bal, setBal] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/tt-reconcile/credit-balances").then(r => r.json())
      .then(d => { if (alive && d && !d.error) setBal(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!bal) return null;
  const chip = (label, info) => {
    if (!info || !info.configured) return <span style={{ color: "var(--text-mute)" }} title={`${label} API key not set in dashboard-web/.env`}>{label}: <span className="mono">no key</span></span>;
    if (info.left == null) return <span style={{ color: "var(--text-mute)" }} title="Balance couldn't be read right now">{label}: <span className="mono">unknown</span></span>;
    const n = info.left;
    const color = n <= 0 ? "var(--red)" : n <= 25 ? "var(--orange)" : "var(--text-mute)";
    return <span style={{ color }} title={n <= 0 ? `${label} is out — top up the account` : n <= 25 ? `${label} running low — consider topping up` : `${label} credits remaining`}>{label}: <span className="mono" style={{ fontWeight: 600 }}>{n.toLocaleString()}</span>{n <= 0 ? " — out" : ""}</span>;
  };
  return (
    <div className="sub" style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 3, flexWrap: "wrap" }}>
      <span style={{ opacity: .7 }}>Email-finder credits:</span>
      {chip("Hunter", bal.hunter)}
      <span style={{ opacity: .4 }}>·</span>
      {chip("MillionVerifier", bal.millionVerifier)}
    </div>
  );
}

function ContactsTableView({ contacts, onOpen, selId, onReconcile, search, onImported }) {
  const [showArchived, setShowArchived] = useState(false);
  const [statusFilter, setStatusFilter] = useState(null);
  const [companyFilter, setCompanyFilter] = useState("");
  const [hvOnly, setHvOnly] = useState(false);   // high-value = reachable both ways (email + LinkedIn)
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
    if (hvOnly) r = r.filter(c => c.isHighValue);
    if (q.trim()) {
      const t = q.toLowerCase();
      r = r.filter(c => `${c.first} ${c.last} ${c.company} ${c.title}`.toLowerCase().includes(t));
    }
    return r;
  }, [contacts, active, showArchived, statusFilter, companyFilter, hvOnly, q]);

  const sortVal = (c, key) => {
    switch (key) {
      case "name":     return `${c.first || ""} ${c.last || ""}`.toLowerCase();
      case "title":    return (c.title || "").toLowerCase();
      case "company":  return (c.company || "").toLowerCase();
      case "location": return `${c.state || ""} ${c.city || ""}`.toLowerCase();
      case "status":   return (TT_STATUS_MAP[c.status] || { stage: -2 }).stage;
      case "linkedin": return TT_LINKEDIN_RANK[c.linkedinStatus] ?? 0;
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

  const hasFilters = statusFilter || companyFilter || hvOnly || q.trim();
  const hvCount = active.filter(c => c.isHighValue).length;

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
    { k: "linkedin", label: "LinkedIn",   w: 130 },
    { k: "last",     label: "Last touch", w: 110 },
  ];

  return (
    <div className="fade-up">
      <div className="ta-head">
        <div>
          <h1>TA Outreach</h1>
          <div className="sub">{active.length} active contacts &middot; {companies.length} companies &middot; {archivedCount} archived</div>
          <CreditBalances />
        </div>
        <div className="act">
          <label className="btn" style={{ cursor: "pointer" }}>
            {/* Real checkbox, visually hidden: clicking the label (icon or text)
                toggles it natively, it is keyboard-operable (Space), and screen
                readers announce it. The styled box below is decorative. */}
            <input type="checkbox" checked={showArchived} onChange={() => setShowArchived(v => !v)}
              style={{ position: "absolute", opacity: 0, width: 0, height: 0 }} />
            <span aria-hidden="true"
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
          <button className={"btn ghost sm" + (hvOnly ? " active" : "")} onClick={() => setHvOnly(v => !v)}
            title="High value = reachable both ways (a verified email and a LinkedIn handle). The best contacts to multithread."
            style={hvOnly ? { color: "var(--yellow)", borderColor: "var(--yellow)" } : undefined}>
            ★ High value <span className="mono" style={{ opacity: 0.7, marginLeft: 2 }}>{hvCount}</span>
          </button>
          {hasFilters && (
            <button className="btn ghost sm" onClick={() => { setStatusFilter(null); setCompanyFilter(""); setHvOnly(false); }}>
              <TIcon d={TI.x} size={12} /> Clear
            </button>
          )}
          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)", letterSpacing: ".06em" }}>
            sorted by {cols.find(c => c.k === sortKey)?.label.toLowerCase()} &middot; click a row for details
          </span>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: "calc(100vh - 360px)", border: "none", borderRadius: 0, background: "transparent" }}>
          <table className="tbl ssi-tbl">
            <thead>
              <tr>
                {cols.map(c => (
                  <th key={c.k} style={{ width: c.w }} className={sortKey === c.k ? "sorted" : ""} role="button" tabIndex={0} aria-sort={sortKey === c.k ? (sortDir === "asc" ? "ascending" : "descending") : "none"} onClick={() => setSort(c.k)} onKeyDown={window.kbdActivate(() => setSort(c.k))}>
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
                  <tr key={c.id} className={selId === c.id ? "selected" : ""} tabIndex={0} onKeyDown={window.kbdActivate(() => onOpen(c.id))} onClick={() => onOpen(c.id)}>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                        <div className="mono-av sm" style={{ borderColor: m.color, color: m.color, flex: "none" }}>{ttInitials(c.first + " " + c.last)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.first} {c.last}</div>
                        {c.isHighValue && <span title="Can move this hire" style={{ flex: "none", color: "var(--yellow)", fontSize: 12 }}>★</span>}
                        <InfluenceTierBadge tier={c.influenceTier} source={c.influenceTierSource} />
                      </div>
                    </td>
                    <td title={c.title || "No job title recorded for this contact"}>
                      <span style={{ fontSize: 12, color: "var(--text-dim)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} aria-label={c.title || "No job title recorded"}>{c.title || "-"}</span>
                    </td>
                    <td title={c.company || ""}>
                      <span style={{ fontWeight: 600, fontSize: 12, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.company}</span>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, color: loc ? "var(--text-dim)" : "var(--text-mute)" }} title={loc || "No location recorded for this contact"} aria-label={loc || "No location recorded"}>{loc || "-"}</span>
                    </td>
                    <td><StatusBadge status={c.status} size="sm" /></td>
                    <td><LinkedInBadge status={c.linkedinStatus} size="sm" /></td>
                    <td>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: c.lastTouch ? "var(--text-dim)" : "var(--text-mute)" }} title={c.lastTouch ? relTouch(c.lastTouch) : "Never contacted"} aria-label={c.lastTouch ? relTouch(c.lastTouch) : "Never contacted"}>{c.lastTouch ? relTouch(c.lastTouch) : "-"}</span>
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

// LinkedIn connection selector — three-state segmented control, its own axis
// separate from the outreach pipeline. The active state is tinted with the same
// palette as LinkedInBadge so the control and the table badge always agree.
function LinkedInControl({ status, onChange }) {
  const cur = status || "Not Connected";
  return (
    <div>
      <div style={{ display: "flex", gap: 6 }}>
        {TT_LINKEDIN.map(s => {
          const on = cur === s.id;
          return (
            <button key={s.id} className="btn sm" onClick={() => onChange(s.id)}
              title={s.id === "Connected" ? "They accepted your invite — you're connected"
                : s.id === "Invite Pending" ? "Invite sent, waiting on them to accept"
                : "No LinkedIn connection yet"}
              style={{
                flex: 1,
                color: s.color,
                borderColor: on ? s.color : "var(--border)",
                background: on ? `rgba(${s.rgb},0.14)` : "transparent",
                fontWeight: on ? 600 : 400,
              }}>
              {s.short}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>
        Did they accept your LinkedIn invite? Separate from the pipeline stage above. Sending an invite from the Connect queue sets this to Invite Pending automatically.
      </div>
    </div>
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
  const kindLabels = { "invite-sent": "Invite sent", "invite-accepted": "Invite accepted", "dm-sent": "DM sent", "email-sent": "Email sent", "reply-received": "Reply received", engagement: "Engagement" };
  if (m.kind === "invite-accepted") return (
    <div className="msg" style={{ color: "var(--green)" }}>
      <div className="msg-node" style={{ borderColor: "var(--green)", color: "var(--green)" }}><TIcon d={TI.check} size={11} /></div>
      <div className="msg-head"><span className="msg-dir in">Invite accepted</span><span className="msg-subj">TA Outreach</span><span className="msg-date">{m.at || m.timestamp}</span></div>
    </div>
  );
  const dir = m.direction === "Received" ? "in" : m.direction === "Draft" ? "draft" : "out";
  const icon = dir === "in" ? TI.inbound : dir === "draft" ? TI.pen : TI.outbound;
  const color = dir === "in" ? "var(--cyan)" : dir === "draft" ? "var(--accent)" : "var(--blue)";
  const label = dir === "in" ? "Received" : dir === "draft" ? "Draft" : "Sent";
  return (
    <div className="msg">
      <div className="msg-node" style={{ borderColor: color, color }}><TIcon d={icon} size={11} /></div>
      <div className="msg-head">
        <span className={"msg-dir " + dir}>{m.kind ? kindLabels[m.kind] || m.kind : label}</span>
        {m.store && <span className="chip">{m.store === "ta" ? "TA Outreach" : m.store === "referral" ? "Referrals" : "Influencers"}</span>}
        <span className="msg-subj">{m.subject}</span>
        <span className="msg-date">{m.at || m.timestamp || "not sent"}</span>
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

// ── Contact-book adapters ─────────────────────────────────────────────────────
// One ContactPanel serves every book. The TA config is the default and reproduces
// today's behavior exactly (so the TA drawer and the Pipeline embed are unchanged);
// the referral config points the SAME card at the referral endpoints, maps the
// referral record into the shape the panel renders, swaps the status ladder and
// draft topics, and switches off the TA-only sections (LinkedIn axis, sequence,
// website, phone/location, cross-log). This is what makes a referral open the same
// card as a TA contact instead of a separate, thinner drawer.
const TA_EDIT_FIELDS = [
  { k: "salute", label: "Salutation", w: 90 }, { k: "first", label: "First name" }, { k: "last", label: "Last name" },
  { k: "title", label: "Title", full: true }, { k: "company", label: "Company", full: true },
  { k: "email", label: "Email", full: true }, { k: "linkedin", label: "LinkedIn URL", full: true },
  { k: "phone", label: "Phone" }, { k: "city", label: "City" }, { k: "state", label: "State", w: 90 },
];
const REF_EDIT_FIELDS = [
  { k: "name", label: "Name", full: true },
  { k: "how", label: "How you know them", full: true },
  { k: "where", label: "Where they are now / their reach", full: true },
  { k: "target", label: "Target company or role you want in", full: true },
  { k: "linkedin", label: "LinkedIn URL", full: true },
  { k: "email", label: "Email", full: true },
];
const REF_LADDER = ["Not Asked", "Catching Up", "Asked", "Responded", "Intro Made", "Applied w/ Referral", "No", "Dormant"];
const CONTACT_CFG_TA = {
  kind: "ta",
  base: (id) => `/api/target-talent/${id}`,
  loadUrl: (id) => `/api/target-talent/${id}`,
  mapData: (d) => d,
  editFields: TA_EDIT_FIELDS,
  features: { pipelineTrack: true, linkedinAxis: true, sequence: true, website: true, phone: true, location: true, crossLog: true, statusButtons: false },
  sequenceSource: "ta",
  stageOpts: TT_STAGE_OPTS,
  buildDraftBody: (stage) => (stage === "reply" || stage === "followup-sent") ? { mode: stage } : { interviewStage: stage },
  defaultStage: (d) => stageFromApps(d.relatedApps),
  displayName: (d) => `${d.salute || ""} ${d.first || ""} ${d.last || ""}`.trim(),
  subtitle: (d) => d.title,
  org: (d) => d.company,
  avatarName: (d) => `${d.first || ""} ${d.last || ""}`,
  statusColor: (s) => (TT_STATUS_MAP[s] || {}).color || "var(--text-mute)",
  // source and id must ride along: the server only runs the outreach guardrail
  // and reads prior messages when it can resolve the contact. Name and company
  // alone left it guessing and skipped the gate entirely.
  linkedIn: { tones: ["Warm", "Direct", "Curious", "Concise"], payload: (d, tone) => ({ source: "ta", id: d.id, name: `${d.first || ""} ${d.last || ""}`.trim(), role: d.title, company: d.company, firstName: d.first, tone }) },
};

const CONTACT_CFG_REFERRAL = {
  kind: "referral",
  base: (id) => `/api/referrals/${id}`,
  loadUrl: (id) => `/api/referrals/${id}/detail`,
  mapData: (d) => {
    const r = (d && d.referral) || {};
    const parts = String(r.name || "").trim().split(/\s+/).filter(Boolean);
    return {
      id: r.id, status: r.status, notes: r.notes || "", email: r.email || "", linkedin: r.linkedin || "",
      lastTouch: r.lastTouch || "", salute: "", first: parts[0] || "", last: parts.slice(1).join(" "),
      name: r.name || "", title: r.how || "", company: r.where || "", how: r.how || "", where: r.where || "", target: r.target || "",
      relatedApps: (d && d.relatedApps) || [], correspondence: (d && d.correspondence) || [], timeline: (d && d.timeline) || null,
      person: (d && d.person) || null, link: (d && d.link) || null,
    };
  },
  editFields: REF_EDIT_FIELDS,
  features: { pipelineTrack: false, linkedinAxis: false, sequence: false, website: false, phone: false, location: false, crossLog: false, statusButtons: true },
  statuses: REF_LADDER,
  stageOpts: [
    { v: "reconnect", l: "Reconnect" }, { v: "ask", l: "Referral ask" },
    { v: "intro-thanks", l: "Thank for intro" }, { v: "nudge", l: "Nudge" },
  ],
  buildDraftBody: (stage) => (stage === "reply" || stage === "followup-sent") ? { mode: stage } : { topic: stage },
  defaultStage: (d) => d.status === "Intro Made" ? "intro-thanks" : d.status === "Asked" ? "nudge" : "reconnect",
  displayName: (d) => d.name || `${d.first || ""} ${d.last || ""}`.trim(),
  subtitle: (d) => d.how || d.where,
  org: (d) => d.where,
  avatarName: (d) => d.name || `${d.first || ""} ${d.last || ""}`,
  statusColor: (s) => (window.REF_STATUS_COLORS || {})[s] || "var(--text)",
  // source and id must ride along: the server only runs the outreach guardrail
  // and reads prior messages when it can resolve the contact. Name and company
  // alone left it guessing and skipped the gate entirely.
  linkedIn: { tones: ["Warm", "Direct", "Curious", "Concise"], payload: (d, tone) => ({ source: "referral", id: d.id, name: d.name, role: d.how, company: d.where, reason: d.target || d.how, firstName: d.first, tone }) },
  // Referral-only row actions the TA card has no concept of.
  extraActions: ({ data, reload, onClose }) => (
    React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } },
      React.createElement("button", {
        className: "btn sm",
        title: "Find + verify an email via Hunter and MillionVerifier",
        onClick: () => {
          window.tjkMutate("/api/referrals/find-emails", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [data.id] }) })
            .then(r => r.json()).then(d => {
              const res = d.ok && (d.results || [])[0];
              if (res && res.email) window.tjkToast && window.tjkToast(`Found ${res.email} · ${res.state}`, "success");
              else if (d.ok) window.tjkToast && window.tjkToast("No verified email found", "warn");
              else window.tjkToast && window.tjkToast(d.error || "Lookup failed", "error");
              reload();
            }).catch(() => window.tjkToast && window.tjkToast("Lookup failed", "error"));
        },
      }, data.email ? "Re-find email" : "Find email"),
      React.createElement("button", {
        className: "btn ghost sm", style: { color: "var(--red)" },
        onClick: () => {
          if (!window.confirm(`Remove ${data.name || "this person"} from your referral tracker?`)) return;
          window.tjkMutate(`/api/referrals/${data.id}`, { method: "DELETE" })
            .then(() => { window.tjkToast && window.tjkToast("Removed", "success"); onClose && onClose(); })
            .catch(() => window.tjkToast && window.tjkToast("Could not remove", "error"));
        },
      }, "Remove from tracker")
    )
  ),
};

// ── Contact panel (shared body) ───────────────────────────────────────────────
// The full single-contact management UI: header, contact info, pipeline stage
// track, related apps, notes, stage-tuned outreach drafting, correspondence
// thread, and the log-message modal. Rendered both inside the TA Outreach drawer
// (TTDrawer) and inline in the Pipeline drawer's Contacts tab (via
// window.ContactPanel) so there is a single implementation. When `embedded`, it
// drops the drawer chrome (head/body classes, ESC-to-close) and shows a "Back"
// control instead of a close X.
function ContactPanel({ id, onClose, onUpdate, embedded = false, cfg = CONTACT_CFG_TA }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [composing, setComposing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState(null);
  const [draftBlock, setDraftBlock] = useState(null);
  // Which surface the draft is for. Email drafts assemble a greeting + signature;
  // LinkedIn notes are short and stand alone (no signature, no "Hi Name,").
  const [outChannel, setOutChannel] = useState("Email");
  const [liTone, setLiTone] = useState("Warm");
  // Editable assembled message, seeded from the AI draft so the user can tweak it
  // before copying, logging, or saving it.
  const [draftEmail, setDraftEmail] = useState("");
  useEffect(() => {
    if (!draftResult) { setDraftEmail(""); return; }
    if (draftResult.linkedin) setDraftEmail((draftResult.body || "").trim());
    else setDraftEmail(`Hi ${data?.first || "there"},\n\n${(draftResult.body || "").replace(/^\s+/, "")}\n\n${window.myEmailSignature()}`);
  }, [draftResult]);
  const [draftStage, setDraftStage] = useState("general");
  const [notes, setNotes] = useState("");
  const [website, setWebsite] = useState("");
  const [editingWeb, setEditingWeb] = useState(false);
  const [editing, setEditing] = useState(false);   // whole-contact edit mode (identity fields)
  const [edit, setEdit] = useState({});             // draft field values while editing
  const [logModal, setLogModal] = useState(null);
  // Multi-app cross-log: every related application at the company is checked
  // by default so a TA touch propagates to all of them in one step. User can
  // uncheck any individual app for the rare case where the touch is not
  // about that specific role.
  const [crossLogAppIds, setCrossLogAppIds] = useState(new Set());

  const load = useCallback(() => {
    if (id == null) return;
    setLoading(true);
    fetch(cfg.loadUrl(id))
      .then(r => r.json())
      .then(raw => {
        const d = cfg.mapData(raw);
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
        setDraftStage(cfg.defaultStage(d));
        setLoading(false);
        setComposing(false);
        setDraftResult(null);
        setDraftBlock(null);
      })
      .catch(() => setLoading(false));
  }, [id, cfg]);
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
    window.tjkMutate(cfg.base(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) })
      .then(() => { load(); onUpdate?.(); });
  };
  const updateLinkedIn = linkedinStatus => {
    window.tjkMutate(cfg.base(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ linkedinStatus }) })
      .then(() => { load(); onUpdate?.(); });
  };
  const updateInfluenceTier = influenceTier => {
    window.tjkMutate(cfg.base(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ influenceTier }) })
      .then(() => { load(); onUpdate?.(); });
  };
  const saveNotes = () => {
    window.tjkMutate(cfg.base(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notes }) })
      .then(() => { load(); onUpdate?.(); });
  };
  const saveWebsite = () => {
    window.tjkMutate(cfg.base(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ website: website.trim() }) })
      .then(() => { setEditingWeb(false); load(); onUpdate?.(); });
  };
  const unmergePerson = () => {
    window.tjkMutate('/api/people/unmerge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: `${cfg.kind}:${id}` }),
    }).then(r => r.json()).then(res => {
      if (res.error) { window.tjkToast && window.tjkToast(res.error, 'error'); return; }
      load(); onUpdate?.();
    }).catch(() => window.tjkToast && window.tjkToast('Could not separate contact', 'error'));
  };
  // Whole-contact edit mode: seed the draft from current values, then PATCH the
  // identity fields on save. Editing the email drops any verification tag server-side
  // (a changed address is unverified until re-checked). Fields come from the adapter.
  const EDIT_FIELDS = cfg.editFields;
  const startEdit = () => {
    setEdit(Object.fromEntries(EDIT_FIELDS.map(f => [f.k, data[f.k] || ""])));
    setEditing(true);
  };
  const saveEdit = () => {
    const payload = {};
    for (const f of EDIT_FIELDS) {
      const v = (edit[f.k] || "").trim();
      if (v !== (data[f.k] || "")) payload[f.k] = v;
    }
    if (Object.keys(payload).length === 0) { setEditing(false); return; }
    window.tjkMutate(cfg.base(id), { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(() => { setEditing(false); load(); onUpdate?.(); });
  };
  const generateDraft = (override = false) => {
    setDrafting(true); setDraftResult(null);
    // LinkedIn: generate a short connection-style note via the shared connect-note
    // route (a different motion from email), and mark the result so the compose
    // area drops the greeting/signature and the Gmail button.
    if (outChannel === "LinkedIn" && cfg.linkedIn) {
      window.tjkMutate("/api/linkedin-drafts/connect-note", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: cfg.kind, id, ...cfg.linkedIn.payload(data, liTone), override }),
      })
        .then(r => r.json())
        .then(d => { setDrafting(false); if (d.blocked) { setDraftBlock(d); setComposing(false); } else if (d && d.response) { setDraftResult({ body: d.response, subject: "", linkedin: true }); if (override) setDraftBlock(b => ({ ...b, overridden: true })); } else window.tjkToast && window.tjkToast((d && d.error) || "Draft failed", "error"); })
        .catch(() => { setDrafting(false); window.tjkToast && window.tjkToast("Draft failed", "error"); });
      return;
    }
    // Email. "reply" and "followup-sent" are message MODES (they anchor on a
    // specific prior message); every other value tunes fresh outreach. The adapter
    // builds the right payload (interview stage for TA, topic for referrals).
    const draftBody = cfg.buildDraftBody(draftStage);
    window.tjkMutate(`${cfg.base(id)}/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draftBody, override }),
    })
      .then(r => r.json())
      .then(d => { setDrafting(false); if (d.blocked) { setDraftBlock(d); setComposing(false); } else if (d.draft) { setDraftResult(d.draft); if (override) setDraftBlock(b => ({ ...b, overridden: true })); } })
      .catch(() => setDrafting(false));
  };
  const saveCorrAndClose = msg => {
    // Cross-logging a touch onto related applications is a TA-only concept, so it
    // only rides along when the adapter enables it.
    const appIds = (cfg.features.crossLog && msg.direction === "Sent") ? Array.from(crossLogAppIds) : [];
    const body = {
      ...msg,
      alsoLogToAppNums: appIds.length ? appIds : undefined,
      // Backwards-compat: keep the single-id field populated with the first selected
      // app so server endpoints that only support one id still work.
      alsoLogToAppNum: appIds.length ? appIds[0] : undefined,
      alsoLogChannel: msg.channel || "Email",
    };
    window.tjkMutate(`${cfg.base(id)}/correspondence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(() => { load(); onUpdate?.(); setLogModal(null); setDraftResult(null); });
  };

  if (loading || !data) {
    return <div style={{ padding: embedded ? "16px 2px" : 24, color: "var(--text-mute)" }}>Loading…</div>;
  }

  const corr = data.timeline || data.correspondence || [];
  const headStyle = embedded ? { paddingBottom: 12, borderBottom: "1px solid var(--border)" } : undefined;
  const bodyStyle = embedded
    ? { display: "flex", flexDirection: "column", gap: 20, paddingTop: 14 }
    : { flex: 1, overflow: "auto", padding: "18px 20px 28px", display: "flex", flexDirection: "column", gap: 20 };

  return (
    <>
      <div className={embedded ? "" : "drawer-head"} style={headStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>#{data.id}</span>
          {cfg.kind === "ta"
            ? <StatusBadge status={data.status} size="sm" />
            : <span className="status-badge" style={{ color: cfg.statusColor(data.status), borderColor: "var(--border)", fontSize: 9.5, padding: "2px 8px" }}><span className="sb-dot" style={{ background: cfg.statusColor(data.status) }} />{data.status}</span>}
          {data.link && <span className="tag" style={{ background: "rgba(34,211,238,0.14)", color: "#22d3ee" }}>Also TA · shared timeline</span>}
          {data.relatedApps?.length > 0 && (
            <span className="tag accent">{data.relatedApps.length} related app{data.relatedApps.length !== 1 ? "s" : ""}</span>
          )}
          {onClose && (embedded
            ? <button className="btn ghost sm" onClick={onClose} style={{ marginLeft: "auto" }}>← Back</button>
            : <button className="icon-btn" onClick={onClose} style={{ marginLeft: "auto" }}><TIcon d={TI.x} size={15} /></button>)}
        </div>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <span className="mono-av" style={{ width: 44, height: 44, fontSize: 14, borderRadius: 10, borderColor: cfg.statusColor(data.status), color: cfg.statusColor(data.status) }}>{ttInitials(cfg.avatarName(data) || "?")}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{cfg.displayName(data) || "(no name)"}</h3>
            <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{cfg.subtitle(data) || "—"}</div>
            <div style={{ fontSize: 12, color: "var(--accent)", marginTop: 3, fontWeight: 500 }}>{cfg.org(data) || ""}</div>
            {cfg.kind === "ta" && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
                <label htmlFor={`influence-tier-${data.id}`} style={{ fontSize: 10.5, color: "var(--text-mute)" }}>Role in the hire</label>
                <select id={`influence-tier-${data.id}`} className="sel" value={data.influenceTier || "ta"}
                  onChange={e => updateInfluenceTier(e.target.value)} style={{ fontSize: 11, padding: "3px 7px" }}>
                  {Object.entries(INFLUENCE_TIER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
                <span title={data.influenceTierSource === "title"
                  ? "Read from the job title and not confirmed. Changing it here records your decision."
                  : data.influenceTierSource === "tag"
                    ? "Set by you."
                    : "Nothing could be determined from the job title. Changing it here records your decision."}
                  style={{ fontSize: 10.5, color: "var(--text-mute)" }}>
                  {data.influenceTierSource === "title" ? "Inferred" : data.influenceTierSource === "tag" ? "Set" : "Not determined"}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className={embedded ? "" : "drawer-body"} style={bodyStyle}>
        {/* Contact info */}
        <div className="ds-section">
          <div className="ds-label">
            <TIcon d={TI.building} size={12} /> Contact
            {!editing && <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={startEdit}><TIcon d={TI.pen} size={11} /> Edit</button>}
          </div>
          {editing ? (
            <div className="info-card" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {EDIT_FIELDS.map(f => (
                <div key={f.k} style={{ gridColumn: f.full ? "1 / -1" : "auto", display: "flex", flexDirection: "column", gap: 3 }}>
                  <label style={{ fontSize: 10.5, color: "var(--text-mute)", letterSpacing: ".04em" }}>{f.label}</label>
                  <input className="inp" value={edit[f.k] || ""} onChange={e => setEdit(prev => ({ ...prev, [f.k]: e.target.value }))}
                    style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "5px 8px", color: "var(--text)", fontSize: 12 }} />
                </div>
              ))}
              <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8, marginTop: 2 }}>
                <button className="btn primary sm" onClick={saveEdit}><TIcon d={TI.check} size={12} /> Save</button>
                <button className="btn ghost sm" onClick={() => setEditing(false)}>Cancel</button>
                <span style={{ fontSize: 11, color: "var(--text-mute)", alignSelf: "center", marginLeft: "auto" }}>Changing the email marks it unverified until re-checked.</span>
              </div>
            </div>
          ) : (
          <div className="info-card">
            {cfg.features.website && (
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
                      ? <a className="iv link" href={href} target="_blank" rel="noreferrer">{stored || guess}{!stored && guess ? <span style={{ color: "var(--text-mute)", marginLeft: 5, fontSize: 10.5 }}>(from email)</span> : null}</a>
                      : <span className="iv" style={{ color: "var(--text-mute)" }}>—</span>}
                    <button className="copy-btn" onClick={() => { setWebsite(stored); setEditingWeb(true); }}><TIcon d={TI.pen} size={11} /> Edit</button>
                  </>
                );
              })()}
            </div>
            )}
            <div className="info-row">
              <span className="ik">Email</span>
              <span className="iv">
                {data.email || "-"}
                {(() => {
                  const n = data.notes || "";
                  const bounced  = /EMAIL BOUNCED|bounced/i.test(n);
                  const unverified = !bounced && /email unverified|pattern-med|pattern-low|auto-synthesized/i.test(n);
                  if (!data.email && !bounced) return null;
                  if (bounced) return <span style={{ marginLeft: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(239,68,68,0.18)", color: "#fca5a5", fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }} title="See notes for details">BOUNCED</span>;
                  if (unverified) return <span style={{ marginLeft: 8, padding: "2px 6px", borderRadius: 4, background: "rgba(234,179,8,0.18)", color: "#fde68a", fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4 }} title="Auto-synthesized. Confirm before sending">UNVERIFIED</span>;
                  return null;
                })()}
              </span>
              {data.email && <CopyBtn value={data.email} />}
            </div>
            {cfg.features.phone && data.phone && (
              <div className="info-row">
                <span className="ik">Phone</span>
                <span className="iv">{data.phone}</span>
                <CopyBtn value={data.phone} />
              </div>
            )}
            {cfg.features.location && (
            <div className="info-row">
              <span className="ik">Location</span>
              <span className="iv">{[data.city, data.state].filter(Boolean).join(", ") || "-"}</span>
              <span />
            </div>
            )}
            <div className="info-row">
              <span className="ik">LinkedIn</span>
              {data.linkedin
                ? <a className="iv link" href={window.safeHref(data.linkedin)} target="_blank" rel="noreferrer">View profile</a>
                : <span className="iv" style={{ color: "var(--text-mute)" }}>—</span>}
              {data.linkedin && <a className="copy-btn" href={window.safeHref(data.linkedin)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}><TIcon d={TI.ext} size={11} /> Open</a>}
            </div>
            <div className="info-row">
              <span className="ik">Last touch</span>
              <span className="iv" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{data.lastTouch || "-"}</span>
              <span />
            </div>
          </div>
          )}
        </div>
        {data.person?.refs?.length > 0 && <div className="ds-section">
          <div className="ds-label">Filed in</div>
          <div className="chips">{data.person.refs.map(ref => {
            const [store, rowId] = ref.split(":");
            const label = store === "referral" ? "Referrals" : store === "ta" ? "TA Outreach" : "Influencers";
            // Same colors as the queue's book chips, from the one shared map, so a
            // green chip means Referral everywhere it appears. Resolved at render
            // time and tolerant of absence: connect.js loads first today, and a
            // plain chip is a fine fallback if that ever changes.
            const cvar = (window.BOOK_META || {})[store]?.cvar;
            const tint = cvar ? {
              background: `color-mix(in srgb, ${cvar} 15%, transparent)`,
              color: cvar,
              borderColor: `color-mix(in srgb, ${cvar} 40%, transparent)`,
            } : undefined;
            return <span className="chip" key={ref} style={tint}>{label} #{rowId}</span>;
          })}</div>
          {data.person.refs.length > 1 && <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            {data.person.matchedBy === "linkedinKey" ? "Matched on their LinkedIn profile." : data.person.matchedBy === "backref" ? "Linked when you promoted them from TA Outreach." : data.person.matchedBy === "pin" ? "You merged these by hand." : ""}
            <button className="btn ghost sm" style={{ marginLeft: 8 }} onClick={unmergePerson}>Not the same person</button>
          </div>}
        </div>}
        {/* Status */}
        <div className="ds-section">
          <div className="ds-label"><TIcon d={TI.trend} size={12} /> {cfg.features.pipelineTrack ? "Pipeline stage" : "Status"}</div>
          {cfg.features.pipelineTrack
            ? <PipelineTrack contact={data} onChange={updateStatus} />
            : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(cfg.statuses || []).map(s => {
                  const on = data.status === s;
                  const c = cfg.statusColor(s);
                  return (
                    <button key={s} className="btn sm" onClick={() => updateStatus(s)}
                      style={{ color: c, borderColor: on ? c : "var(--border)", background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : "transparent", fontWeight: on ? 600 : 400 }}>
                      {s}
                    </button>
                  );
                })}
              </div>
            )}
        </div>
        {/* LinkedIn connection — separate axis from the pipeline above (TA only) */}
        {cfg.features.linkedinAxis && (
          <div className="ds-section">
            <div className="ds-label"><TIcon d={TI.ext} size={12} /> LinkedIn connection</div>
            <LinkedInControl status={data.linkedinStatus} onChange={updateLinkedIn} />
          </div>
        )}
        {/* Outreach sequence (per-contact cadence; every step is an approved draft) */}
        {cfg.features.sequence && (
          <div className="ds-section">
            <div className="ds-label"><TIcon d={TI.spark} size={12} /> Outreach sequence</div>
            {window.SequencePanel && <window.SequencePanel source={cfg.sequenceSource} id={data.id} toast={typeof toast !== "undefined" ? toast : undefined} />}
          </div>
        )}
        {/* Related apps */}
        {data.relatedApps?.length > 0 && (
          <div className="ds-section">
            <div className="ds-label"><TIcon d={TI.briefcase} size={12} /> Related applications at {data.company}<span className="r">{data.relatedApps.length}</span></div>
            {data.relatedApps.map((a, i) => (
              <div className="relapp" key={i}>
                <span className="ra-id">#{a.id}</span>
                <span className="ra-role">{a.role}</span>
                <span className="ra-score">
                  <span className="ra-bar"><i style={{ width: `${((parseFloat(a.score) || 0) / 5) * 100}%` }} /></span>{a.score}
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
        {draftBlock && <div className="card" style={{ borderColor: "var(--yellow)", padding: 12 }}>
          {(draftBlock.blocks || []).map((block, i) => <div key={`${block.rule || "block"}:${i}`}>{block.reason}</div>)}
          <div className="dim" style={{ marginTop: 6 }}>{draftBlock.nextEligible ? `You can reach out again on ${draftBlock.nextEligible}` : "Blocked until they reply"}</div>
          {draftBlock.overridden && <div style={{ color: "var(--yellow)", marginTop: 6 }}>Guardrail overridden for this draft.</div>}
        </div>}
        {/* Outreach */}
        <div className="ds-section">
          <div className="ds-label">
            <TIcon d={TI.spark} size={12} /> Outreach
            {outChannel === "Email"
              ? (
                <select value={draftStage} onChange={e => setDraftStage(e.target.value)} title="Tune the draft: Reply responds to their last message; Follow up nudges the last message you sent; the stages tune fresh outreach"
                  style={{ marginLeft: "auto", fontSize: 11, padding: "2px 6px", borderRadius: 5, background: "var(--panel-2)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
                  {/* Reply is offered only when there is an inbound message to reply to;
                      Follow up on last sent only when you have actually sent one. */}
                  {[
                    ...(corr.some(m => m.direction === "Received") ? [{ v: "reply", l: "↩ Reply to last message" }] : []),
                    ...(corr.some(m => m.direction === "Sent") ? [{ v: "followup-sent", l: "↗ Follow up on last sent" }] : []),
                    ...cfg.stageOpts,
                  ].map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              )
              : <span style={{ marginLeft: "auto" }} />}
          </div>
          {/* Channel picker for the DRAFT: email or a LinkedIn note. Books that
              cannot draft a LinkedIn note (none, today) simply hide it. */}
          {cfg.linkedIn && !draftResult && !drafting && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, color: "var(--text-mute)" }}>Draft a</span>
              {["Email", "LinkedIn"].map(ch => {
                const on = outChannel === ch;
                return (
                  <button key={ch} className="btn sm" onClick={() => setOutChannel(ch)}
                    style={{ borderColor: on ? "var(--accent)" : "var(--border)", background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--text-dim)", fontWeight: on ? 600 : 400 }}>
                    {ch === "LinkedIn" ? "LinkedIn note" : "Email"}
                  </button>
                );
              })}
              {outChannel === "LinkedIn" && (
                <span style={{ display: "flex", gap: 4, flexWrap: "wrap", marginLeft: 4 }}>
                  {cfg.linkedIn.tones.map(t => {
                    const on = liTone === t;
                    return (
                      <button key={t} className="btn sm" onClick={() => setLiTone(t)}
                        style={{ borderColor: on ? "var(--accent)" : "var(--border)", background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--text-dim)", fontWeight: on ? 600 : 400 }}>
                        {t}
                      </button>
                    );
                  })}
                </span>
              )}
            </div>
          )}
          {!composing && !draftResult && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className={draftBlock ? "btn ghost sm" : "btn primary sm"} onClick={() => { setComposing(true); generateDraft(!!draftBlock); }}><TIcon d={TI.spark} size={12} /> {draftBlock ? "Draft anyway" : `Draft ${outChannel === "LinkedIn" ? "LinkedIn note" : "email"}`}</button>
              <button className="btn sm" onClick={() => setLogModal({ direction: "Sent", channel: outChannel, subject: "", body: "" })}><TIcon d={TI.outbound} size={12} /> Log sent</button>
              <button className="btn sm" onClick={() => setLogModal({ direction: "Received", channel: outChannel, subject: "", body: "" })}><TIcon d={TI.inbound} size={12} /> Log reply</button>
            </div>
          )}
          {composing && drafting && (
            <div className="ai-loading"><span className="scan-ring" style={{ width: 16, height: 16, borderWidth: 2 }} /> drafting…</div>
          )}
          {draftResult && (
            <div className="ai-compose">
              <div className="ai-head"><TIcon d={TI.spark} size={13} /> AI {draftResult.linkedin ? "LinkedIn note" : "draft"} <span style={{ marginLeft: 8, fontSize: 10.5, color: "var(--text-mute)", fontWeight: 400 }}>editable{draftResult.linkedin ? " · no subject, paste into LinkedIn" : ""}</span></div>
              {!draftResult.linkedin && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-mute)" }}>Subject</span>
                  <input className="inp" value={draftResult.subject || ""} onChange={e => setDraftResult({ ...draftResult, subject: e.target.value })} style={{ flex: 1 }} />
                  <CopyBtn value={draftResult.subject || ""} />
                </div>
              )}
              <div style={{ position: "relative" }}>
                <textarea className="ta" value={draftEmail} onChange={e => setDraftEmail(e.target.value)} rows={draftResult.linkedin ? 6 : 10} aria-label="Editable message draft" style={{ width: "100%", resize: "vertical", fontFamily: "inherit" }} />
                <div style={{ position: "absolute", top: 8, right: 8 }}>
                  <CopyBtn value={draftEmail} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn primary sm" onClick={() => setLogModal({ direction: "Sent", channel: draftResult.linkedin ? "LinkedIn" : "Email", subject: draftResult.linkedin ? "LinkedIn note" : draftResult.subject, body: draftEmail })}><TIcon d={TI.check} size={12} /> I sent this</button>
                <button className="btn sm" onClick={() => saveCorrAndClose({ direction: "Draft", channel: draftResult.linkedin ? "LinkedIn" : "Email", subject: draftResult.linkedin ? "LinkedIn note" : draftResult.subject, body: draftEmail })}><TIcon d={TI.pen} size={12} /> Save as draft</button>
                {!draftResult.linkedin && <window.GmailDraftBtn to={data.email} subject={draftResult.subject} body={draftEmail} />}
                <button className="btn sm" onClick={() => generateDraft(false)}><TIcon d={TI.refresh} size={12} /> Regen</button>
              </div>
            </div>
          )}
        </div>
        {/* Book-specific extras (e.g. referral: find email, remove from tracker) */}
        {cfg.extraActions && (
          <div className="ds-section">
            {cfg.extraActions({ data, reload: load, onClose, onUpdate })}
          </div>
        )}
        {/* Correspondence */}
        <div className="ds-section">
          <div className="ds-label"><TIcon d={TI.mail} size={12} /> Correspondence<span className="r">{corr.length} event{corr.length !== 1 ? "s" : ""}</span></div>
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
                <label>Channel</label>
                <div style={{ display: "flex", gap: 6 }}>
                  {["Email", "LinkedIn"].map(ch => {
                    const on = (logModal.channel || "Email") === ch;
                    return (
                      <button key={ch} className="btn sm" onClick={() => setLogModal({ ...logModal, channel: ch })}
                        style={{ borderColor: on ? "var(--accent)" : "var(--border)", background: on ? "var(--accent-bg)" : "transparent", color: on ? "var(--accent)" : "var(--text-dim)", fontWeight: on ? 600 : 400 }}>
                        {ch}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Subject</label>
                <input className="inp" value={logModal.subject} onChange={e => setLogModal({ ...logModal, subject: e.target.value })} placeholder="Subject" />
              </div>
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Message body</label>
                <textarea className="ta" value={logModal.body} onChange={e => setLogModal({ ...logModal, body: e.target.value })} placeholder="Message body…" rows={8} />
              </div>
              {cfg.features.crossLog && logModal.direction === "Sent" && data?.relatedApps?.length > 0 && (
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
                  <div className="col" style={{ gap: 4 }}>
                    {data.relatedApps.map(a => {
                      const checked = crossLogAppIds.has(a.id);
                      return (
                        <label key={a.id}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "6px 8px", background: "var(--panel-2)",
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
// Exposed so the Referrals book can open a contact in the SAME card as a TA
// contact (it renders window.ContactPanel with this adapter).
window.CONTACT_CFG_REFERRAL = CONTACT_CFG_REFERRAL;

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
function FindContactsPanel({ company, exampleRole, onAdded, onCancel, initialMode = "ta" }) {
  const [phase, setPhase] = useState("idle"); // idle | scanning | review | adding | done
  const [suggestions, setSuggestions] = useState([]);
  const [sel, setSel] = useState(new Set());
  const [error, setError] = useState(null);
  const [addedCount, setAddedCount] = useState(0);
  const [rejected, setRejected] = useState([]);
  // Which kind of contact to search for: 'ta' = Talent Acquisition / recruiter
  // gatekeeper (default), 'principal' = the hiring manager / skip-level you would
  // actually report to (VP/Director of the target function). Principal mode hits a
  // different endpoint and stamps the added contact [principal].
  const [mode, setMode] = useState(initialMode);

  const keyOf = (s) => `${s.first || ""} ${s.last || ""}`.trim();

  const runDiscover = () => {
    setPhase("scanning"); setError(null); setRejected([]);
    const endpoint = mode === "principal" ? "/api/tt-reconcile/discover-principal" : "/api/tt-reconcile/discover";
    window.tjkMutate(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companies: [{ company, exampleRole: exampleRole || "" }] }),
    })
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok || d.error) { setError(d.error || "Discovery failed."); setPhase("idle"); return; }
        const sug = (d.results || []).flatMap(r => r.suggestions || []);
        setSuggestions(sug);
        const pre = new Set(sug.filter(s => s.validation?.ok !== false && ["high", "medium"].includes((s.confidence || "low").toLowerCase())).map(keyOf));
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
      notes: [
        s.notes,
        `Added via Find ${mode === "principal" ? "hiring manager" : "contacts"} (confidence: ${s.confidence || "unknown"})`,
        mode === "principal" && !/\[principal\]/i.test(s.notes || "") ? "[principal]" : "",
      ].filter(Boolean).join(" · "),
    }));
    if (contacts.length === 0) { onCancel?.(); return; }
    setPhase("adding");
    window.tjkMutate("/api/tt-reconcile/bulk-add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contacts,
        // The plain TA path is also model-backed, but gating it is outside this change.
        source: mode === "principal" ? "agent" : "manual",
      }),
    })
      .then(r => r.json())
      .then(d => { setAddedCount(d.written ?? contacts.length); setRejected(d.rejected || []); setPhase("done"); onAdded?.(); })
      .catch(e => { setError(e.message); setPhase("review"); });
  };

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 12, background: "var(--panel)" }}>
      <div className="ds-label" style={{ marginBottom: 8 }}>
        <TIcon d={TI.users} size={12} /> Find {mode === "principal" ? "the hiring manager" : "contacts"} at {company}
        {onCancel && phase !== "done" && <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={onCancel}>Cancel</button>}
      </div>
      {error && <div style={{ padding: 8, background: "rgba(239,68,68,0.12)", color: "var(--red)", borderRadius: 4, marginBottom: 8, fontSize: 11 }}>{error}</div>}

      {phase === "idle" && (
        <>
          {/* Mode toggle: gatekeeper (TA) vs the decision-maker you'd report to. */}
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button className={"btn sm" + (mode === "ta" ? " primary" : "")} onClick={() => setMode("ta")}>TA / recruiter</button>
            <button className={"btn sm" + (mode === "principal" ? " primary" : "")} onClick={() => setMode("principal")}>Hiring manager</button>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 10 }}>
            {mode === "principal"
              ? "Search the web for the VP / Director / Head of the target function at this company — the person you'd report to, not the recruiter. Added as a hiring principal."
              : "Search the web for 2-3 current Talent Acquisition contacts at this one company. One lookup, low usage."}
          </div>
          <button className="btn primary sm" onClick={runDiscover}><TIcon d={TI.spark} size={12} /> {mode === "principal" ? "Find hiring manager" : "Find contacts"}</button>
        </>
      )}

      {phase === "scanning" && (
        <div className="scan" style={{ padding: "10px 0" }}>
          <div className="scan-ring" />
          <div className="scan-log">Searching for {mode === "principal" ? "the hiring manager" : "TA contacts"} at {company}…</div>
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
            const invalid = s.validation?.ok === false;
            return (
              <RecRow key={k + i} checked={sel.has(k)} onToggle={() => toggle(k)}
                av={ttInitials((s.first || "?") + " " + (s.last || "?"))} name={`${s.first} ${s.last}`}
                meta={invalid ? `${s.title || ""} · Unsupported: ${s.validation.reasons?.[0] || "validation failed"}` : s.title}
                reason={s.linkedin ? <a className="link" href={window.safeHref(s.linkedin)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: invalid ? "var(--red)" : "var(--accent)", fontSize: 11 }}>LinkedIn ↗</a> : null}
                right={<span className={"conf " + conf} style={invalid ? { color: "var(--red)" } : undefined}>{invalid ? "Unsupported" : conf}</span>} />
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
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--green)" }}><TIcon d={TI.check} size={13} /> Added {addedCount} contact{addedCount === 1 ? "" : "s"}.</span>
            {onCancel && <button className="btn sm" style={{ marginLeft: "auto" }} onClick={onCancel}>Done</button>}
          </div>
          {rejected.map((person, i) => (
            <div key={`${person.name || "contact"}-${i}`} style={{ color: "var(--red)", fontSize: 11, marginTop: 6 }}>
              {person.name || "Unnamed contact"}: {person.reasons?.[0] || "validation failed"}
            </div>
          ))}
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
                        reason={s.linkedin ? <a className="link" href={window.safeHref(s.linkedin)} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ color: "var(--accent)", fontSize: 11 }}>LinkedIn ↗</a> : null}
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
                <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 18 }}>
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
                  <div style={{ fontSize: 11, color: "var(--orange)", maxWidth: 440, margin: "12px auto 0", lineHeight: 1.6 }}>
                    Email finding was skipped. Set <b>HUNTER_API_KEY</b> and <b>MILLIONVERIFIER_API_KEY</b> in
                    dashboard-web/.env to auto-find and verify addresses for new contacts.
                  </div>
                )}
                {outcome && (outcome.archived > 0 || outcome.added > 0) && (
                  <div style={{ fontSize: 11, color: "var(--text-mute)", maxWidth: 440, margin: "16px auto 0", lineHeight: 1.65 }}>
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
