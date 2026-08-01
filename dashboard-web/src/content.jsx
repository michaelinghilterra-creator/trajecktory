// Content tab — track per-post performance for the LinkedIn/X content series and
// draft on-message replies to comments. Reads and writes the SAME posts store as
// the LinkedIn > Posts composer (/api/posts), so a post drafted there can be
// tracked here. Three subtabs: Tracker (log metrics), Reply (AI comment reply),
// Rollup (what works, by type).
const { useState: useStateC, useEffect: useEffectC, useMemo: useMemoC } = React;

const CONTENT_TYPES = ['origin', 'builder', 'myth', 'rigor', 'craft', 'service', 'journey', 'product', 'serial'];
const CONTENT_SUBTABS = [
  { key: 'publish', label: 'Publish' },
  { key: 'tracker', label: 'Tracker' },
  { key: 'reply', label: 'Reply to a comment' },
  { key: 'rollup', label: 'What works' },
];
// Metric fields shown in the per-post editor. Numbers only; engagement rate is derived.
const METRIC_FIELDS = [
  { k: 'impressions', label: 'Impressions' },
  { k: 'reactions', label: 'Reactions' },
  { k: 'comments', label: 'Comments' },
  { k: 'reposts', label: 'Reposts' },
  { k: 'saves', label: 'Saves' },
  { k: 'linkClicks', label: 'Link clicks' },
  { k: 'profileViews', label: 'Profile views' },
  { k: 'followers', label: 'New followers' },
  { k: 'connReqs', label: 'Conn. requests' },
  { k: 'inboundDms', label: 'Inbound DMs' },
  { k: 'repoClicks', label: 'Repo clicks' },
  { k: 'repoStars', label: 'Repo stars' },
];

const cInput = { background: 'transparent', border: '1px solid var(--border-2)', borderRadius: 6, padding: '4px 8px', color: 'inherit', font: 'inherit' };

function engRateOf(m) {
  if (!m || !m.impressions) return null;
  const eng = (m.reactions || 0) + (m.comments || 0) + (m.reposts || 0) + (m.saves || 0);
  return eng / m.impressions;
}
function pct(n) { return n == null ? '—' : (n * 100).toFixed(1) + '%'; }
function postLabel(p) {
  if (p.title && p.title.trim()) return p.title.trim();
  const first = String(p.text || '').split('\n').find(l => l.trim());
  return first ? (first.length > 80 ? first.slice(0, 80) + '…' : first) : '(untitled)';
}
// Human-friendly schedule time. The stored value is the user's local time, so
// showing it in the browser's locale matches what they picked.
function fmtWhen(s) {
  if (!s) return 'no date set';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// Mirror of the server's thread splitter: how many tweets an X post breaks into.
function threadCountOf(text) {
  return String(text || '').split(/\n\n(?=\d+\/\s)/).map(x => x.trim()).filter(Boolean).length;
}

// ── One post row in the Tracker, with an expandable details + metrics editor ────
function ContentPostCard({ post, onChanged, onReply, toast }) {
  const [open, setOpen] = useStateC(false);
  const [m, setM] = useStateC(() => {
    const base = {}; METRIC_FIELDS.forEach(f => { base[f.k] = (post.metrics && post.metrics[f.k]) || 0; });
    base.whoEngaged = (post.metrics && post.metrics.whoEngaged) || '';
    base.notes = (post.metrics && post.metrics.notes) || '';
    return base;
  });
  const [saving, setSaving] = useStateC(false);
  const rate = engRateOf(post.metrics);
  const autoFields = (post.metrics && post.metrics.autoFields) || [];

  const patch = (body) => window.tjkMutate(`/api/posts/${post.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => { if (!r.ok) throw new Error(); onChanged(); }).catch(() => toast && toast('Could not save. Is the server running?', 'warn'));

  const saveMetrics = () => {
    setSaving(true);
    window.tjkMutate(`/api/posts/${post.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ metrics: m }) })
      .then(r => { if (!r.ok) throw new Error(); onChanged(); toast && toast('Metrics saved', 'ok'); })
      .catch(() => toast && toast('Could not save metrics', 'warn'))
      .finally(() => setSaving(false));
  };
  const del = () => { if (!window.confirm('Remove this post from the tracker?')) return;
    window.tjkMutate(`/api/posts/${post.id}`, { method: 'DELETE' }).then(r => { if (!r.ok) throw new Error(); onChanged(); }).catch(() => toast && toast('Could not delete', 'warn'));
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ flex: 1, minWidth: 160 }}>{postLabel(post)}</strong>
        {post.type ? <span className="pill">{post.type}</span> : null}
        <span className="pill">{post.channel === 'x' ? 'X' : 'LinkedIn'}</span>
        <span className="pill" style={{ color: post.status === 'published' ? 'var(--green)' : 'var(--text-mute)' }}>{post.status}</span>
        <span className="pill mono" title="Engagement rate = (reactions+comments+reposts+saves) / impressions">ER {pct(rate)}</span>
        {autoFields.length ? <span className="pill" style={{ color: 'var(--accent)' }} title={`Synced from Buffer: ${autoFields.join(', ')}`}>⟳ Buffer</span> : null}
        <button className="btn ghost sm" onClick={() => setOpen(o => !o)}>{open ? 'Hide' : 'Metrics'}</button>
        <button className="btn ghost sm" onClick={() => onReply(post)}>Reply</button>
        <button className="btn ghost sm" onClick={del} title="Remove">✕</button>
      </div>

      {open ? (
        <div className="col" style={{ gap: 12, marginTop: 12 }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <label className="dim" style={{ fontSize: 12 }}>Type
              <select style={{ ...cInput, marginLeft: 6 }} value={post.type || ''} onChange={e => patch({ type: e.target.value })}>
                <option value="">(none)</option>
                {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="dim" style={{ fontSize: 12 }}>Channel
              <select style={{ ...cInput, marginLeft: 6 }} value={post.channel} onChange={e => patch({ channel: e.target.value })}>
                <option value="linkedin">LinkedIn</option>
                <option value="x">X</option>
              </select>
            </label>
            <label className="dim" style={{ fontSize: 12 }}>Status
              <select style={{ ...cInput, marginLeft: 6 }} value={post.status} onChange={e => patch({ status: e.target.value })}>
                <option value="draft">draft</option>
                <option value="queued">queued</option>
                <option value="scheduled">scheduled</option>
                <option value="published">published</option>
              </select>
            </label>
          </div>

          {autoFields.length ? <div className="dim" style={{ fontSize: 11 }}>Fields marked <span style={{ color: 'var(--accent)' }}>⟳</span> were synced from Buffer. You can still edit any of them; the rest you fill in by hand.</div> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {METRIC_FIELDS.map(f => (
              <label key={f.k} className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span>{f.label}{autoFields.includes(f.k) ? <span style={{ color: 'var(--accent)' }} title="Synced from Buffer"> ⟳</span> : null}</span>
                <input type="number" min="0" style={cInput} value={m[f.k]}
                  onChange={e => setM(s => ({ ...s, [f.k]: e.target.value }))} />
              </label>
            ))}
          </div>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            Who engaged (titles / companies of the people who reacted or viewed — your hire-me signal)
            <input type="text" style={cInput} value={m.whoEngaged} onChange={e => setM(s => ({ ...s, whoEngaged: e.target.value }))} />
          </label>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            Notes (what worked / flopped)
            <input type="text" style={cInput} value={m.notes} onChange={e => setM(s => ({ ...s, notes: e.target.value }))} />
          </label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="btn primary sm" onClick={saveMetrics} disabled={saving}>{saving ? 'Saving…' : 'Save metrics'}</button>
            <span className="mono dim" style={{ fontSize: 12 }}>Engagement rate: {pct(engRateOf({ ...m, impressions: Number(m.impressions) || 0 }))}</span>
            {post.metrics && post.metrics.checkedAt ? <span className="dim" style={{ fontSize: 11 }}>last saved {new Date(post.metrics.checkedAt).toLocaleDateString()}</span> : null}
            {post.metrics && post.metrics.bufferAt ? <span className="dim" style={{ fontSize: 11 }}>· Buffer {new Date(post.metrics.bufferAt).toLocaleDateString()}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Add-a-post form ─────────────────────────────────────────────────────────────
function AddPostForm({ onAdded, toast }) {
  const [label, setLabel] = useStateC('');
  const [type, setType] = useStateC('');
  const [channel, setChannel] = useStateC('linkedin');
  const [link, setLink] = useStateC('');
  const [busy, setBusy] = useStateC(false);

  const add = () => {
    const text = label.trim();
    if (!text) { toast && toast('Give the post a label first', 'warn'); return; }
    setBusy(true);
    window.tjkMutate('/api/posts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, title: text, type, channel, lane: channel === 'x' ? 'trajecktory' : 'professional', linkComment: link.trim(), status: 'published', source: 'user' }),
    }).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => { setLabel(''); setLink(''); setType(''); onAdded(); toast && toast('Added to tracker', 'ok'); })
      .catch(() => toast && toast('Could not add post', 'warn'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2, flex: 2, minWidth: 200 }}>
          Post label / hook
          <input type="text" style={cInput} value={label} placeholder="Short label for this post" onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        </label>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          Type
          <select style={cInput} value={type} onChange={e => setType(e.target.value)}>
            <option value="">(none)</option>
            {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
          Channel
          <select style={cInput} value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="linkedin">LinkedIn</option>
            <option value="x">X</option>
          </select>
        </label>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 140 }}>
          Link (optional)
          <input type="text" style={cInput} value={link} placeholder="tracked repo link" onChange={e => setLink(e.target.value)} />
        </label>
        <button className="btn primary sm" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  );
}

// ── Pull engagement from Buffer into the tracker ────────────────────────────────
// One button that syncs live metrics for every post we pushed to Buffer. Buffer
// collects metrics on a daily cadence, so numbers land up to ~24h after a post
// publishes; before that a post reports "not published yet". Off-platform signals
// (profile views, DMs, repo stars) Buffer can't see, so those stay manual.
function MetricsSync({ posts, onSynced, toast }) {
  const [busy, setBusy] = useStateC(false);
  const [res, setRes] = useStateC(null);
  const onBufferCount = posts.filter(p => p.buffer && p.buffer.id).length;

  const sync = () => {
    setBusy(true); setRes(null);
    window.tjkMutate('/api/posts/pull-metrics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Sync failed'); return d; })
      .then(d => { setRes(d); onSynced && onSynced(); toast && toast(`${d.synced} synced${d.pending ? `, ${d.pending} pending` : ''}`, d.failed ? 'warn' : 'ok'); })
      .catch(e => toast && toast(e.message || 'Metrics sync failed', 'warn'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ fontSize: 13 }}>Engagement from Buffer</strong>
        <span className="dim" style={{ fontSize: 12 }}>{onBufferCount} post{onBufferCount === 1 ? '' : 's'} on Buffer · auto-fills impressions, reactions, comments, reposts, saves, clicks, followers</span>
        <button className="btn primary sm" style={{ marginLeft: 'auto' }} onClick={sync} disabled={busy || !onBufferCount}>{busy ? 'Syncing…' : 'Sync from Buffer'}</button>
      </div>
      {res ? (
        <div className="dim" style={{ fontSize: 12, marginTop: 8 }}>
          {res.synced} synced{res.pending ? `, ${res.pending} not published yet (metrics land ~24h after posting)` : ''}{res.failed ? `, ${res.failed} failed` : ''}.{res.note ? ' ' + res.note : ''}
        </div>
      ) : (
        <div className="dim" style={{ fontSize: 11, marginTop: 6, lineHeight: 1.5 }}>Buffer collects metrics daily, so numbers appear up to ~24h after each post publishes. The off-platform signals (profile views, connection requests, DMs, repo clicks/stars) you still fill in yourself.</div>
      )}
    </div>
  );
}

// ── Reply-to-a-comment tool ─────────────────────────────────────────────────────
function ReplyTool({ posts, initialPostId, toast }) {
  const [postId, setPostId] = useStateC(initialPostId || '');
  const [comment, setComment] = useStateC('');
  const [tone, setTone] = useStateC('');
  const [reply, setReply] = useStateC('');
  const [busy, setBusy] = useStateC(false);

  useEffectC(() => { if (initialPostId) setPostId(initialPostId); }, [initialPostId]);

  const gen = () => {
    if (!comment.trim()) { toast && toast('Paste the comment first', 'warn'); return; }
    setBusy(true); setReply('');
    const post = posts.find(p => p.id === postId);
    window.tjkMutate('/api/posts/reply', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ comment: comment.trim(), postText: post ? post.text : '', tone: tone.trim() }),
    }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Reply failed'); setReply(d.reply || ''); })
      .catch(e => toast && toast(e.message || 'Could not generate a reply', 'warn'))
      .finally(() => setBusy(false));
  };
  const copy = () => { try { navigator.clipboard.writeText(reply); toast && toast('Reply copied', 'ok'); } catch { toast && toast('Copy failed', 'warn'); } };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 12 }}>
        <div className="col" style={{ gap: 10 }}>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            Which post is the comment on? (gives the reply context — optional)
            <select style={cInput} value={postId} onChange={e => setPostId(e.target.value)}>
              <option value="">(no specific post)</option>
              {posts.map(p => <option key={p.id} value={p.id}>{postLabel(p)} · {p.channel === 'x' ? 'X' : 'LinkedIn'}</option>)}
            </select>
          </label>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            Paste the comment you want to reply to
            <textarea style={{ ...cInput, minHeight: 90, resize: 'vertical' }} value={comment} onChange={e => setComment(e.target.value)} placeholder="Paste the exact comment here…" />
          </label>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
            Tone note (optional, e.g. "extra warm", "they disagree, stay gracious")
            <input type="text" style={cInput} value={tone} onChange={e => setTone(e.target.value)} />
          </label>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={gen} disabled={busy}>{busy ? 'Drafting…' : 'Generate reply'}</button>
          </div>
        </div>
      </div>

      {reply ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ flex: 1 }}>Suggested reply</strong>
            <button className="btn ghost sm" onClick={gen} disabled={busy}>Regenerate</button>
            <button className="btn primary sm" onClick={copy}>Copy</button>
          </div>
          <textarea style={{ ...cInput, width: '100%', minHeight: 90, resize: 'vertical' }} value={reply} onChange={e => setReply(e.target.value)} />
          <div className="dim" style={{ fontSize: 11, marginTop: 6 }}>Edit before you post it. Stays on-message: no offer/screen counts, ratios not raw personal numbers, no em dashes.</div>
        </div>
      ) : null}
    </div>
  );
}

// ── Rollup: what works, averaged by type ────────────────────────────────────────
function Rollup({ posts }) {
  const rows = useMemoC(() => {
    const by = {};
    posts.forEach(p => {
      const t = p.type || '(untyped)';
      if (!by[t]) by[t] = { type: t, n: 0, rateSum: 0, rateN: 0, dms: 0, repo: 0 };
      by[t].n += 1;
      const r = engRateOf(p.metrics);
      if (r != null) { by[t].rateSum += r; by[t].rateN += 1; }
      if (p.metrics) { by[t].dms += p.metrics.inboundDms || 0; by[t].repo += p.metrics.repoClicks || 0; }
    });
    return Object.values(by).sort((a, b) => (b.rateN ? b.rateSum / b.rateN : 0) - (a.rateN ? a.rateSum / a.rateN : 0));
  }, [posts]);

  if (!posts.length) return <div className="card" style={{ padding: 16 }}><span className="dim">Add and track a few posts first, then this shows which types perform best.</span></div>;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="dim" style={{ fontSize: 12, marginBottom: 8 }}>Averaged by type. Wait for several posts per type before trusting it — one hit is not a pattern.</div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--text-mute)' }}>
            <th style={{ padding: '6px 8px' }}>Type</th><th style={{ padding: '6px 8px' }}>Posts</th>
            <th style={{ padding: '6px 8px' }}>Avg ER</th><th style={{ padding: '6px 8px' }}>Inbound DMs</th><th style={{ padding: '6px 8px' }}>Repo clicks</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.type} style={{ borderTop: '1px solid var(--border-2)' }}>
                <td style={{ padding: '6px 8px' }}>{r.type}</td>
                <td style={{ padding: '6px 8px' }}>{r.n}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.rateN ? pct(r.rateSum / r.rateN) : '—'}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.dms}</td>
                <td style={{ padding: '6px 8px' }} className="mono">{r.repo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Publish: select posts, review them, push to Buffer ──────────────────────────
// The whole point of the feature: schedule posts to LinkedIn / X without leaving
// trajecktory and without copy-paste. Buffer does the actual publishing at each
// post's scheduled time. Cautious by design: nothing is selected by default, a
// Preview (dry run) shows exactly what would happen, and the real push confirms
// first. The 10-per-channel free-plan cap is handled server-side (earliest first;
// the rest wait for a slot).
const RESULT_COLOR = { scheduled: 'var(--green)', ready: 'var(--green)', already: 'var(--text-mute)', waiting: 'var(--orange)', error: 'var(--red)', 'no-channel': 'var(--red)' };

function PublishReviewRow({ post, checked, onToggle, open, onOpen }) {
  const isX = post.channel === 'x';
  const parts = isX ? threadCountOf(post.text) : 0;
  const noDate = !post.scheduledFor;
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input type="checkbox" checked={!!checked} disabled={noDate} onChange={onToggle} style={{ width: 16, height: 16 }} />
        <strong style={{ flex: 1, minWidth: 160 }}>{postLabel(post)}</strong>
        {post.type ? <span className="pill">{post.type}</span> : null}
        <span className="pill">{isX ? 'X' : 'LinkedIn'}</span>
        {isX && parts > 1 ? <span className="pill">{parts}-tweet thread</span> : null}
        {!isX && post.linkComment ? <span className="pill" title={post.linkComment}>first comment</span> : null}
        <span className="pill mono" style={{ color: noDate ? 'var(--red)' : 'var(--text-mute)' }}>{fmtWhen(post.scheduledFor)}</span>
        <button className="btn ghost sm" onClick={onOpen}>{open ? 'Hide' : 'Review'}</button>
      </div>
      {noDate ? <div className="dim" style={{ fontSize: 11, marginTop: 6, color: 'var(--orange)' }}>No scheduled date yet. Set one in Social → Posts before pushing.</div> : null}
      {open ? (
        <div className="col" style={{ gap: 8, marginTop: 10 }}>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, padding: 10, background: 'var(--panel-2, rgba(127,127,127,.08))', borderRadius: 6, fontSize: 12.5, lineHeight: 1.5, maxHeight: 320, overflow: 'auto', font: 'inherit' }}>{post.text}</pre>
          {!isX && post.linkComment ? <div className="dim" style={{ fontSize: 12 }}><b>First comment:</b> {post.linkComment}</div> : null}
          {isX && parts > 1 ? <div className="dim" style={{ fontSize: 12 }}>Posts as a {parts}-tweet thread (split on the numbered markers).</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function PublishTool({ posts, onChanged, toast }) {
  const [channels, setChannels] = useStateC(null); // null=loading | {error} | {linkedin,x}
  const [sel, setSel] = useStateC({});
  const [openId, setOpenId] = useStateC('');
  const [busy, setBusy] = useStateC(false);
  const [results, setResults] = useStateC(null);

  const loadChannels = () => {
    setChannels(null);
    fetch('/api/buffer/channels').then(async r => {
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not reach Buffer.');
      setChannels(d);
    }).catch(e => setChannels({ error: e.message }));
  };
  useEffectC(() => { loadChannels(); }, []);

  const pushable = posts.filter(p => !(p.buffer && p.buffer.id));
  const onBuffer = posts.filter(p => p.buffer && p.buffer.id);
  const selectedIds = pushable.filter(p => sel[p.id] && p.scheduledFor).map(p => p.id);

  const toggle = id => setSel(s => ({ ...s, [id]: !s[id] }));
  const selectAll = () => setSel(Object.fromEntries(pushable.filter(p => p.scheduledFor).map(p => [p.id, true])));
  const clearSel = () => setSel({});

  const run = (dryRun) => {
    if (!selectedIds.length) { toast && toast('Select at least one post first', 'warn'); return; }
    if (!dryRun && !window.confirm(`Schedule ${selectedIds.length} post${selectedIds.length > 1 ? 's' : ''} to Buffer? Buffer will publish ${selectedIds.length > 1 ? 'them' : 'it'} to LinkedIn / X at the scheduled time${selectedIds.length > 1 ? 's' : ''}.`)) return;
    setBusy(true); setResults(null);
    window.tjkMutate('/api/posts/push-to-buffer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ids: selectedIds, dryRun }) })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Push failed'); return d; })
      .then(d => {
        setResults(d);
        if (!dryRun) { onChanged(); setSel({}); toast && toast(`${d.scheduled} scheduled${d.waiting ? `, ${d.waiting} waiting for a slot` : ''}${d.failed ? `, ${d.failed} failed` : ''}`, d.failed ? 'warn' : 'ok'); }
      })
      .catch(e => toast && toast(e.message || 'Push failed', 'warn'))
      .finally(() => setBusy(false));
  };

  // Buffer not connected (no key, or key rejected): send them to Setup.
  if (channels && channels.error) {
    return (
      <div className="card" style={{ padding: 16 }}>
        <div style={{ marginBottom: 6 }}><strong>Buffer isn't connected.</strong></div>
        <div className="dim" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {channels.error}
          <br />Add your Buffer key in <b>Setup → API keys → Social posting</b>, then come back here to publish. Without it, you would be back to pasting each post into LinkedIn and X by hand.
        </div>
        <div className="row" style={{ marginTop: 10 }}><button className="btn ghost sm" onClick={loadChannels}>Check again</button></div>
      </div>
    );
  }

  const chChip = (c, label) => (
    <span className="pill" style={{ color: c && c.id ? 'var(--green)' : 'var(--text-mute)' }}>
      {label}: {c && c.id ? (c.name || 'connected') : 'not connected'}
    </span>
  );

  const cap = channels && channels.limits && Number.isFinite(channels.limits.scheduledPosts) ? channels.limits.scheduledPosts : null;
  const planNote = cap == null ? ''
    : cap >= pushable.length
      ? `Your Buffer plan holds up to ${cap.toLocaleString()} scheduled posts, enough for all ${pushable.length} here.`
      : `Your Buffer plan holds ${cap.toLocaleString()} scheduled posts; pick more and the earliest go now, the rest wait for a slot.`;

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="card" style={{ padding: 12 }}>
        <div className="row" style={{ alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span className="dim" style={{ fontSize: 12 }}>Publishing through Buffer to:</span>
          {channels === null ? <span className="dim" style={{ fontSize: 12 }}>checking…</span> : (<>{chChip(channels.linkedin, 'LinkedIn')}{chChip(channels.x, 'X')}</>)}
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={loadChannels}>Refresh</button>
        </div>
        <div className="dim" style={{ fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
          Select posts, Preview to see exactly what will go out (nothing is sent), then Push. {planNote} Posts already on Buffer are shown below and never sent twice.
        </div>
      </div>

      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn ghost sm" onClick={selectAll} disabled={!pushable.some(p => p.scheduledFor)}>Select all</button>
        <button className="btn ghost sm" onClick={clearSel} disabled={!selectedIds.length}>Clear</button>
        <span className="dim" style={{ fontSize: 12 }}>{selectedIds.length} selected</span>
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={() => run(true)} disabled={busy || !selectedIds.length}>{busy ? '…' : 'Preview (dry run)'}</button>
        <button className="btn primary sm" onClick={() => run(false)} disabled={busy || !selectedIds.length}>{busy ? 'Working…' : `Push ${selectedIds.length || ''} to Buffer`}</button>
      </div>

      {results ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="row" style={{ alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <strong>{results.dryRun ? 'Preview' : 'Result'}</strong>
            <span className="dim" style={{ fontSize: 12 }}>
              {results.dryRun ? `${results.scheduled} ready` : `${results.scheduled} scheduled`}
              {results.already ? `, ${results.already} already on Buffer` : ''}
              {results.waiting ? `, ${results.waiting} waiting for a slot` : ''}
              {results.failed ? `, ${results.failed} failed` : ''}
            </span>
            <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setResults(null)}>Dismiss</button>
          </div>
          <div className="col" style={{ gap: 4 }}>
            {(results.results || []).map(r => (
              <div key={r.id} className="row" style={{ gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                <span style={{ color: RESULT_COLOR[r.status] || 'var(--text)', width: 78, flexShrink: 0 }}>{r.status}</span>
                <span style={{ flex: 1 }}>{r.title || r.id} <span className="dim">({r.channel === 'x' ? 'X' : 'LinkedIn'})</span> — {r.message}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {pushable.length === 0
        ? <div className="card" style={{ padding: 16 }}><span className="dim">Nothing left to push. Draft posts in Social → Posts, give each a scheduled date, and they show up here.</span></div>
        : pushable.slice().sort((a, b) => String(a.scheduledFor || '~').localeCompare(String(b.scheduledFor || '~'))).map(p => (
            <PublishReviewRow key={p.id} post={p} checked={sel[p.id]} onToggle={() => toggle(p.id)} open={openId === p.id} onOpen={() => setOpenId(id => id === p.id ? '' : p.id)} />
          ))}

      {onBuffer.length ? (
        <div className="card" style={{ padding: 12 }}>
          <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>Already scheduled on Buffer ({onBuffer.length})</div>
          <div className="col" style={{ gap: 6 }}>
            {onBuffer.map(p => (
              <div key={p.id} className="col" style={{ gap: 2 }}>
                <div className="row" style={{ gap: 8, fontSize: 12, alignItems: 'baseline' }}>
                  <span style={{ color: 'var(--green)', width: 78, flexShrink: 0 }}>on Buffer</span>
                  <span style={{ flex: 1 }}>{postLabel(p)} <span className="dim">({p.channel === 'x' ? 'X' : 'LinkedIn'})</span> — {fmtWhen(p.buffer.dueAt || p.scheduledFor)}</span>
                </div>
                {p.buffer.pendingFirstComment ? (
                  <div className="row" style={{ gap: 6, fontSize: 11, alignItems: 'baseline', paddingLeft: 80, color: 'var(--orange)' }}>
                    <span>↳ add as first comment when it posts:</span>
                    <span className="mono" style={{ wordBreak: 'break-all' }}>{p.buffer.pendingFirstComment}</span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── Buffer connect card (stores the personal API key; no Buffer calls yet). ─────
// A window global so the Setup tab (launchpad.jsx) renders it there. Credentials
// belong in Setup, not on the working Content page.
window.BufferConnect = function BufferConnect({ toast }) {
  const [status, setStatus] = useStateC(null);
  const [token, setToken] = useStateC('');
  const [busy, setBusy] = useStateC(false);
  const load = () => fetch('/api/buffer/status').then(r => r.json()).then(setStatus).catch(() => setStatus({ connected: false }));
  useEffectC(() => { load(); }, []);
  const save = () => {
    if (!token.trim()) { toast && toast('Paste your Buffer API key first', 'warn'); return; }
    setBusy(true);
    window.tjkMutate('/api/buffer/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) })
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Save failed'); setStatus(d); setToken(''); toast && toast('Buffer key saved', 'ok'); })
      .catch(e => toast && toast(e.message || 'Could not save the key', 'warn'))
      .finally(() => setBusy(false));
  };
  const disconnect = () => {
    if (!window.confirm('Remove the stored Buffer key from this machine?')) return;
    window.tjkMutate('/api/buffer/disconnect', { method: 'POST' }).then(() => { setStatus({ connected: false }); toast && toast('Buffer disconnected'); }).catch(() => {});
  };
  if (!status) return null;
  return (
    <div className="card" style={{ padding: 12 }}>
      {status.connected ? (
        <div className="row" style={{ alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--green)' }}>● Buffer connected</span>
          <span className="dim mono" style={{ fontSize: 12 }}>key {status.hint}</span>
          <button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={disconnect}>Disconnect</button>
        </div>
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <div className="row" style={{ alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong>Connect Buffer</strong>
            <span className="dim" style={{ fontSize: 12 }}>to publish posts and auto-pull engagement. The key is stored on your machine only, never sent to us.</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input type="password" style={{ ...cInput, flex: 1, minWidth: 200 }} value={token} placeholder="Paste your Buffer API key" onChange={e => setToken(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save(); }} />
            <button className="btn primary sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save key'}</button>
          </div>
          <div className="dim" style={{ fontSize: 11 }}>Buffer &rarr; Settings &rarr; Developers &rarr; Generate API Key (long expiration; account:read, posts:read/write, insights:read).</div>
        </div>
      )}
    </div>
  );
}

window.ContentTab = function ContentTab({ toast }) {
  const [posts, setPosts] = useStateC([]);
  const [sub, setSub] = useStateC('publish');
  const [replyPostId, setReplyPostId] = useStateC('');

  const load = () => fetch('/api/posts').then(r => r.json()).then(d => setPosts(Array.isArray(d.posts) ? d.posts : [])).catch(() => {});
  useEffectC(() => { load(); }, []);

  const withMetrics = posts.filter(p => engRateOf(p.metrics) != null);
  const avgER = withMetrics.length ? withMetrics.reduce((s, p) => s + engRateOf(p.metrics), 0) / withMetrics.length : null;
  const totalDms = posts.reduce((s, p) => s + ((p.metrics && p.metrics.inboundDms) || 0), 0);

  const goReply = (post) => { setReplyPostId(post.id); setSub('reply'); };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="dim" style={{ fontSize: 13 }}>Publish posts to LinkedIn and X through Buffer, track how each performs, and draft on-message replies to comments.</div>

      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <div className="kpi"><div className="kpi-num">{posts.length}</div><div className="kpi-label">posts tracked</div></div>
        <div className="kpi"><div className="kpi-num">{avgER == null ? '—' : pct(avgER)}</div><div className="kpi-label">avg engagement rate</div></div>
        <div className="kpi"><div className="kpi-num">{totalDms}</div><div className="kpi-label">inbound DMs</div></div>
      </div>

      <div className="subtabs">
        {CONTENT_SUBTABS.map(s => (
          <button key={s.key} className={`subtab ${sub === s.key ? 'active' : ''}`} onClick={() => setSub(s.key)}>{s.label}</button>
        ))}
      </div>

      {sub === 'publish' ? <PublishTool posts={posts} onChanged={load} toast={toast} /> : null}

      {sub === 'tracker' ? (
        <div className="col" style={{ gap: 12 }}>
          <MetricsSync posts={posts} onSynced={load} toast={toast} />
          <AddPostForm onAdded={load} toast={toast} />
          {posts.length === 0
            ? <div className="card" style={{ padding: 16 }}><span className="dim">No posts yet. Add one above (or draft one in LinkedIn → Posts), then log its metrics 48 to 72 hours after posting.</span></div>
            : posts.slice().sort((a, b) => (b.order || 0) - (a.order || 0)).map(p => (
                <ContentPostCard key={p.id} post={p} onChanged={load} onReply={goReply} toast={toast} />
              ))}
        </div>
      ) : null}

      {sub === 'reply' ? <ReplyTool posts={posts} initialPostId={replyPostId} toast={toast} /> : null}

      {sub === 'rollup' ? <Rollup posts={posts} /> : null}
    </div>
  );
};
