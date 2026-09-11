import { config, loadHarnessModules } from './bootstrap.mjs';
import { renderFactBlock } from './packet.mjs';
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

// August source: output/lap7-ref/linkedin-drafts.a8d1a5e.mjs:453-455,
// 462, 466-472, 477-491.
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
- No emojis and no desperation.`;
}

// Current source: dashboard-web/server/routes/linkedin-drafts.mjs:552-598.
function lap7LiFollowup(packet) {
  return `${augustLiFollowup(packet)}
- Lead with genuine interest in the company or its work. ${p(packet).application ? `Name the ${role(packet)} role after that opener.` : 'Do not claim an application was submitted.'}
- ${tierAsk(packet)} A soft redirect ask is allowed.
- Do not pitch a job-search tool or job-search article.${voiceBlock()}`;
}

// August source: output/lap7-ref/linkedin-ssi.a8d1a5e.mjs:222-232.
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

// Current source: dashboard-web/server/lib/linkedin-ssi.mjs:220-234.
function lap7ConnectNote(packet) {
  return `${augustConnectNote(packet)}
- Open with genuine interest in the company or the work.
- ${p(packet).application ? `Name the ${role(packet)} role after the genuine-interest opener.` : 'Do not claim an application was submitted.'}
- Do not pitch a job-search tool or job-search article.
- Do not ask for a call, chat, meeting, calendar time, or a named amount of time.`;
}

// August source: output/lap7-ref/target-talent.a8d1a5e.mjs:322-326,
// 333-337, 349-360.
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
- Omit a subject and signature. Omit the greeting because the UI prefills it. Begin with substantive content.${voiceBlock()}`;
}

// Current source: dashboard-web/server/routes/target-talent.mjs:346-389.
function lap7TaDm(packet) {
  return `${augustTaDm(packet)}
- Lead with genuine interest in the company or its work. ${p(packet).application ? `Name the ${role(packet)} role next.` : 'Do not imply an application was submitted.'}
- Use one or two concrete proof points.
- ${tierAsk(packet)} A soft redirect ask is allowed.
- Do not pitch a job-search tool or job-search article.
- Do not write "without a reply", "haven't heard back", "never heard back", or an apology.`;
}

// August source: output/lap7-ref/target-talent.a8d1a5e.mjs:458, 473,
// 476-504.
function augustTaEmail(_packet) {
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
- Plain text, 3 to 4 short paragraphs, 1 to 2 sentences per paragraph. Omit the greeting and signature because the UI supplies them.${voiceBlock()}`;
}

// Current source: dashboard-web/server/routes/target-talent.mjs:520-569.
function lap7TaEmail(packet) {
  return `${augustTaEmail(packet)}
- Open with genuine interest in the company or its work, not with applying. ${p(packet).application ? `Name the ${role(packet)} role after the opener.` : 'Do not claim an application was submitted.'}
- Use one or two proof points, preferring a named artifact.
- ${tierAsk(packet)} A soft redirect ask is allowed.
- Do not pitch a job-search tool or job-search article.
- Do not write "without a reply", "haven't heard back", "never heard back", or an apology.
- Follow this paragraph pattern: interest, proof, why-here link, low-friction close.`;
}

// August source: output/lap7-ref/referrals.a8d1a5e.mjs:372-376,
// 381-389, 399, 402-415.
function augustReferralDm(_packet) {
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
- Omit a subject line, signature block, trailing sign-off, greeting, and bare first-name address because the UI prefills the greeting.${voiceBlock()}`;
}

// Current source: dashboard-web/server/routes/referrals.mjs:398-428.
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

// August source: output/lap7-ref/referrals.a8d1a5e.mjs:472-476,
// 486, 489-502.
function augustReferralEmail(_packet) {
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
- Plain text, 2 to 4 short paragraphs. Omit the greeting, bare first-name address, signature block, and trailing sign-off because the UI supplies the salutation.${voiceBlock()}`;
}

// Current source: dashboard-web/server/routes/referrals.mjs:520-549.
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

// August source: output/lap7-ref/followups.a8d1a5e.mjs:552-562.
function augustAppFollowup(_packet) {
  return `You are drafting a brief professional application follow-up email.

STYLE REQUIREMENTS:
- Under 100 words in the body.
- Direct, senior-operator tone. No corporate filler or em dashes.
- Reference the specific role and company by name.
- Lead with one specific reason the role matters. Add one new data point or framing that was not in the original application.
- Close with one low-friction ask: a quick reply on timing or being pointed to the right person. Do not ask for a call, chat, intro, or calendar time.
- Never invent metrics or claims not on the CV.
- Keep the subject tight and role-specific.
- Use plain text. Omit greeting and signature because the UI supplies them.${voiceBlock()}`;
}

// Current source: dashboard-web/server/routes/followups.mjs:534-564.
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

const AUGUST = Object.freeze({
  li_followup: augustLiFollowup,
  connect_note: augustConnectNote,
  ta_dm: augustTaDm,
  ta_email: augustTaEmail,
  referral_dm: augustReferralDm,
  referral_email: augustReferralEmail,
  app_followup: augustAppFollowup,
});

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
  const table = arm === 'lap7' ? LAP7 : AUGUST;
  const fn = table[packet?.kind];
  if (!fn) throw new Error(`Unsupported outreach kind: ${packet?.kind}`);
  const base = fn(packet);
  if (arm === 'august_plus') return `${base}\n- ${AUGUST_PLUS_RULE}`;
  if (arm === 'lap7') {
    const rules = buildWritingRules(packet.surfaceId);
    return rules ? `${base}\n\n${rules}` : base;
  }
  return base;
}

export function buildPrompt(arm, packet) {
  return `${renderFactBlock(packet)}\n\n${armInstructions(arm, packet)}\n\n${buildPlainContract(packet.surfaceId)}`;
}
