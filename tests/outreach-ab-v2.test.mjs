import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeSandbox } from './helpers/sandbox.mjs';

process.env.TJK_FAKE_LLM = '1';
process.env.TJK_FAKE_LLM_TEXT = '{"subject":"Fixture subject","body":"Fixture body."}';

const { buildPlainContract } = await import('../lib/outreach-rubric.mjs');
const { buildPacketFromFields } = await import('../lib/outreach-packet.mjs');
const { AUGUST_PLUS_RULE, armInstructions, buildPrompt } = await import('../scripts/outreach-ab-v2/arms.mjs');
const { renderFactBlock } = await import('../scripts/outreach-ab-v2/packet.mjs');
const { renderPanel } = await import('../scripts/outreach-ab-v2/panel.mjs');
const { finishOptionsFor, prepareTrancheGeneration } = await import('../scripts/outreach-ab-v2/generate.mjs');
const { allocateQuotas, isAlreadyContactedTa, isExcludedContact, measureMix, normalizeExclusions, renderMixMd } = await import('../scripts/outreach-ab-v2/sample.mjs');
const { parseArgs } = await import('../scripts/outreach-ab-v2.mjs');
const { parseAnswerLine, recordAnswers, scoreResults, signTestPValue } = await import('../scripts/outreach-ab-v2/score.mjs');
const { handleRequest, handleSubmit, loadRatingData, renderRatingPage } = await import('../scripts/outreach-ab-v2/serve.mjs');

const RATE_TOKEN = 'fixture-rate-token';
const POST_HEADERS = {
  host: '127.0.0.1:4110',
  origin: 'http://127.0.0.1:4110',
  'content-type': 'application/json; charset=utf-8',
  'x-rate-token': RATE_TOKEN,
};

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function packetFixture(overrides = {}) {
  return {
    recipient: { name: 'Taylor Ng', first: 'Taylor', title: 'VP Revenue Operations', company: 'Example Co', notesExcerpt: 'Owns revenue systems', tier: 'hm', tierLabel: 'likely hiring manager' },
    relationship: { channelKind: 'LinkedIn', connected: false, inviteSent: true, inviteDate: '2026-08-20', threadBlock: '- 2026-08-20 [Sent · LinkedIn] Invitation', stateLine: 'Only a connection request has gone out so far; no substantive message yet.', recentPitch: false, lastTouchDate: '2026-08-20', recentTouches: [{ date: '2026-08-20', channel: 'LinkedIn', direction: 'Sent' }] },
    application: { submitted: true, role: 'Director of Sample Operations', date: '2026-08-18', status: 'Applied' },
    research: 'Example Co is rebuilding its revenue data stack.',
    sender: { fullName: 'Morgan Lee', firstName: 'Morgan', cv: '# Morgan Lee\nRevenue operations leader.', articleDigest: 'Built a forecasting system.', proofPoints: [{ name: 'Forecasting', heroMetric: 'Reduced error by 20%' }] },
    goal: 'Get the application for the Director of Sample Operations role in front of the hiring manager.',
    kind: 'li_followup',
    surfaceId: 'li_followup',
    ...overrides,
  };
}

function writeRatingFixture(dir, { picks = null } = {}) {
  const cases = [
    {
      number: 1,
      id: 'hidden-case-id',
      kind: 'ta_email',
      packet: { recipient: { first: '<Taylor>' } },
      drafts: [
        { arm: 'august', status: 'ok', subject: '<Subject A>', body: 'Mapped B body\nSecond line', grade: { score: 99 } },
        { arm: 'lap7', status: 'ok', subject: '', body: 'Mapped A body', timing: 123 },
        { arm: 'august_plus', status: 'ok', subject: '', body: 'Mapped C body' },
      ],
    },
    {
      number: 2,
      kind: 'li_followup',
      drafts: [
        { arm: 'august', status: 'ok', subject: '', body: 'Second case A' },
        { arm: 'lap7', status: 'ok', subject: '', body: 'Second case B' },
        { arm: 'august_plus', status: 'ok', subject: '', body: 'Second case C' },
      ],
    },
  ];
  const kits = [
    { number: 1, kit: { who: '<Taylor & Co>', whatTheyDo: 'Builds > systems', history: 'Met <once>', application: 'Applied & waiting', goal: 'Get a reply', channel: 'Email' } },
    { number: 2, kit: { who: 'Jordan', whatTheyDo: 'Leads operations', history: 'No history', application: 'Applied', goal: 'Get routed', channel: 'LinkedIn' } },
  ];
  const key = {
    '01': { A: 'lap7', B: 'august', C: 'august_plus' },
    '02': { A: 'august_plus', B: 'lap7', C: 'august' },
  };
  const trancheDir = path.join(dir, 'tranche-1');
  fs.mkdirSync(trancheDir, { recursive: true });
  fs.writeFileSync(path.join(trancheDir, 'drafts.json'), JSON.stringify(cases, null, 2) + '\n');
  fs.writeFileSync(path.join(trancheDir, 'kits.json'), JSON.stringify(kits, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'key.json'), JSON.stringify(key, null, 2) + '\n');
  if (picks) fs.writeFileSync(path.join(trancheDir, 'picks.json'), JSON.stringify(picks, null, 2) + '\n');
  return { cases, kits, key, trancheDir };
}

test('all arms share byte-identical fact block and output contract', () => {
  const packet = packetFixture();
  const fact = renderFactBlock(packet);
  const contract = buildPlainContract(packet.surfaceId);
  const prompts = ['august', 'lap7', 'august_plus'].map(arm => buildPrompt(arm, packet));
  for (const prompt of prompts) {
    assert.equal(prompt.slice(0, fact.length), fact);
    assert.equal(prompt.slice(-contract.length), contract);
  }
  const august = armInstructions('august', packet);
  const lap7 = armInstructions('lap7', packet);
  const plus = armInstructions('august_plus', packet);
  assert.notEqual(august, lap7);
  assert.equal(plus, `${august}\n- ${AUGUST_PLUS_RULE}`);
});

test('fact block makes no-application and pending-connection states explicit', () => {
  const fact = renderFactBlock(packetFixture({ application: null }));
  assert.match(fact, /He has not submitted an application at this company; do not claim he applied\./);
  assert.match(fact, /Your connection request from 2026-08-20 has not been accepted; you are not connected\./);
});

test('packet notes stay compatible and resist polynomial scans', () => {
  const packetForNotes = notes => buildPacketFromFields({
    kind: 'li_followup',
    name: 'Taylor Ng',
    company: 'Example Co',
    notes,
    tier: 'exec',
    relatedApps: [],
    application: null,
    research: '',
    sender: { fullName: 'Morgan Lee', firstName: 'Morgan', cv: '# Morgan Lee', articleDigest: '', proofPoints: [] },
  });

  const ordinary = packetForNotes('Owns revenue systems [tier:exec] · [src:agent:x] · met at a summit');
  assert.equal(ordinary.recipient.notesExcerpt, 'Owns revenue systems · met at a summit');

  for (const notes of ['['.repeat(100000), `a${' '.repeat(100000)}·x`]) {
    const startedAt = performance.now();
    packetForNotes(notes);
    assert.ok(performance.now() - startedAt < 500);
  }
});

test('panel is blind, escaped, script-free, and has two named pill groups', () => {
  const html = renderPanel({
    seed: 9,
    key: { '01': { A: 'lap7', B: 'august', C: 'august_plus' } },
    cases: [{
      number: 1,
      kit: { who: '<Taylor & Co>', whatTheyDo: 'Builds > systems', history: 'No history', application: 'Applied', goal: 'Reply', channel: 'LinkedIn' },
      drafts: [
        { arm: 'august', status: 'ok', subject: '', body: 'Draft B' },
        { arm: 'lap7', status: 'ok', subject: '<Hello>', body: 'Draft A\nLine 2' },
        { arm: 'august_plus', status: 'ok', subject: '', body: 'Draft C' },
      ],
    }],
  });
  assert.doesNotMatch(html, /august|lap7/);
  assert.match(html, /&lt;Taylor &amp; Co&gt;/);
  assert.match(html, /&lt;Hello&gt;/);
  assert.doesNotMatch(html, /<script|<!--/i);
  assert.equal((html.match(/class="elicit-pills"/g) || []).length, 2);
  assert.match(html, /data-name="c01_favorite" data-multi="false"/);
  assert.match(html, /data-name="c01_second" data-multi="false"/);
  assert.doesNotMatch(html, /<style\b/i);
  assert.doesNotMatch(html, /class="(?:elicit|elicit-header|elicit-body|elicit-group|elicit-question|elicit-pills|elicit-pill|elicit-footer)"[^>]*style=/i);
  assert.doesNotMatch(html, /class="elicit-pill"[^>]*(?:background|border)/i);
  for (const match of html.matchAll(/font-weight:(\d+)/g)) assert.ok(['400', '500'].includes(match[1]));
  for (const match of html.matchAll(/font-size:(\d+)px/g)) assert.ok(Number(match[1]) >= 11);
});

test('answer parser handles None, spacing, case, and skipped cases', () => {
  const result = parseAnswerLine('Outreach rating details — C01 favorite: b · C01 second: None · c03   favorite : NONE · C03 second: a');
  assert.deepEqual(result, {
    '01': { favorite: 'B', second: null },
    '03': { favorite: null, second: 'A' },
  });
  assert.equal(result['02'], undefined);
});

test('scoring pools favorites, seconds, points, none, agreement, and sign tests', () => {
  const cases = [
    { number: 1, kind: 'li_followup', tier: 'hm', drafts: [{ arm: 'august', grade: { score: 90 } }, { arm: 'lap7', grade: { score: 80 } }, { arm: 'august_plus', grade: { score: 70 } }] },
    { number: 2, kind: 'ta_email', tier: 'ta', drafts: [{ arm: 'august', grade: { score: 60 } }, { arm: 'lap7', grade: { score: 70 } }, { arm: 'august_plus', grade: { score: 80 } }] },
    { number: 3, kind: 'ta_email', tier: 'ta', drafts: [{ arm: 'august', grade: { score: 70 } }, { arm: 'lap7', grade: { score: 70 } }, { arm: 'august_plus', grade: { score: 70 } }] },
  ];
  const result = scoreResults({ cases, picks: {
    '01': { favorite: 'august', second: 'lap7' },
    '02': { favorite: 'lap7', second: 'august_plus' },
    '03': { favorite: null, second: null },
  } });
  assert.deepEqual(result.favorites, { august: 1, lap7: 1, august_plus: 0 });
  assert.deepEqual(result.seconds, { august: 0, lap7: 1, august_plus: 1 });
  assert.deepEqual(result.points, { august: 2, lap7: 3, august_plus: 1 });
  assert.equal(result.noneAtAll, 1);
  assert.deepEqual(result.graderAgreement, { agreement: 1, compared: 2, rate: 0.5 });
  assert.equal(result.byKind.ta_email.rated, 2);
  assert.equal(result.byTier.ta.noneAtAll, 1);
  assert.equal(result.signTests.august_vs_lap7.pValue, 1);
  assert.equal(signTestPValue(4, 0), 0.125);
});

test('quota allocation uses largest remainder and exclusions come from an in-memory fixture', () => {
  assert.deepEqual(allocateQuotas({ a: 50, b: 30, c: 15, d: 5 }, 20, 2), { a: 9, b: 6, c: 3, d: 2 });
  const exclusions = normalizeExclusions({ ta: ['fixture-ta'], referral: ['fixture-referral'] });
  assert.equal(isExcludedContact(exclusions, 'ta', 'fixture-ta'), true);
  assert.equal(isExcludedContact(exclusions, 'ta', 'other-ta'), false);
  assert.equal(isExcludedContact(exclusions, 'referral', 'fixture-referral'), true);
  assert.equal(isExcludedContact(exclusions, 'application', 'fixture-ta'), false);
  assert.equal(parseArgs(['sample', '--exclude', 'fixture.json']).exclude, 'fixture.json');
});

test('TA LinkedIn routing treats every production prior-contact signal as a follow-up', () => {
  const untouched = { status: 'Not Contacted' };
  assert.equal(isAlreadyContactedTa(untouched), false);
  assert.equal(isAlreadyContactedTa({ status: '' }), false);
  for (const status of ['Sent', 'Replied', 'Meeting Scheduled', 'Drafted', 'Dormant']) {
    assert.equal(isAlreadyContactedTa({ status }), true, status);
  }
  assert.equal(isAlreadyContactedTa(untouched, { linkedinState: 'Connected' }), true);
  assert.equal(isAlreadyContactedTa(untouched, { timeline: [{ kind: 'invite-sent', direction: 'Draft' }] }), true);
  assert.equal(isAlreadyContactedTa(untouched, { timeline: [{ kind: 'invite-accepted', direction: 'Received' }] }), true);
  assert.equal(isAlreadyContactedTa(untouched, { timeline: [{ kind: 'email-sent', direction: 'Sent' }] }), true);
});

test('measured mix excludes duplicate logs and recognizes TA invites by subject only', () => {
  const taRows = [
    { id: 'ta-one', title: 'VP Operations', notes: '' },
    { id: 'ta-two', title: 'Recruiting Lead', notes: '' },
  ];
  const messages = new Map([
    ['ta-one', [
      { timestamp: '2026-09-01', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn connection request' },
      { timestamp: '2026-09-02', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn message' },
      { timestamp: '2026-09-03', direction: 'Sent', channel: 'Email', subject: 'Introduction' },
    ]],
    ['ta-two', [
      { timestamp: '2026-09-04', direction: 'Sent', channel: 'LinkedIn', subject: 'LinkedIn message' },
    ]],
  ]);
  const measured = measureMix({
    now: new Date('2026-09-10T12:00:00Z'),
    fixture: {
      taRows,
      referralRows: [],
      readTTCorrespondence: id => messages.get(String(id)) || [],
      readReferralCorrespondence: () => [],
      resolveReferralLink: () => null,
      connects: [
        { id: 'ta-one', date: '2026-09-01' },
        { id: 'ta-two', date: '2026-09-05' },
        { id: 'ta-two', date: '2026-09-05' },
      ],
      followups: [
        { date: '2026-09-06', notes: 'Normal follow-up' },
        { date: '2026-09-07', notes: 'Cross-Logged from correspondence' },
        { date: '2026-09-08', notes: 'historical BACKFILL' },
      ],
    },
  });
  assert.equal(measured.kinds.connect_note.total, 2);
  assert.equal(measured.kinds.li_followup.total, 1);
  assert.equal(measured.kinds.ta_dm.total, 1);
  assert.equal(measured.kinds.ta_email.total, 1);
  assert.equal(measured.kinds.app_followup.total, 1);
  assert.deepEqual(measured.excluded, {
    followupsCrossLogged: 1,
    followupsBackfill: 1,
    ledgerAlreadyRepresented: 1,
    ledgerDuplicates: 1,
  });
  const markdown = renderMixMd(measured);
  assert.match(markdown, /Cross-logged follow-up rows: 1/);
  assert.match(markdown, /Backfill follow-up rows: 1/);
  assert.match(markdown, /already represented by correspondence: 1/);
});

test('generate protects rated tranches and force clears picks before regeneration', () => {
  const dir = makeSandbox('outreach-ab-v2');
  try {
    fs.writeFileSync(path.join(dir, 'cases.json'), '[]\n');
    const trancheDir = path.join(dir, 'tranche-1');
    fs.mkdirSync(trancheDir);
    const picksFile = path.join(trancheDir, 'picks.json');
    fs.writeFileSync(picksFile, '{}\n');
    assert.throws(() => prepareTrancheGeneration({ runDir: dir, tranche: 1 }), /already has picks\.json/);
    let notice = '';
    const result = prepareTrancheGeneration({ runDir: dir, tranche: 1, force: true, onCleared: value => { notice = value; } });
    assert.equal(result.clearedPicks, true);
    assert.equal(fs.existsSync(picksFile), false);
    assert.match(notice, /Cleared .*picks\.json/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('five body-only kinds strip greetings and signatures and panel supplies one fixed greeting per arm', () => {
  const bodyOnlyKinds = ['ta_dm', 'ta_email', 'referral_dm', 'referral_email', 'app_followup'];
  for (const kind of bodyOnlyKinds) {
    const packet = packetFixture({ kind });
    assert.deepEqual(
      { stripSalutationFor: finishOptionsFor(packet).stripSalutationFor, stripSignature: finishOptionsFor(packet).stripSignature },
      { stripSalutationFor: 'Taylor', stripSignature: true },
    );
    const html = renderPanel({
      seed: 1,
      key: { '01': { A: 'august', B: 'lap7', C: 'august_plus' } },
      cases: [{ number: 1, kind, packet, kit: {}, drafts: ['august', 'lap7', 'august_plus'].map(arm => ({ arm, status: 'ok', body: 'Body only.' })) }],
    });
    assert.equal((html.match(/Hi Taylor,/g) || []).length, 3, kind);
  }
  for (const kind of ['li_followup', 'connect_note']) {
    const packet = packetFixture({ kind });
    assert.equal(finishOptionsFor(packet).stripSalutationFor, null);
    assert.equal(finishOptionsFor(packet).stripSignature, false);
  }
});

test('rating page contains blind escaped kits, versions, and both radio groups for every case', () => {
  const dir = makeSandbox('outreach-ab-v2-rating-page');
  try {
    writeRatingFixture(dir);
    const html = renderRatingPage({ ...loadRatingData(dir, 1), rateToken: RATE_TOKEN });
    assert.match(html, /Case 01[\s\S]*Case 02/);
    for (const value of ['Who:', 'What they do:', 'History:', 'Application:', 'Goal:', 'Channel:']) assert.match(html, new RegExp(value));
    for (const letter of ['A', 'B', 'C']) assert.equal((html.match(new RegExp(`Version ${letter}`, 'g')) || []).length, 2);
    assert.equal((html.match(/Which one would you send\?/g) || []).length, 2);
    assert.equal((html.match(/Any close second\?/g) || []).length, 2);
    assert.match(html, /&lt;Taylor &amp; Co&gt;/);
    assert.match(html, /&lt;Subject A&gt;/);
    assert.match(html, /Mapped B body<br>Second line/);
    assert.match(html, /Hi &lt;Taylor&gt;,/);
    assert.match(html, /const rateToken="fixture-rate-token"/);
    assert.match(html, /'x-rate-token':rateToken/);
    assert.match(html, /input\.disabled=favorite==='None'\|\|input\.value===favorite/);
    assert.doesNotMatch(html, /august|lap7|hidden-case-id|score|timing/i);
    assert.deepEqual(parseArgs(['serve', '--run', dir, '--port', '4111']).port, 4111);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('submit validates complete tranche answers, conflicts, and matches record output', () => {
  const serverDir = makeSandbox('outreach-ab-v2-server-record');
  const recordDir = makeSandbox('outreach-ab-v2-cli-record');
  const answers = {
    '01': { favorite: 'B', second: 'A' },
    '02': { favorite: null, second: null },
  };
  try {
    const serverFixture = writeRatingFixture(serverDir);
    writeRatingFixture(recordDir);

    const missing = handleRequest({ runDir: serverDir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit', headers: POST_HEADERS, body: JSON.stringify({ '01': answers['01'] }) });
    assert.equal(missing.status, 400);
    assert.match(JSON.parse(missing.body).error, /missing a favorite/i);

    const unknown = handleRequest({ runDir: serverDir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit', headers: POST_HEADERS, body: JSON.stringify({ ...answers, '99': { favorite: 'A', second: null } }) });
    assert.equal(unknown.status, 400);
    assert.match(JSON.parse(unknown.body).error, /unknown case/i);

    const result = handleSubmit({ runDir: serverDir, tranche: 1, answers });
    assert.equal(result.recorded, 2);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(serverFixture.trancheDir, 'picks.json'), 'utf8')), {
      '01': { favorite: 'august', second: 'lap7' },
      '02': { favorite: null, second: null },
    });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(serverFixture.trancheDir, 'submission.json'), 'utf8')), answers);

    const conflict = handleRequest({ runDir: serverDir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit?force=1', headers: POST_HEADERS, body: JSON.stringify({
      '01': { favorite: 'C', second: null },
      '02': { favorite: 'A', second: null },
    }) });
    assert.equal(conflict.status, 409);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(serverFixture.trancheDir, 'picks.json'), 'utf8')), result.picks);

    const lineFile = path.join(recordDir, 'answers.txt');
    fs.writeFileSync(lineFile, 'C01 favorite: B · C01 second: A · C02 favorite: None · C02 second: None\n');
    recordAnswers({ runDir: recordDir, tranche: 1, lineFile });
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(recordDir, 'tranche-1', 'picks.json'), 'utf8')),
      JSON.parse(fs.readFileSync(path.join(serverDir, 'tranche-1', 'picks.json'), 'utf8')),
    );
  } finally {
    fs.rmSync(serverDir, { recursive: true, force: true });
    fs.rmSync(recordDir, { recursive: true, force: true });
  }
});

test('rating server rejects non-loopback requests and invalid CSRF metadata', () => {
  const dir = makeSandbox('outreach-ab-v2-security');
  try {
    writeRatingFixture(dir);
    const evilHost = handleRequest({ runDir: dir, rateToken: RATE_TOKEN, method: 'GET', url: '/', headers: { host: 'ratings.example.com' } });
    assert.equal(evilHost.status, 403);

    const loopbackPage = handleRequest({ runDir: dir, rateToken: RATE_TOKEN, method: 'GET', url: '/t/1', headers: { host: '[::1]:4110' } });
    assert.equal(loopbackPage.status, 200);
    assert.match(loopbackPage.body, /const rateToken="fixture-rate-token"/);

    const missingToken = handleRequest({
      runDir: dir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit',
      headers: { ...POST_HEADERS, 'x-rate-token': undefined }, body: '{}',
    });
    assert.equal(missingToken.status, 403);

    const wrongToken = handleRequest({
      runDir: dir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit',
      headers: { ...POST_HEADERS, 'x-rate-token': 'wrong-token' }, body: '{}',
    });
    assert.equal(wrongToken.status, 403);

    const plainText = handleRequest({
      runDir: dir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit',
      headers: { ...POST_HEADERS, 'content-type': 'text/plain' }, body: '{}',
    });
    assert.equal(plainText.status, 415);

    const foreignOrigin = handleRequest({
      runDir: dir, rateToken: RATE_TOKEN, method: 'POST', url: '/t/1/submit',
      headers: { ...POST_HEADERS, origin: 'https://ratings.example.com' }, body: '{}',
    });
    assert.equal(foreignOrigin.status, 403);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('submission rejects duplicate choices and a close second after None', () => {
  const dir = makeSandbox('outreach-ab-v2-choice-validation');
  try {
    writeRatingFixture(dir);
    const response = handleRequest({
      runDir: dir,
      rateToken: RATE_TOKEN,
      method: 'POST',
      url: '/t/1/submit',
      headers: POST_HEADERS,
      body: JSON.stringify({
        '01': { favorite: 'B', second: 'B' },
        '02': { favorite: null, second: 'C' },
      }),
    });
    assert.equal(response.status, 400);
    const error = JSON.parse(response.body).error;
    assert.match(error, /Case 01: close second cannot equal favorite/);
    assert.match(error, /Case 02: close second must be None when favorite is None/);
    assert.equal(fs.existsSync(path.join(dir, 'tranche-1', 'picks.json')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('rating page is read-only and shows recorded choices when picks exist', () => {
  const dir = makeSandbox('outreach-ab-v2-read-only');
  try {
    writeRatingFixture(dir, { picks: {
      '01': { favorite: 'august', second: 'lap7' },
      '02': { favorite: null, second: 'august' },
    } });
    const html = renderRatingPage(loadRatingData(dir, 1));
    assert.match(html, /already been recorded/i);
    assert.match(html, /name="c01_favorite" value="B" checked disabled/);
    assert.match(html, /name="c01_second" value="A" checked disabled/);
    assert.match(html, /name="c02_favorite" value="None" checked disabled/);
    assert.doesNotMatch(html, /<button\b[^>]*>Submit<\/button>/i);
    assert.doesNotMatch(html, /<script\b/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

if (!process.exitCode) console.log(`outreach-ab-v2.test.mjs: ${passed} passed`);
