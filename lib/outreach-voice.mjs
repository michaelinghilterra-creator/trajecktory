import { ROOT_DIR } from '../dashboard-web/server/config.mjs';
import { readVoiceRules } from '../dashboard-web/server/lib/anthropic.mjs';
import { buildPlainContract } from './outreach-rubric.mjs';
import { renderFactBlock } from './outreach-packet.mjs';

const p = packet => packet || {};
const r = packet => p(packet).recipient || {};
const s = packet => p(packet).sender || {};
const rel = packet => p(packet).relationship || {};
const voiceBlock = (packet) => {
  const rules = packet?.sender?.voiceRules ?? readVoiceRules(ROOT_DIR);
  return rules ? `\n\n== VOICE RULES (from modes/_profile.md, must follow) ==\n${rules}` : '';
};

function augustLiFollowup(packet) {
  const recent = rel(packet).recentPitch;
  return `You are drafting a brief LinkedIn ${rel(packet).connected ? 'DIRECT MESSAGE (a free DM)' : 'FOLLOW-UP MESSAGE (an InMail)'}.

${rel(packet).connected
    ? 'YOU ARE ALREADY CONNECTED. Do not say you sent a request, ask whether it arrived, or imply the connection is pending. A short warm nod to having just connected is fine; then go to the real reason for writing.'
    : 'THIS IS NOT A NEW CONNECTION REQUEST. The invite is already out. Write the next purposeful note and do not restate the invite.'}

Read the thread: never repeat a point, proof, or ask already made, and do not open by narrating it or dwelling on the lack of a reply.
${recent ? `
NUDGE MODE:
- Write a short nudge, not a new pitch. Do not reintroduce ${s(packet).firstName || 'the sender'}, restate proof points, or repeat the earlier ask word for word.
- Reference the earlier note lightly and specifically, then add exactly one new detail. If nothing new exists, use a one- or two-sentence friendly bump.
` : ''}
HARD RULES:
- Open with "Hi ${r(packet).first || 'there'}," and go to specific interest and candidacy in a confident tone.
- ${rel(packet).connected ? 'Treat the connection as established.' : 'Never mention not hearing back. If you mention the invite, put one brief, confident clause in the middle.'}
- ${recent ? 'At most one new specific detail.' : 'Give one concrete proof point from the CV or portfolio.'}
- Close with one clear, low-friction ask: a quick reply or a pointer to the right person. Do not ask for a call, chat, meeting, or calendar time.
- Length: ${recent ? '40 to 70 words' : '90 to 150 words'}.
- Structure: ${recent ? '1 to 2' : '2 or 3'} short paragraphs separated by a blank line.
- No em dashes.
- Banned: "haven't heard back", "never heard back", "which is fine", "I know you are busy", "just following up", "circling back", "wanted to reconnect", "sorry to bother", "I hope this finds you well", "quick question", "pick your brain", and apologies.
- End with "Thanks, ${s(packet).firstName || 'the sender'}".
- No emojis and no desperation.${voiceBlock(packet)}`;
}

function augustConnectNote(packet) {
  return `You are drafting a LinkedIn CONNECTION REQUEST note.

HARD RULES:
- Absolute maximum 280 characters total, including the "Thanks, ${s(packet).firstName || 'the sender'}" sign-off. Aim for 260.
- Open with "Hi ${r(packet).first || 'there'},".
- No em dashes.
- Give one specific, grounded reason to connect.
- Keep it on one line and end "Thanks, ${s(packet).firstName || 'the sender'}".
- No "I'd love to pick your brain", "I hope this finds you well", or "Quick question for you".
- Do not sound desperate or lead with looking for a job.
- No emojis.`;
}

function augustTaDm(packet) {
  return `You are drafting a brief LinkedIn DIRECT MESSAGE to an internal Talent Acquisition / People-team contact. It is not an email or connection request.

${rel(packet).connected
    ? 'YOU ARE ALREADY CONNECTED. Do not say you sent a request or imply it is pending.'
    : 'Write a purposeful message. Do not write "I would like to connect".'}

MESSAGE INTENT:
${rel(packet).recentPitch ? 'FOLLOW UP ON YOUR LAST MESSAGE. Send one light, no-guilt bump that names the earlier topic and adds one small new thing.' : 'FIRST / FRESH TOUCH. Surface the sender as a strong candidate with specific interest and one reason worth a reply.'}

STYLE REQUIREMENTS:
- Warm, direct, senior-operator LinkedIn voice. 40 to 110 words.
- Use 2 to 3 short paragraphs separated by blank lines.
- Open with specific interest, then one concrete proof point.
- No corporate filler and no em dashes. Never invent metrics.
- Close with one low-friction ask: a reply or pointer. Do not ask for a call, chat, meeting, or time.
- Omit a subject and signature. Omit the greeting because the UI prefills it. Begin with substantive content.${voiceBlock(packet)}`;
}

function augustTaEmail(packet) {
  return `You are drafting a warm in-network email to an internal Talent Acquisition / People-team employee at a target company. This is not a blind recruiter pitch.

STYLE REQUIREMENTS:
- Warm, direct, senior-operator tone. Maximum 140 words.
- No corporate filler and no em dashes. Never invent metrics.
- Open with a specific reason for contacting this person at this company.
- Lead with the most specific named portfolio artifact available; otherwise use the most relevant quantified CV proof point.
- Make the ask low-friction. Do not ask for a call, chat, conversation, meeting, or time.
- Do not ask them to forward a resume or do recruiting work.
- Use the exact application timing from the fact packet; never invent timing.
- Use a concise subject.
- Plain text, 3 to 4 short paragraphs, 1 to 2 sentences per paragraph. Omit the greeting and signature because the UI supplies them.${voiceBlock(packet)}`;
}

function augustReferralDm(packet) {
  return `You are drafting a warm, personal LinkedIn DIRECT MESSAGE to someone in the sender's professional network, not a cold recruiter lead.

MESSAGE INTENT:
Reconnect with no ask. Reopen the relationship warmly and specifically, share a light line on what the sender is doing now, and invite a catch-up. Do not make a referral ask.

STYLE REQUIREMENTS:
- Warm and personal, grounded in how you know them. Reference the shared history naturally.
- LinkedIn DM voice: conversational and tight. 40 to 110 words. Never a wall of text.
- 2 to 3 short paragraphs separated by a literal blank line, so it scans on a phone.
- Direct, human, no corporate filler ("I hope this finds you well", "reaching out to touch base").
- No em dashes anywhere. Use periods, commas, semicolons, colons, or parentheses.
- Never invent metrics, claims, or shared history.
- If, and only if, the intent is a referral ask, make it specific and trivially easy to decline, and offer to send a short blurb plus resume.
- Close with one low-friction next step or a genuine sign-off matching the intent. Do not ask for a call or a specific block of time.
- Omit a subject line, signature block, trailing sign-off, greeting, and bare first-name address because the UI prefills the greeting.${voiceBlock(packet)}`;
}

function augustReferralEmail(packet) {
  return `You are drafting a warm, personal email to someone in the sender's real professional network, not cold outreach.

MESSAGE INTENT:
Reconnect with no ask. Reopen the relationship warmly and specifically, share a light line on what the sender is doing now, and invite a catch-up. Do not make a referral ask.

STYLE REQUIREMENTS:
- Warm and personal, grounded in how you know them. This is the single most important cue.
- Direct and human. Maximum 130 words. No corporate filler or em dashes.
- Never invent metrics, claims, or shared history.
- If, and only if, the intent is a referral ask, make it specific and trivially easy to decline, and offer to send a short blurb plus resume.
- Close with a low-friction next step or genuine sign-off matching the intent.
- Keep the subject short and human.
- Plain text, 2 to 4 short paragraphs. Omit the greeting, bare first-name address, signature block, and trailing sign-off because the UI supplies the salutation.${voiceBlock(packet)}`;
}

function augustAppFollowup(packet) {
  return `You are drafting a brief professional application follow-up email.

STYLE REQUIREMENTS:
- Under 100 words in the body.
- Direct, senior-operator tone. No corporate filler or em dashes.
- Reference the specific role and company by name.
- Lead with one specific reason the role matters. Add one new data point or framing that was not in the original application.
- Close with one low-friction ask: a quick reply on timing or being pointed to the right person. Do not ask for a call, chat, intro, or calendar time.
- Never invent metrics or claims not on the CV.
- Keep the subject tight and role-specific.
- Use plain text. Omit greeting and signature because the UI supplies them.${voiceBlock(packet)}`;
}

const AUGUST = Object.freeze({
  li_followup: augustLiFollowup,
  connect_note: augustConnectNote,
  ta_dm: augustTaDm,
  ta_email: augustTaEmail,
  referral_dm: augustReferralDm,
  referral_email: augustReferralEmail,
  app_followup: augustAppFollowup,
});

export function augustInstructions(kind, packet) {
  const fn = AUGUST[kind];
  if (!fn) throw new Error(`Unsupported outreach kind: ${kind}`);
  return fn(packet);
}

export function buildAugustPrompt(packet) {
  return `${renderFactBlock(packet)}\n\n${augustInstructions(packet.kind, packet)}\n\n${buildPlainContract(packet.surfaceId)}`;
}

function replaceMessageIntent(instructions, messageIntent) {
  if (!messageIntent) return instructions;
  return instructions.replace(/(MESSAGE INTENT:\n)[^\n]+/, `$1${messageIntent}`);
}

export function buildAugustPromptWithGuidance(packet, { messageIntent = '', guidance = [] } = {}) {
  const lines = (Array.isArray(guidance) ? guidance : [guidance]).filter(Boolean);
  let instructions = replaceMessageIntent(augustInstructions(packet.kind, packet), messageIntent);
  if (lines.length) instructions += `\n\n== ROUTE GUIDANCE ==\n${lines.join('\n')}`;
  return `${renderFactBlock(packet)}\n\n${instructions}\n\n${buildPlainContract(packet.surfaceId)}`;
}

export function wrapReferralDraft(body, packet) {
  const first = packet?.recipient?.first || 'there';
  const sender = packet?.sender?.firstName || '';
  return `Hi ${first},\n\n${String(body || '').trim()}\n\nBest,${sender ? `\n${sender}` : ''}`;
}

export function parseDraftText(raw) {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const value = JSON.parse(match[0]);
      if (typeof value?.body === 'string' && value.body.trim()) {
        return {
          subject: typeof value.subject === 'string' ? value.subject : undefined,
          body: value.body,
        };
      }
    }
  } catch { /* fall through to the plain-text route fallback */ }
  return { subject: undefined, body: text };
}

export const FINISH_OPTIONS = Object.freeze({
  li_followup: { cleaner: 'prose', stripSalutationFor: null, stripSignature: false },
  connect_note: { cleaner: 'prose', stripSalutationFor: null, stripSignature: false, flatten: true, hardFit: null },
  ta_dm: { cleaner: 'prose', stripSignature: true },
  ta_email: { cleaner: 'email', stripSignature: true },
  referral_dm: { cleaner: 'prose', stripSignature: true },
  referral_email: { cleaner: 'email', stripSignature: true },
  app_followup: { cleaner: 'email', stripSignature: true },
});

const FIXED_GREETING_KINDS = new Set(['ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup']);

export function finishOptionsFor(packet) {
  const options = FINISH_OPTIONS[packet.kind];
  return FIXED_GREETING_KINDS.has(packet.kind)
    ? { ...options, stripSalutationFor: packet.recipient.first, stripSignature: true }
    : { ...options };
}
