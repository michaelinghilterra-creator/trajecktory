// Review tab — the weekly tracking view. The three floors with teeth, the
// leading indicators, the build-lock state, and a one-field LinkedIn-connect
// logger. Reads the same numbers weekly-review.mjs reviews (GET
// /api/metrics/weekly and /api/review/status), so the screen and the CLI can
// never disagree. A blank source shows "not logged", never a fake zero.
const { useState: useStateRv, useEffect: useEffectRv, useCallback: useCallbackRv } = React;

function floorTone(r) {
  if (!r.available) return { color: 'var(--text-mute)', label: 'not logged' };
  return r.met
    ? { color: 'var(--green)', label: 'on track' }
    : { color: 'var(--red)', label: 'below floor' };
}

function ReviewFloor({ r }) {
  const t = floorTone(r);
  return (
    <div className="kpi">
      <span className="kpi-label">{r.label}</span>
      <span className="kpi-value" style={{ color: t.color }}>{r.available ? `${r.value}${r.unit || ''}` : '—'}</span>
      <span className="dim mono" style={{ fontSize: 11 }}>
        floor {r.floor}{r.unit || ''} · <span style={{ color: t.color }}>{t.label}</span>
      </span>
    </div>
  );
}

function ReviewIndicator({ label, m }) {
  const avail = m && m.available;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13 }}>{label}</span>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: avail ? 'var(--text)' : 'var(--text-mute)' }}>
        {avail ? m.value : 'not logged'}
      </span>
    </div>
  );
}

// Week-over-week trend, read from the FROZEN review log (status.history, which
// GET /api/review/status already returns). Each row is one floor across recent
// weeks; the values are the numbers AS THEY WERE at review time, so a past week
// never moves even as live data (or the cadence template) changes underneath. Δ
// is the change from the previous logged week, so the direction of travel is the
// headline. Running the review is what appends a week here.
const WOW_FLOORS = [
  { key: 'verifiedTouches',  label: 'Verified touches',  unit: '' },
  { key: 'linkedinConnects', label: 'LinkedIn connects', unit: '' },
  { key: 'cadencePct',       label: 'Cadence',           unit: '%' },
];
const WOW_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function wowWeekLabel(week) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week || '');
  return m ? `${WOW_MONTHS[+m[2] - 1]} ${+m[3]}` : (week || '?');
}
function wowCellColor(f) {
  if (!f || !f.available) return 'var(--text-mute)';
  return f.met ? 'var(--green)' : 'var(--red)';
}
const WOW_TH = { textAlign: 'right', padding: '7px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-mute)', whiteSpace: 'nowrap' };
const WOW_TH_L = { ...WOW_TH, textAlign: 'left' };
const WOW_TD = { textAlign: 'right', padding: '7px 12px', whiteSpace: 'nowrap' };
const WOW_TD_L = { textAlign: 'left', padding: '7px 12px', fontSize: 13 };

// Debriefs due: interview rounds on file whose current status is an interview
// stage with no debrief note yet (GET /api/interview/debriefs/pending). This is
// the ONLY way to capture a debrief for a round that already happened; the
// on-transition prompt only fires going forward. Clicking a row opens the same
// window.DebriefModal used elsewhere, so past rounds are captured through one path.
function DebriefsDue({ pending, onOpen }) {
  if (pending == null) return null; // still loading — stay quiet, no flicker
  const n = pending.length;
  return (
    <>
      <h3 style={{ margin: '0 0 4px' }}>Debriefs due{n ? ` (${n})` : ''}</h3>
      <p className="dim" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
        Interview rounds on file with no debrief captured. The objection is the whole point, and it fades fast.
      </p>
      {n === 0 ? (
        <div className="card dim" style={{ marginBottom: 24 }}>No debriefs due. Every interview round on file has one.</div>
      ) : (
        <div className="card" style={{ padding: '4px 16px', marginBottom: 24, borderLeft: '3px solid var(--accent)' }}>
          {pending.map(p => (
            <div key={`${p.id}:${p.stage}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '9px 2px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{p.company}</span>{' '}
                <span className="dim" style={{ fontSize: 12 }}>· {p.role || 'role n/a'} · {p.stage}</span>
              </div>
              <button className="btn accent sm" style={{ flexShrink: 0 }}
                onClick={() => onOpen({ appId: p.id, company: p.company, role: p.role, stage: p.stage })}>
                Add debrief
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Gmail sync panel: reconnect + the read-only sweep that catches missed
// communications. Reconnect (window.location → /api/google/auth-start) is the
// anchor: the June token died and only re-consent mints a new one. "Check email"
// runs a READ-ONLY preview (bounce dry-run + replies) so missed bounces and
// replies are seen before anything is written; only a hard bounce flip is
// applied here (unambiguous, and it corrects the reply-rate denominator).
// Logging a reply against a specific application comes next (needs app selection).
const GMAIL_SINCE = '2026-06-01';

function replyCompany(reply) {
  return reply.contact ? reply.contact.company : (reply.companyGuess ? reply.companyGuess.company : '');
}

// One reply row, made actionable. The reply resolves to one or more candidate
// applications (server-attached by company); the user picks when there is more
// than one, then Log (note only), Responded, or Rejected. Each POSTs to the
// existing /replies/:msgId/:action, which logs a note and (for the status ones)
// flips the application status. Once acted, the row shows a confirmation.
function ReplyRow({ reply, toast }) {
  const cands = reply.candidateApps || [];
  const guessId = reply.companyGuess ? reply.companyGuess.appId : null;
  const initial = (guessId && cands.some(a => a.id === guessId)) ? guessId : (cands[0] ? cands[0].id : null);
  const [appId, setAppId] = useStateRv(initial);
  const [done, setDone] = useStateRv(null);
  const [busy, setBusy] = useStateRv(false);
  const company = replyCompany(reply);
  const picked = cands.find(a => a.id === appId);
  const tag = reply.companyGuess ? `≈ ${reply.companyGuess.company}` : (reply.contact ? reply.contact.company : '');

  const act = (action) => {
    if (!appId) { toast && toast('Pick which application this reply belongs to.', 'error'); return; }
    setBusy(true);
    const note = `${reply.from} — ${reply.subject || '(no subject)'}${reply.sentiment ? ` [${reply.sentiment}]` : ''}`;
    fetch(`/api/google/replies/${encodeURIComponent(reply.msgId)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, note, company }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        setDone(res.statusFlip || 'logged');
        toast && toast(res.statusFlip ? `Marked ${res.statusFlip}` : 'Reply logged', 'success');
      })
      .catch(e => toast && toast(e.message, 'error')).finally(() => setBusy(false));
  };

  return (
    <div style={{ padding: '7px 2px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{reply.from} · {reply.subject || '(no subject)'}</span>
        <span className="dim mono" style={{ flexShrink: 0 }}>{reply.sentiment}{tag ? ` · ${tag}` : ''}</span>
      </div>
      {done ? (
        <div style={{ marginTop: 4, color: 'var(--green)' }}>✓ {done === 'logged' ? 'Logged' : `Marked ${done}`}{picked ? ` · ${picked.role}` : ''}</div>
      ) : cands.length === 0 ? (
        <div className="dim" style={{ marginTop: 4 }}>No matching application on file{company ? ` for ${company}` : ''}.</div>
      ) : (
        <div style={{ display: 'flex', gap: 6, marginTop: 5, alignItems: 'center', flexWrap: 'wrap' }}>
          {cands.length > 1 ? (
            <select value={appId || ''} onChange={e => setAppId(parseInt(e.target.value, 10))}
              style={{ fontSize: 12, padding: '3px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)' }}>
              {cands.map(a => <option key={a.id} value={a.id}>{a.role} — {a.status}</option>)}
            </select>
          ) : (
            <span className="dim">{cands[0].role} — {cands[0].status}</span>
          )}
          <button className="btn sm" onClick={() => act('log')} disabled={busy}>Log</button>
          <button className="btn sm" onClick={() => act('responded')} disabled={busy}>Responded</button>
          <button className="btn ghost sm" onClick={() => act('rejected')} disabled={busy}>Rejected</button>
        </div>
      )}
    </div>
  );
}

const SWEEP_SENTIMENT_ORDER = { negative: 0, positive: 1, neutral: 2 };
const SWEEP_ROW_LIMIT = 100;

function GmailSweep({ sweep, onApplyBounces, busy, toast }) {
  const b = sweep.bounces || {}, r = sweep.replies || {};
  const replies = r.replies || [], byCompany = r.byCompany || [], unknown = r.unknown || [];
  // Sentiment-first so rejections to mark and advances to log sit at the top, not
  // buried under neutral auto-mail. Capped so a large backlog stays responsive.
  const all = [...replies, ...byCompany].sort((x, y) => (SWEEP_SENTIMENT_ORDER[x.sentiment] ?? 3) - (SWEEP_SENTIMENT_ORDER[y.sentiment] ?? 3));
  const rows = all.slice(0, SWEEP_ROW_LIMIT);
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="dim mono" style={{ fontSize: 12 }}>
          Bounces: {b.hardBounces || 0} hard, {b.softBounces || 0} soft · {b.wouldFlip || 0} would flip a contact to bounced
        </span>
        {b.wouldFlip ? <button className="btn sm" onClick={onApplyBounces} disabled={busy}>Apply {b.wouldFlip} bounce flip{b.wouldFlip === 1 ? '' : 's'}</button> : null}
      </div>
      <div className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 4 }}>
        Replies since June: {replies.length} from known contacts, {byCompany.length} matched to an application, {unknown.length} unknown. Log one to record it on the application, and Responded/Rejected also set its status.
        {all.length > SWEEP_ROW_LIMIT ? ` Showing the first ${SWEEP_ROW_LIMIT} (rejections first).` : ''}
      </div>
      {rows.length === 0
        ? <div className="dim" style={{ fontSize: 12 }}>No contact- or company-matched replies in range.</div>
        : rows.map((x, i) => <ReplyRow key={x.msgId || i} reply={x} toast={toast} />)}
      <p className="dim" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        Nothing is sent. Bounce flips write the contact's verify tag and status; logging a reply writes a note on the chosen application.
      </p>
    </div>
  );
}

function GmailPanel({ toast }) {
  const [st, setSt] = useStateRv(undefined);   // undefined = loading; null = error; object = status
  const [sweep, setSweep] = useStateRv(null);
  const [busy, setBusy] = useStateRv(false);

  useEffectRv(() => {
    fetch('/api/google/status').then(r => r.json()).then(setSt).catch(() => setSt(null));
  }, []);

  const connect = () => { window.location.href = '/api/google/auth-start'; };

  const checkEmail = () => {
    setBusy(true); setSweep(null);
    Promise.all([
      fetch('/api/google/scan-bounces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: true, since: GMAIL_SINCE }) }).then(r => r.json()),
      fetch(`/api/google/replies?since=${GMAIL_SINCE}`).then(r => r.json()),
    ]).then(([bounces, replies]) => {
      if (bounces.error || replies.error) { toast && toast(bounces.error || replies.error, 'error'); return; }
      setSweep({ bounces, replies });
    }).catch(e => toast && toast(e.message, 'error')).finally(() => setBusy(false));
  };

  const applyBounces = () => {
    setBusy(true);
    fetch('/api/google/scan-bounces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: false, since: GMAIL_SINCE }) })
      .then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        toast && toast(`Applied ${res.flipped} bounce flip${res.flipped === 1 ? '' : 's'}.`, 'success');
        checkEmail();
      })
      .catch(e => toast && toast(e.message, 'error')).finally(() => setBusy(false));
  };

  if (st === undefined) return null; // loading — stay quiet, no flash
  const connected = !!(st && st.connected && !st.expired);
  const expired = !!(st && st.connected && st.expired);

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <strong>Gmail sync</strong>{' '}
          {connected ? <span className="dim" style={{ fontSize: 12 }}>connected as {st.connectedEmail || 'your account'} · read-only</span>
            : expired ? <span style={{ color: 'var(--red)', fontSize: 12 }}>connection expired, reconnect to resume</span>
            : <span className="dim" style={{ fontSize: 12 }}>not connected</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {connected ? (
            <>
              <button className="btn accent sm" onClick={checkEmail} disabled={busy}>{busy ? 'Checking…' : 'Check email'}</button>
              <button className="btn ghost sm" onClick={connect} disabled={busy}>Reconnect</button>
            </>
          ) : (
            <button className="btn primary sm" onClick={connect}>{expired ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          )}
        </div>
      </div>
      {!connected ? (
        <p className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Read-only. Scans your inbox for bounces and replies since June, so missed communications are caught and the reply-rate math is honest. It never sends. Testing-mode tokens expire about weekly, so an occasional reconnect is normal.
        </p>
      ) : null}
      {sweep ? <GmailSweep sweep={sweep} onApplyBounces={applyBounces} busy={busy} toast={toast} /> : null}
    </div>
  );
}

function WeekOverWeek({ history }) {
  const weeks = (history || []).slice(-6);
  return (
    <>
      <h3 style={{ margin: '0 0 4px' }}>Week over week</h3>
      {weeks.length === 0 ? (
        <div className="card dim" style={{ marginBottom: 24 }}>
          No weeks logged yet. Run the review to freeze this week and start the trend.
        </div>
      ) : (
        <>
          <p className="dim" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
            Frozen at review time, so past weeks never move. Δ is the change from the previous logged week.
          </p>
          <div className="card" style={{ padding: 0, marginBottom: 24, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={WOW_TH_L}>Floor</th>
                  {weeks.map(w => <th key={w.week} style={WOW_TH}>{wowWeekLabel(w.week)}</th>)}
                  <th style={WOW_TH}>Δ wk</th>
                </tr>
              </thead>
              <tbody>
                {WOW_FLOORS.map(fl => {
                  const cells = weeks.map(w => (w.floors || []).find(f => f.key === fl.key));
                  const avail = cells.filter(c => c && c.available).map(c => Number(c.value));
                  const delta = avail.length >= 2 ? avail[avail.length - 1] - avail[avail.length - 2] : null;
                  const deltaColor = delta == null ? 'var(--text-mute)' : delta > 0 ? 'var(--green)' : delta < 0 ? 'var(--red)' : 'var(--text-mute)';
                  return (
                    <tr key={fl.key} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={WOW_TD_L}>{fl.label}</td>
                      {cells.map((c, i) => (
                        <td key={i} className="mono" style={{ ...WOW_TD, color: wowCellColor(c) }}>
                          {c && c.available ? `${c.value}${fl.unit}` : '—'}
                        </td>
                      ))}
                      <td className="mono" style={{ ...WOW_TD, color: deltaColor, fontWeight: 600 }}>
                        {delta == null ? '—' : `${delta > 0 ? '+' : ''}${delta}${fl.unit}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

window.ReviewTab = function ReviewTab({ toast }) {
  const [data, setData] = useStateRv(null);
  const [status, setStatus] = useStateRv(null);
  const [err, setErr] = useStateRv(null);
  const [name, setName] = useStateRv('');
  const [running, setRunning] = useStateRv(false);
  const [pending, setPending] = useStateRv(null); // debriefs due (null = loading)
  const [debrief, setDebrief] = useStateRv(null);  // open debrief modal, or null

  const load = useCallbackRv(() => {
    fetch('/api/metrics/weekly').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setData(d); })
      .catch(e => setErr(e.message));
    fetch('/api/review/status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);
  const loadPending = useCallbackRv(() => {
    fetch('/api/interview/debriefs/pending').then(r => r.json())
      .then(d => setPending((d && d.pending) || [])).catch(() => setPending([]));
  }, []);
  useEffectRv(() => { load(); loadPending(); }, [load, loadPending]);

  // Freeze this week into the log and (re)compute the build lock. This is the
  // deliberate snapshot: after it runs, the week is fixed in the history and the
  // week-over-week table below stops moving for it. Same engine the CLI runs.
  const runReview = () => {
    setRunning(true);
    fetch('/api/review/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        setStatus({ lock: res.lock, lastReview: res.lastReview, history: res.history });
        load();
        const nowLocked = res.lock && res.lock.locked;
        toast && toast(nowLocked ? 'Week logged. Build lock ENGAGED.' : `Weekly review logged (${res.weekStart}).`, nowLocked ? 'warn' : 'success');
      })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setRunning(false));
  };

  const logConnect = () => {
    fetch('/api/linkedin/connects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, source: 'manual' }),
    }).then(r => r.json())
      .then(res => { setName(''); toast && toast(`Connect logged (${res.total} this campaign)`, 'success'); load(); })
      .catch(e => toast && toast(e.message, 'error'));
  };

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the weekly review: {err}</div>;
  if (!data) return <div className="dim" style={{ padding: 28 }}>Loading weekly review…</div>;

  const m = data.metrics || {};
  const floors = (data.floors && data.floors.results) || [];
  const locked = status && status.lock && status.lock.locked;
  const history = (status && status.history) || [];

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2, gap: 12 }}>
        <h2 style={{ margin: 0 }}>Weekly review</h2>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="dim mono" style={{ fontSize: 12 }}>{data.weekStart} → {data.weekEnd}</span>
          <button className="btn sm" onClick={runReview} disabled={running}
            title="Freeze this week's numbers into the log and recompute the build lock. Same review the CLI runs.">
            {running ? 'Running…' : 'Run weekly review'}
          </button>
        </div>
      </div>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        Leading indicators, not applications. A blank source reads "not logged", never zero.
      </p>

      <GmailPanel toast={toast} />

      {locked ? (
        <div className="card" style={{ borderLeft: '3px solid var(--red)', marginBottom: 18 }}>
          <strong style={{ color: 'var(--red)' }}>Build lock engaged.</strong>{' '}
          <span className="dim">{status.lock.reason}</span>
          <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
            Improvement work is locked. Break-fix, data integrity, live-process work, and sub-30-minute unblocks stay allowed.
          </div>
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, marginBottom: 24 }}>
        {floors.map(r => <ReviewFloor key={r.key} r={r} />)}
      </div>

      <WeekOverWeek history={history} />

      <h3 style={{ margin: '0 0 4px' }}>Leading indicators</h3>
      <div className="card" style={{ padding: '4px 16px', marginBottom: 24 }}>
        <ReviewIndicator label="Replies on delivered mail" m={m.replies} />
        <ReviewIndicator label="Delivered reply rate % (cumulative)" m={m.deliveredReplyRatePct} />
        <ReviewIndicator label="Screens booked" m={m.screensBooked} />
        <ReviewIndicator label="Screen objections logged" m={m.objectionsLogged} />
        <ReviewIndicator label="Unserviced applications (WIP)" m={m.unservicedApplications} />
      </div>

      <DebriefsDue pending={pending} onOpen={setDebrief} />

      <h3 style={{ margin: '0 0 4px' }}>Log a LinkedIn connect</h3>
      <p className="dim" style={{ fontSize: 12, marginTop: 0, marginBottom: 8 }}>
        Connections are sent by hand. Log each one so the weekly floor is real, not a guess.
      </p>
      <div style={{ display: 'flex', gap: 8, maxWidth: 480 }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name or note (optional)"
          onKeyDown={e => { if (e.key === 'Enter') logConnect(); }}
          style={{ flex: 1, padding: '7px 10px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 13 }} />
        <button className="btn primary" onClick={logConnect}>+ Log connect</button>
      </div>

      {debrief && window.DebriefModal && (
        <window.DebriefModal prompt={debrief} toast={toast}
          onClose={(saved) => { setDebrief(null); if (saved) { loadPending(); load(); } }} />
      )}
    </div>
  );
};
