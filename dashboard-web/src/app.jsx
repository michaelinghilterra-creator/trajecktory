// Root App — wires everything together
const { useState, useEffect, useMemo, useCallback, useRef } = React;

// Default tweak knobs (host can rewrite this block)
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#a78bfa",
  "density": "comfortable",
  "theme": "dark",
  "defaultPipelineView": "table",
  "targetLow": 220,
  "targetHigh": 250,
  "walkAway": 160
}/*EDITMODE-END*/;

function App() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(null);   // ms timestamp of the last apps refetch
  const [tab, setTab] = useState("pipeline");
  const [search, setSearch] = useState("");
  const [drawerApp, setDrawerApp] = useState(null);
  // Transient: a Follow-Ups click on a TA row pushes the contact id here and
  // switches tab; TargetTalentTab consumes it once and opens its own drawer.
  const [pendingTaOpen, setPendingTaOpen] = useState(null);
  const openTaContact = (id) => { setPendingTaOpen(id); setTab("target-talent"); };
  const [pipelineView, setPipelineView] = useState("overview");

  // Reset Pipeline's subtab whenever the user navigates away. Otherwise
  // pipelineView persists at app level and re-mounting PipelineTab keeps
  // showing the last subview (e.g. Board) — out of sync with every other
  // tab, which resets to Overview on re-entry. Command-palette jumps that
  // set pipelineView in the same tick still win (state updates batch).
  useEffect(() => {
    if (tab !== "pipeline" && pipelineView !== "overview") {
      setPipelineView("overview");
    }
  }, [tab]);
  const [filters, setFilters] = useState({ statuses: [], archetypes: [], scoreMin: 0 });
  const [cmdOpen, setCmdOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [tweaksOpen, setTweaksOpen] = useState(false);

  const [tweaks, setTweak] = window.useTweaks ? window.useTweaks(TWEAK_DEFAULTS) : [TWEAK_DEFAULTS, () => {}];
  const [followupCount, setFollowupCount] = useState(0);
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateHidden, setUpdateHidden] = useState(false);
  const [version, setVersion] = useState(null);

  // Enrich each app with parsed comp: cleaned display string + midpoint $K salary
  // derived from compStated. Existing callers reading `a.salary` get a real number
  // instead of null; reads of `a.compStated` get the USD/year-stripped form.
  const enrichApps = (data) => (Array.isArray(data) ? data : []).map(a => {
    if (!window.parseComp) return a;
    const { display, salary } = window.parseComp(a.compStated);
    return {
      ...a,
      compStated: display,
      salary: a.salary != null ? a.salary : salary,
    };
  });

  // Load real data from API. Extracted into refreshApps so a window-focus return
  // (after editing config/CV in Claude Code) and a finished Workflow step
  // (Evaluate, Merge) can re-sync the applications without a manual browser reload.
  const refreshApps = useCallback(() => {
    return fetch('/api/applications')
      .then(r => r.json())
      .then(data => { setApps(enrichApps(data)); setLoading(false); setLastSync(Date.now()); })
      .catch(() => {
        // Fallback to mock data if API unreachable
        setApps(enrichApps(window.APPS ? window.APPS.map(a => ({ ...a })) : []));
        setLoading(false);
      });
  }, []);
  useEffect(() => { refreshApps(); }, [refreshApps]);
  // Re-sync when the user tabs back to the dashboard.
  useEffect(() => {
    const onFocus = () => refreshApps();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refreshApps]);
  // If a row-detail drawer is open when apps re-syncs (e.g. Merge wrote new
  // rows), swap in the fresh row so the panel isn't a stale snapshot.
  useEffect(() => {
    if (!drawerApp) return;
    const fresh = apps.find(a => a.id === drawerApp.id);
    if (fresh && fresh !== drawerApp) setDrawerApp(fresh);
  }, [apps]);

  // Load pending follow-up count. The badge counts WARM threads only (replied /
  // interviewing / a contact who engaged). Cold "applications out" don't nag.
  useEffect(() => {
    fetch('/api/followups/stale')
      .then(r => r.json())
      .then(data => setFollowupCount((data.warm ?? data.items)?.length ?? 0))
      .catch(() => {}); // non-critical — badge just stays at 0
  }, []);

  // First-run detection: if core config files are missing, open Launchpad so a
  // brand-new user lands on guided setup instead of an empty dashboard. Also
  // expose the per-section state to the Sidebar (for the incomplete badge).
  const [setupState, setSetupState] = useState(null);
  useEffect(() => {
    fetch('/api/setup/state')
      .then(r => r.json())
      .then(s => { setSetupState(s); if (s.firstRun) setTab("launchpad"); })
      .catch(() => {}); // non-critical — setup tab still reachable from the nav
  }, []);

  // Load the user's identity once so draft signature blocks (recruiter / TA /
  // follow-up) render the real name + contact without hardcoding it in the
  // client bundle. Stashed on window for the shared signature helpers.
  useEffect(() => {
    fetch('/api/identity')
      .then(r => r.json())
      .then(d => { window.__TJK_IDENTITY = d; })
      .catch(() => {}); // non-critical — signature helpers fall back to empty
  }, []);

  // Check for a newer trajecktory version on load. POST because the check shells
  // out to the updater (a shallow git fetch against the repo). Only an
  // installed bundle (with a git remote + token) returns 'update-available'; a
  // dev checkout that's current returns 'up-to-date' and shows no banner.
  useEffect(() => {
    fetch('/api/system/update-check', { method: 'POST' })
      .then(r => r.json())
      .then(d => { if (d && d.status === 'update-available') setUpdateInfo(d); })
      .catch(() => {}); // non-critical — no banner if the check can't run
  }, []);

  // Current installed version, shown in the sidebar brand.
  useEffect(() => {
    fetch('/api/system/version')
      .then(r => r.json())
      .then(d => { if (d && d.version) setVersion(d.version); })
      .catch(() => {});
  }, []);

  // Strip styling when copying from .ai-out so Gmail (and other rich-text
  // targets) don't paste with a dark background highlight. We replace the
  // clipboard payload with plain text only — preserves line breaks, drops CSS.
  useEffect(() => {
    const onCopy = (e) => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const anchor = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (!anchor || !anchor.closest('.ai-out')) return;
      const text = sel.toString();
      if (!text) return;
      e.clipboardData.setData('text/plain', text);
      e.clipboardData.setData('text/html', text.replace(/\n/g, '<br>'));
      e.preventDefault();
    };
    document.addEventListener('copy', onCopy);
    return () => document.removeEventListener('copy', onCopy);
  }, []);

  // Apply theme + density + accent
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", tweaks.theme);
    document.documentElement.style.setProperty("--accent", tweaks.accent);
    document.documentElement.style.setProperty("--accent-bg", hexToRgba(tweaks.accent, 0.12));
    document.documentElement.style.setProperty("--sidebar-w", "232px");
  }, [tweaks.theme, tweaks.accent]);

  function hexToRgba(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // Toast helper
  const toast = useCallback((msg, kind) => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 2800);
  }, []);

  // Action handler — updates local state + persists to applications.md via API.
  // `reachedStage` (optional): when closing a role that advanced past Applied,
  //   pass the furthest stage reached (e.g. "2nd Interview"). We prefix the notes
  //   with `[reached: <stage>]` so analytics keep crediting this entry to that
  //   stage in the funnel. See window.appReached in data.js.
  const handleAction = useCallback((app, newStatus, silent, reachedStage) => {
    // Map UI-only labels to canonical statuses before storage
    const STATUS_ALIASES = { "Not a Fit": "Discarded" };
    const canonicalStatus = STATUS_ALIASES[newStatus] || newStatus;

    // Auto-attribute the exit stage: when a row goes Rejected / No Response from an
    // interview round (or Responded / Offer), stamp the furthest stage reached so
    // the funnel + rejections-by-stage analytics credit the right rung even though
    // the live status is now terminal. An explicit reachedStage (the drawer's
    // "Mark as Lost") still wins.
    if (!reachedStage && (canonicalStatus === "Rejected" || canonicalStatus === "No Response")) {
      const fi = window.FUNNEL_ORDER.indexOf(app.status);
      if (fi >= window.FUNNEL_ORDER.indexOf("Responded")) reachedStage = app.status;
    }

    // Build notes update (prefix-tag) only if reachedStage was set
    let nextNotes;
    if (reachedStage) {
      const tag = `[reached: ${reachedStage}]`;
      const existing = (app.notes || "").trim();
      // Strip any prior [reached: X] tag (label may contain spaces), then prepend.
      const stripped = existing.replace(/^\[reached:\s*[^\]]+\]\s*/i, "").trim();
      nextNotes = stripped ? `${tag} ${stripped}` : tag;
    }

    setApps(prev => prev.map(a => a.id === app.id ? { ...a, status: canonicalStatus, ...(nextNotes !== undefined && { notes: nextNotes }) } : a));
    setDrawerApp(d => d && d.id === app.id ? { ...d, status: canonicalStatus, ...(nextNotes !== undefined && { notes: nextNotes }) } : d);
    // Persist to applications.md
    const body = { status: canonicalStatus, company: app.company };
    if (nextNotes !== undefined) body.notes = nextNotes;
    fetch(`/api/applications/${app.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => {
      if (!r.ok) toast(`Save failed for ${app.company} (${r.status})`, 'error');
    }).catch(() => toast(`Save failed for ${app.company}`, 'error'));
    if (!silent) {
      const verb = { Applied: "Applied to", SKIP: "Skipped", Discarded: "Discarded", Closed: "Marked closed:", "Not a Fit": "Not a fit:", Rejected: "Marked rejected:", Responded: "Marked responded:", Offer: "Marked offer:" }[newStatus] || (window.isInterviewStage(newStatus) ? `Moved to ${newStatus}:` : "Updated");
      const suffix = reachedStage ? ` (reached ${reachedStage})` : "";
      toast(`${verb} ${app.company}${suffix}`, newStatus === "Applied" || newStatus === "Offer" ? "success" : newStatus === "SKIP" || newStatus === "Discarded" || newStatus === "Closed" || newStatus === "Not a Fit" || newStatus === "Rejected" ? "warn" : null);
    }
  }, [toast]);

  // Stats for sidebar
  const stats = useMemo(() => {
    const total = apps.length;
    const applied = apps.filter(a => ["Applied","Responded","Offer"].includes(a.status) || window.isInterviewStage(a.status)).length;
    const inFlight = apps.filter(a => a.status === "Responded" || window.isInterviewStage(a.status)).length;
    const offers = apps.filter(a => a.status === "Offer").length;
    const pending = apps.filter(a => a.status === "Evaluated").length;
    const active = apps.filter(a => window.FUNNEL_ORDER.includes(a.status)).length;
    return { total, applied, inFlight, offers, pending, active, followups: followupCount };
  }, [apps, followupCount]);

  // Streak — count consecutive days with at least 1 application sent (≠ Evaluated)
  const streak = useMemo(() => {
    const sent = new Set(apps.filter(a => ["Applied","Responded","Offer","Rejected"].includes(a.status) || window.isInterviewStage(a.status)).map(a => a.date));
    let s = 0;
    for (let i = 0; i < 60; i++) {
      const d = new Date(window.TODAY); d.setUTCDate(d.getUTCDate() - i);
      const k = d.toISOString().slice(0, 10);
      if (sent.has(k)) s++; else if (i > 0) break;
    }
    return s;
  }, [apps]);

  // Commands for palette
  const commands = useMemo(() => {
    const navCmds = [
      { section: "Navigate", icon: "▥", label: "Go to Pipeline",     run: () => setTab("pipeline") },
      { section: "Navigate", icon: "↻", label: "Go to Follow-Ups",   run: () => setTab("followups") },
      { section: "Navigate", icon: "≡", label: "Go to All Entries",  run: () => { setTab("pipeline"); setPipelineView("all"); } },
      { section: "Navigate", icon: "🔗", label: "Go to LinkedIn SSI", run: () => setTab("linkedin-ssi") },
      { section: "Navigate", icon: "◎", label: "Go to TA Outreach", run: () => setTab("target-talent") },
      { section: "Navigate", icon: "☎", label: "Go to Recruiters",   run: () => setTab("recruiters") },
      { section: "Navigate", icon: "▤", label: "Go to Analytics",    run: () => setTab("analytics") },
      { section: "Navigate", icon: "🚀", label: "Go to Launchpad (setup)", run: () => setTab("launchpad") },
    ];
    const viewCmds = [
      { section: "View", icon: "◐", label: `Switch to ${tweaks.theme === "dark" ? "light" : "dark"} mode`, run: () => setTweak("theme", tweaks.theme === "dark" ? "light" : "dark") },
      { section: "View", icon: "≡", label: `Density: ${tweaks.density === "compact" ? "comfortable" : "compact"}`, run: () => setTweak("density", tweaks.density === "compact" ? "comfortable" : "compact") },
      { section: "View", icon: "▦", label: "Pipeline as Table",  run: () => { setTab("pipeline"); setPipelineView("table"); } },
    ];
    const actionCmds = [
      { section: "Actions", icon: "↗", label: "Filter Pipeline: Interviews only", run: () => { setTab("pipeline"); setFilters(f => ({ ...f, statuses: [...window.INTERVIEW_STAGES] })); } },
      { section: "Actions", icon: "↗", label: "Export current view as CSV", run: () => toast("CSV exported (mock)", "success") },
    ];
    const jumpCmds = apps.slice(0, 30).map(a => ({
      section: "Jump to role",
      icon: "›",
      label: `${a.company} — ${a.role}`,
      hint: a.status,
      run: () => { setDrawerApp(a); },
    }));
    return [...navCmds, ...viewCmds, ...actionCmds, ...jumpCmds];
  }, [apps, tweaks.theme, tweaks.density, setTweak, toast]);

  // Header-search persistence model: the input lives in <Topbar> and owns the
  // single `search` state. Some tabs share a namespace (company names — pipeline
  // / follow-ups / TA outreach / overview), so the search term carries across
  // those tabs. Other tabs are different namespaces (recruiters: firm names;
  // linkedin-ssi: influencer names; dictionary: jargon) and start fresh when
  // entered. Clearing on entry OR exit of cluster A keeps the term scoped to
  // the user's intent.
  const SEARCH_CLUSTER_A = useMemo(() => new Set(["pipeline", "followups", "target-talent"]), []);
  const prevTabRef = useRef(tab);
  useEffect(() => {
    const wasInA = SEARCH_CLUSTER_A.has(prevTabRef.current);
    const nowInA = SEARCH_CLUSTER_A.has(tab);
    if (!nowInA || !wasInA) setSearch("");
    prevTabRef.current = tab;
  }, [tab, SEARCH_CLUSTER_A]);

  const searchPlaceholder = useMemo(() => {
    switch (tab) {
      case "pipeline":       return "Search company, role, source…";
      case "followups":      return "Search company, role…";
      case "target-talent":  return "Search name, company, title…";
      case "recruiters":     return "Search name, firm, title, city…";
      case "linkedin-ssi":   return "Search influencer name…";
      default:               return "Search by company, role, status…";
    }
  }, [tab]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e) => {
      const tag = (e.target.tagName || "").toLowerCase();
      const inField = tag === "input" || tag === "textarea";
      // ⌘K / Ctrl+K
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setCmdOpen(true); return;
      }
      if (inField) return;
      if (e.key === "/") { e.preventDefault(); document.querySelector(".search input")?.focus(); return; }
      // Numeric tab-switch hotkeys (1-9) removed per user request — use sidebar clicks instead.
      if (e.key === "?") setCmdOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tweaks panel content
  const tweaksUI = window.TweaksPanel && tweaksOpen ? (
    <window.TweaksPanel onClose={() => setTweaksOpen(false)} title="Tweaks">
      <window.TweakSection title="Appearance">
        <window.TweakRadio label="Theme" value={tweaks.theme} options={["dark", "light"]} onChange={v => setTweak("theme", v)} />
        <window.TweakRadio label="Density" value={tweaks.density} options={["comfortable", "compact"]} onChange={v => setTweak("density", v)} />
        <window.TweakColor
          label="Accent color"
          value={tweaks.accent}
          options={["#a78bfa", "#5b8def", "#22c55e", "#f97316", "#e5e5e5"]}
          onChange={v => setTweak("accent", v)}
        />
      </window.TweakSection>
      <window.TweakSection title="Defaults">
        <window.TweakRadio
          label="Default Pipeline view"
          value={tweaks.defaultPipelineView}
          options={["overview", "table"]}
          onChange={v => { setTweak("defaultPipelineView", v); setPipelineView(v); }}
        />
      </window.TweakSection>
    </window.TweaksPanel>
  ) : null;

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', color:'var(--text-muted)', fontFamily:'var(--font-mono)', fontSize:13 }}>
      Loading trajecktory data…
    </div>
  );

  return (
    <div className="app" data-density={tweaks.density}>
      <window.Sidebar tab={tab} setTab={setTab} stats={stats} streak={streak} setupState={setupState} onDataChanged={refreshApps} version={version} />

      <div className="main">
        <window.Topbar
          search={search} setSearch={setSearch}
          searchPlaceholder={searchPlaceholder}
          lastSync={lastSync}
          density={tweaks.density} setDensity={(d) => setTweak("density", d)}
          theme={tweaks.theme} setTheme={(t) => setTweak("theme", t)}
          openCmd={() => setCmdOpen(true)}
          openTweaks={() => setTweaksOpen(o => !o)}
        />

        <div className="content" data-screen-label={`trajecktory · ${tab}`} data-tab={tab}>
          {!updateHidden && window.UpdateBanner ? <window.UpdateBanner info={updateInfo} toast={toast} onDismiss={() => setUpdateHidden(true)} /> : null}
          {tab === "pipeline"  && <window.PipelineTab  apps={apps} view={pipelineView} setView={setPipelineView} filters={filters} setFilters={setFilters} onOpen={setDrawerApp} onQuickAction={handleAction} onDataChanged={refreshApps} search={search} compTweaks={{ walkAway: tweaks.walkAway, targetLow: tweaks.targetLow, targetHigh: tweaks.targetHigh }} />}
          {tab === "analytics" && <window.AnalyticsTab apps={apps} onOpen={setDrawerApp} setTab={setTab} />}
          {tab === "followups" && <window.FollowupsTab apps={apps} onAction={handleAction} openTaContact={openTaContact} search={search} />}
          {tab === "recruiters"&& <window.RecruitersTab search={search} />}
          {tab === "target-talent" && <window.TargetTalentTab initialOpenId={pendingTaOpen} onInitialOpenConsumed={() => setPendingTaOpen(null)} search={search} />}
          {tab === "linkedin-ssi" && <window.LinkedInSSITab />}
          {tab === "launchpad" && <window.LaunchpadTab toast={toast} setTab={setTab} />}
        </div>
      </div>

      <window.Drawer app={drawerApp} onClose={() => setDrawerApp(null)} onAction={handleAction} />
      <window.CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} commands={commands} />
      <window.ToastStack toasts={toasts} />
      {tweaksUI}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
