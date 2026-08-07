// Connect tab — the LinkedIn connect queue. Contacts we cannot email (a real
// handle, no sendable address) that the fallback outreach lane reaches. Reads
// GET /api/linkedin-drafts/connect-queue and drafts a <=300-char note per
// contact via POST /api/linkedin-drafts/connect-note. Nothing is sent from here:
// every note is copied and sent by hand, which is how LinkedIn invites stay
// compliant.
const { useState: useStateCq, useEffect: useEffectCq } = React;

// Two independent contact signals, shown in both the Connect and Email queues:
//   NEW           — added by your most recent Reconcile (clears on the next one)
//   Not contacted — no outreach logged yet (clears once you Mark sent)
// A contact can carry either, both, or neither.
function OutreachPills({ c }) {
  return (
    <>
      {c.isNew ? (
        <span title="Added by your most recent Reconcile. Clears the next time you reconcile."
          style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.4px', padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#fff', verticalAlign: 'middle' }}>NEW</span>
      ) : null}
      {c.notContacted ? (
        <span title="You haven't reached out to this contact yet."
          style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4, background: 'var(--panel-2)', border: '1px solid var(--border)', color: 'var(--text-mute)', verticalAlign: 'middle' }}>Not contacted</span>
      ) : null}
    </>
  );
}

// Company outreach context, shown on every queue row so you can decide inside the
// queue whether reaching a second person at the same company is doubling up —
// instead of leaving to reconcile across the Pipeline drawer and Network tab.
// `touchedToday` (same calendar day) is a hold-off warning; otherwise the most
// recent prior touch to ANYONE ELSE at that company is shown for timing.
function relDaysAgo(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr || '')) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const then = new Date(y, m - 1, d);
  const now = new Date();
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - then) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return 'last week';
  return `${Math.floor(days / 7)} weeks ago`;
}
function chLabel(ch) { return ch === 'linkedin' ? 'LinkedIn invite' : 'email'; }

// Two timing signals per row so you never have to open the card to know where you
// stand: (1) THIS contact — the last message to/from this person, either direction;
// (2) the ORG — the last comms with anyone else at the company, either direction,
// plus the same-day hold-off warning. The self line fixes the confusion where the org
// showed an old email to a different contact while this person was messaged recently.
function CompanyOutreach({ c }) {
  const o = c.companyOutreach;
  if (!o) return null;
  const self = o.selfLastTouch;
  const org = o.companyLastComms;
  const selfLine = self
    ? `This contact: last ${self.direction === 'Received' ? 'reply received' : `${chLabel(self.channel)} sent`} ${relDaysAgo(self.date)} (${self.date})`
    : 'This contact: no prior correspondence yet';
  return (
    <div style={{ marginTop: 5, display: 'flex', flexDirection: 'column', gap: 3 }}>
      <div className="dim" style={{ fontSize: 11 }}
        title="The most recent message to or from THIS contact, either direction.">
        {selfLine}
      </div>
      {o.selfSentToday ? (
        <div style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'color-mix(in srgb, var(--orange) 15%, transparent)', color: 'var(--orange)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)' }}
          title={`You already ${chLabel(o.selfSentToday.channel) === 'email' ? 'emailed' : 'sent a LinkedIn invite to'} this contact today. Hitting the other channel the same day reads as over-contacting — consider waiting a day.`}>
          ⚠ You already reached this contact today ({chLabel(o.selfSentToday.channel)}) — consider spacing the other channel to another day
        </div>
      ) : null}
      {o.touchedToday ? (
        <div style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 4,
          background: 'color-mix(in srgb, var(--orange) 15%, transparent)', color: 'var(--orange)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)' }}
          title={`You already reached out at ${c.company} today (${chLabel(o.touchedToday.channel)} to ${o.touchedToday.name}). Reaching a second contact there today may read as over-contacting — consider holding off.`}>
          ⚠ Already reached out at {c.company} today — {chLabel(o.touchedToday.channel)} to {o.touchedToday.name}
        </div>
      ) : org ? (
        <div className="dim" style={{ fontSize: 11 }}
          title={`Most recent comms with anyone else at ${c.company}, either direction.`}>
          {c.company}: last comms {relDaysAgo(org.date)} · {org.direction === 'Received' ? `${chLabel(org.channel)} from` : `${chLabel(org.channel)} to`} {org.name}
        </div>
      ) : (
        <div className="dim" style={{ fontSize: 11, opacity: 0.7 }}>
          No other comms at {c.company}
        </div>
      )}
    </div>
  );
}

function ConnectRow({ c, toast, onDone }) {
  const [note, setNote] = useStateCq(null);
  const [loading, setLoading] = useStateCq(false);
  const [sending, setSending] = useStateCq(false);
  const [sentAt, setSentAt] = useStateCq(null);
  const [showArchive, setShowArchive] = useStateCq(false);
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
    window.tjkMutate(url, {
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

  // Dispo a stale contact (left the company, or changed to an unrelated role) so
  // they stop cluttering the queue and never get outreach. Archives the contact
  // (status Archived + a dated reason note) and drops the row. If they moved to a
  // target company, re-add them fresh there — this only retires the stale record.
  const archive = (reason) => {
    if (sending || done) return;
    setSending(true);
    window.tjkMutate('/api/linkedin-drafts/archive-contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id, reason }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setSending(false); return; }
        toast && toast(`Archived — ${c.name || 'contact'}`, 'success');
        onDone && onDone(c.source, c.id);
      })
      .catch(e => { toast && toast(e.message, 'error'); setSending(false); });
  };

  const draft = () => {
    setLoading(true);
    window.tjkMutate('/api/linkedin-drafts/connect-note', {
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
            <OutreachPills c={c} />
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {c.company} · <span className="mono">{c.source}</span> ·{' '}
            {c.hasEmail
              ? <span title="An address is on file but is not verified deliverable. Verify it to move this contact to the email motion.">email {c.emailState}</span>
              : <span title="No email address on file. Find one (Hunter/MillionVerifier) to move this contact to the email motion.">no email on file</span>}
          </div>
          <CompanyOutreach c={c} />
          {!done && (
            <div className="dim" style={{ fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              {!showArchive
                ? <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowArchive(true)} disabled={sending}
                    title="Contact left the company or changed to an unrelated role? Archive them so they drop off and never get outreach.">Not reachable?</button>
                : <>
                    <span>Archive — reason:</span>
                    <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => archive('left-company')} disabled={sending}>Left company</button>
                    <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => archive('changed-role')} disabled={sending}>Changed role</button>
                    <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowArchive(false)} disabled={sending}>Cancel</button>
                  </>}
            </div>
          )}
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

  const load = () =>
    fetch('/api/linkedin-drafts/connect-queue').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setQueue(d.queue || []); })
      .catch(e => setErr(e.message));

  useEffectCq(() => { load(); }, []);

  // A row leaves the queue two ways: you sent the invite, or you archived a stale
  // contact. Drop it optimistically for an instant response, THEN re-fetch so the
  // OTHER rows at the same company pick up the fresh "already reached out today"
  // warning — their companyOutreach was computed at load time and is now stale.
  // React keeps each sibling row's own state (stable source:id keys), so an
  // in-progress draft survives and the user never has to reload the page.
  const dropRow = (source, id) => {
    setQueue(q => (q || []).filter(c => !(c.source === source && String(c.id) === String(id))));
    load();
  };

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the connect queue: {err}</div>;
  if (!queue) return <div className="dim" style={{ padding: 28 }}>Loading connect queue…</div>;

  return (
    <div style={{ padding: 24, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <h2 style={{ margin: '0 0 2px' }}>Connect queue</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        {queue.length} contact{queue.length === 1 ? '' : 's'} we cannot email (a LinkedIn handle, no
        sendable address). Draft a note, copy it, send the invite by hand, then hit Mark sent — the
        row drops off once recorded. Contact moved on? Use “Not reachable?” to archive them. Nothing
        is sent from here.
      </p>
      {queue.length === 0
        ? <div className="card dim">Nobody in the queue. Every reachable contact has a sendable email.</div>
        : queue.map(c => <ConnectRow key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} />)}
    </div>
  );
};

// ── Email queue ───────────────────────────────────────────────────────────────
// The email counterpart of the Connect queue: contacts with a sendable, verified
// address at companies you've applied to, that you haven't emailed yet. Draft an
// email, copy it, send it from your own client, then Mark sent — which logs a
// "Sent" correspondence (a VERIFIED TOUCH, since the subject is not a LinkedIn
// invite) and drops the row. This is the list that moves the 13/week touch floor.
function EmailRow({ c, toast, onDone }) {
  // draft is the EDITABLE email: { subject, body }. The /draft endpoint returns an
  // OBJECT { subject, body } (not a string like the LinkedIn note), and its body
  // has no greeting by design — the UI prepends "Hi <first>,". Once generated the
  // user can edit both fields; every action (Gmail, mailto, copy, mark sent) reads
  // the live edited values.
  const [draft, setDraft] = useStateCq(null);
  const [loading, setLoading] = useStateCq(false);
  const [sending, setSending] = useStateCq(false);
  const [sentAt, setSentAt] = useStateCq(null);
  const [showArchive, setShowArchive] = useStateCq(false);
  const done = !!sentAt;
  const base = c.source === 'recruiter' ? `/api/recruiters/${c.id}` : `/api/target-talent/${c.id}`;
  const firstName = c.firstName || (c.name || '').split(/\s+/)[0] || 'there';
  // LinkedIn profile link, same normalization as the Connect queue, so you can
  // confirm the TA is still at the company before you spend a draft on them.
  const href = c.linkedin ? (/^https?:/.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`) : null;

  // Same "Not reachable?" disposition as the Connect queue: a contact who left the
  // company or changed roles gets Archived (status Archived + dated reason) and
  // drops off, so you never email a dead lead. Shares the archive-contact endpoint.
  const archive = (reason) => {
    if (sending || done) return;
    setSending(true);
    window.tjkMutate('/api/linkedin-drafts/archive-contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id, reason }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setSending(false); return; }
        toast && toast(`Archived — ${c.name || 'contact'}`, 'success');
        onDone && onDone(c.source, c.id);
      })
      .catch(e => { toast && toast(e.message, 'error'); setSending(false); });
  };

  const gen = () => {
    setLoading(true);
    window.tjkMutate(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        const d = res.draft || {};
        if (!d.body) { toast && toast('The model returned an empty draft. Try Redraft.', 'warn'); return; }
        // Compose the full editable email the same way the Network → TA drawer does:
        // greeting + body + the user's signature. This is what gets saved as the
        // Gmail draft, so the draft is complete and needs no typing.
        const sig = (window.myEmailSignature && window.myEmailSignature()) || '';
        setDraft({ subject: (d.subject || '').trim(), body: `Hi ${firstName},\n\n${(d.body || '').trim()}${sig ? `\n\n${sig}` : ''}` });
      })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setLoading(false));
  };

  const subject = draft?.subject || '';
  const body = draft?.body || '';
  const setSubject = (v) => setDraft(d => ({ ...(d || {}), subject: v }));
  const setBody = (v) => setDraft(d => ({ ...(d || {}), body: v }));

  const copy = () => {
    const cp = navigator.clipboard?.writeText(body);
    if (cp) cp.then(() => toast && toast('Email body copied', 'success')).catch(() => toast && toast('Copy failed. Select the text and copy it manually', 'warn'));
    else toast && toast('Copy not available here. Select the text and copy it manually', 'warn');
  };

  // mailto fallback for non-Gmail clients. Only the query params are URL-encoded;
  // the ADDRESS must NOT be (mailto:name%40host is malformed and does nothing).
  const mailtoUrl = c.email
    ? `mailto:${c.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;

  const markSent = () => {
    if (sending || done) return;
    setSending(true);
    const sentBody = (body || '').trim() || `Emailed ${c.name || 'this contact'}${c.company ? ` at ${c.company}` : ''}.`;
    window.tjkMutate(`${base}/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', subject: subject || 'Outreach email', body: sentBody }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setSending(false); return; }
        setSentAt('just now');
        toast && toast(`Logged sent — ${c.name || 'contact'} (verified touch)`, 'success');
        setTimeout(() => onDone && onDone(c.source, c.id), 1000);
      })
      .catch(e => { toast && toast(e.message, 'error'); setSending(false); });
  };

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.name || '(no name)'}{' '}
            <span className="dim" style={{ fontWeight: 400 }}>· {c.role || 'unknown role'}</span>
            <OutreachPills c={c} />
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {c.company} · <span className="mono">{c.source}</span> · <span className="mono">{c.email}</span>
            {c.emailState === 'risky' ? <span title="Catch-all domain: usually deliverable."> · risky</span> : null}
          </div>
          <CompanyOutreach c={c} />
          {!done && (
            <div className="dim" style={{ fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
              {!showArchive
                ? <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowArchive(true)} disabled={sending}
                    title="Contact left the company or changed to an unrelated role? Archive them so they drop off and never get emailed.">Not reachable?</button>
                : <>
                    <span>Archive — reason:</span>
                    <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => archive('left-company')} disabled={sending}>Left company</button>
                    <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => archive('changed-role')} disabled={sending}>Changed role</button>
                    <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowArchive(false)} disabled={sending}>Cancel</button>
                  </>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
          {href ? <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer" title="Open the LinkedIn profile to confirm they're still at the company before emailing.">Open ↗</a> : null}
          <button className="btn accent sm" onClick={gen} disabled={loading}>
            {loading ? 'Drafting…' : (draft ? 'Redraft' : 'Draft email')}
          </button>
          {done
            ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, whiteSpace: 'nowrap' }} title="Recorded as a verified touch">✓ Sent</span>
            : <button className="btn sm" onClick={markSent} disabled={sending} title="Record that you emailed this contact. Logs a verified touch and stamps Last Touch.">
                {sending ? 'Saving…' : 'Mark sent'}
              </button>}
        </div>
      </div>
      {draft ? (
        <div style={{ marginTop: 10 }}>
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 8px', marginBottom: 6, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}
          />
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={9}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.5, padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', whiteSpace: 'pre-wrap', resize: 'vertical' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={copy}>Copy body</button>
            {mailtoUrl ? <a className="btn ghost sm" href={mailtoUrl}>Open in mail ↗</a> : null}
            <window.GmailDraftBtn to={c.email} subject={subject} body={body} size="sm" />
            {done
              ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, alignSelf: 'center' }}>✓ Sent</span>
              : <button className="btn primary sm" onClick={markSent} disabled={sending}>{sending ? 'Saving…' : 'Mark as sent'}</button>}
          </div>
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>
            Edit the subject and body above, then “Gmail draft” creates a complete, ready-to-send draft in your Gmail Drafts folder (it never sends). Send it from Gmail, then click Mark as sent to log the verified touch.
          </div>
        </div>
      ) : null}
    </div>
  );
}

window.EmailQueueTab = function EmailQueueTab({ toast }) {
  const [queue, setQueue] = useStateCq(null);
  const [err, setErr] = useStateCq(null);

  const load = () =>
    fetch('/api/followups/email-queue').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setQueue(d.queue || []); })
      .catch(e => setErr(e.message));

  useEffectCq(() => { load(); }, []);

  // Drop the sent/archived row optimistically, then re-fetch so siblings at the
  // same company refresh their "already reached out today" warning in place — no
  // page reload, and in-progress drafts on other rows survive (stable keys).
  const dropRow = (source, id) => {
    setQueue(q => (q || []).filter(c => !(c.source === source && String(c.id) === String(id))));
    load();
  };

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the email queue: {err}</div>;
  if (!queue) return <div className="dim" style={{ padding: 28 }}>Loading email queue…</div>;

  return (
    <div style={{ padding: 24, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <h2 style={{ margin: '0 0 2px' }}>Email queue</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        {queue.length} contact{queue.length === 1 ? '' : 's'} with a verified email (and no LinkedIn handle) at
        companies you've applied to. Draft an email, copy it, send it from your own client, then hit Mark sent — it
        logs a verified touch (toward the weekly floor) and drops off. Nothing is sent from here.
      </p>
      {queue.length === 0
        ? <div className="card dim">No email-only contacts waiting. Contacts who also have a LinkedIn handle appear under High value.</div>
        : queue.map(c => <EmailRow key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} />)}
    </div>
  );
};

// ── High-value queue (both channels) ────────────────────────────────────────────
// The third bucket: contacts reachable BOTH ways (a verified email AND a LinkedIn
// handle) at a company you've applied to. These are worked on both channels in
// parallel — the multithread. A row stays until BOTH a LinkedIn invite and an email
// have gone out (or a reply pauses it), so each row carries its own per-channel
// done state (c.linkedinDone / c.emailDone) and two independent draft+send blocks.
// Nothing is sent from here: every note/email is copied or drafted to Gmail and
// sent by hand, then logged with Mark sent.
function BothRow({ c, toast, onChannelDone }) {
  // LinkedIn side
  const [note, setNote] = useStateCq(null);
  const [liLoading, setLiLoading] = useStateCq(false);
  const [liSending, setLiSending] = useStateCq(false);
  const [liDone, setLiDone] = useStateCq(!!c.linkedinDone);
  // Email side
  const [draft, setDraft] = useStateCq(null);
  const [emLoading, setEmLoading] = useStateCq(false);
  const [emSending, setEmSending] = useStateCq(false);
  const [emDone, setEmDone] = useStateCq(!!c.emailDone);

  const base = c.source === 'recruiter' ? `/api/recruiters/${c.id}` : `/api/target-talent/${c.id}`;
  const firstName = c.firstName || (c.name || '').split(/\s+/)[0] || 'there';
  const href = c.linkedin ? (/^https?:/.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`) : null;

  // ── LinkedIn actions ──
  const draftNote = () => {
    setLiLoading(true);
    window.tjkMutate('/api/linkedin-drafts/connect-note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id }),
    }).then(r => r.json())
      .then(res => { if (res.error) toast && toast(res.error, 'error'); else setNote(res); })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setLiLoading(false));
  };
  const copyNote = () => {
    const cp = navigator.clipboard?.writeText(note.response);
    if (cp) cp.then(() => toast && toast('Note copied', 'success')).catch(() => toast && toast('Copy failed. Select the text and copy it manually', 'warn'));
    else toast && toast('Copy not available here. Select the text and copy it manually', 'warn');
  };
  const markLiSent = () => {
    if (liSending || liDone) return;
    setLiSending(true);
    const body = (note?.response || '').trim() || `LinkedIn connection request sent to ${c.name || 'this contact'}.`;
    window.tjkMutate(`${base}/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', subject: 'LinkedIn connection request', body }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setLiSending(false); return; }
        setLiDone(true); setLiSending(false);
        toast && toast(`LinkedIn invite logged — ${c.name || 'contact'}`, 'success');
        // Both channels done → drop the row after a beat; else it stays with LinkedIn ✓.
        onChannelDone && onChannelDone(c.source, c.id, { linkedinDone: true, emailDone: emDone });
      })
      .catch(e => { toast && toast(e.message, 'error'); setLiSending(false); });
  };

  // ── Email actions ──
  const genEmail = () => {
    setEmLoading(true);
    window.tjkMutate(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        const d = res.draft || {};
        if (!d.body) { toast && toast('The model returned an empty draft. Try Redraft.', 'warn'); return; }
        const sig = (window.myEmailSignature && window.myEmailSignature()) || '';
        setDraft({ subject: (d.subject || '').trim(), body: `Hi ${firstName},\n\n${(d.body || '').trim()}${sig ? `\n\n${sig}` : ''}` });
      })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setEmLoading(false));
  };
  const emSubject = draft?.subject || '';
  const emBody = draft?.body || '';
  const setEmSubject = (v) => setDraft(d => ({ ...(d || {}), subject: v }));
  const setEmBody = (v) => setDraft(d => ({ ...(d || {}), body: v }));
  const copyEmail = () => {
    const cp = navigator.clipboard?.writeText(emBody);
    if (cp) cp.then(() => toast && toast('Email body copied', 'success')).catch(() => toast && toast('Copy failed. Select the text and copy it manually', 'warn'));
    else toast && toast('Copy not available here. Select the text and copy it manually', 'warn');
  };
  const mailtoUrl = c.email ? `mailto:${c.email}?subject=${encodeURIComponent(emSubject)}&body=${encodeURIComponent(emBody)}` : null;
  const markEmSent = () => {
    if (emSending || emDone) return;
    setEmSending(true);
    const sentBody = (emBody || '').trim() || `Emailed ${c.name || 'this contact'}${c.company ? ` at ${c.company}` : ''}.`;
    window.tjkMutate(`${base}/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', subject: emSubject || 'Outreach email', body: sentBody }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setEmSending(false); return; }
        setEmDone(true); setEmSending(false);
        toast && toast(`Email logged (verified touch) — ${c.name || 'contact'}`, 'success');
        onChannelDone && onChannelDone(c.source, c.id, { linkedinDone: liDone, emailDone: true });
      })
      .catch(e => { toast && toast(e.message, 'error'); setEmSending(false); });
  };

  const chipStyle = (done) => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '.3px', padding: '2px 7px', borderRadius: 4, verticalAlign: 'middle',
    background: done ? 'color-mix(in srgb, var(--green) 18%, transparent)' : 'var(--panel-2)',
    color: done ? 'var(--green)' : 'var(--text-mute)',
    border: `1px solid ${done ? 'color-mix(in srgb, var(--green) 45%, transparent)' : 'var(--border)'}`,
  });

  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.name || '(no name)'}{' '}
            <span className="dim" style={{ fontWeight: 400 }}>· {c.role || 'unknown role'}</span>
            <span title="High value: reachable on both email and LinkedIn. Worked on both channels."
              style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.4px', padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: '#fff', verticalAlign: 'middle' }}>HIGH VALUE</span>
            {c.isPrincipal ? <span title="Hiring principal — the decision-maker you'd report to."
              style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.3px', padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', verticalAlign: 'middle' }}>PRINCIPAL</span> : null}
            <OutreachPills c={c} />
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {c.company} · <span className="mono">{c.source}</span> · <span className="mono">{c.email}</span>
          </div>
          <CompanyOutreach c={c} />
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            <span style={chipStyle(liDone)}>LinkedIn {liDone ? '✓ sent' : 'pending'}</span>
            <span style={chipStyle(emDone)}>Email {emDone ? '✓ sent' : 'pending'}</span>
          </div>
        </div>
        {href ? <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>Open ↗</a> : null}
      </div>

      {/* LinkedIn channel */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>LinkedIn invite</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn accent sm" onClick={draftNote} disabled={liLoading || liDone}>{liLoading ? 'Drafting…' : (note ? 'Redraft' : 'Draft note')}</button>
            {liDone
              ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Sent</span>
              : <button className="btn sm" onClick={markLiSent} disabled={liSending} title="Record that you sent the LinkedIn invite.">{liSending ? 'Saving…' : 'Mark sent'}</button>}
          </div>
        </div>
        {note ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, whiteSpace: 'pre-wrap' }}>{note.response}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <span className="dim mono" style={{ fontSize: 11 }}>{note.length}/300 chars</span>
              <button className="btn sm" onClick={copyNote}>Copy</button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Email channel */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Email</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn accent sm" onClick={genEmail} disabled={emLoading || emDone}>{emLoading ? 'Drafting…' : (draft ? 'Redraft' : 'Draft email')}</button>
            {emDone
              ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Sent</span>
              : <button className="btn sm" onClick={markEmSent} disabled={emSending} title="Record that you emailed this contact. Logs a verified touch.">{emSending ? 'Saving…' : 'Mark sent'}</button>}
          </div>
        </div>
        {draft ? (
          <div style={{ marginTop: 8 }}>
            <input value={emSubject} onChange={e => setEmSubject(e.target.value)} placeholder="Subject"
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 8px', marginBottom: 6, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }} />
            <textarea value={emBody} onChange={e => setEmBody(e.target.value)} rows={8}
              style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.5, padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', whiteSpace: 'pre-wrap', resize: 'vertical' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={copyEmail}>Copy body</button>
              {mailtoUrl ? <a className="btn ghost sm" href={mailtoUrl}>Open in mail ↗</a> : null}
              <window.GmailDraftBtn to={c.email} subject={emSubject} body={emBody} size="sm" />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Sequence panel ──────────────────────────────────────────────────────────────
// Per-contact outreach sequence: pick a template, and the engine tracks which step
// you're on and when the next is due. Each step is a DRAFT you approve — nothing
// auto-sends (HITL). Reads GET /api/sequences/:source/:id and the template library,
// and drives start / advance / pause / resume. Usable from any contact.
window.SequencePanel = function SequencePanel({ source, id, toast }) {
  const [state, setState] = useStateCq(undefined);   // undefined = loading, null = none, obj = active
  const [templates, setTemplates] = useStateCq(null);
  const [pick, setPick] = useStateCq('');
  const [busy, setBusy] = useStateCq(false);
  const [err, setErr] = useStateCq(null);

  const loadState = () =>
    fetch(`/api/sequences/${source}/${id}`).then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setState(d.state || null); })
      .catch(e => setErr(e.message));

  useEffectCq(() => {
    loadState();
    fetch('/api/sequences/templates').then(r => r.json())
      .then(d => { const t = (d && d.templates) || []; setTemplates(t); if (t[0]) setPick(t[0].id); })
      .catch(() => setTemplates([]));
  }, [source, id]);

  const post = (path, body) => {
    setBusy(true); setErr(null);
    return window.tjkMutate(`/api/sequences/${source}/${id}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    }).then(r => r.json())
      .then(res => { if (res.error) { setErr(res.error); toast && toast(res.error, 'error'); } return res; })
      .catch(e => { setErr(e.message); toast && toast(e.message, 'error'); })
      .finally(() => { setBusy(false); loadState(); });
  };

  const tpl = (templates || []).find(t => t.id === (state && state.sequenceId)) || null;
  const nTouches = tpl ? (tpl.touches || []).length : 0;
  const stepDone = state ? state.step : 0;
  const nextTouch = tpl && (tpl.touches || [])[stepDone];

  if (err) return <div className="dim" style={{ fontSize: 12 }}>Sequence unavailable: {err}</div>;
  if (state === undefined) return <div className="dim" style={{ fontSize: 12 }}>Loading sequence…</div>;

  // Active sequence
  if (state) {
    return (
      <div style={{ fontSize: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600 }}>{tpl ? tpl.label : state.sequenceId}</span>
          {state.paused
            ? <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--orange) 18%, transparent)', color: 'var(--orange)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)' }}>PAUSED</span>
            : state.completedAt
              ? <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--green) 18%, transparent)', color: 'var(--green)' }}>DONE</span>
              : <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}>ACTIVE</span>}
        </div>
        <div className="dim" style={{ marginTop: 4 }}>
          Step {Math.min(stepDone, nTouches)} of {nTouches} done{state.nextStepDue ? ` · next due ${state.nextStepDue}` : ''}
          {nextTouch ? ` · next: ${nextTouch.label}` : ''}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {!state.completedAt && <button className="btn sm" onClick={() => post('/advance')} disabled={busy} title="Mark the current step's draft sent and move the clock to the next step.">Mark step sent</button>}
          {!state.completedAt && (state.paused
            ? <button className="btn sm" onClick={() => post('/resume')} disabled={busy}>Resume</button>
            : <button className="btn ghost sm" onClick={() => post('/pause')} disabled={busy}>Pause</button>)}
        </div>
      </div>
    );
  }

  // No active sequence → picker
  return (
    <div style={{ fontSize: 12 }}>
      <div className="dim" style={{ marginBottom: 8 }}>No active sequence. Start one to track a multi-touch cadence — each step is a draft you approve.</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={pick} onChange={e => setPick(e.target.value)}
          style={{ fontSize: 12, padding: '5px 8px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }}>
          {(templates || []).map(t => <option key={t.id} value={t.id}>{t.label} ({(t.touches || []).length} touches)</option>)}
        </select>
        <button className="btn accent sm" onClick={() => post('/start', { sequenceId: pick })} disabled={busy || !pick}>Start sequence</button>
      </div>
      {pick && templates && (() => {
        const t = templates.find(x => x.id === pick);
        if (!t) return null;
        return (
          <div className="dim" style={{ marginTop: 8, fontSize: 11 }}>
            {t.scenario ? <div style={{ marginBottom: 4 }}>{t.scenario}</div> : null}
            {(t.touches || []).map((x, i) => <div key={i}>• Day {x.dayOffset}: {x.label}</div>)}
          </div>
        );
      })()}
    </div>
  );
};

window.BothQueueTab = function BothQueueTab({ toast }) {
  const [queue, setQueue] = useStateCq(null);
  const [err, setErr] = useStateCq(null);

  const load = () =>
    fetch('/api/followups/both-queue').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setQueue(d.queue || []); })
      .catch(e => setErr(e.message));

  useEffectCq(() => { load(); }, []);

  // A high-value row leaves only when BOTH channels are done. Two updates run on each
  // mark: (1) OPTIMISTIC — update the clicked row in place (or remove it) instantly,
  // so feedback is snappy and the click is never lost; (2) load() — re-fetch so the
  // OTHER contacts at the same company pick up their "already reached out today"
  // warning, which is server-computed per row (this is why siblings weren't updating
  // without a reload). Row identity is stable (source:id), so a same-key row keeps its
  // local state and any in-progress draft across the refresh.
  const onChannelDone = (source, id, state) => {
    const isRow = (c) => c.source === source && String(c.id) === String(id);
    setQueue(q => {
      const list = q || [];
      if (state && state.linkedinDone && state.emailDone) return list.filter(c => !isRow(c));
      return list.map(c => isRow(c) ? { ...c, linkedinDone: state.linkedinDone, emailDone: state.emailDone } : c);
    });
    load();
  };

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the high-value queue: {err}</div>;
  if (!queue) return <div className="dim" style={{ padding: 28 }}>Loading high-value queue…</div>;

  return (
    <div style={{ padding: 24, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <h2 style={{ margin: '0 0 2px' }}>High-value queue</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 18 }}>
        {queue.length} contact{queue.length === 1 ? '' : 's'} reachable BOTH ways (a verified email and a LinkedIn
        handle) at companies you've applied to. These are worked on both channels in parallel: draft and send the
        LinkedIn invite and the email, marking each sent as you go. A row stays until both channels are done, and a
        reply on either channel pauses it. Nothing is sent from here.
      </p>
      {queue.length === 0
        ? <div className="card dim">No high-value contacts waiting. They appear once you apply to a company where a contact has both a verified email and a LinkedIn handle.</div>
        : queue.map(c => <BothRow key={`${c.source}:${c.id}`} c={c} toast={toast} onChannelDone={onChannelDone} />)}
    </div>
  );
};
