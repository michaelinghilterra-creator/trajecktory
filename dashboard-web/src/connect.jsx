// Connect tab — the LinkedIn connect queue. Contacts we cannot email (a real
// handle, no sendable address) that the fallback outreach lane reaches. Reads
// GET /api/linkedin-drafts/connect-queue and drafts a <=300-char note per
// contact via POST /api/linkedin-drafts/connect-note. Nothing is sent from here:
// every note is copied and sent by hand, which is how LinkedIn invites stay
// compliant.
const { useState: useStateCq, useEffect: useEffectCq } = React;

function ConnectRow({ c, toast, onDone }) {
  const [note, setNote] = useStateCq(null);
  const [loading, setLoading] = useStateCq(false);
  const [sending, setSending] = useStateCq(false);
  const [sentAt, setSentAt] = useStateCq(null);
  const done = !!sentAt;

  // Record that the invite went out, right here — no jumping to the Network tab.
  // Posts the note as a "Sent" correspondence to the contact's own route (TA vs
  // recruiter), which appends the message, advances status to Sent, and stamps
  // Last Touch. Passing the drafted note as the body is how "I used the AI note"
  // gets captured; a self-written invite records a short generic line instead.
  const markSent = () => {
    if (sending || done) return;
    setSending(true);
    const url = c.source === 'recruiter'
      ? `/api/recruiters/${c.id}/correspondence`
      : `/api/target-talent/${c.id}/correspondence`;
    const body = (note?.response || '').trim() || `LinkedIn connection request sent to ${c.name || 'this contact'}.`;
    fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', subject: 'LinkedIn connection request', body }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setSending(false); return; }
        setSentAt('just now');                 // brief ✓ so the click is confirmed,
        toast && toast(`Marked sent — ${c.name || 'contact'}`, 'success');
        setTimeout(() => onDone && onDone(c.source, c.id), 1000); // then drop off the list
      })
      .catch(e => { toast && toast(e.message, 'error'); setSending(false); });
  };

  const draft = () => {
    setLoading(true);
    fetch('/api/linkedin-drafts/connect-note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id }),
    }).then(r => r.json())
      .then(res => { if (res.error) { toast && toast(res.error, 'error'); } else setNote(res); })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setLoading(false));
  };
  const copy = () => {
    // navigator.clipboard is undefined on http / a LAN IP; guard so the button
    // does not throw, and never claim a copy that did not happen.
    const cp = navigator.clipboard?.writeText(note.response);
    if (cp) cp.then(() => toast && toast('Note copied', 'success'))
              .catch(() => toast && toast('Copy failed. Select the text and copy it manually', 'warn'));
    else toast && toast('Copy not available here. Select the text and copy it manually', 'warn');
  };
  const href = c.linkedin ? (/^https?:/.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`) : null;

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.name || '(no name)'}{' '}
            <span className="dim" style={{ fontWeight: 400 }}>· {c.role || 'unknown role'}</span>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {c.company} · <span className="mono">{c.source}</span> ·{' '}
            {c.hasEmail
              ? <span title="An address is on file but is not verified deliverable. Verify it to move this contact to the email motion.">email {c.emailState}</span>
              : <span title="No email address on file. Find one (Hunter/MillionVerifier) to move this contact to the email motion.">no email on file</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {href ? <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer">Open ↗</a> : null}
          <button className="btn accent sm" onClick={draft} disabled={loading}>
            {loading ? 'Drafting…' : (note ? 'Redraft' : 'Draft note')}
          </button>
          {done
            ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }} title={`Recorded as sent (${sentAt})`}>✓ Sent</span>
            : <button className="btn sm" onClick={markSent} disabled={sending} title="Record that you sent this invite. Advances the contact to Sent and stamps Last Touch.">
                {sending ? 'Saving…' : 'Mark sent'}
              </button>}
        </div>
      </div>
      {note ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, whiteSpace: 'pre-wrap' }}>
            {note.response}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span className="dim mono" style={{ fontSize: 11 }}>{note.length}/300 chars</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn sm" onClick={copy}>Copy</button>
              {done
                ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, alignSelf: 'center' }}>✓ Sent</span>
                : <button className="btn primary sm" onClick={markSent} disabled={sending} title="Log this note as the invite you sent. Advances the contact to Sent.">
                    {sending ? 'Saving…' : 'Mark as sent'}
                  </button>}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

window.ConnectTab = function ConnectTab({ toast }) {
  const [queue, setQueue] = useStateCq(null);
  const [err, setErr] = useStateCq(null);

  useEffectCq(() => {
    fetch('/api/linkedin-drafts/connect-queue').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setQueue(d.queue || []); })
      .catch(e => setErr(e.message));
  }, []);

  // A row leaves the queue two ways: you sent the invite, or you archived a stale
  // contact. Both drop it from view here; the server also stops returning it, so a
  // reload stays consistent.
  const dropRow = (source, id) =>
    setQueue(q => (q || []).filter(c => !(c.source === source && String(c.id) === String(id))));

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the connect queue: {err}</div>;
  if (!queue) return <div className="dim" style={{ padding: 28 }}>Loading connect queue…</div>;

  return (
    <div style={{ padding: 24, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <h2 style={{ margin: '0 0 2px' }}>Connect queue</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        {queue.length} contact{queue.length === 1 ? '' : 's'} we cannot email (a LinkedIn handle, no
        sendable address). Draft a note, copy it, send the invite by hand, then hit Mark sent — the
        row drops off once recorded. Nothing is sent from here.
      </p>
      {queue.length === 0
        ? <div className="card dim">Nobody in the queue. Every reachable contact has a sendable email.</div>
        : queue.map(c => <ConnectRow key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} />)}
    </div>
  );
};
