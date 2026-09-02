/* Visibility module: tracks the user's LinkedIn Social Selling Index (a LinkedIn metric). */
const { useState, useEffect, useMemo, useCallback } = React;

// Order activity newest-first by when it was logged (loggedAt), falling back to the
// activity date for legacy rows that predate the loggedAt stamp. This makes a just-
// logged touch float to the top even when several entries share the same calendar day.
const byLoggedAtDesc = (a, b) =>
  (b.loggedAt || b.date || "").localeCompare(a.loggedAt || a.date || "");

// Alphabetical by name (A-Z). Full-name compare sorts by first name first, which
// is the natural order for the influencer picker dropdowns.
const byNameAsc = (a, b) => (a.name || "").localeCompare(b.name || "");


function LinkedInSSITab({ toast }) {
  const [influencers, setInfluencers] = useState([]);
  const [engagementLog, setEngagementLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("posts");
  const [selectedInfluencer, setSelectedInfluencer] = useState(null);
  const engagementRhythm = useMemo(() => weeklyEngagementRhythm(engagementLog), [engagementLog]);

  useEffect(() => {
    Promise.all([
      fetch('/api/linkedin-ssi/influencers').then(r => r.json()).catch(e => { console.error('Influencers fetch:', e); return []; }),
      fetch('/api/linkedin-ssi/engagement-log').then(r => r.json()).catch(e => { console.error('Log fetch:', e); return []; })
    ]).then(([infl, log]) => {
      setInfluencers(infl);
      setEngagementLog([...(log || [])].sort(byLoggedAtDesc));
      setLoading(false);
    });
  }, []);

  if (loading) return <div style={{ padding: "20px", color: "var(--text-dim)" }}>Loading Social data…</div>;

  return (
    <div style={{ flex: 1, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <div>
        {/* Subtabs */}
        <div className="subtabs">
          <button className={"subtab" + (activeView === "posts" ? " active" : "")} onClick={() => setActiveView("posts")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", display: "inline-block"}}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            Posts
          </button>
          <button className={"subtab" + (activeView === "content" ? " active" : "")} onClick={() => setActiveView("content")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight: "6px", display: "inline-block"}}><path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/></svg>
            Content
          </button>
          <button className={"subtab" + (activeView === "influencers" ? " active" : "")} onClick={() => setActiveView("influencers")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "6px", display: "inline-block"}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            Influencers
          </button>
          <button className={"subtab" + (activeView === "activity" ? " active" : "")} onClick={() => setActiveView("activity")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight: "6px", display: "inline-block"}}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Activity Log
          </button>
        </div>
      </div>

      <div style={{ flex: 1 }}>
        <div className="ta-head">
          <div>
            <h1>Social</h1>
            <div className="sub">
              {influencers.length} influencers tracked · {engagementRhythm.count} engagements this week
            </div>
            <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 3 }}>
              LinkedIn content, influencer engagement, and activity tracking.
            </div>
          </div>
        </div>

        {/* POSTS */}
        {activeView === "posts" && window.PostsTab && (
          <window.PostsTab toast={toast} />
        )}

        {/* CONTENT — performance tracking + comment replies */}
        {activeView === "content" && window.ContentTab && (
          <window.ContentTab toast={toast} />
        )}

        {/* INFLUENCERS */}
        {activeView === "influencers" && (
          <InfluencersView influencers={influencers} setInfluencers={setInfluencers} onOpen={setSelectedInfluencer} engagementLog={engagementLog} />
        )}

        {/* ACTIVITY */}
        {activeView === "activity" && (
          <ActivityView influencers={influencers} engagementLog={engagementLog} setEngagementLog={setEngagementLog} />
        )}

      </div>

      <InfluencerDrawer
        influencer={selectedInfluencer}
        influencers={influencers}
        engagementLog={engagementLog}
        setEngagementLog={setEngagementLog}
        onClose={() => setSelectedInfluencer(null)}
        onUpdate={(updated) => {
          setInfluencers(updated);
          // Keep the drawer in sync with the updated influencer record
          const me = updated.find((x) => x.id === selectedInfluencer?.id);
          if (me) setSelectedInfluencer(me);
        }}
      />
    </div>
  );
}

// Tier metadata: color, display label, and sort rank (Tier 1 = highest priority).
function tierMeta(tier) {
  if (tier === "Tier 1") return { color: "var(--accent)", label: "Tier 1", rank: 1 };
  if (tier === "Tier 2") return { color: "var(--blue)",   label: "Tier 2", rank: 2 };
  if (tier === "Tier 3") return { color: "var(--cyan)",   label: "Tier 3", rank: 3 };
  return { color: "var(--orange)", label: "Local", rank: 4 };
}

// Relationship funnel: Following → Connected → Engaged. Higher stage = further along.
const STAGE_OF = (p) => (p.engaged ? 3 : p.connected ? 2 : p.following ? 1 : 0);
// Derived next action per funnel stage, with an urgency color.
const NEXT_MOTION = [
  { text: "Follow + study feed",   color: "var(--orange)" },
  { text: "Comment, then connect", color: "var(--accent)" },
  { text: "Engage with a post",    color: "var(--blue)" },
  { text: "Nurture / DM",          color: "var(--green)" },
];
const lastTouch = (p) => p.lastEngagement || p.last || "";
// Composite priority: high tier + early funnel stage = act first (lower = more urgent).
const PRIORITY_OF = (p) => tierMeta(p.tier).rank * 4 + STAGE_OF(p);
const initialsOf = (name) =>
  (name?.split(" ").filter(Boolean).map((w, i, a) => (i === 0 || i === a.length - 1 ? w[0] : "")).join("") || "??").toUpperCase();

function weeklyEngagementRhythm(log, now = new Date()) {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = day.getDay() === 0 ? 7 : day.getDay();
  const monday = new Date(day); monday.setDate(day.getDate() - (dow - 1));
  const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const engagements = (log || []).filter(a => !/connection request/i.test(a.actionType || ""));
  const count = engagements.filter(a => String(a.date || "").slice(0, 10) >= ymd(monday) && String(a.date || "").slice(0, 10) <= ymd(day)).length;
  const latest = engagements.map(a => String(a.date || "").slice(0, 10)).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().pop();
  const lastDate = latest ? new Date(`${latest}T12:00:00`) : null;
  const daysSince = lastDate ? Math.max(0, Math.floor((day - lastDate) / 86400000)) : null;
  return { count, daysSince };
}

function InfluencersView({ influencers, setInfluencers, onOpen, engagementLog = [] }) {
  const [filter, setFilter] = useState("all");
  // Adding people used to be impossible from the UI: there was no create route and
  // no form, so the only way to populate this tab was to hand-author
  // data/linkedin-ssi/influencers.json.
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: "", role: "", tier: "local", track: "", location: "", linkedin: "", whyFollow: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const engagementRhythm = useMemo(() => weeklyEngagementRhythm(engagementLog), [engagementLog]);

  const submitNew = async () => {
    if (!draft.name.trim() || busy) return;
    setBusy(true); setMsg("");
    try {
      const r = await window.tjkMutate("/api/linkedin-ssi/influencers", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft),
      });
      const list = await r.json();
      if (!Array.isArray(list)) throw new Error(list.error || "Could not add.");
      setInfluencers(list);
      setDraft({ name: "", role: "", tier: "local", track: "", location: "", linkedin: "", whyFollow: "" });
      setAdding(false);
      setMsg("Added.");
    } catch (e) { setMsg(e.message || "Could not add."); }
    finally { setBusy(false); }
  };

  const importCsv = async (file) => {
    if (!file || busy) return;
    setBusy(true); setMsg("");
    try {
      const csv = await file.text();
      const r = await window.tjkMutate("/api/linkedin-ssi/influencers/import", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ csv }),
      });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || "Import failed.");
      if (Array.isArray(d.influencers)) setInfluencers(d.influencers);
      setMsg(`Imported ${d.imported}${d.duplicates ? `, ${d.duplicates} duplicates skipped` : ""}.`);
    } catch (e) { setMsg(e.message || "Could not read the file."); }
    finally { setBusy(false); }
  };

  // Default sort surfaces the highest-value contacts that still need a motion.
  const [sortKey, setSortKey] = useState("priority");
  const [sortDir, setSortDir] = useState("asc");
  const setSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "last" || k === "stage" ? "desc" : "asc"); }
  };

  const tiers = useMemo(() => {
    const unique = new Set(influencers.map(i => {
      if (i.tier === "local") return "local";
      return i.tier; // returns "Tier 1", "Tier 2", etc.
    }));
    return ["all", ...Array.from(unique).sort()];
  }, [influencers]);
  const counts = useMemo(() => ({
    all: influencers.length,
    ...Object.fromEntries(tiers.slice(1).map(t => [t, influencers.filter(i => {
      if (t === "local") return i.tier === "local";
      return i.tier === t;
    }).length]))
  }), [influencers, tiers]);
  const filtered = useMemo(() => {
    if (filter === "all") return influencers;
    if (filter === "local") return influencers.filter(i => i.tier === "local");
    return influencers.filter(i => i.tier === filter);
  }, [influencers, filter]);

  const sortVal = (p, key) => {
    switch (key) {
      case "name":  return (p.name || "").toLowerCase();
      case "title": return (p.role || "").toLowerCase();
      case "tier":  return tierMeta(p.tier).rank;
      case "track": return (p.track || "").toLowerCase();
      case "stage": return STAGE_OF(p);
      case "last":  return lastTouch(p);
      case "priority": return PRIORITY_OF(p);
      default: return "";
    }
  };
  const shown = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = sortVal(a, sortKey), bv = sortVal(b, sortKey);
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      // Stable tiebreak: priority, then name.
      const ap = PRIORITY_OF(a), bp = PRIORITY_OF(b);
      if (ap !== bp) return ap - bp;
      return (a.name || "").localeCompare(b.name || "");
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const cols = [
    { k: "name",     label: "Influencer",  w: 190 },
    { k: "title",    label: "Title",       w: 210 },
    { k: "tier",     label: "Tier",        w: 86 },
    { k: "track",    label: "Track",       w: 150 },
    { k: "stage",    label: "Status",      w: 132 },
    { k: "last",     label: "Last touch",  w: 104 },
    { k: "priority", label: "Next motion", w: 196 },
  ];

  return (
    <div className="fade-up">
      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title">Influencers</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            {msg && <span className="mono" style={{ fontSize: 10.5, color: "var(--text-mute)" }}>{msg}</span>}
            <span className="card-meta mono">
              {shown.length} of {influencers.length} · {influencers.filter(i => i.following).length} followed · <span style={{ color: engagementRhythm.count >= 3 ? "var(--green)" : "var(--orange)" }}>{engagementRhythm.count} of 3 this week</span>{engagementRhythm.daysSince > 7 ? ` · last engagement ${engagementRhythm.daysSince} days ago` : ""}
            </span>
            <a className="btn" href="/api/linkedin-ssi/influencers/template" title="Download the CSV template (name, role, track, tier, location, linkedin, ...)">Template</a>
            <label className="btn" style={{ cursor: busy ? "default" : "pointer" }} title="Bulk-import influencers from a CSV file">
              {busy ? "Working…" : "Import CSV"}
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} disabled={busy}
                onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; importCsv(f); }} />
            </label>
            <button className="btn primary" onClick={() => setAdding(a => !a)}>{adding ? "Cancel" : "+ Add influencer"}</button>
          </div>
        </div>

        {adding && (
          <div className="card" style={{ padding: "12px 14px", margin: "6px 0 12px" }}>
            <div className="mono" style={{ fontSize: 10.5, color: "var(--text-mute)", letterSpacing: ".08em", marginBottom: 9 }}>NEW INFLUENCER</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 8 }}>
              <input className="inp" aria-label="Contact name" placeholder="Name (required)" value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") submitNew(); }} autoFocus />
              <input className="inp" aria-label="Role" placeholder="Role, e.g. VP of Marketing" value={draft.role}
                onChange={e => setDraft(d => ({ ...d, role: e.target.value }))} />
              <input className="inp" aria-label="Track" placeholder="Track, e.g. revops" value={draft.track}
                onChange={e => setDraft(d => ({ ...d, track: e.target.value }))} />
              <input className="inp" aria-label="Tier" placeholder="Tier, e.g. local" value={draft.tier}
                onChange={e => setDraft(d => ({ ...d, tier: e.target.value }))} />
              <input className="inp" aria-label="Location" placeholder="Location" value={draft.location}
                onChange={e => setDraft(d => ({ ...d, location: e.target.value }))} />
              <input className="inp" aria-label="LinkedIn profile URL" placeholder="LinkedIn profile URL" value={draft.linkedin}
                onChange={e => setDraft(d => ({ ...d, linkedin: e.target.value }))} />
            </div>
            <input className="inp" style={{ marginTop: 9, width: "100%" }} aria-label="Why follow them" placeholder="Why follow them? (what they post about, and your angle)"
              value={draft.whyFollow} onChange={e => setDraft(d => ({ ...d, whyFollow: e.target.value }))} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <button className="btn primary" onClick={submitNew} disabled={!draft.name.trim() || busy}>{busy ? "Saving…" : "Save influencer"}</button>
              <span style={{ fontSize: 11, color: "var(--text-mute)" }}>
                Only the name is required. The rest sharpens the drafts Claude writes for you later,
                so it is worth filling in when you know it.
              </span>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", margin: "4px 0 10px", gap: 12, flexWrap: "wrap" }}>
          <div className="chips">
            <button key="all" className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")} style={{ border: "none", background: "none", cursor: "pointer" }}>
              All<span className="ct">{counts["all"] ?? 0}</span>
            </button>
            {tiers.slice(1).map((t) => (
              <button key={t} className={"chip" + (filter === t ? " on" : "")} onClick={() => setFilter(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                {t === "local" ? "Local" : t}
                <span className="ct">{counts[t] ?? 0}</span>
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)", letterSpacing: ".06em" }}>
            sorted by {cols.find(c => c.k === sortKey)?.label.toLowerCase()} · click a row for details
          </div>
        </div>

        <div className="tbl-wrap" style={{ maxHeight: "calc(100vh - 340px)", border: "none", borderRadius: 0, background: "transparent" }}>
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
              {shown.length === 0 && (
                <tr><td colSpan={cols.length}><div className="no-data" style={{ padding: 40, textAlign: "center", lineHeight: 1.7 }}>
                  {influencers.length === 0 ? (
                    <>
                      No influencers yet.<br />
                      <span style={{ fontSize: 11, color: "var(--text-mute)" }}>
                        These are the people whose posts you want to show up under. Add a few with
                        <b> + Add influencer</b>, or import a list with <b>Import CSV</b>. Everything
                        else on this tab (your activity log, the AI drafts, your weekly score) is
                        built from this list, so it is the place to start.
                      </span>
                    </>
                  ) : "No influencers in this tier."}
                </div></td></tr>
              )}
              {shown.map((p) => {
                const tm = tierMeta(p.tier);
                const stage = STAGE_OF(p);
                const motion = NEXT_MOTION[stage];
                const lt = lastTouch(p);
                return (
                  <tr key={p.id ?? p.name} onClick={() => onOpen && onOpen(p)} tabIndex={onOpen ? 0 : undefined} onKeyDown={onOpen ? window.kbdActivate(() => onOpen(p)) : undefined} style={{ cursor: onOpen ? "pointer" : "default" }}>
                    <td>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                        <div className="mono-av sm" style={{ borderColor: tm.color, color: tm.color, flex: "none" }}>{initialsOf(p.name)}</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                      </div>
                    </td>
                    <td className="ssi-title" title={p.role || ""}>
                      <span style={{ fontSize: 12, color: "var(--text-dim)", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.role || "-"}</span>
                    </td>
                    <td>
                      <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: tm.color, border: `1px solid ${tm.color}`, padding: "2px 6px", borderRadius: 5, opacity: .9, whiteSpace: "nowrap" }}>{tm.label}</span>
                    </td>
                    <td>{p.track ? <span className="tag">{p.track}</span> : <span style={{ color: "var(--text-mute)" }}>—</span>}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[
                          { ltr: "F", on: p.following, c: "var(--accent)", title: "Following" },
                          { ltr: "C", on: p.connected, c: "var(--green)",  title: "Connected" },
                          { ltr: "E", on: p.engaged,   c: "var(--blue)",   title: "Engaged" },
                        ].map((s) => (
                          <span key={s.ltr} title={s.title + (s.on ? "" : " (not yet)")}
                            style={{ width: 19, height: 19, borderRadius: 5, display: "inline-flex", alignItems: "center", justifyContent: "center",
                              fontFamily: "var(--mono)", fontSize: 10.5, fontWeight: 700,
                              color: s.on ? s.c : "var(--text-mute)", border: `1px solid ${s.on ? s.c : "var(--border)"}`,
                              opacity: s.on ? 1 : .5 }}>{s.ltr}</span>
                        ))}
                      </div>
                    </td>
                    <td><span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: lt ? "var(--text-dim)" : "var(--text-mute)" }}>{lt ? lt.slice(5) : "-"}</span></td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-dim)" }}>
                        <span style={{ width: 6, height: 6, borderRadius: 99, background: motion.color, flex: "none" }} />
                        {motion.text}
                      </span>
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

function ActivityView({ influencers, engagementLog, setEngagementLog }) {
  const ACTIVITY_TYPES = ["Commented", "Posted", "Messaged", "Responded", "Reposted", "Connection request"];
  const typeColor = (t) => ({ Commented: "var(--accent)", Posted: "var(--blue)", Messaged: "var(--cyan)", Responded: "var(--green)", Reposted: "var(--orange)", "Connection request": "var(--accent-2)" }[t] || "var(--text-mute)");

  const today = new Date().toISOString().split('T')[0];
  const [type, setType] = useState("Commented");
  const [date, setDate] = useState(today);
  const [influencerId, setInfluencerId] = useState("");
  const [topic, setTopic] = useState("");
  const [message, setMessage] = useState("");
  const [responseReceived, setResponseReceived] = useState("No");
  const [connectionMade, setConnectionMade] = useState("Pending");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const reset = () => {
    setType("Commented");
    setDate(new Date().toISOString().split('T')[0]);
    setInfluencerId("");
    setTopic("");
    setMessage("");
    setResponseReceived("No");
    setConnectionMade("Pending");
    setNotes("");
    setError("");
  };

  const submit = async () => {
    setError("");
    if (!influencerId) { setError("Pick an influencer."); return; }
    if (!date) { setError("Date is required."); return; }
    if (!topic.trim()) { setError("Topic is required."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/engagement-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencerId: parseInt(influencerId, 10),
          date,
          actionType: type,
          topic: topic.trim(),
          message: message.trim(),
          responseReceived,
          connectionMade,
          notes: notes.trim(),
        }),
      });
      if (!res.ok) throw new Error('Server returned ' + res.status);
      const entries = await res.json();
      setEngagementLog([...(entries || [])].sort(byLoggedAtDesc));
      reset();
    } catch (e) {
      setError("Save failed: " + e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "2fr 3fr", alignItems: "start", gap: 24 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Log New Activity</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field"><label>Date</label><input className="inp" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="field"><label>Influencer</label>
              <select className="sel" value={influencerId} onChange={(e) => setInfluencerId(e.target.value)}>
                <option value="" disabled>Select…</option>
                {[...(influencers || [])].sort(byNameAsc).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field"><label>Activity type</label>
            <div className="chips">
              {ACTIVITY_TYPES.map((t) => (
                <button key={t} className={"chip" + (type === t ? " on" : "")} onClick={() => setType(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: typeColor(t) }} />{t}
                </button>
              ))}
            </div>
          </div>
          <div className="field"><label>Topic</label><input className="inp" aria-label="Topic" placeholder="e.g. Category framing" value={topic} onChange={(e) => setTopic(e.target.value)} /></div>
          <div className="field"><label>Your message</label><textarea className="ta" aria-label="Your message" placeholder="What you said (keep it short)" value={message} onChange={(e) => setMessage(e.target.value)} /></div>
          <div className="grid cols-2" style={{ gap: 10 }}>
            <div className="field"><label>Got a response?</label>
              <select className="sel" value={responseReceived} onChange={(e) => setResponseReceived(e.target.value)}>
                <option>No</option><option>Yes</option>
              </select>
            </div>
            <div className="field"><label>Connection</label>
              <select className="sel" value={connectionMade} onChange={(e) => setConnectionMade(e.target.value)}>
                <option>Pending</option><option>Connected</option><option>Following</option>
              </select>
            </div>
          </div>
          <div className="field"><label>Notes <span style={{ color: "var(--text-mute)", fontSize: 10.5, fontWeight: 400 }}>(optional)</span></label>
            <input className="inp" aria-label="Follow-up notes" placeholder="Follow-up plan, context, etc." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          {error && <div style={{ fontSize: 11, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn primary block" style={{ flex: 1 }} onClick={submit} disabled={busy}>{busy ? "Saving…" : "+ Log Activity"}</button>
            <button className="btn" onClick={reset} disabled={busy}>Reset</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Recent Activity</div>
          <span className="mute2 mono" style={{ marginLeft: "auto", fontSize: 10.5 }}>{(engagementLog || []).length} entries</span>
        </div>
        <div style={{ position: "relative", paddingLeft: 6 }}>
          <div style={{ position: "absolute", left: 22, top: 8, bottom: 8, width: 1, background: "var(--border)" }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {(engagementLog || []).map((a, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "34px 1fr", gap: 12, position: "relative", padding: "10px 0" }}>
                <div style={{ position: "relative", zIndex: 1 }}>
                  <div className="mono-av sm" style={{ background: "var(--panel)", borderColor: typeColor(a.actionType), color: typeColor(a.actionType) }}>
                    {((a.influencer || "?").split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") || "??").toUpperCase()}
                  </div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{a.influencer}</span>
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: typeColor(a.actionType), border: `1px solid ${typeColor(a.actionType)}`, opacity: .85, padding: "2px 6px", borderRadius: 5 }}>{a.actionType}</span>
                    <span className="tag">{a.topic}</span>
                    <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)" }}>{a.date}</span>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-dim)", margin: "5px 0 7px", lineHeight: 1.55 }}>{a.message}</div>
                  <div style={{ display: "flex", gap: 14 }}>
                    <span className={"pill " + (a.responseReceived === "Yes" ? "green" : "")} style={{ opacity: a.responseReceived === "Yes" ? 1 : .45 }}><span className="d" />{a.responseReceived === "Yes" ? "Response received" : "No response"}</span>
                    <span className={"pill " + (a.connectionMade === "Connected" ? "accent" : "")} style={{ opacity: a.connectionMade === "Connected" ? 1 : .45 }}><span className="d" />{a.connectionMade === "Connected" ? "Connected" : "Not connected"}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function AIResponseView({ influencers, lockedInfluencer, onLog }) {
  const [post, setPost] = useState("");
  const [who, setWho] = useState(lockedInfluencer?.name || "");
  const [tone, setTone] = useState("Insightful");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);
  const [logErr, setLogErr] = useState("");
  const TONES = ["Insightful", "Supportive", "Contrarian", "Curious"];
  useEffect(() => { if (lockedInfluencer) setWho(lockedInfluencer.name); }, [lockedInfluencer?.name]);

  const logIt = async () => {
    if (!onLog || !out) return;
    setLogErr(""); setLogging(true);
    const snippet = post.trim();
    const topic = snippet ? ("Re: " + snippet.slice(0, 48) + (snippet.length > 48 ? "…" : "")) : "Comment reply";
    try {
      await onLog({ topic, message: out });
    } catch (e) {
      setLogErr(e.message || "Failed to log."); setLogging(false);
    }
  };

  const generate = async () => {
    setError("");
    if (!post.trim()) { setError("Paste the LinkedIn post first."); return; }
    if (!who) { setError("Pick who you're responding to."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/generate-response', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postText: post, influencerName: who, tone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setOut(data.response || '');
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "1fr", alignItems: "start", gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Generate LinkedIn Response</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field"><label>LinkedIn post</label>
            <textarea className="ta" style={{ minHeight: 132 }} value={post} onChange={(e) => setPost(e.target.value)} placeholder="Paste the post you want to respond to…" />
          </div>
          {!lockedInfluencer && (
            <div className="field"><label>Responding to</label>
              <select className="sel" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Select an influencer…</option>
                {[...influencers].sort(byNameAsc).map((i) => <option key={i.name}>{i.name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label>Tone</label>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + (tone === t ? " on" : "")} onClick={() => setTone(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize: 11, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={generate} disabled={busy}>{busy ? "Generating with Claude…" : "Generate Response"}</button>
            <button className="btn" onClick={() => { setPost(""); if (!lockedInfluencer) setWho(""); setOut(""); setError(""); }}>Clear</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Suggested Reply</div>
          {out && <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(out)}>Copy</button>}
        </div>
        {!out && !busy && (
          <div style={{ minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", padding: 20 }}>
            <div className="empty">Paste a post, pick who you're replying to, and Claude will draft a {tone.toLowerCase()} reply grounded in that specific post.</div>
          </div>
        )}
        {busy && (
          <div style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
            drafting a {tone.toLowerCase()} reply with Claude…
          </div>
        )}
        {out && !busy && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div className="mono-av sm">{who ? who.split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") : "??"}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{who || "Unspecified"}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)" }}>{tone} · reply draft</div>
              </div>
            </div>
            <textarea className="ta" value={out} onChange={(e) => setOut(e.target.value)} aria-label="Editable draft, tweak it before you copy or log"
              style={{ width: "100%", minHeight: 120, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "14px 14px", fontSize: 13, lineHeight: 1.65, color: "var(--text)", resize: "vertical", fontFamily: "inherit" }} />
            {logErr && <div style={{ fontSize: 11, color: "var(--red, #e06262)", fontFamily: "var(--mono)", marginTop: 10 }}>{logErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {onLog && lockedInfluencer && (
                <button className="btn primary sm" onClick={logIt} disabled={logging}>{logging ? "Logging…" : "✓ Log to timeline"}</button>
              )}
              <button className="btn sm" onClick={generate} disabled={logging}>Regenerate</button>
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(out)}>Copy reply</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AIConnectView({ influencers, lockedInfluencer, onLog }) {
  const [who, setWho] = useState(lockedInfluencer?.name || "");
  const [priorEngagement, setPriorEngagement] = useState("");
  const [theirRole, setTheirRole] = useState(lockedInfluencer?.role || "");
  const [tone, setTone] = useState("Warm");
  const [angle, setAngle] = useState("Reference Post");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [logging, setLogging] = useState(false);
  const [logErr, setLogErr] = useState("");
  useEffect(() => {
    if (lockedInfluencer) {
      setWho(lockedInfluencer.name);
      setTheirRole(lockedInfluencer.role || "");
    }
  }, [lockedInfluencer?.name]);

  const logIt = async () => {
    if (!onLog || !out) return;
    setLogErr(""); setLogging(true);
    const ref = priorEngagement.trim();
    const topic = ref ? (angle + " · " + ref.slice(0, 36) + (ref.length > 36 ? "…" : "")) : angle;
    try {
      await onLog({ topic, message: out });
    } catch (e) {
      setLogErr(e.message || "Failed to log."); setLogging(false);
    }
  };

  const TONES = ["Warm", "Concise", "Professional", "Curious"];
  const ANGLES = ["Reference Post", "Mutual Interest", "Shared Network", "Career Stage"];
  const LIMIT = 300; // LinkedIn connection note cap

  const generate = async () => {
    setError("");
    if (!who) { setError("Pick an influencer first."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/generate-connect-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          influencerName: who,
          theirRole: theirRole.trim(),
          priorEngagement: priorEngagement.trim(),
          angle,
          tone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setOut(data.response || '');
    } catch (e) {
      setError(e.message || 'Generation failed.');
    } finally {
      setBusy(false);
    }
  };

  const charCount = out.length;
  const charStatus = charCount === 0 ? "" : charCount <= LIMIT ? "ok" : "over";

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "1fr", alignItems: "start", gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Generate Connection Request</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {!lockedInfluencer && (
            <div className="field"><label>Connecting with</label>
              <select className="sel" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Select an influencer…</option>
                {[...influencers].sort(byNameAsc).map((i) => <option key={i.name}>{i.name}</option>)}
              </select>
            </div>
          )}
          <div className="field"><label>Their role / focus area <span style={{ color: "var(--text-mute)", fontSize: 10.5, fontWeight: 400 }}>(optional, used in some angles)</span></label>
            <input className="sel" type="text" value={theirRole} onChange={(e) => setTheirRole(e.target.value)} placeholder="e.g. RevOps leadership, GTM analytics" />
          </div>
          <div className="field"><label>Prior engagement reference <span style={{ color: "var(--text-mute)", fontSize: 10.5, fontWeight: 400 }}>(the post topic you already commented on)</span></label>
            <textarea className="ta" style={{ minHeight: 64 }} value={priorEngagement} onChange={(e) => setPriorEngagement(e.target.value)} placeholder="e.g. RevOps tooling vs. process, MEDDPICC adoption…" />
          </div>
          <div className="field"><label>Angle</label>
            <div className="chips">
              {ANGLES.map((a) => (
                <button key={a} className={"chip" + (angle === a ? " on" : "")} onClick={() => setAngle(a)} style={{ border: "none", background: "none", cursor: "pointer" }}>{a}</button>
              ))}
            </div>
          </div>
          <div className="field"><label>Tone</label>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + (tone === t ? " on" : "")} onClick={() => setTone(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize: 11, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn primary" style={{ flex: 1 }} onClick={generate} disabled={busy || !who}>{busy ? "Generating with Claude…" : "Generate Request"}</button>
            <button className="btn" onClick={() => { if (!lockedInfluencer) { setWho(""); setTheirRole(""); } setPriorEngagement(""); setOut(""); setError(""); }}>Clear</button>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-mute)", fontFamily: "var(--mono)", lineHeight: 1.55 }}>
            LinkedIn caps connection notes at <b>300 characters</b>. Drafts target ~280 with safety margin; if Claude overshoots, the note is trimmed at the last sentence and the sign-off is preserved.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Suggested Connection Note</div>
          {out && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: charStatus === "over" ? "var(--red, #e06262)" : "var(--text-mute)" }}>
                {charCount} / {LIMIT}
              </span>
              <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(out)}>Copy</button>
            </div>
          )}
        </div>
        {!out && !busy && (
          <div style={{ minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center", padding: 20 }}>
            <div className="empty">Pick who you're connecting with, paste the post topic you already commented on, then generate a {tone.toLowerCase()} request.</div>
          </div>
        )}
        {busy && (
          <div style={{ minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
            drafting a {tone.toLowerCase()} connection note…
          </div>
        )}
        {out && !busy && (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <div className="mono-av sm">{who ? who.split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") : "??"}</div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{who || "Unspecified"}</div>
                <div style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)" }}>{angle} · {tone.toLowerCase()}</div>
              </div>
            </div>
            <textarea className="ta" value={out} onChange={(e) => setOut(e.target.value)} aria-label="Editable draft, tweak it before you copy or log"
              style={{ width: "100%", minHeight: 120, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "14px 14px", fontSize: 13, lineHeight: 1.65, color: "var(--text)", resize: "vertical", fontFamily: "inherit" }} />
            {logErr && <div style={{ fontSize: 11, color: "var(--red, #e06262)", fontFamily: "var(--mono)", marginTop: 10 }}>{logErr}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              {onLog && lockedInfluencer && (
                <button className="btn primary sm" onClick={logIt} disabled={logging}>{logging ? "Logging…" : "✓ Log to timeline"}</button>
              )}
              <button className="btn sm" onClick={generate} disabled={logging}>Regenerate</button>
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(out)}>Copy note</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// AI Reply — the ongoing-conversation tab. Once you're connected and they write
// back, paste their message here: log it (their inbound reply, timestamped), then
// draft your response. The backend reads this contact's prior history so the reply
// builds on the thread. Two explicit log steps (their reply, then yours) keep the
// timeline honest and under your control. lockedInfluencer is always set (this tab
// only exists inside an influencer's drawer).
function AIReplyView({ lockedInfluencer, onLogTheirReply, onLogMyReply }) {
  const [theirMsg, setTheirMsg] = useState("");
  const [tone, setTone] = useState("Curious");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [theirLogged, setTheirLogged] = useState(false);
  const [loggingTheir, setLoggingTheir] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const TONES = ["Curious", "Insightful", "Warm", "Supportive"];
  const who = lockedInfluencer?.name || "";

  const logTheir = async () => {
    if (!theirMsg.trim()) { setError("Paste their message first."); return; }
    setError(""); setLoggingTheir(true);
    try { await onLogTheirReply({ message: theirMsg.trim() }); setTheirLogged(true); }
    catch (e) { setError(e.message || "Failed to log their reply."); }
    finally { setLoggingTheir(false); }
  };

  const generate = async () => {
    setError("");
    if (!theirMsg.trim()) { setError("Paste their message first."); return; }
    if (!who) { setError("Open this from an influencer."); return; }
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/linkedin-ssi/generate-reply', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ influencerName: who, theirMessage: theirMsg, tone }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
      setOut(data.response || '');
    } catch (e) { setError(e.message || 'Generation failed.'); }
    finally { setBusy(false); }
  };

  const markSent = async () => {
    if (!out.trim() || sending || sent) return;
    setSending(true); setError("");
    try { await onLogMyReply({ message: out.trim() }); setSent(true); }
    catch (e) { setError(e.message || "Failed to log your reply."); setSending(false); }
  };

  return (
    <div className="grid fade-up" style={{ gridTemplateColumns: "1fr", alignItems: "start", gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Their message{who ? " · " + who : ""}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field"><label>Paste what they sent you</label>
            <textarea className="ta" style={{ minHeight: 120 }} value={theirMsg}
              onChange={(e) => { setTheirMsg(e.target.value); setTheirLogged(false); }}
              placeholder="Paste their reply or DM here…" />
          </div>
          <div className="field"><label>Tone of your reply</label>
            <div className="chips">
              {TONES.map((t) => (
                <button key={t} className={"chip" + (tone === t ? " on" : "")} onClick={() => setTone(t)} style={{ border: "none", background: "none", cursor: "pointer" }}>{t}</button>
              ))}
            </div>
          </div>
          {error && <div style={{ fontSize: 11, color: "var(--red, #e06262)", fontFamily: "var(--mono)" }}>{error}</div>}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {theirLogged
              ? <span className="btn sm" style={{ pointerEvents: "none", color: "var(--green)", fontWeight: 600 }}>✓ Their reply logged</span>
              : <button className="btn" onClick={logTheir} disabled={loggingTheir} title="Timestamp their inbound message into the timeline and mark them Connected + engaged.">{loggingTheir ? "Logging…" : "Log their reply"}</button>}
            <button className="btn primary" style={{ flex: 1, minWidth: 160 }} onClick={generate} disabled={busy}>{busy ? "Drafting with Claude…" : "Generate my reply"}</button>
            <button className="btn" onClick={() => { setTheirMsg(""); setOut(""); setError(""); setTheirLogged(false); setSent(false); }}>Clear</button>
          </div>
          <div className="dim" style={{ fontSize: 11 }}>
            The draft reads your prior logged history with {who || "this contact"} so it builds on the thread. It never pitches or asks for anything. Edit it before you send.
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title"><span className="dot" />Your reply</div>
          {out && <button className="btn ghost sm" onClick={() => navigator.clipboard.writeText(out)}>Copy</button>}
        </div>
        {!out && !busy && (
          <div style={{ minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 20 }}>
            <div className="empty">Paste their message and hit Generate. Claude drafts a {tone.toLowerCase()} reply grounded in what they said and your history together.</div>
          </div>
        )}
        {busy && (
          <div style={{ minHeight: 160, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontFamily: "var(--mono)", fontSize: 12 }}>
            drafting a {tone.toLowerCase()} reply with Claude…
          </div>
        )}
        {out && !busy && (
          <div>
            <textarea className="ta" value={out} onChange={(e) => { setOut(e.target.value); setSent(false); }} aria-label="Editable reply draft"
              style={{ width: "100%", minHeight: 130, background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "14px 14px", fontSize: 13, lineHeight: 1.65, color: "var(--text)", resize: "vertical", fontFamily: "inherit" }} />
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button className="btn sm" onClick={generate}>Regenerate</button>
              <button className="btn sm" onClick={() => navigator.clipboard.writeText(out)}>Copy reply</button>
              {sent
                ? <span className="btn primary sm" style={{ pointerEvents: "none" }}>✓ Sent logged</span>
                : <button className="btn primary sm" onClick={markSent} disabled={sending} title="Send it on LinkedIn first, then log it here as your outbound touch.">{sending ? "Logging…" : "Mark sent"}</button>}
            </div>
            <div className="dim" style={{ fontSize: 11, marginTop: 8 }}>
              Send it from LinkedIn yourself, then Mark sent to log the touch. Nothing is sent from here.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Influencer Drawer ─────────────────────────────────────────────────────
// Slide-in side panel that mirrors the TA Outreach drawer (.drawer.wide) so
// the look-and-feel matches across the dashboard. Inner tabs:
// Overview (intel + per-influencer activity) · AI Response · AI Connect · AI Reply.
// Tab order follows the real motion: comment on a post, send a connect request,
// then once they respond, carry the conversation forward in AI Reply.
function InfluencerDrawer({ influencer, influencers, engagementLog, setEngagementLog, onClose, onUpdate }) {
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const open = influencer != null;

  // Reset to overview whenever a new influencer is opened
  useEffect(() => { if (influencer) setTab("overview"); }, [influencer?.id]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!influencer) {
    return (
      <>
        <div className="drawer-backdrop" style={{ opacity: 0, pointerEvents: "none" }} />
        <div className="drawer wide" style={{ transform: "translateX(100%)" }} />
      </>
    );
  }

  const tierColor =
    influencer.tier === "Tier 1" ? "var(--accent)" :
    influencer.tier === "Tier 2" ? "var(--blue)" :
    influencer.tier === "Tier 3" ? "var(--cyan)" : "var(--orange)";
  const tierLabel = influencer.tier === "local" ? "Local" : influencer.tier;
  const initials = (influencer.name?.split(" ").filter(Boolean).map((w,i,a) => i===0||i===a.length-1?w[0]:"").join("") || "??").toUpperCase();

  // Filter the engagement log to this influencer, newest first
  const myEngagement = [...(engagementLog || [])]
    .filter((e) => e.influencer === influencer.name)
    .sort(byLoggedAtDesc);

  const patchInfluencer = async (updates) => {
    setBusy(true);
    try {
      const res = await window.tjkMutate(`/api/linkedin-ssi/influencers/${influencer.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data) && onUpdate) onUpdate(data);
    } catch {} finally { setBusy(false); }
  };

  const toggleFollowing = () => patchInfluencer({ following: !influencer.following });
  const toggleConnected = () => patchInfluencer({ connected: !influencer.connected });
  const toggleEngaged = () => patchInfluencer({ engaged: !influencer.engaged });

  // Log a generated AI draft (comment reply or connection note) straight into the
  // shared engagement log, which surfaces in the Overview timeline. Then advance the
  // influencer's status + last touch, and flip to Overview so the new entry is visible.
  // responseReceived/connectionMade/notes override the defaults so the AI Reply tab
  // can log an INBOUND message (they wrote back → responseReceived "Yes"). stay keeps
  // the current tab instead of snapping to Overview, so a multi-step flow (log their
  // reply, then draft yours) is not interrupted.
  const logToTimeline = async ({ actionType, topic, message, responseReceived, connectionMade, notes = "", statusUpdates = {}, stay = false }) => {
    const today = new Date().toISOString().split("T")[0];
    const res = await window.tjkMutate("/api/linkedin-ssi/engagement-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        influencerId: influencer.id,
        date: today,
        actionType,
        topic: topic || "",
        message: message || "",
        responseReceived: responseReceived || "No",
        connectionMade: connectionMade || (influencer.connected ? "Connected" : "Pending"),
        notes: notes || "",
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || ("HTTP " + res.status));
    }
    const entries = await res.json();
    if (setEngagementLog) {
      setEngagementLog([...(entries || [])].sort(byLoggedAtDesc));
    }
    // Stamp last touch + bump count, plus any funnel advance the caller requested.
    await patchInfluencer({
      lastEngagement: today,
      engagementCount: (influencer.engagementCount || 0) + 1,
      ...statusUpdates,
    });
    if (!stay) setTab("overview");
  };

  return (
    <>
      <div
        className={"drawer-backdrop" + (open ? " open" : "")}
        onClick={onClose}
        style={{ opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none" }}
      />
      <div
        className={"drawer wide" + (open ? " open" : "")}
        style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
      >
        <div className="drawer-head">
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <span style={{ fontFamily: "var(--mono)", fontSize: 11, color: "var(--text-mute)" }}>#{influencer.id}</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".08em", textTransform: "uppercase", color: tierColor, border: `1px solid ${tierColor}`, padding: "2px 6px", borderRadius: 5, opacity: .9 }}>{tierLabel}</span>
            {influencer.track && <span className="tag accent">{influencer.track}</span>}
            <button className="icon-btn" onClick={onClose} style={{ marginLeft: "auto" }} title="Close (Esc)">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span className="mono-av" style={{ width: 44, height: 44, fontSize: 14, borderRadius: 10, borderColor: tierColor, color: tierColor, flex: "none" }}>{initials}</span>
            <div style={{ minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>{influencer.name}</h3>
              <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{influencer.role}</div>
              {influencer.location && (
                <div style={{ fontSize: 11, color: "var(--text-mute)", marginTop: 3, fontFamily: "var(--mono)" }}>{influencer.location}</div>
              )}
            </div>
          </div>
        </div>

        <div className="drawer-body" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Inner tab strip — sits at the top of the body, with breathing room above the header */}
          <div className="subtabs" style={{ margin: "0 -20px 6px", padding: "0 20px" }}>
            <button className={"subtab" + (tab === "overview" ? " active" : "")} onClick={() => setTab("overview")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.pulse} /></svg>
              Overview
            </button>
            <button className={"subtab" + (tab === "ai-response" ? " active" : "")} onClick={() => setTab("ai-response")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.msg} /></svg>
              AI Response
            </button>
            <button className={"subtab" + (tab === "ai-connect" ? " active" : "")} onClick={() => setTab("ai-connect")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.users} /></svg>
              AI Connect
            </button>
            <button className={"subtab" + (tab === "ai-reply" ? " active" : "")} onClick={() => setTab("ai-reply")} style={{ background: "transparent", border: "none", cursor: "pointer" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px", display: "inline-block" }}><path d={window.ICON.inbound} /></svg>
              AI Reply
            </button>
          </div>

          {tab === "overview" && (
            <>
              {/* Status pills + toggles */}
              <div className="ds-section">
                <div className="ds-label">Status</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className={"pill " + (influencer.following ? "accent" : "")}
                    onClick={toggleFollowing}
                    disabled={busy}
                    style={{ opacity: influencer.following ? 1 : 0.5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}
                    title={influencer.following ? "Click to unfollow" : "Click to follow"}>
                    <span className="d" />{influencer.following ? "Following" : "Not following"}
                  </button>
                  <button
                    className={"pill " + (influencer.connected ? "green" : "")}
                    onClick={toggleConnected}
                    disabled={busy}
                    style={{ opacity: influencer.connected ? 1 : 0.5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}
                    title={influencer.connected ? "Click to mark not connected" : "Click to mark connected"}>
                    <span className="d" />{influencer.connected ? "Connected" : "Not connected"}
                  </button>
                  <button
                    className={"pill " + (influencer.engaged ? "blue" : "")}
                    onClick={toggleEngaged}
                    disabled={busy}
                    style={{ opacity: influencer.engaged ? 1 : 0.5, cursor: "pointer", border: "1px solid var(--border)", background: "transparent" }}
                    title={influencer.engaged ? "Click to mark not engaged" : "Click to mark engaged"}>
                    <span className="d" />{influencer.engaged ? "Engaged" : "Not engaged"}
                  </button>
                  {influencer.engagementCount > 0 && (
                    <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)", alignSelf: "center" }}>
                      {influencer.engagementCount} touch{influencer.engagementCount !== 1 ? "es" : ""} logged
                    </span>
                  )}
                </div>
              </div>

              {/* Intelligence */}
              <div className="ds-section">
                <div className="ds-label">Intelligence</div>
                <div className="info-card">
                  {influencer.whyFollow && (
                    <div className="info-row">
                      <span className="ik">Why follow</span>
                      <span className="iv" style={{ whiteSpace: "normal" }}>{influencer.whyFollow}</span>
                      <span />
                    </div>
                  )}
                  {influencer.engagementTip && (
                    <div className="info-row">
                      <span className="ik">Engagement tip</span>
                      <span className="iv" style={{ whiteSpace: "normal", color: "var(--accent-2)" }}>{influencer.engagementTip}</span>
                      <span />
                    </div>
                  )}
                  {influencer.track && (
                    <div className="info-row">
                      <span className="ik">Track</span>
                      <span className="iv">{influencer.track}</span>
                      <span />
                    </div>
                  )}
                  {influencer.tier && (
                    <div className="info-row">
                      <span className="ik">Tier</span>
                      <span className="iv" style={{ color: tierColor }}>{tierLabel}</span>
                      <span />
                    </div>
                  )}
                  {influencer.location && (
                    <div className="info-row">
                      <span className="ik">Location</span>
                      <span className="iv">{influencer.location}</span>
                      <span />
                    </div>
                  )}
                  {influencer.linkedinUrl && (
                    <div className="info-row">
                      <span className="ik">LinkedIn</span>
                      <a className="iv link" href={window.safeHref(influencer.linkedinUrl)} target="_blank" rel="noreferrer">Open profile ↗</a>
                      <span />
                    </div>
                  )}
                  {influencer.lastEngagement && (
                    <div className="info-row">
                      <span className="ik">Last touch</span>
                      <span className="iv" style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{influencer.lastEngagement}</span>
                      <span />
                    </div>
                  )}
                </div>
              </div>

              {/* Activity stream */}
              <div className="ds-section">
                <div className="ds-label">
                  Activity
                  <span className="r">{myEngagement.length} touch{myEngagement.length !== 1 ? "es" : ""}</span>
                </div>
                {myEngagement.length === 0 ? (
                  <div className="empty" style={{ padding: "10px 2px", fontSize: 12, color: "var(--text-mute)" }}>
                    No engagement logged yet. Use AI Response or AI Connect to draft your first touch.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {myEngagement.map((a, i) => (
                      <div key={i} style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--panel)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 5 }}>
                          <span style={{ fontFamily: "var(--mono)", fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--accent-2)", border: "1px solid var(--border)", padding: "2px 6px", borderRadius: 5 }}>{a.actionType}</span>
                          {a.topic && <span className="tag">{a.topic}</span>}
                          <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10.5, color: "var(--text-mute)" }}>{a.date}</span>
                        </div>
                        {a.message && <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, overflowWrap: "anywhere" }}>{a.message}</div>}
                        <div style={{ display: "flex", gap: 12, marginTop: 7 }}>
                          <span className={"pill sm " + (a.responseReceived === "Yes" ? "green" : "")} style={{ opacity: a.responseReceived === "Yes" ? 1 : 0.45 }}><span className="d" />{a.responseReceived === "Yes" ? "Response" : "No response"}</span>
                          <span className={"pill sm " + (a.connectionMade === "Connected" ? "accent" : "")} style={{ opacity: a.connectionMade === "Connected" ? 1 : 0.45 }}><span className="d" />{a.connectionMade === "Connected" ? "Connected" : "Not connected"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {tab === "ai-response" && (
            <AIResponseView
              influencers={influencers}
              lockedInfluencer={influencer}
              onLog={({ topic, message }) => logToTimeline({ actionType: "Commented", topic, message, statusUpdates: { engaged: true } })}
            />
          )}

          {tab === "ai-reply" && (
            <AIReplyView
              lockedInfluencer={influencer}
              onLogTheirReply={({ message }) => logToTimeline({
                actionType: "Responded",
                topic: "Their reply" + (message ? ": " + message.slice(0, 40) + (message.length > 40 ? "…" : "") : ""),
                message,
                responseReceived: "Yes",
                connectionMade: "Connected",
                notes: "Inbound reply",
                statusUpdates: { connected: true, engaged: true },
                stay: true,
              })}
              onLogMyReply={({ message }) => logToTimeline({
                actionType: "Messaged",
                topic: "My reply",
                message,
                notes: "Outbound reply",
                statusUpdates: { engaged: true },
              })}
            />
          )}

          {tab === "ai-connect" && (
            <AIConnectView
              influencers={influencers}
              lockedInfluencer={influencer}
              onLog={({ topic, message }) => logToTimeline({ actionType: "Connection request", topic, message })}
            />
          )}
        </div>
      </div>
    </>
  );
}

window.InfluencersView = function NetworkInfluencersView() {
  const [influencers, setInfluencers] = useState([]);
  const [selected, setSelected] = useState(null);
  const [engagementLog, setEngagementLog] = useState([]);
  useEffect(() => {
    fetch('/api/linkedin-ssi/influencers').then(r => r.json()).then(d => setInfluencers(Array.isArray(d) ? d : [])).catch(() => setInfluencers([]));
    fetch('/api/linkedin-ssi/engagement-log').then(r => r.json()).then(d => setEngagementLog(Array.isArray(d) ? d : [])).catch(() => setEngagementLog([]));
  }, []);
  return <>
    <InfluencersView influencers={influencers} setInfluencers={setInfluencers} onOpen={setSelected} engagementLog={engagementLog} />
    <InfluencerDrawer influencer={selected} influencers={influencers} engagementLog={engagementLog} setEngagementLog={setEngagementLog}
      onClose={() => setSelected(null)} onUpdate={updated => { setInfluencers(updated); setSelected(updated.find(x => x.id === selected?.id) || null); }} />
  </>;
};
window.LinkedInSSITab = LinkedInSSITab;
