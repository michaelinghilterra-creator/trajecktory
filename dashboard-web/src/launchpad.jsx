// Launchpad — guided onboarding / setup module.
//
// A re-enterable wizard (and, once complete, an editable hub) that walks a new
// user from empty to ready-to-search. The dashboard NEVER calls an LLM: every
// generative step composes a prompt the user pastes into their OWN Claude Code
// (the same copy-and-poll pattern as WorkflowPanel). Deterministic scalar
// fields are saved via /api/setup/save; everything else is a handoff.
const { useState, useEffect, useCallback, useRef } = React;

// ---- section catalog -------------------------------------------------------
// kind: 'action' (run something), 'form' (scalar fields saved direct),
//       'gen' (hand off to Claude Code). req drives the readiness meter.
const LP_SECTIONS = [
  { id: 'preflight',  kind: 'action', req: 'gate',        icon: 'preflight', label: 'Preflight check',
    title: 'Make sure the engine runs',
    why: 'Confirms Node, dependencies, Playwright, and the data folders are in place before you invest time in setup.' },
  { id: 'cv',         kind: 'gen', req: 'Required',        icon: 'cv', label: 'Your CV',
    title: 'Bring in your CV',
    why: 'The source of truth for scoring, tailored resumes, and interview prep. Paste it, share a LinkedIn URL, or upload a .docx/.pdf into the project — a .docx also seeds your resume master.',
    handoff: 'cv' },
  { id: 'identity',   kind: 'form', req: 'Required',       icon: 'identity', label: 'Identity & links',
    title: 'Who you are',
    why: 'Stamped onto every report and resume. Links and certifications are optional but raise match quality.' },
  { id: 'roles',      kind: 'gen', req: 'Required',        icon: 'roles', label: 'Roles & seniority',
    title: 'What you are targeting',
    why: 'Your titles plus a level. This is what the scanner hunts for. Claude Code also suggests adjacent roles to widen your funnel.',
    handoff: 'roles' },
  { id: 'edge',       kind: 'gen', req: 'Required',        icon: 'edge', label: 'Your edge',
    title: 'What makes you the obvious hire',
    why: 'Superpowers and proof points drafted from your CV. The single biggest lever on evaluation quality.',
    handoff: 'edge' },
  { id: 'comp',       kind: 'form', req: 'Required',       icon: 'comp', label: 'Compensation',
    title: 'Your numbers',
    why: 'Target and walk-away. Used to score offers and flag low-comp roles.' },
  { id: 'location',   kind: 'form', req: 'Required',       icon: 'location', label: 'Location & policy',
    title: 'Where you will and will not work',
    why: 'Drives the scanner geo filter so dead-on-arrival roles never reach you.',
    handoff: 'location', handoffLabel: 'Geocode + build scanner geo filter' },
  { id: 'evaluation', kind: 'gen', req: 'Required',        icon: 'evaluation', label: 'Evaluation tuning',
    title: 'Priorities & deal-breakers',
    why: 'What you optimize for, and your hard nos. Tunes the score and the scanner exclusions.',
    handoff: 'evaluation' },
  { id: 'companies',  kind: 'gen', req: 'Required',        icon: 'companies', label: 'Companies to track',
    title: 'Where to look',
    why: 'A neutral starter set ships by default. Claude Code suggests local-by-radius and by-industry companies, resolves each careers page, and merges them in without disturbing learned tuning.',
    handoff: 'companies' },
  { id: 'outputs',    kind: 'form', req: 'Required',       icon: 'outputs', label: 'Output locations',
    title: 'Where files land',
    why: 'Choose folders for tailored resumes and interview prep. Company reports always stay in the project.' },
  { id: 'firstEval',  kind: 'action', req: 'payoff',       icon: 'firstEval', label: 'First evaluation',
    title: 'See it work, then automate',
    why: 'Paste one job URL for a scored fit report, then set a recurring scan so new matches find you.' },
  { id: 'health',     kind: 'action', req: 'verify',       icon: 'health', label: 'Health check',
    title: 'Confirm everything works',
    why: 'Runs the verify scripts so you start on a clean, green pipeline.' },
];

const LP_OPTIONAL = [
  { id: 'obsidian',  label: 'Obsidian vault', why: 'Push applied-role notes into your vault.' },
  { id: 'language',  label: 'Market / language modes', why: 'Target DACH, French, or Japanese postings.' },
  { id: 'intensity', label: 'Search intensity', why: 'Set a weekly goal and scan cadence.' },
  { id: 'import',    label: 'Import / demo tour', why: 'Bring in prior applications, or explore with sample data.' },
];

const LP_REQUIRED = LP_SECTIONS.filter(s => s.req === 'Required').map(s => s.id);

// ---- small presentational helpers ------------------------------------------
function LpDot({ status }) {
  const map = {
    complete: { ch: '✓', color: 'var(--green)' },
    empty:    { ch: '○', color: 'var(--text-mute)' },
    pending:  { ch: '⧖', color: 'var(--accent)' },
    error:    { ch: '✕', color: 'var(--red)' },
  };
  const g = map[status] || map.empty;
  return <span className="mono" style={{ color: g.color, width: 16, display: 'inline-flex', justifyContent: 'center' }}>{g.ch}</span>;
}

function LpField({ label, value, onChange, placeholder, optional }) {
  // Uses the app's canonical .field + .inp styling so onboarding inputs match
  // every other form in the dashboard (mono, --bg-2, accent focus ring).
  return (
    <div className="field">
      <label>{label}{optional ? ' · optional' : ''}</label>
      <input
        className="inp" type="text" value={value || ''} placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  );
}

const LP_SUB = { fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-mute)', fontFamily: 'var(--mono)', marginBottom: 7 };
function lpPillStyle(on) {
  return { background: on ? 'var(--accent-bg)' : 'var(--panel-2)', color: on ? 'var(--accent)' : 'var(--text-dim)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 999, padding: '5px 13px', fontSize: 12, cursor: 'pointer' };
}
function lpChipStyle() {
  return { display: 'inline-flex', alignItems: 'center', background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 999, padding: '4px 10px', fontSize: 12 };
}
// "you pick" (accent) vs "Claude Code generates" (green) legend for split sections.
function LpLegend() {
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-mute)' }}>
      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginRight: 5 }} />you pick</span>
      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', marginRight: 5 }} />Claude Code generates</span>
    </div>
  );
}

// Inline SVG icon set — the dashboard's window.ICON has no brand/section icons,
// and we don't load an icon font, so the Launchpad ships its own small set.
function LpIcon({ name, size = 16, color = 'currentColor', style }) {
  const s = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style };
  switch (name) {
    case 'globe':    return <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18" /></svg>;
    case 'linkedin': return <svg {...s}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" rx="1" /><circle cx="4" cy="4" r="2" /></svg>;
    case 'github':   return <svg {...s}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>;
    case 'x':        return <svg {...s}><path d="M4 4l16 16M20 4L4 20" /></svg>;
    case 'preflight':return <svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>;
    case 'cv':       return <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></svg>;
    case 'identity': return <svg {...s}><path d="M19 21v-1a7 7 0 0 0-14 0v1" /><circle cx="12" cy="7" r="4" /></svg>;
    case 'roles':    return <svg {...s}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill={color} stroke="none" /></svg>;
    case 'edge':     return <svg {...s}><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4z" /></svg>;
    case 'comp':     return <svg {...s}><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
    case 'location': return <svg {...s}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
    case 'evaluation': return <svg {...s}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>;
    case 'companies':return <svg {...s}><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21V11a1 1 0 0 0-1-1h-3" /><path d="M9 7h2M9 11h2M9 15h2" /></svg>;
    case 'outputs':  return <svg {...s}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    case 'firstEval':return <svg {...s}><path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4z" /></svg>;
    case 'health':   return <svg {...s}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>;
    case 'bolt':     return <svg {...s}><path d="M13 2L3 14h9l-1 8 10-12h-9z" /></svg>;
    case 'plus':     return <svg {...s}><path d="M12 5v14M5 12h14" /></svg>;
    default:         return null;
  }
}
// Styled square checkbox to replace the mono ☑/☐ glyph in suggestion rows.
function LpCheck({ on }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${on ? 'var(--green)' : 'var(--border-2)'}`, background: on ? 'var(--green)' : 'transparent' }}>
      {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#07140c" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
    </span>
  );
}

window.LaunchpadTab = function LaunchpadTab({ toast, setTab }) {
  const [state, setState] = useState(null);
  const [active, setActive] = useState('preflight');
  const [preflight, setPreflight] = useState(null);     // {ok, checks}
  const [pendingGen, setPendingGen] = useState({});     // sectionId -> prompt (copied, awaiting ack)
  const [health, setHealth] = useState(null);           // {ok, output}
  const [evalUrl, setEvalUrl] = useState('');
  const [evalPrompt, setEvalPrompt] = useState('');
  const [forms, setForms] = useState({});               // local form drafts

  const refresh = useCallback(() => {
    fetch('/api/setup/state').then(r => r.json()).then(s => {
      setState(s);
      setForms(f => ({ ...s.values, ...f }));            // seed once, keep edits
    }).catch(() => {});
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-run preflight on open so a healthy setup unlocks every section right
  // away. Without this, all sections sit disabled (showing a not-allowed
  // cursor) until the user manually runs preflight — confusing on a system
  // that's already fine. If preflight actually fails, the gate stays up.
  useEffect(() => {
    setPreflight({ running: true });
    fetch('/api/setup/preflight', { method: 'POST' })
      .then(r => r.json())
      .then(setPreflight)
      .catch(() => setPreflight({ ok: false, error: 'request failed' }));
  }, []);

  // Staging for "split" sections: the dashboard owns the deterministic picks
  // (seniority + titles, radius + companies, manual certs) and saves them here;
  // the agent reads the same file, generates the rest, and writes suggestion
  // lists back for the UI to render.
  const [stages, setStages] = useState({ roles: {}, companies: {}, certs: {} });
  const loadStages = useCallback(() => {
    ['roles', 'companies', 'certs'].forEach(k =>
      fetch(`/api/setup/stage/${k}`).then(r => r.json())
        .then(d => setStages(s => ({ ...s, [k]: d || {} }))).catch(() => {}));
  }, []);
  useEffect(() => { loadStages(); }, [loadStages]);
  const saveStage = (key, data) => {
    setStages(s => ({ ...s, [key]: data }));
    if (state?.demo) { toast && toast('Setup is read-only in demo mode', 'warn'); return; }
    fetch(`/api/setup/stage/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
  };

  const sectionStatus = useCallback((id) => {
    if (id === 'preflight') return preflight ? (preflight.ok ? 'complete' : 'error') : 'empty';
    if (id === 'health')    return health ? (health.ok ? 'complete' : 'error') : 'empty';
    if (pendingGen[id])     return 'pending';
    return state?.sections?.[id]?.status || 'empty';
  }, [state, preflight, health, pendingGen]);

  const preflightOk = preflight?.ok;
  const gated = (id) => id !== 'preflight' && !preflightOk;

  const readiness = (() => {
    const done = LP_REQUIRED.filter(id => sectionStatus(id) === 'complete').length;
    return { done, total: LP_REQUIRED.length, pct: Math.round(done / LP_REQUIRED.length * 100) };
  })();
  const allReady = readiness.done === readiness.total;

  // ---- actions -------------------------------------------------------------
  const runPreflight = () => {
    setPreflight({ running: true });
    fetch('/api/setup/preflight', { method: 'POST' }).then(r => r.json()).then(p => {
      setPreflight(p);
      if (p.ok) toast && toast('Preflight passed', 'success');
      else toast && toast(`Preflight: ${p.failures} issue${p.failures === 1 ? '' : 's'}`, 'warn');
    }).catch(() => { setPreflight({ ok: false, error: 'request failed' }); });
  };

  const runHealth = () => {
    setHealth({ running: true });
    fetch('/api/setup/healthcheck', { method: 'POST' }).then(r => r.json()).then(h => {
      setHealth(h);
      toast && toast(h.ok ? 'Health check passed' : 'Health check found issues', h.ok ? 'success' : 'warn');
    }).catch(() => setHealth({ ok: false, output: 'request failed' }));
  };

  const startHandoff = (sectionId, handoffKey) => {
    fetch(`/api/setup/handoff/${handoffKey || sectionId}`, { method: 'POST' })
      .then(r => r.json())
      .then(({ prompt }) => {
        navigator.clipboard?.writeText(prompt).catch(() => {});
        setPendingGen(p => ({ ...p, [sectionId]: prompt }));
        toast && toast('Prompt copied — paste into your Claude Code', 'success');
      })
      .catch(() => toast && toast('Could not load prompt', 'error'));
  };

  const ackHandoff = (sectionId) => {
    setPendingGen(p => { const n = { ...p }; delete n[sectionId]; return n; });
    refresh();
    loadStages(); // pick up suggestions / detected items the agent wrote back
  };

  const saveForm = (sectionId) => {
    if (state?.demo) { toast && toast('Setup is read-only in demo mode', 'warn'); return; }
    const payload = {};
    const groups = { identity: 'candidate', comp: 'compensation', location: 'location', outputs: 'outputs' };
    const g = groups[sectionId];
    Object.assign(payload, forms[g] || {});
    fetch(`/api/setup/save/${sectionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }).then(r => r.json()).then(res => {
      if (res.error) { toast && toast(res.error, 'error'); return; }
      if (res.state) { setState(res.state); }
      toast && toast('Saved', 'success');
    }).catch(() => toast && toast('Save failed', 'error'));
  };

  const resetForm = (sectionId) => {
    fetch(`/api/setup/reset/${sectionId}`, { method: 'POST' }).then(r => r.json()).then(res => {
      if (res.state) setState(res.state);
      const groups = { identity: 'candidate', comp: 'compensation', location: 'location', outputs: 'outputs' };
      setForms(f => ({ ...f, [groups[sectionId]]: (res.state?.values?.[groups[sectionId]]) || {} }));
      toast && toast('Section reset', 'warn');
    }).catch(() => {});
  };

  const setFormVal = (group, key, val) =>
    setForms(f => ({ ...f, [group]: { ...(f[group] || {}), [key]: val } }));

  const startFirstEval = () => {
    fetch('/api/setup/first-eval', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: evalUrl }),
    }).then(r => r.json()).then(res => {
      if (res.error) { toast && toast(res.error, 'error'); return; }
      navigator.clipboard?.writeText(res.prompt).catch(() => {});
      setEvalPrompt(res.prompt);
      toast && toast('Queued — prompt copied for your Claude Code', 'success');
    }).catch(() => toast && toast('Could not queue evaluation', 'error'));
  };

  if (!state) {
    return <div style={{ padding: 40, color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 13 }}>Loading setup…</div>;
  }

  const sec = LP_SECTIONS.find(s => s.id === active) || LP_SECTIONS[0];
  const st = sectionStatus(active);

  // ---- panel renderers -----------------------------------------------------
  function renderCv() {
    const sendFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => toast && toast('Could not read file', 'error');
      reader.onload = () => {
        fetch('/api/setup/cv-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, dataBase64: reader.result }),
        }).then(r => r.json()).then(res => {
          if (res.error) { toast && toast(res.error, 'error'); return; }
          navigator.clipboard?.writeText(res.prompt).catch(() => {});
          setPendingGen(p => ({ ...p, cv: res.prompt }));
          toast && toast(res.seededMaster ? 'Uploaded — also seeded resume master' : 'Uploaded — prompt copied', 'success');
        }).catch(() => toast && toast('Upload failed', 'error'));
      };
      reader.readAsDataURL(file);
    };
    return (
      <div>
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); sendFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: '1px dashed var(--border-2)', borderRadius: 'var(--r-card)', padding: '26px 16px', textAlign: 'center', background: 'var(--bg-2)' }}>
          <input id="lp-cv-file" type="file" accept=".docx,.pdf,.md,.txt" style={{ display: 'none' }} onChange={e => sendFile(e.target.files && e.target.files[0])} />
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ marginBottom: 8 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            Drag a file here, or <span onClick={() => document.getElementById('lp-cv-file').click()} style={{ color: 'var(--accent)', cursor: 'pointer' }}>browse your desktop</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 4 }}>.docx, .pdf, .md or .txt · a .docx also seeds your resume master</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={() => startHandoff('cv', 'cv-paste')}>Paste CV text</button>
          <button className="btn" onClick={() => startHandoff('cv', 'cv-linkedin')}>LinkedIn URL</button>
          <button className="btn" onClick={() => startHandoff('cv', 'cv-talk')}>Talk it through</button>
        </div>
        {pendingGen.cv && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Copied to your clipboard. Paste it into your Claude Code, then click done.</div>
            <textarea readOnly value={pendingGen.cv} rows={4} className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
            <div style={{ marginTop: 8 }}><button className="btn success" onClick={() => ackHandoff('cv')}>✓ I ran it — refresh status</button></div>
          </div>
        )}
      </div>
    );
  }

  function renderHandoff(section) {
    const prompt = pendingGen[section.id];
    return (
      <div>
        <button className="btn primary" disabled={gated(section.id)} onClick={() => startHandoff(section.id, section.handoff)}>
          {section.handoffLabel || 'Hand off to my Claude Code'} ⧉
        </button>
        {prompt && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Copied to your clipboard. Paste it into your Claude Code, then click done.</div>
            <textarea readOnly value={prompt} rows={4}
              className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
            <div style={{ marginTop: 8 }}>
              <button className="btn success" onClick={() => ackHandoff(section.id)}>✓ I ran it — refresh status</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function handoffBox(id) {
    if (!pendingGen[id]) return null;
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Copied to your clipboard. Paste it into your Claude Code, then click done.</div>
        <textarea readOnly value={pendingGen[id]} rows={4} className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
        <div style={{ marginTop: 8 }}><button className="btn success" onClick={() => ackHandoff(id)}>✓ I ran it — refresh status</button></div>
      </div>
    );
  }

  function renderRoles() {
    const SENIORITY = ['Manager', 'Director', 'Senior Director', 'VP', 'Head of'];
    const r = stages.roles || {};
    const seniority = r.seniority || [];
    const titles = r.titles || [];
    const suggestions = r.suggestions || [];
    const toggleSen = (s) => saveStage('roles', { ...r, seniority: seniority.includes(s) ? seniority.filter(x => x !== s) : [...seniority, s] });
    const addTitle = () => {
      const el = document.getElementById('lp-role-input'); const v = (el.value || '').trim();
      if (v && !titles.includes(v)) saveStage('roles', { ...r, titles: [...titles, v] });
      el.value = '';
    };
    const removeTitle = (t) => saveStage('roles', { ...r, titles: titles.filter(x => x !== t) });
    const toggleSug = (t) => saveStage('roles', { ...r, titles: titles.includes(t) ? titles.filter(x => x !== t) : [...titles, t] });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LpLegend />
        <div>
          <div style={LP_SUB}>Seniority</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SENIORITY.map(s => <button key={s} onClick={() => toggleSen(s)} style={lpPillStyle(seniority.includes(s))}>{s}</button>)}
          </div>
        </div>
        <div>
          <div style={LP_SUB}>Your titles</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="lp-role-input" className="inp" placeholder="e.g. Director of Revenue Operations" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') addTitle(); }} />
            <button className="btn" onClick={addTitle}>Add title</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {titles.length ? titles.map(t => (
              <span key={t} style={lpChipStyle()}>{t}<span onClick={() => removeTitle(t)} style={{ cursor: 'pointer', marginLeft: 6 }}>×</span></span>
            )) : <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>No titles yet.</span>}
          </div>
        </div>
        <div>
          <div style={{ ...LP_SUB, color: 'var(--green)' }}>Suggested from your CV — tap to include</div>
          {suggestions.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {suggestions.map((s, i) => {
                const on = titles.includes(s.title);
                return (
                  <button key={i} onClick={() => toggleSug(s.title)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`, background: on ? 'rgba(34,197,94,0.10)' : 'var(--panel)', borderRadius: 'var(--r-ctl)', padding: '8px 11px', cursor: 'pointer' }}>
                    <LpCheck on={on} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, color: on ? 'var(--green)' : 'var(--text)' }}>{s.title}</span>
                      {s.why && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>{s.why}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Run the generate step below — Claude Code will suggest adjacent roles here.</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Titles the scanner will search</span>
          <span className="mono" style={{ fontSize: 18, color: 'var(--accent)' }}>{titles.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={gated('roles')} onClick={() => startHandoff('roles', 'roles')}>Generate roles + scanner config ⧉</button>
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>Saves your picks, then Claude Code builds the title filters, queries, and suggestions.</span>
        </div>
        {handoffBox('roles')}
      </div>
    );
  }

  function renderCompanies() {
    const c = stages.companies || {};
    const radius = c.radiusMiles != null ? c.radiusMiles : 50;
    const picks = c.picks || [];
    const suggestions = c.suggestions || [];
    const addCompany = () => {
      const el = document.getElementById('lp-co-input'); const v = (el.value || '').trim();
      if (v && !picks.includes(v)) saveStage('companies', { ...c, picks: [...picks, v] });
      el.value = '';
    };
    const removePick = (n) => saveStage('companies', { ...c, picks: picks.filter(x => x !== n) });
    const toggleSug = (n) => saveStage('companies', { ...c, picks: picks.includes(n) ? picks.filter(x => x !== n) : [...picks, n] });
    const badge = (api) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: api ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.14)', color: api ? 'var(--green)' : 'var(--orange)' }}><LpIcon name={api ? 'bolt' : 'globe'} size={11} />{api ? 'free' : 'web'}</span>
    );
    const sugRow = (s, i) => {
      const on = picks.includes(s.name);
      return (
        <button key={i} onClick={() => toggleSug(s.name)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`, background: on ? 'rgba(34,197,94,0.10)' : 'var(--panel)', borderRadius: 'var(--r-ctl)', padding: '8px 11px', cursor: 'pointer' }}>
          <LpCheck on={on} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, color: on ? 'var(--green)' : 'var(--text)' }}>{s.name}</span>
            {s.meta && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>{s.meta}</span>}
          </span>
          {badge(s.api)}
        </button>
      );
    };
    const local = suggestions.filter(s => s.kind === 'local');
    const industry = suggestions.filter(s => s.kind !== 'local');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LpLegend />
        <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>A neutral starter set ships by default. Add your own below, or pick from Claude Code's suggestions.</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={LP_SUB}>Commute radius</div>
          <input type="number" min="5" max="200" step="5" className="inp" value={radius} style={{ width: 90 }} onChange={e => saveStage('companies', { ...c, radiusMiles: parseInt(e.target.value || '0', 10) })} />
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>miles from home (for local suggestions)</span>
        </div>
        <div>
          <div style={LP_SUB}>Add your own</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="lp-co-input" className="inp" placeholder="Company name" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') addCompany(); }} />
            <button className="btn" onClick={addCompany}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {picks.length ? picks.map(n => <span key={n} style={lpChipStyle()}>{n}<span onClick={() => removePick(n)} style={{ cursor: 'pointer', marginLeft: 6 }}>×</span></span>)
              : <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>None added yet.</span>}
          </div>
        </div>
        {(local.length > 0 || industry.length > 0) ? (
          <>
            {local.length > 0 && <div><div style={{ ...LP_SUB, color: 'var(--green)' }}>Near you</div><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{local.map(sugRow)}</div></div>}
            {industry.length > 0 && <div><div style={{ ...LP_SUB, color: 'var(--green)' }}>By industry</div><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{industry.map(sugRow)}</div></div>}
            <div style={{ fontSize: 11, color: 'var(--text-mute)' }}><span style={{ color: 'var(--green)' }}>free</span> = zero-token ATS API scan · <span style={{ color: 'var(--orange)' }}>web</span> = website search (costs tokens)</div>
          </>
        ) : <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Run the step below — Claude Code will suggest local-by-radius and by-industry companies here.</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Companies you've selected to add</span>
          <span className="mono" style={{ fontSize: 18, color: 'var(--accent)' }}>{picks.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={gated('companies')} onClick={() => startHandoff('companies', 'companies')}>Suggest + merge companies ⧉</button>
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>Claude Code resolves careers pages and merges picks without disturbing learned tuning.</span>
        </div>
        {handoffBox('companies')}
      </div>
    );
  }

  function renderForm(section) {
    if (section.id === 'identity') {
      const c = forms.candidate || {};
      const cert = stages.certs || {};
      const items = cert.items || [];
      const detected = cert.detected || [];
      const hasItem = (name) => items.some(it => it.name === name);
      const addCert = () => {
        const n = document.getElementById('lp-cert-name'), o = document.getElementById('lp-cert-org');
        const nm = (n.value || '').trim(); if (!nm) return;
        saveStage('certs', { ...cert, items: [...items, { name: nm, org: (o.value || '').trim() }] });
        n.value = ''; o.value = '';
      };
      const removeCert = (i) => saveStage('certs', { ...cert, items: items.filter((_, j) => j !== i) });
      const toggleDetected = (d) => hasItem(d.name)
        ? saveStage('certs', { ...cert, items: items.filter(it => it.name !== d.name) })
        : saveStage('certs', { ...cert, items: [...items, { name: d.name, org: d.issuer || '' }] });
      const linkRow = (icon, label, key, placeholder, optional) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', color: key === 'portfolio_url' ? 'var(--accent)' : 'var(--text-dim)' }}><LpIcon name={icon} size={16} /></span>
          <span style={{ width: 150, flexShrink: 0, fontSize: 12.5, color: key === 'portfolio_url' ? 'var(--accent)' : 'var(--text)' }}>{label}{optional ? <span style={{ color: 'var(--text-mute)', fontSize: 11 }}> optional</span> : null}</span>
          <input className="inp" style={{ flex: 1 }} value={c[key] || ''} placeholder={placeholder} onChange={e => setFormVal('candidate', key, e.target.value)} />
        </div>
      );
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <LpField label="Full name" value={c.full_name} onChange={v => setFormVal('candidate', 'full_name', v)} />
            <LpField label="Email" value={c.email} onChange={v => setFormVal('candidate', 'email', v)} />
            <LpField label="Phone" value={c.phone} onChange={v => setFormVal('candidate', 'phone', v)} optional />
            <LpField label="Home base" value={c.location} onChange={v => setFormVal('candidate', 'location', v)} placeholder="City, ST" />
          </div>
          <div>
            <div style={LP_SUB}>Links</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {linkRow('globe', 'Portfolio / website', 'portfolio_url', 'https://yourname.com')}
              {linkRow('linkedin', 'LinkedIn', 'linkedin', 'linkedin.com/in/…')}
              {linkRow('github', 'GitHub', 'github', 'github.com/…', true)}
              {linkRow('x', 'X / Twitter', 'twitter', 'x.com/…', true)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={gated('identity') || state.demo} onClick={() => saveForm('identity')}>Save</button>
            <button className="btn ghost sm" onClick={() => resetForm('identity')}>Reset</button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LpLegend />
            <div style={LP_SUB}>Certifications &amp; coursework</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="lp-cert-name" className="inp" placeholder="Certification or course" style={{ flex: 2 }} />
              <input id="lp-cert-org" className="inp" placeholder="Issuer" style={{ flex: 1, minWidth: 0 }} />
              <button className="btn" onClick={addCert}>Add</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {items.length ? items.map((it, i) => (
                <span key={i} style={lpChipStyle()}>{it.name}{it.org ? ` · ${it.org}` : ''}<span onClick={() => removeCert(i)} style={{ cursor: 'pointer', marginLeft: 6 }}>×</span></span>
              )) : <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>No certifications added.</span>}
            </div>
            <div style={{ ...LP_SUB, color: 'var(--green)' }}>Detected from your CV — tap to keep</div>
            {detected.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detected.map((d, i) => {
                  const on = hasItem(d.name);
                  return (
                    <button key={i} onClick={() => toggleDetected(d)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`, background: on ? 'rgba(34,197,94,0.10)' : 'var(--panel)', borderRadius: 'var(--r-ctl)', padding: '8px 11px', cursor: 'pointer' }}>
                      <LpCheck on={on} />
                      <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 13, color: on ? 'var(--green)' : 'var(--text)' }}>{d.name}</span>{d.issuer && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>{d.issuer}</span>}</span>
                    </button>
                  );
                })}
              </div>
            ) : <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Run detect — Claude Code will list certs from your CV here.</div>}
            <div><button className="btn" disabled={gated('identity')} onClick={() => startHandoff('identity', 'identity-certs')}>Detect certifications from CV ⧉</button></div>
            {handoffBox('identity')}
          </div>
        </div>
      );
    }
    if (section.id === 'comp') {
      const c = forms.compensation || {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
            <LpField label="Target range" value={c.target_range} onChange={v => setFormVal('compensation', 'target_range', v)} placeholder="$160K-210K" />
            <LpField label="Minimum (walk-away)" value={c.minimum} onChange={v => setFormVal('compensation', 'minimum', v)} placeholder="$140K" />
            <LpField label="Currency" value={c.currency} onChange={v => setFormVal('compensation', 'currency', v)} placeholder="USD" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={state.demo} onClick={() => saveForm('comp')}>Save</button>
            <button className="btn ghost sm" onClick={() => resetForm('comp')}>Reset</button>
          </div>
        </div>
      );
    }
    if (section.id === 'location') {
      const c = forms.location || {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
            <LpField label="City" value={c.city} onChange={v => setFormVal('location', 'city', v)} placeholder="City, ST" />
            <LpField label="Country" value={c.country} onChange={v => setFormVal('location', 'country', v)} />
            <LpField label="Timezone" value={c.timezone} onChange={v => setFormVal('location', 'timezone', v)} placeholder="CST" />
            <LpField label="Visa status" value={c.visa_status} onChange={v => setFormVal('location', 'visa_status', v)} optional />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={state.demo} onClick={() => saveForm('location')}>Save</button>
            <button className="btn" onClick={() => startHandoff('location', 'location')}>Build geo filter (remote/onsite rules) ⧉</button>
            <button className="btn ghost sm" onClick={() => resetForm('location')}>Reset</button>
          </div>
          {pendingGen.location && (
            <textarea readOnly value={pendingGen.location} rows={3}
              className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
          )}
        </div>
      );
    }
    if (section.id === 'outputs') {
      const c = forms.outputs || {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <LpField label="Resume output folder" value={c.resume_dir} onChange={v => setFormVal('outputs', 'resume_dir', v)} placeholder="output" />
            <LpField label="Interview-prep folder" value={c.interview_prep_dir} onChange={v => setFormVal('outputs', 'interview_prep_dir', v)} placeholder="interview-prep" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Company reports always stay in <span className="mono">reports/</span> so the dashboard can read them.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={state.demo} onClick={() => saveForm('outputs')}>Save</button>
            <button className="btn ghost sm" onClick={() => resetForm('outputs')}>Reset</button>
          </div>
        </div>
      );
    }
    return null;
  }

  function renderAction(section) {
    if (section.id === 'preflight') {
      return (
        <div>
          <button className="btn primary" onClick={runPreflight}>{preflight?.running ? 'Checking…' : 'Run preflight check'}</button>
          {preflight && !preflight.running && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(preflight.checks || []).map((c, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                  <span className="mono" style={{ color: c.pass ? 'var(--green)' : 'var(--red)' }}>{c.pass ? '✓' : '✕'}</span>
                  <span style={{ flex: 1 }}>
                    <span style={{ color: 'var(--text)' }}>{c.label}</span>
                    {!c.pass && (c.fix || []).map((f, j) => (
                      <span key={j} style={{ display: 'block', color: 'var(--text-mute)', fontSize: 12, fontFamily: 'var(--mono)' }}>→ {f}</span>
                    ))}
                  </span>
                </div>
              ))}
              {preflight.error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{preflight.error}</div>}
            </div>
          )}
          {!preflightOk && <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mute)' }}>The remaining steps unlock once preflight is green.</div>}
        </div>
      );
    }
    if (section.id === 'firstEval') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="text" value={evalUrl} onChange={e => setEvalUrl(e.target.value)} placeholder="Paste a job posting URL…"
              className="inp" style={{ flex: 1 }} />
            <button className="btn primary" disabled={gated('firstEval')} onClick={startFirstEval}>Evaluate ⧉</button>
          </div>
          {evalPrompt && (
            <>
              <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Copied. Paste into your Claude Code to run the evaluation; the scored report appears in your pipeline.</div>
              <textarea readOnly value={evalPrompt} rows={3}
                className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
              <div><button className="btn" onClick={() => setTab && setTab('overview')}>Go to Overview ↗</button></div>
            </>
          )}
        </div>
      );
    }
    if (section.id === 'health') {
      return (
        <div>
          <button className="btn primary" disabled={gated('health')} onClick={runHealth}>{health?.running ? 'Running…' : 'Run health check'}</button>
          {health && !health.running && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: health.ok ? 'var(--green)' : 'var(--red)', marginBottom: 6 }}>{health.ok ? '✓ All verify scripts passed' : '✕ Issues found — see output'}</div>
              {health.output && <pre style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', padding: 10, fontSize: 11, fontFamily: 'var(--mono)', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{health.output}</pre>}
            </div>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* header + readiness */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle cx="14" cy="50" r="3.2" fill="var(--text-mute)" />
          <path d="M14 50 C 27 46 41 35 50 14" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
          <circle cx="50" cy="14" r="7" fill="var(--accent)" />
        </svg>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Launchpad</h2>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{allReady ? 'Setup complete — edit any section below.' : 'Get set up to search and apply. No YAML editing required.'}</div>
        </div>
        {allReady
          ? <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--green)' }}>✓ ready</span>
          : <span className="pill mono" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{readiness.done}/{readiness.total} required</span>}
      </div>

      <div style={{ height: 8, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${readiness.pct}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .25s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-mute)', marginBottom: 12 }}>
        <span>Setup readiness</span>
        {state.demo ? <span style={{ color: 'var(--yellow)' }}>demo mode — read only</span> : <span>{readiness.pct}%</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, padding: '8px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <span style={{ color: 'var(--green)' }}>🛡</span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Editing only updates your config. Your applications, reports, and scan history are never touched, and you can re-edit any section later.</span>
      </div>

      {/* rail + panel — flex-wrap so the panel drops below the rail on narrow
          widths instead of being crushed by a fixed grid column. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 234px', minWidth: 200, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {LP_SECTIONS.map(s => {
            const isActive = s.id === active;
            const isGated = gated(s.id);
            return (
              <button key={s.id} onClick={() => setActive(s.id)} disabled={isGated}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
                  borderRadius: 'var(--r-ctl)', cursor: isGated ? 'not-allowed' : 'pointer', opacity: isGated ? 0.5 : 1,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--accent-bg)' : 'var(--panel)' }}>
                <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 'var(--r-ctl)', background: isActive ? 'rgba(var(--accent-rgb),0.18)' : 'var(--panel-2)', color: isActive ? 'var(--accent)' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><LpIcon name={s.icon} size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: isActive ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-mute)' }}>{s.req === 'gate' ? 'Required first' : s.req === 'payoff' ? 'The payoff' : s.req === 'verify' ? 'Verify' : s.req}</span>
                </span>
                <LpDot status={sectionStatus(s.id)} />
              </button>
            );
          })}
          <div style={{ fontSize: 10.5, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '10px 0 2px 4px' }}>Optional boosters</div>
          {LP_OPTIONAL.map(o => (
            <button key={o.id} onClick={() => setActive('opt:' + o.id)} disabled={!preflightOk}
              style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
                borderRadius: 'var(--r-ctl)', cursor: 'pointer', opacity: preflightOk ? 1 : 0.5,
                border: `1px solid ${active === 'opt:' + o.id ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--panel)' }}>
              <span style={{ color: 'var(--text-mute)', width: 16, display: 'inline-flex', justifyContent: 'center' }}><LpIcon name="plus" size={13} /></span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{o.label}</span>
            </button>
          ))}
        </div>

        <div className="card padded-lg" style={{ flex: '1 1 560px', minWidth: 0, minHeight: 280, padding: '22px 26px' }}>
          {active.startsWith('opt:') ? (() => {
            const o = LP_OPTIONAL.find(x => 'opt:' + x.id === active);
            return (
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text)' }}>{o.label}</h3>
                <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{o.why} This one is optional and runs through your Claude Code.</p>
                <button className="btn primary" onClick={() => startHandoff('opt:' + o.id, o.id)}>Set up with my Claude Code ⧉</button>
                {pendingGen['opt:' + o.id] && (
                  <div style={{ marginTop: 12 }}>
                    <textarea readOnly value={pendingGen['opt:' + o.id]} rows={3}
                      className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
                    <div style={{ marginTop: 8 }}><button className="btn success" onClick={() => ackHandoff('opt:' + o.id)}>✓ Done — refresh</button></div>
                  </div>
                )}
              </div>
            );
          })() : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                <span style={{ width: 30, height: 30, borderRadius: 'var(--r-ctl)', background: 'var(--accent-bg)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><LpIcon name={sec.icon} size={16} /></span>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{sec.title}</h3>
                {st === 'complete' && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--green)', marginLeft: 'auto' }}>done</span>}
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{sec.why}</p>
              {sec.id === 'cv' && state.sections?.cv?.warning === 'no-master-docx' && (
                <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(234,179,8,0.12)', color: 'var(--yellow)', fontSize: 12.5, lineHeight: 1.5 }}>
                  Your <span className="mono">cv.md</span> exists, but no Word master was found. Upload a <span className="mono">.docx</span> so tailored Word resumes can be generated.
                </div>
              )}
              {sec.kind === 'action' && renderAction(sec)}
              {sec.kind === 'form' && renderForm(sec)}
              {sec.kind === 'gen' && (
                sec.id === 'cv' ? renderCv()
                  : sec.id === 'roles' ? renderRoles()
                    : sec.id === 'companies' ? renderCompanies()
                      : renderHandoff(sec)
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
