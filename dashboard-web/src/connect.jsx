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

// Which book a queue row came from. The queue merges three populations that used
// to live on separate tabs, and once merged every row looked identical: the source
// was rendered as a bare lowercase word AFTER the company name, so its position
// shifted on every row and there was nothing for the eye to lock onto.
//
// So this is a colored chip at a FIXED position, first on the meta line. The label
// matches the subtab name deliberately, so the chip also tells you where to go to
// find that person. Colors are theme tokens, never literals, because there are
// nine themes.
const BOOK_META = {
  ta:         { label: 'TA Outreach', cvar: 'var(--cyan)',  title: 'A talent-acquisition contact, from the TA Outreach book.' },
  referral:   { label: 'Referral',    cvar: 'var(--green)', title: 'Someone in your own network, from the Referrals book.' },
  influencer: { label: 'Influencer',  cvar: 'var(--blue)',  title: 'A voice you engage with publicly, from the Influencers book.' },
};
// Shared so the drawer's "Filed in" chips tint identically. One map, or the two
// surfaces drift and the colors stop meaning anything.
window.BOOK_META = BOOK_META;
function BookChip({ source }) {
  const meta = BOOK_META[source];
  if (!meta) return null;
  return (
    <span title={meta.title}
      style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.3px', padding: '2px 6px', borderRadius: 4,
        verticalAlign: 'middle', whiteSpace: 'nowrap',
        background: `color-mix(in srgb, ${meta.cvar} 15%, transparent)`,
        color: meta.cvar,
        border: `1px solid color-mix(in srgb, ${meta.cvar} 40%, transparent)` }}>
      {meta.label}
    </span>
  );
}

// Why this contact is in the follow-up queue: 'Reach out' (you applied at their
// company, not worked yet), 'App going stale', or 'Went quiet'. One consistent tag
// across all three card types, so the merged list never leaves you guessing why
// someone is here. The timing ("last email sent 3 days ago") comes from the
// CompanyOutreach block below it; this pill is the category.
function QueueReasonPill({ c }) {
  if (!c.queueReason) return null;
  // 'Just connected' is a positive event (they accepted) → green. The overdue
  // reasons are orange. Everything else rides the neutral accent.
  const cvar = c.queueReason === 'Just connected' ? 'var(--green)'
    : (c.queueReason === 'App going stale' || c.queueReason === 'Went quiet') ? 'var(--orange)'
    : 'var(--accent)';
  return (
    <span title="Why this contact is in your follow-up queue"
      style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.3px', padding: '2px 6px', borderRadius: 4, verticalAlign: 'middle',
        background: `color-mix(in srgb, ${cvar} 15%, transparent)`,
        color: cvar,
        border: `1px solid color-mix(in srgb, ${cvar} 40%, transparent)` }}>
      {c.queueReason}
    </span>
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
function selfTouchLine(self) {
  if (!self) return 'This contact: no prior correspondence yet';
  if (self.fromRowStamp) return `This contact: last touch recorded ${self.date}, message not logged`;
  return `This contact: last ${self.direction === 'Received' ? 'reply received' : `${chLabel(self.channel)} sent`} ${relDaysAgo(self.date)} (${self.date})`;
}

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
  const selfLine = selfTouchLine(self);
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

// CRM statuses that mean the contact has already been reached out to. Once here,
// a LinkedIn "follow-up" is a real message (an InMail while unconnected, a free DM
// once accepted), not another connection note — so the draft must route to the
// followup-message endpoint, which reads the contact row directly, rather than
// connect-note, which resolves only from the connect/both queues that EXCLUDE these
// statuses (and would 400 with "Provide a recipient").
const CONTACTED_STATUSES = new Set(['Sent', 'Replied', 'Meeting Scheduled']);
// Already invited when we hold a per-contact LinkedIn touch OR the CRM status says so.
// Status is the reliable signal: selfLastTouch is derived from the correspondence-log
// index, which can be empty even after status advanced to Sent. The selfLastTouch check
// is channel-gated: an email touch does NOT count as a LinkedIn invite.
// The API base for a queue row, chosen by which BOOK the row came from.
//
// The old row components each hardcoded the target talent contact route. That
// was correct while the queue held only target talent, and became data corruption
// the moment referrals and influencers joined it: the books number rows
// independently, so Mark sent on referral 160 wrote a Sent entry onto
// target-talent 160, a different person, advancing their status, stamping their
// last touch and marking their invite pending. The endpoint is book-scoped by its
// own URL and cannot detect a caller aiming the wrong id at it, so the caller has
// to be right.
//
// The row already carries `source`; it was being used for the React key and the
// drop callback and then dropped when the URL was built.
//
// Influencers return null: they have no per-contact correspondence store, their
// touches live in the engagement log, and writing them into either contact book
// would be the same mistake in a new place. Callers must refuse instead.
function contactBase(c) {
  if (!c || c.id == null) return null;
  if (c.source === 'referral') return `/api/referrals/${c.id}`;
  if (c.source === 'influencer') return null;
  return `/api/target-talent/${c.id}`;
}

function isAlreadyInvited(c) {
  // Being CONNECTED is proof on its own: you cannot become a first-degree
  // connection without an invite having gone out and been accepted. Without this,
  // a row badged "Just connected" still routed to the first-touch endpoint and
  // drafted "would love to connect" to somebody already connected.
  //
  // It matters because the other two signals are target-talent-shaped and a
  // referral matches neither. CONTACTED_STATUSES holds TA vocabulary (Sent,
  // Replied, Meeting Scheduled) while a referral sits at "Not Asked", and
  // selfLastTouch now covers every contact book and also honors a row's stamped
  // last touch when the message body was never logged. Only a LinkedIn-channel
  // touch counts as a prior invite. When selfLastTouch exists with channel
  // 'email', skip the status fallback: the 'Sent' status was set by email, not
  // LinkedIn. When there is no selfLastTouch at all (the correspondence-log gap),
  // fall through to CONTACTED_STATUSES which trusts the TA status.
  if (c.linkedinStatus === 'Connected' || c.freeDm) return true;
  const slt = c.companyOutreach && c.companyOutreach.selfLastTouch;
  if (slt && slt.channel === 'linkedin') return true;
  if (slt && slt.channel === 'email') return false;
  return CONTACTED_STATUSES.has(c.status);
}

function followupChannels(c) {
  const channel = c && c.stickyChannel ? 'linkedin' : c && c.channel;
  return {
    linkedin: !!(c && c.linkedin && (channel === 'linkedin' || channel === 'both')),
    email: !!(c && c.email && (channel === 'email' || channel === 'both')),
  };
}

function DraftBlockBanner({ block }) {
  if (!block) return null;
  return <div className="card" style={{ borderColor: 'var(--yellow)', padding: 10, marginTop: 10, fontSize: 12 }}>
    {(block.blocks || []).map((item, i) => <div key={`${item.rule || 'block'}:${i}`}>{item.reason}</div>)}
    <div className="dim" style={{ marginTop: 5 }}>{block.nextEligible ? `You can reach out again on ${block.nextEligible}` : 'Blocked until they reply'}</div>
    {block.overridden && <div style={{ color: 'var(--yellow)', marginTop: 5 }}>Guardrail overridden for this draft.</div>}
  </div>;
}

function FollowupCard({ c, toast, onDone, onChannelDone, onSnooze, onMute, inmailRemaining, onInmailSent, onOpenContact }) {
  const [note, setNote] = useStateCq(null);
  const [liLoading, setLiLoading] = useStateCq(false);
  const [liSending, setLiSending] = useStateCq(false);
  const [showArchive, setShowArchive] = useStateCq(false);
  const [referred, setReferred] = useStateCq(false);
  const [liBlock, setLiBlock] = useStateCq(null);
  const [draft, setDraft] = useStateCq(null);
  const [emailBlock, setEmailBlock] = useStateCq(null);
  const [emLoading, setEmLoading] = useStateCq(false);
  const [emSending, setEmSending] = useStateCq(false);
  const channels = followupChannels(c);
  const [liDone, setLiDone] = useStateCq(!!c.linkedinDone || !channels.linkedin);
  const [emDone, setEmDone] = useStateCq(!!c.emailDone || !channels.email);
  const done = (channels.linkedin || channels.email) && liDone && emDone;
  // A contact you have ALREADY sent a LinkedIn invite (or any 1:1 touch) to: the
  // invite is out, so a "follow-up" is a real MESSAGE, not another connection note.
  // Keyed off the CRM status as well as selfLastTouch (see isAlreadyInvited) so a
  // Sent contact whose correspondence-log index has no self-entry still routes to
  // the followup-message endpoint instead of 400'ing against the connect queue.
  const alreadyInvited = isAlreadyInvited(c);
  // 1st-degree LinkedIn connection: a message is a FREE DM (no InMail credit).
  // Drives the copy and suppresses the budget decrement on mark-sent.
  const freeDm = c.linkedinStatus === 'Connected' || !!c.freeDm;
  // A short "X/Y touches" label for a contact resting at the cold-outreach cap.
  const capLabel = c.capState ? (
    c.channel === 'email' ? `${c.capState.email.sent}/${c.capState.email.cap} emails`
    : c.channel === 'both' ? `${c.capState.linkedin.sent}/${c.capState.linkedin.cap} LinkedIn + ${c.capState.email.sent}/${c.capState.email.cap} emails`
    : `${c.capState.linkedin.sent}/${c.capState.linkedin.cap} LinkedIn touches`
  ) : 'outreach cap reached';

  // Record that the invite went out, right here — no jumping to the Network tab.
  // Posts the note as a "Sent" correspondence to the contact's TA route, which
  // appends the message, advances status to Sent, and stamps
  // Last Touch. Passing the drafted note as the body is how "I used the AI note"
  // gets captured; a self-written invite records a short generic line instead.
  const base = contactBase(c);
  const firstName = c.firstName || (c.name || '').split(/\s+/)[0] || 'there';
  const href = channels.linkedin ? (/^https?:/.test(c.linkedin) ? c.linkedin : `https://${c.linkedin}`) : null;
  const finishChannel = (channel) => {
    const state = {
      linkedinDone: channel === 'linkedin' ? true : liDone,
      emailDone: channel === 'email' ? true : emDone,
    };
    if (onChannelDone) onChannelDone(c.source, c.id, state);
    else if (state.linkedinDone && state.emailDone && onDone) onDone(c.source, c.id);
  };

  const markLiSent = () => {
    if (liSending || liDone) return;
    setLiSending(true);
    if (!base) { setLiSending(false); toast && toast('Log this engagement from the Social tab: influencers have no correspondence store.', 'warn'); return; }
    const kind = alreadyInvited ? 'LinkedIn message' : 'LinkedIn connection request';
    const body = (note?.response || '').trim() || `${kind} sent to ${c.name || 'this contact'}.`;
    window.tjkMutate(`${base}/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // This card is the LinkedIn motion, so tag the channel explicitly. Without
      // it the server defaults to Email and the touch reads back as an email one,
      // hiding the sent DM from the just-connected warm queue (which re-pitched).
      body: JSON.stringify({ direction: 'Sent', channel: 'LinkedIn', subject: kind, body }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setLiSending(false); return; }
        setLiDone(true);
        setLiSending(false);
        toast && toast(`Marked sent — ${c.name || 'contact'}`, 'success');
        if (alreadyInvited && !freeDm && onInmailSent) onInmailSent();
        finishChannel('linkedin');
      })
      .catch(e => { toast && toast(e.message, 'error'); setLiSending(false); });
  };

  // Dispo a stale contact (left the company, or changed to an unrelated role) so
  // they stop cluttering the queue and never get outreach. Archives the contact
  // (status Archived + a dated reason note) and drops the row. If they moved to a
  // target company, re-add them fresh there — this only retires the stale record.
  const archive = (reason) => {
    if (liSending || emSending || done) return;
    setLiSending(true);
    window.tjkMutate('/api/linkedin-drafts/archive-contact', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id, reason }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setLiSending(false); return; }
        toast && toast(`Archived — ${c.name || 'contact'}`, 'success');
        if (onDone) onDone(c.source, c.id);
        else if (onChannelDone) onChannelDone(c.source, c.id, { linkedinDone: true, emailDone: true });
      })
      .catch(e => { toast && toast(e.message, 'error'); setLiSending(false); });
  };

  // Just-connected offer: promote this now-1st-degree contact into the Referrals
  // book (the user decides who is a real advocate; nothing auto-adds). Idempotent.
  const addToReferral = () => {
    if (c.source !== 'ta') return;
    const cbase = contactBase(c);
    window.tjkMutate(`${cbase}/to-referral`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        setReferred(true);
        toast && toast(res.alreadyReferral ? `${c.name || 'This contact'} is already in Referrals` : `Added ${c.name || 'contact'} to Referrals`, 'success');
      })
      .catch(e => toast && toast(e.message, 'error'));
  };

  const draftNote = (override = false) => {
    setLiLoading(true);
    window.tjkMutate(alreadyInvited ? '/api/linkedin-drafts/followup-message' : '/api/linkedin-drafts/connect-note', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id, override }),
    }).then(r => r.json())
      .then(res => { if (res.error) toast && toast(res.error, 'error'); else if (res.blocked) setLiBlock(res); else { setNote(res); if (override) setLiBlock(b => ({ ...b, overridden: true })); } })
      .catch(e => toast && toast(e.message, 'error'))
      .finally(() => setLiLoading(false));
  };
  const copy = () => {
    // navigator.clipboard is undefined on http / a LAN IP; guard so the button
    // does not throw, and never claim a copy that did not happen.
    const cp = navigator.clipboard?.writeText(note.response);
    if (cp) cp.then(() => toast && toast('Note copied', 'success'))
              .catch(() => toast && toast('Copy failed. Select the text and copy it manually', 'warn'));
    else toast && toast('Copy not available here. Select the text and copy it manually', 'warn');
  };
  const genEmail = (override = false) => {
    setEmLoading(true);
    if (!base) { setEmLoading(false); toast && toast('Log this from the Social tab: influencers have no correspondence store.', 'warn'); return; }
    window.tjkMutate(`${base}/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ override }) })
      .then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); return; }
        if (res.blocked) { setEmailBlock(res); return; }
        const d = res.draft || {};
        if (!d.body) { toast && toast('The model returned an empty draft. Try Redraft.', 'warn'); return; }
        const sig = (window.myEmailSignature && window.myEmailSignature()) || '';
        setDraft({ subject: (d.subject || '').trim(), body: `Hi ${firstName},\n\n${(d.body || '').trim()}${sig ? `\n\n${sig}` : ''}` });
        if (override) setEmailBlock(b => ({ ...b, overridden: true }));
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
    if (!base) { setEmSending(false); toast && toast('Log this from the Social tab: influencers have no correspondence store.', 'warn'); return; }
    const sentBody = (emBody || '').trim() || `Emailed ${c.name || 'this contact'}${c.company ? ` at ${c.company}` : ''}.`;
    window.tjkMutate(`${base}/correspondence`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ direction: 'Sent', subject: emSubject || 'Outreach email', body: sentBody }),
    }).then(r => r.json())
      .then(res => {
        if (res.error) { toast && toast(res.error, 'error'); setEmSending(false); return; }
        setEmDone(true);
        setEmSending(false);
        toast && toast(`Email logged (verified touch): ${c.name || 'contact'}`, 'success');
        finishChannel('email');
      })
      .catch(e => { toast && toast(e.message, 'error'); setEmSending(false); });
  };

  const chipStyle = (channelDone) => ({
    fontSize: 10, fontWeight: 700, letterSpacing: '.3px', padding: '2px 7px', borderRadius: 4, verticalAlign: 'middle',
    background: channelDone ? 'color-mix(in srgb, var(--green) 18%, transparent)' : 'var(--panel-2)',
    color: channelDone ? 'var(--green)' : 'var(--text-mute)',
    border: `1px solid ${channelDone ? 'color-mix(in srgb, var(--green) 45%, transparent)' : 'var(--border)'}`,
  });

  return (
    <div className="card" style={{ marginBottom: 12, borderLeft: '3px solid var(--accent)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {/* Name opens the contact drawer in place (correspondence + details) for
                referral / TA contacts, so you never leave the queue to read history.
                Influencers have no correspondence store, so their name is plain text.
                "Open ↗" still goes to their LinkedIn profile. */}
            {onOpenContact && (c.source === 'referral' || c.source === 'ta')
              ? <span role="button" tabIndex={0} onClick={() => onOpenContact(c)} onKeyDown={window.kbdActivate ? window.kbdActivate(() => onOpenContact(c)) : undefined}
                  title="Open contact details and correspondence"
                  style={{ cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'color-mix(in srgb, var(--accent) 45%, transparent)', textUnderlineOffset: 2 }}>{c.name || '(no name)'}</span>
              : (c.name || '(no name)')}{' '}
            <span className="dim" style={{ fontWeight: 400 }}>· {c.role || 'unknown role'}</span>
            {' '}<BookChip source={c.source} />
            {channels.linkedin && channels.email && c.isHighValue !== false ? <span title="High value: reachable on both email and LinkedIn. Worked on both channels."
              style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.4px', padding: '2px 6px', borderRadius: 4, background: 'var(--accent)', color: 'var(--panel)', verticalAlign: 'middle' }}>HIGH VALUE</span> : null}
            {c.isPrincipal ? <span title="Hiring principal: the decision-maker you would report to."
              style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, letterSpacing: '.3px', padding: '2px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)', border: '1px solid color-mix(in srgb, var(--accent) 45%, transparent)', verticalAlign: 'middle' }}>PRINCIPAL</span> : null}
            <OutreachPills c={c} />
            <QueueReasonPill c={c} />
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {c.company}{c.email ? <> · <span className="mono">{c.email}</span>{c.emailState === 'risky' ? <span title="Catch-all domain: usually deliverable."> · risky</span> : null}</> : null}
          </div>
          <CompanyOutreach c={c} />
          {channels.linkedin && alreadyInvited && !done && (
            <div className="dim" style={{ fontSize: 11, marginTop: 4, lineHeight: 1.4 }}>
              {freeDm
                ? <>They accepted your invite, so you're connected. This message is a free DM (no InMail credit). Strike while it's warm.</>
                : <>You already invited them, so a follow-up is a message, not another invite. While you are not connected, LinkedIn sends it as an InMail{typeof inmailRemaining === 'number' ? ` (${inmailRemaining} left this month)` : ' (uses a Premium credit)'}, so make it count.</>}
            </div>
          )}
          {c.capped && !done && (
            <div style={{ fontSize: 11, marginTop: 4, color: 'var(--orange)', lineHeight: 1.4 }}>
              Resting: {capLabel}, no reply. This contact has hit the cold-outreach cap. Messaging now overrides it; usually better to wait for a reply.
            </div>
          )}
          {!done && (
            <div className="dim" style={{ fontSize: 11, marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {/* Target talent only. The endpoint promotes a TA row by id, so on a
                  referral row it would have promoted whoever holds that id in the TA
                  book, and a referral is already in Referrals anyway. */}
              {channels.linkedin && c.queueReason === 'Just connected' && c.source === 'ta' && (referred
                ? <span style={{ color: 'var(--green)' }}>✓ Added to Referrals</span>
                : <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={addToReferral} disabled={liSending || emSending}
                    title="Now a 1st-degree connection. Add them to your Referrals list; they'll share a timeline with this TA record.">+ Add to Referrals</button>)}
              {!showArchive
                ? <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowArchive(true)} disabled={liSending || emSending}
                    title="Contact left the company or changed to an unrelated role? Archive them so they drop off and never get outreach.">Not reachable?</button>
                : <>
                    <span>Archive — reason:</span>
                    <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => archive('left-company')} disabled={liSending || emSending}>Left company</button>
                    <button className="btn sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => archive('changed-role')} disabled={liSending || emSending}>Changed role</button>
                    <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => setShowArchive(false)} disabled={liSending || emSending}>Cancel</button>
                  </>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'flex-start', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {/* This tracks the message the card asks you to send now, not whether this person was ever contacted. Calling it "not sent" caused intact contact history to look lost. */}
          {channels.linkedin ? <span style={chipStyle(liDone)}>LinkedIn {liDone ? '✓ sent' : 'to send'}</span> : null}
          {channels.email ? <span style={chipStyle(emDone)}>Email {emDone ? '✓ sent' : 'to send'}</span> : null}
          {onSnooze && !done ? <button className="btn ghost sm" title="Snooze this contact for 14 days (defers it without logging a touch)" onClick={() => onSnooze(c)} disabled={liSending || emSending}>💤 14d</button> : null}
          {onMute && !done ? <button className="btn ghost sm" title="Done for now. Removes them from the queue indefinitely without changing their status or logging a touch." onClick={() => onMute(c)} disabled={liSending || emSending}>Done for now</button> : null}
          {href ? <a className="btn ghost sm" href={href} target="_blank" rel="noreferrer">Open ↗</a> : null}
        </div>
      </div>

      {/* Two fixed lanes: LinkedIn always left, email always right, whether or not
          the other channel exists. These were flex: 1 1 300px, so a single-channel
          card stretched its one section across the full width and its internal
          space-between threw the buttons to the far right, landing them exactly
          where the EMAIL controls sit on a two-channel card. One card, two
          different homes for the same button, depending on the contact.

          A missing channel renders an EMPTY cell rather than being omitted; that
          empty cell is what holds the surviving lane in place. minmax(0, 1fr)
          rather than 1fr so a long draft cannot widen its own column and shove
          the other one sideways. */}
      {(channels.linkedin || channels.email) ? <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'flex-start' }}>
      {channels.linkedin ? <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>{alreadyInvited ? 'LinkedIn message' : 'LinkedIn invite'}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={liBlock ? "btn ghost sm" : "btn accent sm"} onClick={() => draftNote(!!liBlock)} disabled={liLoading || liDone}>{liLoading ? 'Drafting…' : liBlock ? 'Draft anyway' : (note ? (alreadyInvited ? 'Redraft message' : 'Redraft') : (alreadyInvited ? 'Draft message' : 'Draft note'))}</button>
            {liDone ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Sent</span> : <button className="btn sm" onClick={markLiSent} disabled={liSending}>{liSending ? 'Saving…' : 'Mark sent'}</button>}
          </div>
        </div>
        <DraftBlockBanner block={liBlock} />
        {note ? <div style={{ marginTop: 8 }}>
          <div style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, whiteSpace: 'pre-wrap' }}>{note.response}</div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <span className="dim mono" style={{ fontSize: 11 }}>{alreadyInvited ? `${note.length} chars` : `${note.length}/300 chars`}</span>
            <button className="btn sm" onClick={copy}>Copy</button>
          </div>
        </div> : null}
      </div> : null}

      {!channels.linkedin ? <div /> : null}

      {channels.email ? <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600 }}>Email</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={emailBlock ? "btn ghost sm" : "btn accent sm"} onClick={() => genEmail(!!emailBlock)} disabled={emLoading || emDone}>{emLoading ? 'Drafting…' : emailBlock ? 'Draft anyway' : (draft ? 'Redraft' : 'Draft email')}</button>
            {emDone ? <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600 }}>✓ Sent</span> : <button className="btn sm" onClick={markEmSent} disabled={emSending}>{emSending ? 'Saving…' : 'Mark sent'}</button>}
          </div>
        </div>
        <DraftBlockBanner block={emailBlock} />
        {draft ? <div style={{ marginTop: 8 }}>
          <input value={emSubject} onChange={e => setEmSubject(e.target.value)} placeholder="Subject"
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '6px 8px', marginBottom: 6, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)' }} />
          <textarea value={emBody} onChange={e => setEmBody(e.target.value)} rows={8}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, lineHeight: 1.5, padding: '8px 10px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', whiteSpace: 'pre-wrap', resize: 'vertical' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button className="btn sm" onClick={copyEmail}>Copy body</button>
            {mailtoUrl ? <a className="btn ghost sm" href={mailtoUrl}>Open in mail ↗</a> : null}
            <window.GmailDraftBtn to={c.email} subject={emSubject} body={emBody} size="sm" />
          </div>
        </div> : null}
      </div> : null}
      </div> : null}
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
        : queue.map(c => <FollowupCard key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} />)}
    </div>
  );
};

// ── Email queue ───────────────────────────────────────────────────────────────
// The email counterpart of the Connect queue: contacts with a sendable, verified
// address at companies you've applied to, that you haven't emailed yet. Draft an
// email, copy it, send it from your own client, then Mark sent — which logs a
// "Sent" correspondence (a VERIFIED TOUCH, since the subject is not a LinkedIn
// invite) and drops the row. This is the list that moves the 13/week touch floor.
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
        : queue.map(c => <FollowupCard key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} />)}
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
        : queue.map(c => <FollowupCard key={`${c.source}:${c.id}`} c={c} toast={toast} onChannelDone={onChannelDone} />)}
    </div>
  );
};

// ── Unified follow-up queue ─────────────────────────────────────────────────
// The single work queue that replaces the three channel tabs (Connect / Email /
// High value). Reads GET /api/followups/queue (one ranked, channel-tagged list)
// and renders each row with the same FollowupCard component.
// Channel becomes a filter chip instead of a tab. Rows arrive pre-ranked from the
// server (importance, then last-touch recency); we preserve that order.
// Exposed so the Follow-Ups → "Applications going stale" list renders each stale
// contact with the same card the main follow-up queue uses. Channel availability
// decides which action sections appear.
window.FollowupContactCard = function FollowupContactCard(props) {
  return <FollowupCard {...props} />;
};

window.FollowupQueueTab = function FollowupQueueTab({ toast, items, onReload }) {
  // When `items` is supplied (the Follow-Ups tab passes the single contact
  // follow-up list — the one source of truth), render those and let the parent
  // own reloads. With no `items`, this stays self-contained and fetches the
  // outreach queue itself (its original standalone behavior).
  const externalItems = Array.isArray(items);
  const [queue, setQueue] = useStateCq(externalItems ? items : null);
  const [err, setErr] = useStateCq(null);
  const [channel, setChannel] = useStateCq('all');
  const [book, setBook] = useStateCq('all');   // contact type: referral / ta / influencer
  const [showHeld, setShowHeld] = useStateCq(false);
  const [inmail, setInmail] = useStateCq(null);
  const [setBox, setSetBox] = useStateCq(false);
  const [setVal, setSetVal] = useStateCq('');
  const [recOpen, setRecOpen] = useStateCq(false);
  const [recText, setRecText] = useStateCq('');
  const [recBusy, setRecBusy] = useStateCq(false);
  const [recResult, setRecResult] = useStateCq(null);
  // The contact drawer popped in place from a row's name (correspondence + details),
  // holds the clicked queue row { source, id, ... }. Keeps the user in the queue.
  const [drawer, setDrawer] = useStateCq(null);
  // Who is hidden by "Done for now", read from the SERVER. The mute itself lives
  // in a data file, so the restore list has to come from there: keeping it in
  // localStorage meant clearing site data left contacts muted with nothing that
  // knew about them, which is the no-undo trap the control exists to avoid.
  const [mutedContacts, setMutedContacts] = useStateCq([]);
  const loadMuted = () => fetch('/api/followups/muted?sources=ta,referral,influencer').then(r => r.json())
    .then(d => setMutedContacts(Array.isArray(d.muted) ? d.muted : []))
    .catch(() => { /* the list is a convenience; never break the queue over it */ });

  const load = () => {
    if (externalItems) { onReload && onReload(); return; }
    return fetch('/api/followups/queue').then(r => r.json())
      .then(d => { if (d && d.error) setErr(d.error); else setQueue(d.queue || []); })
      .catch(e => setErr(e.message));
  };

  // Keep in sync when the parent re-supplies the list after a reload.
  useEffectCq(() => { if (externalItems) setQueue(items); }, [items]);
  useEffectCq(() => { if (!externalItems) load(); }, []);
  // On mount too, or a contact muted in an earlier session has no way back.
  useEffectCq(() => { loadMuted(); }, []);

  // InMail budget (LinkedIn Premium monthly credits). Fetched on mount; spent when
  // an InMail follow-up is marked sent; reconcilable to LinkedIn's real number.
  const loadInmail = () => fetch('/api/linkedin-drafts/inmail-budget').then(r => r.json())
    .then(d => { if (d && !d.error) setInmail(d); }).catch(() => {});
  useEffectCq(() => { loadInmail(); }, []);
  const spendInmail = () => window.tjkMutate('/api/linkedin-drafts/inmail-budget', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decrement: true }),
  }).then(r => r.json()).then(d => { if (d && !d.error) setInmail(d); }).catch(() => {});
  const saveInmail = () => {
    const n = parseInt(setVal, 10);
    if (isNaN(n)) { setSetBox(false); return; }
    window.tjkMutate('/api/linkedin-drafts/inmail-budget', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ set: n }),
    }).then(r => r.json()).then(d => { if (d && !d.error) setInmail(d); setSetBox(false); }).catch(() => setSetBox(false));
  };

  // Reconcile LinkedIn invites sent directly on LinkedIn (outside the app). The user
  // pastes their "Manage invitations → Sent" list; the server matches each to a
  // contact and (on apply) marks them 'Invite Pending' so the queue stops re-pitching
  // people who already have an invite out. Preview first, then apply.
  const runReconcile = (apply) => {
    if (recBusy || !recText.trim()) return;
    setRecBusy(true);
    window.tjkMutate('/api/followups/reconcile-sent-invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: recText, apply }),
    }).then(r => r.json()).then(d => {
      setRecBusy(false);
      if (d && d.error) { toast && toast(d.error, 'error'); return; }
      setRecResult(d);
      if (apply) { toast && toast(`Marked ${d.counts.newlyMarked} invite${d.counts.newlyMarked === 1 ? '' : 's'} pending`, 'success'); load(); }
    }).catch(e => { setRecBusy(false); toast && toast(e.message, 'error'); });
  };

  // Single-channel rows (LinkedIn / email) drop off after one touch; drop optimistically
  // then re-fetch so siblings at the same company refresh their "already reached out
  // today" context. Stable source:id keys keep in-progress drafts alive across the reload.
  const dropRow = (source, id) => {
    setQueue(q => (q || []).filter(c => !(c.source === source && String(c.id) === String(id))));
    load();
  };
  // A dual-channel ("both") row stays until BOTH channels are touched: update in place,
  // or remove once both are done.
  const onChannelDone = (source, id, state) => {
    const isRow = (c) => c.source === source && String(c.id) === String(id);
    setQueue(q => {
      const list = q || [];
      if (state && state.linkedinDone && state.emailDone) return list.filter(c => !isRow(c));
      return list.map(c => isRow(c) ? { ...c, linkedinDone: state.linkedinDone, emailDone: state.emailDone } : c);
    });
    load();
  };

  // Snooze a contact for 14 days: defer them without logging a touch. Drops the
  // row immediately, then reloads so the parent's single source of truth
  // (data.contactFollowups) re-partitions them into the Snoozed section.
  const snoozeContact = (c) => {
    window.tjkMutate('/api/followups/snooze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id, days: 14 }),
    }).then(async r => {
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || `Snooze failed (${r.status})`);
      toast && toast(`Snoozed 14 days — ${c.name || 'contact'}`, 'success');
      setQueue(q => (q || []).filter(x => !(x.source === c.source && String(x.id) === String(c.id))));
      load();
    }).catch(e => toast && toast(e.message, 'error'));
  };

  const muteContact = (c) => {
    window.tjkMutate('/api/followups/mute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id }),
    }).then(async r => {
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || `Mute failed (${r.status})`);
      toast && toast(`Done for now: ${c.name || 'contact'}`, 'success');
      setQueue(q => (q || []).filter(x => !(x.source === c.source && String(x.id) === String(c.id))));
      loadMuted();
      load();
    }).catch(e => toast && toast(e.message, 'error'));
  };

  const unmuteContact = (c) => {
    window.tjkMutate('/api/followups/unmute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: c.source, id: c.id }),
    }).then(async r => {
      const res = await r.json().catch(() => ({}));
      if (!r.ok || res.error) throw new Error(res.error || `Restore failed (${r.status})`);
      loadMuted();
      toast && toast(`Restored: ${c.name || 'contact'}`, 'success');
      load();
    }).catch(e => toast && toast(e.message, 'error'));
  };

  if (err) return <div className="dim" style={{ padding: 28 }}>Could not load the follow-up queue: {err}</div>;
  if (!queue) return <div className="dim" style={{ padding: 28 }}>Loading follow-up queue…</div>;

  // Same-day hold-off: a contact you should not message today because you already
  // reached out at their company today (touchedToday), or already sent to this exact
  // person today (selfSentToday). Hiding them prevents accidentally over-contacting a
  // company in one day. The signal is date-derived, so they reappear tomorrow on their
  // own and persist until actioned. "Show anyway" overrides for the current day.
  // The server (data.contactFollowups) is authoritative for both holds and sets them
  // as flags: heldDaily = the per-company daily cap (at most a few DIFFERENT contacts
  // per company per day, the rest held for a later day), inmailBlocked = a LinkedIn
  // follow-up you cannot send with 0 InMail credits. The standalone queue endpoint
  // (/api/followups/queue) does not set these, so fall back to a per-row estimate there.
  const CONTACTED_STATUS = { Sent: 1, Replied: 1, 'Meeting Scheduled': 1 };
  const outOfInmail = !!(inmail && inmail.remaining === 0);
  // A message to a 1st-degree connection (freeDm) is a free DM, not an InMail, so it
  // is NEVER blocked by an empty credit balance — this is what makes the "Just
  // connected" motion still actionable when you are out of InMail. The fallback keys on
  // alreadyInvited (selfLastTouch OR a contacted status), matching the send button, so a
  // pending invite whose touch is not yet logged is still recognized as InMail-needing.
  const isInmailBlocked = (c) => (c.inmailBlocked !== undefined)
    ? !!c.inmailBlocked
    : (outOfInmail && c.channel === 'linkedin' && !c.freeDm
        && (!!(c.companyOutreach && c.companyOutreach.selfLastTouch) || !!CONTACTED_STATUS[c.status]));
  const isHeldDaily = (c) => (c.heldDaily !== undefined)
    ? !!c.heldDaily
    : !!(c.companyOutreach && (c.companyOutreach.touchedToday || c.companyOutreach.selfSentToday));
  const isHeld = (c) => isHeldDaily(c) || isInmailBlocked(c);
  // Cold-outreach cap reached with no reply (server sets c.capped). Unlike the
  // daily / InMail holds, resting does not clear on its own; it lifts when the
  // contact replies. Hidden by default, revealed and overridable via Show anyway.
  const isCapped = (c) => !!c.capped;
  // Actionable == the server found no active block (blocks.length === 0), the same
  // definition the nav badge counts. Anything with a block is something you cannot
  // send right now, so it does not belong in the queue view — a contact should not
  // appear if there is no move to make. Held/capped are specific block kinds already
  // handled above; this catches the rest (recently contacted → gap, or awaiting a
  // reply). blocks is absent on the standalone /queue endpoint, so fall back to the
  // held/capped estimates there rather than showing everything.
  const isBlocked = (c) => Array.isArray(c.blocks) && c.blocks.length > 0;
  // Time-gated blocks (gap / awaiting reply) that are not the daily/InMail hold or the
  // cold-cap rest. These clear on their own on the contact's nextEligible date.
  const isWaiting = (c) => isBlocked(c) && !isHeld(c) && !isCapped(c);
  const isHiddenRow = (c) => isHeld(c) || isCapped(c) || isBlocked(c);
  const heldCount = queue.filter(isHeld).length;
  const restingCount = queue.filter(isCapped).length;
  const waitingCount = queue.filter(isWaiting).length;
  const anyDaily = queue.some(isHeldDaily);
  const anyInmailOut = queue.some(isInmailBlocked);
  const heldReasons = [
    anyDaily ? 'that company already has its allotment of contacts queued for today' : null,
    anyInmailOut ? 'you are out of InMail credits this month' : null,
  ].filter(Boolean).join('; ');
  const base = showHeld ? queue : queue.filter(c => !isHiddenRow(c));
  const counts = {
    all: base.length,
    linkedin: base.filter(c => c.channel === 'linkedin').length,
    email: base.filter(c => c.channel === 'email').length,
    both: base.filter(c => c.channel === 'both').length,
  };
  const CHIPS = [
    { id: 'all', label: 'All' },
    { id: 'linkedin', label: 'LinkedIn' },
    { id: 'email', label: 'Email' },
    { id: 'both', label: 'Both' },
  ];
  // Contact type, alongside channel. The queue merges three books that used to be
  // separate tabs, and 140 referrals can bury 15 TA contacts, so "show me only the
  // warm ones" has to be one click.
  //
  // Counts are computed against the CHANNEL-filtered set, not the whole queue, so
  // the two filters describe what you will actually see when you combine them. A
  // count that ignores the other filter reads as a bug the first time you click
  // both and get fewer rows than the number promised.
  const bookBase = channel === 'all' ? base : base.filter(c => c.channel === channel);
  const bookCounts = {
    all: bookBase.length,
    referral: bookBase.filter(c => c.source === 'referral').length,
    ta: bookBase.filter(c => c.source === 'ta').length,
    influencer: bookBase.filter(c => c.source === 'influencer').length,
  };
  const BOOK_CHIPS = [
    { id: 'all', label: 'All' },
    { id: 'referral', label: 'Referral' },
    { id: 'ta', label: 'TA' },
    { id: 'influencer', label: 'Influencer' },
  ];
  const rows = book === 'all' ? bookBase : bookBase.filter(c => c.source === book);

  return (
    <div style={{ padding: 24, maxWidth: "none", marginLeft: 0, marginRight: 0 }}>
      <h2 style={{ margin: '0 0 2px' }}>Follow-ups</h2>
      <p className="dim" style={{ fontSize: 13, marginTop: 4, marginBottom: 14 }}>
        One ranked queue of everyone worth a touch, across every channel. Rows are ordered by importance
        (hiring principals and dual-channel contacts first), then by how overdue the last touch is. Draft,
        copy, send by hand, then Mark sent. Nothing is sent from here.
      </p>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        <span className="dim mono" style={{ fontSize: 10.5, marginRight: 2 }}>CHANNEL</span>
        {CHIPS.map(ch => {
          const active = channel === ch.id;
          const n = counts[ch.id];
          return (
            <span key={ch.id} onClick={() => setChannel(ch.id)} style={{
              cursor: 'pointer', padding: '4px 11px', borderRadius: 5, fontSize: 11.5, fontWeight: 600,
              background: active ? 'var(--accent)' : 'var(--panel-2)',
              color: active ? '#15101f' : 'var(--text-dim)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
            }}>{ch.label} <span style={{ opacity: 0.7, marginLeft: 3 }}>{n}</span></span>
          );
        })}
        {/* Contact type, pushed to the right of the same row so the two filters read
            as one control strip rather than stacking and eating vertical space. */}
        <span style={{ flex: '1 1 auto' }} />
        <span className="dim mono" style={{ fontSize: 10.5, marginRight: 2 }}>CONTACT TYPE</span>
        {BOOK_CHIPS.map(bk => {
          const active = book === bk.id;
          const n = bookCounts[bk.id];
          // The active chip takes the book's own color, so the filter and the row
          // chips agree: click the green one, get the green rows.
          const cvar = bk.id === 'all' ? 'var(--accent)' : (BOOK_META[bk.id] || {}).cvar || 'var(--accent)';
          return (
            <span key={bk.id} onClick={() => setBook(bk.id)} style={{
              cursor: 'pointer', padding: '4px 11px', borderRadius: 5, fontSize: 11.5, fontWeight: 600,
              background: active ? cvar : 'var(--panel-2)',
              color: active ? '#15101f' : 'var(--text-dim)',
              border: `1px solid ${active ? cvar : 'var(--border)'}`,
            }}>{bk.label} <span style={{ opacity: 0.7, marginLeft: 3 }}>{n}</span></span>
          );
        })}
      </div>
      {inmail && (
        <div className="dim" style={{ fontSize: 12, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span>InMail credits: <b style={{ color: inmail.remaining === 0 ? 'var(--red)' : inmail.remaining <= 3 ? 'var(--orange)' : 'var(--text)' }}>{inmail.remaining}</b> of {inmail.allotment} left this month</span>
          {setBox
            ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <input type="number" min="0" max="99" value={setVal} onChange={e => setSetVal(e.target.value)} style={{ width: 52, fontSize: 12, padding: '2px 6px', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)' }} />
                <button className="btn accent sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={saveInmail}>Save</button>
                <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setSetBox(false)}>Cancel</button>
              </span>
            : <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 8px' }} title="Set this to the number LinkedIn actually shows. It refunds InMails that get a reply and rolls credits over, so the two can drift." onClick={() => { setSetVal(String(inmail.remaining)); setSetBox(true); }}>Set</button>}
          {inmail.remaining > 0 && inmail.remaining <= 3 && <span style={{ color: 'var(--orange)' }}>Low. Spend them on your highest-value contacts (top of the list).</span>}
          {inmail.remaining === 0 && <span style={{ color: 'var(--red)' }}>Out. LinkedIn follow-ups to non-connections are hidden until your credits reset.</span>}
        </div>
      )}
      <div className="dim" style={{ fontSize: 12, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn sm" style={{ fontSize: 12, padding: '5px 12px', fontWeight: 600 }} onClick={() => setRecOpen(v => !v)}
            title="Capture LinkedIn invites you sent directly on LinkedIn, so the queue stops re-pitching people who already have a pending invite out.">
            🔗 Reconcile LinkedIn sent invites {recOpen ? '▾' : '▸'}
          </button>
          {!recOpen && <span>Invited people directly on LinkedIn? Import your Sent list so the queue stops re-pitching them.</span>}
        </div>
        {recOpen && (
          <div style={{ marginTop: 8, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: 11 }}>
            <div style={{ marginBottom: 6 }}>
              Open LinkedIn → <b>My Network → Manage invitations → Sent</b>, select all, copy, and paste below. We match each
              pending invite to a contact and mark them "Invite Pending" so the queue stops re-pitching people you already
              invited. Nothing is sent to LinkedIn.
            </div>
            <textarea value={recText} onChange={e => setRecText(e.target.value)} rows={5}
              placeholder="Paste your LinkedIn 'Sent invitations' list here…"
              style={{ width: '100%', fontSize: 12, padding: 8, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text)', fontFamily: 'inherit', boxSizing: 'border-box' }} />
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <button className="btn sm" disabled={recBusy || !recText.trim()} onClick={() => runReconcile(false)}>{recBusy ? 'Matching…' : 'Preview'}</button>
              <button className="btn accent sm" disabled={recBusy || !(recResult && recResult.counts && recResult.counts.newlyMarked)} onClick={() => runReconcile(true)}>
                Apply{recResult && recResult.counts ? ` (${recResult.counts.newlyMarked})` : ''}
              </button>
            </div>
            {recResult && recResult.counts && (
              <div style={{ marginTop: 8 }}>
                <div>Parsed {recResult.counts.parsed} · <b style={{ color: 'var(--accent)' }}>{recResult.counts.newlyMarked} to mark</b> · {recResult.counts.alreadyRecorded} already on file · {recResult.counts.ambiguous} ambiguous · {recResult.counts.unmatched} unmatched.</div>
                {recResult.newlyMarked && recResult.newlyMarked.length > 0 && <div style={{ marginTop: 4 }}>{recResult.applied ? 'Marked: ' : 'Will mark: '}{recResult.newlyMarked.map(x => x.name).join(', ')}</div>}
                {recResult.ambiguous && recResult.ambiguous.length > 0 && <div style={{ marginTop: 4, color: 'var(--orange)' }}>Ambiguous (skipped, resolve by hand): {recResult.ambiguous.map(a => a.name).join(', ')}</div>}
              </div>
            )}
          </div>
        )}
      </div>
      {(heldCount > 0 || restingCount > 0 || waitingCount > 0 || mutedContacts.length > 0) && (
        <div className="dim" style={{ fontSize: 12, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 11px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 240 }}>
            {heldCount > 0 && <span>{heldCount} contact{heldCount === 1 ? '' : 's'} hidden right now ({heldReasons}). They return automatically once that clears (tomorrow, or when your InMail credits reset).</span>}
            {waitingCount > 0 && <span>{waitingCount} contact{waitingCount === 1 ? '' : 's'} recently contacted — waiting out the gap between touches. They return on their own once eligible.</span>}
            {restingCount > 0 && <span>{restingCount} contact{restingCount === 1 ? '' : 's'} resting — reached the outreach cap with no reply. They stay parked here until they reply, or you message anyway.</span>}
            {mutedContacts.length > 0 && <span>
              {mutedContacts.length} contact{mutedContacts.length === 1 ? '' : 's'} marked Done for now.{' '}
              {mutedContacts.map((c, i) => <span key={`${c.source}:${c.id}`}>{i ? ', ' : ''}<button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 6px' }} onClick={() => unmuteContact(c)}>Restore {c.name}</button></span>)}
            </span>}
          </div>
          {(heldCount > 0 || restingCount > 0 || waitingCount > 0) ? <button className="btn ghost sm" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setShowHeld(v => !v)}>
            {showHeld ? 'Hide them' : 'Show anyway'}
          </button> : null}
        </div>
      )}
      {rows.length === 0
        ? <div className="card dim">
            {queue.length === 0
              ? 'Your follow-up queue is clear. Contacts appear here once you apply to a company where you have someone to reach.'
              : base.length === 0
                ? 'Nothing to send right now: the remaining contacts are held (you already reached out at their company today, or you are out of InMail credits). They return automatically.'
                : `No ${channel} contacts in the queue right now.`}
          </div>
        : rows.map(c => <FollowupCard key={`${c.source}:${c.id}`} c={c} toast={toast} onDone={dropRow} onChannelDone={onChannelDone} onSnooze={snoozeContact} onMute={muteContact} inmailRemaining={inmail ? inmail.remaining : undefined} onInmailSent={spendInmail} onOpenContact={setDrawer} />)}

      {/* Contact drawer, popped in place from a row's name. Referral and TA rows
          open their own by-id drawers (each fetches its own detail, so an id from
          one book never resolves against the other). A refresh reloads the queue so
          any status / touch change made in the drawer is reflected immediately. */}
      {drawer && drawer.source === 'referral' && window.ReferralDrawerById && (
        <window.ReferralDrawerById id={drawer.id} onClose={() => setDrawer(null)} onChanged={load} />
      )}
      {drawer && drawer.source === 'ta' && window.TargetTalentDrawer && (
        <window.TargetTalentDrawer id={drawer.id} onClose={() => setDrawer(null)} onUpdate={load} />
      )}
    </div>
  );
};
