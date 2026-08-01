import { INTERVIEW_STAGES, reachedStage } from './statuses.mjs';

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
// Reads the WHOLE header line; the stage is pulled out of it in code below.
//
// This used to capture the stage with `\s*(.+?)\s*\(`, which is a polynomial-ReDoS
// pattern (CodeQL js/polynomial-redos): `.` and the two surrounding `\s*` all match
// a space, so a header like "### Debrief:" followed by many spaces and no "(" makes
// the engine backtrack through every way of splitting those spaces. The note text
// is user-provided, so that input is reachable. The line match is now linear (no
// quantifier overlaps a character class that also matches whitespace), and the
// stage is split out with plain string ops, which cannot backtrack.
const DEBRIEF_HEADER_RE = /^###\s+Debrief:(.*)$/m;

// The stage is the header text before the first "(", trimmed. Empty when there is
// no header line.
function stageFromHeader(text) {
  const m = String(text || '').match(DEBRIEF_HEADER_RE);
  return m ? m[1].split('(')[0].trim() : '';
}

// The exact question that every prep template now ends on. Kept here as the one
// source of truth so the templates and the debrief prompt cannot drift apart.
const OBJECTION_QUESTION =
  'Before we wrap, is there anything in my background that gives you pause, or that the hiring manager would want addressed?';

// Does this note text look like a saved debrief for `stage`?
function isDebriefFor(text, stage) {
  const s = stageFromHeader(text);
  return s !== '' && s.toLowerCase() === String(stage || '').trim().toLowerCase();
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

// Which interview rounds still need a debrief. A debrief is owed for every round
// the app has CONCLUDED (left) without one — not just its current stage, so a
// round you skipped and then advanced past keeps surfacing until you write it.
// `apps` are parsed tracker rows (a.status + a.notes carry the [reached:] tag);
// `notes` is the app-notes map ({ "<id>": [{ text }] }). Injectable for tests.
function pendingDebriefs({ apps = [], notes = {} } = {}) {
  const ladder = INTERVIEW_STAGES;            // ordered Phone Screen -> 4th Interview
  const stageSet = new Set(ladder);
  const out = [];
  for (const a of apps) {
    // Furthest interview round reached: the current stage if still interviewing,
    // else the [reached: X] tag stamped when the row closed.
    let furthest = -1;
    if (stageSet.has(a.status)) furthest = ladder.indexOf(a.status);
    else { const r = reachedStage(a.notes); if (r && stageSet.has(r)) furthest = ladder.indexOf(r); }
    if (furthest < 0) continue;
    // A round still in progress (the current interview stage) isn't concluded yet;
    // a terminal row has concluded its furthest reached round too.
    const concludedUpto = stageSet.has(a.status) ? furthest - 1 : furthest;
    const list = notes[String(a.id)] || [];
    for (let i = 0; i <= concludedUpto; i++) {
      const stage = ladder[i];
      if (list.some(n => isDebriefFor(n.text, stage))) continue;
      out.push({ id: a.id, company: a.company, role: a.role, stage });
    }
  }
  return out;
}

export {
  DEBRIEF_HEADER_RE, OBJECTION_QUESTION,
  isDebriefFor, debriefTemplate, formatDebriefNote, pendingDebriefs,
};
