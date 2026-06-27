// Tracker Tab — All entries, all statuses, no pipeline filtering
const { useState: useStateT, useMemo: useMemoT } = React;

const ALL_STATUSES = ["Evaluated", "Applied", "Responded", "Interview", "Offer", "Rejected", "Discarded", "SKIP", "Closed", "Not a Fit", "No Response"];

window.TrackerTab = function TrackerTab({ apps, onOpen, search }) {
  const [sortKey, setSortKey] = useStateT("date");
  const [sortDir, setSortDir] = useStateT("desc");
  const [filters, setFilters] = useStateT({ statuses: [], archetypes: [], scoreMin: 0 });

  const filtered = useMemoT(() => {
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

  const sorted = useMemoT(() => {
    const arr = [...filtered];
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "id") {
        cmp = (a.id || 0) - (b.id || 0);
      } else if (sortKey === "score") {
        const as = a.score != null ? a.score : -1;
        const bs = b.score != null ? b.score : -1;
        cmp = as - bs;
      } else if (sortKey === "date") {
        cmp = (a.date || "").localeCompare(b.date || "");
        if (cmp === 0) {
          const as = a.score != null ? a.score : -1;
          const bs = b.score != null ? b.score : -1;
          return bs - as;
        }
      } else {
        const av = (a[sortKey] || "").toString().toLowerCase();
        const bv = (b[sortKey] || "").toString().toLowerCase();
        cmp = av.localeCompare(bv);
      }
      return cmp * dir;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const toggleStatus = (s) => {
    setFilters(f => ({ ...f, statuses: f.statuses.includes(s) ? f.statuses.filter(x => x !== s) : [...f.statuses, s] }));
  };
  const toggleArch = (a) => {
    setFilters(f => ({ ...f, archetypes: f.archetypes.includes(a) ? f.archetypes.filter(x => x !== a) : [...f.archetypes, a] }));
  };
  const setSort = (k) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "score" || k === "date" ? "desc" : "asc"); }
  };

  // Status breakdown counts
  const breakdown = useMemoT(() => {
    return ALL_STATUSES.map(s => ({ s, n: apps.filter(a => a.status === s).length, meta: window.STATUS_META[s] })).filter(x => x.n > 0);
  }, [apps]);

  return (
    <div className="col" style={{ gap: 14 }}>
      {/* Header */}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>All Entries</h1>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>{sorted.length} of {apps.length} total · sorted by <span style={{ color: "var(--accent)" }}>{sortKey} {sortDir === "asc" ? "↑" : "↓"}</span></div>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="card" style={{ padding: "10px 14px" }}>
        <div className="row" style={{ flexWrap: "wrap", gap: 14 }}>
          {breakdown.map(({ s, n, meta }) => (
            <span key={s} className="row mono" style={{ gap: 6, fontSize: 11.5, color: "var(--text-dim)", cursor: "pointer" }}
              onClick={() => toggleStatus(s)}>
              <span style={{ width: 7, height: 7, borderRadius: 50, background: meta.color, display: "inline-block", flexShrink: 0 }}></span>
              {s}
              <span style={{ color: filters.statuses.includes(s) ? "var(--accent)" : "var(--text)" }}>{n}</span>
            </span>
          ))}
          <span className="mono dim" style={{ fontSize: 11, marginLeft: "auto" }}>click to filter</span>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ padding: 12 }}>
        <div className="filterbar" style={{ marginBottom: 8 }}>
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em" }}>Status</span>
          {ALL_STATUSES.map(s => (
            <span key={s} className={`chip ${filters.statuses.includes(s) ? "on" : ""}`} onClick={() => toggleStatus(s)}>
              <span className="dot" style={{ width: 6, height: 6, borderRadius: 50, background: window.STATUS_META[s].color, display: "inline-block" }}></span>
              {s}
            </span>
          ))}
        </div>
        <div className="filterbar" style={{ marginBottom: 8 }}>
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em" }}>Archetype</span>
          {window.ARCHETYPES.map(a => (
            <span key={a} className={`chip ${filters.archetypes.includes(a) ? "on" : ""}`} onClick={() => toggleArch(a)}>{a}</span>
          ))}
        </div>
        <div className="filterbar" style={{ marginBottom: 0 }}>
          <span className="mono dim" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.1em" }}>Score ≥</span>
          {[0, 3.0, 3.5, 4.0, 4.5].map(s => (
            <span key={s} className={`chip ${filters.scoreMin === s ? "on" : ""}`} onClick={() => setFilters(f => ({ ...f, scoreMin: s }))}>{s === 0 ? "any" : s.toFixed(1)}</span>
          ))}
          {(filters.statuses.length || filters.archetypes.length || filters.scoreMin) ? (
            <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setFilters({ statuses: [], archetypes: [], scoreMin: 0 })}>Clear all</button>
          ) : null}
        </div>
      </div>

      {/* Table — all entries */}
      <window.PipelineTable rows={sorted} sortKey={sortKey} sortDir={sortDir} setSort={setSort} onOpen={onOpen} />
    </div>
  );
};
