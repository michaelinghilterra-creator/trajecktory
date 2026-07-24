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
  userPlus:  'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M20 8v6M23 11h-6',
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
  scale:     'M12 3v18M8 21h8M4 7h16M4 7l-2.5 6h5zM20 7l-2.5 6h5z',
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

// ---------- Where a generated file lives ----------
// The tailored resume's path was rendered as plain text in the persistent report
// panel, so the one durable place it appeared was the one place you could not
// click it. A working link existed only in the toast shown straight after an
// apply, and dismissing that toast lost it for good — which is exactly backwards,
// since the file matters most weeks later, not in the ten seconds after it is
// written.
//
// One implementation, shared, because this is the third helper these two report
// panels both need and the previous two drifted when each grew its own copy.
window.outputHref = function outputHref(p) {
  if (!p) return null;
  const f = String(p).split(/[\\/]/).pop();
  // .md is rendered rather than downloaded; everything else is served as-is.
  return f.endsWith('.md') ? `/output-preview/${f}` : `/output/${f}`;
};

// ---------- Files this application produced ----------
// Reads /api/artifacts/:id, which FINDS the generated files rather than trusting
// a recorded path. The report's `docx` field is never written by the apply flow —
// zero of 439 real reports carry it — so anything keyed on it renders for nobody.
// Renders nothing at all when there is nothing to show, since an empty "Files"
// block on a role you have not applied to is just noise.
window.ApplyArtifacts = function ApplyArtifacts({ app }) {
  const [a, setA] = React.useState(null);
  React.useEffect(() => {
    if (!app) return;
    const ctrl = new AbortController();
    fetch(`/api/artifacts/${app.id}`, { signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(d => setA(d))
      .catch(err => { if (err.name !== 'AbortError') setA(null); });
    return () => ctrl.abort();
  }, [app?.id]);

  if (!a || (!a.resume && !a.cover)) return null;
  const link = (file, label) => file ? (
    <a className="btn sm" href={window.outputHref(file)} target="_blank" rel="noreferrer" title={file}>{label} ↗</a>
  ) : null;
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>Files for this application:</span>
      {link(a.resume, 'Tailored resume')}
      {link(a.cover, 'Cover letter')}
    </div>
  );
};

// ---------- How the score works ----------
// "If I don't understand how we arrived at a score, how can I trust the score?"
// was the sharpest question in a first-install session, and nothing in the app
// answered it. The score drives every apply-or-skip decision, so a number the
// user cannot interrogate is a number they are right to distrust.
//
// The honest explanation matters more than a tidy one. This is NOT arithmetic:
// the model reads the posting against the CV and the saved priorities and forms
// a judgment, then reports the five dimensions as its reasoning. Nothing
// recomputes the headline from the bars. Both report panels used to print a
// "total" above those bars anyway, and because they summed differently one
// showed 14/20 while the other showed 14/25 for the same report whose headline
// was 3.0/5. Three numbers, no two agreeing, on the one figure the product asks
// to be trusted. Those totals are gone; this panel replaces them by saying what
// the bars actually are.
window.ScoreExplainer = function ScoreExplainer({ open, onClose, scoreSource }) {
  if (!open) return null;
  const derived = scoreSource === 'derived';
  const Dim = ({ name, children }) => (
    <div style={{ marginBottom: 7 }}>
      <b style={{ color: 'var(--text)', fontWeight: 500 }}>{name}</b>
      <span style={{ color: 'var(--text-dim)' }}> {children}</span>
    </div>
  );
  const Band = ({ range, meaning }) => (
    <div style={{ display: 'flex', gap: 10, marginBottom: 3 }}>
      <span className="mono" style={{ minWidth: 74, color: 'var(--text)' }}>{range}</span>
      <span style={{ color: 'var(--text-dim)' }}>{meaning}</span>
    </div>
  );
  return (
    <div style={{ marginTop: 10, padding: '12px 14px', borderRadius: 'var(--r-card)', background: 'var(--panel-2)', border: '1px solid var(--border)', fontSize: 12.5, lineHeight: 1.6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 9 }}>
        <b style={{ color: 'var(--text)' }}>How this score works</b>
        <button className="btn ghost sm" onClick={onClose}>Close</button>
      </div>

      {derived ? (
        <p style={{ margin: '0 0 10px', color: 'var(--text-dim)' }}>
          The number is computed, not guessed. trajecktory rates the role out of 5 on each dimension below, with the evidence for each rating, then takes the weighted average and subtracts for red flags. You own the weights in your profile, so the score reflects <i>your</i> priorities. It weighs:
        </p>
      ) : (
        <p style={{ margin: '0 0 10px', color: 'var(--text-dim)' }}>
          This is a <b style={{ color: 'var(--text)', fontWeight: 500 }}>legacy score</b>, rated by judgment under an older rubric before scores were computed. It is kept as it was, not recomputed. Newer roles are scored by the weighted method below. It weighs:
        </p>
      )}

      <Dim name="Resume match.">How closely your real experience lines up with what they are asking for.</Dim>
      <Dim name="Target fit.">Whether this is the kind of role you said you want.</Dim>
      <Dim name="Level.">Whether the seniority matches: title versus real scope.</Dim>
      <Dim name="Pay.">How the money compares to the market for this job.</Dim>
      <Dim name="Location.">Whether the location, remote policy, and logistics work for you.</Dim>
      <Dim name="Red flags.">Anything that counts against the role. This is the only one that subtracts.</Dim>

      <p style={{ margin: '10px 0 6px', color: 'var(--text)' }}>What the number means</p>
      <Band range="4.5 and up" meaning="Strong match. Apply now." />
      <Band range="4.0 to 4.4" meaning="Good match. Worth applying." />
      <Band range="3.5 to 3.9" meaning="Decent but not ideal. Apply if you have a specific reason." />
      <Band range="Below 3.5" meaning="Recommend against applying." />

      <p style={{ margin: '10px 0 0', color: 'var(--text-dim)' }}>
        Some things cap the score no matter how good the rest looks. A role that needs you on site somewhere you said you will not work, or that needs visa sponsorship you cannot get, stays low even when everything else fits.
      </p>
      <p style={{ margin: '8px 0 0', color: 'var(--text-dim)' }}>
        Most jobs are not a 4. Roughly one in five is. If everything scored well the score would not be telling you anything.
      </p>
      <p style={{ margin: '8px 0 0', color: 'var(--text-mute)' }}>
        {derived
          ? 'The bars above are those dimensions. With your weights they add up to the number, minus the red-flag penalty.'
          : 'The bars above are the reasoning behind the number, not the maths that produced it, so they will not add up to it.'}
      </p>
    </div>
  );
};

// ---------- POSTING ----------
// The job posting text, kept after the posting itself is gone. A posting comes
// down the day it is filled, and the report only ever stored the URL, so by the
// time a later interview round arrives the link is usually dead. A tester
// reached a fifth round 45 days after the posting had vanished and only had
// something to prepare from because they had personally copied it elsewhere.
//
// When there is no snapshot the tab says so plainly rather than showing an empty
// panel: older evaluations predate this, and a blank tab reads like a bug.
window.PostingPanel = function PostingPanel({ app }) {
  const [state, setState] = React.useState({ loading: true });

  React.useEffect(() => {
    if (!app) return;
    setState({ loading: true });
    const ctrl = new AbortController();
    fetch(`/api/jd/${app.id}`, { signal: ctrl.signal })
      .then(async r => (r.ok ? { ok: true, ...(await r.json()) } : { ok: false }))
      .then(d => setState({ loading: false, ...d }))
      .catch(err => { if (err.name !== 'AbortError') setState({ loading: false, ok: false }); });
    return () => ctrl.abort();
  }, [app?.id]);

  if (state.loading) return <div style={{ color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>Loading posting…</div>;

  if (!state.ok) {
    return (
      <div className="cs-callout">
        <div className="cs-callout-label">No saved copy of this posting</div>
        <div className="cs-callout-body" style={{ lineHeight: 1.6 }}>
          This role was evaluated before trajecktory started keeping the posting text, so only the link survives.
          {app.url ? <> The original is <a href={app.url} target="_blank" rel="noreferrer">still worth a try</a>, though postings usually come down once they are filled.</> : null}
          <div style={{ marginTop: 8, color: 'var(--text-mute)' }}>Evaluations from now on save the text automatically, so it is here when you prepare for a later round.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="col" style={{ gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
          Saved when this role was evaluated, so it survives the posting being taken down.
        </span>
        {app.url && <a className="btn sm" href={app.url} target="_blank" rel="noreferrer">Original ↗</a>}
      </div>
      <div className="mono dim" style={{ fontSize: 10.5 }}>{state.path}</div>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text)', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', padding: 13, margin: 0, maxHeight: '60vh', overflowY: 'auto' }}>{state.text}</pre>
    </div>
  );
}

// ---------- Sidebar ----------
window.Sidebar = function Sidebar({ tab, setTab, stats, setupState, onDataChanged, version }) {
  // Numeric (1-9) keyboard hotkeys for tab switching removed per user request.
  // The `hint` field is gone too. Pipeline carries the pending-decisions badge
  // now that the standalone Overview tab is folded into Pipeline → Overview.
  const items = [
    { key: "focus",         label: "Today",              icon: "◔", badge: stats.today || null },
    { key: "pipeline",      label: "Pipeline",           icon: "▥", badge: stats.pending },
    { key: "followups",     label: "Follow-Ups",         icon: "↻", badge: stats.followups || null },
    { key: "target-talent", label: "TA Outreach",        icon: "◎" },
    { key: "linkedin-ssi",  label: "LinkedIn SSI",       icon: "🔗" },
    { key: "recruiters",    label: "Recruiters",         icon: "☎" },
    { key: "interview",     label: "Interview",          icon: "◈" },
    // Review moved under Insights (first subtab); its Gmail-health nudge rides
    // the Insights item now. Connect moved under Follow-Ups.
    { key: "analytics",     label: "Insights",           icon: "✦", attention: stats.reviewAttention || null },
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
            ) : it.attention === "reconnect" ? (
              <span className="kbd" title="Gmail connection expired. Reconnect to resume catching replies and bounces"
                style={{ background: "var(--red)", color: "#fff", borderColor: "var(--red)", fontWeight: 700 }}>!</span>
            ) : it.attention === "stale" ? (
              <span title="No email check in over a week. Open Insights, then Review, to sync"
                style={{ marginLeft: "auto", width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", flexShrink: 0 }} />
            ) : null}
          </div>
        ))}
      </div>

      <window.WorkflowPanel onDataChanged={onDataChanged} />
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
  const [trust, setTrust] = useState({ ok: true, message: '', losing: [] });
  const [trustBusy, setTrustBusy] = useState(false);
  const [triageCards, setTriageCards] = useState([]);   // [{ url, company, title, score, rationale, date }]
  // Triaged postings that already have a tracker row. Shown as a collapsed count
  // rather than dropped, so a wrong suppression is visible instead of silent.
  const [triageSuppressed, setTriageSuppressed] = useState([]);
  const [deepJobs, setDeepJobs] = useState({});         // { url: { status, error } }
  // URLs the user dismissed (× control) or that auto-cleared after a completed
  // deep dive. Persisted so a reload doesn't resurrect a spent card.
  const [dismissed, setDismissed] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('trj.triageDismissed') || '[]')); }
    catch { return new Set(); }
  });
  const persistDismissed = (set) => { try { localStorage.setItem('trj.triageDismissed', JSON.stringify([...set])); } catch {} };
  // localStorage is only the optimistic hide; the server records the dismissal in
  // data/triage-dismissed.tsv so the card stays gone across restarts and browsers.
  const dismissCard = (url) => {
    setDismissed(prev => { const next = new Set(prev); next.add(url); persistDismissed(next); return next; });
    window.tjkMutate('/api/triage/dismiss', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) }).catch(() => {});
  };
  const [pasteVal, setPasteVal] = useState('');
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteMsg, setPasteMsg] = useState('');
  const [hasKey, setHasKey] = useState(false);       // API key present AND billed to it (effective)
  const pollersRef = useRef({});

  // Agent Scan and Evaluate Pipeline spawn the bundled Claude CLI, which needs a
  // one-time `claude login`. The sign-in control lives here, next to the steps
  // that use it (it used to be buried in the Setup First-Evaluation step).
  useEffect(() => {
    const check = () => fetch('/api/claude-status').then(r => r.json())
      .then(d => {
        setClaudeSignedIn(!!d.signedIn);
        // Signed in is not the same as able to work: an untrusted workspace makes
        // Claude Code drop this project's permissions.allow list, and the agent
        // loses WebFetch/WebSearch — the only way it can read a posting. Surface
        // it here so the user sees it before paying for a run that cannot score.
        setTrust({ ok: d.workspaceTrusted !== false, message: d.trustMessage || '', losing: d.trustLosing || [] });
      }).catch(() => {});
    check();
    // After the user signs in via the popped console and tabs back, re-check so
    // the button flips to "✓ Signed in to Claude" without a manual reload.
    window.addEventListener('focus', check);
    return () => window.removeEventListener('focus', check);
  }, []);

  // The EFFECTIVE key state (a key is saved AND billing is set to key) decides which
  // workflow shows: plan-mode / keyless users get the lean plan-only steps; key users
  // get the promoted "power" pipeline whose evals bill the key (off the plan quota).
  // /api/setup/models returns the effective hasKey (it accounts for the Models & Cost
  // billing toggle). Re-check on focus and on 'trj:models-changed' so saving a key or
  // flipping billing flips this without a reload.
  useEffect(() => {
    const check = () => fetch('/api/setup/models').then(r => r.json())
      .then(d => setHasKey(!!d.hasKey)).catch(() => {});
    check();
    window.addEventListener('focus', check);
    window.addEventListener('trj:models-changed', check);
    return () => { window.removeEventListener('focus', check); window.removeEventListener('trj:models-changed', check); };
  }, []);

  // One-click repair for the trust warning above. Never fires on its own.
  function fixWorkspaceTrust() {
    setTrustBusy(true);
    window.tjkMutate('/api/setup/trust-workspace', { method: 'POST' }).then(r => r.json()).then(res => {
      if (res.ok) setTrust({ ok: true, message: '', losing: [] });
      else setTrust(t => ({ ...t, fixMsg: res.error || 'Could not update the Claude Code config. Fix it by hand and reload.' }));
    }).catch(() => setTrust(t => ({ ...t, fixMsg: 'Could not reach the server.' })))
      .finally(() => setTrustBusy(false));
  }

  function signInClaude() {
    setClaudeLoginMsg('Opening a sign-in window…');
    window.tjkMutate('/api/claude-login', { method: 'POST' }).then(r => r.json()).then(res => {
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
    setTriageSuppressed(d.suppressed || []);
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
    window.tjkMutate('/api/agent/deep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: card.url, company: card.company, title: card.title, power: hasKey || undefined }) })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!ok || b.error || !b.jobId) { setDeepJobs(d => ({ ...d, [card.url]: { status: 'error', error: b.error || 'failed to start' } })); return; }
        const key = 'deep-' + card.url;
        const poll = setInterval(() => {
          fetch(`/api/agent/status/${b.jobId}`).then(r => r.status === 404 ? { status: 'interrupted' } : r.json()).then(job => {
            if (job.status === 'done' || job.status === 'error' || job.status === 'interrupted') {
              clearInterval(poll); delete pollersRef.current[key];
              setDeepJobs(d => ({ ...d, [card.url]: job.status === 'interrupted'
                ? { status: 'error', error: 'Interrupted. The dashboard restarted. Retry.' }
                : { status: job.status, error: job.error } }));
              if (job.status === 'done') {
                onDataChanged && onDataChanged();
                // The report now exists; the triage card is spent. Show
                // "✓ Report ready" briefly, then auto-remove so the user
                // doesn't try to re-trigger the same deep dive.
                setTimeout(() => dismissCard(card.url), 1500);
              }
            }
          }).catch(() => { clearInterval(poll); delete pollersRef.current[key]; setDeepJobs(d => ({ ...d, [card.url]: { status: 'error', error: 'Interrupted. The dashboard restarted. Retry.' } })); });
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
    if (hasKey) body.power = true;
    window.tjkMutate('/api/agent/deep', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!ok || b.error || !b.jobId) { setPasteBusy(false); setPasteMsg(b.error || 'Could not start the evaluation.'); return; }
        setPasteVal(''); setPasteMsg('Evaluating…');
        const poll = setInterval(() => {
          fetch(`/api/agent/status/${b.jobId}`).then(r => r.status === 404 ? { status: 'interrupted' } : r.json()).then(job => {
            if (job.status === 'done' || job.status === 'error' || job.status === 'interrupted') {
              clearInterval(poll); delete pollersRef.current['paste']; setPasteBusy(false);
              setPasteMsg(job.status === 'done' ? 'Done. See the Pipeline tab.'
                : job.status === 'interrupted' ? 'Interrupted. The dashboard restarted. Try again.'
                : (job.error || 'Evaluation failed.'));
              if (job.status === 'done') onDataChanged && onDataChanged();
            }
          }).catch(() => { clearInterval(poll); delete pollersRef.current['paste']; setPasteBusy(false); setPasteMsg('Interrupted. The dashboard restarted. Try again.'); });
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

  // Poll an agent job to completion, resilient to the server vanishing mid-run.
  // A 404 (job gone with no snapshot), a server-marked 'interrupted' status, or
  // two consecutive fetch failures all settle the job as 'interrupted' — so the
  // UI shows "run interrupted, retry" instead of spinning forever at its last
  // count. onUpdate fires each live tick; onSettled gets the terminal job.
  function pollAgentJob(jobId, key, { onUpdate, onSettled }) {
    let fails = 0;
    const stop = (job) => { clearInterval(poll); delete pollersRef.current[key]; onSettled && onSettled(job); };
    const poll = setInterval(() => {
      fetch(`/api/agent/status/${jobId}`)
        .then(r => (r.status === 404 ? { status: 'interrupted' } : r.json()))
        .then(job => {
          if (job && job.status === 'interrupted') return stop({ status: 'interrupted' });
          fails = 0;
          onUpdate && onUpdate(job);
          if (job && (job.status === 'done' || job.status === 'error')) stop(job);
        })
        .catch(() => { fails += 1; if (fails >= 2) stop({ status: 'interrupted' }); });
    }, 2000);
    pollersRef.current[key] = poll;
  }

  // Wire an Evaluate/Scan/Triage step's poller into the jobs state. Also used to
  // re-attach to a run still in flight after a page reload (see the mount effect).
  function attachAgentPoll(step, jobId) {
    pollAgentJob(jobId, step.id, {
      onUpdate: (job) => setJobs(j => ({ ...j, [step.id]: job })),
      onSettled: (job) => {
        if (job.status === 'interrupted') {
          setJobs(j => ({ ...j, [step.id]: { ...(j[step.id] || {}), status: 'interrupted' } }));
        } else {
          setJobs(j => ({ ...j, [step.id]: job }));
          if (job.status === 'done') { onDataChanged && onDataChanged(); if (step.id === 'triage') loadTriage(); }
        }
      },
    });
  }

  function runStep(step) {
    if (step.type === 'agent') {
      // Drives the user's local Claude Code in the background via /api/agent.
      setJobs(j => ({ ...j, [step.id]: { status: 'running', activity: 'Starting agent…' } }));
      // The batch Evaluate step routes through the API key (power) when one is set,
      // with the Opus deep-mode override. Other agent steps post no body.
      const agentBody = step.mode === 'pipeline' ? { power: hasKey } : null;
      window.tjkMutate(`/api/agent/${step.mode}`, agentBody
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(agentBody) }
        : { method: 'POST' })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok || body.error || !body.jobId) {
            setJobs(j => ({ ...j, [step.id]: { status: 'error', error: body.error || 'failed to start' } }));
            return;
          }
          attachAgentPoll(step, body.jobId);
        })
        .catch(err => setJobs(j => ({ ...j, [step.id]: { status: 'error', error: err.message } })));
      return;
    }
    if (step.type === 'cli') {
      // Copy command to clipboard, mark as "queued" so user knows what to do
      navigator.clipboard?.writeText(step.command).catch(() => {});
      setJobs(j => ({ ...j, [step.id]: { status: 'cli-pending', summary: `Copied "${step.command}". Paste into Claude CLI, then click ✓ when done` } }));
      return;
    }
    setJobs(j => ({ ...j, [step.id]: { status: 'running', summary: 'Starting…' } }));
    window.tjkMutate(`/api/workflow/${step.id}`, { method: 'POST' })
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
    if (s === 'interrupted') return { ch: '↻', color: 'var(--orange)' };
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

  // Re-attach on mount: after a reload (or a server restart) the sidebar starts
  // blank, so ask the server for any running/interrupted agent job and either
  // resume its poller (still live) or surface it as interrupted (needs a retry),
  // instead of silently forgetting a run that was in flight.
  useEffect(() => {
    fetch('/api/agent/active').then(r => r.json()).then(list => {
      if (!Array.isArray(list)) return;
      const MODE_STEP = { pipeline: 'cli-eval', scan: 'cli-scan', triage: 'triage' };
      const seen = new Set();
      for (const job of list) {                 // list is newest-first
        const stepId = MODE_STEP[job.mode];
        if (!stepId || seen.has(stepId)) continue;
        seen.add(stepId);
        setJobs(j => ({ ...j, [stepId]: job }));
        if (job.status === 'running' && stepById[stepId]) attachAgentPoll(stepById[stepId], job.jobId);
      }
    }).catch(() => {});
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Workspace trust — Claude Code silently ignores this project's
          permissions.allow list until the folder is trusted, which costs the
          agent WebFetch and WebSearch and makes Scan/Triage burn money reading
          nothing. Agent runs are blocked while this shows, so it is a hard stop
          rather than advice. The fix flips a security flag, so it stays behind an
          explicit click. */}
      {!trust.ok && (
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border)', fontSize: 11.5, background: 'var(--warn-bg, rgba(255,176,32,0.08))' }}>
          <div style={{ color: 'var(--warn, #ffb020)', fontWeight: 600 }}>⚠ Folder not trusted by Claude Code</div>
          <div style={{ marginTop: 4, color: 'var(--text-mute)', lineHeight: 1.45 }}>
            {trust.losing?.length
              ? `The agent cannot use ${trust.losing.join(' or ')}, so Scan and Triage cannot read job postings. Runs are blocked until this is fixed.`
              : 'This project’s permission settings are being ignored. Runs are blocked until this is fixed.'}
          </div>
          <button onClick={fixWorkspaceTrust} disabled={trustBusy}
            title="Marks this folder as trusted in your Claude Code config (a backup is saved first)"
            style={{ marginTop: 6, background: 'none', border: '1px solid var(--warn, #ffb020)', color: 'var(--warn, #ffb020)', borderRadius: 6, padding: '3px 8px', fontSize: 11.5, cursor: trustBusy ? 'default' : 'pointer', width: '100%', opacity: trustBusy ? 0.6 : 1 }}>
            {trustBusy ? 'Trusting…' : 'Trust this folder'}
          </button>
          {trust.fixMsg && <div style={{ marginTop: 6, color: 'var(--text-mute)', lineHeight: 1.4 }}>{trust.fixMsg}</div>}
        </div>
      )}

      {/* Which engine the workflow runs on. The evaluate model (incl. Opus deep
          mode) and billing are configured in Setup → Models & cost. */}
      <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.4 }}>
        {hasKey ? (
          <div style={{ color: 'var(--accent)' }}>API key active: Evaluate uses a bigger, faster batch. Runs still go to your Claude plan; your API key is only a fallback if the plan auth is unavailable.</div>
        ) : (
          <span>Runs on your Claude plan. Set models &amp; billing in Setup → Models &amp; cost.</span>
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
                const total = job.progressTotal;
                // Clamp: the batch cap is a soft prompt instruction the agent can
                // overshoot, so guard the rendered "X of N" (and bar width) from
                // showing e.g. "11 of 10".
                const rawDone = job.evaluationsDone || 0;
                const done = total > 0 ? Math.min(rawDone, total) : rawDone;
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
              {job?.status === 'interrupted' && (
                <div className="workflow-summary" style={{ color: 'var(--orange)' }}>
                  Run interrupted{typeof job.progressTotal === 'number' && job.progressTotal > 0 && (job.evaluationsDone || 0) > 0 ? ` at ${Math.min(job.evaluationsDone, job.progressTotal)} of ${job.progressTotal}` : ''}. Click Run to retry.
                </div>
              )}
              {job?.error && job.status !== 'interrupted' && (
                <div className="workflow-summary" style={{ color: 'var(--red)' }}>{job.error}</div>
              )}
            </div>
          );
          return card;
        })}
      </div>

      {!hasKey && (visibleTriage.length > 0 || triageSuppressed.length > 0) && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '8px 10px' }}>
          <div title="A coarse Haiku pre-filter that ranks the queue. These are NOT derived evaluation scores and are not comparable to one. Run a deep dive to get the real score." style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', marginBottom: 4 }}>PRE-FILTER · {visibleTriage.length} ranked</div>
          {/* Bounded, and scrolls inside itself. Fifteen ranked cards each carrying
              a rationale line ran to roughly a thousand pixels, so a good triage run
              pushed the paste box and everything under it off the bottom of the
              sidebar. The queue is a queue: it should be reachable, not resident. */}
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {visibleTriage.slice(0, 15).map(card => {
            const dj = deepJobs[card.url];
            const sc = card.score;
            const color = sc == null ? 'var(--text-mute)' : sc >= 4 ? 'var(--green)' : sc >= 3 ? 'var(--yellow)' : 'var(--red)';
            const isLocal = String(card.url || '').startsWith('local:');
            return (
              <div key={card.url} style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span title="Pre-filter score (coarse Haiku pass), not comparable to a derived evaluation score" style={{ color, fontWeight: 700, fontFamily: 'var(--mono)', fontSize: 12 }}>{sc == null ? '—' : '~' + sc.toFixed(1)}</span>
                  <span style={{ fontSize: 11.5, fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${card.company}: ${card.title}`}>{card.company} · {card.title}</span>
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

          {/* A COUNT, never a list. These were scored by triage and then skipped
              because each already has a tracker row, so every one of them is
              already visible in Pipeline with its real status — the expandable
              list rendered the same rows a second time, in a worse format, and
              could fill most of the sidebar. The count still earns its line: it
              is the only signal that triage ran and deduped correctly rather
              than silently finding nothing. */}
          {triageSuppressed.length > 0 && (
            <div title="Scored by triage, then skipped: each already has a row in your tracker. Find them in Pipeline (terminal ones are under All)."
              style={{ marginTop: visibleTriage.length ? 6 : 0, fontSize: 10.5, color: 'var(--text-mute)', lineHeight: 1.4 }}>
              {triageSuppressed.length} already tracked · skipped
            </div>
          )}
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
window.Topbar = function Topbar({ search, setSearch, searchPlaceholder, theme, setTheme, themeOptions, openCmd, lastSync }) {
  const opts = themeOptions && themeOptions.length ? themeOptions : [{ value: theme, label: theme }];
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

        <select
          className="theme-select"
          value={theme}
          onChange={e => setTheme(e.target.value)}
          title="Color theme"
          aria-label="Color theme"
        >
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
    </div>
  );
};

// ---------- Quick Copy Bar (relocated from the removed dead window.Drawer) ----------
// One-tap copy strip for what an external application form asks for (email, phone,
// links, certifications), sourced from window.myIdentity() so nothing personal is
// hardcoded. Global so the Pipeline drawer (pipeline.jsx, a separate IIFE) reuses it.
function QuickCopyBar() {
  const m = (window.myIdentity && window.myIdentity()) || {};
  const [copied, setCopied] = React.useState(null);
  const trunc = (s, n = 22) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const items = [
    ['Email', m.email], ['Phone', m.phone], ['LinkedIn', m.linkedin],
    ['Portfolio', m.portfolioUrl], ['GitHub', m.github],
    // Certifications contribute the name plus whatever an application form is
    // actually going to ask for. Before this the bar knew only the name, so the
    // number and dates were looked up by hand on every form.
    ...(Array.isArray(m.certificationEntries) && m.certificationEntries.length
      ? m.certificationEntries.flatMap(c => [
          [trunc(c.name), c.name],
          c.number  ? [`${trunc(c.name, 14)} no.`, c.number]  : null,
          c.expires ? [`${trunc(c.name, 14)} exp`, c.expires] : null,
        ].filter(Boolean))
      : (Array.isArray(m.certifications) ? m.certifications.filter(Boolean).map(c => [trunc(c), c]) : [])),
  ].filter(([, v]) => v);
  if (!items.length) return null;
  const copy = (label, val) => {
    try { navigator.clipboard.writeText(val); } catch { /* clipboard blocked */ }
    setCopied(label);
    setTimeout(() => setCopied(c => (c === label ? null : c)), 1200);
  };
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--panel-2)' }}>
      <span style={{ fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--font-mono)', marginRight: 2 }}>Quick copy:</span>
      {items.map(([label, val]) => (
        <button key={label} className="btn sm" style={{ fontSize: 11.5 }} title={`Copy: ${val}`} onClick={() => copy(label, val)}>
          {copied === label ? '✓ copied' : label}
        </button>
      ))}
    </div>
  );
}
// Exposed globally so the Pipeline drawer (pipeline.jsx, separate IIFE) can reuse it.
window.QuickCopyBar = QuickCopyBar;

// Create-a-Gmail-draft button. POSTs the composed email to /api/google/draft,
// which creates a DRAFT and never sends (the server has no send path). If the
// connected token predates the compose scope the route returns needsReconnect and
// we nudge a reconnect. Shared by the TA, recruiter, and follow-up composers.
// Renders nothing without a recipient address (a draft needs a "to").
window.GmailDraftBtn = function GmailDraftBtn({ to, subject, body, size = "sm" }) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState(false);
  if (!to) return null;
  const create = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const res = await window.tjkMutate('/api/google/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, subject: subject || '', body: body || '' }),
      });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.ok) {
        setDone(true);
        window.tjkToast?.('Draft created in Gmail. Review and send it there.', 'success');
        setTimeout(() => setDone(false), 4000);
      } else if (res.status === 403 && d.needsReconnect) {
        window.tjkToast?.('Reconnect Gmail to enable drafts (Review tab, then Connect).', 'error');
      } else {
        window.tjkToast?.(d.error || 'Could not create the Gmail draft.', 'error');
      }
    } catch {
      window.tjkToast?.('Could not reach Gmail.', 'error');
    } finally { setBusy(false); }
  };
  return (
    <button className={"btn " + size} onClick={create} disabled={busy || !body}
      title="Create a draft in your Gmail Drafts folder (never sends)">
      {busy ? "Drafting…" : done ? "In Gmail Drafts ✓" : "Gmail draft"}
    </button>
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
      toast('This update needs a fresh installer. Download the latest trajecktory setup.', 'warn');
      return;
    }
    setBusy(true);
    toast(`Updating to v${info.remote}…`, null);
    window.tjkMutate('/api/system/update-apply', { method: 'POST' })
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
                  ? 'This update needs a fresh installer. Download the latest setup.'
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
        window.tjkMutate('/api/system/restart', { method: 'POST' })
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
        {(info.releaseNotes || info.changelog) ? (
          <button style={{ ...btn, border: 'none', padding: '2px 6px', color: 'var(--accent)' }} onClick={() => setShowNotes(s => !s)}>
            {showNotes ? 'Hide notes' : "What's new"}
          </button>
        ) : null}
        <span style={{ flex: 1 }} />
        <button style={primary} disabled={busy} onClick={applyUpdate}>{busy ? 'Updating…' : 'Update now'}</button>
        <button style={btn} disabled={busy} onClick={onDismiss}>Later</button>
      </div>
      {/* Written release notes when we could reach them, else the raw CHANGELOG
          text update-system.mjs already returned. The prose gets prose styling;
          the fallback keeps the mono block, since commit subjects read as code
          and dressing them up would only disguise what they are. */}
      {showNotes && info.releaseNotes ? (
        <div style={{ marginTop: 10, maxHeight: 220, overflow: 'auto', fontSize: 12.5, lineHeight: 1.55, color: 'var(--text-dim)' }}>
          {info.releaseNotes.sections.map((sec, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              {sec.heading ? (
                <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--text-mute)', marginBottom: 3 }}>
                  {sec.heading.toUpperCase()}
                </div>
              ) : null}
              {sec.items.map((it, j) => it.type === 'bullet' ? (
                <div key={j} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', marginBottom: 2 }}>
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span><span>{it.text}</span>
                </div>
              ) : (
                <div key={j} style={{ marginBottom: 5 }}>{it.text}</div>
              ))}
            </div>
          ))}
        </div>
      ) : showNotes && info.changelog ? (
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
