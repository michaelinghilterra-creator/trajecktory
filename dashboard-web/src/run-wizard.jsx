// ── Run Workflow — individual steps ───────────────────────────────────────────
// Full-page view of the operational phases (Expand coverage, API scan, Agent
// scan, Evaluate). Each phase runs on its OWN — press Run, let it finish, then
// run the next. There is deliberately NO bundled "run everything" chain:
// bundling hid where the pipeline broke and multiplied Claude usage. The
// deterministic phases hit /api/workflow/*; the Claude phases hit /api/agent/*
// (run headlessly on the user's own Claude plan).
window.RunWizardTab = function RunWizardTab({ toast }) {
  const { useState, useRef } = React;

  const PHASES = [
    { id: 'discover',  usesClaude: false, optional: true,
      route: '/api/workflow/discover', status: '/api/workflow/status/',
      title: 'Expand coverage',
      desc: 'Scans your saved searches and pulls fresh companies into your portal list. Free, no AI.' },
    { id: 'api-scan',  usesClaude: false, optional: false,
      route: '/api/workflow/api-scan', status: '/api/workflow/status/',
      title: 'API scan',
      desc: 'Hits Greenhouse, Ashby, and Lever directly for roles that match your filters. Free, no AI.' },
    { id: 'agent-scan', usesClaude: true, optional: true,
      route: '/api/agent/scan', status: '/api/agent/status/',
      title: 'Agent scan',
      desc: "Claude searches the web for roles the API scan can't reach and adds them to your pipeline." },
    { id: 'evaluate',  usesClaude: true, optional: false,
      route: '/api/agent/pipeline', status: '/api/agent/status/',
      title: 'Evaluate pipeline',
      desc: 'Claude reads each pending posting, scores it against your profile, writes a report, and writes tracker rows. Run Merge Tracker in the left sidebar afterward to fold them into your pipeline.' },
  ];

  const [jobs, setJobs] = useState({});      // { phaseId: jobObj }
  const pollersRef = useRef({});

  // Run ONE phase. Nothing chains — the user runs each step when they choose.
  function runPhase(phase) {
    setJobs(j => ({ ...j, [phase.id]: { status: 'running', activity: 'Starting…' } }));
    window.tjkMutate(phase.route, { method: 'POST' })
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok || body.error || !body.jobId) {
          setJobs(j => ({ ...j, [phase.id]: { status: 'error', error: body.error || 'failed to start' } }));
          toast && toast(`${phase.title} failed to start`, 'error');
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
              }
            })
            .catch(() => { clearInterval(poll); });
        }, 2000);
        pollersRef.current[phase.id] = poll;
      })
      .catch(err => { setJobs(j => ({ ...j, [phase.id]: { status: 'error', error: err.message } })); toast && toast(`${phase.title} failed`, 'error'); });
  }

  function reset() {
    Object.values(pollersRef.current).forEach(clearInterval);
    pollersRef.current = {};
    setJobs({});
  }

  const busy = Object.values(jobs).some(j => j?.status === 'running');

  function dot(status) {
    if (status === 'running') return { ch: '◐', color: 'var(--yellow)' };
    if (status === 'done')    return { ch: '✓', color: 'var(--green)' };
    if (status === 'warn')    return { ch: '⚠', color: 'var(--yellow)' };
    if (status === 'error')   return { ch: '✕', color: 'var(--red)' };
    return { ch: '○', color: 'var(--text-mute)' };
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', paddingBottom: 32 }}>

      {/* Header */}
      <div className="card padded-lg" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: '0 0 4px', fontSize: 19, color: 'var(--text)' }}>Run your job search</h2>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
          Run each step on its own: press <strong>Run</strong>, let it finish, then run the next. Steps marked <span style={{ color: 'var(--accent)' }}>✦</span> use your Claude Code plan. Liveness Gate, Merge Tracker, Verify, and Health live in the left sidebar.
        </p>
        <button className="btn ghost" disabled={busy} onClick={reset}>↺ Reset</button>
      </div>

      {/* Phase cards — each runs independently */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {PHASES.map((phase, i) => {
          const job = jobs[phase.id];
          const g = dot(job?.status);
          const isRunning = job?.status === 'running';
          return (
            <div key={phase.id} className="card">
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span className="mono" style={{ color: g.color, fontSize: 15, width: 16, textAlign: 'center', flexShrink: 0 }}>{g.ch}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 14, color: 'var(--text)' }}>{i + 1}. {phase.title}</strong>
                    {phase.usesClaude && <span title="Uses your Claude Code plan" style={{ color: 'var(--accent)', fontSize: 12 }}>✦</span>}
                    {phase.optional && <span className="pill" style={{ fontSize: 9.5, padding: '1px 6px', color: 'var(--text-mute)' }}>optional</span>}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 3 }}>{phase.desc}</div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 9 }}>
                    <button className="btn ghost" disabled={isRunning} title={`Run only: ${phase.title}`}
                      style={{ border: '1px solid var(--border)' }}
                      onClick={() => { if (!isRunning) runPhase(phase); }}>
                      {isRunning ? '…' : '▸ Run'}
                    </button>
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
        Tip: the first time, sign in via "Sign in to Claude" in the left sidebar so the Claude steps can run.
        Evaluated reports are marked "unconfirmed" because deep page checks don't run in the background, so confirm a posting before you apply.
      </p>
    </div>
  );
};
