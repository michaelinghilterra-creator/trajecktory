#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { buildPrompt } = await import('../scripts/outreach-ab-v2/arms.mjs');
const { buildAugustPrompt } = await import('../lib/outreach-voice.mjs');
const { renderFactBlock } = await import('../lib/outreach-packet.mjs');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`  ❌ ${name}`);
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

const KINDS = ['li_followup', 'connect_note', 'ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup'];
const SNAPSHOTS = Object.freeze({
  li_followup: '9f1bd07bb74efd71d6357480d2a87a8099c9456509624ce0dbd7aa1b1664c224',
  connect_note: '23f97410d0279ac0e4870965a96d46dd808476b53d6d8230465f2c0539864736',
  ta_dm: '3c837db4cc0217b4c068cac9798487a809b814f2fd97fcf08718028fbf555a39',
  ta_email: '19b2495c3c138158c20e693f0fefb184a19bd1bfefd28a7968061dc7be7b3448',
  referral_dm: '05fad5915e61dc87c60eb3d151cd39409134ca700cd5f1a19a3e106cde15d94e',
  referral_email: '0faab7f07b29117ae2f3935b4321f509b919499487cea29a8411c43b8aed1d03',
  app_followup: 'c695d606e02671e26aceb1bacea570778171c00d9c9d28d1bb60725ce1cef864',
});

function fixturePacket(kind) {
  return {
    recipient: {
      name: 'Taylor Morgan', first: 'Taylor', title: 'VP Talent', company: 'Example Co',
      notesExcerpt: 'Met at RevOps Summit.', tier: 'ta', tierLabel: 'recruiter or talent partner',
    },
    relationship: {
      channelKind: ['ta_email', 'referral_email', 'app_followup'].includes(kind) ? 'Email' : 'LinkedIn',
      connected: false, inviteSent: true, inviteDate: '2026-08-20',
      threadBlock: '2026-08-20 | Sent | LinkedIn\nConnection request.',
      stateLine: 'One sent message with no reply.', recentPitch: true,
      lastTouchDate: '2026-08-20',
      recentTouches: [{ date: '2026-08-20', channel: 'LinkedIn', direction: 'Sent' }],
    },
    application: { submitted: true, role: 'Director of Sample Operations', date: '2026-08-18', status: 'Applied', daysAgo: 24 },
    applicationFollowups: kind === 'app_followup' ? { count: 2, lastDate: '2026-08-28' } : null,
    research: 'Example Co is rebuilding its revenue data stack.',
    sender: {
      fullName: 'Morgan Lee', firstName: 'Morgan', cv: '# Morgan Lee\nRevenue operations leader.',
      articleDigest: 'Built a forecasting system.',
      proofPoints: [{ name: 'Forecasting', heroMetric: 'Reduced error by 20%' }],
      voiceRules: 'Use a direct, precise voice. Avoid hype.',
    },
    goal: 'Get the application for the Director of Sample Operations role in front of the hiring manager.',
    kind,
    surfaceId: kind === 'connect_note' ? 'connect_note_influencer' : kind,
  };
}

const digest = prompt => crypto.createHash('sha256').update(prompt).digest('hex');

test('shared August prompts equal the harness August arm byte for byte for every kind', () => {
  for (const kind of KINDS) {
    const packet = fixturePacket(kind);
    assert.equal(buildAugustPrompt(packet), buildPrompt('august', packet), kind);
  }
});

test('August prompts match the intentional timing/voice parity snapshots for every kind', () => {
  for (const kind of KINDS) {
    assert.equal(digest(buildAugustPrompt(fixturePacket(kind))), SNAPSHOTS[kind], kind);
  }
});

test('all seven route surfaces construct prompts through the shared August builder', () => {
  const files = {
    linkedin: fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/linkedin-drafts.mjs'), 'utf8'),
    target: fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/target-talent.mjs'), 'utf8'),
    referral: fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/referrals.mjs'), 'utf8'),
    followup: fs.readFileSync(path.join(ROOT, 'dashboard-web/server/routes/followups.mjs'), 'utf8'),
  };
  assert.match(files.linkedin, /kind: 'li_followup'[\s\S]{0,180}buildAugustPrompt\(packet\)/);
  assert.match(files.linkedin, /kind: 'connect_note'[\s\S]{0,700}buildAugustPrompt\(packet\)/);
  assert.match(files.target, /kind: 'ta_dm'[\s\S]{0,500}buildTargetTalentAugustPrompt\(packet/);
  assert.match(files.target, /kind: 'ta_email'[\s\S]{0,500}buildTargetTalentAugustPrompt\(packet/);
  assert.match(files.referral, /kind: 'referral_dm'[\s\S]{0,600}buildReferralAugustPrompt\(packet/);
  assert.match(files.referral, /kind: 'referral_email'[\s\S]{0,600}buildReferralAugustPrompt\(packet/);
  assert.match(files.followup, /kind: 'app_followup'[\s\S]{0,180}buildAugustPrompt\(packet\)/);
});

test('no route uses generateWithRubric for the seven shipped outreach surfaces', () => {
  const source = [
    'dashboard-web/server/routes/linkedin-drafts.mjs',
    'dashboard-web/server/routes/target-talent.mjs',
    'dashboard-web/server/routes/referrals.mjs',
    'dashboard-web/server/routes/followups.mjs',
  ].map(file => fs.readFileSync(path.join(ROOT, file), 'utf8')).join('\n');
  for (const surface of ['li_followup', 'connect_note_influencer', 'ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup']) {
    assert.doesNotMatch(source, new RegExp(`generateWithRubric\\([^;]{0,1400}['"]${surface}['"]`), surface);
  }
  assert.match(source, /generateWithRubric\(prompt, 'reply_email'/);
  assert.match(source, /generateWithRubric\(prompt, 'followup_sent'/);
});

test('referral reconnect remains byte-identical to the harness August arm', () => {
  const reconnect = fixturePacket('referral_dm');
  assert.equal(buildAugustPrompt(reconnect), buildPrompt('august', reconnect));
});

test('shared facts include application timing and application-source follow-up history', () => {
  const facts = renderFactBlock(fixturePacket('app_followup'));
  assert.match(facts, /That was 24 days ago\./);
  assert.match(facts, /Prior follow-ups: 2\. Last follow-up: 2026-08-28\./);
});

test('LinkedIn follow-up August instructions include the profile voice rules', () => {
  assert.match(buildAugustPrompt(fixturePacket('li_followup')), /== VOICE RULES[\s\S]*Use a direct, precise voice\. Avoid hype\./);
});

if (!process.exitCode) console.log(`outreach-august-parity.test.mjs: ${passed} passed`);
