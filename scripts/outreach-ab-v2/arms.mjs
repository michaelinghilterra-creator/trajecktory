import { config, loadHarnessModules } from './bootstrap.mjs';
import { renderFactBlock } from '../../lib/outreach-packet.mjs';
import { augustInstructions, buildAugustPrompt } from '../../lib/outreach-voice.mjs';
import { buildPlainContract, buildWritingRules } from '../../lib/outreach-rubric.mjs';

const { readVoiceRules } = await loadHarnessModules();

export const ARMS = Object.freeze(['august', 'lap7', 'august_plus']);
export const AUGUST_PLUS_RULE = 'Include a company detail only when it ties directly to the work this role does. Otherwise leave the company out.';

const p = packet => packet || {};
const r = packet => p(packet).recipient || {};
const s = packet => p(packet).sender || {};
const rel = packet => p(packet).relationship || {};
const role = packet => p(packet).application?.role || 'the relevant role';
const voice = () => readVoiceRules(config.ROOT_DIR);
const voiceBlock = () => {
  const rules = voice();
  return rules ? `\n\n== VOICE RULES (from modes/_profile.md, must follow) ==\n${rules}` : '';
};

function tierAsk(packet) {
  const tier = r(packet).tier;
  const appliedRole = role(packet);
  if (tier === 'exec') return `Ask who leads hiring for the ${appliedRole} role; do not ask them to review or forward an application.`;
  if (tier === 'hm' || tier === 'peer') return `Ask for a look at the ${appliedRole} application or one role-specific question.`;
  return `Ask for a quick reply or for the ${appliedRole} application to reach the hiring manager.`;
}

function lap7LiFollowup(packet) {
  return `${augustInstructions('li_followup', packet)}
- Lead with genuine interest in the company or its work. ${p(packet).application ? `Name the ${role(packet)} role after that opener.` : 'Do not claim an application was submitted.'}
- ${tierAsk(packet)} A soft redirect ask is allowed.
- Do not pitch a job-search tool or job-search article.${voiceBlock()}`;
}

function lap7ConnectNote(packet) {
  return `${augustInstructions('connect_note', packet)}
- Open with genuine interest in the company or the work.
- ${p(packet).application ? `Name the ${role(packet)} role after the genuine-interest opener.` : 'Do not claim an application was submitted.'}
- Do not pitch a job-search tool or job-search article.
- Do not ask for a call, chat, meeting, calendar time, or a named amount of time.`;
}

function lap7TaDm(packet) {
  return `${augustInstructions('ta_dm', packet)}
- Lead with genuine interest in the company or its work. ${p(packet).application ? `Name the ${role(packet)} role next.` : 'Do not imply an application was submitted.'}
- Use one or two concrete proof points.
- ${tierAsk(packet)} A soft redirect ask is allowed.
- Do not pitch a job-search tool or job-search article.
- Do not write "without a reply", "haven't heard back", "never heard back", or an apology.`;
}

function lap7TaEmail(packet) {
  return `${augustInstructions('ta_email', packet)}
- Open with genuine interest in the company or its work, not with applying. ${p(packet).application ? `Name the ${role(packet)} role after the opener.` : 'Do not claim an application was submitted.'}
- Use one or two proof points, preferring a named artifact.
- ${tierAsk(packet)} A soft redirect ask is allowed.
- Do not pitch a job-search tool or job-search article.
- Do not write "without a reply", "haven't heard back", "never heard back", or an apology.
- Follow this paragraph pattern: interest, proof, why-here link, low-friction close.`;
}

function lap7ReferralDm(packet) {
  return `You are drafting a warm, personal LinkedIn DIRECT MESSAGE to someone in the sender's professional network, not a cold recruiter lead.

${rel(packet).connected ? 'YOU ARE ALREADY CONNECTED. Do not imply the connection is pending.' : 'Write a purposeful message. Do not write "I would like to connect" or claim you connected or reconnected.'}

MESSAGE INTENT:
Reconnect with no ask. Reopen the relationship warmly and specifically, share a light line on what the sender is doing now, and invite a catch-up. Do not make a referral ask.

STYLE REQUIREMENTS:
- Warm and personal, grounded in how you know them. Reference the shared history naturally.
- Conversational and tight. 40 to 110 words in 2 to 3 short paragraphs.
- Direct and human. No corporate filler or em dashes. Never invent facts.
- If, and only if, the intent becomes a referral ask, make it specific and trivially easy to decline. ${tierAsk(packet)} A soft redirect is allowed. Offer a short blurb and resume.
- Close with one low-friction next step or genuine sign-off. Do not ask for a call or a block of time.
- Do not mention a lack of reply or apologize.
- Omit a subject. Begin with "Hi ${r(packet).first || 'there'}," and end with "Best," then "${s(packet).firstName || 'the sender'}".${voiceBlock()}`;
}

function lap7ReferralEmail(packet) {
  return `You are drafting a warm, personal message to someone in the sender's real professional network, not cold outreach.

MESSAGE INTENT:
Reconnect with no ask. Reopen the relationship warmly and specifically, share a light line on what the sender is doing now, and invite a catch-up. Do not make a referral ask.

STYLE REQUIREMENTS:
- Warm and personal, grounded in how you know them. This is the single most important cue.
- Direct and human. Maximum 130 words. No corporate filler or em dashes.
- Never invent metrics, claims, or shared history.
- If, and only if, the intent becomes a referral ask, make it specific and trivially easy to decline. ${tierAsk(packet)} A soft redirect is allowed. Offer a short blurb and resume.
- Close with a low-friction next step or genuine sign-off.
- Do not mention a lack of reply or apologize.
- Keep the subject short and human.
- Plain text, 2 to 4 short paragraphs. Begin with "Hi ${r(packet).first || 'there'}," and end with "Best," then "${s(packet).firstName || 'the sender'}".${voiceBlock()}`;
}

function lap7AppFollowup(packet) {
  return `You are drafting a brief professional application follow-up email.

STYLE REQUIREMENTS:
- Under 100 words in the body.
- Direct, senior-operator tone. No corporate filler or em dashes.
- Open with genuine interest in the company or work, not with applying. Reference the specific role and company.
- ${rel(packet).recentPitch ? 'Acknowledge the earlier follow-up and add genuinely new value without repeating the original pitch.' : 'Lead with one specific reason this role matters. Add one new data point or framing that was not in the original application.'}
- Close with one low-friction ask: a quick reply on timing or a soft redirect to the person handling the role. Do not ask for a call, chat, intro, meeting, or calendar time.
- Never invent metrics or claims not on the CV.
- Do not pitch a job-search tool or job-search article.
- Do not mention a lack of reply or apologize.
- Keep the subject tight and role-specific.
- Use plain text. Omit greeting and signature because the UI supplies them.${voiceBlock()}`;
}

const LAP7 = Object.freeze({
  li_followup: lap7LiFollowup,
  connect_note: lap7ConnectNote,
  ta_dm: lap7TaDm,
  ta_email: lap7TaEmail,
  referral_dm: lap7ReferralDm,
  referral_email: lap7ReferralEmail,
  app_followup: lap7AppFollowup,
});

export function armInstructions(arm, packet) {
  if (!ARMS.includes(arm)) throw new Error(`Unknown arm: ${arm}`);
  if (arm === 'august') return augustInstructions(packet?.kind, packet);
  if (arm === 'august_plus') return `${augustInstructions(packet?.kind, packet)}\n- ${AUGUST_PLUS_RULE}`;
  const fn = LAP7[packet?.kind];
  if (!fn) throw new Error(`Unsupported outreach kind: ${packet?.kind}`);
  const base = fn(packet);
  const rules = buildWritingRules(packet.surfaceId);
  return rules ? `${base}\n\n${rules}` : base;
}

export function buildPrompt(arm, packet) {
  if (arm === 'august') return buildAugustPrompt(packet);
  return `${renderFactBlock(packet)}\n\n${armInstructions(arm, packet)}\n\n${buildPlainContract(packet.surfaceId)}`;
}
