// Expanded Drawer — uses cheat-sheet data when available, else falls back to simple view.
const { useState: useStateD, useEffect: useEffectD } = React;

window.Drawer = function Drawer({ app, onClose, onAction }) {
  const [section, setSection] = useStateD("overview");
  const [cs, setCs] = useStateD(null);
  const [csLoading, setCsLoading] = useStateD(false);

  useEffectD(() => {
    const onKey = e => { if (e.key === "Escape") onClose(); };
    if (app) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app, onClose]);

  useEffectD(() => {
    setSection("report");
    setCs(null);
    if (!app) return;
    // Try mock first (Splitero demo), then fetch from API
    const mock = window.CHEAT_SHEETS?.[app.company];
    if (mock) { setCs(mock); setSection("overview"); return; }
    if (!app.report) return;
    setCsLoading(true);
    fetch(`/api/cheatsheets/${app.id}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) { setCs(data); setSection("overview"); } setCsLoading(false); })
      .catch(() => setCsLoading(false));
  }, [app?.id]);

  return (
    <>
      <div className={`drawer-backdrop ${app ? "open" : ""}`} onClick={onClose}></div>
      <div className={`drawer ${cs ? "wide" : ""} ${app ? "open" : ""}`}>
        {app && (
          <>
            <DrawerHead app={app} cs={cs} onClose={onClose} />
            <DrawerTabs section={section} setSection={setSection} hasCs={!!cs} />
            <div className="drawer-body">
              {csLoading && <div style={{ padding: 24, color: "var(--text-mute)", fontFamily: "var(--font-mono)", fontSize: 12 }}>Loading cheat sheet…</div>}
              {/* ReportSection stays mounted to avoid concurrent-mode race: keep it in the DOM,
                  hidden when on another tab, so the fetch fires once and HTML is ready on click */}
              <div style={{ display: section === "report" ? "block" : "none" }}>
                <ReportSection app={app} />
              </div>
              {cs && section === "overview"   && <OverviewSection app={app} cs={cs} />}
              {cs && section === "cv"         && <CVMatchSection cs={cs} />}
              {cs && section === "comp"       && <CompSection cs={cs} app={app} />}
              {cs && section === "interview"  && <InterviewSection cs={cs} />}
              {cs && section === "customize"  && <CustomizeSection cs={cs} />}
              {cs && section === "legit"      && <LegitSection cs={cs} />}
              {!cs && !csLoading && section !== "report" && <BasicBody app={app} />}
              {/* Follow-Up history — visible on EVERY tab. Hidden until at least
                  one touch exists so it doesn't add noise to fresh entries. */}
              <FollowupHistorySection appId={app.id} />
            </div>
            <QuickCopyBar />
            <DrawerFoot app={app} cs={cs} onAction={onAction} />
          </>
        )}
      </div>
    </>
  );
};

function DrawerHead({ app, cs, onClose }) {
  return (
    <div className="drawer-head">
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 10, marginBottom: 4, flexWrap: "wrap" }}>
          <span className="mono dim" style={{ fontSize: 11 }}>#{String(app.id).padStart(3, "0")}</span>
          <window.StatusPill status={app.status} />
          {cs && <span className="legit-pill mono">✓ {cs.legitimacy}</span>}
          {cs?.batchId && <span className="mono dim" style={{ fontSize: 10.5 }}>batch {cs.batchId}</span>}
        </div>
        <h3>{app.company}</h3>
        <div className="dim" style={{ fontSize: 13, marginTop: 2 }}>{app.role}</div>
        {cs && (
          <div className="row" style={{ gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            <span className="meta-chip">{cs.remote}</span>
            <span className="meta-chip">{cs.domain}</span>
            <span className="meta-chip">{cs.seniority?.split("(")[0].trim()}</span>
            {cs.url && <a className="meta-chip link" href={cs.url} target="_blank" rel="noreferrer">JD ↗</a>}
          </div>
        )}
      </div>
      <button className="icon-btn" onClick={onClose} title="Close (Esc)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  );
}

function DrawerTabs({ section, setSection, hasCs }) {
  const tabs = [
    ...(hasCs ? [
      { id: "overview",  label: "Overview" },
      { id: "cv",        label: "CV Match" },
      { id: "comp",      label: "Comp" },
      { id: "interview", label: "Interview" },
      { id: "customize", label: "Customize" },
      { id: "legit",     label: "Legitimacy" },
    ] : []),
    { id: "report", label: "Full Report" },
  ];
  return (
    <div className="drawer-tabs">
      {tabs.map(t => (
        <button key={t.id} className={section === t.id ? "active" : ""} onClick={() => setSection(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

const RPT_STYLE = `
  .rpt h1{font-size:16px;font-weight:700;margin:0 0 6px;color:var(--text)}
  .rpt h2{font-size:12px;font-weight:600;margin:22px 0 7px;padding-bottom:5px;border-bottom:1px solid var(--border);color:var(--text-mute);text-transform:uppercase;letter-spacing:.06em}
  .rpt h3{font-size:12.5px;font-weight:600;margin:14px 0 5px;color:var(--text)}
  .rpt p{margin:4px 0;font-size:13px;color:var(--text);line-height:1.6}
  .rpt hr{border:none;border-top:1px solid var(--border);margin:16px 0}
  .rpt blockquote{border-left:3px solid var(--accent);margin:8px 0;padding:5px 12px;color:var(--text-mute)}
  .rpt table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}
  .rpt th{padding:5px 9px;text-align:left;font-weight:600;color:var(--text-mute);border:1px solid var(--border);font-size:11px;text-transform:uppercase;letter-spacing:.04em;background:var(--bg-3,#1e1e1e)}
  .rpt td{padding:5px 9px;border:1px solid var(--border);vertical-align:top;color:var(--text);font-size:12px}
  .rpt ul{margin:5px 0 9px;padding-left:18px}
  .rpt li{margin:3px 0;font-size:13px;color:var(--text)}
  .rpt strong{font-weight:600;color:var(--text)}
  .rpt em{font-style:italic;color:var(--text-mute)}
  .rpt code{background:var(--bg-3,#222);border-radius:3px;padding:1px 5px;font-size:11.5px;font-family:var(--font-mono);color:var(--text)}
  .rpt a{color:var(--accent,#7c6ff7);text-decoration:none}
`;

function ReportSection({ app }) {
  const [html, setHtml] = useStateD(null);
  const [loading, setLoading] = useStateD(true);

  useEffectD(() => {
    if (!app) return;
    setHtml(null);
    setLoading(true);
    const ctrl = new AbortController();
    fetch(`/api/report-body/${app.id}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => { setHtml(d.html || '<p>Report has no content.</p>'); setLoading(false); })
      .catch(err => { if (err.name !== 'AbortError') { setHtml('<p>Failed to load report.</p>'); setLoading(false); } });
    return () => ctrl.abort();
  }, [app?.id]);

  if (loading) return (
    <div style={{ color: "var(--text-mute)", fontFamily: "var(--font-mono)", fontSize: 12 }}>
      Loading report…
    </div>
  );
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: RPT_STYLE }} />
      <div className="rpt" dangerouslySetInnerHTML={{ __html: html || '' }} />
    </>
  );
}

function BasicBody({ app }) {
  return (
    <div className="kv">
      <span className="k">Score</span>
      <span className="v"><window.ScoreChip score={app.score} /> <span className="dim mono" style={{ marginLeft: 8, fontSize: 11 }}>{window.scoreBucket(app.score)} match</span></span>
      <span className="k">Archetype</span><span className="v mono">{app.archetype}</span>
      <span className="k">Date logged</span><span className="v mono">{app.date} <span className="dim">· {window.daysAgo(app.date)}d ago</span></span>
      <span className="k">Notes</span><span className="v">{app.notes}</span>
      {app.report && <span className="k">Report</span>}
      {app.report && <span className="v mono dim" style={{ fontSize: 10.5 }}>{app.report}</span>}
    </div>
  );
}

// ---------- OVERVIEW ----------
function OverviewSection({ app, cs }) {
  const compSnap = cs.compStated || (app.salary != null ? `$${app.salary}k` : null);
  return (
    <div className="col" style={{ gap: 16 }}>
      {cs.tldr && (
        <div className="cs-callout">
          <div className="cs-callout-label">TL;DR</div>
          <div className="cs-callout-body">{cs.tldr}</div>
        </div>
      )}

      {/* Snapshot grid */}
      <div className="snap-grid">
        <div className="snap">
          <div className="snap-label">Score</div>
          <div className="snap-value" style={{ color: window.scoreColor(app.score) }}>{window.fmtScore(app.score)}<span className="dim" style={{ fontSize: 11, marginLeft: 4 }}>/5</span></div>
          <div className="snap-sub">{window.scoreBucket(app.score)} match</div>
        </div>
        <div className="snap">
          <div className="snap-label">Comp (stated)</div>
          <div className="snap-value mono sm">{compSnap || "—"}</div>
          <div className="snap-sub">{cs.seniority?.split("(")[0]?.trim() || app.archetype}</div>
        </div>
        <div className="snap">
          <div className="snap-label">Domain</div>
          <div className="snap-value sm">{cs.domain || app.archetype}</div>
          <div className="snap-sub">{cs.function?.split("(")[0].trim() || "—"}</div>
        </div>
        <div className="snap">
          <div className="snap-label">Team / Remote</div>
          <div className="snap-value sm">{cs.teamSize || "—"}</div>
          <div className="snap-sub">{cs.remote || "—"}</div>
        </div>
      </div>

      {/* Score breakdown radar/bars */}
      <div className="cs-section">
        <div className="cs-section-head">
          <span>Global Score Breakdown</span>
          <span className="mono dim">{cs.globalScore.reduce((s,d)=> s + (d.val > 0 ? d.val : 0), 0).toFixed(2)} / {cs.globalScore.filter(d=>d.val>0).reduce((s,d)=>s+d.max,0)}</span>
        </div>
        <div className="score-bars">
          {cs.globalScore.map(d => {
            const pct = d.val > 0 ? (d.val / d.max) * 100 : 0;
            const isNeg = d.val < 0;
            return (
              <div key={d.dim} className="score-bar-row">
                <span className="score-bar-label">{d.dim}</span>
                <div className="score-bar-track">
                  <div className="score-bar-fill" style={{ width: `${pct}%`, background: isNeg ? "var(--red)" : pct >= 80 ? "var(--green)" : pct >= 60 ? "var(--yellow)" : "var(--orange)" }} />
                </div>
                <span className="score-bar-val mono" style={{ color: isNeg ? "var(--red)" : "var(--text)" }}>
                  {isNeg ? d.val : `${d.val}/${d.max}`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recommendation */}
      {cs.recommendation && (
        <div className="cs-callout accent">
          <div className="cs-callout-label">Recommendation</div>
          <div className="cs-callout-body">{cs.recommendation}</div>
        </div>
      )}

      {/* Company brief */}
      <div className="cs-section">
        <div className="cs-section-head"><span>Company Brief</span></div>
        <p className="cs-prose">{cs.companyBrief}</p>
      </div>

      {/* Keywords */}
      <div className="cs-section">
        <div className="cs-section-head"><span>Extracted Keywords</span><span className="mono dim">{cs.keywords.length}</span></div>
        <div className="kw-cloud">
          {cs.keywords.map(k => <span key={k} className="kw-tag">{k}</span>)}
        </div>
      </div>
    </div>
  );
}

// ---------- CV MATCH ----------
function CVMatchSection({ cs }) {
  const counts = cs.cvMatch.reduce((a, r) => { a[r.strength] = (a[r.strength]||0) + 1; return a; }, {});
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="cs-section">
        <div className="cs-section-head">
          <span>JD Requirements → CV Evidence</span>
          <span className="mono dim">
            <span style={{ color: "var(--green)" }}>● {counts.strong||0}</span> strong &nbsp;
            <span style={{ color: "var(--yellow)" }}>● {counts.moderate||0}</span> moderate &nbsp;
            <span style={{ color: "var(--red)" }}>● {counts.weak||0}</span> weak
          </span>
        </div>
        <div className="match-list">
          {cs.cvMatch.map((m, i) => (
            <div key={i} className="match-row">
              <span className={`strength-pill ${m.strength}`}>{m.strength === "strong" ? "✓" : m.strength === "moderate" ? "~" : "!"}</span>
              <div className="match-body">
                <div className="match-req">{m.req}</div>
                <div className="match-ev">{m.evidence}</div>
                {m.note && <div className="match-note dim">{m.note}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-section-head"><span>Gaps & Mitigation</span><span className="mono dim">{cs.gaps.length} flagged</span></div>
        <table className="cs-table">
          <thead><tr><th>Gap</th><th>Blocker?</th><th>Mitigation</th></tr></thead>
          <tbody>
            {cs.gaps.map((g, i) => (
              <tr key={i}>
                <td><b>{g.gap}</b></td>
                <td><span className="block-pill">{g.blocker}</span></td>
                <td className="dim-cell">{g.mitigation}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="cs-section">
        <div className="cs-section-head"><span>Level Match</span></div>
        <div className="kv compact">
          <span className="k">JD level</span><span className="v">{cs.levelMatch.jdLevel}</span>
          <span className="k">Natural level</span><span className="v">{cs.levelMatch.naturalLevel}</span>
          <span className="k">Read</span><span className="v">{cs.levelMatch.verdict}</span>
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-section-head"><span>"Sell senior without lying" plan</span></div>
        <div className="col" style={{ gap: 10 }}>
          {cs.sellSenior.map((s, i) => (
            <div key={i} className="sell-card">
              <div className="sell-claim"><span className="mono dim">{String(i+1).padStart(2, "0")}</span> {s.claim}</div>
              <div className="sell-proof"><span className="dim mono">proof</span> {s.proof}</div>
              <blockquote className="sell-phrase">"{s.phrase}"</blockquote>
            </div>
          ))}
        </div>
      </div>

      {cs.downlevelPlan && (
        <div className="cs-callout warn">
          <div className="cs-callout-label">If they downlevel</div>
          <div className="cs-callout-body">{cs.downlevelPlan}</div>
        </div>
      )}
    </div>
  );
}

// ---------- COMP ----------
function CompSection({ cs, app }) {
  const c = cs.comp || { stated: null, sources: [], score: null, walkaway: null, verdict: null, market: null };
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="snap-grid three">
        <div className="snap">
          <div className="snap-label">Stated OTE</div>
          <div className="snap-value mono sm">{c.stated || cs.compStated || "—"}</div>
          <div className="snap-sub">{c.score != null ? `${c.score}/5 comp score` : "comp score N/A"}</div>
        </div>
        <div className="snap">
          <div className="snap-label">Posted vs target</div>
          {app.salary != null && app.target != null ? (
            <>
              <div className="snap-value mono" style={{ color: app.salary >= app.target ? "var(--green)" : "var(--red)" }}>
                {app.salary >= app.target ? "+" : "−"}{Math.abs(app.salary - app.target)}k
              </div>
              <div className="snap-sub">${app.salary}k posted · ${app.target}k target</div>
            </>
          ) : (
            <>
              <div className="snap-value mono dim">—</div>
              <div className="snap-sub">see stated OTE</div>
            </>
          )}
        </div>
        <div className="snap">
          <div className="snap-label">Walk-away</div>
          <div className="snap-value mono">{c.walkaway != null ? `$${c.walkaway}k` : "—"}</div>
          <div className="snap-sub" style={{ color: "var(--text-mute)" }}>{c.walkaway != null ? "cleared" : "not set"}</div>
        </div>
      </div>

      {(c.sources || []).length > 0 && (
        <div className="cs-section">
          <div className="cs-section-head"><span>Sources & Benchmarks</span></div>
          <table className="cs-table">
            <thead><tr><th>Source</th><th>Data</th><th>Notes</th></tr></thead>
            <tbody>
              {c.sources.map((s, i) => (
                <tr key={i}>
                  <td><b>{s.src}</b></td>
                  <td className="mono">{s.data}</td>
                  <td className="dim-cell">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {c.verdict && (
        <div className="cs-callout">
          <div className="cs-callout-label">Verdict</div>
          <div className="cs-callout-body">{c.verdict}</div>
        </div>
      )}
      <div className="cs-callout accent">
        <div className="cs-callout-label">Market Context</div>
        <div className="cs-callout-body">{c.market}</div>
      </div>
    </div>
  );
}

// ---------- NOT-RECOMMENDED NOTICE ----------
// Used when sections come back empty because the agent said "Do not apply".
// Surfaces the agent's recommendation prominently instead of showing
// empty headers that look like a parser failure.
function NotRecommendedNotice({ cs, sectionLabel }) {
  const rec = cs.recommendation || '';
  const isNotRecommended = /do not (?:apply|pursue)|recommend against|not recommended|not applicable|hard\s*(?:no|blocker)/i.test(rec);
  if (!isNotRecommended) return null;
  return (
    <div className="cs-callout" style={{ borderColor: 'var(--yellow, #f5a623)' }}>
      <div className="cs-callout-label" style={{ color: 'var(--yellow, #f5a623)' }}>
        ⚠ Agent recommends against this role
      </div>
      <div className="cs-callout-body">{rec}</div>
      <div className="cs-callout-body dim" style={{ marginTop: 8, fontSize: '0.9em' }}>
        No {sectionLabel} were generated because the role is a structural mismatch.
        See the Full Report for the detailed gap analysis.
      </div>
    </div>
  );
}

// ---------- INTERVIEW ----------
function InterviewSection({ cs }) {
  const [openStar, setOpenStar] = useStateD(0);
  const hasContent = cs.starStories.length > 0 || cs.redFlagQs.length > 0 || cs.leadStory.title;
  if (!hasContent) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <NotRecommendedNotice cs={cs} sectionLabel="interview stories" />
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      {cs.leadStory.title && (
        <div className="cs-callout accent">
          <div className="cs-callout-label">▶ Lead with: {cs.leadStory.title}</div>
          {cs.leadStory.reason && <div className="cs-callout-body" style={{ marginBottom: 8 }}>{cs.leadStory.reason}</div>}
          {cs.leadStory.script && <blockquote className="lead-script">"{cs.leadStory.script}"</blockquote>}
        </div>
      )}

      <div className="cs-section">
        <div className="cs-section-head">
          <span>STAR Stories Mapped to Requirements</span>
          <span className="mono dim">{cs.starStories.length} stories</span>
        </div>
        <div className="col" style={{ gap: 6 }}>
          {cs.starStories.map((s, i) => (
            <div key={i} className={`star-card ${openStar === i ? "open" : ""}`}>
              <button className="star-head" onClick={() => setOpenStar(openStar === i ? -1 : i)}>
                <span className="mono dim" style={{ width: 22 }}>{String(i+1).padStart(2,"0")}</span>
                <span className="star-title">{s.title}</span>
                <span className="star-req mono dim">{s.req}</span>
                <span className="star-toggle">{openStar === i ? "−" : "+"}</span>
              </button>
              {openStar === i && (
                <div className="star-body">
                  {s.S && <div className="star-row"><span className="star-tag">S</span><span>{s.S}</span></div>}
                  {s.T && <div className="star-row"><span className="star-tag">T</span><span>{s.T}</span></div>}
                  {s.A && <div className="star-row"><span className="star-tag">A</span><span>{s.A}</span></div>}
                  {s.R && <div className="star-row"><span className="star-tag result">R</span><span>{s.R}</span></div>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-section-head"><span>Red-Flag Questions</span><span className="mono dim">{cs.redFlagQs.length} prepped</span></div>
        <div className="col" style={{ gap: 8 }}>
          {cs.redFlagQs.map((r, i) => (
            <details key={i} className="redflag">
              <summary>
                <span className="mono" style={{ color: "var(--red)" }}>?</span>
                <span className="rf-q">{r.q}</span>
              </summary>
              <div className="rf-body">
                {r.behind && <div className="rf-behind"><span className="dim mono">behind:</span> {r.behind}</div>}
                {r.a && <div className="rf-answer">{r.a}</div>}
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- CUSTOMIZE ----------
function CustomizeSection({ cs }) {
  const [which, setWhich] = useStateD("cv");
  const list = which === "cv" ? cs.customizationCV : cs.customizationLI;
  const hasContent = cs.customizationCV.length > 0 || cs.customizationLI.length > 0;
  if (!hasContent) {
    const isNotRecommended = /do not (?:apply|pursue)|recommend against|not recommended|not applicable|hard\s*(?:no|blocker)/i.test(cs.recommendation || '');
    return (
      <div className="col" style={{ gap: 16 }}>
        {isNotRecommended
          ? <NotRecommendedNotice cs={cs} sectionLabel="customization recommendations" />
          : (
            <div className="cs-callout">
              <div className="cs-callout-label">No customizations generated</div>
              <div className="cs-callout-body">
                This report format does not include CV/LinkedIn customization recommendations.
                Use the CV Match tab to review alignment and gaps, then tailor manually.
              </div>
            </div>
          )
        }
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="seg-toggle">
        <button className={which === "cv" ? "active" : ""} onClick={() => setWhich("cv")}>CV Changes ({cs.customizationCV.length})</button>
        <button className={which === "li" ? "active" : ""} onClick={() => setWhich("li")}>LinkedIn Changes ({cs.customizationLI.length})</button>
      </div>

      <div className="col" style={{ gap: 10 }}>
        {list.map((c, i) => (
          <div key={i} className="custom-card">
            <div className="custom-head">
              <span className="mono dim">{String(i+1).padStart(2,"0")}</span>
              {c.section && <span className="custom-section">{c.section}</span>}
            </div>
            {c.current && (
              <div className="custom-row">
                <span className="custom-tag current">current</span>
                <span className="dim">{c.current}</span>
              </div>
            )}
            {c.change && (
              <div className="custom-row">
                <span className="custom-tag change">change</span>
                <span>{c.change}</span>
              </div>
            )}
            {c.why && (
              <div className="custom-row">
                <span className="custom-tag why">why</span>
                <span className="dim">{c.why}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- LEGITIMACY ----------
function LegitSection({ cs }) {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="cs-callout accent">
        <div className="cs-callout-label">✓ {cs.legitimacy}</div>
        <div className="cs-callout-body">{cs.legitimacyConclusion}</div>
      </div>

      <div className="cs-section">
        <div className="cs-section-head"><span>Signal Analysis</span></div>
        <div className="col" style={{ gap: 8 }}>
          {cs.legitimacySignals.map((s, i) => (
            <div key={i} className="signal-row">
              <span className={`signal-dot ${s.good ? "good" : "bad"}`}>{s.good ? "✓" : "✕"}</span>
              <div>
                <div className="signal-label">{s.signal}</div>
                <div className="signal-finding dim">{s.finding}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-section-head"><span>Source Links</span></div>
        <div className="col" style={{ gap: 6 }}>
          <div className="kv compact"><span className="k">JD URL</span><span className="v"><a className="link" href={cs.url} target="_blank" rel="noreferrer">{cs.url}</a></span></div>
          <div className="kv compact"><span className="k">Generated CV</span><span className="v mono dim">{cs.docx || cs.pdf}</span></div>
        </div>
      </div>
    </div>
  );
}

// One-click copy bar for the reusable info you paste into job applications
// (LinkedIn, portfolio, GitHub, email, phone, certs). Sourced from the profile
// via window.myIdentity() — no personal data hardcoded. Sits above the apply
// buttons so it's there while you fill an external form with the dashboard open.
function QuickCopyBar() {
  const m = (window.myIdentity && window.myIdentity()) || {};
  const [copied, setCopied] = useStateD(null);
  const trunc = (s, n = 22) => s.length > n ? s.slice(0, n - 1) + '…' : s;
  const items = [
    ['Email', m.email], ['Phone', m.phone], ['LinkedIn', m.linkedin],
    ['Portfolio', m.portfolioUrl], ['GitHub', m.github],
    ...(Array.isArray(m.certifications) ? m.certifications.filter(Boolean).map(c => [trunc(c), c]) : []),
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

function DrawerFoot({ app, cs, onAction }) {
  const [applyJob, setApplyJob] = useStateD(null);    // { mode, status: 'running'|'error', error? }
  const [applyResult, setApplyResult] = useStateD(null); // completed job data
  const [elapsed, setElapsed] = useStateD(0);

  useEffectD(() => { setApplyJob(null); setApplyResult(null); setElapsed(0); }, [app?.id]);

  useEffectD(() => {
    if (!applyJob || applyJob.status !== 'running') { setElapsed(0); return; }
    setElapsed(0);
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [applyJob?.status]);

  function startApply(mode) {
    // Open JD immediately — must happen synchronously during the click gesture
    // (browser blocks window.open inside async callbacks as a popup).
    // Skip for BYO: user has already applied, no need to surface the portal.
    if (cs?.url && mode !== 'byo' && mode !== 'cover') window.open(cs.url, '_blank');
    setApplyJob({ mode, status: 'running' });
    window.tjkMutate(`/api/apply/${app.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, company: app.company }),
    })
      .then(r => r.json())
      .then(({ jobId, error }) => {
        if (!jobId) { setApplyJob({ mode, status: 'error', error: error || 'Failed to start' }); return; }
        const poll = setInterval(() => {
          fetch(`/api/apply/status/${jobId}`)
            .then(r => r.json())
            .then(job => {
              if (job.status === 'done') {
                clearInterval(poll);
                setApplyJob(null);
                setApplyResult({ ...job, mode });
                // Cover-letter runs are not an apply action — don't flip status.
                if (mode !== 'cover') onAction(app, 'Applied', true);
              } else if (job.status === 'error') {
                clearInterval(poll);
                setApplyJob({ mode, status: 'error', error: job.error || 'Generation failed' });
              }
            })
            .catch(() => { clearInterval(poll); setApplyJob({ mode, status: 'error', error: 'Poll failed' }); });
        }, 2000);
      })
      .catch(err => setApplyJob({ mode, status: 'error', error: err.message }));
  }

  if (applyResult) {
    const r = applyResult.result || {};
    const fileName = p => p ? p.replace(/\\/g, '/').split('/').pop() : null;
    const hrefFor = p => {
      if (!p) return null;
      const f = fileName(p);
      return f.endsWith('.md') ? `/output-preview/${f}` : `/output/${f}`;
    };
    // BYO mode: no trajecktory-generated assets to link to. Show a logged-only
    // confirmation with just the JD link.
    const isByo = r.byo === true;
    const isCover = r.coverOnly === true;
    return (
      <div className="drawer-foot" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ color: 'var(--green)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          {isCover ? `✓ Cover letter ready for ${app.company}`
            : isByo ? `✓ Logged as applied to ${app.company} (no assets generated)`
            : `✓ Applied to ${app.company}`}
        </span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {(r.docx || r.pdf) && <a className="btn sm" href={hrefFor(r.docx || r.pdf)} target="_blank" rel="noreferrer">{r.docx ? 'CV DOCX ↗' : 'CV PDF ↗'}</a>}
          {r.cover && <a className="btn sm" href={hrefFor(r.cover)} target="_blank" rel="noreferrer">Cover Letter ↗</a>}
          {r.apply && <a className="btn sm accent" href={hrefFor(r.apply)} target="_blank" rel="noreferrer">Form Responses ↗</a>}
          {cs?.url && <a className="btn sm" href={cs.url} target="_blank" rel="noreferrer">JD ↗</a>}
          <button className="btn sm ghost" onClick={() => setApplyResult(null)}>✕</button>
        </div>
      </div>
    );
  }

  if (applyJob) {
    return (
      <div className="drawer-foot">
        {applyJob.status === 'running' && (
          <span className="mono dim" style={{ fontSize: 11 }}>
            ⟳ {applyJob.mode === 'claude' ? 'Generating CV + form responses…'
              : applyJob.mode === 'byo'    ? 'Logging application…'
              : applyJob.mode === 'cover'  ? 'Drafting cover letter…'
              :                              'Generating tailored CV…'} {elapsed > 0 && `(${elapsed}s)`}
          </span>
        )}
        {applyJob.status === 'error' && (
          <>
            <span className="mono" style={{ fontSize: 11, color: 'var(--red)' }}>✕ {applyJob.error}</span>
            <button className="btn sm ghost" onClick={() => setApplyJob(null)}>Dismiss</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="drawer-foot">
      {app.status === "Evaluated" && (
        <>
          <button className="btn primary" onClick={() => startApply('manual')}>Tailor CV</button>
          <button className="btn accent" onClick={() => startApply('claude')}>Claude Apply ✦</button>
          <button
            className="btn"
            title="Just mark as Applied without generating anything. Use when you applied with your own resume."
            onClick={() => startApply('byo')}
          >Already Applied ✓</button>
          <button
            className="btn ghost"
            title="Draft a tailored cover letter on demand. Does not open the JD or mark this as applied."
            onClick={() => startApply('cover')}
          >Cover Letter</button>
          <button className="btn" onClick={() => onAction(app, "SKIP")}>Skip</button>
          <button className="btn" onClick={() => onAction(app, "Not a Fit")}>Not a Fit</button>
          <button className="btn" onClick={() => onAction(app, "Closed")}>Closed</button>
        </>
      )}
      {app.status === "Applied" && (
        <>
          <button className="btn success" onClick={() => onAction(app, "Responded")}>Mark Responded</button>
          <button className="btn danger" onClick={() => onAction(app, "Rejected")}>Mark Rejected</button>
          <button
            className="btn ghost"
            title="Draft a tailored cover letter on demand."
            onClick={() => startApply('cover')}
          >Cover Letter</button>
        </>
      )}
      {(() => {
        // Advance one rung along the funnel: Responded → Phone Screen → 1st → 2nd
        // → 3rd → 4th → Offer. onAction (app.jsx handleAction) stamps [reached:].
        const idx = window.FUNNEL_ORDER.indexOf(app.status);
        if (idx >= window.FUNNEL_ORDER.indexOf("Responded") && idx < window.FUNNEL_ORDER.length - 1) {
          const next = window.FUNNEL_ORDER[idx + 1];
          return <button className="btn success" onClick={() => onAction(app, next)}>{next === "Offer" ? "Mark Offer" : `Move to ${next}`}</button>;
        }
        return null;
      })()}
      {/* "Mark Lost" — close a role after advancing past Applied (e.g. another candidate accepted).
          Sets status=Rejected and tags notes with [reached: <current stage>] so the analytics
          funnel still credits the furthest stage reached. */}
      {(app.status === "Responded" || window.isInterviewStage(app.status) || app.status === "Offer") && (
        <button
          className="btn danger"
          title={`Close as lost: analytics will keep crediting this entry to the ${app.status} stage`}
          onClick={() => {
            if (window.confirm(`Mark ${app.company} as Closed (Lost)?\n\nStatus will change to Rejected. Analytics will preserve that this entry reached the ${app.status} stage.`)) {
              onAction(app, "Rejected", false, app.status);
            }
          }}
        >Mark Lost</button>
      )}
      {app.status !== "Evaluated" && (
        <button className="btn ghost sm" title="Reset status back to Evaluated" onClick={() => onAction(app, "Evaluated")}>↺ Re-evaluate</button>
      )}
      {cs?.url && <a className="btn" href={cs.url} target="_blank" rel="noreferrer">Open JD ↗</a>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FollowupHistorySection — chronological log of every follow-up touch sent
// for this application. Sources data from /api/followups (data/follow-ups.md).
// Hidden when the app has zero touches so we don't clutter fresh entries.
// Refetches when the app id changes.
// ─────────────────────────────────────────────────────────────────────────────
function FollowupHistorySection({ appId }) {
  const [touches, setTouches] = useStateD([]);
  const [loading, setLoading] = useStateD(false);

  useEffectD(() => {
    if (!appId) return;
    setLoading(true);
    fetch('/api/followups')
      .then(r => r.ok ? r.json() : [])
      .then(all => {
        const mine = (all || [])
          .filter(t => t.appNum === appId)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setTouches(mine);
        setLoading(false);
      })
      .catch(() => { setTouches([]); setLoading(false); });
  }, [appId]);

  if (loading || touches.length === 0) return null;

  const channelColor = {
    Email:    'var(--accent)',
    LinkedIn: '#22d3ee',
    Phone:    '#a78bfa',
    Form:     '#60a5fa',
    Other:    'var(--text-mute)',
  };

  return (
    <div className="cs-section" style={{ marginTop: 18 }}>
      <div className="cs-section-head">
        <span>Follow-Up History</span>
        <span className="mono dim">{touches.length} touch{touches.length === 1 ? '' : 'es'}</span>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {touches.map((t, i) => {
          const color = channelColor[t.channel] || channelColor.Other;
          return (
            <div key={i} style={{ padding: 10, background: 'var(--panel)', borderRadius: 4, borderLeft: `3px solid ${color}` }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                <span className="mono" style={{ fontSize: 11, color, fontWeight: 700 }}>
                  {(t.channel || 'TOUCH').toUpperCase()}
                </span>
                <span className="mono dim" style={{ fontSize: 10 }}>{t.date}</span>
              </div>
              {t.contact && <div className="dim mono" style={{ fontSize: 10.5, marginBottom: 3 }}>→ {t.contact}</div>}
              <div style={{ fontSize: 11.5, color: 'var(--text)', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>
                {t.notes || <span className="dim">(no notes)</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
