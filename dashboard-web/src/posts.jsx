// Posts composer tab. Draft LinkedIn / X posts (write your own or have Claude
// draft one), edit them, and move them through a queue. Nothing is posted from
// here: a queued post is one you have marked ready, and Claude schedules the
// queue to Buffer through the Buffer MCP after you approve. Everything you do is
// recorded in the activity feed. Backend: server/routes/posts.mjs.

const LANE_META = {
  professional: { label: "Professional", channel: "linkedin", channelLabel: "LinkedIn", note: "earns screens" },
  trajecktory:  { label: "trajecktory",  channel: "x",        channelLabel: "X",        note: "build in public" },
};
const channelFor = (lane) => (LANE_META[lane] || LANE_META.professional).channel;

function laneBadge(lane) {
  const m = LANE_META[lane] || LANE_META.professional;
  const bg = lane === "trajecktory" ? "var(--blue)" : "var(--accent)";
  return React.createElement("span", {
    className: "kbd",
    style: { background: bg, color: "#0a0a0c", borderColor: bg, fontWeight: 700 },
  }, `${m.label} → ${m.channelLabel}`);
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch { return iso; }
}

// One editable post card with local text state so typing doesn't re-render the list.
function PostCard({ post, onPatch, onRemove }) {
  const { useState } = React;
  const [text, setText] = useState(post.text);
  const [link, setLink] = useState(post.linkComment || "");
  const [when, setWhen] = useState(post.scheduledFor ? post.scheduledFor.slice(0, 16) : "");
  const dirty = text.trim() !== post.text || link.trim() !== (post.linkComment || "");
  const overX = post.channel === "x" && text.length > 280;

  const save = () => { if (dirty && text.trim()) onPatch(post.id, { text, linkComment: link }); };

  return React.createElement("div", { className: "card", style: { borderColor: "var(--border)", marginBottom: 10 } },
    React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" } },
      React.createElement("span", {
        className: "kbd",
        title: post.source === "claude" ? "Drafted by Claude" : "Written by you",
        style: { background: post.source === "claude" ? "var(--panel-2, var(--panel))" : "transparent", color: "var(--text-dim)" },
      }, post.source === "claude" ? "Claude" : "You"),
      laneBadge(post.lane),
      React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: overX ? "var(--red)" : "var(--text-mute)" } },
        `${text.length} chars${post.channel === "x" ? " / 280" : ""}`),
    ),
    React.createElement("textarea", {
      className: "inp", value: text, onChange: (e) => setText(e.target.value), onBlur: save,
      rows: Math.min(8, Math.max(3, Math.ceil(text.length / 60))),
      style: { width: "100%", resize: "vertical", fontFamily: "inherit" },
    }),
    React.createElement("input", {
      className: "inp", value: link, placeholder: "Link for the first comment (optional)",
      onChange: (e) => setLink(e.target.value), onBlur: save,
      style: { width: "100%", marginTop: 6 },
    }),
    React.createElement("div", { style: { display: "flex", gap: 6, alignItems: "center", marginTop: 8, flexWrap: "wrap" } },
      dirty ? React.createElement("button", { className: "btn primary", onClick: save }, "Save") : null,
      post.status === "draft" ? React.createElement("button", {
        className: "btn", onClick: () => onPatch(post.id, { status: "queued", scheduledFor: when ? new Date(when).toISOString() : null }),
      }, "Queue →") : null,
      post.status === "queued" ? React.createElement(React.Fragment, null,
        React.createElement("input", {
          type: "datetime-local", className: "inp", value: when,
          onChange: (e) => { setWhen(e.target.value); onPatch(post.id, { scheduledFor: e.target.value ? new Date(e.target.value).toISOString() : null }); },
          style: { width: 190 }, title: "Target time (optional). Claude uses this when scheduling to Buffer.",
        }),
        React.createElement("button", { className: "btn", onClick: () => onPatch(post.id, { status: "scheduled" }), title: "Mark as scheduled once Claude has pushed it to Buffer" }, "Mark scheduled"),
        React.createElement("button", { className: "btn", onClick: () => onPatch(post.id, { status: "draft" }) }, "← Unqueue"),
      ) : null,
      post.status === "scheduled" ? React.createElement("button", { className: "btn", onClick: () => onPatch(post.id, { status: "published" }) }, "Mark published") : null,
      post.scheduledFor && post.status !== "draft" ? React.createElement("span", { style: { fontSize: 11, color: "var(--text-mute)" } }, `⏱ ${fmtTime(post.scheduledFor)}`) : null,
      React.createElement("button", { className: "btn", style: { marginLeft: "auto", color: "var(--red)" }, onClick: () => onRemove(post.id) }, "Delete"),
    ),
  );
}

window.PostsTab = function PostsTab({ toast }) {
  const { useState, useEffect, useCallback } = React;
  const [posts, setPosts] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lane, setLane] = useState("professional");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [genBusy, setGenBusy] = useState(false);

  const notify = (m, k = "success") => { try { toast && toast(m, k); } catch {} };

  const load = useCallback(() => {
    fetch("/api/posts").then((r) => r.json()).then((d) => {
      setPosts(Array.isArray(d.posts) ? d.posts : []);
      setActivity(Array.isArray(d.activity) ? d.activity : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveDraft = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch("/api/posts", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ text, source: "user", lane, channel: channelFor(lane), linkComment: link }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Save failed");
      setText(""); setLink(""); load(); notify("Draft saved");
    } catch (e) { notify(e.message, "error"); } finally { setBusy(false); }
  };

  const generate = async () => {
    if (genBusy) return;
    setGenBusy(true);
    try {
      const r = await fetch("/api/posts/generate", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ lane, channel: channelFor(lane), topic }),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Generation failed");
      setTopic(""); load(); notify("Claude drafted a post. Review and edit it below.");
    } catch (e) { notify(e.message, "error"); } finally { setGenBusy(false); }
  };

  const onPatch = async (id, body) => {
    try {
      const r = await fetch(`/api/posts/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json()).error || "Update failed");
      load();
    } catch (e) { notify(e.message, "error"); }
  };
  const onRemove = async (id) => {
    if (!window.confirm("Delete this post?")) return;
    try { await fetch(`/api/posts/${id}`, { method: "DELETE" }); load(); notify("Deleted"); }
    catch (e) { notify(e.message, "error"); }
  };

  const drafts = posts.filter((p) => p.status === "draft");
  const queued = posts.filter((p) => p.status === "queued");
  const done = posts.filter((p) => p.status === "scheduled" || p.status === "published");
  const recentActivity = [...activity].reverse().slice(0, 20);

  const laneChip = (key) => {
    const m = LANE_META[key];
    return React.createElement("button", {
      key, className: `chip ${lane === key ? "on" : ""}`, onClick: () => setLane(key),
      title: m.note,
    }, `${m.label} → ${m.channelLabel}`);
  };

  const Section = (title, items, emptyMsg) => React.createElement("div", { style: { marginBottom: 18 } },
    React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 } },
      `${title} (${items.length})`),
    items.length === 0
      ? React.createElement("div", { style: { fontSize: 12, color: "var(--text-mute)", padding: "4px 0" } }, emptyMsg)
      : items.map((p) => React.createElement(PostCard, { key: p.id, post: p, onPatch, onRemove })),
  );

  if (loading) return React.createElement("div", { style: { padding: 24, color: "var(--text-mute)" } }, "Loading posts…");

  return React.createElement("div", { className: "posts-tab", style: { padding: "18px 20px", maxWidth: "none", marginLeft: 0, marginRight: 0 } },
    React.createElement("h2", { style: { margin: "0 0 4px" } }, "Posts"),
    React.createElement("p", { style: { margin: "0 0 16px", color: "var(--text-dim)", fontSize: 13, maxWidth: 720 } },
      "Draft posts for two lanes: Professional lands on LinkedIn (the lane that earns screens), trajecktory lands on X (build in public). Write your own or have Claude draft one, edit either, then queue it. Queued posts are ready; Claude schedules the queue to Buffer after you approve. Nothing posts automatically."),

    // Connect-Buffer callout — the one-time setup that makes "schedule the queue" work.
    React.createElement("details", { className: "card", style: { marginBottom: 16, borderColor: "var(--border)", padding: "10px 14px" } },
      React.createElement("summary", { style: { cursor: "pointer", fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)" } },
        "First time? Connect Buffer to publish →"),
      React.createElement("div", { style: { marginTop: 10, fontSize: 12.5, color: "var(--text-dim)", lineHeight: 1.7 } },
        React.createElement("p", { style: { margin: "0 0 8px" } },
          "This composer drafts and queues. Buffer is what actually schedules your posts to LinkedIn and X. It is a one-time connect, done in Claude Code, not on this screen:"),
        React.createElement("ol", { style: { margin: "0 0 8px", paddingLeft: 18 } },
          React.createElement("li", null, "Add the Buffer MCP server to Claude Code and sign in to Buffer once."),
          React.createElement("li", null, "Draft and queue posts here."),
          React.createElement("li", null, "In a Claude Code session, ask Claude to schedule your queued posts, then Mark them scheduled."),
        ),
        React.createElement("div", { style: { color: "var(--text-mute)", fontSize: 11.5 } },
          "trajecktory ships no shared posting link and never posts on its own; publishing always goes through your approval and your own Buffer account."),
      ),
    ),

    // Composer
    React.createElement("div", { className: "card", style: { marginBottom: 22, borderColor: "var(--border)" } },
      React.createElement("div", { style: { display: "flex", gap: 6, marginBottom: 8 } }, laneChip("professional"), laneChip("trajecktory")),
      React.createElement("textarea", {
        className: "inp", value: text, placeholder: `Write a ${LANE_META[lane].channelLabel} post, or use Draft with Claude →`,
        onChange: (e) => setText(e.target.value), rows: 4, style: { width: "100%", resize: "vertical", fontFamily: "inherit" },
      }),
      React.createElement("input", {
        className: "inp", value: link, placeholder: "Link for the first comment (optional)",
        onChange: (e) => setLink(e.target.value), style: { width: "100%", marginTop: 6 },
      }),
      React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" } },
        React.createElement("button", { className: "btn primary", onClick: saveDraft, disabled: !text.trim() || busy }, busy ? "Saving…" : "Save draft"),
        React.createElement("span", { style: { width: 1, height: 22, background: "var(--border)", margin: "0 2px" } }),
        React.createElement("input", {
          className: "inp", value: topic, placeholder: "Optional: what should Claude write about?",
          onChange: (e) => setTopic(e.target.value), style: { flex: "1 1 240px", minWidth: 180 },
        }),
        React.createElement("button", { className: "btn", onClick: generate, disabled: genBusy }, genBusy ? "Drafting…" : "Draft with Claude"),
      ),
    ),

    React.createElement("div", { style: { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 22, alignItems: "start" } },
      // Left: the queues
      React.createElement("div", null,
        Section("Drafts", drafts, "No drafts yet. Write one above, or have Claude draft one."),
        queued.length > 0 || done.length > 0 ? React.createElement("div", {
          style: { fontSize: 11, color: "var(--text-mute)", margin: "-6px 0 10px" },
        }, "To publish the queue: in a Claude Code session with Buffer connected, ask Claude to schedule your queued posts. Then Mark scheduled.") : null,
        Section("Queue", queued, "Nothing queued. Queue a draft when it is ready to schedule."),
        Section("Scheduled / posted", done, "Nothing scheduled yet."),
      ),
      // Right: activity feed
      React.createElement("div", null,
        React.createElement("div", { style: { fontSize: 12, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 } }, "Activity"),
        recentActivity.length === 0
          ? React.createElement("div", { style: { fontSize: 12, color: "var(--text-mute)" } }, "Your edits and status changes show up here.")
          : React.createElement("div", { className: "card", style: { borderColor: "var(--border)", padding: 10 } },
            recentActivity.map((a) => React.createElement("div", {
              key: a.id, style: { fontSize: 11.5, padding: "5px 0", borderBottom: "1px solid var(--border)", color: "var(--text-dim)" },
            },
              React.createElement("span", { style: { fontWeight: 700, color: "var(--text)" } }, a.action),
              a.snippet ? React.createElement("span", null, `: ${a.snippet}${a.snippet.length >= 80 ? "…" : ""}`) : null,
              React.createElement("div", { style: { color: "var(--text-mute)", fontSize: 10.5 } }, fmtTime(a.ts)),
            )),
          ),
      ),
    ),
  );
};
