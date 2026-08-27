// lib/coach.mjs — the AI Coach's memory, live-state read, prompt assembly, and the
// small set of actions it may PROPOSE (the user always confirms before anything runs).
//
// Persistence mirrors lib/posts.mjs exactly: a single version:1 JSON sidecar under
// DATA_DIR (gitignored user data), whole-file rewrite, a bounded transcript. The
// coach never writes to the tracker or files on its own — routes/coach.mjs only
// executes an action AFTER the user taps Confirm.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { COACH_PATH } from '../config.mjs';
import { parseApplicationsMd, patchRowInMd } from './applications.mjs';
import { computeStaleApps, computeStaleTA, computeConnectQueue, computeEmailQueue } from './followups.mjs';
import { floorStatus } from './rolling-floor.mjs';
import { createTodo } from './todos.mjs';
import { getIdentity } from './profile.mjs';
import { FUNNEL_ORDER } from './statuses.mjs';

const MAX_MESSAGES = 200;

// The Coach's grounding: how trajecktory works + the real fixes for common problems.
// A tracked system-layer file so it ships to every install and is easy to edit.
const KNOWLEDGE = (() => {
  try { return fs.readFileSync(fileURLToPath(new URL('./coach-knowledge.md', import.meta.url)), 'utf8'); }
  catch { return 'You are the trajecktory Coach. Be warm, brief, and give the next concrete step.'; }
})();

// ── persistence ──────────────────────────────────────────────────────────────
function readStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(COACH_PATH, 'utf8'));
    return { messages: Array.isArray(raw.messages) ? raw.messages : [], brief: raw.brief || null };
  } catch { return { messages: [], brief: null }; }
}
function writeStore(store) {
  fs.writeFileSync(COACH_PATH, JSON.stringify({
    version: 1,
    messages: (store.messages || []).slice(-MAX_MESSAGES),
    brief: store.brief || null,
  }, null, 2) + '\n');
}
function newId() { return 'm_' + randomBytes(4).toString('hex'); }

export function getMessages() { return readStore().messages; }
export function appendMessage({ role, text, action = null }) {
  const store = readStore();
  const msg = { id: newId(), role, text: String(text || ''), action, ts: new Date().toISOString() };
  store.messages.push(msg);
  writeStore(store);
  return msg;
}
export function clearMessages() { const s = readStore(); s.messages = []; writeStore(s); }
export function getCachedBrief() { return readStore().brief; }
export function setCachedBrief(text, date) { const s = readStore(); s.brief = { text, date }; writeStore(s); }

// ── live state (the "what should I do today" inputs) ───────────────────────────
const _APPLIED_IDX = FUNNEL_ORDER.indexOf('Applied');
const _num = (v) => { const n = parseFloat(String(v || '').replace('/5', '')); return Number.isFinite(n) ? n : null; };

// Compact snapshot of the user's actionable state. Every read is defensive: a
// missing/parse-failing source contributes nothing rather than throwing, so the
// Coach still answers when one datum is unavailable.
export function coachState() {
  const safe = (fn, dflt) => { try { return fn(); } catch { return dflt; } };
  const apps = safe(parseApplicationsMd, []);

  const pending = apps.filter(a => a.status === 'Evaluated');
  const topPending = [...pending]
    .sort((a, b) => (_num(b.scoreRaw ?? b.score) ?? 0) - (_num(a.scoreRaw ?? a.score) ?? 0))
    .slice(0, 5)
    .map(a => ({ id: a.id, company: a.company, role: a.role, score: _num(a.scoreRaw ?? a.score) }));

  // Active applications (Applied or further) — the set an outcome action can target.
  const active = apps
    .filter(a => FUNNEL_ORDER.indexOf(a.reached) >= _APPLIED_IDX && !['Rejected', 'No Response', 'Discarded', 'Offer'].includes(a.status))
    .slice(-40)
    .map(a => ({ id: a.id, company: a.company, role: a.role, status: a.status }));

  const staleApps = safe(() => computeStaleApps(), []) || [];
  const staleTA = safe(() => computeStaleTA(), []) || [];
  const connect = safe(() => computeConnectQueue(), []) || [];
  const email = safe(() => computeEmailQueue(), []) || [];
  const floor = safe(() => floorStatus(), null);

  return {
    pendingEvals: pending.length,
    topPending,
    activeApplications: active,
    staleFollowups: staleApps.length,
    staleTA: staleTA.length,
    connectQueue: connect.length,
    emailQueue: email.length,
    floor: floor ? { done: floor.trailingCount, target: floor.floor, gap: floor.gap, met: floor.met, windowDays: floor.windowDays } : null,
  };
}

// A human-readable state block for the prompt (bounded; never dumps raw rows).
function stateForPrompt(state) {
  const lines = [];
  lines.push(`- Roles evaluated and awaiting your decision: ${state.pendingEvals}${state.topPending.length ? ` (top fits: ${state.topPending.map(p => `${p.company} ${p.score ?? '?'}/5`).join(', ')})` : ''}`);
  lines.push(`- LinkedIn Connect queue: ${state.connectQueue} waiting · Email queue: ${state.emailQueue} waiting`);
  lines.push(`- Applications gone quiet (need a nudge): ${state.staleFollowups}; TA contacts to re-touch: ${state.staleTA}`);
  if (state.floor) lines.push(`- Weekly outreach floor: ${state.floor.done}/${state.floor.target} verified touches over the last ${state.floor.windowDays} working days${state.floor.met ? ' (met)' : ` (${state.floor.gap} to go)`}`);
  if (state.activeApplications.length) {
    lines.push(`- Active applications you can log an outcome on (id · company · status): ${state.activeApplications.map(a => `${a.id}·${a.company}·${a.status}`).join(' | ')}`);
  }
  return lines.join('\n');
}

// ── prompt assembly ────────────────────────────────────────────────────────────
// The action protocol is prompt-level: the model appends ONE <action>{...}</action>
// block ONLY when the user clearly wants a change made. The server parses it out,
// shows a Confirm button, and executes only on confirm. Nothing auto-runs.
const ACTION_PROTOCOL = `
CONFIRM-TO-ACT: You may PROPOSE an action, which the app shows as a one-tap Confirm button. You NEVER perform it yourself — the button IS the user's yes, so you do not need to ask "want me to?" in prose. Append EXACTLY ONE line at the very END of your reply, after your prose:
<action>{"kind":"...","label":"..."}</action>
PROPOSE one whenever the user REPORTS an outcome or clearly wants a change made — e.g. "I got a rejection from X", "they want to schedule a screen", "I got an offer", "remind me to Y". A short warm line plus the button is ideal (e.g. "Sorry to hear it. I can log that for you:").
Supported kinds:
- Log an application outcome: {"kind":"logOutcome","appId":<number from the active-applications list>,"status":"Rejected","company":"<company>","label":"Mark <company> as Rejected"}. Use the matching appId from the live state; if you cannot find the company there, do NOT guess an id — ask which company instead. Allowed status values: Rejected, No Response, Discarded, Offer.
- Add a to-do: {"kind":"addTodo","text":"<short task>","label":"Add to-do: <short task>"}.
Do not mention the <action> tag or JSON in your prose; the app renders it as a button. If no change is wanted, do not emit one. Never emit more than one.`;

export function buildSystemPrompt(state, identity) {
  const who = identity && identity.firstName ? `You are helping ${identity.firstName}.` : '';
  return [
    KNOWLEDGE,
    who,
    '## The user\'s live situation right now (use this to make "what should I do" specific and personal; do not read it back as a list unless asked):',
    stateForPrompt(state),
    ACTION_PROTOCOL,
  ].filter(Boolean).join('\n\n');
}

// generateText is single-turn, so fold recent history into the prompt.
export function buildChatPrompt(history, userMessage) {
  const recent = (history || []).slice(-10)
    .map(m => `${m.role === 'user' ? 'User' : 'Coach'}: ${m.text}`)
    .join('\n');
  return [
    recent ? `Recent conversation:\n${recent}` : '',
    `The user now says:\nUser: ${userMessage}`,
    'Reply as the Coach: warm, brief, and end with the one next step. Propose an action only if the user clearly wants a change made.',
  ].filter(Boolean).join('\n\n');
}

export function briefPrompt(state) {
  return `Write a short, warm daily brief for the user (2-4 sentences, plain language). Lead with encouragement, then name the 1-3 highest-leverage things to do right now based on their live situation above, each with where to go in the app. If there is genuinely nothing pending, say so and suggest bringing in new roles. Do not use a numbered list unless it truly helps; keep it conversational. Do NOT propose an action here (no <action> tag).`;
}

// ── action parsing + execution ─────────────────────────────────────────────────
// Pull an optional trailing <action>{...}</action> out of a reply. Returns the
// cleaned text plus a validated action, or null. Malformed JSON is ignored (the
// prose still shows); the Coach can never crash the reply on a bad tag.
export function parseAction(reply) {
  const m = String(reply || '').match(/<action>\s*([\s\S]*?)\s*<\/action>/i);
  let text = String(reply || '').replace(/<action>[\s\S]*?<\/action>/i, '').trim();
  if (!m) return { text, action: null };
  let obj = null;
  try { obj = JSON.parse(m[1]); } catch { return { text, action: null }; }
  const action = validateAction(obj);
  return { text, action };
}

const OUTCOME_STATUSES = new Set(['Rejected', 'No Response', 'Discarded', 'Offer']);
function validateAction(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.kind === 'logOutcome') {
    const appId = parseInt(obj.appId, 10);
    if (!Number.isInteger(appId)) return null;
    if (!OUTCOME_STATUSES.has(obj.status)) return null;
    return { kind: 'logOutcome', appId, status: obj.status, company: String(obj.company || '').slice(0, 80), label: String(obj.label || `Mark as ${obj.status}`).slice(0, 100) };
  }
  if (obj.kind === 'addTodo') {
    const t = String(obj.text || '').trim();
    if (!t) return null;
    return { kind: 'addTodo', text: t.slice(0, 200), label: String(obj.label || `Add to-do: ${t}`).slice(0, 100) };
  }
  return null;
}

// Execute a confirmed action against the SAME canonical writers the UI uses.
// Re-validates (never trust a client-echoed action blindly) and, for logOutcome,
// checks the id resolves to a real application before touching the tracker.
export function executeAction(action) {
  const a = validateAction(action);
  if (!a) throw new Error('Unrecognized or invalid action.');
  if (a.kind === 'logOutcome') {
    const apps = parseApplicationsMd();
    const row = apps.find(x => String(x.id) === String(a.appId));
    if (!row) throw new Error(`No application #${a.appId} found.`);
    patchRowInMd(a.appId, { status: a.status }, { company: row.company });
    return { ok: true, message: `Marked ${row.company} as ${a.status}.` };
  }
  if (a.kind === 'addTodo') {
    createTodo({ text: a.text });
    return { ok: true, message: `Added to your to-do list: "${a.text}".` };
  }
  throw new Error('Unrecognized action.');
}

export { KNOWLEDGE };
