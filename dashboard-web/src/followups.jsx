// Follow-Ups Tab — Stale Applications Action Queue
// Dedicated page for the highest-leverage daily action: timing follow-ups
// for Applied / Responded / Interview entries that have gone quiet.
// Each row carries coach intelligence from the cadence rules (server-side)
// so you see at a glance whether a touch is overdue, due now, or whether
// it's time to give up entirely.

const { useState: useStateF, useEffect: useEffectF, useMemo: useMemoF } = React;

const FOLLOWUP_TIER_LABELS = Object.freeze({
  hm: 'Hiring manager',
  exec: 'Skip-level exec',
  peer: 'Functional peer',
  ta: 'Talent acquisition',
  agency: 'Agency recruiter',
});

const FU_CHANNELS = ['Email', 'LinkedIn', 'Phone', 'Form', 'Other'];

const COACH_COLOR = {
  'give-up':  { bg: 'rgba(239,68,68,0.16)',   color: '#ef4444', label: 'GIVE UP' },
  'overdue':  { bg: 'rgba(245,158,11,0.16)',  color: '#f59e0b', label: 'OVERDUE' },
};

const STATUS_COLOR = {
  // Application statuses
  Applied:   { bg: 'rgba(96,165,250,0.16)', color: '#60a5fa' },
  Responded: { bg: 'rgba(34,211,238,0.16)', color: '#22d3ee' },
  // Interview ladder (amber -> deep-orange ramp)
  'Phone Screen':  { bg: 'rgba(252,211,77,0.16)', color: '#fcd34d' },
  '1st Interview': { bg: 'rgba(251,191,36,0.16)', color: '#fbbf24' },
  '2nd Interview': { bg: 'rgba(245,158,11,0.16)', color: '#f59e0b' },
  '3rd Interview': { bg: 'rgba(249,115,22,0.16)', color: '#f97316' },
  '4th Interview': { bg: 'rgba(234,88,12,0.16)',  color: '#ea580c' },
  // Target-talent statuses (shared color tokens — different meaning but same palette)
  Sent:                { bg: 'rgba(96,165,250,0.16)', color: '#60a5fa' },
  Replied:             { bg: 'rgba(34,211,238,0.16)', color: '#22d3ee' },
  'Meeting Scheduled': { bg: 'rgba(245,158,11,0.16)', color: '#f59e0b' },
};

function CoachPill({ level }) {
  const s = COACH_COLOR[level] || COACH_COLOR.overdue;
  return (
    <span className="mono" style={{
      background: s.bg, color: s.color,
      padding: '2px 6px', borderRadius: 4,
      fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function FUStatusPill({ status }) {
  const s = STATUS_COLOR[status] || { bg: 'rgba(113,113,122,0.14)', color: '#a1a1aa' };
  return (
    <span className="mono" style={{
      background: s.bg, color: s.color,
      padding: '2px 6px', borderRadius: 4,
      fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{status}</span>
  );
}

// Whether there's a usable way to actually follow up: a verified email, only a
// LinkedIn handle (which routes to the separate connect queue), or no contact at
// all. Drives the warm/cold split server-side; shown here so the user knows why
// something is or isn't in the urgent queue.
const CHANNEL_META = {
  email:    { label: '✓ email',      bg: 'rgba(34,197,94,0.14)',   color: '#22c55e' },
  linkedin: { label: 'LinkedIn only', bg: 'rgba(245,158,11,0.14)',  color: '#f59e0b' },
  none:     { label: 'no contact',    bg: 'rgba(113,113,122,0.14)', color: '#a1a1aa' },
};
function ChannelBadge({ channel }) {
  const m = CHANNEL_META[channel] || CHANNEL_META.none;
  return (
    <span className="mono" style={{
      background: m.bg, color: m.color,
      padding: '2px 6px', borderRadius: 4,
      fontSize: 10.5, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

// Bucket by days since last touch. Tiered thresholds (Applied 10d, Responded
// 5d, Interview 3d) mean items can arrive on this list well under 14d, so the
// buckets start at 0d and step up from there.
// `days` is BUSINESS days (weekends excluded), so the labels say so — a "45+"
// here is ~9 calendar weeks, and reading it as calendar days undersells the gap.
function ageBucket(days) {
  if (days >= 45) return { key: '45d+',  label: '45+ business days: likely ghosted',   color: '#ef4444' };
  if (days >= 21) return { key: '21-45d', label: '21-45 business days: write-off',       color: '#f59e0b' };
  if (days >= 10) return { key: '10-21d', label: '10-21 business days: aging, push hard', color: '#a78bfa' };
  return                  { key: '0-10d', label: '0-10 business days: fresh stale',        color: '#60a5fa' };
}

// ─── Follow-Ups Overview ─────────────────────────────────────────────────
// KPIs + visuals tuned to coach the user toward action, not intimidate.
// Mirrors Pipeline → Overview visual feel: 4 KPI cards, 3 charts, an action
// list. Each block carries a one-line insight that says what to do next.

function FUKpi({ label, value, sub, tone = 'neutral' }) {
  const COLOR = {
    neutral: 'var(--text)',
    good:    'var(--green)',
    warn:    'var(--yellow)',
    danger:  'var(--red)',
    accent:  'var(--accent)',
  };
  return (
    <div className="card" style={{ padding: '14px 16px', flex: 1, minWidth: 160 }}>
      <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 600, color: COLOR[tone], lineHeight: 1.1, marginTop: 4 }}>{value}</div>
      <div className="mono dim" style={{ fontSize: 11, marginTop: 6 }}>{sub}</div>
    </div>
  );
}

function FUBarRow({ label, n, total, color }) {
  const pct = total > 0 ? Math.round((n / total) * 100) : 0;
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color }}>{label}</span>
        <span className="mono dim">{n} · {pct}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function FUOverview({ items, thresholds, taThreshold, onOpen, compact }) {
  // Contact-scoped: applications now live in Pipeline → Awaiting response, so this
  // overview describes only the people (TA contacts) going quiet.
  const parseScore = (s) => {
    if (typeof s === 'number') return s;
    const m = String(s || '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };

  const total = items.length;
  const inConversation = items.filter(it => ['Replied', 'Meeting Scheduled'].includes(it.status)).length;
  const giveUpCount = items.filter(it => it.coachLevel === 'give-up').length;
  const avgSilence = total > 0 ? Math.round(items.reduce((s, it) => s + (it.daysSinceLastTouch || 0), 0) / total) : 0;

  const bucketCounts = useMemoF(() => {
    const b = {}; for (const it of items) { const k = ageBucket(it.daysSinceLastTouch).key; b[k] = (b[k] || 0) + 1; } return b;
  }, [items]);
  const statusCounts = useMemoF(() => {
    const c = {}; for (const it of items) c[it.status] = (c[it.status] || 0) + 1; return c;
  }, [items]);

  // Pick the most urgent insight for the action panel
  const orderedActions = useMemoF(() => {
    const score = (it) => {
      let s = parseScore(it.score) ?? 0;
      if (window.isInterviewStage(it.status)) s += 10;       // interview silence is critical
      if (it.coachLevel === 'give-up') s -= 5;               // these are write-offs, not nudge targets
      if (s >= 4.0) s += 2;                                  // bias high-fit
      return s;
    };
    return [...items]
      .filter(it => it.coachLevel !== 'give-up')
      .sort((a, b) => score(b) - score(a) || (a.daysSinceLastTouch ?? 0) - (b.daysSinceLastTouch ?? 0))
      .slice(0, 6);
  }, [items]);

  if (total === 0) {
    if (compact) return null;
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>No contacts going quiet.</div>
        <div className="dim" style={{ fontSize: 12 }}>
          People you've already reached surface here once they cross {taThreshold || 14} business days with no reply.
          Applications awaiting a response live in <b>Pipeline → Awaiting response</b>.
        </div>
      </div>
    );
  }

  // KPI tones — coaching not alarm
  const goingCold     = bucketCounts['45d+'] || 0;
  const staleTone     = total > 15 ? 'warn' : 'neutral';
  const coldTone      = goingCold > 0 ? 'danger' : giveUpCount > 0 ? 'warn' : 'good';
  const convoTone     = inConversation > 0 ? 'good' : 'neutral';
  const silenceTone   = avgSilence >= 21 ? 'warn' : 'neutral';

  // The 4 KPI tiles, reused by the compact strip (the merged Follow-ups lens under
  // Contacts) and the full overview below.
  const kpiRow = (
    <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
      <FUKpi label="Contacts going quiet" value={total} sub="Work the list, oldest first" tone={staleTone} />
      <FUKpi label="In conversation" value={inConversation} sub={inConversation > 0
        ? 'Replied or meeting booked. Keep the momentum'
        : 'No live threads right now'} tone={convoTone} />
      <FUKpi label="Going cold (45d+)" value={goingCold} sub={goingCold > 0
        ? 'Long silent. Send a final ping or let them go'
        : 'Nothing stuck past 45 days. Good'} tone={coldTone} />
      <FUKpi label="Avg silence" value={`${avgSilence}d`} sub={avgSilence >= 21
        ? 'Threads are aging. Clear the 21d+ bucket'
        : 'Healthy. Staying inside the window'} tone={silenceTone} />
    </div>
  );

  // Compact: just the KPI strip, folded into the top of the merged Follow-ups lens.
  if (compact) return kpiRow;

  // Visual data
  const ageOrder = ['0-10d', '10-21d', '21-45d', '45d+'];
  const ageColor = { '0-10d': '#60a5fa', '10-21d': '#a78bfa', '21-45d': '#f59e0b', '45d+': '#ef4444' };
  const statusOrder = ['Meeting Scheduled', 'Replied', 'Sent', 'Connected', 'Not Contacted', 'Dormant'];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>Follow-Ups</h1>
          <div className="sub">{total} contact{total === 1 ? '' : 's'} going quiet{giveUpCount ? ` · ${giveUpCount} ready to write off` : ''}</div>
        </div>
      </div>

      {/* KPI row */}
      {kpiRow}

      {/* Two visuals */}
      <div className="row" style={{ gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: 14, flex: 1, minWidth: 280 }}>
          <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>By Age</div>
          <div className="col" style={{ gap: 10 }}>
            {ageOrder.filter(k => (bucketCounts[k] || 0) > 0).map(k => (
              <FUBarRow key={k} label={k} n={bucketCounts[k] || 0} total={total} color={ageColor[k]} />
            ))}
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            {(bucketCounts['45d+'] || 0) > 0
              ? `${bucketCounts['45d+']} in the 45d+ bucket (likely ghosted), close them out.`
              : (bucketCounts['21-45d'] || 0) > 0
                ? 'Work the 21-45d bucket next. Last fair window to recover them.'
                : 'Stale queue is fresh. Every item is recoverable.'}
          </div>
        </div>

        <div className="card" style={{ padding: 14, flex: 1, minWidth: 260 }}>
          <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>By Status</div>
          <div className="col" style={{ gap: 10 }}>
            {statusOrder.filter(s => (statusCounts[s] || 0) > 0).map(s => (
              <FUBarRow key={s} label={s} n={statusCounts[s] || 0} total={total} color={STATUS_COLOR[s]?.color || '#a1a1aa'} />
            ))}
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            {(statusCounts['Replied'] || 0) + (statusCounts['Meeting Scheduled'] || 0) > 0
              ? 'Replied / meeting rows first. Those threads are live.'
              : 'Mostly sent-and-waiting. A nudge is what moves them.'}
          </div>
        </div>
      </div>

      {/* Needs Attention — same row layout as Pipeline → Overview */}
      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title"><span className="dot" />Needs Attention</span>
          <span className="card-meta mono">{orderedActions.length} items</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {orderedActions.length === 0 && <div className="no-data" style={{ padding: '8px 0' }}>You're caught up. Nothing urgent.</div>}
          {orderedActions.map(it => {
            const isTA = it.source === 'ta';
            const sc = parseScore(it.score);
            const isInt = window.isInterviewStage(it.status);
            const iconPath = isInt ? window.ICON.briefcase : isTA ? window.ICON.users : window.ICON.send;
            const color = isInt ? 'var(--orange)' : (sc != null && sc >= 4.0) ? 'var(--accent)' : 'var(--red)';
            const label = `Follow up · ${it.daysSinceLastTouch ?? 0}d silent`;
            return (
              <div key={`${it.source || 'app'}-${it.id}`} onClick={() => onOpen(it)} role="button" tabIndex={0} onKeyDown={window.kbdActivate(() => onOpen(it))}
                style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto auto', gap: 12, alignItems: 'center',
                  padding: '8px 10px', borderRadius: 9, cursor: 'pointer',
                  background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center',
                  background: 'var(--panel)', border: '1px solid var(--border)', color }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPath} /></svg>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name || `${it.taFirst || ''} ${it.taLast || ''}`.trim() || it.company || '-'}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[it.role || it.title, it.company].filter(Boolean).join(' · ') || '-'}
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 11, color, whiteSpace: 'nowrap' }}>{label}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FUStatusPill status={it.status} />
                  {!isTA && sc != null && <window.ScoreChip score={it.score} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.FollowupsTab = function FollowupsTab({ onAction, openTaContact, search, apps = [], toast, chromeless }) {
  const [data, setData]       = useStateF({ thresholds: { Applied: 7, Responded: 5, 'Phone Screen': 3, '1st Interview': 3, '2nd Interview': 3, '3rd Interview': 3, '4th Interview': 3 }, taThreshold: 14, ghostDays: 45, warm: [], cold: [], snoozed: [], ghostedCandidates: [] });
  const [loading, setLoading] = useStateF(true);
  const [selected, setSelected] = useStateF(null); // app id (only for 'app' source rows)
  const [statusFilter, setStatusFilter] = useStateF([]);
  const [bucketFilter, setBucketFilter] = useStateF([]);
  const [sourceFilter, setSourceFilter] = useStateF([]); // 'app' | 'ta'
  const [coldFilter, setColdFilter] = useStateF('all');  // 'all' | 'none' | 'awaiting'
  const [findFor, setFindFor] = useStateF(null);         // { company, role } for the Find-contacts modal
  const [decisionMakerFor, setDecisionMakerFor] = useStateF(null);
  // Subview: 'overview' (KPIs), 'warm' (the urgent queue + nav badge), 'cold'
  // ("Applications out": cold portal apps that should not nag daily).
  const [subView, setSubView] = useStateF('overview');
  // Chromeless = rendered inside the Contacts tab as the "Follow-ups" lens: no own
  // subtab bar, and the three subviews (Overview KPIs, the queue, Find a contact)
  // fold into one stacked column ('merged').
  const view = chromeless ? 'merged' : subView;

  const load = () => {
    setLoading(true);
    fetch('/api/followups/stale')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffectF(() => { load(); }, []);

  // Contacts the send gate is withholding because their address was never checked.
  // A short queue is ambiguous on its own: it can mean a quiet week or a missing
  // setting, and the user cannot tell which. Saying the number turns the second
  // case into something they can act on.
  const [withheld, setWithheld] = useStateF(null);
  useEffectF(() => {
    fetch('/api/followups/withheld').then(r => r.json())
      .then(d => setWithheld(d && !d.error ? d : null)).catch(() => {});
  }, []);
  const withholding = !!(withheld && withheld.withheld > 0 && !withheld.hasVerifierKeys);

  // TA contacts that look accepted from the latest LinkedIn import (a name+company
  // match with no exact-slug auto-flip). The user confirms each into Connected,
  // which then surfaces them in the queue as "Just connected".
  const [pendingAccept, setPendingAccept] = useStateF([]);
  useEffectF(() => { fetch('/api/referrals/pending-acceptances').then(r => r.json()).then(d => setPendingAccept(d && d.pending ? d.pending : [])).catch(() => {}); }, []);
  const [mergeSuggestions, setMergeSuggestions] = useStateF([]);
  const loadMergeSuggestions = () => fetch('/api/people/suggestions').then(r => r.json()).then(d => setMergeSuggestions(d && d.suggestions ? d.suggestions : [])).catch(() => {});
  useEffectF(() => { loadMergeSuggestions(); }, []);
  const decideMergeSuggestion = (suggestion, same) => {
    const url = same ? '/api/people/merge' : '/api/people/suggestions/reject';
    window.tjkMutate(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: suggestion.a, b: suggestion.b }) })
      .then(r => r.json())
      .then(res => { if (res.error) { toast && toast(res.error, 'error'); return; } loadMergeSuggestions(); load(); })
      .catch(e => toast && toast(e.message, 'error'));
  };
  const confirmAccepted = (id) => {
    window.tjkMutate(`/api/target-talent/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ linkedinStatus: 'Connected' }) })
      .then(r => r.json())
      .then(res => { if (res.error) { toast && toast(res.error, 'error'); return; } setPendingAccept(prev => prev.filter(p => p.id !== id)); load(); toast && toast('Marked connected', 'success'); })
      .catch(e => toast && toast(e.message, 'error'));
  };
  const dismissPending = (id) => setPendingAccept(prev => prev.filter(p => p.id !== id));

  const warm = data.warm || [];
  const cold = data.cold || [];
  const ghosted = data.ghostedCandidates || [];
  // Applied roles with no contact at the company — the "find a contact" nudge.
  const contactlessApps = data.contactlessApps || [];
  const unthreadedApps = data.unthreadedApps || [];
  // Applied roles going stale where you DO have a contact — surface the person to
  // ping, not a company card. Rendered in the Follow-ups queue with a stale pill.
  const staleAppContacts = data.staleAppContacts || [];
  // The Snoozed list is the snoozed slice of the single contact source of truth,
  // so anyone you snooze on a card lands here (with Un-snooze) until their date.
  // Application snoozes are excluded by construction — they belong to Pipeline →
  // Awaiting response, not this contacts-only tab.
  const snoozedContacts = data.snoozedContactFollowups || [];

  // Snooze defers a stale alert by N days without logging a touch (the clock
  // keeps running). Mute is the indefinite "done for now / awaiting reply": it
  // keeps the app Applied and drops it from the warm queue with no expiry.
  const snooze = (it, days = 14) => {
    window.tjkMutate('/api/followups/snooze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: it.source || 'app', id: it.id, days }),
    }).then(() => load()).catch(() => {});
  };
  const unsnooze = (it) => {
    window.tjkMutate('/api/followups/unsnooze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: it.source || 'app', id: it.id }),
    }).then(() => load()).catch(() => {});
  };
  const mute = (it) => {
    window.tjkMutate('/api/followups/mute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id }),
    }).then(() => load()).catch(() => {});
  };
  const unmute = (it) => {
    window.tjkMutate('/api/followups/unmute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: it.id }),
    }).then(() => load()).catch(() => {});
  };
  // Defer (or effectively mute) the "find a contact" nudge for a company with no
  // reachable contact. Uses the separate 'contactless' snooze bucket so it does
  // not touch the application's own follow-up. A long snooze (a year) is the
  // "there are no contacts here, stop asking" mute.
  const snoozeContactless = (a, days) => {
    window.tjkMutate('/api/followups/snooze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'contactless', id: a.id, days }),
    }).then(() => {
      load();
      window.tjkToast && window.tjkToast(days >= 300 ? `Muted — ${a.company} has no contacts to find` : `Snoozed ${a.company} for ${days} days`, 'success');
    }).catch(() => {});
  };
  const snoozeStakeholder = (a, days) => {
    window.tjkMutate('/api/followups/snooze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'stakeholder', id: a.id, days }),
    }).then(() => {
      load();
      window.tjkToast && window.tjkToast(days >= 300 ? `Muted: no decision-maker to chase at ${a.company}` : `Snoozed ${a.company} for ${days} days`, 'success');
    }).catch(() => {});
  };
  const archiveGhosted = (ids) => {
    if (!ids.length) return;
    if (!window.confirm(`Archive ${ids.length} ghosted application${ids.length === 1 ? '' : 's'} to "No Response"?\n\nThey'll leave the active pipeline but still count as applications-with-no-reply in your analytics.`)) return;
    window.tjkMutate('/api/followups/archive-ghosted', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    }).then(() => load()).catch(() => {});
  };

  // The current base list depends on the subview: cold for "Applications out",
  // warm otherwise (overview KPIs describe the urgent queue).
  const baseItems = subView === 'cold' ? cold : warm;

  // Source/status/age filters apply to the WARM queue. Source defaults to chips.
  const filtered = useMemoF(() => {
    const q = (search || '').trim().toLowerCase();
    return warm.filter(it => {
      if (statusFilter.length && !statusFilter.includes(it.status)) return false;
      if (bucketFilter.length && !bucketFilter.includes(ageBucket(it.daysSinceLastTouch).key)) return false;
      if (sourceFilter.length && !sourceFilter.includes(it.source || 'app')) return false;
      if (q) {
        const hay = `${it.company || ''} ${it.role || ''} ${it.taFirst || ''} ${it.taLast || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [warm, statusFilter, bucketFilter, sourceFilter, search]);

  // Cold list with its own simple lens: all / no-contact / awaiting (muted).
  const coldFiltered = useMemoF(() => {
    const q = (search || '').trim().toLowerCase();
    return cold.filter(it => {
      if (coldFilter === 'none' && it.channel !== 'none') return false;
      if (coldFilter === 'awaiting' && !it.muted) return false;
      if (q && !`${it.company || ''} ${it.role || ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cold, coldFilter, search]);

  const sourceCounts = useMemoF(() => {
    const c = { app: 0, ta: 0 };
    for (const it of warm) c[it.source || 'app']++;
    return c;
  }, [warm]);
  const toggleSource = (s) => setSourceFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);

  const bucketCounts = useMemoF(() => {
    const buckets = {};
    for (const it of warm) {
      const k = ageBucket(it.daysSinceLastTouch).key;
      buckets[k] = (buckets[k] || 0) + 1;
    }
    return buckets;
  }, [warm]);

  const statusCounts = useMemoF(() => {
    const counts = {};
    for (const it of warm) counts[it.status] = (counts[it.status] || 0) + 1;
    return counts;
  }, [warm]);

  const giveUpCount = useMemoF(() => warm.filter(it => it.coachLevel === 'give-up').length, [warm]);
  const coldNoContact = useMemoF(() => cold.filter(it => it.channel === 'none').length, [cold]);
  const coldMuted = useMemoF(() => cold.filter(it => it.muted).length, [cold]);

  const grouped = useMemoF(() => {
    const order = ['45d+', '21-45d', '10-21d', '0-10d'];
    const parseScore = s => {
      if (typeof s === 'number') return s;
      const m = String(s || '').match(/(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : -1;
    };
    const groups = {};
    for (const it of filtered) {
      const k = ageBucket(it.daysSinceLastTouch).key;
      if (!groups[k]) groups[k] = [];
      groups[k].push(it);
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => {
        const sd = parseScore(b.score) - parseScore(a.score);   // score DESC
        if (sd !== 0) return sd;
        return (a.daysSinceLastTouch ?? 0) - (b.daysSinceLastTouch ?? 0); // newer first
      });
    }
    const sampleDays = { '45d+': 45, '21-45d': 21, '10-21d': 10, '0-10d': 0 };
    return order.map(k => ({ key: k, label: ageBucket(sampleDays[k]).label, items: groups[k] || [] })).filter(g => g.items.length > 0);
  }, [filtered]);

  // Contact follow-ups (already-reached contacts going quiet) fold into the
  // Follow-ups queue tab. Applications moved to Pipeline → Awaiting response, so
  // this book is contact-level only. Grouped by age like the old warm queue.
  const warmContacts = useMemoF(() => warm.filter(it => (it.source || 'app') !== 'app'), [warm]);
  const contactGroups = useMemoF(() => {
    const order = ['45d+', '21-45d', '10-21d', '0-10d']; const groups = {};
    const q = (search || '').trim().toLowerCase();
    const items = q ? warmContacts.filter(it => `${it.company || ''} ${it.taFirst || ''} ${it.taLast || ''} ${it.role || ''}`.toLowerCase().includes(q)) : warmContacts;
    for (const it of items) { const k = ageBucket(it.daysSinceLastTouch).key; (groups[k] = groups[k] || []).push(it); }
    const sample = { '45d+': 45, '21-45d': 21, '10-21d': 10, '0-10d': 0 };
    return order.map(k => ({ key: k, label: ageBucket(sample[k]).label, items: groups[k] || [] })).filter(g => g.items.length);
  }, [warmContacts, search]);

  const toggleStatus = (s) => setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const toggleBucket = (b) => setBucketFilter(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);

  // Follow-Ups is contact-level after the revamp. The old "Warm threads" and
  // "Applications out" subtabs are gone: application follow-ups now live in
  // Pipeline → Awaiting response, and contact follow-ups fold into the Follow-ups
  // queue tab below the outreach queue.
  const SUBTABS = [
    { id: 'overview', label: 'Overview',         n: null,        icon: window.ICON.pulse },
    { id: 'queue',    label: 'Follow-ups',       n: (data.actionableCount ?? (data.contactFollowups || []).length) || null, icon: window.ICON.send },
    { id: 'findcontact', label: 'Find a contact', n: contactlessApps.length, icon: window.ICON.search || window.ICON.userPlus },
    { id: 'reachdm', label: 'Reach a decision-maker', n: unthreadedApps.length, icon: window.ICON.target || window.ICON.userPlus },
  ];

  const openFromOverview = (it) => {
    if (it.source === 'ta') { openTaContact && openTaContact(it.id); }
    else { setSelected(it.id); }
  };
  const openItem = (it) => {
    if (it.source === 'ta') { openTaContact && openTaContact(it.id); }
    else { setSelected(it.id); }
  };

  // App rows open the full Pipeline drawer (JD, notes, contacts, comms, plus the
  // Follow-up tab). Bridge its action contract: the footer emits action *ids*,
  // the stage track emits statuses; both funnel through the app-level onAction
  // (handleAction) and then refresh the queue.
  const FU_ACTION_MAP = {
    apply_manual: 'Applied', apply_claude: 'Applied', already_applied: 'Applied',
    responded: 'Responded', offer: 'Offer', accept: 'Offer',
    reopen: 'Evaluated',
    // funnel statuses (advance CTA / stage track emit the canonical status) map to themselves
    Applied: 'Applied', Responded: 'Responded', Offer: 'Offer',
    'Phone Screen': 'Phone Screen', '1st Interview': '1st Interview', '2nd Interview': '2nd Interview', '3rd Interview': '3rd Interview', '4th Interview': '4th Interview',
    SKIP: 'SKIP', 'Not a Fit': 'Not a Fit', Closed: 'Closed', Rejected: 'Rejected', Discarded: 'Discarded', 'No Response': 'No Response',
  };
  const ACTIVE = ['Evaluated', 'Applied', 'Responded', ...window.INTERVIEW_STAGES, 'Offer'];
  // onAction here is app.jsx's handleAction(app, status, silent, reachedStage,
  // eventDate) — the date rides in the 5th slot, so the two middle args stay
  // undefined to keep their existing defaults.
  const fuOnAction = (a, actionId, eventDate) => {
    const next = FU_ACTION_MAP[actionId];
    if (!next) return;
    onAction && onAction(a, next, undefined, undefined, eventDate);
    load();
    if (!ACTIVE.includes(next)) setSelected(null);
  };
  const fuOnStatusChange = (a, newStatus, eventDate) => { onAction && onAction(a, newStatus, undefined, undefined, eventDate); load(); };
  const selectedApp = selected != null ? (apps.find(a => a.id === selected) || null) : null;

  const FindContactsPanel = window.FindContactsPanel;

  return (
    <div className="col" style={{ gap: 0 }}>
      {/* Subtabs (hidden in chromeless mode — the Contacts subtab bar drives it) */}
      {!chromeless && (
      <div className="subtabs">
        {SUBTABS.map(s => (
          <button type="button" key={s.id} className={'subtab' + (subView === s.id ? ' active' : '')} onClick={() => setSubView(s.id)}>
            <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
            </span>
            {s.label}
            {s.n != null && <span className="mono dim" style={{ marginLeft: 6, fontSize: 10.5 }}>{s.n}</span>}
          </button>
        ))}
      </div>
      )}

      <div className="col" style={{ gap: 14, paddingTop: 14 }}>

      {(view === 'overview' || view === 'merged') && (
        <FUOverview
          items={data.contactFollowups || []}
          thresholds={data.thresholds}
          taThreshold={data.taThreshold}
          onOpen={openFromOverview}
          compact={view === 'merged'}
        />
      )}

      {/* ── Follow-ups: the outreach queue (Connect + Email + High value merged;
             channel is a filter chip), then contact follow-up nudges for people
             you've already reached who have gone quiet. ─────────────────────── */}
      {/* The single source of truth: one ranked, deduped list of every contact
          worth a touch (not-yet-contacted, app-going-stale, and gone-quiet, all
          merged server-side into data.contactFollowups). Contacts only — no
          application/company rows reach this tab. */}
      {(view === 'queue' || view === 'merged') && pendingAccept.length > 0 && (
        <div className="card padded-lg" style={{ borderColor: 'color-mix(in srgb, var(--green) 40%, transparent)' }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="card-title">✓ Recently accepted? Confirm</span>
            <span className="card-meta mono">these look connected from your latest LinkedIn import</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {pendingAccept.map(p => (
              <div key={`pa-${p.id}`} className="action-card">
                <div className="action-card-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span className="action-card-co">{p.name}</span>
                    <span className="dim"> · {p.company || 'unknown company'}</span>
                    {p.connectedOn ? <span className="dim mono" style={{ fontSize: 11, marginLeft: 6 }}>connected {p.connectedOn}</span> : null}
                  </div>
                  <div className="row" style={{ gap: 6, flex: 'none' }}>
                    <button className="btn accent sm" onClick={() => confirmAccepted(p.id)}>Confirm connected</button>
                    <button className="btn ghost sm" onClick={() => dismissPending(p.id)}>Not yet</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(view === 'queue' || view === 'merged') && mergeSuggestions.length > 0 && (
        <div className="card padded-lg" style={{ borderColor: 'color-mix(in srgb, var(--green) 40%, transparent)' }}>
          <div className="card-head" style={{ marginBottom: 8 }}>
            <span className="card-title">Possible duplicate contacts</span>
            <span className="card-meta mono">review before combining their history</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {mergeSuggestions.map(s => (
              <div key={`${s.a}-${s.b}`} className="action-card">
                <div className="action-card-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div><span className="action-card-co">{s.left.name}</span><span className="dim"> · {s.left.store} · {s.left.company || 'unknown company'}</span></div>
                    <div><span className="action-card-co">{s.right.name}</span><span className="dim"> · {s.right.store} · {s.right.company || 'unknown company'}</span></div>
                  </div>
                  <div className="row" style={{ gap: 6, flex: 'none' }}>
                    <button className="btn accent sm" onClick={() => decideMergeSuggestion(s, true)}>Same person</button>
                    <button className="btn ghost sm" onClick={() => decideMergeSuggestion(s, false)}>Not the same</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(view === 'queue' || view === 'merged') && (
        <window.FollowupQueueTab toast={toast} items={data.contactFollowups || []} onReload={load} />
      )}


      {/* ── Find a contact: applied roles with nobody to talk to ───────────── */}
      {(view === 'findcontact' || view === 'merged') && (
        <div style={{ padding: '4px 0' }}>
          <div className="ta-head">
            <div>
              <h1>Find a contact</h1>
              <div className="sub">
                {contactlessApps.length === 0
                  ? 'Every live application has at least one contact. Nice.'
                  : `${contactlessApps.length} role${contactlessApps.length === 1 ? '' : 's'} you've applied to with nobody to talk to. Find a hiring principal or TA contact so you can actually follow up.`}
              </div>
            </div>
          </div>
          {contactlessApps.length > 0 && (
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              {contactlessApps.map(a => (
                <div key={`cl-${a.id}`} className="action-card">
                  <div className="action-card-row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="mono dim" style={{ fontSize: 10.5 }}>#{String(a.id).padStart(3, '0')}</span>
                        <span className="action-card-co">{a.company}</span>
                        <span className="dim">· {a.role || 'unknown role'}</span>
                        <span className="pill" style={{ fontSize: 10.5 }}>{a.status}</span>
                        {a.applyDate ? <span className="dim" style={{ fontSize: 11 }}>applied {a.applyDate}</span> : null}
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flex: 'none' }}>
                      <button className="btn ghost sm" title="Remind me about this one in two weeks" onClick={() => snoozeContactless(a, 14)}>Snooze 2w</button>
                      <button className="btn ghost sm" title="There's no contact to find here — stop nudging me about it" onClick={() => snoozeContactless(a, 365)}>No contacts</button>
                      <button className="btn accent sm" onClick={() => setFindFor({ company: a.company, role: a.role })}>
                        Find a contact
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Reach a decision-maker: live roles where current contacts cannot decide */}
      {(view === 'reachdm' || view === 'merged') && (
        <div style={{ padding: '4px 0' }}>
          <div className="ta-head">
            <div>
              <h1>Reach a decision-maker</h1>
              <div className="sub">
                {unthreadedApps.length === 0
                  ? 'Every live application has someone who can move it. Good.'
                  : `${unthreadedApps.length} role${unthreadedApps.length === 1 ? '' : 's'} where your contacts can help with the process, but cannot make the hiring decision. Someone else decides.`}
              </div>
            </div>
          </div>
          {unthreadedApps.length > 0 && (
            <div className="col" style={{ gap: 8, marginTop: 12 }}>
              {unthreadedApps.map(a => {
                const tierLabel = FOLLOWUP_TIER_LABELS[a.topTier] || 'Current contacts';
                return (
                <div key={`dm-${a.id}`} className="action-card">
                  <div className="action-card-row">
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="mono dim" style={{ fontSize: 10.5 }}>#{String(a.id).padStart(3, '0')}</span>
                        <span className="action-card-co">{a.company}</span>
                        <span className="dim">· {a.role || 'unknown role'}</span>
                        <span className="pill" style={{ fontSize: 10.5 }}>{a.status}</span>
                        {a.applyDate ? <span className="dim" style={{ fontSize: 11 }}>applied {a.applyDate}</span> : null}
                      </div>
                      <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                        {a.contactCount} contact{a.contactCount === 1 ? '' : 's'}, {tierLabel.toLowerCase()} only
                      </div>
                    </div>
                    <div className="row" style={{ gap: 6, flex: 'none' }}>
                      <button className="btn ghost sm" title="Remind me about this one in two weeks" onClick={() => snoozeStakeholder(a, 14)}>Snooze 2w</button>
                      <button className="btn ghost sm" title="There is no decision-maker worth chasing at this company" onClick={() => snoozeStakeholder(a, 365)}>No decision-maker</button>
                      <button className="btn accent sm" onClick={() => setDecisionMakerFor({ company: a.company, role: a.role })}>
                        Find a decision-maker
                      </button>
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Find-contacts modal (reuses the per-company finder from TA Outreach) */}
      {findFor && FindContactsPanel && (
        <div className="modal-back" onClick={() => setFindFor(null)}>
          <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body" style={{ padding: 16 }}>
              <FindContactsPanel company={findFor.company} exampleRole={findFor.role}
                onAdded={load} onCancel={() => setFindFor(null)} />
            </div>
          </div>
        </div>
      )}

      {decisionMakerFor && FindContactsPanel && (
        <div className="modal-back" onClick={() => setDecisionMakerFor(null)}>
          <div className="modal" style={{ width: 560 }} onClick={e => e.stopPropagation()}>
            <div className="modal-body" style={{ padding: 16 }}>
              <FindContactsPanel company={decisionMakerFor.company} exampleRole={decisionMakerFor.role}
                initialMode="principal" onAdded={load} onCancel={() => setDecisionMakerFor(null)} />
            </div>
          </div>
        </div>
      )}

      {snoozedContacts.length > 0 && (
        <div className="card padded-lg" style={{ marginTop: 12, opacity: 0.85 }}>
          <div className="card-head" style={{ marginBottom: 10 }}>
            <span className="card-title">💤 Snoozed ({snoozedContacts.length})</span>
            <span className="card-meta mono">hidden until their date (clock still running)</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {snoozedContacts.map(it => (
              <div key={`snz-${it.source || 'app'}-${it.id}`} className="action-card" style={{ borderColor: 'rgba(113,113,122,0.25)' }}>
                <div className="action-card-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SourcePill source={it.source} />
                      <span className="mono dim" style={{ fontSize: 10.5 }}>#{String(it.id).padStart(3, '0')}</span>
                      <span className="action-card-co">{it.company}</span>
                      <FUStatusPill status={it.status} />
                    </div>
                    <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                      Snoozed until {it.snoozeUntil}{it.daysSinceLastTouch != null ? ` · ${it.daysSinceLastTouch}d since last touch` : ''}
                    </div>
                  </div>
                  <button className="btn ghost sm" title="Bring this alert back now" onClick={() => unsnooze(it)}>↩ Un-snooze</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {selected != null && selectedApp && window.PipelineDrawer && (
        <window.PipelineDrawer
          app={selectedApp}
          onClose={() => setSelected(null)}
          onAction={fuOnAction}
          onStatusChange={fuOnStatusChange}
          isStale={() => true}
          onFollowupChange={() => { load(); setSelected(null); }}
        />
      )}
      </div>
    </div>
  );
};

function SourcePill({ source }) {
  const isTA = source === 'ta';
  const bg = isTA ? 'rgba(34,211,238,0.16)' : 'rgba(167,139,250,0.16)';
  const fg = isTA ? '#22d3ee' : '#a78bfa';
  const label = isTA ? 'TA' : 'App';
  return (
    <span className="mono" style={{
      background: bg, color: fg, padding: '2px 6px', borderRadius: 4,
      fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

// (Removed) The Pipeline "Awaiting response" subtab and its AwaitingResponseView
// lived here. It duplicated the Follow-Ups stale feed filtered to applications and
// added no distinct value, so it was retired. FollowupRow below is still shared by
// the Follow-Ups tab.

function FollowupRow({ item, onOpen, onSnooze, onMute, onUnmute, onFind }) {
  const coachStyle = COACH_COLOR[item.coachLevel] || COACH_COLOR.overdue;
  const isTA = item.source === 'ta';
  const subtitle = isTA
    ? `${item.taFirst || ''} ${item.taLast || ''}${item.role ? ` · ${item.role}` : ''}`.trim()
    : item.role;
  return (
    <div className="action-card" onClick={onOpen} style={{ borderColor: item.coachLevel === 'give-up' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)', cursor: 'pointer' }}>
      <div className="action-card-row">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SourcePill source={item.source} />
            <span className="mono dim" style={{ fontSize: 10.5 }}>#{String(item.id).padStart(3, '0')}</span>
            <span className="action-card-co">{item.company}</span>
            <FUStatusPill status={item.status} />
            {!isTA && item.channel && <ChannelBadge channel={item.channel} />}
            {item.muted && <span className="mono" style={{ background: 'rgba(113,113,122,0.18)', color: '#a1a1aa', padding: '2px 6px', borderRadius: 4, fontSize: 10.5, fontWeight: 700 }}>AWAITING</span>}
            <CoachPill level={item.coachLevel} />
            {item.fuCount > 0 && (
              <span className="mono dim" style={{ fontSize: 10.5 }}>· {item.fuCount} prior touch{item.fuCount === 1 ? '' : 'es'}</span>
            )}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 3 }}>{subtitle}</div>
          <div className="mono" style={{ fontSize: 11, marginTop: 4, color: coachStyle.color }}>
            {item.coachVerdict}
          </div>
        </div>
        <div className="row" style={{ gap: 8, alignItems: 'center' }}>
          {!isTA && <window.ScoreChip score={item.score} />}
          <span className="sit-badge" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', minWidth: 42, textAlign: 'center' }}>{item.daysSinceLastTouch}d</span>
          {onFind && (
            <button className="btn ghost sm" title="Find a TA contact at this company (one lookup, low usage)"
              onClick={(e) => { e.stopPropagation(); onFind(); }}>Find contacts</button>
          )}
          {onSnooze && (
            <button className="btn ghost sm" title="Snooze this alert for 14 days (doesn't reset your follow-up clock)"
              onClick={(e) => { e.stopPropagation(); onSnooze(); }}>💤 14d</button>
          )}
          {onMute && (
            <button className="btn ghost sm" title="Done for now / awaiting reply. Keeps the app Applied, stops the nag (no expiry)."
              onClick={(e) => { e.stopPropagation(); onMute(); }}>Done for now</button>
          )}
          {onUnmute && (
            <button className="btn ghost sm" title="Bring this back into the queue"
              onClick={(e) => { e.stopPropagation(); onUnmute(); }}>↩ Un-mute</button>
          )}
        </div>
      </div>
    </div>
  );
}

// Drawer for an individual follow-up — shows full context, the touch log,
// the Claude-draft button, and the action buttons.
// Reusable follow-up action panel — the coach verdict, related-TA cross-log
// selector, Draft follow-up, Log touch (+ modal), and the touch history. Used
// as the Pipeline drawer's "Follow-up" tab (window.FollowupPanel) so Follow-Ups
// and Pipeline share one implementation. Resilient when the app isn't stale:
// coach is hidden, but logging a touch and the history still work.
// Per-contact "follow up on my last sent email" composer, shown under each
// related TA contact in the Follow-Ups drawer. Self-contained: it lazily loads
// the contact's correspondence to show the last email that went unanswered,
// asks the server to draft a nudge from it (mode: 'followup-sent'), and hands
// the editable result to the shared Gmail-draft button. Mirrors the TA Outreach
// drawer's flow so both surfaces behave identically.
function TaFollowupComposer({ ta }) {
  const [open, setOpen] = useStateF(false);
  const [lastSent, setLastSent] = useStateF(null);   // message | false (none) | null (unloaded)
  const [loadingCorr, setLoadingCorr] = useStateF(false);
  const [drafting, setDrafting] = useStateF(false);
  const [draft, setDraft] = useStateF(null);
  const [email, setEmail] = useStateF('');
  const [err, setErr] = useStateF(null);

  // Lazily fetch correspondence on first open — the /by-company payload that
  // feeds this list does not include messages, so pull the full contact to find
  // the last thing we sent.
  useEffectF(() => {
    if (!open || lastSent !== null || loadingCorr) return;
    setLoadingCorr(true);
    fetch(`/api/target-talent/${ta.id}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        const corr = (d && d.correspondence) || [];
        let s = false;
        for (let i = corr.length - 1; i >= 0; i--) { if (corr[i].direction === 'Sent') { s = corr[i]; break; } }
        setLastSent(s);
        setLoadingCorr(false);
      })
      .catch(() => { setLastSent(false); setLoadingCorr(false); });
  }, [open]);

  const generate = () => {
    setDrafting(true); setErr(null); setDraft(null);
    window.tjkMutate(`/api/target-talent/${ta.id}/draft`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'followup-sent' }),
    })
      .then(r => r.json())
      .then(d => {
        setDrafting(false);
        if (d.draft) {
          setDraft(d.draft);
          setEmail(`Hi ${ta.first || 'there'},\n\n${(d.draft.body || '').replace(/^\s+/, '')}\n\n${window.myEmailSignature()}`);
        } else { setErr(d.error || 'Draft failed'); }
      })
      .catch(e => { setDrafting(false); setErr(e.message); });
  };

  if (!open) {
    return (
      <div style={{ padding: '2px 10px 8px' }}>
        <button className="btn ghost sm" onClick={() => setOpen(true)}
          title="Draft a short follow-up built on the last email you sent this contact">
          ✦ Follow up on last sent
        </button>
      </div>
    );
  }

  return (
    <div className="ai-compose" style={{ margin: '0 0 8px' }}>
      <div className="ai-head">✦ Follow-up · from your last sent email
        <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>Close</button>
      </div>

      {loadingCorr && <div className="ai-loading"><span className="scan-ring" style={{ width: 14, height: 14, borderWidth: 2 }} /> loading thread…</div>}
      {lastSent === false && !loadingCorr && (
        <div className="dim mono" style={{ fontSize: 11, padding: '4px 2px' }}>
          No sent email logged for this contact yet, so there is nothing to follow up on. Log a sent message on their TA Outreach card first.
        </div>
      )}
      {lastSent && typeof lastSent === 'object' && (
        <div className="dim mono" style={{ fontSize: 10.5, padding: '2px 2px 6px' }}>
          Following up on: <strong>{lastSent.subject || '(no subject)'}</strong>{lastSent.timestamp ? ` · sent ${lastSent.timestamp}` : ''}
        </div>
      )}

      {lastSent && (
        <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: draft ? 8 : 0 }}>
          <button className="btn primary sm" onClick={generate} disabled={drafting}>
            {drafting ? '✦ Drafting…' : draft ? '✦ Regenerate' : '✦ Draft follow-up'}
          </button>
        </div>
      )}
      {err && <div className="dim mono" style={{ fontSize: 11, color: 'var(--red, #e66)', padding: '4px 2px' }}>{err}</div>}

      {draft && (
        <>
          <div className="row" style={{ gap: 8, alignItems: 'center', margin: '6px 0' }}>
            <span className="mono dim" style={{ fontSize: 11 }}>Subject</span>
            <input className="inp" style={{ flex: 1 }} value={draft.subject || ''} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
          </div>
          <textarea className="ta" aria-label="Editable follow-up draft"
            style={{ width: '100%', minHeight: 130, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
            value={email} onChange={e => setEmail(e.target.value)} />
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
            <window.GmailDraftBtn to={ta.email} subject={draft.subject} body={email} />
            <button className="btn ghost sm" onClick={() => navigator.clipboard?.writeText(`Subject: ${draft.subject}\n\n${email}`)}>Copy</button>
          </div>
        </>
      )}
    </div>
  );
}

window.FollowupPanel = function FollowupPanel({ app, onUpdate }) {
  const appId = app.id;
  const [item, setItem] = useStateF(null);        // stale coach data (may be null)
  const [touches, setTouches] = useStateF([]);    // this app's follow-up rows
  const [drafting, setDrafting] = useStateF(false);
  const [draft, setDraft] = useStateF(null);
  const [logModal, setLogModal] = useStateF(null);
  const [relatedTalent, setRelatedTalent] = useStateF([]);
  const [crossLogIds, setCrossLogIds] = useStateF(new Set());

  const load = () => {
    fetch('/api/followups/stale')
      .then(r => r.json())
      .then(d => {
        const pool = [...(d.warm || []), ...(d.cold || []), ...(d.items || [])];
        setItem(pool.find(x => x.id === appId && (x.source || 'app') === 'app') || null);
      })
      .catch(() => {});
    // Touch history works even when the app isn't stale.
    fetch('/api/followups')
      .then(r => r.ok ? r.json() : [])
      .then(rows => setTouches((rows || []).filter(f => f.appNum === appId).sort((a, b) => (b.date || '').localeCompare(a.date || ''))))
      .catch(() => setTouches([]));
    if (app.company) {
      fetch(`/api/target-talent/by-company/${encodeURIComponent(app.company)}`)
        .then(r => r.ok ? r.json() : [])
        .then(ta => { setRelatedTalent(ta || []); setCrossLogIds(new Set((ta || []).map(t => t.id))); })
        .catch(() => setRelatedTalent([]));
    }
  };
  useEffectF(() => { load(); }, [appId]);

  const toggleCrossLog = (id) => {
    setCrossLogIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const generateDraft = () => {
    setDrafting(true);
    setDraft(null);
    window.tjkMutate(`/api/followups/${appId}/draft`, { method: 'POST' })
      .then(r => r.json())
      .then(d => { setDrafting(false); if (d.draft) setDraft(d.draft); else alert(d.error || 'Draft failed'); })
      .catch(err => { setDrafting(false); alert(err.message); });
  };

  const logTouch = (payload) => {
    const taIds = Array.from(crossLogIds);
    window.tjkMutate('/api/followups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appNum: appId,
        ...payload,
        alsoLogToTalentIds: taIds,
        alsoLogSubject: payload.subject || undefined,
        alsoLogBody: payload.body || undefined,
      }),
    })
      .then(r => r.json())
      .then((resp) => {
        if (resp && resp.error) { alert(`Save failed: ${resp.error}`); return; }
        // Touch logged → no longer stale. Refresh locally, then let the host
        // react (Follow-Ups reloads the queue and closes the drawer).
        setLogModal(null);
        setDraft(null);
        load();
        onUpdate?.();
      })
      .catch(err => alert(`Save failed: ${err.message}`));
  };

  const copyToClipboard = (text) => navigator.clipboard?.writeText(text);
  const applyDate = item?.applyDate || app.date;
  const fuCount = touches.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Coach verdict — only when this app is currently stale */}
      {item && (
        <div className="cs-section">
          <div className="cs-section-head"><span>Coach</span><CoachPill level={item.coachLevel} /></div>
          <div className="coach" style={{ margin: 0 }}>
            <span style={{ color: (COACH_COLOR[item.coachLevel] || COACH_COLOR.overdue).color, fontWeight: 700 }}>{item.coachVerdict}</span>
            {item.fuCount > 0 && (
              <div className="dim mono" style={{ marginTop: 4, fontSize: 11 }}>
                Cap for {item.status}: {item.cap} follow-up{item.cap === 1 ? '' : 's'}. You've used {item.fuCount}.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Related TA Outreach contacts (cross-log targets) */}
      {relatedTalent.length > 0 && (
        <div className="cs-section">
          <div className="cs-section-head">
            <span>Related TA contacts at {app.company}</span>
            <span className="mono dim">{crossLogIds.size}/{relatedTalent.length} selected</span>
          </div>
          <div className="dim mono" style={{ fontSize: 10.5, marginBottom: 8 }}>
            Selected contacts also get this touch logged on their TA Outreach correspondence (prevents double-entry).
          </div>
          <div className="col" style={{ gap: 6 }}>
            {relatedTalent.map(ta => {
              const checked = crossLogIds.has(ta.id);
              return (
                <div key={ta.id}
                  style={{
                    background: 'var(--panel)', borderRadius: 4,
                    borderLeft: `3px solid ${checked ? 'var(--green)' : 'var(--text-mute)'}`,
                  }}>
                  <label
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 10px', cursor: 'pointer',
                    }}>
                    <input type="checkbox" checked={checked} onChange={() => toggleCrossLog(ta.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{ta.first} {ta.last}</div>
                      <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{ta.title}</div>
                      {ta.linkedin && (
                        <a href={window.safeHref(ta.linkedin)} target="_blank" rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          className="mono"
                          style={{ fontSize: 10.5, color: 'var(--accent)' }}>LinkedIn ↗</a>
                      )}
                    </div>
                    <span className="mono dim" style={{ fontSize: 10.5 }}>
                      {ta.status || 'Not Contacted'}{ta.lastTouch ? ` · ${ta.lastTouch}` : ''}
                    </span>
                  </label>
                  <TaFollowupComposer ta={ta} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="cs-section">
        <div className="cs-section-head"><span>Take Action</span></div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={generateDraft} disabled={drafting}>
            {drafting ? '✦ Drafting…' : '✦ Draft follow-up'}
          </button>
          <button className="btn" onClick={() => setLogModal({ channel: 'Email', contact: '', notes: '' })}>
            Log touch (manual)
          </button>
        </div>

        {draft && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--panel)', border: '1px solid var(--accent)', borderRadius: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>✦ DRAFT</span>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn ghost sm" onClick={() => copyToClipboard(`Subject: ${draft.subject}\n\n${draft.body}\n\n${window.mySignoff()}`)}>Copy</button>
                <button className="btn ghost sm" onClick={() => setDraft(null)}>Dismiss</button>
              </div>
            </div>
            <div className="row" style={{ gap: 8, alignItems: 'center', marginBottom: 6 }}>
              <span className="mono dim" style={{ fontSize: 11 }}>Subject</span>
              <input className="inp" style={{ flex: 1 }} value={draft.subject || ''} onChange={e => setDraft({ ...draft, subject: e.target.value })} />
            </div>
            <textarea className="ta" aria-label="Editable follow-up draft" style={{ width: '100%', minHeight: 130, resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
              value={draft.body || ''} onChange={e => setDraft({ ...draft, body: e.target.value })} />
            <div className="mono dim" style={{ fontSize: 10.5, marginTop: 4 }}>Your sign-off is added automatically: {window.mySignoff()}</div>
            <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn primary sm" onClick={() => logTouch({
                channel: 'Email',
                notes: `Sent follow-up. Subject: ${draft.subject}`,
                subject: draft.subject,
                body: draft.body,
              })}>
                I sent this. Log touch{crossLogIds.size > 0 && ` + ${crossLogIds.size} TA`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Touch history */}
      <div className="cs-section">
        <div className="cs-section-head"><span>Touch History</span>
          <span className="mono dim">{fuCount} touch{fuCount === 1 ? '' : 'es'} + 1 initial application</span>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div style={{ padding: 10, background: 'var(--panel)', borderRadius: 4, borderLeft: '3px solid var(--accent)' }}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>APPLIED</span>
              <span className="mono dim" style={{ fontSize: 10.5 }}>{applyDate}</span>
            </div>
            <div className="dim" style={{ fontSize: 11 }}>{app.notes || '(no notes)'}</div>
          </div>
          {fuCount === 0 ? (
            <div className="dim mono" style={{ fontSize: 10.5, fontStyle: 'italic', padding: '4px 0' }}>No follow-ups logged yet.</div>
          ) : (
            touches.map((f, i) => (
              <div key={i} style={{ padding: 10, background: 'var(--panel)', borderRadius: 4, borderLeft: '3px solid #22d3ee' }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
                  <span className="mono" style={{ fontSize: 11, color: '#22d3ee', fontWeight: 700 }}>{(f.channel || 'TOUCH').toUpperCase()}</span>
                  <span className="mono dim" style={{ fontSize: 10.5 }}>{f.date}</span>
                </div>
                <div style={{ fontSize: 11 }}>{f.notes || <span className="dim">(no notes)</span>}</div>
                {f.contact && <div className="dim mono" style={{ fontSize: 10.5, marginTop: 3 }}>Contact: {f.contact}</div>}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Log touch modal */}
      {logModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setLogModal(null)}>
          <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, maxWidth: 520, width: '100%' }} onClick={e => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 14px', fontSize: 15 }}>Log a touch for {app.company}</h3>
            <div className="col" style={{ gap: 10 }}>
              <div>
                <label className="dim mono" style={{ fontSize: 10.5 }}>CHANNEL</label>
                <select value={logModal.channel} onChange={e => setLogModal({ ...logModal, channel: e.target.value })}
                  style={{ width: '100%', padding: 8, marginTop: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12 }}>
                  {FU_CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="dim mono" style={{ fontSize: 10.5 }}>CONTACT (optional)</label>
                <input type="text" aria-label="Contact name or email" placeholder="Name or email"
                  value={logModal.contact} onChange={e => setLogModal({ ...logModal, contact: e.target.value })}
                  style={{ width: '100%', padding: 8, marginTop: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12 }} />
              </div>
              <div>
                <label className="dim mono" style={{ fontSize: 10.5 }}>NOTES</label>
                <textarea aria-label="Follow-up context" placeholder="What did you send / what's the context?"
                  value={logModal.notes} onChange={e => setLogModal({ ...logModal, notes: e.target.value })}
                  rows={4}
                  style={{ width: '100%', padding: 8, marginTop: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12, fontFamily: 'inherit', resize: 'vertical' }} />
              </div>
            </div>
            {relatedTalent.length > 0 && (
              <div style={{ marginTop: 12, padding: 8, background: 'var(--panel)', borderRadius: 4, fontSize: 11 }}>
                <span className="dim mono" style={{ fontSize: 10.5 }}>CROSS-LOG</span>
                <div style={{ marginTop: 4 }}>
                  {crossLogIds.size === 0
                    ? <>No related TA contacts selected. This touch will only log to Follow-Ups.</>
                    : <>Also logging to <span className="mono" style={{ color: 'var(--green)' }}>{crossLogIds.size}</span> TA contact{crossLogIds.size === 1 ? '' : 's'}: {relatedTalent.filter(t => crossLogIds.has(t.id)).map(t => `${t.first} ${t.last}`).join(', ')}. (Edit selection above before saving.)</>}
                </div>
              </div>
            )}
            <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setLogModal(null)}>Cancel</button>
              <button className="btn primary" onClick={() => logTouch(logModal)}>
                Save touch{crossLogIds.size > 0 && ` + ${crossLogIds.size} TA`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
