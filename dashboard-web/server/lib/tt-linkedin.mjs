import fs from 'fs';
import { TT_LINKEDIN_PATH } from '../config.mjs';

/**
 * lib/tt-linkedin.mjs — LinkedIn connection state for TA Outreach contacts.
 *
 * WHY THIS EXISTS (and why it is separate from the outreach pipeline)
 * The TA pipeline (Not Contacted → Drafted → Sent → Replied → Meeting → Connected)
 * tracks how far a CONVERSATION has progressed. Whether someone accepted your
 * LinkedIn invite is a DIFFERENT axis: they can accept the invite while the
 * conversation is still stuck at "Sent, no reply". Folding the two into one linear
 * track is what made the pipeline's terminal "Connected" stage read as "LinkedIn
 * connected" when it actually means "warm working relationship". This axis keeps
 * them apart.
 *
 * STORAGE: a sidecar JSON keyed by contact id — { [id]: { state, updated } }.
 * Absence of an entry means 'Not Connected' (the default), so existing contacts
 * need no migration. A sidecar (not a column in target-talent.md) is deliberate:
 * adding a markdown column to that table is the documented index-drift hazard.
 */

// The three states, in pipeline order. Index doubles as the sort/advance rank.
export const LINKEDIN_STATES = ['Not Connected', 'Invite Pending', 'Connected'];
const RANK = Object.fromEntries(LINKEDIN_STATES.map((s, i) => [s, i]));

export function isLinkedInState(state) {
  return LINKEDIN_STATES.includes(state);
}

// Sort/advance rank for a state label. Unknown → 0 (Not Connected).
export function linkedInRank(state) {
  return RANK[state] ?? 0;
}

function readMap() {
  try {
    const j = JSON.parse(fs.readFileSync(TT_LINKEDIN_PATH, 'utf8'));
    return (j && typeof j === 'object') ? j : {};
  } catch {
    return {};
  }
}

function writeMap(map) {
  try {
    fs.writeFileSync(TT_LINKEDIN_PATH, JSON.stringify(map, null, 2), 'utf8');
  } catch { /* best-effort: a missing LinkedIn badge is not worth failing a request over */ }
}

// The whole map, for callers that want to attach status to many rows in one pass
// (parseTargetTalentMd reads it once per parse rather than once per contact).
export function readLinkedInMap() {
  return readMap();
}

// Label for one contact. Default 'Not Connected' when no entry exists.
export function getLinkedInStatus(id) {
  const e = readMap()[String(id)];
  return (e && isLinkedInState(e.state)) ? e.state : 'Not Connected';
}

// Explicit user set — any transition allowed, including back to 'Not Connected'.
// Setting 'Not Connected' clears the entry so the file stays sparse. Returns the
// stored label. Throws on an invalid state so the route can 400.
export function setLinkedInStatus(id, state, date) {
  if (!isLinkedInState(state)) {
    throw new Error(`Invalid LinkedIn state. Must be one of: ${LINKEDIN_STATES.join(', ')}`);
  }
  const map = readMap();
  const key = String(id);
  if (state === 'Not Connected') {
    delete map[key];
  } else {
    map[key] = { state, updated: date || new Date().toISOString().slice(0, 10) };
  }
  writeMap(map);
  return state;
}

// Auto path: an invite just went out, so advance to 'Invite Pending' — but ONLY
// from 'Not Connected'. Never regress someone already 'Connected' (they accepted
// long ago) or overwrite an existing 'Invite Pending' timestamp. Returns the
// resulting label. Idempotent.
export function markInvitePending(id, date) {
  const cur = getLinkedInStatus(id);
  if (linkedInRank(cur) >= linkedInRank('Invite Pending')) return cur;
  return setLinkedInStatus(id, 'Invite Pending', date);
}
