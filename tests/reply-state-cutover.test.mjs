#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeRepoSandbox } from './helpers/sandbox.mjs';

let passed = 0;
let failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function row(id, company, role, status) {
  return `| ${id} | 2030-03-01 | ${company} | ${role} | 0.01/5 | ${status} | | | | | https://jobs.zorblax.example/${id} |\n`;
}
function fixtureSync() {
  return {
    seenMessageIds: ['seen-1'],
    lastCheckedAt: '2030-03-01T00:00:00.000Z',
    lastPreviewAt: '2030-03-02T00:00:00.000Z',
    futureBookmark: { cursor: 'abc' },
    handledReplies: {
      m920001: { action: 'log', appId: 900001, date: '2030-03-01' },
      m920002: { action: 'dismiss', appId: null, date: '2030-03-02' },
      m920003: { action: 'unmatched', appId: null, date: '2030-03-03' },
    },
    notRelatedSenders: {
      'someone@example.test': { date: '2030-03-04' },
    },
    unmatchedReplies: {
      m920003: {
        from: 'Other Person <other@example.test>',
        subject: 'Example follow up',
        date: '2030-03-03',
        threadId: 'thread-920003',
        snippet: 'Invented snippet',
        company: 'Quennox Ratchet Works',
        parkedOn: '2030-03-03',
      },
    },
  };
}
function writeFixture(sandbox) {
  fs.writeFileSync(path.join(sandbox, 'applications.md'),
    '# Applications Tracker\n\n' +
    '| # | Date | Company | Role | Score | Status | PDF | Resume | Report | Notes | URL |\n' +
    '|---|------|---------|------|-------|--------|-----|--------|--------|-------|-----|\n' +
    row(900001, 'Zorblax Widgetry', 'Example Cog Lead', 'Evaluated') +
    row(900003, 'Quennox Ratchet Works', 'Example Gear Manager', 'Applied'),
    'utf8');
  fs.writeFileSync(path.join(sandbox, 'apply-dates.json'), '{}\n');
  fs.writeFileSync(path.join(sandbox, 'status-events.tsv'), 'app#\tdate\tstatus\tcompany\tlogged\n');
  fs.writeFileSync(path.join(sandbox, 'app-notes.json'), '{}\n');
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(fixtureSync(), null, 2) + '\n');
  fs.writeFileSync(path.join(sandbox, 'event-store.json'), JSON.stringify({ writes: 'on', flipped_at: '2030-03-01T00:00:00.000Z' }));
}
function bookmarksOnlySync() {
  return Object.fromEntries(Object.entries(fixtureSync()).filter(([key]) => !['handledReplies', 'notRelatedSenders', 'unmatchedReplies'].includes(key)));
}
// A real folder was imported BEFORE reply-state.json existed, so its sync file held no reply decisions at import time
// and they were added afterwards. carryOver imports with the decisions already in the sync file instead.
async function makeStore({ carryOver = false } = {}) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const sandbox = makeRepoSandbox(repoRoot, 'reply-state-cutover');
  process.env.TJK_DATA_DIR = sandbox;
  writeFixture(sandbox);
  if (!carryOver) fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(bookmarksOnlySync(), null, 2) + '\n');
  const { openEventStore } = await import('../lib/event-store.mjs');
  const { importDataFolder } = await import('../lib/import/import-data-folder.mjs');
  const out = path.join(sandbox, 'fixture-output');
  fs.mkdirSync(out);
  const store = openEventStore(path.join(sandbox, 'trajecktory.db'));
  importDataFolder(store, { dataDir: sandbox, outputDir: out, ownerName: 'Example Personone', definitionsVersion: 'v1', importedOn: '2030-04-01' });
  fs.writeFileSync(path.join(sandbox, 'google-sync.json'), JSON.stringify(fixtureSync(), null, 2) + '\n');
  return { sandbox, store, syncText: fs.readFileSync(path.join(sandbox, 'google-sync.json'), 'utf8') };
}

console.log('reply-state-cutover.test.mjs');
const { readEvents } = await import('../lib/event-store.mjs');
const { appendEventsWithEffects, renderLegacyFile } = await import('../lib/legacy-files.mjs');
const { planReplyStateCutover, applyReplyStateCutover, verifyReplyStateCutover } = await import('../lib/reply-state-cutover.mjs');
const { buildReplyDismissedEvent } = await import('../lib/reply-state.mjs');
const { buildVoidEvent } = await import('../lib/void-events.mjs');

let ctx = await makeStore();
try {
  const plan = planReplyStateCutover({ syncText: ctx.syncText, store: ctx.store });
  check(plan.status === 'ready'
    && same(plan.counts, { handled: 3, notRelated: 1, unmatched: 1 }), 'plan is ready with expected counts');
  check(same(plan.cursors, {
    seenMessageIds: ['seen-1'],
    lastCheckedAt: '2030-03-01T00:00:00.000Z',
    lastPreviewAt: '2030-03-02T00:00:00.000Z',
    futureBookmark: { cursor: 'abc' },
  }) && !Object.hasOwn(plan.cursors, 'handledReplies')
    && !Object.hasOwn(plan.cursors, 'notRelatedSenders')
    && !Object.hasOwn(plan.cursors, 'unmatchedReplies'), 'plan keeps only cursor fields in cursors');
  check(plan.setsPresentInSync === true
    && same(JSON.parse(plan.snapshotText), {
      handledReplies: fixtureSync().handledReplies,
      notRelatedSenders: fixtureSync().notRelatedSenders,
      unmatchedReplies: fixtureSync().unmatchedReplies,
    })
    && plan.snapshotText.endsWith('\n'), 'plan snapshot holds the three sets and ends with newline');

  const statusOnly = (syncText) => planReplyStateCutover({ syncText, store: ctx.store });
  const bookmarksOnly = JSON.stringify({ seenMessageIds: ['seen-1'], futureBookmark: { cursor: 'abc' } });
  check(statusOnly(null).status === 'nothing_to_move'
    && statusOnly('not json').status === 'nothing_to_move'
    && statusOnly('not json').syncInvalid === true
    && statusOnly('{}').status === 'nothing_to_move'
    && statusOnly(bookmarksOnly).status === 'nothing_to_move', 'non movable sync inputs plan as nothing_to_move without throwing');

  const beforeBadApply = readEvents(ctx.store).length;
  let nonReadyThrows = false;
  let badDateThrows = false;
  try { applyReplyStateCutover(ctx.store, { status: 'nothing_to_move' }, { importedOn: '2030-01-01' }); } catch { nonReadyThrows = true; }
  try { applyReplyStateCutover(ctx.store, plan, { importedOn: '2030/01/01' }); } catch { badDateThrows = true; }
  check(nonReadyThrows && badDateThrows && readEvents(ctx.store).length === beforeBadApply, 'bad apply attempts throw and append no events');

  if (plan.status === 'ready') {
    const eventCountBeforeApply = readEvents(ctx.store).length;
    applyReplyStateCutover(ctx.store, plan, { importedOn: '2030-04-02' });
    const afterApplyEvents = readEvents(ctx.store);
    const appended = afterApplyEvents.slice(eventCountBeforeApply);
    check(appended.length === 1
      && appended[0].type === 'legacy_record'
      && appended[0].source === 'import'
      && appended[0].evidence_ref === 'reply-state.json#snapshot', 'ready apply appends exactly one snapshot import event');
    check(same(verifyReplyStateCutover(ctx.store, plan), [])
      && renderLegacyFile(ctx.store, 'reply-state.json') === plan.snapshotText, 'verify passes and rendered legacy file equals snapshot');

    const afterCutoverPlan = planReplyStateCutover({ syncText: ctx.syncText, store: ctx.store });
    let secondApplyThrows = false;
    try { applyReplyStateCutover(ctx.store, afterCutoverPlan, { importedOn: '2030-04-03' }); } catch { secondApplyThrows = true; }
    check(afterCutoverPlan.status === 'already_cut_over'
      && secondApplyThrows
      && readEvents(ctx.store).length === afterApplyEvents.length, 'planning after apply is already_cut_over and apply is idempotent');

    const [dismissedId] = appendEventsWithEffects(ctx.store, [
      buildReplyDismissedEvent({ msg_id: 'm920009', occurred_on: '2030-05-01' }),
    ]);
    const withLiveEffect = JSON.parse(renderLegacyFile(ctx.store, 'reply-state.json'));
    check(Object.keys(withLiveEffect.handledReplies).length === 4
      && withLiveEffect.handledReplies.m920001
      && withLiveEffect.handledReplies.m920002
      && withLiveEffect.handledReplies.m920003
      && withLiveEffect.handledReplies.m920009, 'later live effect layers on top of the snapshot');
    appendEventsWithEffects(ctx.store, [
      buildVoidEvent({
        target_event_id: dismissedId,
        reason_code: 'erroneous_entry',
        actor: 'agent',
        evidence_ref: 'fixture:reply-state-cutover',
        occurred_on: '2030-05-02',
        definitions_version: 'v1',
      }),
    ]);
    check(renderLegacyFile(ctx.store, 'reply-state.json') === plan.snapshotText, 'voiding the live effect returns render to the snapshot');

    const alteredStatePlan = {
      ...plan,
      state: {
        ...plan.state,
        handledReplies: { ...plan.state.handledReplies },
      },
    };
    delete alteredStatePlan.state.handledReplies.m920001;
    const alteredTextPlan = { ...plan, snapshotText: plan.snapshotText.replace('m920001', 'm929999') };
    check(verifyReplyStateCutover(ctx.store, alteredStatePlan).length > 0
      && verifyReplyStateCutover(ctx.store, alteredTextPlan).length > 0, 'verify reports altered state and altered snapshot text');
  } else {
    check(false, `ready apply checks skipped because plan status was ${plan.status}`);
    check(false, `verify checks skipped because plan status was ${plan.status}`);
    check(false, `idempotent apply checks skipped because plan status was ${plan.status}`);
    check(false, `live effect layering checks skipped because plan status was ${plan.status}`);
    check(false, `void live effect checks skipped because plan status was ${plan.status}`);
    check(false, `altered verification checks skipped because plan status was ${plan.status}`);
  }
} finally {
  ctx.store.close();
}

// A folder imported with the decisions already in its sync file (a fresh flip after reply-state.json existed) carries
// them into the snapshot, so there is nothing left to cut over and the projection already holds them.
{
  const carried = await makeStore({ carryOver: true });
  try {
    const plan = planReplyStateCutover({ syncText: carried.syncText, store: carried.store });
    const projected = JSON.parse(renderLegacyFile(carried.store, 'reply-state.json') || '{}');
    check(plan.status === 'already_cut_over'
      && Object.keys(projected.handledReplies || {}).length === 3
      && Object.keys(projected.notRelatedSenders || {}).length === 1
      && Object.keys(projected.unmatchedReplies || {}).length === 1, 'an import that finds the decisions in google-sync.json carries them into the projection');
  } finally {
    carried.store.close();
  }
}

console.log(`reply-state-cutover.test.mjs: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
