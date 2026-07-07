// Today tab — daily cadence + pomodoro timer + streak + to-do list.
// One glanceable surface for "what do I do right now", so the day's plan stops
// getting pushed aside. Two subtabs: Today (the daily view) and Schedule (the
// weekly cadence editor). Persists via /api/cadence* and /api/todos.
const { useState: useStateF, useEffect: useEffectF, useMemo: useMemoF, useRef: useRefF } = React;

// ── Day-of-week (Mon=1 … Sun=7, matching the server) ──────────────────────────
const DOW_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_PRESETS = [
  { id: 'mwf', label: 'Mon/Wed/Fri', days: [1, 3, 5] },
  { id: 'tt', label: 'Tue/Thu', days: [2, 4] },
  { id: 'wd', label: 'Weekdays', days: [1, 2, 3, 4, 5] },
  { id: 'daily', label: 'Every day', days: [1, 2, 3, 4, 5, 6, 7] },
];

// ── Local-date helpers (mirror server/lib/cadence.mjs) ────────────────────────
function ymdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayLocal() { return ymdLocal(new Date()); }

function addMinutes(hhmm, mins) {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number);
  const total = (h * 60 + m + mins);
  const hh = Math.floor(total / 60) % 24;
  const mm = ((total % 60) + 60) % 60;
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
function fmtClock(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

// ── Completion cues: a WebAudio chime + an optional desktop notification ───────
// The AudioContext is created lazily on the first Start click (a user gesture),
// then reused so it can still play minutes later when an interval ends.
let _audioCtx = null;
function playChime(times = 2) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!_audioCtx) _audioCtx = new AC();
    if (_audioCtx.state === 'suspended') _audioCtx.resume();
    const ctx = _audioCtx;
    let t = ctx.currentTime;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(t); o.stop(t + 0.32);
      t += 0.4;
    }
  } catch { /* audio is a nicety — never let it throw */ }
}
function notify(title, body) {
  try {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    new Notification(title, { body, silent: true });
  } catch { /* ignore */ }
}

// Self-healing mutating fetch. Alias to the single global implementation in
// data.js (window.tjkMutate): on a 403 from a rotated auth token it re-issues the
// token cookie and retries once, so saves survive a server restart without a
// reload. See the block comment on window.tjkMutate for the full rationale.
const mutate = (url, options) => window.tjkMutate(url, options);

// ── Preferences (sound / notify) persisted in localStorage ────────────────────
const PREFS_KEY = 'trj.focusPrefs';
function loadPrefs() {
  try { return { sound: true, notify: true, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return { sound: true, notify: true }; }
}
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ } }

// ── Running-timer persistence (survives a mid-pomodoro reload) ────────────────
const TIMER_KEY = 'trj.focusTimer';
function loadTimerSession() { try { return JSON.parse(localStorage.getItem(TIMER_KEY) || 'null'); } catch { return null; } }
function saveTimerSession(s) { try { s ? localStorage.setItem(TIMER_KEY, JSON.stringify(s)) : localStorage.removeItem(TIMER_KEY); } catch { /* ignore */ } }

// ════════════════════════════════════════════════════════════════════════════
// FocusTimer — one active task's pomodoro. Counts down the task's own block
// length, then a short break (a long break every 4th pomodoro). Stores endsAt as
// an absolute timestamp and derives the remaining time each tick, so it stays
// honest across background tabs and reloads.
// ════════════════════════════════════════════════════════════════════════════
function FocusTimer({ task, prefs, onPomodoroComplete, onExit, restore }) {
  const workLen = Math.max(1, task.durationMin || 25) * 60000;

  const init = (restore && restore.taskId === task.id) ? restore : null;
  const [phase, setPhase] = useStateF(init ? init.phase : 'work');       // 'work' | 'break'
  const [running, setRunning] = useStateF(init ? init.running : true);
  const [endsAt, setEndsAt] = useStateF(init ? init.endsAt : (Date.now() + workLen));
  const [pausedRemaining, setPausedRemaining] = useStateF(init ? (init.pausedRemaining || 0) : 0);
  const [breakLong, setBreakLong] = useStateF(init ? !!init.breakLong : false);
  const [sessionPomos, setSessionPomos] = useStateF(init ? (init.sessionPomos || 0) : 0);
  const [nowTs, setNowTs] = useStateF(Date.now());

  // Keep the latest tick logic in a ref so the 1 interval always sees fresh state.
  const tickRef = useRefF(() => {});
  tickRef.current = () => {
    const now = Date.now();
    if (running && endsAt && now >= endsAt) handleEnd(now);
    else setNowTs(now);
  };
  useEffectF(() => {
    if (!running) return undefined;
    const iv = setInterval(() => tickRef.current(), 500);
    return () => clearInterval(iv);
  }, [running]);

  // Persist the session so a reload resumes instead of resetting.
  useEffectF(() => {
    saveTimerSession({ taskId: task.id, phase, running, endsAt, pausedRemaining, breakLong, sessionPomos });
  }, [task.id, phase, running, endsAt, pausedRemaining, breakLong, sessionPomos]);

  function handleEnd(now) {
    if (phase === 'work') {
      const n = sessionPomos + 1;
      setSessionPomos(n);
      if (prefs.sound) playChime(2);
      notify('Focus block done ✓', `${task.label} — time for a break.`);
      onPomodoroComplete(task);
      const isLong = n % 4 === 0;
      setBreakLong(isLong);
      setPhase('break');
      setEndsAt(now + (isLong ? 15 : 5) * 60000);
      setNowTs(now);
    } else {
      if (prefs.sound) playChime(1);
      notify('Break over', `Back to: ${task.label}`);
      setPhase('work');
      setEndsAt(now + workLen);
      setNowTs(now);
    }
  }

  const remaining = running ? Math.max(0, endsAt - nowTs) : pausedRemaining;
  const totalLen = phase === 'work' ? workLen : (breakLong ? 15 : 5) * 60000;
  const pct = Math.max(0, Math.min(100, Math.round((1 - remaining / totalLen) * 100)));

  const pause = () => { setPausedRemaining(Math.max(0, endsAt - Date.now())); setRunning(false); };
  const resume = () => { setEndsAt(Date.now() + pausedRemaining); setRunning(true); setNowTs(Date.now()); };
  const skip = () => handleEnd(Date.now());
  const stop = () => { saveTimerSession(null); onExit(); };

  return (
    <div className={'focus-timer ' + phase}>
      <div className="focus-timer-top">
        <span className={'pill ' + (phase === 'work' ? 'accent' : 'green')} style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {phase === 'work' ? 'Focusing' : (breakLong ? 'Long break' : 'Break')}
        </span>
        <span className="focus-timer-task">{task.label}</span>
      </div>
      <div className="pomo-timer mono">{fmtClock(remaining)}</div>
      <div className="pomo-bar"><i style={{ width: pct + '%' }} /></div>
      <div className="focus-timer-ctl">
        {running
          ? <button className="btn sm" onClick={pause}>Pause</button>
          : <button className="btn primary sm" onClick={resume}>Resume</button>}
        <button className="btn ghost sm" onClick={skip} title="Skip to the end of this interval">Skip</button>
        <button className="btn ghost sm" onClick={stop} title="Stop and close the timer">Stop</button>
        {task.pomodoros ? (
          <span className="mono dim" style={{ marginLeft: 'auto', fontSize: 11 }}>
            session · {sessionPomos}{task.pomodoros ? ` / ${task.pomodoros}` : ''} 🍅
          </span>
        ) : null}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Streak strip
// ════════════════════════════════════════════════════════════════════════════
function StreakStrip({ streak }) {
  if (!streak) return null;
  return (
    <div className="card streak-card">
      <div className="row" style={{ gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
        <div className="kpi" style={{ padding: 0, background: 'none', border: 'none' }}>
          <span className="kpi-label">Current streak</span>
          <span className="kpi-value" style={{ fontSize: 22 }}>{streak.current}<span className="dim" style={{ fontSize: 12, marginLeft: 4 }}>day{streak.current === 1 ? '' : 's'}</span></span>
        </div>
        <div className="kpi" style={{ padding: 0, background: 'none', border: 'none' }}>
          <span className="kpi-label">Best</span>
          <span className="kpi-value" style={{ fontSize: 22 }}>{streak.best}</span>
        </div>
        <div className="streak-dots" title="Last 7 days">
          {(streak.last7 || []).map((d) => {
            const color = d.rest ? 'var(--border-2)'
              : d.pct >= 100 ? 'var(--green)'
              : d.pct > 0 ? 'var(--orange)'
              : 'var(--border-2)';
            const label = d.date.slice(5) + (d.rest ? ' · rest' : ` · ${d.pct}%`);
            return <span key={d.date} className="streak-dot" title={label} style={{ background: color, opacity: d.rest ? 0.4 : 1 }} />;
          })}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Today view — cadence tasks for the current weekday + the active timer
// ════════════════════════════════════════════════════════════════════════════
function TodayView({ today, streak, prefs, setPrefs, activeTaskId, setActiveTaskId, onToggleDone, onPomodoroComplete, restoreRef }) {
  const activeTask = today.find(t => t.id === activeTaskId) || null;
  const remaining = today.filter(t => !t.done).length;
  const weekday = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const start = (t) => {
    // Request notification permission on the first Start (a user gesture) — never on load.
    if (prefs.notify && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try { Notification.requestPermission(); } catch { /* ignore */ }
    }
    if (prefs.sound) playChime(0); // no tone, just unlock the AudioContext during the gesture
    restoreRef.current = null; // a fresh manual start ignores any stale saved session
    setActiveTaskId(t.id);
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Today</h1>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>
            {weekday} · {remaining ? `${remaining} of ${today.length} block${today.length === 1 ? '' : 's'} left` : (today.length ? 'all blocks done ✓' : 'no blocks scheduled')}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className={'btn ghost sm' + (prefs.sound ? ' on' : '')} onClick={() => setPrefs(p => ({ ...p, sound: !p.sound }))} title="Chime when a block ends">
            {prefs.sound ? '🔊' : '🔇'} sound
          </button>
          <button className={'btn ghost sm' + (prefs.notify ? ' on' : '')} onClick={() => setPrefs(p => ({ ...p, notify: !p.notify }))} title="Desktop notification when a block ends">
            🔔 notify
          </button>
        </div>
      </div>

      <StreakStrip streak={streak} />

      {activeTask && (
        <FocusTimer
          key={activeTask.id}
          task={activeTask}
          prefs={prefs}
          restore={restoreRef.current}
          onPomodoroComplete={onPomodoroComplete}
          onExit={() => setActiveTaskId(null)}
        />
      )}

      {today.length === 0 ? (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Nothing scheduled for {DOW_SHORT[new Date().getDay() || 7]} 🌤</div>
          <div className="dim" style={{ fontSize: 12 }}>Enjoy the day, or open <strong>Schedule</strong> above to add or adjust your weekly cadence.</div>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          {today.map(t => {
            const isActive = t.id === activeTaskId;
            return (
              <div key={t.id} className={'focus-task' + (isActive ? ' active' : '') + (t.done ? ' done' : '')}>
                <button className={'focus-check' + (t.done ? ' checked' : '')} onClick={() => onToggleDone(t)} title={t.done ? 'Mark not done' : 'Mark done'}>
                  {t.done ? '✓' : ''}
                </button>
                <div className="focus-task-main">
                  <div className="focus-task-time mono">{t.start}–{addMinutes(t.start, t.durationMin)}</div>
                  <div className="focus-task-label">{t.label}</div>
                  {t.notes ? <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{t.notes}</div> : null}
                  {t.pomodoros ? (
                    <div className="pomo-dots">
                      {Array.from({ length: t.pomodoros }).map((_, i) => (
                        <span key={i} className={'pomo-dot' + (i < t.pomodorosDone ? ' on' : '')} />
                      ))}
                      <span className="mono dim" style={{ fontSize: 10.5, marginLeft: 4 }}>{t.pomodorosDone}/{t.pomodoros}</span>
                    </div>
                  ) : null}
                </div>
                <div className="focus-task-actions">
                  {isActive
                    ? <span className="pill accent" style={{ fontSize: 10.5 }}>active</span>
                    : <button className="btn accent sm" onClick={() => start(t)} disabled={t.done}>▶ Start</button>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Schedule editor — the weekly cadence template
// ════════════════════════════════════════════════════════════════════════════
function ScheduleEditor({ template, onSave, saving }) {
  const [rows, setRows] = useStateF(() => (template ? template.tasks.map(t => ({ ...t })) : []));
  const [showArchived, setShowArchived] = useStateF(false);
  const [dragIndex, setDragIndex] = useStateF(null);   // index (within active rows) being dragged
  const [overIndex, setOverIndex] = useStateF(null);   // index currently hovered as a drop target
  // Re-seed the editable copy when the saved template changes (e.g. after a save
  // that assigned ids, or first load).
  useEffectF(() => { setRows(template ? template.tasks.map(t => ({ ...t })) : []); }, [template]);

  // Move an active row from one position to another and renumber `order` so the
  // manual arrangement persists. Archived rows keep their place at the end.
  const reorderActive = (from, to) => {
    if (from == null || to == null || from === to) return;
    setRows(rs => {
      const act = rs.filter(r => !r.archived);
      const arch = rs.filter(r => r.archived);
      if (from < 0 || from >= act.length || to < 0 || to >= act.length) return rs;
      const moved = act.splice(from, 1)[0];
      act.splice(to, 0, moved);
      return [...act.map((r, i) => ({ ...r, order: i })), ...arch];
    });
  };

  const dirty = useMemoF(() => JSON.stringify(rows) !== JSON.stringify(template ? template.tasks : []), [rows, template]);

  const patch = (id, key, val) => setRows(rs => rs.map(r => r.id === id ? { ...r, [key]: val } : r));
  const toggleDay = (id, d) => setRows(rs => rs.map(r => {
    if (r.id !== id) return r;
    const has = (r.days || []).includes(d);
    return { ...r, days: has ? r.days.filter(x => x !== d) : [...r.days, d].sort() };
  }));
  const setPreset = (id, days) => setRows(rs => rs.map(r => r.id === id ? { ...r, days: [...days] } : r));
  const addRow = () => setRows(rs => [...rs, {
    // Provisional key only; must NOT start with 't_' so the server assigns a real
    // id on save (saveTemplate keeps ids that already look real).
    id: 'new_' + Math.random().toString(36).slice(2, 8),
    label: '', days: [1, 3, 5], start: '09:00', durationMin: 50, pomodoros: 2, notes: '', order: rs.length, archived: false,
  }]);
  const archive = (id, on) => setRows(rs => rs.map(r => r.id === id ? { ...r, archived: on } : r));

  const active = rows.filter(r => !r.archived);
  const archived = rows.filter(r => r.archived);

  const rowEditor = (r, i) => (
    <div
      key={r.id}
      className={'sched-row' + (dragIndex === i ? ' dragging' : '') + (overIndex === i && dragIndex !== i ? ' dragover' : '')}
      onDragOver={(e) => { if (dragIndex != null) { e.preventDefault(); if (overIndex !== i) setOverIndex(i); } }}
      onDrop={(e) => { e.preventDefault(); reorderActive(dragIndex, i); setDragIndex(null); setOverIndex(null); }}
      onDragLeave={() => { if (overIndex === i) setOverIndex(null); }}
    >
      <span
        className="sched-drag"
        draggable
        onDragStart={(e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* Firefox needs data set */ } }}
        onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
        title="Drag to reorder"
      >⠿</span>
      <input className="sched-input label" placeholder="Task name (e.g. Deep work block)" value={r.label} onChange={e => patch(r.id, 'label', e.target.value)} />
      <div className="sched-days">
        {DAY_PRESETS.map(p => (
          <button key={p.id} type="button" className="chip preset" title={p.label} onClick={() => setPreset(r.id, p.days)}>{p.label.split('/')[0] === p.label ? p.label : p.id.toUpperCase()}</button>
        ))}
        <span className="sched-day-toggles">
          {[1, 2, 3, 4, 5, 6, 7].map(d => (
            <button key={d} type="button" className={'chip day' + ((r.days || []).includes(d) ? ' on' : '')} onClick={() => toggleDay(r.id, d)}>{DOW_SHORT[d][0]}</button>
          ))}
        </span>
      </div>
      <div className="sched-nums">
        <label className="sched-num"><span className="dim">at</span><input type="time" value={r.start} onChange={e => patch(r.id, 'start', e.target.value)} /></label>
        <label className="sched-num"><span className="dim">for</span><input type="number" min="1" max="240" value={r.durationMin} onChange={e => patch(r.id, 'durationMin', parseInt(e.target.value, 10) || 0)} /><span className="dim">min</span></label>
        <label className="sched-num" title="How many pomodoro focus sessions to aim for in this block"><input type="number" min="0" max="12" value={r.pomodoros} onChange={e => patch(r.id, 'pomodoros', parseInt(e.target.value, 10) || 0)} /><span className="dim">🍅 pomodoros</span></label>
        <button className="btn ghost sm" title="Archive (keeps history, drops from Today)" onClick={() => archive(r.id, true)}>Archive</button>
      </div>
    </div>
  );

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Weekly schedule</h1>
          <div className="dim mono" style={{ fontSize: 11, marginTop: 2 }}>Your recurring cadence: for each block pick the days, a start time, its length in minutes, and how many pomodoro focus sessions (🍅) to aim for.</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {dirty ? <button className="btn ghost sm" onClick={() => setRows(template ? template.tasks.map(t => ({ ...t })) : [])}>Discard</button> : null}
          <button className="btn primary sm" disabled={!dirty || saving} onClick={() => onSave(rows)}>{saving ? 'Saving…' : 'Save schedule'}</button>
        </div>
      </div>

      <div className="col" style={{ gap: 8 }}>
        {active.length === 0 ? (
          <div className="card" style={{ padding: 16 }}>
            <div className="dim" style={{ fontSize: 12 }}>No tasks yet. Add your first block below.</div>
          </div>
        ) : active.map((r, i) => rowEditor(r, i))}
        <button className="btn sm" style={{ alignSelf: 'flex-start' }} onClick={addRow}>+ Add block</button>
      </div>

      {archived.length > 0 && (
        <div className="col" style={{ gap: 8 }}>
          <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowArchived(s => !s)}>
            {showArchived ? '▾' : '▸'} Archived ({archived.length})
          </button>
          {showArchived && archived.map(r => (
            <div key={r.id} className="sched-row archived">
              <span className="focus-task-label" style={{ opacity: 0.6 }}>{r.label || '(untitled)'}</span>
              <span className="dim mono" style={{ fontSize: 11 }}>{(r.days || []).map(d => DOW_SHORT[d]).join(' ')} · {r.start}</span>
              <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => archive(r.id, false)}>Restore</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// To-do list
// ════════════════════════════════════════════════════════════════════════════
const TODO_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'today', label: 'Today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];
const PRIO_META = {
  high: { color: 'var(--red)', label: 'High' },
  med: { color: 'var(--accent)', label: 'Med' },
  low: { color: 'var(--text-mute)', label: 'Low' },
};
const PRIO_ORDER = { high: 0, med: 1, low: 2 };

function isOverdue(t, tdy) { return !t.done && t.dueDate && t.dueDate < tdy; }

// Expandable details for one to-do. Local draft, saved on blur so we don't PATCH
// on every keystroke. Re-syncs if the underlying todo changes.
function TodoNotes({ todo, onSave }) {
  const [text, setText] = useStateF(todo.notes || '');
  useEffectF(() => { setText(todo.notes || ''); }, [todo.id]);
  return (
    <div className="todo-notes-wrap">
      <textarea
        className="todo-notes"
        placeholder="Add details, links, next steps…"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={() => { if ((text || '') !== (todo.notes || '')) onSave(text); }}
      />
    </div>
  );
}

function TodoList({ todos, onCreate, onPatch, onDelete }) {
  const [draft, setDraft] = useStateF('');
  const [prio, setPrio] = useStateF('med');
  const [due, setDue] = useStateF('');
  const [filter, setFilter] = useStateF('open');
  const [expandedId, setExpandedId] = useStateF(null);
  const tdy = todayLocal();

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onCreate({ text, priority: prio, dueDate: due || null });
    setDraft(''); setDue(''); setPrio('med');
  };

  const shown = useMemoF(() => {
    const pass = (t) => {
      if (filter === 'open') return !t.done;
      if (filter === 'done') return t.done;
      if (filter === 'overdue') return isOverdue(t, tdy);
      if (filter === 'today') return !t.done && (t.dueDate === tdy || isOverdue(t, tdy));
      return true; // all
    };
    return todos.filter(pass).sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const ao = isOverdue(a, tdy) ? 0 : 1, bo = isOverdue(b, tdy) ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ap = PRIO_ORDER[a.priority] ?? 1, bp = PRIO_ORDER[b.priority] ?? 1;
      if (ap !== bp) return ap - bp;
      return (a.order || 0) - (b.order || 0);
    });
  }, [todos, filter, tdy]);

  const openCount = todos.filter(t => !t.done).length;

  return (
    <div className="card todo-card">
      <div className="card-head">
        <span className="card-title">To-do list</span>
        <span className="card-meta mono">{openCount} open</span>
      </div>

      <div className="todo-add">
        <input
          className="todo-add-input"
          placeholder="Add a to-do and press Enter…"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }}
        />
        <select className="todo-add-prio" value={prio} onChange={e => setPrio(e.target.value)} title="Priority">
          <option value="high">High</option>
          <option value="med">Med</option>
          <option value="low">Low</option>
        </select>
        <input className="todo-add-due" type="date" value={due} onChange={e => setDue(e.target.value)} title="Due date (optional)" />
        <button className="btn primary sm" onClick={add} disabled={!draft.trim()}>Add</button>
      </div>

      <div className="filterbar" style={{ marginTop: 10, marginBottom: 8 }}>
        {TODO_FILTERS.map(f => (
          <span key={f.id} className={'chip' + (filter === f.id ? ' on' : '')} onClick={() => setFilter(f.id)}>{f.label}</span>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="dim" style={{ fontSize: 12, padding: '8px 2px' }}>
          {filter === 'open' ? 'No open to-dos. Add one above, or check your cadence.' : 'Nothing here.'}
        </div>
      ) : (
        <div className="col" style={{ gap: 6 }}>
          {shown.map(t => {
            const overdue = isOverdue(t, tdy);
            const pm = PRIO_META[t.priority] || PRIO_META.med;
            const isOpen = expandedId === t.id;
            const hasNotes = !!(t.notes && t.notes.trim());
            const toggle = () => setExpandedId(x => x === t.id ? null : t.id);
            return (
              <div key={t.id} className="todo-item">
                <div className={'todo-row' + (t.done ? ' done' : '')}>
                  <button className={'focus-check' + (t.done ? ' checked' : '')} onClick={() => onPatch(t.id, { done: !t.done })}>
                    {t.done ? '✓' : ''}
                  </button>
                  <div className="todo-row-main" onClick={toggle} style={{ cursor: 'pointer' }}>
                    <span className="todo-text">{t.text}</span>
                    <div className="todo-meta">
                      <span className="todo-prio" style={{ color: pm.color }}>● {pm.label}</span>
                      {t.company ? <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{t.company}</span> : null}
                      {t.dueDate ? <span className="todo-due mono" style={{ color: overdue ? 'var(--red)' : 'var(--text-dim)' }}>{overdue ? 'overdue · ' : 'due '}{t.dueDate.slice(5)}</span> : null}
                      {hasNotes && !isOpen ? <span className="todo-has-notes" title="Has details">📝</span> : null}
                    </div>
                  </div>
                  <button className="todo-disclosure" title={isOpen ? 'Hide details' : 'Add / show details'} onClick={toggle}>{isOpen ? '▾' : '▸'}</button>
                  <button className="todo-del" title="Delete" onClick={() => onDelete(t.id)}>✕</button>
                </div>
                {isOpen ? <TodoNotes todo={t} onSave={(notes) => onPatch(t.id, { notes })} /> : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// FocusTab — shell, data loading, subtab routing
// ════════════════════════════════════════════════════════════════════════════
const FOCUS_SUBTABS = [
  { id: 'today', label: 'Today' },
  { id: 'schedule', label: 'Schedule' },
];

window.FocusTab = function FocusTab({ toast, onFocusDataChanged }) {
  const [sub, setSub] = useStateF('today');
  const [today, setToday] = useStateF([]);
  const [template, setTemplate] = useStateF(null);
  const [streak, setStreak] = useStateF(null);
  const [todos, setTodos] = useStateF([]);
  const [saving, setSaving] = useStateF(false);
  const [activeTaskId, setActiveTaskId] = useStateF(null);
  const [prefs, setPrefsState] = useStateF(loadPrefs());
  const restoreRef = useRefF(loadTimerSession());
  const restoredOnce = useRefF(false);

  const setPrefs = (updater) => setPrefsState(p => { const next = typeof updater === 'function' ? updater(p) : updater; savePrefs(next); return next; });

  const notifyBadge = () => { if (onFocusDataChanged) onFocusDataChanged(); };

  const loadToday = () => fetch('/api/cadence/today').then(r => r.json()).then(d => setToday(Array.isArray(d) ? d : [])).catch(() => {});
  const loadTemplate = () => fetch('/api/cadence').then(r => r.json()).then(setTemplate).catch(() => {});
  const loadStreak = () => fetch('/api/cadence/streak').then(r => r.json()).then(setStreak).catch(() => {});
  const loadTodos = () => fetch('/api/todos').then(r => r.json()).then(d => setTodos(Array.isArray(d.todos) ? d.todos : [])).catch(() => {});

  useEffectF(() => { loadToday(); loadTemplate(); loadStreak(); loadTodos(); }, []);

  // Resume a running timer after a reload: once today's tasks are loaded, if a
  // saved session points at a task scheduled today, re-arm it.
  useEffectF(() => {
    if (restoredOnce.current) return;
    const s = restoreRef.current;
    if (s && s.taskId && today.some(t => t.id === s.taskId)) {
      restoredOnce.current = true;
      setActiveTaskId(s.taskId);
    } else if (today.length) {
      restoredOnce.current = true; // nothing to restore; don't keep re-checking
    }
  }, [today]);

  const toggleDone = (t) => {
    const next = !t.done;
    setToday(ts => ts.map(x => x.id === t.id ? { ...x, done: next } : x)); // optimistic
    mutate('/api/cadence/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, done: next }) })
      .then(r => { if (!r.ok) throw new Error(); })
      .then(() => { loadStreak(); notifyBadge(); })
      .catch(() => { setToday(ts => ts.map(x => x.id === t.id ? { ...x, done: t.done } : x)); toast && toast('Could not save — is the server running?', 'warn'); });
  };

  const onPomodoroComplete = (t) => {
    const nextCount = (t.pomodorosDone || 0) + 1;
    setToday(ts => ts.map(x => x.id === t.id ? { ...x, pomodorosDone: nextCount } : x)); // optimistic
    mutate('/api/cadence/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: t.id, pomodorosDone: nextCount }) })
      .then(() => loadToday())
      .catch(() => {});
    toast && toast(`🍅 Focus block done — ${t.label}`, 'success');
  };

  const saveSchedule = (rows) => {
    setSaving(true);
    mutate('/api/cadence', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks: rows }) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(tpl => { setTemplate(tpl); loadToday(); loadStreak(); notifyBadge(); toast && toast('Schedule saved', 'success'); })
      .catch((status) => toast && toast(status === 403 ? 'Save blocked — reload the page and try again' : 'Save failed', 'warn'))
      .finally(() => setSaving(false));
  };

  const createTodo = (body) => {
    mutate('/api/todos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(() => { loadTodos(); notifyBadge(); })
      .catch((status) => toast && toast(status === 403 ? 'Blocked — reload the page and try again' : 'Could not add to-do', 'warn'));
  };
  const patchTodo = (id, patch) => {
    setTodos(ts => ts.map(t => t.id === id ? { ...t, ...patch } : t)); // optimistic
    mutate(`/api/todos/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(() => { loadTodos(); notifyBadge(); })
      .catch(() => { loadTodos(); });
  };
  const deleteTodo = (id) => {
    setTodos(ts => ts.filter(t => t.id !== id)); // optimistic
    mutate(`/api/todos/${id}`, { method: 'DELETE' })
      .then(() => notifyBadge())
      .catch(() => loadTodos());
  };

  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {FOCUS_SUBTABS.map(s => (
          <div key={s.id} className={'subtab' + (sub === s.id ? ' active' : '')} onClick={() => setSub(s.id)}>{s.label}</div>
        ))}
      </div>

      {sub === 'today' && (
        <div className="col" style={{ gap: 14 }}>
          <TodayView
            today={today}
            streak={streak}
            prefs={prefs}
            setPrefs={setPrefs}
            activeTaskId={activeTaskId}
            setActiveTaskId={setActiveTaskId}
            onToggleDone={toggleDone}
            onPomodoroComplete={onPomodoroComplete}
            restoreRef={restoreRef}
          />
          <TodoList todos={todos} onCreate={createTodo} onPatch={patchTodo} onDelete={deleteTodo} />
        </div>
      )}

      {sub === 'schedule' && (
        <ScheduleEditor template={template} onSave={saveSchedule} saving={saving} />
      )}
    </div>
  );
};
