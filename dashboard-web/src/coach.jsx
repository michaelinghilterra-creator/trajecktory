// AI Coach — an in-app sherpa. A warm, SMS-style chat that knows how trajecktory
// works and the user's live state, so it answers "what do I do next", "where is X",
// and "I got a rejection" with the right next step (and a one-tap Confirm for the
// few actions it can take). Runs on the Claude plan. Shared by a full-page tab and
// a floating panel. Persists history server-side (data/coach-conversations.json).
const { useState: useStateCo, useEffect: useEffectCo, useRef: useRefCo } = React;

// Scenario-based quick starts. Clicking one sends it, so the user's message lands
// in the chat and the Coach answers immediately — the fastest way in for someone
// who doesn't know what to ask.
const COACH_PROMPTS = [
  'What should I do today?',
  'I applied for a role — what do I do next?',
  'How do I find new jobs?',
  'My TA contact list is empty — how do I add people?',
  'How do I reach out to someone on LinkedIn?',
  'I got a rejection — what now?',
  'Walk me through the daily workflow',
];

function coachDay(ts) {
  try { const d = new Date(ts); return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

function CoachMessage({ m, onAct, acting, actedLabel }) {
  const isUser = m.role === 'user';
  const done = actedLabel && m.action && actedLabel === m.action.label;
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
      <div style={{ maxWidth: '82%' }}>
        <div style={{
          padding: '8px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
          background: isUser ? 'var(--accent)' : 'var(--panel-2)',
          color: isUser ? '#fff' : 'var(--text)',
          border: isUser ? 'none' : '1px solid var(--border)',
          borderBottomRightRadius: isUser ? 3 : 12, borderBottomLeftRadius: isUser ? 12 : 3,
        }}>
          {m.text}
        </div>
        {m.action && !isUser && (
          <div style={{ marginTop: 6 }}>
            {done
              ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Done</span>
              : <button className="btn primary sm" disabled={acting} onClick={() => onAct(m.action)}
                  title="The Coach only proposes — this runs it. You can undo from the relevant tab.">
                  {acting ? 'Working…' : `✓ ${m.action.label}`}
                </button>}
          </div>
        )}
      </div>
    </div>
  );
}

function CoachChat({ toast, compact }) {
  const [messages, setMessages] = useStateCo(null);
  const [brief, setBrief] = useStateCo(null);
  const [input, setInput] = useStateCo('');
  const [sending, setSending] = useStateCo(false);
  const [acting, setActing] = useStateCo(false);
  const [actedLabel, setActedLabel] = useStateCo(null);
  // The side "Quick starts" rail only fits when there's room; below this it would
  // squeeze the chat, so we fall back to inline starter bubbles instead.
  const [wide, setWide] = useStateCo(typeof window !== 'undefined' ? window.innerWidth >= 900 : true);
  const scrollRef = useRefCo(null);

  useEffectCo(() => {
    const onResize = () => setWide(window.innerWidth >= 900);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const scrollDown = () => { requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }); };

  useEffectCo(() => {
    fetch('/api/coach/history').then(r => r.json())
      .then(d => { setMessages(d.messages || []); scrollDown(); })
      .catch(() => setMessages([]));
    fetch('/api/coach/brief').then(r => r.json())
      .then(d => { if (d && d.brief) setBrief(d.brief); })
      .catch(() => {});
  }, []);

  const send = (textArg) => {
    const text = (textArg != null ? textArg : input).trim();
    if (!text || sending) return;
    setInput('');
    const optimistic = { id: 'tmp_' + Date.now(), role: 'user', text, ts: new Date().toISOString() };
    setMessages(m => [...(m || []), optimistic]); scrollDown();
    setSending(true);
    window.tjkMutate('/api/coach/message', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setSending(false); return; }
        setMessages(m => [...(m || []), { id: res.reply.id, role: 'coach', text: res.reply.text, action: res.reply.action, ts: res.reply.ts }]);
        scrollDown();
      })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setSending(false));
  };

  const act = (action) => {
    if (acting) return;
    setActing(true);
    window.tjkMutate('/api/coach/act', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        setActedLabel(action.label);
        setMessages(m => [...(m || []), { id: 'act_' + Date.now(), role: 'coach', text: `✓ ${res.message}`, ts: new Date().toISOString() }]);
        toast && toast(res.message, 'success');
        scrollDown();
      })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setActing(false));
  };

  const showPrompts = messages && messages.length === 0;

  // Group messages with day dividers.
  const rows = [];
  let lastDay = null;
  for (const m of (messages || [])) {
    const day = coachDay(m.ts);
    if (day && day !== lastDay) { rows.push({ divider: day, key: 'd_' + day + m.id }); lastDay = day; }
    rows.push({ m, key: m.id });
  }

  const starters = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
      {COACH_PROMPTS.map(p => (
        <button key={p} className="btn ghost sm" onClick={() => send(p)} disabled={sending}
          style={{ textAlign: 'left', whiteSpace: 'normal', height: 'auto', lineHeight: 1.35, padding: '8px 10px' }}>{p}</button>
      ))}
    </div>
  );

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: compact ? '12px 14px' : '18px 22px', minHeight: 0 }}>
        {brief && (
          <div className="card" style={{ marginBottom: 14, background: 'color-mix(in srgb, var(--accent) 8%, var(--panel))', border: '1px solid color-mix(in srgb, var(--accent) 30%, var(--border))' }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.5px', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 5 }}>Today</div>
            <div style={{ fontSize: 13.5, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{brief}</div>
          </div>
        )}
        {messages === null && <div className="dim" style={{ padding: 20, fontSize: 13 }}>Loading…</div>}
        {rows.map(r => r.divider
          ? <div key={r.key} style={{ textAlign: 'center', margin: '10px 0', fontSize: 10.5, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{r.divider}</div>
          : <CoachMessage key={r.key} m={r.m} onAct={act} acting={acting} actedLabel={actedLabel} />)}
        {sending && <div className="dim" style={{ fontSize: 12, fontStyle: 'italic', padding: '2px 4px' }}>Coach is thinking…</div>}
        {(compact || !wide) && showPrompts && (
          <div style={{ marginTop: 8 }}>
            <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Ask me anything — or tap one to start:</div>
            {starters}
          </div>
        )}
      </div>
      <div style={{ borderTop: '1px solid var(--border)', padding: 10, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Ask the Coach anything… (Enter to send)"
          rows={1}
          style={{ flex: 1, resize: 'none', maxHeight: 120, fontSize: 13.5, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--panel-2)', color: 'var(--text)', fontFamily: 'inherit' }}
        />
        <button className="btn primary" onClick={() => send()} disabled={sending || !input.trim()}>Send</button>
      </div>
      </div>
      {!compact && wide && (
        <div style={{ width: 250, flexShrink: 0, borderLeft: '1px solid var(--border)', padding: '16px 14px', overflowY: 'auto' }}>
          <div className="dim" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Quick starts</div>
          {starters}
          <div className="dim" style={{ fontSize: 11, marginTop: 12, lineHeight: 1.4 }}>Tap one to ask it, or type your own below.</div>
        </div>
      )}
    </div>
  );
}

window.CoachTab = function CoachTab({ toast }) {
  return (
    <div style={{ padding: 24, maxWidth: 1120, marginLeft: 0 }}>
      <h2 style={{ margin: '0 0 2px' }}>AI Coach</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 14 }}>
        Your guide through the job search. Ask what to do next, where to find things, or tell me what
        happened (like a rejection) and I'll help you handle it. It's always okay to ask.
      </p>
      <div className="card" style={{ padding: 0, height: 'calc(100vh - 220px)', minHeight: 420, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <CoachChat toast={toast} compact={false} />
      </div>
    </div>
  );
};

// Floating "Ask the Coach" button + slide-in panel, rendered app-level so it is
// available on every tab (mirrors the CommandPalette/Toast app-level overlays).
window.CoachFloating = function CoachFloating({ toast }) {
  const [open, setOpen] = useStateCo(false);
  return (
    <>
      <button onClick={() => setOpen(o => !o)} aria-label="Ask the Coach"
        title="Ask the Coach"
        style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 900, width: 52, height: 52, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'color-mix(in srgb, var(--accent) 72%, #06070c)', color: '#fff',
          boxShadow: '0 4px 16px rgba(0,0,0,.28), inset 0 0 0 1px rgba(0,0,0,.14)', display: 'grid', placeItems: 'center' }}>
        {open
          ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
          : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>}
      </button>
      {open && (
        <div style={{ position: 'fixed', right: 20, bottom: 84, zIndex: 900, width: 'min(440px, calc(100vw - 40px))', height: 'min(600px, calc(100vh - 120px))',
          background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 10px 40px rgba(0,0,0,.35)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>AI Coach</div>
            <button className="btn ghost sm" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}><CoachChat toast={toast} compact={true} /></div>
        </div>
      )}
    </>
  );
};
