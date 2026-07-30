// Content tab — track per-post performance for the LinkedIn/X content series and
// draft on-message replies to comments. Reads and writes the SAME posts store as
// the LinkedIn > Posts composer (/api/posts), so a post drafted there can be
// tracked here. Three subtabs: Tracker (log metrics), Reply (AI comment reply),
// Rollup (what works, by type).
const { useState: useStateC, useEffect: useEffectC, useMemo: useMemoC } = React;

const CONTENT_TYPES = ['origin', 'builder', 'myth', 'rigor', 'craft', 'service', 'journey', 'product', 'serial'];
const CONTENT_SUBTABS = [
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

const cInput = { background: 'transparent', border: '1px solid var(--border-2)', borderRadius: 6, padding: '5px 8px', color: 'inherit', font: 'inherit' };

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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8 }}>
            {METRIC_FIELDS.map(f => (
              <label key={f.k} className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {f.label}
                <input type="number" min="0" style={cInput} value={m[f.k]}
                  onChange={e => setM(s => ({ ...s, [f.k]: e.target.value }))} />
              </label>
            ))}
          </div>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
            Who engaged (titles / companies of the people who reacted or viewed — your hire-me signal)
            <input type="text" style={cInput} value={m.whoEngaged} onChange={e => setM(s => ({ ...s, whoEngaged: e.target.value }))} />
          </label>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
            Notes (what worked / flopped)
            <input type="text" style={cInput} value={m.notes} onChange={e => setM(s => ({ ...s, notes: e.target.value }))} />
          </label>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="btn primary sm" onClick={saveMetrics} disabled={saving}>{saving ? 'Saving…' : 'Save metrics'}</button>
            <span className="mono dim" style={{ fontSize: 12 }}>Engagement rate: {pct(engRateOf({ ...m, impressions: Number(m.impressions) || 0 }))}</span>
            {post.metrics && post.metrics.checkedAt ? <span className="dim" style={{ fontSize: 11 }}>last saved {new Date(post.metrics.checkedAt).toLocaleDateString()}</span> : null}
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
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3, flex: 2, minWidth: 200 }}>
          Post label / hook
          <input type="text" style={cInput} value={label} placeholder="Short label for this post" onChange={e => setLabel(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); }} />
        </label>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
          Type
          <select style={cInput} value={type} onChange={e => setType(e.target.value)}>
            <option value="">(none)</option>
            {CONTENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
          Channel
          <select style={cInput} value={channel} onChange={e => setChannel(e.target.value)}>
            <option value="linkedin">LinkedIn</option>
            <option value="x">X</option>
          </select>
        </label>
        <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 140 }}>
          Link (optional)
          <input type="text" style={cInput} value={link} placeholder="tracked repo link" onChange={e => setLink(e.target.value)} />
        </label>
        <button className="btn primary sm" onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
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
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
            Which post is the comment on? (gives the reply context — optional)
            <select style={cInput} value={postId} onChange={e => setPostId(e.target.value)}>
              <option value="">(no specific post)</option>
              {posts.map(p => <option key={p.id} value={p.id}>{postLabel(p)} · {p.channel === 'x' ? 'X' : 'LinkedIn'}</option>)}
            </select>
          </label>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
            Paste the comment you want to reply to
            <textarea style={{ ...cInput, minHeight: 90, resize: 'vertical' }} value={comment} onChange={e => setComment(e.target.value)} placeholder="Paste the exact comment here…" />
          </label>
          <label className="dim" style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
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

window.ContentTab = function ContentTab({ toast }) {
  const [posts, setPosts] = useStateC([]);
  const [sub, setSub] = useStateC('tracker');
  const [replyPostId, setReplyPostId] = useStateC('');

  const load = () => fetch('/api/posts').then(r => r.json()).then(d => setPosts(Array.isArray(d.posts) ? d.posts : [])).catch(() => {});
  useEffectC(() => { load(); }, []);

  const withMetrics = posts.filter(p => engRateOf(p.metrics) != null);
  const avgER = withMetrics.length ? withMetrics.reduce((s, p) => s + engRateOf(p.metrics), 0) / withMetrics.length : null;
  const totalDms = posts.reduce((s, p) => s + ((p.metrics && p.metrics.inboundDms) || 0), 0);

  const goReply = (post) => { setReplyPostId(post.id); setSub('reply'); };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="dim" style={{ fontSize: 13 }}>Track how each post performs, and draft on-message replies to comments.</div>

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

      {sub === 'tracker' ? (
        <div className="col" style={{ gap: 12 }}>
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
