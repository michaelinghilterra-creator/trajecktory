import fs from 'fs';
import path from 'path';
import { LINKEDIN_SSI_DIR } from '../config.mjs';
import { parseCsvLine } from './csv.mjs';

function ensureLikedinSsiDir() {
  if (!fs.existsSync(LINKEDIN_SSI_DIR)) {
    fs.mkdirSync(LINKEDIN_SSI_DIR, { recursive: true });
  }
}

// ── Influencer storage ────────────────────────────────────────────────────────
// The directory used to be created without any of the files in it, and there was
// no create route, so the tab could not be populated from the UI at all: the only
// way in was to hand-author influencers.json.

const INFLUENCERS_FILE = () => path.join(LINKEDIN_SSI_DIR, 'influencers.json');

function readInfluencers() {
  try {
    const raw = JSON.parse(fs.readFileSync(INFLUENCERS_FILE(), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

function writeInfluencers(list) {
  ensureLikedinSsiDir();
  fs.writeFileSync(INFLUENCERS_FILE(), JSON.stringify(list || [], null, 2) + '\n');
}

// Ids are numeric because the PATCH route and the engagement log both look up by
// parseInt. Monotonic max+1 rather than list length, so deleting never collides.
function nextInfluencerId(list) {
  return list.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;
}

// Normalize one incoming influencer. `name` is the only hard requirement: the
// rest is progressive enrichment, and demanding a full record up front is what
// pushes people back to editing JSON by hand.
function normalizeInfluencer(input, id) {
  const s = (v) => String(v == null ? '' : v).trim();
  const name = s(input.name);
  if (!name) return null;
  return {
    id,
    name,
    role: s(input.role),
    track: s(input.track) || 'general',
    tier: s(input.tier) || 'local',
    location: s(input.location),
    linkedinUrl: s(input.linkedinUrl || input.linkedin),
    whyFollow: s(input.whyFollow || input.why_follow),
    engagementTip: s(input.engagementTip || input.engagement_tip),
    following: !!input.following,
    connected: !!input.connected,
    engaged: !!input.engaged,
    lastEngagement: s(input.lastEngagement) || null,
    engagementCount: Number(input.engagementCount) || 0,
    notes: s(input.notes),
  };
}

// Influencer CSV. Deliberately NOT the shared CONTACTS_TEMPLATE_CSV: that one is
// keyed on company/first/last/title and maps to a contact record, which is a
// different shape from an influencer. Only the generic line splitter is shared.
const INFLUENCERS_TEMPLATE_CSV =
  'name,role,track,tier,location,linkedin,why_follow,engagement_tip\n'
  + 'Jane Rivera,VP of Revenue Operations,revops,national,"Austin, TX",https://www.linkedin.com/in/example,'
  + 'Posts weekly about GTM systems,Comment on her pipeline-hygiene threads\n';

// Upper bound on a single import. The row count comes straight off an uploaded
// file, so without this the parse loop is user-controlled and unbounded, which is
// both a denial-of-service shape and a way to write an arbitrarily large
// influencers.json. Rejected outright rather than silently truncated: quietly
// dropping half of someone's list is worse than telling them to split the file.
const MAX_IMPORT_ROWS = 2000;

function parseCsvInfluencers(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const dataRows = lines.length - 1;
  if (dataRows > MAX_IMPORT_ROWS) {
    throw new Error(`That file has ${dataRows} rows. Import up to ${MAX_IMPORT_ROWS} at a time.`);
  }
  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const idx = {
    name: header.indexOf('name'),
    role: header.indexOf('role'),
    track: header.indexOf('track'),
    tier: header.indexOf('tier'),
    location: header.indexOf('location'),
    linkedin: header.indexOf('linkedin'),
    why_follow: header.indexOf('why_follow'),
    engagement_tip: header.indexOf('engagement_tip'),
  };
  if (idx.name < 0) throw new Error('CSV must have a "name" column.');
  const get = (v, i) => (i >= 0 && i < v.length ? v[i] : '');
  const rows = [];
  // Bound the loop against the constant as well as validating above, so the
  // iteration count can never be driven purely by the uploaded file.
  const limit = Math.min(lines.length, MAX_IMPORT_ROWS + 1);
  for (let i = 1; i < limit; i++) {
    const v = parseCsvLine(lines[i]);
    const name = get(v, idx.name);
    if (!name) continue;
    rows.push({
      name,
      role: get(v, idx.role),
      track: get(v, idx.track),
      tier: get(v, idx.tier),
      location: get(v, idx.location),
      linkedin: get(v, idx.linkedin),
      why_follow: get(v, idx.why_follow),
      engagement_tip: get(v, idx.engagement_tip),
    });
  }
  return rows;
}

// GET /api/linkedin-ssi/summary — get current SSI score and tracker
function loadInfluencer({ influencerId, influencerName }) {
  try {
    const p = path.join(LINKEDIN_SSI_DIR, 'influencers.json');
    if (!fs.existsSync(p)) return null;
    const all = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (influencerId != null) return all.find(i => i.id === parseInt(influencerId, 10)) || null;
    if (influencerName) return all.find(i => i.name === influencerName) || null;
    return null;
  } catch { return null; }
}

// Helper: tone instruction snippet for Claude
function toneInstruction(tone) {
  const map = {
    Insightful: 'Lean into a thoughtful, additive perspective. Add one specific data point, framing, or example the original post did not cover.',
    Supportive: 'Affirm their point, then add one specific detail that signals you actually read the post (not generic praise).',
    Contrarian: 'Push back respectfully on one specific claim or framing. Be precise about what you disagree with and why. Avoid being snarky.',
    Curious: 'Ask one sharp, specific question that opens conversation. The question must be grounded in the post content, not generic.',
    Warm: 'Be friendly and conversational. First name basis, low-formality, but professional.',
    Concise: 'Be tight. Cut every word that is not load-bearing.',
    Professional: 'Use measured, executive-appropriate language. No slang. No emojis.',
  };
  return map[tone] || map.Insightful;
}

// POST /api/linkedin-ssi/generate-response — Claude-generated LinkedIn comment reply

// ── Connection-note helpers (shared across the influencer and TA/recruiter
//    draft paths) ───────────────────────────────────────────────────────────
// These are PURE (no fs, no network) so the draft routes can reuse one prompt
// shape and one trimmer, and so both are unit-tested directly. The note
// generator started life influencer-only; generalizing it to draft for any
// contact (a target-talent lead or a recruiter reachable only on LinkedIn)
// meant lifting the character-fit and prompt-assembly logic out of the route.

// Trim a drafted note to LinkedIn's hard 300-char cap while KEEPING the
// "Thanks, <first>" sign-off. Prefer cutting at a sentence end, then a word
// boundary. Returns { text, length }. A note already within the cap is returned
// untouched. This is verbatim the trimming the influencer route used inline; it
// lives here now so the generic path gets the same guarantees.
function fitConnectNote(text, firstName, limit = 300) {
  const response = String(text ?? '').trim();
  if (response.length <= limit) return { text: response, length: response.length };
  const first = String(firstName ?? '').trim();
  const SIGNOFF = `Thanks, ${first}`;
  const budget = limit - SIGNOFF.length - 1; // 1 for the space before the sign-off
  const escFirst = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let body = response.replace(new RegExp('\\s*Thanks,?\\s*' + escFirst + '\\.?\\s*$', 'i'), '').trim();
  if (body.length > budget) {
    const slice = body.slice(0, budget);
    // Prefer the last sentence end (. ! ?) in the slice, if it is not too early.
    const lastSentence = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
    if (lastSentence > budget * 0.5) {
      body = slice.slice(0, lastSentence + 1);
    } else {
      const lastSpace = slice.lastIndexOf(' ');
      body = (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).replace(/[,;:]+$/, '') + '.';
    }
  }
  const out = `${body} ${SIGNOFF}`;
  return { text: out, length: out.length };
}

// Assemble the LLM prompt for a connection note to a GENERIC recipient (a
// target-talent or recruiter contact, not only a tracked influencer). The
// caller composes `guidance` (the source-specific anchor: why this connection
// makes sense) so the source judgment stays in the route and this stays a dumb,
// testable assembler. Hard rules mirror the influencer path: 300-char cap, no em
// dashes, one grounded reason, a "Thanks, <first>" sign-off, no desperation.
function buildConnectPrompt({
  senderName, senderFirst, senderHeadline = '',
  recipientName, recipientFirst = '', recipientRole = '', recipientCompany = '',
  guidance = '', cvExcerpt = '', tone = 'Warm', toneText = '', targetMax = 280,
} = {}) {
  const first = String(senderFirst ?? '').trim();
  const openExample = String(recipientFirst || 'Alex').trim();
  return `You are drafting a LinkedIn CONNECTION REQUEST note from ${senderName}${senderHeadline ? ` (${senderHeadline})` : ''} to a contact.

THE RECIPIENT:
- Name: ${recipientName}
- Role: ${recipientRole || '(unknown)'}${recipientCompany ? `\n- Company: ${recipientCompany}` : ''}

ABOUT ${first.toUpperCase()} (for grounding, do not copy verbatim):
${cvExcerpt || '(CV not available)'}

WHY CONNECT: ${guidance || `Anchor on shared focus in the GTM / RevOps / analytics space. Signal ${first} is a fellow operator, not a job seeker.`}

TONE DIRECTIVE (${tone}): ${toneText}

HARD RULES:
- ABSOLUTE MAXIMUM ${targetMax} characters TOTAL (including the "Thanks, ${first}" sign-off). LinkedIn caps connection notes at 300 characters and will reject anything longer. Count characters before responding. Aim for ${targetMax - 20} to leave safety margin.
- Open with their first name + comma. Example: "Hi ${openExample},"
- NO em dashes. Use periods, commas, semicolons, colons, or parentheses.
- One reason to connect that is grounded in the context above. Be specific, not generic.
- End with a sign-off: "Thanks, ${first}" (with the comma).
- No "I'd love to pick your brain". No "I hope this finds you well". No "Quick question for you".
- Do NOT sound desperate and do NOT lead with being in market or looking for a job.
- Do NOT include emojis.

Return ONLY the body of the connection note, ready to paste into LinkedIn. No quotes, no preface, no character count, no explanation.`;
}

export {
  ensureLikedinSsiDir, loadInfluencer, toneInstruction,
  readInfluencers, writeInfluencers, nextInfluencerId, normalizeInfluencer,
  parseCsvInfluencers, INFLUENCERS_TEMPLATE_CSV,
  fitConnectNote, buildConnectPrompt,
};

