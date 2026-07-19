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

function parseCsvInfluencers(csv) {
  const lines = String(csv || '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
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
  for (let i = 1; i < lines.length; i++) {
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

export {
  ensureLikedinSsiDir, loadInfluencer, toneInstruction,
  readInfluencers, writeInfluencers, nextInfluencerId, normalizeInfluencer,
  parseCsvInfluencers, INFLUENCERS_TEMPLATE_CSV,
};

