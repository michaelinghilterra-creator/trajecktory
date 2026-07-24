// Follow-Ups Tab — Stale Applications Action Queue
// Dedicated page for the highest-leverage daily action: timing follow-ups
// for Applied / Responded / Interview entries that have gone quiet.
// Each row carries coach intelligence from the cadence rules (server-side)
// so you see at a glance whether a touch is overdue, due now, or whether
// it's time to give up entirely.

const { useState: useStateF, useEffect: useEffectF, useMemo: useMemoF } = React;

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
      padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{s.label}</span>
  );
}

function FUStatusPill({ status }) {
  const s = STATUS_COLOR[status] || { bg: 'rgba(113,113,122,0.14)', color: '#a1a1aa' };
  return (
    <span className="mono" style={{
      background: s.bg, color: s.color,
      padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
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
      padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 600, whiteSpace: 'nowrap',
    }}>{m.label}</span>
  );
}

// Bucket by days since last touch. Tiered thresholds (Applied 10d, Responded
// 5d, Interview 3d) mean items can arrive on this list well under 14d, so the
// buckets start at 0d and step up from there.
function ageBucket(days) {
  if (days >= 45) return { key: '45d+',  label: '45d+: likely ghosted',         color: '#ef4444' };
  if (days >= 21) return { key: '21-45d', label: '21-45d: write-off candidates', color: '#f59e0b' };
  if (days >= 10) return { key: '10-21d', label: '10-21d: aging, push hard',     color: '#a78bfa' };
  return                  { key: '0-10d', label: '0-10d: fresh stale, due now',   color: '#60a5fa' };
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
      <div className="row" style={{ justifyContent: 'space-between', fontSize: 11.5 }}>
        <span style={{ color }}>{label}</span>
        <span className="mono dim">{n} · {pct}%</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
    </div>
  );
}

function FUOverview({ items, thresholds, taThreshold, sourceCounts, statusCounts, bucketCounts, giveUpCount, onOpen, onJumpSubview }) {
  const parseScore = (s) => {
    if (typeof s === 'number') return s;
    const m = String(s || '').match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : null;
  };

  const total = items.length;
  const appItems = items.filter(it => (it.source || 'app') === 'app');
  const taItems  = items.filter(it => it.source === 'ta');

  const interviewStale = items.filter(it => window.isInterviewStage(it.status)).length;
  const highLeverage   = appItems.filter(it => (parseScore(it.score) ?? 0) >= 4.0).length;
  const avgSilence     = total > 0 ? Math.round(items.reduce((s, it) => s + (it.daysSinceLastTouch || 0), 0) / total) : 0;

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
    return (
      <div className="card" style={{ padding: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>You're all caught up.</div>
        <div className="dim" style={{ fontSize: 12 }}>
          Nothing inside the touch window has gone stale. New rows surface here when an Applied/Responded/interview-round entry
          crosses {thresholds?.Applied || 10}/{thresholds?.Responded || 5}/{thresholds?.['1st Interview'] || 3}d, or a TA contact crosses {taThreshold || 14}d.
        </div>
      </div>
    );
  }

  // KPI tones — coaching not alarm
  const staleTone     = total > 15 ? 'warn' : 'neutral';
  const criticalTone  = interviewStale > 0 ? 'danger' : giveUpCount > 0 ? 'warn' : 'good';
  const leverageTone  = highLeverage > 0 ? 'accent' : 'neutral';
  const silenceTone   = avgSilence >= 21 ? 'warn' : 'neutral';

  const criticalLabel = interviewStale > 0 ? `${interviewStale} interview` : giveUpCount > 0 ? `${giveUpCount} write-off` : 'Nothing critical';
  const criticalValue = interviewStale > 0 ? interviewStale : giveUpCount;

  // Visual data
  const ageOrder = ['0-10d', '10-21d', '21-45d', '45d+'];
  const ageColor = { '0-10d': '#60a5fa', '10-21d': '#a78bfa', '21-45d': '#f59e0b', '45d+': '#ef4444' };
  const statusOrder = [...window.INTERVIEW_STAGES, 'Responded', 'Applied', 'Sent', 'Replied', 'Meeting Scheduled'];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>Follow-Ups</h1>
          <div className="sub">{total} stale touchpoints · {sourceCounts.app} app · {sourceCounts.ta} TA · {giveUpCount} ready to write off</div>
        </div>
      </div>

      {/* KPI row */}
      <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
        <FUKpi label="Stale touchpoints" value={total} sub={`${sourceCounts.app} app · ${sourceCounts.ta} TA. Work the list, oldest first`} tone={staleTone} />
        <FUKpi label="Critical" value={criticalValue} sub={interviewStale > 0
          ? 'Interview silence. Nudge same-day or lose momentum'
          : giveUpCount > 0 ? `${criticalLabel} ready. Close cleanly and move on` : 'No high-urgency items right now'} tone={criticalTone} />
        <FUKpi label="High leverage" value={highLeverage} sub={highLeverage > 0
          ? 'Score ≥ 4.0 going cold. Prioritize the strongest fits'
          : 'No strong-fit apps in the stale list. Good'} tone={leverageTone} />
        <FUKpi label="Avg silence" value={`${avgSilence}d`} sub={avgSilence >= 21
          ? 'Queue is aging. Clear the 21d+ bucket before adding new apps'
          : 'Healthy. Staying inside the response window'} tone={silenceTone} />
      </div>

      {/* Three visuals */}
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

        <div className="card" style={{ padding: 14, flex: 1, minWidth: 240 }}>
          <div className="mono dim" style={{ fontSize: 10.5, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>By Source</div>
          <div className="col" style={{ gap: 10 }}>
            <FUBarRow label="Apps" n={sourceCounts.app} total={total} color="#a78bfa" />
            <FUBarRow label="TA Outreach" n={sourceCounts.ta} total={total} color="#22d3ee" />
          </div>
          <div className="mono dim" style={{ fontSize: 11, marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
            {sourceCounts.app > sourceCounts.ta * 4
              ? 'Mostly app silence. Your TA pipeline is keeping up.'
              : sourceCounts.ta > sourceCounts.app
                ? 'TA contacts are slipping. Warm them before they go cold.'
                : 'Balanced. Alternate App nudges with TA touchpoints.'}
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
            {window.INTERVIEW_STAGES.reduce((n, s) => n + (statusCounts[s] || 0), 0) > 0
              ? 'Interview rows first. They convert at the highest rate.'
              : (statusCounts['Responded'] || 0) > 0
                ? 'Responded rows next. Momentum is fragile, keep it.'
                : 'Applied bucket only. Straightforward nudge cycle.'}
          </div>
        </div>
      </div>

      {/* Needs Attention — same row layout as Pipeline → Overview */}
      <div className="card padded-lg">
        <div className="card-head">
          <span className="card-title"><span className="dot" />Needs Attention</span>
          <span className="card-meta mono">{orderedActions.length} items</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {orderedActions.length === 0 && <div className="no-data" style={{ padding: '8px 0' }}>You're caught up. Nothing urgent.</div>}
          {orderedActions.map(it => {
            const isTA = it.source === 'ta';
            const sc = parseScore(it.score);
            const isInt = window.isInterviewStage(it.status);
            const iconPath = isInt ? window.ICON.briefcase : isTA ? window.ICON.users : window.ICON.send;
            const color = isInt ? 'var(--orange)' : (sc != null && sc >= 4.0) ? 'var(--accent)' : 'var(--red)';
            const label = `Follow up · ${it.daysSinceLastTouch}d silent`;
            return (
              <div key={`${it.source || 'app'}-${it.id}`} onClick={() => onOpen(it)}
                style={{ display: 'grid', gridTemplateColumns: '28px 1fr auto auto', gap: 12, alignItems: 'center',
                  padding: '9px 11px', borderRadius: 9, cursor: 'pointer',
                  background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
                <span style={{ width: 28, height: 28, borderRadius: 7, display: 'grid', placeItems: 'center',
                  background: 'var(--panel)', border: '1px solid var(--border)', color }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPath} /></svg>
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.company}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: 'var(--text-mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {it.role || `${it.taFirst || ''} ${it.taLast || ''}`.trim() || '—'}
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

window.FollowupsTab = function FollowupsTab({ onAction, openTaContact, search, apps = [], toast }) {
  const [data, setData]       = useStateF({ thresholds: { Applied: 7, Responded: 5, 'Phone Screen': 3, '1st Interview': 3, '2nd Interview': 3, '3rd Interview': 3, '4th Interview': 3 }, taThreshold: 14, ghostDays: 45, warm: [], cold: [], snoozed: [], ghostedCandidates: [] });
  const [loading, setLoading] = useStateF(true);
  const [selected, setSelected] = useStateF(null); // app id (only for 'app' source rows)
  const [statusFilter, setStatusFilter] = useStateF([]);
  const [bucketFilter, setBucketFilter] = useStateF([]);
  const [sourceFilter, setSourceFilter] = useStateF([]); // 'app' | 'ta'
  const [coldFilter, setColdFilter] = useStateF('all');  // 'all' | 'none' | 'awaiting'
  const [findFor, setFindFor] = useStateF(null);         // { company, role } for the Find-contacts modal
  // Subview: 'overview' (KPIs), 'warm' (the urgent queue + nav badge), 'cold'
  // ("Applications out": cold portal apps that should not nag daily).
  const [subView, setSubView] = useStateF('warm');

  const load = () => {
    setLoading(true);
    fetch('/api/followups/stale')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };
  useEffectF(() => { load(); }, []);

  const warm = data.warm || [];
  const cold = data.cold || [];
  const ghosted = data.ghostedCandidates || [];

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

  const toggleStatus = (s) => setStatusFilter(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  const toggleBucket = (b) => setBucketFilter(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);

  const SUBTABS = [
    { id: 'overview', label: 'Overview',         n: null,        icon: window.ICON.pulse },
    { id: 'connect',  label: 'Connect',          n: null,        icon: window.ICON.userPlus },
    { id: 'warm',     label: 'Warm threads',     n: warm.length, icon: window.ICON.send },
    { id: 'cold',     label: 'Applications out',  n: cold.length, icon: window.ICON.briefcase },
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
      {/* Subtabs */}
      <div className="subtabs">
        {SUBTABS.map(s => (
          <div key={s.id} className={'subtab' + (subView === s.id ? ' active' : '')} onClick={() => setSubView(s.id)}>
            <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={s.icon} /></svg>
            </span>
            {s.label}
            {s.n != null && <span className="mono dim" style={{ marginLeft: 6, fontSize: 10.5 }}>{s.n}</span>}
          </div>
        ))}
      </div>

      <div className="col" style={{ gap: 14, paddingTop: 14 }}>

      {subView === 'overview' && (
        <FUOverview
          items={warm}
          thresholds={data.thresholds}
          taThreshold={data.taThreshold}
          sourceCounts={sourceCounts}
          statusCounts={statusCounts}
          bucketCounts={bucketCounts}
          giveUpCount={giveUpCount}
          coldCount={cold.length}
          onOpen={openFromOverview}
          onJumpSubview={setSubView}
        />
      )}

      {/* ── Connect: the by-hand LinkedIn queue (moved here from the sidebar) ── */}
      {subView === 'connect' && <window.ConnectTab toast={toast} />}

      {/* ── Warm threads: the actionable queue ─────────────────────────────── */}
      {subView === 'warm' && (
        <>
      <div className="ta-head">
        <div>
          <h1>Warm threads</h1>
          <div className="sub">
            {warm.length === 0
              ? <>No warm threads right now. A reply, an interview, or a contact who engaged shows up here.</>
              : <>{warm.length} warm {warm.length === 1 ? 'thread' : 'threads'} worth a nudge · thresholds App {data.thresholds?.Applied || 7}/{data.thresholds?.Responded || 5}/{data.thresholds?.['1st Interview'] || 3}d · TA {data.taThreshold || 14}d</>}
          </div>
        </div>
        <div className="act">
          <button className="btn sm" onClick={load} title="Reload">⟳ Refresh</button>
        </div>
      </div>

      {warm.length === 0 && !loading && (
        <div className="card" style={{ padding: 18 }}>
          <div className="dim" style={{ fontSize: 12 }}>
            Nothing warm is going cold. Warm threads are replies, interviews, contacts who engaged, and Applied roles where
            you have a usable email. Cold portal applications live under <b>Applications out</b> ({cold.length}) so they don't nag.
          </div>
        </div>
      )}

      {warm.length > 0 && (
        <>
          <div className="card" style={{ padding: '10px 14px' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {sourceCounts.app > 0 && sourceCounts.ta > 0 && (
                <>
                  <span className="dim mono" style={{ fontSize: 10.5, marginRight: 4 }}>SOURCE</span>
                  {[['app', sourceCounts.app, '#a78bfa', 'rgba(167,139,250,0.14)', 'App'], ['ta', sourceCounts.ta, '#22d3ee', 'rgba(34,211,238,0.14)', 'TA']].map(([s, n, fg, bg, label]) => {
                    const active = sourceFilter.includes(s);
                    return (
                      <span key={s} onClick={() => toggleSource(s)} style={{
                        cursor: 'pointer', padding: '4px 10px', borderRadius: 4,
                        background: active ? fg : bg, color: active ? '#0a0a0c' : fg,
                        fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace',
                        border: `1px solid ${active ? fg : 'transparent'}`,
                      }}>{label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span></span>
                    );
                  })}
                  <span className="dim mono" style={{ fontSize: 10.5, marginLeft: 14, marginRight: 4 }}>STATUS</span>
                </>
              )}
              {!(sourceCounts.app > 0 && sourceCounts.ta > 0) && (
                <span className="dim mono" style={{ fontSize: 10.5, marginRight: 4 }}>STATUS</span>
              )}
              {Object.entries(statusCounts).map(([s, n]) => {
                const style = STATUS_COLOR[s] || { bg: 'rgba(113,113,122,0.14)', color: '#a1a1aa' };
                const active = statusFilter.includes(s);
                return (
                  <span key={s} onClick={() => toggleStatus(s)} style={{
                    cursor: 'pointer', padding: '4px 10px', borderRadius: 4,
                    background: active ? style.color : style.bg, color: active ? '#0a0a0c' : style.color,
                    fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace',
                    border: `1px solid ${active ? style.color : 'transparent'}`,
                  }}>{s} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span></span>
                );
              })}
              <span className="dim mono" style={{ fontSize: 10.5, marginLeft: 14, marginRight: 4 }}>AGE</span>
              {Object.entries(bucketCounts).map(([b, n]) => {
                const active = bucketFilter.includes(b);
                return (
                  <span key={b} onClick={() => toggleBucket(b)} style={{
                    cursor: 'pointer', padding: '4px 10px', borderRadius: 4,
                    background: active ? '#a78bfa' : 'rgba(167,139,250,0.14)',
                    color: active ? '#0a0a0c' : '#a78bfa',
                    fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace',
                    border: `1px solid ${active ? '#a78bfa' : 'transparent'}`,
                  }}>{b} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span></span>
                );
              })}
              {(statusFilter.length > 0 || bucketFilter.length > 0 || sourceFilter.length > 0) && (
                <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setStatusFilter([]); setBucketFilter([]); setSourceFilter([]); }}>Clear filters</button>
              )}
            </div>
          </div>

          {grouped.map(group => (
            <div key={group.key} className="card padded-lg">
              <div className="card-head" style={{ marginBottom: 10 }}>
                <span className="card-title">{group.label}</span>
                <span className="card-meta mono">{group.items.length} entr{group.items.length === 1 ? 'y' : 'ies'}</span>
              </div>
              <div className="col" style={{ gap: 6 }}>
                {group.items.map(it => (
                  <FollowupRow key={`${it.source || 'app'}-${it.id}`} item={it}
                    onSnooze={() => snooze(it, 14)}
                    onMute={it.source !== 'ta' ? () => mute(it) : null}
                    onOpen={() => openItem(it)} />
                ))}
              </div>
            </div>
          ))}

          {filtered.length === 0 && (statusFilter.length > 0 || bucketFilter.length > 0 || sourceFilter.length > 0) && (
            <div className="no-data">No matches. <button className="btn ghost sm" onClick={() => { setStatusFilter([]); setBucketFilter([]); setSourceFilter([]); }}>Clear filters</button></div>
          )}
        </>
      )}
        </>
      )}

      {/* ── Applications out: cold ledger, no daily nag ────────────────────── */}
      {subView === 'cold' && (
        <>
      <div className="ta-head">
        <div>
          <h1>Applications out</h1>
          <div className="sub">
            {cold.length === 0
              ? <>No cold applications waiting. Nice.</>
              : <>{cold.length} application{cold.length === 1 ? '' : 's'} out with no usable contact or muted · {coldNoContact} no contact · {coldMuted} awaiting</>}
          </div>
        </div>
        <div className="act">
          <button className="btn sm" onClick={load} title="Reload">⟳ Refresh</button>
        </div>
      </div>

      {/* Ghosted auto-age suggestion */}
      {ghosted.length > 0 && (
        <div className="card" style={{ padding: '12px 14px', borderLeft: '3px solid #ef4444' }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{ghosted.length} application{ghosted.length === 1 ? '' : 's'} have had no response in {data.ghostDays || 45}+ days</div>
              <div className="dim mono" style={{ fontSize: 11, marginTop: 3 }}>Archive to "No Response" to clear the backlog honestly. They still count as applications-with-no-reply in analytics.</div>
              {/* Rows with no recorded apply date fall back to the tracker Date column,
                  which is the EVALUATION date and runs days early on self-sourced rows.
                  This button bulk-writes status, so say which ones are estimates. */}
              {ghosted.some(g => g.estimated) && (
                <div className="mono" style={{ fontSize: 11, marginTop: 4, color: 'var(--amber, #fbbf24)' }}>
                  {ghosted.filter(g => g.estimated).length} of these are estimated from the evaluation date, not a recorded apply date, so their age may run early.
                </div>
              )}
            </div>
            <button className="btn primary sm" onClick={() => archiveGhosted(ghosted.map(g => g.id))}>
              Archive {ghosted.length} → No Response
            </button>
          </div>
        </div>
      )}

      {cold.length > 0 && (
        <>
          <div className="card" style={{ padding: '10px 14px' }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="dim mono" style={{ fontSize: 10.5, marginRight: 4 }}>SHOW</span>
              {[['all', 'All', cold.length], ['none', 'No contact', coldNoContact], ['awaiting', 'Awaiting', coldMuted]].map(([id, label, n]) => {
                const active = coldFilter === id;
                return (
                  <span key={id} onClick={() => setColdFilter(id)} style={{
                    cursor: 'pointer', padding: '4px 10px', borderRadius: 4,
                    background: active ? '#a78bfa' : 'rgba(167,139,250,0.14)',
                    color: active ? '#0a0a0c' : '#a78bfa',
                    fontSize: 11, fontWeight: 600, fontFamily: 'JetBrains Mono, monospace',
                    border: `1px solid ${active ? '#a78bfa' : 'transparent'}`,
                  }}>{label} <span style={{ opacity: 0.7, marginLeft: 4 }}>{n}</span></span>
                );
              })}
            </div>
          </div>

          <div className="card padded-lg">
            <div className="card-head" style={{ marginBottom: 10 }}>
              <span className="card-title">Applications out</span>
              <span className="card-meta mono">{coldFiltered.length} shown</span>
            </div>
            <div className="col" style={{ gap: 6 }}>
              {coldFiltered.map(it => (
                <FollowupRow key={`cold-${it.id}`} item={it}
                  onOpen={() => openItem(it)}
                  onMute={it.muted ? null : () => mute(it)}
                  onUnmute={it.muted ? () => unmute(it) : null}
                  onFind={it.channel === 'none' ? () => setFindFor({ company: it.company, role: it.role }) : null} />
              ))}
              {coldFiltered.length === 0 && <div className="no-data" style={{ padding: '8px 0' }}>Nothing here.</div>}
            </div>
          </div>
        </>
      )}
        </>
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

      {data.snoozed && data.snoozed.length > 0 && (
        <div className="card padded-lg" style={{ marginTop: 12, opacity: 0.85 }}>
          <div className="card-head" style={{ marginBottom: 10 }}>
            <span className="card-title">💤 Snoozed ({data.snoozed.length})</span>
            <span className="card-meta mono">hidden until their date (clock still running)</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            {data.snoozed.map(it => (
              <div key={`snz-${it.source || 'app'}-${it.id}`} className="action-card" style={{ borderColor: 'rgba(113,113,122,0.25)' }}>
                <div className="action-card-row">
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SourcePill source={it.source} />
                      <span className="mono dim" style={{ fontSize: 10 }}>#{String(it.id).padStart(3, '0')}</span>
                      <span className="action-card-co">{it.company}</span>
                      <FUStatusPill status={it.status} />
                    </div>
                    <div className="mono dim" style={{ fontSize: 11, marginTop: 4 }}>
                      Snoozed until {it.snoozeUntil} · {it.daysSinceLastTouch}d since last touch
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
      background: bg, color: fg, padding: '2px 7px', borderRadius: 4,
      fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
    }}>{label}</span>
  );
}

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
            <span className="mono dim" style={{ fontSize: 10 }}>#{String(item.id).padStart(3, '0')}</span>
            <span className="action-card-co">{item.company}</span>
            <FUStatusPill status={item.status} />
            {!isTA && item.channel && <ChannelBadge channel={item.channel} />}
            {item.muted && <span className="mono" style={{ background: 'rgba(113,113,122,0.18)', color: '#a1a1aa', padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>AWAITING</span>}
            <CoachPill level={item.coachLevel} />
            {item.fuCount > 0 && (
              <span className="mono dim" style={{ fontSize: 10 }}>· {item.fuCount} prior touch{item.fuCount === 1 ? '' : 'es'}</span>
            )}
          </div>
          <div className="dim" style={{ fontSize: 11.5, marginTop: 3 }}>{subtitle}</div>
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
                <label key={ta.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '8px 10px', background: 'var(--panel)',
                    borderRadius: 4, cursor: 'pointer',
                    borderLeft: `3px solid ${checked ? 'var(--green)' : 'var(--text-mute)'}`,
                  }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleCrossLog(ta.id)} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>{ta.first} {ta.last}</div>
                    <div className="dim" style={{ fontSize: 11, marginTop: 2 }}>{ta.title}</div>
                    {ta.linkedin && (
                      <a href={ta.linkedin} target="_blank" rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="mono"
                        style={{ fontSize: 10, color: 'var(--accent)' }}>LinkedIn ↗</a>
                    )}
                  </div>
                  <span className="mono dim" style={{ fontSize: 10 }}>
                    {ta.status || 'Not Contacted'}{ta.lastTouch ? ` · ${ta.lastTouch}` : ''}
                  </span>
                </label>
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
            <div style={{ fontSize: 12, marginBottom: 4 }}><b>Subject:</b> {draft.subject}</div>
            <div style={{ fontSize: 12, marginTop: 8, padding: 8, background: 'var(--bg)', borderRadius: 4, whiteSpace: 'pre-wrap' }}>
              {draft.body}{'\n\n'}{window.mySignoff()}
            </div>
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
              <span className="mono dim" style={{ fontSize: 10 }}>{applyDate}</span>
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
                  <span className="mono dim" style={{ fontSize: 10 }}>{f.date}</span>
                </div>
                <div style={{ fontSize: 11.5 }}>{f.notes || <span className="dim">(no notes)</span>}</div>
                {f.contact && <div className="dim mono" style={{ fontSize: 10, marginTop: 3 }}>Contact: {f.contact}</div>}
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
                <input type="text" placeholder="Name or email"
                  value={logModal.contact} onChange={e => setLogModal({ ...logModal, contact: e.target.value })}
                  style={{ width: '100%', padding: 8, marginTop: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontSize: 12 }} />
              </div>
              <div>
                <label className="dim mono" style={{ fontSize: 10.5 }}>NOTES</label>
                <textarea placeholder="What did you send / what's the context?"
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
