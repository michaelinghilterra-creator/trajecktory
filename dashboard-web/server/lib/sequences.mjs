/**
 * sequences.mjs — per-contact sequence state store.
 *
 * A sequence tracks where a contact is in a pre-defined outreach series
 * (cold-intro-principal, cold-intro-ta, etc.). State is stored per contact in
 * data/contact-sequences.json (gitignored — personal data).
 *
 * Shape per entry:
 *   "<source>:<id>": {
 *     sequenceId: "cold-intro-principal",
 *     startedAt:  "YYYY-MM-DD",
 *     step:       1,              // 0-indexed step COMPLETED (0 = none yet)
 *     nextStepDue:"YYYY-MM-DD",  // when step+1 becomes due
 *     paused:     false,          // true when a reply on any channel auto-pauses
 *     pausedAt:   null,           // "YYYY-MM-DD" | null
 *     completedAt: null,          // "YYYY-MM-DD" | null (all steps done or abandoned)
 *   }
 *
 * HITL guarantee: nothing auto-sends. The sequence records what was drafted and
 * scheduled; actual sending requires the user to approve a Gmail draft.
 */

import fs from 'fs';
import path from 'path';
import { ROOT_DIR, DATA_DIR } from '../config.mjs';
import { INFLUENCE_RANK } from '../../../lib/influence-tier.mjs';
import { normalizeForMatch } from '../../../lib/scan-core.mjs';

const SUGGESTED_SEQUENCE_IDS = Object.freeze({
  principal: 'cold-intro-principal',
  ta: 'cold-intro-ta',
  cfo: 'cold-intro-cfo',
  cro: 'cold-intro-cro',
  sales: 'cold-intro-vp-sales',
  demandgen: 'cold-intro-demandgen',
  linkedinPrincipal: 'linkedin-connect-principal',
  linkedinTa: 'linkedin-connect-ta',
});

const STAKEHOLDER_TITLE_RUNS = Object.freeze({
  finance: Object.freeze(['chief financial officer', 'cfo', 'finance'].map(normalizeForMatch)),
  chiefRevenue: Object.freeze(['chief revenue officer', 'cro'].map(normalizeForMatch)),
  salesLeadership: Object.freeze([
    'vp sales', 'head sales', 'director sales', 'sales director', 'chief sales officer',
  ].map(normalizeForMatch)),
  demandgen: Object.freeze([
    'demand generation', 'demand gen', 'marketing',
  ].map(normalizeForMatch)),
});

function titleContainsWholeRun(title, phrases) {
  const normalized = normalizeForMatch(title);
  if (!normalized) return false;
  const paddedTitle = ` ${normalized} `;
  return phrases.some(phrase => paddedTitle.includes(` ${phrase} `));
}

/**
 * Suggests an outreach sequence from two separate facts about a contact.
 *
 * WHY: the tier decides how much someone can move the hire, while the title
 * decides which problem the opener should lead with. Treating those as one
 * question produces generic outreach to stakeholders who own different parts
 * of the revenue engine. LinkedIn remains tier-only because a connection note
 * is a handshake rather than the pitch itself.
 */
export function suggestSequenceId(contact, { channel = 'email' } = {}) {
  const tier = contact?.tier || contact?.influenceTier;
  if (!Object.hasOwn(INFLUENCE_RANK, tier)) return null;

  if (channel === 'linkedin') {
    const canInfluenceHire = INFLUENCE_RANK[tier] >= INFLUENCE_RANK.peer;
    return canInfluenceHire
      ? SUGGESTED_SEQUENCE_IDS.linkedinPrincipal
      : SUGGESTED_SEQUENCE_IDS.linkedinTa;
  }

  if (tier === 'ta' || tier === 'agency') return SUGGESTED_SEQUENCE_IDS.ta;

  const title = contact?.title;
  if (tier === 'exec' && titleContainsWholeRun(title, STAKEHOLDER_TITLE_RUNS.finance)) {
    return SUGGESTED_SEQUENCE_IDS.cfo;
  }
  if ((tier === 'exec' || tier === 'hm')
    && titleContainsWholeRun(title, STAKEHOLDER_TITLE_RUNS.chiefRevenue)) {
    return SUGGESTED_SEQUENCE_IDS.cro;
  }
  if ((tier === 'hm' || tier === 'peer')
    && titleContainsWholeRun(title, STAKEHOLDER_TITLE_RUNS.salesLeadership)) {
    return SUGGESTED_SEQUENCE_IDS.sales;
  }
  if (tier === 'peer' && titleContainsWholeRun(title, STAKEHOLDER_TITLE_RUNS.demandgen)) {
    return SUGGESTED_SEQUENCE_IDS.demandgen;
  }
  if (tier === 'hm' || tier === 'exec' || tier === 'peer') {
    return SUGGESTED_SEQUENCE_IDS.principal;
  }
  return null;
}

// DATA_DIR, never ROOT_DIR + 'data'. See tests/data-dir-sandbox.test.mjs.
const SEQUENCES_PATH = path.join(DATA_DIR, 'contact-sequences.json');
const TEMPLATES_PATH = path.join(ROOT_DIR, 'templates', 'outreach-sequences.json');

// Load the static template library. Returns [] if the file is missing.
function loadTemplates() {
  try {
    const raw = JSON.parse(fs.readFileSync(TEMPLATES_PATH, 'utf8'));
    return Array.isArray(raw.sequences) ? raw.sequences : [];
  } catch { return []; }
}

function readSequences() {
  try {
    return JSON.parse(fs.readFileSync(SEQUENCES_PATH, 'utf8'));
  } catch { return {}; }
}

function writeSequences(data) {
  fs.mkdirSync(path.dirname(SEQUENCES_PATH), { recursive: true });
  fs.writeFileSync(SEQUENCES_PATH, JSON.stringify(data, null, 2) + '\n');
}

function seqKey(source, id) { return `${source}:${id}`; }

// Compute the calendar date N days from `fromDate` (YYYY-MM-DD).
function addDays(fromDate, n) {
  const d = new Date(fromDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Start a sequence for a contact. Idempotent if the same sequenceId is already
// active: returns the existing state without overwriting. Returns the new state
// entry and the first touch template so the caller can generate a draft.
function startSequence(source, id, sequenceId, startDate) {
  const key = seqKey(source, id);
  const data = readSequences();
  const templates = loadTemplates();
  const template = templates.find(t => t.id === sequenceId);
  if (!template) throw new Error(`Unknown sequence: ${sequenceId}`);

  const today = startDate || new Date().toISOString().slice(0, 10);
  const firstTouch = template.touches[0];
  const nextDue = addDays(today, firstTouch?.dayOffset ?? 0);

  // Idempotent: do not overwrite an active sequence with the same id.
  if (data[key] && data[key].sequenceId === sequenceId && !data[key].completedAt) {
    return { entry: data[key], template, isNew: false };
  }

  const entry = {
    sequenceId,
    startedAt: today,
    step: 0,
    nextStepDue: nextDue,
    paused: false,
    pausedAt: null,
    completedAt: null,
  };
  data[key] = entry;
  writeSequences(data);
  return { entry, template, isNew: true };
}

// Record that step N was completed (a draft was sent). Advances the clock to the
// next step's due date, or marks completedAt if the sequence is done.
function advanceSequence(source, id, date) {
  const key = seqKey(source, id);
  const data = readSequences();
  const entry = data[key];
  if (!entry) throw new Error(`No active sequence for ${key}`);
  const templates = loadTemplates();
  const template = templates.find(t => t.id === entry.sequenceId);
  if (!template) throw new Error(`Template not found: ${entry.sequenceId}`);

  const today = date || new Date().toISOString().slice(0, 10);
  const nextStep = entry.step + 1;
  const nextTouch = template.touches[nextStep];

  entry.step = nextStep;
  entry.paused = false;
  entry.pausedAt = null;

  if (nextTouch) {
    entry.nextStepDue = addDays(today, nextTouch.dayOffset);
  } else {
    entry.completedAt = today;
    entry.nextStepDue = null;
  }

  data[key] = entry;
  writeSequences(data);
  return { entry, template, done: !nextTouch };
}

// Pause a contact's active sequence (e.g., because they replied on another channel).
function pauseSequence(source, id, date) {
  const key = seqKey(source, id);
  const data = readSequences();
  const entry = data[key];
  if (!entry || entry.completedAt) return null;
  const today = date || new Date().toISOString().slice(0, 10);
  entry.paused = true;
  entry.pausedAt = today;
  data[key] = entry;
  writeSequences(data);
  return entry;
}

// Resume a paused sequence.
function resumeSequence(source, id) {
  const key = seqKey(source, id);
  const data = readSequences();
  const entry = data[key];
  if (!entry) return null;
  entry.paused = false;
  entry.pausedAt = null;
  data[key] = entry;
  writeSequences(data);
  return entry;
}

// Get the current sequence state for a contact. Returns null if none.
function getSequence(source, id) {
  const data = readSequences();
  return data[seqKey(source, id)] || null;
}

// Get ALL active (non-completed) sequence states, for stale-engine query.
function getActiveSequences() {
  const data = readSequences();
  const out = [];
  for (const [key, entry] of Object.entries(data)) {
    if (!entry.completedAt) out.push({ key, ...entry });
  }
  return out;
}

// Get the template definition by id.
function getTemplate(sequenceId) {
  return loadTemplates().find(t => t.id === sequenceId) || null;
}

// Get all templates (for UI picker).
function getAllTemplates() {
  return loadTemplates();
}

export {
  startSequence, advanceSequence, pauseSequence, resumeSequence,
  getSequence, getActiveSequences, getTemplate, getAllTemplates,
};
