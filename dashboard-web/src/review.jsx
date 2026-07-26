// Review tab — the weekly tracking view. The three floors with teeth, the
// leading indicators, the live rolling build-cap floor, and a one-field LinkedIn-connect
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
      <span className="kpi-value" style={{ color: t.color }}>{r.available ? `${r.value}${r.unit || ''}` : '-'}</span>
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
  // The auto-detected sentiment is a coarse keyword guess ("next steps" reads
  // positive even on a bland info email), so it is an editable override, not a
  // verdict. Whatever it is set to is what gets written into the logged note.
  const [sentiment, setSentiment] = useStateRv(reply.sentiment || 'neutral');
  const company = replyCompany(reply);
  const picked = cands.find(a => a.id === appId);
  const tag = reply.companyGuess ? `≈ ${reply.companyGuess.company}` : (reply.contact ? reply.contact.company : '');

  const act = (action) => {
    if (action !== 'dismiss' && !appId) { toast && toast('Pick which application this reply belongs to.', 'error'); return; }
    setBusy(true);
    const note = `${reply.from}: ${reply.subject || '(no subject)'} [${sentiment}]`;
    const body = action === 'dismiss' ? {} : { appId, note, company };
    fetch(`/api/google/replies/${encodeURIComponent(reply.msgId)}/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        setDone(action === 'dismiss' ? 'dismissed' : (res.statusFlip || 'logged'));
        toast && toast(action === 'dismiss' ? 'Dismissed' : (res.statusFlip ? `Marked ${res.statusFlip}` : 'Reply logged'), 'success');
      })
      .catch(e => toast && toast(e.message, 'error')).finally(() => setBusy(false));
  };

  return (
    <div style={{ padding: '7px 2px', borderBottom: '1px solid var(--border)', fontSize: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{reply.from} · {reply.subject || '(no subject)'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <select value={sentiment} onChange={e => setSentiment(e.target.value)}
            title="Auto-detected sentiment is a rough keyword guess. Override it if wrong; the value you set is recorded with the logged note."
            className="mono"
            style={{ fontSize: 12, padding: '1px 4px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer',
              color: sentiment === 'negative' ? 'var(--red)' : sentiment === 'positive' ? 'var(--green)' : 'var(--text-mute)' }}>
            <option value="negative">negative</option>
            <option value="positive">positive</option>
            <option value="neutral">neutral</option>
          </select>
          {tag ? <span className="dim mono">· {tag}</span> : null}
        </div>
      </div>
      {done ? (
        <div style={{ marginTop: 4, color: 'var(--green)' }}>✓ {done === 'logged' ? 'Logged' : done === 'dismissed' ? 'Dismissed' : `Marked ${done}`}{picked ? ` · ${picked.role}` : ''}</div>
      ) : cands.length === 0 ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 4, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="dim">No matching application on file{company ? ` for ${company}` : ''}.</span>
          <button className="btn ghost sm" onClick={() => act('dismiss')} disabled={busy}>Dismiss</button>
        </div>
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
  // Hide replies already logged in a prior sweep (server marks them handled by
  // message id), so the list shrinks as you work the backlog instead of resurfacing
  // done ones. Then sentiment-first (rejections and advances above neutral auto-mail),
  // capped so a large backlog stays responsive.
  const matched = [...replies, ...byCompany];
  const handledCount = matched.filter(x => x.handled).length;
  const all = matched.filter(x => !x.handled).sort((x, y) => (SWEEP_SENTIMENT_ORDER[x.sentiment] ?? 3) - (SWEEP_SENTIMENT_ORDER[y.sentiment] ?? 3));
  const rows = all.slice(0, SWEEP_ROW_LIMIT);
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="dim mono" style={{ fontSize: 12 }}>
          Bounces: {b.hardBounces || 0} hard, {b.softBounces || 0} soft · {(b.proposed || []).length} would flip a contact to bounced
        </span>
      </div>
      {(b.proposed || []).length > 0 && (
        <div style={{ marginTop: 6, marginBottom: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div className="dim" style={{ fontSize: 11 }}>
            Confirm each one. A bounce is read from the email itself, which can be spoofed, so check the address before marking a contact dead.
          </div>
          {(b.proposed || []).map(p => (
            <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12 }}>
              <span>
                <b>{p.name || p.address}</b>{p.company ? <span className="dim"> · {p.company}</span> : null}{' '}
                <span className="mono dim">{p.address}</span>
                {!p.sentHistory ? <span className="mono" style={{ color: 'var(--red)', marginLeft: 6 }}>⚠ no record you emailed this</span> : null}
              </span>
              <button className="btn sm" onClick={() => onApplyBounces([p.key])} disabled={busy}>Mark bounced</button>
            </div>
          ))}
        </div>
      )}
      <div className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 4 }}>
        Replies since June: {all.length} to handle{handledCount ? `, ${handledCount} already handled` : ''} · {unknown.length} unknown. Log records it on the application; Responded/Rejected also set status.
        {all.length > SWEEP_ROW_LIMIT ? ` Showing the first ${SWEEP_ROW_LIMIT} (rejections first).` : ''}
      </div>
      {rows.length === 0
        ? <div className="dim" style={{ fontSize: 12 }}>{handledCount ? 'All matched replies handled. Nothing left in range.' : 'No contact- or company-matched replies in range.'}</div>
        : rows.map((x, i) => <ReplyRow key={x.msgId || i} reply={x} toast={toast} />)}
      <p className="dim" style={{ fontSize: 11, marginTop: 8, marginBottom: 0 }}>
        Nothing is sent. Bounce flips write the contact's verify tag and status; logging a reply writes a note on the chosen application.
      </p>
    </div>
  );
}

// How long to wait before auto-running the sweep again on Review open. Flipping
// between tabs should not re-sweep the whole backlog each time; a fresh open (or a
// new day) should. Tracked in localStorage so it survives re-mounts within a session.
const GMAIL_AUTOSCAN_KEY = 'tjk_gmail_autoscan_at';
const GMAIL_AUTOSCAN_THROTTLE_MS = 2 * 60 * 60 * 1000; // 2 hours

function lastCheckedLabel(days) {
  if (days == null) return null;
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function GmailPanel({ toast }) {
  const [st, setSt] = useStateRv(undefined);   // undefined = loading; null = error; object = health
  const [sweep, setSweep] = useStateRv(null);
  const [busy, setBusy] = useStateRv(false);
  const [howTo, setHowTo] = useStateRv(false);

  // Health, not status: /status.expired reflects the ≈1h access token (stale most
  // of the time, refreshes silently), so it cannot tell "reconnect me" apart from
  // "normal". /health probes the weekly refresh token, so the reconnect prompt only
  // shows when a reconnect is actually needed.
  useEffectRv(() => {
    fetch('/api/google/health').then(r => r.json()).then(setSt).catch(() => setSt(null));
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

  const applyBounces = (confirm = []) => {
    if (!Array.isArray(confirm) || confirm.length === 0) return;
    setBusy(true);
    fetch('/api/google/scan-bounces', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dryRun: false, since: GMAIL_SINCE, confirm }) })
      .then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        toast && toast(`Applied ${res.flipped} bounce flip${res.flipped === 1 ? '' : 's'}.`, 'success');
        checkEmail();
      })
      .catch(e => toast && toast(e.message, 'error')).finally(() => setBusy(false));
  };

  // Auto-scan on open: when the connection is healthy, run the read-only sweep
  // automatically the first time Review opens (throttled), so missed replies and
  // bounces surface without a click. Gated on health so it never fires against a
  // dead token; the manual "Check email" button still forces a fresh sweep anytime.
  useEffectRv(() => {
    if (!st || !st.connected || !st.healthy) return;
    let lastAuto = 0;
    try { lastAuto = parseInt(localStorage.getItem(GMAIL_AUTOSCAN_KEY) || '0', 10) || 0; } catch { /* private mode */ }
    if (Date.now() - lastAuto < GMAIL_AUTOSCAN_THROTTLE_MS) return;
    // Stamp before firing so a strict-mode double-invoke or a fast re-mount cannot
    // launch the sweep twice.
    try { localStorage.setItem(GMAIL_AUTOSCAN_KEY, String(Date.now())); } catch { /* private mode */ }
    checkEmail();
  }, [st && st.healthy]);

  if (st === undefined) return null; // loading — stay quiet, no flash
  // THREE states, not two. "No Google client on this install" and "client exists,
  // not connected yet" both used to render as "not connected" with a Connect
  // button, so the first kind of user clicked it and got an error page naming an
  // env var. That reads as a broken feature when it is an unstarted one. Anything
  // older or unreachable (st === null, or a server that predates `configured`)
  // falls through to the connect state, which is the previous behaviour.
  const needsSetup = !!(st && st.configured === false);
  const connected = !!(st && st.connected && st.healthy);
  const needsReconnect = !!(st && st.connected && !st.healthy);
  const lastChecked = connected ? lastCheckedLabel(st.daysSinceCheck) : null;

  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <strong>Gmail sync</strong>{' '}
          {connected ? <span className="dim" style={{ fontSize: 12 }}>connected as {st.connectedEmail || 'your account'} · read-only{lastChecked ? ` · checked ${lastChecked}` : ''}</span>
            : needsReconnect ? <span style={{ color: 'var(--red)', fontSize: 12 }}>connection expired, reconnect to resume</span>
            : needsSetup ? <span className="dim" style={{ fontSize: 12 }}>not set up · optional</span>
            : <span className="dim" style={{ fontSize: 12 }}>not connected</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {connected ? (
            <>
              <button className="btn accent sm" onClick={checkEmail} disabled={busy}>{busy ? 'Checking…' : 'Check email'}</button>
              <button className="btn ghost sm" onClick={connect} disabled={busy}>Reconnect</button>
            </>
          ) : needsSetup ? (
            // No Connect button here on purpose: there is nothing to connect to yet,
            // and offering one is what made this look broken.
            <button className="btn ghost sm" onClick={() => setHowTo(v => !v)} aria-expanded={howTo}>
              {howTo ? 'Hide the steps' : 'How to set this up'}
            </button>
          ) : (
            <button className="btn primary sm" onClick={connect}>{needsReconnect ? 'Reconnect Gmail' : 'Connect Gmail'}</button>
          )}
        </div>
      </div>
      {needsReconnect ? (
        <p style={{ fontSize: 12, marginTop: 8, marginBottom: 0, color: 'var(--red)' }}>
          Your Gmail connection expired, so replies and bounces are not being caught right now. Reconnect to resume. If your Google app is still in Testing, Google expires the connection about weekly and this is normal; setting the app to In production stops it. Read-only, and nothing is ever sent.
        </p>
      ) : needsSetup ? (
        <p className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 0, lineHeight: 1.6 }}>
          Nothing is wrong here. This one needs about 15 minutes of one-time setup in your own Google account before it can be connected, because trajecktory deliberately does not ship a shared mail connection: your mailbox stays reachable only by your own key.
          {' '}<b style={{ fontWeight: 500, color: 'var(--text-dim)' }}>What you would get:</b> replies to your applications and bounced outreach get caught automatically, so nothing slips past and the reply rate stops counting a dead address as a company ignoring you.
          {' '}<b style={{ fontWeight: 500, color: 'var(--text-dim)' }}>If you skip it:</b> everything else works the same and you log replies by hand on this tab.
        </p>
      ) : !connected ? (
        <p className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Read-only. Scans your inbox for bounces and replies, so missed communications are caught and the reply-rate math is honest. It never sends.
        </p>
      ) : (
        <p className="dim" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          Read-only, checked automatically when you open this tab. It never sends.
        </p>
      )}
      {needsSetup && howTo ? <window.GmailSetupSteps /> : null}
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
                          {c && c.available ? `${c.value}${fl.unit}` : '-'}
                        </td>
                      ))}
                      <td className="mono" style={{ ...WOW_TD, color: deltaColor, fontWeight: 600 }}>
                        {delta == null ? '-' : `${delta > 0 ? '+' : ''}${delta}${fl.unit}`}
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

// The rolling outreach floor — the live build-cap gate (replaces the old weekly
// lock banner). Reads GET /api/build-floor. Shows the trailing count vs floor, the
// working-day window, a mark-day-off control, and the once-a-month reset.
const ROLL_STATE = {
  met:       { color: 'var(--green)',     label: 'On pace',            gate: 'Building unlocked.' },
  grace:     { color: 'var(--blue)',      label: 'Reset grace period', gate: 'Building unlocked while you get back on track.' },
  behind:    { color: 'var(--red)',       label: 'Behind pace',        gate: 'Building locked.' },
  'ramp-in': { color: 'var(--text-mute)', label: 'Getting started',    gate: 'Floor not enforced yet.' },
  'no-data': { color: 'var(--text-mute)', label: 'No touches yet',     gate: 'Floor not enforced yet.' },
};

function RollingFloor({ toast }) {
  const [st, setSt] = useStateRv(null);
  const [ptoDate, setPtoDate] = useStateRv('');
  const load = useCallbackRv(() => { fetch('/api/build-floor').then(r => r.json()).then(setSt).catch(() => {}); }, []);
  useEffectRv(() => { load(); }, [load]);
  if (!st) return null;
  const s = ROLL_STATE[st.state] || ROLL_STATE.behind;

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const markPto = () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ptoDate)) { toast && toast('Pick a date first', 'warn'); return; }
    post('/api/build-floor/pto', { date: ptoDate, on: true }).then(r => r.json())
      .then(x => { setSt(x); setPtoDate(''); toast && toast(`Marked ${ptoDate} as a day off`, 'success'); }).catch(() => {});
  };
  const clearPto = (d) => post('/api/build-floor/pto', { date: d, on: false }).then(r => r.json()).then(setSt).catch(() => {});
  const doReset = () => {
    if (!window.confirm(`Use your monthly reset?\n\nThis starts a ${st.graceDays}-working-day grace period where the floor is paused so you can get back on track. It does not lower the floor, and you get one per month.`)) return;
    post('/api/build-floor/reset').then(async r => {
      const x = await r.json();
      if (!r.ok) { toast && toast(x.error || 'Reset unavailable', 'warn'); if (x.status) setSt(x.status); return; }
      setSt(x); toast && toast(`Reset used. Floor paused through ${x.graceUntil}.`, 'success');
    }).catch(() => {});
  };
  const mmdd = (d) => (d ? d.slice(5) : '');

  return (
    <div className="card" style={{ borderLeft: `3px solid ${s.color}`, marginBottom: 18, padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Build cap · rolling outreach floor</div>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>
            Verified touches over your trailing {st.windowDays} working days.
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: s.color }}>
            {st.trailingCount} <span className="dim" style={{ fontSize: 14 }}>/ {st.floor}</span>
          </div>
          <div className="mono" style={{ fontSize: 11, color: s.color }}>{s.label}</div>
        </div>
      </div>

      <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
        <span style={{ color: s.color, fontWeight: 600 }}>{s.gate}</span>{' '}
        {st.state === 'behind' && `${st.gap} more ${st.gap === 1 ? 'touch' : 'touches'} in your trailing week unlocks it. Weekend touches count.`}
        {st.state === 'grace' && `Grace period active through ${st.graceUntil}.`}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {st.window.map(day => (
          <div key={day} title={day} style={{ textAlign: 'center', minWidth: 42, padding: '4px 6px', borderRadius: 6, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
            <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{(st.perDay.find(p => p.day === day) || {}).count || 0}</div>
            <div className="dim mono" style={{ fontSize: 10 }}>{mmdd(day)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="date" value={ptoDate} onChange={e => setPtoDate(e.target.value)}
          style={{ padding: '6px 8px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', fontSize: 12 }} />
        <button className="btn ghost sm" onClick={markPto}>Mark day off</button>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={doReset} disabled={!st.reset.availableThisMonth}
          title={st.reset.availableThisMonth ? 'Starts a grace period so you can get back on track. Once a month.' : 'Already used this month.'}>
          {st.reset.availableThisMonth ? 'Use monthly reset' : 'Reset used this month'}
        </button>
      </div>

      {st.pto && st.pto.length ? (
        <div className="dim mono" style={{ fontSize: 11, marginTop: 10 }}>
          Days off:{' '}
          {st.pto.map(d => (
            <span key={d} style={{ marginRight: 8 }}>
              {d} <a onClick={() => clearPto(d)} style={{ cursor: 'pointer', color: 'var(--accent)' }}>✕</a>
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
        setStatus({ lastReview: res.lastReview, history: res.history });
        load();
        toast && toast(`Weekly review logged (${res.weekStart}).`, 'success');
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

      <RollingFloor toast={toast} />
      <p className="dim mono" style={{ fontSize: 11, marginTop: -8, marginBottom: 18 }}>
        When behind, improvement work is locked. Break-fix, data integrity, live-process work, and sub-30-minute unblocks stay allowed.
      </p>

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
