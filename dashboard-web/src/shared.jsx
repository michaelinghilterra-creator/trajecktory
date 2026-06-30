// Shared components: Sidebar, Topbar, pills, drawer, command palette, toasts
const { useState: useStateS, useEffect: useEffectS, useRef: useRefS, useMemo: useMemoS } = React;

// ---------- User identity (for draft signature blocks) ----------
// Populated by app.jsx from GET /api/identity so the client bundle hardcodes no
// name / email / phone. Read lazily at click time; falls back to empty strings
// before the fetch resolves (the signature just omits whatever isn't loaded).
window.myIdentity = () => (typeof window !== 'undefined' && window.__TJK_IDENTITY) || {};
window.mySignoff = () => `Best,\n${window.myIdentity().fullName || ''}`;
window.myEmailSignature = () => {
  const m = window.myIdentity();
  const lines = ['Best,', m.fullName || ''];
  const contact = [m.phoneDisplay, m.email].filter(Boolean).join(' | ');
  const links = [m.linkedinDisplay, m.portfolioHost].filter(Boolean).join(' | ');
  if (contact) lines.push(contact);
  if (links) lines.push(links);
  return lines.join('\n');
};

// ---------- Canonical icon set ----------
// One source of truth so PI / TI / REC_I and any subtab icons stay visually
// identical. Loads via shared.js which is imported before every page file.
window.ICON = {
  // navigation / structure
  pulse:     'M22 12h-4l-3 9L9 3l-3 9H2',
  grid2:     'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  list:      'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  layers:    'M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  chart:     'M3 3v18h18M7 14l4-4 3 3 5-6',
  trend:     'M22 7l-8.5 8.5-5-5L2 17',
  // people / orgs
  users:     'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  building:  'M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21V11a1 1 0 0 0-1-1h-3M9 7h2M9 11h2M9 15h2',
  briefcase: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2',
  // actions / motion
  send:      'M22 2 11 13M22 2l-7 20-4-9-9-4z',
  outbound:  'M12 19V5M5 12l7-7 7 7',
  inbound:   'M12 5v14M5 12l7 7 7-7',
  refresh:   'M21 2v6h-6M3 12a9 9 0 0 1 15-6.7L21 8M3 22v-6h6M21 12a9 9 0 0 1-15 6.7L3 16',
  undo:      'M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-1',
  arrowR:    'M5 12h14M13 6l6 6-6 6',
  chevR:     'M9 6l6 6-6 6',
  // utility
  search:    'M11 11m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M21 21l-4.3-4.3',
  x:         'M18 6 6 18M6 6l12 12',
  check:     'M20 6 9 17l-5-5',
  flag:      'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  star:      'M12 2l3 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.9 21l1.2-6.8-5-4.9 6.9-1z',
  zap:       'M13 2 3 14h9l-1 8 10-12h-9z',
  spark:     'M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8',
  clock:     'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  msg:       'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-4.2A8.4 8.4 0 0 1 4 11.5 8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z',
  mail:      'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 7l-10 6L2 7',
  pen:       'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  copy:      'M9 9h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V11a2 2 0 0 1 2-2zM5 15H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v1',
  ext:       'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
  download:  'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  filter:    'M22 3H2l8 9.5V19l4 2v-8.5z',
  sort:      'M3 6h18M6 12h12M10 18h4',
  rocket:    'M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.1 2.1 0 0 0-2.9 0zM12 15l-3-3a22 22 0 0 1 8-10c2.6 0 4 1.4 4 4a22 22 0 0 1-10 8zM9 12H4s.5-2.8 2-4 4 0 4 0M12 15v5s2.8-.5 4-2 0-4 0-4',
};

// ---------- Status Pill ----------
window.StatusPill = function StatusPill({ status, size = "md" }) {
  const meta = window.STATUS_META[status] || window.STATUS_META.Evaluated;
  return (
    <span className="pill mono" style={{ background: meta.bg, color: meta.color, fontSize: size === "sm" ? 10 : 11 }}>
      <span className="dot" style={{ background: meta.color }}></span>
      {status.toUpperCase()}
    </span>
  );
};

// ---------- Score chip with bar ----------
window.ScoreChip = function ScoreChip({ score }) {
  if (score == null) return <span className="score-chip" style={{ color: "var(--text-mute)" }}>N/A</span>;
  const c = window.scoreColor(score);
  const pct = ((score - 1) / 4) * 100;
  return (
    <span className="score-chip" style={{ color: c }}>
      <span className="bar"><i style={{ width: `${pct}%`, background: c }} /></span>
      {score.toFixed(1)}
    </span>
  );
};

// ---------- Sidebar ----------
window.Sidebar = function Sidebar({ tab, setTab, stats, streak, setupState, onDataChanged, version }) {
  // Numeric (1-9) keyboard hotkeys for tab switching removed per user request.
  // The `hint` field is gone too. Pipeline carries the pending-decisions badge
  // now that the standalone Overview tab is folded into Pipeline → Overview.
  const items = [
    { key: "pipeline",      label: "Pipeline",           icon: "▥", badge: stats.pending },
    { key: "followups",     label: "Follow-Ups",         icon: "↻", badge: stats.followups || null },
    { key: "target-talent", label: "TA Outreach",        icon: "◎" },
    { key: "linkedin-ssi",  label: "LinkedIn SSI",       icon: "🔗" },
    { key: "recruiters",    label: "Recruiters",         icon: "☎" },
    { key: "analytics",     label: "Insights",           icon: "✦" },
  ];

  // Launchpad: front-and-centre with an incomplete-count badge while setup is
  // unfinished; demoted to a quiet "Setup" hub entry once everything is ready.
  if (setupState) {
    const REQ = ["cv","identity","roles","edge","comp","location","evaluation","companies","outputs"];
    const incomplete = REQ.filter(id => (setupState.sections?.[id]?.status || "empty") !== "complete").length;
    if (setupState.firstRun || incomplete > 0) {
      items.unshift({ key: "launchpad", label: "Launchpad", icon: "🚀", badge: incomplete || null });
    } else {
      items.push({ key: "launchpad", label: "Setup", icon: "🚀" });
    }
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark trajecktory">
          <svg width="22" height="22" viewBox="0 0 64 64" fill="none" aria-hidden="true">
            <circle cx="14" cy="50" r="3.2" fill="#5D5D66"/>
            <path d="M14 50 C 27 46 41 35 50 14" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
            <circle cx="50" cy="14" r="7" fill="#C4B5FD"/>
          </svg>
        </div>
        <div className="brand-text">
          <strong className="mono">traje<span style={{ color: "var(--accent)" }}>ck</span>tory</strong>
          <span>{version ? `v${version}` : "Career Pipeline"}</span>
        </div>
      </div>

      <div className="sidebar-scroll">
      <div className="nav-group">
        <div className="nav-label">Navigate</div>
        {items.map(it => (
          <div key={it.key} className={`nav-item ${tab === it.key ? "active" : ""}`} onClick={() => setTab(it.key)}>
            <span className="mono" style={{ width: 14, textAlign: "center", color: tab === it.key ? "var(--accent)" : "inherit" }}>{it.icon}</span>
            <span>{it.label}</span>
            {it.badge ? (
              <span className="kbd" style={{ background: "var(--accent)", color: "#0a0a0c", borderColor: "var(--accent)", fontWeight: 700 }}>{it.badge}</span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="streak">
        <div className="streak-flame">🔥</div>
        <div>
          <div className="streak-num">{streak}</div>
          <div className="streak-label">day streak</div>
        </div>
      </div>

      <window.WorkflowPanel onDataChanged={onDataChanged} />
      </div>

      <div className="sidebar-stats">
        <div className="stat">
          <span className="stat-label">Total</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Applied</span>
          <span className="stat-value">{stats.applied}</span>
        </div>
        <div className="stat">
          <span className="stat-label">In Flight</span>
          <span className="stat-value yellow">{stats.inFlight}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Offers</span>
          <span className="stat-value green">{stats.offers}</span>
        </div>
      </div>
    </aside>
  );
};

// ── WorkflowPanel ─────────────────────────────────────────────────────────────
// Click-driven morning workflow. Each button shells out to a node script
// via the /api/workflow endpoint. Two of the steps (Agent Scan, Evaluate
// Pipeline) need a Claude Code session, so they show a copy-to-clipboard
// command instead of running directly.
window.WorkflowPanel = function WorkflowPanel({ onDataChanged }) {
  const { useState, useRef, useEffect } = React;
  const [jobs, setJobs] = useState({});            // { stepId: { status, summary, error, output } }
  const [claudeSignedIn, setClaudeSignedIn] = useState(false);
  const [claudeLoginMsg, setClaudeLoginMsg] = useState('');
  const [triageCards, setTriageCards] = useState([]);   // [{ url, company, title, score, rationale, date }]
  const [deepJobs, setDeepJobs] = useState({});         // { url: { status, error } }
  // URLs the user dismissed (× control) or that auto-cleared after a completed
  // deep dive. Persisted so a reload doesn't resurrect a spent card.
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('trj.triageDismissed') || '[]')); }
    catch { return new Set(); }
  });
  const persistDismissed = (set) => { try { localStorage.setItem('trj.triageDismissed', JSON.stringify([...set])); } catch {} };
  const dismissCard = (url) => setDismissed(prev => { const next = new Set(prev); next.add(url); persistDismissed(next); return next; });
  const [pasteVal, setPasteVal] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState('');
  const [hasKey, setHasKey] = useState(false);       // Anthropic API key present?
  const [deepMode, setDeepMode] = useState(false);   // Opus on the power path
  const pollersRef = useRef({});

  // Agent Scan and Evaluate Pipeline spawn the bundled Claude CLI, which needs a
  // one-time `claude login`. The sign-in control lives here, next to the steps
  // that use it (it used to be buried in the Setup First-Evaluation step).
  useEffect(() => {
    const check = () => fetch('/api/claude-status').then(r => r.json())
      .then(d => setClaudeSignedIn(!!d.signedIn)).catch(() => {});
    check();
    // After the user signs in via the popped console and tabs back, re-check so
    // the button flips to "✓ Signed in to Claude" without a manual reload.
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // Whether an Anthropic API key is set decides which workflow shows: keyless users
  // get the lean plan-only steps; key users get the promoted "power" pipeline whose
  // evals bill the key (off the plan quota). Re-check on focus so saving a key in
  // Launchpad flips this without a reload.
  useEffect(() => {
    const check = () => fetch('/api/setup/anthropic-key').then(r => r.json())
      .then(d => setHasKey(!!d.hasKey)).catch(() => {});
    check();
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  function signInClaude() {
    setClaudeLoginMsg('Opening a sign-in window…');
    fetch('/api/claude-login', { method: 'POST' }).then(r => r.json()).then(res => {
      if (res.error) { setClaudeLoginMsg(res.error); return; }
      setClaudeLoginMsg(res.bundled
        ? 'A console window opened. Follow its prompts to sign in, then run Agent Scan or Evaluate Pipeline.'
        : 'Tried to open a sign-in console. If nothing appeared, open a terminal and run "claude login" once.');
    }).catch(() => setClaudeLoginMsg('Could not open the sign-in window.'));
  }

  // Triage cards: the Haiku triage agent writes data/triage-results.tsv. Load on
  // mount and refresh after a triage run completes.
  const loadTriage = () => fetch('/api/triage/results').then(r => r.json()).then(d => {
    const cards = d.cards || [];
    setTriageCards(cards);
    // Prune dismissed URLs no longer present in the latest results so storage
    // stays tidy and a posting that cycled out then returns can reappear.
    setDismissed(prev => {
      const urls = new Set(cards.map(c => c.url));
      const next = new Set([...prev].filter(u => urls.has(u)));
      if (next.size !== prev.size) persistDismissed(next);
      return next;
    });
  }).catch(() => {});
  useEffect(() => { loadTriage(); }, []);
  // Clear any in-flight pollers (agent steps, deep dives, paste) on unmount.
  useEffect(() => () => { Object.values(pollersRef.current).forEach(clearInterval); }, []);

  // Deep dive: full A-G Sonnet eval of one posting (a triage card or a pasted JD).
  function triggerDeep(card) {
    setDeepJobs(d => ({ ...d, [card.url]: { status: 'running' } }));
    fetch('/api/agent/deep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: card.url, company: card.company, title: card.title, power: hasKey || undefined, model: (hasKey && deepMode) ? 'opus' : undefined }) })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!ok || b.error || !b.jobId) { setDeepJobs(d => ({ ...d, [card.url]: { status: 'error', error: b.error || 'failed to start' } })); return; }
        const key = 'deep-' + card.url;
        const poll = setInterval(() => {
          fetch(`/api/agent/status/${b.jobId}`).then(r => r.json()).then(job => {
            if (job.status === 'done' || job.status === 'error') {
              clearInterval(poll); delete pollersRef.current[key];
              setDeepJobs(d => ({ ...d, [card.url]: { status: job.status, error: job.error } }));
              if (job.status === 'done') {
                onDataChanged && onDataChanged();
                // The report now exists; the triage card is spent. Show
                // "✓ Report ready" briefly, then auto-remove so the user
                // doesn't try to re-trigger the same deep dive.
                setTimeout(() => dismissCard(card.url), 1500);
              }
            }
          }).catch(() => { clearInterval(poll); delete pollersRef.current[key]; });
        }, 2000);
        pollersRef.current[key] = poll;
      })
      .catch(e => setDeepJobs(d => ({ ...d, [card.url]: { status: 'error', error: e.message } })));
  }

  // Paste a JD (URL or full text) → deep eval, skipping triage (self-sourced).
  function submitPaste() {
    const v = pasteVal.trim();
    if (!v) return;
    setPasteBusy(true); setPasteMsg('');
    const body = /^https?:\/\//i.test(v) ? { url: v } : { jd: v };
    if (hasKey) { body.power = true; if (deepMode) body.model = 'opus'; }
    fetch('/api/agent/deep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!ok || b.error || !b.jobId) { setPasteBusy(false); setPasteMsg(b.error || 'Could not start the evaluation.'); return; }
        setPasteVal(''); setPasteMsg('Evaluating…');
        const poll = setInterval(() => {
          fetch(`/api/agent/status/${b.jobId}`).then(r => r.json()).then(job => {
            if (job.status === 'done' || job.status === 'error') {
              clearInterval(poll); delete pollersRef.current['paste']; setPasteBusy(false);
              setPasteMsg(job.status === 'done' ? 'Done — see the Pipeline tab.' : (job.error || 'Evaluation failed.'));
              if (job.status === 'done') onDataChanged && onDataChanged();
            }
          }).catch(() => { clearInterval(poll); delete pollersRef.current['paste']; setPasteBusy(false); });
        }, 2000);
        pollersRef.current['paste'] = poll;
      })
      .catch(e => { setPasteBusy(false); setPasteMsg(e.message); });
  }

  // Everyday flow: API Scan (free, fast) → Triage (Haiku scores the top 15) →
  // housekeeping. The expensive/optional/redundant steps move to Advanced below.
  const STEPS = [
    { id: 'api-scan',  label: '1. API Scan',         hint: 'Greenhouse/Ashby/Lever',    type: 'auto'   },
    { id: 'triage',    label: '2. Triage',           hint: 'Haiku scores the top 15',   type: 'agent', mode: 'triage',
      command: '/trajecktory triage' },
    { id: 'merge',     label: '3. Merge Tracker',    hint: 'TSVs → applications.md',     type: 'auto'   },
    { id: 'verify',    label: '4. Verify Actionable',hint: 'Safety-net dead links',     type: 'auto'   },
    { id: 'health',    label: '5. Health Check',     hint: 'Report parser drift',       type: 'auto'   },
    // ── Advanced (collapsed by default) ─────────────────────────────────────────
    { id: 'discover',  label: 'Expand Coverage',     hint: 'Register companies (keys)',  type: 'auto',  section: 'advanced' },
    { id: 'cli-scan',  label: 'Agent Scan',          hint: 'Widen via Claude search',    type: 'agent', mode: 'scan',
      command: '/trajecktory scan', section: 'advanced' },
    { id: 'gate',      label: 'Liveness Gate',       hint: 'Drop dead URLs',             type: 'auto',  section: 'advanced' },
    { id: 'cli-eval',  label: 'Evaluate (Batch)',    hint: 'Sonnet full reports, top N', type: 'agent', mode: 'pipeline',
      command: '/trajecktory pipeline', section: 'advanced' },
  ];

  function runStep(step) {
    if (step.type === 'agent') {
      // Drives the user's local Claude Code in the background via /api/agent.
      setJobs(j => ({ ...j, [step.id]: { status: 'running', activity: 'Starting agent…' } }));
      // The batch Evaluate step routes through the API key (power) when one is set,
      // with the Opus deep-mode override. Other agent steps post no body.
      const agentBody = step.mode === 'pipeline' ? { power: hasKey, model: (hasKey && deepMode) ? 'opus' : undefined } : null;
      fetch(`/api/agent/${step.mode}`, agentBody
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(agentBody) }
        : { method: 'POST' })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok || body.error || !body.jobId) {
            setJobs(j => ({ ...j, [step.id]: { status: 'error', error: body.error || 'failed to start' } }));
            return;
          }
          const poll = setInterval(() => {
            fetch(`/api/agent/status/${body.jobId}`)
              .then(r => r.json())
              .then(job => {
                // Live update every tick (activity, toolCount, subSteps)
                setJobs(j => ({ ...j, [step.id]: job }));
                if (job.status === 'done' || job.status === 'error') {
                  clearInterval(poll);
                  delete pollersRef.current[step.id];
                  // Evaluate/Triage wrote reports/TSVs — re-sync the dashboard,
                  // and reload the triage cards after a triage run.
                  if (job.status === 'done') { onDataChanged && onDataChanged(); if (step.id === 'triage') loadTriage(); }
                }
              })
              .catch(() => { clearInterval(poll); });
          }, 2000);
          pollersRef.current[step.id] = poll;
        })
        .catch(err => setJobs(j => ({ ...j, [step.id]: { status: 'error', error: err.message } })));
      return;
    }
    if (step.type === 'cli') {
      // Copy command to clipboard, mark as "queued" so user knows what to do
      navigator.clipboard?.writeText(step.command).catch(() => {});
      setJobs(j => ({ ...j, [step.id]: { status: 'cli-pending', summary: `Copied "${step.command}" — paste into Claude CLI, then click ✓ when done` } }));
      return;
    }
    setJobs(j => ({ ...j, [step.id]: { status: 'running', summary: 'Starting…' } }));
    fetch(`/api/workflow/${step.id}`, { method: 'POST' })
      .then(r => r.json())
      .then(({ jobId, error }) => {
        if (error || !jobId) {
          setJobs(j => ({ ...j, [step.id]: { status: 'error', error: error || 'failed to start' } }));
          return;
        }
        const poll = setInterval(() => {
          fetch(`/api/workflow/status/${jobId}`)
            .then(r => r.json())
            .then(job => {
              if (job.status === 'done' || job.status === 'error') {
                clearInterval(poll);
                delete pollersRef.current[step.id];
                setJobs(j => ({ ...j, [step.id]: job }));
                // Merge Tracker / Verify wrote to applications.md — re-sync.
                if (job.status === 'done') onDataChanged && onDataChanged();
              }
            })
            .catch(() => { clearInterval(poll); });
        }, 2000);
        pollersRef.current[step.id] = poll;
      })
      .catch(err => setJobs(j => ({ ...j, [step.id]: { status: 'error', error: err.message } })));
  }

  function markCliDone(stepId) {
    setJobs(j => ({ ...j, [stepId]: { status: 'done', summary: 'Marked complete' } }));
  }

  function statusGlyph(s) {
    if (!s)                  return { ch: '○', color: 'var(--text-mute)' };
    if (s === 'running')     return { ch: '◐', color: 'var(--yellow)' };
    if (s === 'cli-pending') return { ch: '⧖', color: 'var(--accent)' };
    if (s === 'done')        return { ch: '✓', color: 'var(--green)' };
    if (s === 'warn')        return { ch: '⚠', color: 'var(--yellow)' };
    if (s === 'error')       return { ch: '✕', color: 'var(--red)' };
    return { ch: '○', color: 'var(--text-mute)' };
  }

  // Agent steps share data/pipeline.md + the Claude quota — only one at a time.
  const anyAgentRunning = STEPS.some(s => s.type === 'agent' && jobs[s.id]?.status === 'running');
  // Deep-dive + paste share the single-flight Claude agent, so disable them while
  // any agent step or another deep eval is running.
  const agentBusy2 = anyAgentRunning || pasteBusy || Object.values(deepJobs).some(d => d?.status === 'running');
  // Merge/Verify/Health consume Evaluate Pipeline's output. Keep them disabled
  // while Evaluate is still running so clicking ahead doesn't show "0 to review".
  const evalRunning = jobs['cli-eval']?.status === 'running';
  const POST_EVAL = ['merge', 'verify', 'health'];
  // Cards the user hasn't dismissed (and that haven't auto-cleared post-deep-dive).
  const visibleTriage = triageCards.filter(c => !dismissed.has(c.url));

  // Two layouts: keyless users get the lean plan steps; key users get the full
  // pipeline with the formerly-Advanced steps promoted inline (scan → evaluate →
  // merge order). No collapsible Advanced section in either case.
  const BASE_ORDER  = ['api-scan', 'triage', 'merge', 'verify', 'health'];
  // API-key users skip Triage (a cheap Haiku pre-filter): their evals are cheap and
  // the batch already takes best-fit-first, so they go straight scan -> evaluate.
  const POWER_ORDER = ['api-scan', 'cli-scan', 'gate', 'cli-eval', 'merge', 'verify', 'health', 'discover'];
  const stepById = Object.fromEntries(STEPS.map(s => [s.id, s]));
  const visibleSteps = (hasKey ? POWER_ORDER : BASE_ORDER).map(id => stepById[id]).filter(Boolean);

  return (
    <div className="workflow-panel">
      <div className="workflow-head">
        <span>Workflow</span>
        <button
          className="workflow-reset"
          title="Reset all steps"
          onClick={() => { setJobs({}); Object.values(pollersRef.current).forEach(clearInterval); pollersRef.current = {}; }}
        >↺</button>
      </div>

      {/* Sign in to Claude — Agent Scan + Evaluate Pipeline run on the bundled
          CLI's login, so the control lives here next to the steps that use it. */}
      <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 11.5 }}>
        {claudeSignedIn ? (
          <span style={{ color: 'var(--green)' }}>✓ Signed in to Claude</span>
        ) : (
          <button onClick={signInClaude}
            title="One-time sign-in so Agent Scan and Evaluate Pipeline can run"
            style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 6, padding: '3px 8px', fontSize: 11.5, cursor: 'pointer', width: '100%' }}>
            Sign in to Claude ⧉
          </button>
        )}
        {claudeLoginMsg && <div style={{ marginTop: 6, color: 'var(--text-mute)', lineHeight: 1.4 }}>{claudeLoginMsg}</div>}
      </div>

      {/* Which engine the workflow runs on, plus the Opus deep-mode toggle on the key path. */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.4 }}>
        {hasKey ? (
          <>
            <div style={{ color: 'var(--accent)' }}>API key active — evaluations run on your key (bigger, faster batch; off your plan quota).</div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 5, cursor: 'pointer' }}>
              <input type="checkbox" checked={deepMode} onChange={e => setDeepMode(e.target.checked)} />
              Deep mode (Opus) — deepest reasoning, higher cost per eval
            </label>
          </>
        ) : (
          <span>Runs on your Claude plan. Add an API key in Setup → Launchpad to unlock the bigger, faster evaluation workflow.</span>
        )}
      </div>

      <div className="workflow-steps">
        {visibleSteps.map((step, idx) => {
          // Number by position so both layouts read 1..N (the labels carry a baked-in
          // number for the base flow that would otherwise skip in the promoted order).
          const stepLabel = `${idx + 1}. ${step.label.replace(/^\d+\.\s*/, '')}`;
          const job = jobs[step.id];
          const g = statusGlyph(job?.status);
          const isRunning = job?.status === 'running';
          const isDone    = job?.status === 'done';
          const isAgent   = step.type === 'agent';
          const isCli     = step.type === 'cli';
          const isCliP    = job?.status === 'cli-pending';
          const agentBusy = isAgent && anyAgentRunning;
          const blockedByEval = evalRunning && POST_EVAL.includes(step.id);
          const card = (
            <div key={step.id} className={`workflow-step ${isDone ? 'done' : ''} ${isRunning ? 'running' : ''}`}>
              <button
                className="workflow-btn"
                disabled={isRunning || agentBusy || blockedByEval}
                onClick={() => runStep(step)}
                title={blockedByEval ? 'Waiting for Evaluate Pipeline to finish' : isAgent ? `Runs "${step.command}" in Claude Code (background)` : isCli ? `Copies "${step.command}" to clipboard` : `Runs: ${step.label}`}
              >
                <span className="workflow-status-glyph" style={{ color: g.color }}>{g.ch}</span>
                <span className="workflow-label">
                  <span className="workflow-name">{stepLabel}</span>
                  <span className="workflow-hint">{step.hint}</span>
                </span>
              </button>
              {blockedByEval && (
                <div className="workflow-summary" style={{ color: 'var(--text-mute)' }}>waiting on Evaluate Pipeline…</div>
              )}
              {isCliP && (
                <button className="workflow-ack" title="Mark CLI step complete" onClick={() => markCliDone(step.id)}>✓</button>
              )}
              {isAgent && Array.isArray(job?.subSteps) && (
                <div className="workflow-substeps">
                  {job.subSteps.map(ss => {
                    const sg = statusGlyph(ss.status);
                    return (
                      <span key={ss.key} className="workflow-substep" title={ss.summary || ss.label}>
                        <span style={{ color: sg.color }}>{sg.ch}</span> {ss.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {isAgent && isRunning && (() => {
                const elapsedMs = job.startedAt ? Date.now() - job.startedAt : 0;
                const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; };
                const total = job.progressTotal, done = job.evaluationsDone || 0;
                // Evaluate has a known batch size → fraction + bar + rough ETA.
                if (total > 0) {
                  const eta = (done > 0 && done < total) ? ` · ~${fmt((elapsedMs / done) * (total - done))} left` : '';
                  return (
                    <div className="workflow-summary" title={job.output || ''}>
                      <div>Evaluated {done} of {total} · {fmt(elapsedMs)}{eta}</div>
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.round((done / total) * 100)}%`, background: 'var(--accent)', transition: 'width .3s' }} />
                      </div>
                    </div>
                  );
                }
                // Scan is open-ended discovery → elapsed + activity, no fake ETA.
                return (
                  <div className="workflow-summary" title={job.output || ''}>
                    {(job.activity || 'Working…')}{job.toolCount ? ` · ${job.toolCount} steps` : ''} · {fmt(elapsedMs)}
                  </div>
                );
              })()}
              {job?.summary && !(isAgent && isRunning) && (
                <div className="workflow-summary" title={job.output || ''}>{job.summary}</div>
              )}
              {job?.warning && (
                <div className="workflow-summary" style={{ color: 'var(--yellow)' }}>{job.warning}</div>
              )}
              {job?.error && (
                <div className="workflow-summary" style={{ color: 'var(--red)' }}>{job.error}</div>
              )}
            </div>
          );
          return card;
        })}
      </div>

      {visibleTriage.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 4 }}>TRIAGE · {visibleTriage.length} scored</div>
          {visibleTriage.slice(0, 15).map(card => {
            const dj = deepJobs[card.url];
            const sc = card.score;
            const color = sc == null ? 'var(--text-mute)' : sc >= 4 ? 'var(--green)' : sc >= 3 ? 'var(--yellow)' : 'var(--red)';
            const isLocal = String(card.url || '').startsWith('local:');
            return (
              <div key={card.url} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span style={{ color, fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12 }}>{sc == null ? '—' : sc.toFixed(1)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${card.company} — ${card.title}`}>{card.company} · {card.title}</span>
                </div>
                {card.rationale && <div style={{ fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.4, marginTop: 2 }}>{card.rationale}</div>}
                <div style={{ display: 'flex', gap: 10, marginTop: 4, alignItems: 'center' }}>
                  {dj?.status === 'running' ? <span style={{ fontSize: 10.5, color: 'var(--yellow)' }}>⧖ Evaluating…</span>
                    : dj?.status === 'done' ? <span style={{ fontSize: 10.5, color: 'var(--green)' }}>✓ Report ready</span>
                    : dj?.status === 'error' ? <span style={{ fontSize: 10.5, color: 'var(--red)' }} title={dj.error}>✕ failed</span>
                    : <button onClick={() => triggerDeep(card)} disabled={agentBusy2}
                        style={{ background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 5, padding: '2px 8px', fontSize: 10.5, cursor: agentBusy2 ? 'not-allowed' : 'pointer', opacity: agentBusy2 ? 0.5 : 1 }}>Deep dive ⧉</button>}
                  {!isLocal && card.url && <a href={card.url} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: 'var(--text-dim)' }}>open JD ↗</a>}
                  <button onClick={() => dismissCard(card.url)} title="Dismiss this card"
                    style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-mute)', cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '0 2px' }}>×</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 6 }}>PASTE A JD</div>
        <textarea value={pasteVal} onChange={e => setPasteVal(e.target.value)} placeholder="Paste a job URL or the full JD text…"
          style={{ width: '100%', height: 52, fontSize: 11, color: 'var(--text-dim)', border: '1px solid var(--border)', borderRadius: 6, padding: 6, background: 'var(--panel-2)', fontFamily: 'var(--mono)', resize: 'vertical', boxSizing: 'border-box' }} />
        <button onClick={submitPaste} disabled={pasteBusy || agentBusy2 || !pasteVal.trim()}
          style={{ width: '100%', marginTop: 6, background: 'none', border: '1px solid var(--accent)', color: 'var(--accent)', borderRadius: 6, padding: '4px 8px', fontSize: 11, cursor: (pasteBusy || agentBusy2 || !pasteVal.trim()) ? 'not-allowed' : 'pointer', opacity: (pasteBusy || agentBusy2 || !pasteVal.trim()) ? 0.5 : 1 }}>
          {pasteBusy ? 'Evaluating…' : 'Evaluate (Sonnet) ⧉'}
        </button>
        <div style={{ fontSize: 10, color: 'var(--text-mute)', marginTop: 4, lineHeight: 1.4 }}>{pasteMsg || 'Self-sourced → full deep eval, skips triage.'}</div>
      </div>
    </div>
  );
};

// Live "synced N ago" indicator. Driven by lastSync (set whenever the app
// refetches applications) plus a 1s tick, so it stays honest instead of the old
// hardcoded "synced 2s ago". Isolated in its own component so only this text
// re-renders each second, not the whole Topbar (and its search input).
window.SyncIndicator = function SyncIndicator({ lastSync }) {
  const [, setTick] = useStateS(0);
  useEffectS(() => {
    const t = setInterval(() => setTick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!lastSync) return null;
  const secs = Math.max(0, Math.round((Date.now() - lastSync) / 1000));
  const label = secs < 5 ? 'just now'
    : secs < 60 ? `${secs}s ago`
    : secs < 3600 ? `${Math.round(secs / 60)}m ago`
    : `${Math.round(secs / 3600)}h ago`;
  return <span className="muted" style={{ fontSize: 10 }}>· synced {label}</span>;
};

// ---------- Topbar ----------
window.Topbar = function Topbar({ search, setSearch, searchPlaceholder, density, setDensity, theme, setTheme, openCmd, openTweaks, lastSync }) {
  return (
    <div className="topbar">
      <div className="search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input
          type="text"
          placeholder={searchPlaceholder || "Search by company, role, status…"}
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span className="kbd-hint kbd">/</span>
      </div>

      <div className="row" style={{ marginLeft: "auto", gap: 10 }}>
        <button className="btn ghost sm" onClick={openCmd} title="Command palette (⌘K)">
          <span style={{ opacity: 0.7 }}>⌘</span>K
          <span style={{ marginLeft: 6, opacity: 0.8 }}>commands</span>
        </button>

        <div className="conn">
          <span className="conn-dot"></span>
          <span>data/applications.md</span>
          <window.SyncIndicator lastSync={lastSync} />
        </div>

        <button
          className="icon-btn"
          title={density === "compact" ? "Comfortable density" : "Compact density"}
          onClick={() => setDensity(density === "compact" ? "comfortable" : "compact")}
        >
          {density === "compact"
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h18M3 12h18M3 19h18"/></svg>
          }
        </button>

        <button
          className="icon-btn"
          title={theme === "dark" ? "Switch to light" : "Switch to dark"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark"
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          }
        </button>

        <button className="icon-btn" title="Tweaks" onClick={openTweaks}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
        </button>
      </div>
    </div>
  );
};

// ---------- Drawer (Pipeline row detail) ----------
window.Drawer = function Drawer({ app, onClose, onAction }) {
  useEffectS(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    if (app) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, onClose]);

  return (
    <>
      <div className={`drawer-backdrop ${app ? "open" : ""}`} onClick={onClose}></div>
      <div className={`drawer ${app ? "open" : ""}`}>
        {app && (
          <>
            <div className="drawer-head">
              <div>
                <div className="row" style={{ gap: 10, marginBottom: 4 }}>
                  <span className="mono dim" style={{ fontSize: 11 }}>#{String(app.id).padStart(3, "0")}</span>
                  <window.StatusPill status={app.status} />
                </div>
                <h3>{app.company}</h3>
                <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{app.role}</div>
              </div>
              <button className="icon-btn" onClick={onClose} title="Close (Esc)">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>

            <div className="drawer-body">
              <div className="kv">
                <span className="k">Score</span>
                <span className="v"><window.ScoreChip score={app.score} /> <span className="dim mono" style={{ marginLeft: 8, fontSize: 11 }}>{window.scoreBucket(app.score) === "strong" ? "strong match" : window.scoreBucket(app.score) === "borderline" ? "borderline" : "weak"}</span></span>

                <span className="k">Archetype</span>
                <span className="v mono">{app.archetype}</span>

                <span className="k">Sector</span>
                <span className="v">{app.sector} <span className="dim">· {app.size}-stage</span></span>

                <span className="k">Comp posted</span>
                <span className="v mono">${app.salary}k <span className={app.salary >= app.target ? "" : ""} style={{ color: app.salary >= app.target ? "var(--green)" : "var(--red)", marginLeft: 8 }}>{app.salary >= app.target ? `+${app.salary - app.target}k` : `−${app.target - app.salary}k`} vs target</span></span>

                <span className="k">Date logged</span>
                <span className="v mono">{app.date} <span className="dim">· {window.daysAgo(app.date)}d ago</span></span>

                <span className="k">Notes</span>
                <span className="v">{app.notes}</span>
              </div>

              <div className="report-preview">
                <h4>Evaluation Report — Auto-generated</h4>
                <p style={{ marginTop: 0 }}><strong style={{ color: "var(--text)" }}>Verdict:</strong> {app.score == null ? "Score unavailable." : app.score >= 4.0 ? "Strong fit. Apply within 48h." : app.score >= 3.0 ? "Borderline. Review JD detail before applying." : "Weak fit. Consider skipping."}</p>
                <h4 style={{ marginTop: 12 }}>Why this scored {app.score != null ? app.score.toFixed(1) : "N/A"}</h4>
                <ul>
                  <li>Role archetype <span className="mono" style={{ color: "var(--accent)" }}>{app.archetype}</span> matches your profile</li>
                  <li>Posted comp <span className="mono">${app.salary}k</span> {app.salary >= app.target ? "meets" : "is below"} your target band</li>
                  <li>Sector exposure to <span className="mono">{app.sector}</span> aligns with stated preferences</li>
                  <li>{app.size === "Late" ? "Late-stage growth — proven motion, lower equity upside" : app.size === "Mid" ? "Mid-stage — fastest learning curve" : "Early-stage — high equity, high risk"}</li>
                </ul>
                <h4>Risks</h4>
                <ul>
                  <li>{app.score >= 4.0 ? "Competitive process — recruiter may already have a shortlist" : "Comp gap may surface in screen"}</li>
                  <li>JD emphasis on tooling not yet validated against your stack</li>
                </ul>
              </div>
            </div>

            <div className="drawer-foot">
              {app.status === "Evaluated" && (
                <>
                  <button className="btn primary" onClick={() => onAction(app, "Applied")}>Mark Applied</button>
                  <button className="btn" onClick={() => onAction(app, "SKIP")}>Skip</button>
                </>
              )}
              {app.status === "Applied" && (
                <>
                  <button className="btn success" onClick={() => onAction(app, "Responded")}>Mark Responded</button>
                  <button className="btn danger" onClick={() => onAction(app, "Rejected")}>Mark Rejected</button>
                </>
              )}
              {(() => {
                const idx = window.FUNNEL_ORDER.indexOf(app.status);
                if (idx >= window.FUNNEL_ORDER.indexOf("Responded") && idx < window.FUNNEL_ORDER.length - 1) {
                  const next = window.FUNNEL_ORDER[idx + 1];
                  return <button className="btn success" onClick={() => onAction(app, next)}>{next === "Offer" ? "Mark Offer" : `Move to ${next}`}</button>;
                }
                return null;
              })()}
              <button className="btn">Open Report ↗</button>
              <button className="btn">Generate CV ⌘G</button>
            </div>
          </>
        )}
      </div>
    </>
  );
};

// ---------- Command Palette ----------
window.CommandPalette = function CommandPalette({ open, onClose, commands }) {
  const [q, setQ] = useStateS("");
  const [idx, setIdx] = useStateS(0);
  const inputRef = useRefS();

  useEffectS(() => {
    if (open) { setQ(""); setIdx(0); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [open]);

  const filtered = useMemoS(() => {
    if (!q) return commands;
    const ql = q.toLowerCase();
    return commands.filter(c => c.label.toLowerCase().includes(ql) || (c.section || "").toLowerCase().includes(ql));
  }, [q, commands]);

  useEffectS(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, filtered.length - 1)); }
      if (e.key === "ArrowUp")   { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === "Enter") {
        e.preventDefault();
        const cmd = filtered[idx];
        if (cmd) { cmd.run(); onClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, idx, filtered, onClose]);

  if (!open) return null;

  // group by section
  const bySection = {};
  filtered.forEach((c, i) => {
    const s = c.section || "Actions";
    (bySection[s] ||= []).push({ ...c, _i: i });
  });

  return (
    <div className="cmdk-back" onClick={onClose}>
      <div className="cmdk" onClick={e => e.stopPropagation()}>
        <input ref={inputRef} className="cmdk-input" placeholder="Type a command or search…" value={q} onChange={e => { setQ(e.target.value); setIdx(0); }} />
        <div className="cmdk-list">
          {filtered.length === 0 && <div className="no-data">No matches</div>}
          {Object.entries(bySection).map(([sec, items]) => (
            <div key={sec}>
              <div className="cmdk-section">{sec}</div>
              {items.map(c => (
                <div
                  key={c.label + c._i}
                  className={`cmdk-item ${c._i === idx ? "active" : ""}`}
                  onMouseEnter={() => setIdx(c._i)}
                  onClick={() => { c.run(); onClose(); }}
                >
                  <span className="mono dim" style={{ fontSize: 11, width: 16 }}>{c.icon || "›"}</span>
                  <span className="label">{c.label}</span>
                  {c.hint && <span className="hint">{c.hint}</span>}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// ---------- Toasts ----------
window.ToastStack = function ToastStack({ toasts }) {
  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div key={t.id} className={`toast ${t.kind || ""}`}>
          <span className="mono" style={{ color: t.kind === "success" ? "var(--green)" : t.kind === "warn" ? "var(--orange)" : "var(--accent)" }}>{t.kind === "success" ? "✓" : t.kind === "warn" ? "!" : "›"}</span>
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  );
};

// ---------- Update banner ----------
// Shows when the on-mount /api/system/update-check reports a newer version.
// One click applies the update (SYSTEM files only — CV/profile/tracker/reports
// are never touched) via update-system.mjs, polling the job and toasting
// progress. "Later" hides it for this session (returns on next launch).
window.UpdateBanner = function UpdateBanner({ info, toast, onDismiss }) {
  const [busy, setBusy] = useStateS(false);
  const [stage, setStage] = useStateS(''); // '' | 'restarting' | 'manual'
  const [showNotes, setShowNotes] = useStateS(false);
  if (!info || info.status !== 'update-available') return null;

  const wrap = {
    margin: '0 0 14px', padding: '10px 14px', borderRadius: 8,
    border: '1px solid var(--accent)', background: 'var(--accent-bg)',
    fontSize: 13, color: 'var(--text, inherit)',
  };
  const row = { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' };
  const btn = {
    fontFamily: 'var(--font-mono)', fontSize: 12, padding: '5px 12px',
    borderRadius: 6, border: '1px solid var(--border, rgba(127,127,127,0.3))',
    cursor: 'pointer', background: 'transparent', color: 'inherit',
  };
  const primary = { ...btn, background: 'var(--accent)', color: '#0a0a0c', borderColor: 'var(--accent)', fontWeight: 700 };

  function applyUpdate() {
    if (info.requiresReinstall) {
      toast('This update needs a fresh installer — download the latest trajecktory setup.', 'warn');
      return;
    }
    setBusy(true);
    toast(`Updating to v${info.remote}…`, null);
    fetch('/api/system/update-apply', { method: 'POST' })
      .then(r => r.json())
      .then(({ jobId, error }) => {
        if (error || !jobId) { setBusy(false); toast('Update failed to start', 'error'); return; }
        const poll = setInterval(() => {
          fetch(`/api/system/update-apply/${jobId}`)
            .then(r => r.json())
            .then(job => {
              if (!job || job.status === 'running') return;
              clearInterval(poll);
              if (job.status === 'done') { restartNow(); }       // auto-restart to finish (one click total)
              else {
                setBusy(false);
                toast(job.status === 'reinstall-required'
                  ? 'This update needs a fresh installer — download the latest setup.'
                  : 'Update failed. Your install is unchanged.', 'warn');
              }
            })
            .catch(() => { clearInterval(poll); setBusy(false); toast('Update failed', 'error'); });
        }, 1500);
      })
      .catch(() => { setBusy(false); toast('Update failed to start', 'error'); });
  }

  function restartNow() {
    setStage('restarting');
    // Capture this (old) server's bootId, fire the restart, then poll until a
    // DIFFERENT bootId answers — that's the new process on the same port, so we
    // never reload into the still-running old server. Falls back to a
    // down-then-up check if the bootId couldn't be read.
    fetch('/api/system/version', { cache: 'no-store' })
      .then(r => r.ok ? r.json() : {}).catch(() => ({}))
      .then(d => {
        const oldBoot = (d && d.bootId) || null;
        fetch('/api/system/restart', { method: 'POST' })
          .then(r => r.json().then(b => ({ ok: r.ok, b })))
          .then(({ ok }) => {
            if (!ok) { setStage('manual'); return; }   // dev / no launcher → user reloads
            let tries = 0, sawDown = false;
            const poll = setInterval(() => {
              tries++;
              fetch('/api/system/version', { cache: 'no-store' })
                .then(r => r.ok ? r.json() : null)
                .then(v => {
                  if (!v) return;
                  const isNew = oldBoot ? (v.bootId && v.bootId !== oldBoot) : sawDown;
                  if (isNew) { clearInterval(poll); window.location.reload(); }
                })
                .catch(() => { sawDown = true; });   // server down mid-restart — keep polling
              if (tries > 40) { clearInterval(poll); setStage('manual'); }   // ~60s
            }, 1500);
          })
          .catch(() => setStage('manual'));
      });
  }

  if (stage === 'restarting') {
    return (
      <div style={{ ...wrap, borderColor: 'var(--green)' }}>
        <div style={row}>
          <span className="mono" style={{ color: 'var(--green)' }}>↻</span>
          <span>Updating to <strong>v{info.remote}</strong> and restarting trajecktory…</span>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>This page reloads automatically when it is ready. If nothing happens after a minute or so, reopen trajecktory from the Start Menu.</div>
      </div>
    );
  }

  if (stage === 'manual') {
    return (
      <div style={{ ...wrap, borderColor: 'var(--green)' }}>
        <div style={row}>
          <span className="mono" style={{ color: 'var(--green)' }}>✓</span>
          <span>Update to <strong>v{info.remote}</strong> downloaded. Reopen trajecktory to finish (or reload this page).</span>
          <span style={{ flex: 1 }} />
          <button style={primary} onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={row}>
        <span className="mono" aria-hidden="true" style={{ color: 'var(--accent)' }}>⬆</span>
        <span>
          Update available: <strong>v{info.local} → v{info.remote}</strong>
          {info.requiresReinstall ? <span style={{ color: 'var(--orange)' }}> (needs a fresh installer)</span> : null}
        </span>
        {info.changelog ? (
          <button style={{ ...btn, border: 'none', padding: '2px 6px', color: 'var(--accent)' }} onClick={() => setShowNotes(s => !s)}>
            {showNotes ? 'Hide notes' : "What's new"}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <button style={primary} disabled={busy} onClick={applyUpdate}>{busy ? 'Updating…' : 'Update now'}</button>
        <button style={btn} disabled={busy} onClick={onDismiss}>Later</button>
      </div>
      {showNotes && info.changelog ? (
        <pre style={{ marginTop: 10, marginBottom: 0, maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{info.changelog}</pre>
      ) : null}
    </div>
  );
};

// ---------- Tab strip ----------
window.TabStrip = function TabStrip({ tab, setTab, counts }) {
  const tabs = [
    { key: "overview",  label: "Overview",    num: counts.pending },
    { key: "pipeline",  label: "Pipeline",    num: counts.active },
    { key: "followups", label: "Follow-Ups" },
    { key: "target-talent", label: "TA Outreach" },
    { key: "linkedin-ssi", label: "LinkedIn SSI" },
    { key: "recruiters",label: "Recruiters" },
    { key: "analytics", label: "Analytics" },
  ];
  return (
    <div className="tabs">
      {tabs.map(t => (
        <button key={t.key} className={tab === t.key ? "active" : ""} onClick={() => setTab(t.key)}>
          {t.label}
          {t.num != null && <span className="num">{t.num}</span>}
        </button>
      ))}
    </div>
  );
};
