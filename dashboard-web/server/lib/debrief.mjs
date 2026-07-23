import { INTERVIEW_STAGES } from './statuses.mjs';

// ── Interview-round debriefs ─────────────────────────────────────────────────
// A debrief is a structured, timestamped app-note capturing what happened in an
// interview round. Above all it records the OBJECTION: the interviewer's answer
// to "is there anything in my background that gives you pause, or that the hiring
// manager would want addressed?" That one question, asked at the end of every
// round, is what turns a sample of one debrief into a real dataset. Alongside it
// we keep what landed, what to change, intel for the next round, and next steps.
// Modeled on the §11 self-debrief in a round-2 prep file.
//
// Storage reuses addNote() in data/app-notes.json, so the applications.md schema
// and its analytics are never perturbed. A saved debrief carries a stable header
// line, `### Debrief: <stage> (<date>)`, which is how we detect which rounds
// still need one.
//
// WHY DETECTION READS CURRENT STATUS, NOT THE EVENT LOG: data/status-events.tsv
// was backfilled in a single pass and contains interview rounds that never
// happened, so counting "rounds entered" from it would invent pending debriefs.
// Instead a round is "pending a debrief" when the app's CURRENT status is an
// interview stage and no debrief note exists for that stage. A debrief for a past
// or rejected round is captured manually through the same save path (any app +
// any stage), so nothing here depends on the corrupt log.

// Header written at the top of every saved debrief; also the detection anchor.
// Captures the stage inside the parens-prefixed title so one regex reads it back.
const DEBRIEF_HEADER_RE = /^###\s+Debrief:\s*(.+?)\s*\(/m;

// The exact question that every prep template now ends on. Kept here as the one
// source of truth so the templates and the debrief prompt cannot drift apart.
const OBJECTION_QUESTION =
  'Before we wrap, is there anything in my background that gives you pause, or that the hiring manager would want addressed?';

// Does this note text look like a saved debrief for `stage`?
function isDebriefFor(text, stage) {
  const m = String(text || '').match(DEBRIEF_HEADER_RE);
  return !!m && m[1].trim().toLowerCase() === String(stage || '').trim().toLowerCase();
}

// The fill-in skeleton shown to the user. The objection leads, because it is the
// point of the exercise. No em dashes (house style).
function debriefTemplate(stage, { company = '', role = '', date = '' } = {}) {
  const ctx = [company, role].filter(Boolean).join(' | ');
  return [
    `### Debrief: ${stage} (${date || 'YYYY-MM-DD'})`,
    ctx ? `_${ctx}_` : '',
    '',
    '**Outcome:** advanced / rejected / pending. How it actually felt, in one line.',
    '',
    `**The objection (most important).** Their answer to: "${OBJECTION_QUESTION}" Write it as close to verbatim as you can. If nothing was raised, say so plainly.`,
    '',
    '**What landed.** The stories or points that clearly connected.',
    '',
    '**What I would change.** Anything that fell flat, ran long, or that I fumbled.',
    '',
    '**Intel captured.** Facts about the seat, team, process, or people to reuse next round or in the deck.',
    '',
    '**Next steps.** Who follows up with whom, and by when.',
  ].filter(l => l !== '').join('\n') + '\n';
}

// Assemble a debrief note from structured fields (any subset). Always carries the
// detection header. A freeform `body` is appended verbatim after the fields.
function formatDebriefNote(stage, fields = {}, { date = '', company = '', role = '' } = {}) {
  const { outcome, objection, landed, change, intel, next, body } = fields;
  const ctx = [company, role].filter(Boolean).join(' | ');
  const out = [`### Debrief: ${stage} (${date || new Date().toISOString().slice(0, 10)})`];
  if (ctx) out.push(`_${ctx}_`);
  const field = (label, val) => {
    if (val && String(val).trim()) out.push('', `**${label}:** ${String(val).trim()}`);
  };
  field('Outcome', outcome);
  field('Objection', objection);
  field('What landed', landed);
  field('What I would change', change);
  field('Intel captured', intel);
  field('Next steps', next);
  if (body && String(body).trim()) out.push('', String(body).trim());
  return out.join('\n');
}

// Which interview rounds still need a debrief: an app whose CURRENT status is an
// interview stage with no debrief note for that stage. `apps` are parsed tracker
// rows; `notes` is the app-notes map ({ "<id>": [{ text }] }). Injectable so this
// is unit-tested without reading the real (gitignored) tracker and notes.
function pendingDebriefs({ apps = [], notes = {} } = {}) {
  const stages = new Set(INTERVIEW_STAGES);
  const out = [];
  for (const a of apps) {
    if (!stages.has(a.status)) continue;
    const list = notes[String(a.id)] || [];
    if (list.some(n => isDebriefFor(n.text, a.status))) continue;
    out.push({ id: a.id, company: a.company, role: a.role, stage: a.status });
  }
  return out;
}

export {
  DEBRIEF_HEADER_RE, OBJECTION_QUESTION,
  isDebriefFor, debriefTemplate, formatDebriefNote, pendingDebriefs,
};
