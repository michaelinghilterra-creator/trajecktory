#!/usr/bin/env node
/**
 * sequence-tone-wiring.test.mjs proves the sequence tone wiring in draft prompts.
 *
 * Uses the same sandbox setup as draft-endpoints.test.mjs so that the
 * buildPacketFromFields / buildAugustPrompt helpers behave identically.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeSandbox } from './helpers/sandbox.mjs';

process.env.TJK_FAKE_LLM = '1';
process.env.TJK_FAKE_LLM_TEXT = JSON.stringify({ subject: 'Stub subject', body: 'Stub body.' });
const sandbox = makeSandbox("drafts");
process.env.TJK_DATA_DIR = sandbox;
const _root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const { buildPacketFromFields } = await import('../lib/outreach-packet.mjs');
const { buildAugustPrompt } = await import('../lib/outreach-voice.mjs');
const { buildTargetTalentAugustPrompt } = await import('../dashboard-web/server/routes/target-talent.mjs');
const { mergeConnectPacketContext } = await import('../dashboard-web/server/routes/linkedin-drafts.mjs');

let passed = 0, failed = 0;
const check = (cond, msg) => { if (cond) { console.log(`  ✅ ${msg}`); passed++; } else { console.log(`  ❌ ${msg}`); failed++; } };
console.log('sequence-tone-wiring.test.mjs');

const TONE = 'Invented sequence tone for testing.';

const routePacket = buildPacketFromFields({
  kind: 'ta_dm', name: 'Avery Example', role: 'Recruiter', company: 'Acme',
  sender: { fullName: 'Personthree Example', firstName: 'Personthree', cv: 'Fixture CV.', voiceRules: 'Be precise.' },
});
const taEmailPacket = { ...routePacket, kind: 'ta_email', surfaceId: 'ta_email' };

// Case 1: Email with a tone and no stage includes the tone line.
const emailWithTone = buildTargetTalentAugustPrompt(taEmailPacket, { channel: 'email', sequenceTone: TONE });
check(emailWithTone.includes(`SEQUENCE TONE: ${TONE}`),
  'email with tone includes SEQUENCE TONE line');

// Case 2: Email without a tone stays byte identical to buildAugustPrompt.
const emailNoTone = buildTargetTalentAugustPrompt(taEmailPacket, { channel: 'email' });
const emailBaseline = buildAugustPrompt(taEmailPacket);
check(emailNoTone === emailBaseline,
  'email without tone is byte identical to buildAugustPrompt');

// Case 3: Email with a tone and a stage includes both stage text and tone line.
const stageGuidance = 'Invented stage text.';
const emailWithToneAndStage = buildTargetTalentAugustPrompt(taEmailPacket, {
  channel: 'email', interviewStage: '1st Interview', stageGuidance, sequenceTone: TONE,
});
check(emailWithToneAndStage.includes(stageGuidance) && emailWithToneAndStage.includes(`SEQUENCE TONE: ${TONE}`),
  'email with tone and stage includes both stage text and tone line');

// Case 4: Fresh LinkedIn includes tone line; without tone is byte identical.
const linkedinWithTone = buildTargetTalentAugustPrompt(routePacket, { interviewStage: 'general', sequenceTone: TONE });
check(linkedinWithTone.includes(`SEQUENCE TONE: ${TONE}`),
  'fresh LinkedIn with tone includes SEQUENCE TONE line');
const linkedinNoTone = buildTargetTalentAugustPrompt(routePacket, { interviewStage: 'general' });
const linkedinBaseline = buildAugustPrompt(routePacket);
check(linkedinNoTone === linkedinBaseline,
  'fresh LinkedIn without tone is byte identical to buildAugustPrompt');

// Case 5: Threaded LinkedIn includes tone line.
const threadedWithTone = buildTargetTalentAugustPrompt(routePacket, {
  mode: 'reply', interviewStage: 'general', intentGuidance: 'Invented reply intent.', sequenceTone: TONE,
});
check(threadedWithTone.includes(`SEQUENCE TONE: ${TONE}`),
  'threaded LinkedIn with tone includes SEQUENCE TONE line');

// Case 6: mergeConnectPacketContext with tone adds Sequence tone line; without tone returns same object.
const connectPacket = { ...routePacket, kind: 'connect_note', surfaceId: 'connect_note_influencer' };
const contextualPacket = mergeConnectPacketContext(connectPacket, { sequenceTone: TONE });
check(contextualPacket.recipient.notesExcerpt.includes(`Sequence tone: ${TONE}`),
  'mergeConnectPacketContext with tone includes Sequence tone line');
const unchangedPacket = mergeConnectPacketContext(connectPacket, {});
check(unchangedPacket === connectPacket,
  'mergeConnectPacketContext without tone returns same object');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch {}
process.exit(failed > 0 ? 1 : 0);
