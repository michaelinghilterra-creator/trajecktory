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

function CompanyOutreach({ c }) {
  const o = c.companyOutreach;
  if (!o) return null;
  if (o.touchedToday) {
    return (
      <div style={{ fontSize: 11, marginTop: 5, padding: '2px 8px', borderRadius: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
        background: 'color-mix(in srgb, var(--orange) 15%, transparent)', color: 'var(--orange)', border: '1px solid color-mix(in srgb, var(--orange) 40%, transparent)' }}
        title={`You already reached out at ${c.company} today (${chLabel(o.touchedToday.channel)} to ${o.touchedToday.name}). Reaching a second contact there today may read as over-contacting — consider holding off.`}>
        ⚠ Already reached out at {c.company} today — {chLabel(o.touchedToday.channel)} to {o.touchedToday.name}
      </div>
    );
  }
  if (o.lastTouch) {
    return (
      <div className="dim" style={{ fontSize: 11, marginTop: 5 }}
        title={`Most recent outreach to anyone else at ${c.company}.`}>
        {c.company}: last reached out {relDaysAgo(o.lastTouch.date)} · {chLabel(o.lastTouch.channel)} to {o.lastTouch.name}
      </div>
    );
  }
  return (
    <div className="dim" style={{ fontSize: 11, marginTop: 5, opacity: 0.7 }}>
      No prior outreach at {c.company}
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
        {queue.length} contact{queue.length === 1 ? '' : 's'} with a verified email at companies you've
        applied to. Draft an email, copy it, send it from your own client, then hit Mark sent — it logs a
        verified touch (toward the weekly floor) and drops off. Nothing is sent from here.
      </p>
      {queue.length === 0
        ? <div className="card dim">No emailable contacts waiting. They appear once you apply to a company where you have a verified address on file.</div>
        : queue.map(c => <EmailRow key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} />)}
    </div>
  );
};
