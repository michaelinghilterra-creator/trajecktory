// ── Run Workflow — guided wizard ──────────────────────────────────────────────
// Full-page front door for the operational workflow. Walks a non-technical user
// through the whole sequence start to finish: Expand coverage → API scan →
// Agent scan → Evaluate. One "Run full workflow" button chains the included
// phases in order; each phase can also be run on its own. The deterministic
// phases hit /api/workflow/*; the Claude phases hit /api/agent/* (which the
// dashboard runs headlessly on the user's own Claude plan). Evaluate's gate /
// merge / verify / health run automatically inside that one phase.
window.RunWizardTab = function RunWizardTab({ toast }) {
  const { useState, useRef } = React;

  const PHASES = [
    { id: 'discover',  kind: 'workflow', optional: true,  usesClaude: false,
      route: '/api/workflow/discover', status: '/api/workflow/status/',
      title: 'Expand coverage', verb: 'register new companies',
      desc: 'Scans your saved searches and pulls fresh companies into your portal list. Free, no AI.' },
    { id: 'api-scan',  kind: 'workflow', optional: false, usesClaude: false,
      route: '/api/workflow/api-scan', status: '/api/workflow/status/',
      title: 'API scan', verb: 'pull new postings',
      desc: 'Hits Greenhouse, Ashby, and Lever directly for roles that match your filters. Free, no AI.' },
    { id: 'agent-scan', kind: 'agent', optional: true, usesClaude: true,
      route: '/api/agent/scan', status: '/api/agent/status/',
      title: 'Agent scan', verb: 'discover via web search',
      desc: "Claude searches the web for roles the API scan can't reach and adds them to your pipeline." },
    { id: 'evaluate',  kind: 'agent', optional: false, usesClaude: true,
      route: '/api/agent/pipeline', status: '/api/agent/status/',
      title: 'Evaluate pipeline', verb: 'score, report & track',
      desc: 'Claude reads each pending posting, scores it against your profile, writes a report, and updates your tracker. Liveness gate, merge, and verify run automatically around it.' },
  ];

  const [included, setIncluded] = useState(() => Object.fromEntries(PHASES.map(p => [p.id, true])));
  const [jobs, setJobs]         = useState({});      // { phaseId: jobObj }
  const [running, setRunning]   = useState(false);   // full-run in progress
  const pollersRef = useRef({});
  const cancelRef  = useRef(false);

  // Run one phase; resolve with the terminal job ({status:'done'|'error'}).
  function runPhase(phase) {
    return new Promise((resolve) => {
      setJobs(j => ({ ...j, [phase.id]: { status: 'running', activity: 'Starting…' } }));
      fetch(phase.route, { method: 'POST' })
        .then(r => r.json().then(body => ({ ok: r.ok, body })))
        .then(({ ok, body }) => {
          if (!ok || body.error || !body.jobId) {
            const e = { status: 'error', error: body.error || 'failed to start' };
            setJobs(j => ({ ...j, [phase.id]: e }));
            resolve(e);
            return;
          }
          const poll = setInterval(() => {
            fetch(phase.status + body.jobId)
              .then(r => r.json())
              .then(job => {
                setJobs(j => ({ ...j, [phase.id]: job }));
                if (job.status === 'done' || job.status === 'error') {
                  clearInterval(poll);
                  delete pollersRef.current[phase.id];
                  resolve(job);
                }
              })
              .catch(() => { clearInterval(poll); resolve({ status: 'error', error: 'lost connection' }); });
          }, 2000);
          pollersRef.current[phase.id] = poll;
        })
        .catch(err => { const e = { status: 'error', error: err.message }; setJobs(j => ({ ...j, [phase.id]: e })); resolve(e); });
    });
  }

  async function runAll() {
    setRunning(true);
    cancelRef.current = false;
    setJobs({});
    for (const phase of PHASES) {
      if (!included[phase.id]) continue;
      if (cancelRef.current) break;
      const job = await runPhase(phase);
      if (job.status === 'error') {           // stop the chain on a hard error
        toast && toast(`${phase.title} failed — stopped the run`, 'error');
        break;
      }
    }
    setRunning(false);
  }

  function stopAll() {
    cancelRef.current = true;
    Object.values(pollersRef.current).forEach(clearInterval);
    pollersRef.current = {};
    setRunning(false);
    toast && toast('Stopped watching — any running step finishes on its own', 'info');
  }

  function reset() {
    Object.values(pollersRef.current).forEach(clearInterval);
    pollersRef.current = {};
    cancelRef.current = true;
    setRunning(false);
    setJobs({});
  }

  const busy = running || Object.values(jobs).some(j => j?.status === 'running');
  const includedPhases = PHASES.filter(p => included[p.id]);
  const doneCount = includedPhases.filter(p => jobs[p.id]?.status === 'done').length;
  const pct = includedPhases.length ? Math.round(doneCount / includedPhases.length * 100) : 0;
  const allDone = includedPhases.length > 0 && doneCount === includedPhases.length && !busy;

  function dot(status) {
    if (status === 'running') return { ch: '◐', color: 'var(--yellow)' };
    if (status === 'done')    return { ch: '✓', color: 'var(--green)' };
    if (status === 'warn')    return { ch: '⚠', color: 'var(--yellow)' };
    if (status === 'error')   return { ch: '✕', color: 'var(--red)' };
    return { ch: '○', color: 'var(--text-mute)' };
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 32 }}>

      {/* Header + controls */}
      <div className="card padded-lg" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 19, color: 'var(--text)' }}>Run your job search</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          One run finds new roles and evaluates them end to end. Press <strong>Run full workflow</strong> and watch it go,
          or run any single step. Steps marked <span style={{ color: 'var(--accent)' }}>✦</span> use your Claude Code plan.
        </p>

        <div style={{ height: 8, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .25s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-mute)', marginBottom: 14 }}>
          <span>{doneCount}/{includedPhases.length} steps done</span>
          <span>{pct}%</span>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!running ? (
            <button className="btn primary" disabled={busy || includedPhases.length === 0} onClick={runAll}>
              Run full workflow ▸
            </button>
          ) : (
            <button className="btn" onClick={stopAll}>■ Stop watching</button>
          )}
          <button className="btn ghost" disabled={busy} onClick={reset}>↺ Reset</button>
          {allDone && (
            <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--green)', marginLeft: 'auto' }}>workflow complete</span>
          )}
        </div>
      </div>

      {/* Phase cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {PHASES.map((phase, i) => {
          const job = jobs[phase.id];
          const g = dot(job?.status);
          const isRunning = job?.status === 'running';
          const on = included[phase.id];
          return (
            <div key={phase.id} className="card" style={{ opacity: on ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="mono" style={{ color: g.color, fontSize: 15, width: 16, textAlign: 'center', flexShrink: 0 }}>{g.ch}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14, color: 'var(--text)' }}>{i + 1}. {phase.title}</strong>
                    {phase.usesClaude && <span title="Uses your Claude Code plan" style={{ color: 'var(--accent)', fontSize: 12 }}>✦</span>}
                    {phase.optional && <span className="pill" style={{ fontSize: 9.5, padding: '1px 6px', color: 'var(--text-mute)' }}>optional</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 3 }}>{phase.desc}</div>

                  {/* Controls */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9 }}>
                    <button className="btn ghost" disabled={busy || !on} title={`Run only: ${phase.title}`}
                      style={{ border: '1px solid var(--border)' }}
                      onClick={() => { if (!busy && on) runPhase(phase); }}>
                      {isRunning ? '…' : '▸ Run'}
                    </button>
                    {phase.optional && (
                      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-mute)', cursor: busy ? 'default' : 'pointer' }}>
                        <input type="checkbox" checked={on} disabled={busy}
                          onChange={e => setIncluded(s => ({ ...s, [phase.id]: e.target.checked }))} />
                        include in full run
                      </label>
                    )}
                  </div>

                  {/* Live progress */}
                  {Array.isArray(job?.subSteps) && (
                    <div className="workflow-substeps" style={{ paddingLeft: 0, marginTop: 9 }}>
                      {job.subSteps.map(ss => {
                        const sg = dot(ss.status);
                        return (
                          <span key={ss.key} className="workflow-substep" title={ss.summary || ss.label}>
                            <span style={{ color: sg.color }}>{sg.ch}</span> {ss.label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {isRunning && (
                    <div style={{ marginTop: 7, fontSize: 11, color: 'var(--text-mute)', fontFamily: 'var(--mono)' }} title={job.output || ''}>
                      {(job.activity || 'Working…')}{job.toolCount ? ` · ${job.toolCount} steps` : ''}
                    </div>
                  )}
                  {job?.summary && !isRunning && (
                    <div style={{ marginTop: 7, fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--mono)' }} title={job.output || ''}>{job.summary}</div>
                  )}
                  {job?.warning && (
                    <div style={{ marginTop: 7, fontSize: 11, color: 'var(--yellow)', fontFamily: 'var(--mono)', lineHeight: 1.4 }}>{job.warning}</div>
                  )}
                  {job?.error && (
                    <div style={{ marginTop: 7, fontSize: 11, color: 'var(--red)', fontFamily: 'var(--mono)', lineHeight: 1.4 }}>{job.error}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 16, lineHeight: 1.6 }}>
        Tip: the first time, make sure Claude Code is installed and logged in (run <code>claude</code> once in a terminal).
        Evaluated reports are marked “unconfirmed” because deep page checks don’t run in the background — confirm a posting before you apply.
      </p>
    </div>
  );
};
