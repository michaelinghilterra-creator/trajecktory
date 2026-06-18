import fs from 'fs';
import path from 'path';
import { LINKEDIN_SSI_DIR } from '../config.mjs';

function ensureLikedinSsiDir() {
  if (!fs.existsSync(LINKEDIN_SSI_DIR)) {
    fs.mkdirSync(LINKEDIN_SSI_DIR, { recursive: true });
  }
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

export { ensureLikedinSsiDir, loadInfluencer, toneInstruction };

