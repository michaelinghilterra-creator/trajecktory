#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { openEventStore, readEvents } from '../lib/event-store.mjs';
import { importTracker, rebuildTrackerRows } from '../lib/import/tracker-import.mjs';
import { importStatusHistory, rebuildStatusRows } from '../lib/import/status-import.mjs';
import { comparePeople, importPeople } from '../lib/import/people-import.mjs';
import { importFollowups } from '../lib/import/followups-import.mjs';
import { importCorrespondence } from '../lib/import/correspondence-import.mjs';
import { compareApplyDates, importApplyEvidence } from '../lib/import/apply-import.mjs';
import { compareLinkedIn, importLinkedIn } from '../lib/import/linkedin-import.mjs';
import { compareTwc, importTwc } from '../lib/import/twc-import.mjs';
import {
  appendEventsWithEffects,
  fileMatchesLastRender,
  LEGACY_JSON_FILES,
  listLegacyFiles,
  recordJsonSnapshots,
  renderDirty,
  renderLegacyFile,
} from '../lib/legacy-files.mjs';
import { TRACKER_HEADER, TRACKER_SEPARATOR } from '../lib/tracker.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  PASS ${message}`); passed++; }
  else { console.log(`  FAIL ${message}`); failed++; }
}
function throws(fn) {
  try { fn(); return false; } catch { return true; }
}
function liveEvent(effects, suffix = Math.random().toString(16).slice(2)) {
  return {
    type: 'note_added',
    occurred_on: '2030-08-09',
    source: 'cli',
    definitions_version: 'fixture-v1',
    dedupe_key: `fixture-effect-${suffix}`,
    payload: { legacy_effects: effects },
  };
}
function freshStore(name) {
  return openEventStore(join(root, `${name}.db`));
}

console.log('legacy-files.test.mjs');
const root = makeSandbox('legacy-files-test');
const definitionsVersion = 'fixture-v1';
const importedOn = '2030-12-31';

const trackerRowOne = '| 900001 | 2030-01-01 | Zorblax Widgetry | Example Cog Lead | 0.01/5 | Evaluated | — | [900001](reports/example-900001.md) | Invented note |';
const trackerRowTwo = '| 900002 | 2030-01-02 | Quennox Ratchet Works | Example Sprocket Lead | 0.01/5 | Evaluated | — | — | [900002](reports/example-900002.md) | Invented local note | local:example-900002.txt |';
const trackerText = `# Invented Applications\n\n${TRACKER_HEADER}\n${TRACKER_SEPARATOR}\n${trackerRowOne}\r\n${trackerRowTwo}\n`;
const statusText = 'app#\tdate\tstatus\tcompany\tlogged\n900001\t2030-01-03\tApplied\tZorblax Widgetry\t2030-01-03\n';
const targetRow = '| 900001 | Zorblax Widgetry | Personone | Example |  | Example Talent Lead |  |  |  |  | example.personone@example.test | linkedin.com/in/example-person-900001 | Not Contacted |  | Invented note | example.test |';
const targetTalentText = `# Invented Target Talent\r\n\r\n| # | Company | Last | First | Salute | Title | City | State | Zip | Phone | Email | LinkedIn | Status | Last Touch | Notes | Website |\r\n|---|---------|------|-------|--------|-------|------|-------|-----|-------|-------|----------|--------|------------|-------|---------|\n${targetRow}\r\n`;
const referralRow = '| 900001 | Example Persontwo | Invented colleague | Quennox Ratchet Works | Example Cog Lead | Not Asked |  | Invented note | linkedin.com/in/example-person-900002 | example.persontwo@example.test |';
const referralsText = `# Invented Referrals\n\n| # | Name | How you know them | Where they are now | Target company/role | Status | Last Touch | Notes | LinkedIn | Email |\n|---|------|-------------------|--------------------|---------------------|--------|------------|-------|----------|-------|\n${referralRow}`;
const followupOne = '| 900001 | 900001 | 2030-01-04 | Zorblax Widgetry | Example Cog Lead | email | Example Personone | Invented outreach |';
const followupTwo = '| 900002 | 900002 | 2030-01-05 | Quennox Ratchet Works | Example Sprocket Lead | linkedin | Example Persontwo | Invented outreach |';
const followupsText = `# Invented Follow-Ups\n\n| # | app# | date | company | role | channel | contact | notes |\n|---|------|------|---------|------|---------|---------|-------|\n${followupOne}\n\n## Invented second section\n\n| # | app# | date | company | role | channel | contact | notes |\n|---|------|------|---------|------|---------|---------|-------|\n${followupTwo}`;
const targetCorrespondence = 'Invented preamble.\r\n## 2030-01-06 09:00 | Sent | Invented subject\n\nInvented body.\r\n\r\n';
const referralCorrespondence = 'Invented referral preamble.\n';

const writerJsonTexts = {
  'apply-dates.json': `${JSON.stringify({ 900002: '2030-02-02', 900001: '2030-01-01' }, null, 2)}\n`,
  'linkedin-connects.json': `${JSON.stringify([{ date: '2030-01-01', name: 'Example Personone', source: 'ta', id: 900001 }], null, 2)}\n`,
  'tt-linkedin.json': JSON.stringify({ 900002: { state: 'Connected' }, 900001: { state: 'Invite Pending' } }, null, 2),
  'linkedin-connections.json': JSON.stringify({ importedAt: '2030-01-03T00:00:00.000Z', source: 'fixture', count: 1, connections: [{ first: 'Example', last: 'Personone', url: 'https://www.linkedin.com/in/example-person-one' }] }),
  'twc-events.json': `${JSON.stringify([{ id: 'example-event-900001', date: '2030-01-04', type: 'meeting' }], null, 2)}\n`,
  'twc-overrides.json': `${JSON.stringify({ add: { 'example-900001': { company: 'Zorblax Widgetry' } } }, null, 2)}\n`,
  'contact-links.json': `${JSON.stringify({ version: 1, pins: { 'ta:900001': { alone: true, at: '2030-01-05' } } }, null, 2)}\n`,
};

{
  const store = freshStore('roundtrip');
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  importStatusHistory(store, statusText, { definitionsVersion, importedOn });
  importPeople(store, { targetTalentText, referralsText, definitionsVersion, importedOn });
  importFollowups(store, followupsText, { definitionsVersion, importedOn });
  importCorrespondence(store, {
    targetTalentFiles: { '900001.md': targetCorrespondence },
    referralFiles: { '900001.md': referralCorrespondence },
    definitionsVersion,
    importedOn,
  });
  const exact = {
    'applications.md': trackerText,
    'status-events.tsv': statusText,
    'target-talent.md': targetTalentText,
    'referrals.md': referralsText,
    'follow-ups.md': followupsText,
    'target-talent-correspondence/900001.md': targetCorrespondence,
    'referral-correspondence/900001.md': referralCorrespondence,
  };
  check(Object.entries(exact).every(([file, text]) => renderLegacyFile(store, file) === text), 'all imported table and correspondence files render byte for byte');
  check(listLegacyFiles(store).includes('target-talent-correspondence/900001.md')
    && listLegacyFiles(store).includes('referral-correspondence/900001.md'), 'listLegacyFiles includes imported correspondence');
  check(rebuildTrackerRows(store).length === 2 && rebuildTrackerRows(store)[0].num === 900001, 'existing tracker rebuild projection is unchanged');
  check(rebuildStatusRows(store).length === 1 && rebuildStatusRows(store)[0][2] === 'Applied', 'existing status rebuild projection is unchanged');

  const replacement = trackerRowOne.replace('Invented note', 'Invented replacement');
  appendEventsWithEffects(store, [liveEvent([{
    file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#4', raw: replacement,
  }], 'replace')]);
  check(renderLegacyFile(store, 'applications.md').includes(`${replacement}\r\n`), 'existing row upsert keeps its original CRLF terminator');
  appendEventsWithEffects(store, [liveEvent([{
    file: 'target-talent-correspondence/900001.md', op: 'file_replace', raw: 'Invented imported-file replacement.\n',
  }], 'replace-imported-correspondence')]);
  check(renderLegacyFile(store, 'target-talent-correspondence/900001.md') === 'Invented imported-file replacement.\n', 'file_replace wins over imported correspondence segments');
  store.close();
}

{
  const store = freshStore('anchors');
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  appendEventsWithEffects(store, [liveEvent([
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-start', raw: '| start |', anchor: { at: 'table_start' } },
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-end', raw: '| end |', anchor: { at: 'table_end' } },
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-before', raw: '| before |', anchor: { at: 'before', row_id: 'applications.md#5' } },
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-after', raw: '| after |', anchor: { at: 'after', row_id: 'applications.md#5' } },
  ], 'anchors')]);
  const rendered = renderLegacyFile(store, 'applications.md');
  check(rendered.indexOf('| start |') < rendered.indexOf(trackerRowOne), 'table_start inserts before the first row');
  check(rendered.indexOf('| before |') < rendered.indexOf(trackerRowTwo)
    && rendered.indexOf('| after |') > rendered.indexOf(trackerRowTwo), 'before and after anchors land around the named row');
  check(rendered.indexOf('| end |') > rendered.indexOf('| after |'), 'table_end inserts after the last row');

  appendEventsWithEffects(store, [liveEvent([
    { file: 'applications.md', op: 'row_delete', row_id: 'applications.md#5' },
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-neighbor', raw: '| neighbor |', anchor: { at: 'after', row_id: 'applications.md#n-before' } },
  ], 'delete-neighbor')]);
  check(!renderLegacyFile(store, 'applications.md').includes(trackerRowTwo)
    && renderLegacyFile(store, 'applications.md').includes('| neighbor |'), 'delete removes a row and a new id can anchor to its surviving neighbor');
  check(throws(() => appendEventsWithEffects(store, [liveEvent([{
    file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-bad-anchor', raw: '| bad |', anchor: { at: 'after', row_id: 'applications.md#5' },
  }], 'deleted-anchor')])), 'anchoring to a deleted row throws');
  store.close();
}

{
  const store = freshStore('invalid-effects');
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  const cases = [
    { file: 'applications.md', op: 'unknown', row_id: 'x' },
    { file: 'unknown.md', op: 'row_delete', row_id: 'x' },
    { file: 'applications.md', op: 'row_upsert', row_id: 'new', anchor: { at: 'table_end' } },
    { file: 'applications.md', op: 'row_upsert', row_id: 'new', raw: '| new |' },
    { file: 'applications.md', op: 'row_upsert', row_id: 'new', raw: '| new |', anchor: { at: 'after', row_id: 'missing' } },
    { file: 'applications.md', op: 'row_delete', row_id: 'missing' },
  ];
  for (let index = 0; index < cases.length; index++) {
    const before = readEvents(store).length;
    check(throws(() => appendEventsWithEffects(store, [liveEvent([cases[index]], `invalid-${index}`)]))
      && readEvents(store).length === before
      && store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state').get().n === 0,
    `invalid effect ${index + 1} throws and writes nothing`);
  }
  store.close();
}

{
  const store = freshStore('missing');
  importTracker(store, '', { definitionsVersion, importedOn, exists: false });
  check(renderLegacyFile(store, 'applications.md') === null, 'missing file with no effects renders null');
  appendEventsWithEffects(store, [liveEvent([{
    file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#n-900001', raw: trackerRowOne, anchor: { at: 'table_start' },
  }], 'create-missing')]);
  const created = renderLegacyFile(store, 'applications.md');
  check(created.startsWith(`# Applications Tracker\n\n${TRACKER_HEADER}\n${TRACKER_SEPARATOR}\n`)
    && created.endsWith(`${trackerRowOne}\n`), 'first upsert creates a missing tracker from its writer skeleton');
  store.close();
}

{
  const store = freshStore('correspondence-replace');
  appendEventsWithEffects(store, [liveEvent([
    { file: 'target-talent-correspondence/900001.md', op: 'file_replace', raw: 'Invented replacement.\r\n' },
    { file: 'referral-correspondence/900002.md', op: 'file_replace', raw: 'Invented new correspondence.\n' },
  ], 'correspondence')]);
  check(renderLegacyFile(store, 'target-talent-correspondence/900001.md') === 'Invented replacement.\r\n', 'file_replace supplies the latest correspondence content');
  check(renderLegacyFile(store, 'referral-correspondence/900002.md') === 'Invented new correspondence.\n', 'file_replace creates brand-new correspondence');
  store.close();
}

{
  const store = freshStore('dirty');
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  importStatusHistory(store, statusText, { definitionsVersion, importedOn });
  appendEventsWithEffects(store, [liveEvent([
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#4', raw: trackerRowOne.replace('Invented note', 'Invented dirty note') },
    { file: 'status-events.tsv', op: 'row_upsert', row_id: 'status-events.tsv#1', raw: '900001\t2030-01-03\tInterviewing\tZorblax Widgetry\t2030-01-03' },
  ], 'dirty-two')]);
  check(fileMatchesLastRender(store, join(root, 'rendered'), 'applications.md') === null, 'fileMatchesLastRender is null before a render');
  const output = join(root, 'rendered');
  mkdirSync(output, { recursive: true });
  const result = renderDirty(store, output);
  check(result.rendered.join(',') === 'applications.md,status-events.tsv' && result.failed.length === 0, 'renderDirty writes exactly the dirty files');
  check(store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state WHERE dirty = 1').get().n === 0, 'successful render records hashes and clears dirty state');
  check(fileMatchesLastRender(store, output, 'applications.md') === true, 'fileMatchesLastRender is true after rendering');
  writeFileSync(join(output, 'applications.md'), 'Invented hand edit.\n', 'utf8');
  check(fileMatchesLastRender(store, output, 'applications.md') === false, 'fileMatchesLastRender detects an edited file');
  rmSync(join(output, 'applications.md'));
  check(fileMatchesLastRender(store, output, 'applications.md') === false, 'fileMatchesLastRender detects a deleted file');

  appendEventsWithEffects(store, [liveEvent([
    { file: 'applications.md', op: 'row_upsert', row_id: 'applications.md#4', raw: trackerRowOne },
    { file: 'status-events.tsv', op: 'row_upsert', row_id: 'status-events.tsv#1', raw: '900001\t2030-01-03\tApplied\tZorblax Widgetry\t2030-01-03' },
  ], 'dirty-failure')]);
  const failedResult = renderDirty(store, output, {
    writeFile(file, content) {
      if (basename(file) === 'status-events.tsv') throw new Error('invented write failure');
      writeFileSync(file, content, 'utf8');
    },
  });
  check(failedResult.rendered.join(',') === 'applications.md'
    && failedResult.failed.length === 1
    && failedResult.failed[0].file === 'status-events.tsv', 'a failed write is reported while other dirty files continue');
  check(store.db.prepare('SELECT file FROM legacy_render_state WHERE dirty = 1').all().map(row => row.file).join(',') === 'status-events.tsv', 'only the failed file remains dirty');

  let raced = false;
  const raceResult = renderDirty(store, output, {
    writeFile(file, content) {
      writeFileSync(file, content, 'utf8');
      if (raced) return;
      raced = true;
      appendEventsWithEffects(store, [liveEvent([
        { file: 'status-events.tsv', op: 'row_upsert', row_id: 'status-events.tsv#1', raw: '900001\t2030-01-04\tApplied\tZorblax Widgetry\t2030-01-04' },
      ], 'dirty-race')]);
    },
  });
  check(raceResult.rendered.join(',') === 'status-events.tsv'
    && store.db.prepare('SELECT dirty FROM legacy_render_state WHERE file = ?').get('status-events.tsv').dirty > 0,
  'a save that lands during a render keeps the file dirty for the next pass');
  store.close();
}

{
  const store = freshStore('json-writer-roundtrip');
  const ids = recordJsonSnapshots(store, { texts: writerJsonTexts, definitionsVersion, importedOn });
  const snapshots = store.db.prepare(`
    SELECT payload FROM events WHERE type = 'legacy_record' AND evidence_ref LIKE '%#snapshot' ORDER BY id
  `).all().map(row => JSON.parse(row.payload));
  check(ids.length === 7 && snapshots.length === 7
    && snapshots.every(snapshot => snapshot.format === 'writer'), 'all seven writer-formatted JSON files snapshot as writer format in one import');
  check(LEGACY_JSON_FILES.every(file => renderLegacyFile(store, file) === writerJsonTexts[file]), 'all seven writer-formatted JSON snapshots render byte for byte');
  check(LEGACY_JSON_FILES.every(file => listLegacyFiles(store).includes(file)), 'listLegacyFiles includes all seven JSON files');
  store.close();
}

{
  const store = freshStore('json-raw-roundtrip');
  const crlf = '{\r\n  "alpha": 1\r\n}\r\n';
  const fourSpaces = `${JSON.stringify([{ id: 900001 }], null, 4)}\n`;
  const invalid = '{invented invalid json';
  recordJsonSnapshots(store, {
    texts: {
      'apply-dates.json': crlf,
      'linkedin-connects.json': fourSpaces,
      'tt-linkedin.json': invalid,
    },
    definitionsVersion,
    importedOn,
  });
  const formats = store.db.prepare(`
    SELECT payload FROM events WHERE evidence_ref LIKE '%#snapshot' ORDER BY id
  `).all().map(row => JSON.parse(row.payload));
  check(formats.slice(0, 3).every(snapshot => snapshot.format === 'raw')
    && renderLegacyFile(store, 'apply-dates.json') === crlf
    && renderLegacyFile(store, 'linkedin-connects.json') === fourSpaces
    && renderLegacyFile(store, 'tt-linkedin.json') === invalid,
  'CRLF, four-space and invalid JSON snapshots remain raw and render exactly');
  appendEventsWithEffects(store, [liveEvent([
    { file: 'apply-dates.json', op: 'json_set', key: 'beta', value: 2 },
    { file: 'linkedin-connects.json', op: 'json_append', item: { id: 900002 } },
    { file: 'tt-linkedin.json', op: 'json_set', key: '900001', value: { state: 'Connected' } },
  ], 'raw-to-writer')]);
  check(renderLegacyFile(store, 'apply-dates.json') === `${JSON.stringify({ alpha: 1, beta: 2 }, null, 2)}\n`
    && renderLegacyFile(store, 'linkedin-connects.json') === `${JSON.stringify([{ id: 900001 }, { id: 900002 }], null, 2)}\n`
    && renderLegacyFile(store, 'tt-linkedin.json') === JSON.stringify({ 900001: { state: 'Connected' } }, null, 2),
  'the first JSON effect converts raw snapshots to each writer format');
  store.close();
}

{
  const store = freshStore('json-object-effects');
  const start = { alpha: 1, gamma: 3, 900002: 'later integer' };
  recordJsonSnapshots(store, {
    texts: { 'apply-dates.json': `${JSON.stringify(start, null, 2)}\n` },
    definitionsVersion,
    importedOn,
  });
  appendEventsWithEffects(store, [liveEvent([
    { file: 'apply-dates.json', op: 'json_set', key: 'alpha', value: 10 },
    { file: 'apply-dates.json', op: 'json_set', key: 'beta', value: 2 },
    { file: 'apply-dates.json', op: 'json_set', key: '900001', value: 'earlier integer' },
    { file: 'apply-dates.json', op: 'json_delete', key: 'gamma' },
    { file: 'apply-dates.json', op: 'json_delete', key: 'missing' },
  ], 'object-order')]);
  const projected = JSON.parse(renderLegacyFile(store, 'apply-dates.json'));
  check(Object.keys(projected).join(',') === '900001,900002,alpha,beta'
    && projected.alpha === 10 && !Object.hasOwn(projected, 'gamma'),
  'json_set and json_delete use native object key order and idempotent deletion');
  appendEventsWithEffects(store, [liveEvent([
    { file: 'twc-events.json', op: 'json_append', item: { id: 'example-event-900001' } },
    { file: 'twc-overrides.json', op: 'json_replace', value: { replacement: 'Invented replacement' } },
  ], 'append-replace')]);
  check(JSON.parse(renderLegacyFile(store, 'twc-events.json'))[0].id === 'example-event-900001'
    && JSON.parse(renderLegacyFile(store, 'twc-overrides.json')).replacement === 'Invented replacement',
  'json_append adds to an array and json_replace replaces a whole document');
  store.close();
}

{
  const store = freshStore('json-absent-defaults');
  recordJsonSnapshots(store, { texts: {}, definitionsVersion, importedOn });
  check(LEGACY_JSON_FILES.every(file => renderLegacyFile(store, file) === null), 'all absent JSON snapshots render null before effects');
  const beforeRejected = readEvents(store).length;
  check(throws(() => appendEventsWithEffects(store, [liveEvent([{
    file: 'linkedin-connections.json', op: 'json_set', key: 'source', value: 'fixture',
  }], 'connections-absent-set')])) && readEvents(store).length === beforeRejected,
  'linkedin-connections rejects json_set while absent');
  appendEventsWithEffects(store, [liveEvent([
    { file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-01-01' },
    { file: 'linkedin-connects.json', op: 'json_append', item: { id: 900001, name: 'Example Personone' } },
    { file: 'contact-links.json', op: 'json_set', key: 'fixture', value: 'Invented link state' },
    { file: 'linkedin-connections.json', op: 'json_replace', value: { importedAt: '2030-01-01T00:00:00.000Z', source: 'fixture', count: 0, connections: [] } },
  ], 'absent-defaults')]);
  const contactLinks = JSON.parse(renderLegacyFile(store, 'contact-links.json'));
  check(JSON.parse(renderLegacyFile(store, 'apply-dates.json'))['900001'] === '2030-01-01'
    && JSON.parse(renderLegacyFile(store, 'linkedin-connects.json'))[0].id === 900001
    && contactLinks.version === 1 && JSON.stringify(contactLinks.pins) === '{}'
    && JSON.parse(renderLegacyFile(store, 'linkedin-connections.json')).source === 'fixture',
  'absent JSON files use their defaults and linkedin-connections accepts json_replace');
  store.close();
}

{
  const store = freshStore('json-invalid-effects');
  recordJsonSnapshots(store, {
    texts: { 'linkedin-connects.json': '[]\n' }, definitionsVersion, importedOn,
  });
  const cyclic = {};
  cyclic.self = cyclic;
  const cases = [
    { file: 'apply-dates.json', op: 'row_delete', row_id: 'example-row' },
    { file: 'applications.md', op: 'json_append', item: 1 },
    { file: 'apply-dates.json', op: 'file_replace', raw: '{}' },
    { file: 'apply-dates.json', op: 'json_set', value: 1 },
    { file: 'apply-dates.json', op: 'json_set', key: 'bad', value: undefined },
    { file: 'apply-dates.json', op: 'json_set', key: 'bad', value: Number.NaN },
    { file: 'apply-dates.json', op: 'json_set', key: 'bad', value: () => 'bad' },
    { file: 'apply-dates.json', op: 'json_set', key: 'bad', value: cyclic },
    { file: 'linkedin-connects.json', op: 'json_append' },
    { file: 'linkedin-connects.json', op: 'json_set', key: 'bad', value: 1 },
    { file: 'apply-dates.json', op: 'json_set', key: 'bad', value: Object.defineProperty({}, 'toJSON', { value: () => undefined }) },
    { file: 'linkedin-connects.json', op: 'json_append', item: new Date('2030-01-01T00:00:00Z') },
  ];
  for (let index = 0; index < cases.length; index++) {
    const before = readEvents(store).length;
    check(throws(() => appendEventsWithEffects(store, [liveEvent([cases[index]], `json-invalid-${index}`)]))
      && readEvents(store).length === before
      && store.db.prepare('SELECT COUNT(*) AS n FROM legacy_render_state').get().n === 0,
    `invalid JSON effect ${index + 1} throws and writes nothing`);
  }
  store.close();
}

{
  const store = freshStore('json-dirty');
  recordJsonSnapshots(store, { texts: {}, definitionsVersion, importedOn });
  appendEventsWithEffects(store, [liveEvent([{
    file: 'apply-dates.json', op: 'json_set', key: '900001', value: '2030-01-01',
  }], 'json-dirty')]);
  const output = join(root, 'json-rendered');
  mkdirSync(output, { recursive: true });
  const result = renderDirty(store, output);
  const state = store.db.prepare('SELECT sha256 FROM legacy_render_state WHERE file = ?').get('apply-dates.json');
  check(result.rendered.join(',') === 'apply-dates.json' && result.failed.length === 0
    && state.sha256.length === 64 && fileMatchesLastRender(store, output, 'apply-dates.json') === true,
  'renderDirty writes JSON, records SHA-256 and reports an exact match');
  writeFileSync(join(output, 'apply-dates.json'), '{}\n', 'utf8');
  check(fileMatchesLastRender(store, output, 'apply-dates.json') === false, 'fileMatchesLastRender detects a JSON hand edit');
  store.close();
}

{
  const store = freshStore('json-importer-compatibility');
  importTracker(store, trackerText, { definitionsVersion, importedOn });
  const applyDates = {};
  importApplyEvidence(store, { applyDates, outputFiles: [], definitionsVersion, importedOn, ownerName: 'Example Personone' });
  const pins = { 'ta:900001': { alone: true, at: '2030-01-01' } };
  importPeople(store, { targetTalentText, referralsText: '', pins, definitionsVersion, importedOn });
  const linkedinFiles = { connectsText: null, sidecarText: null, connectionsText: null };
  const twcFiles = { eventsText: null, overridesText: null };
  importLinkedIn(store, { ...linkedinFiles, definitionsVersion, importedOn });
  importTwc(store, { ...twcFiles, definitionsVersion, importedOn });
  recordJsonSnapshots(store, {
    texts: { 'apply-dates.json': '{}\n', 'contact-links.json': `${JSON.stringify({ version: 1, pins }, null, 2)}\n` },
    definitionsVersion,
    importedOn,
  });
  check(compareApplyDates(applyDates, store).match
    && comparePeople({ targetTalentText, referralsText: '' }, store).match
    && compareLinkedIn(linkedinFiles, store).match
    && compareTwc(twcFiles, store).match,
  'recordJsonSnapshots leaves every existing JSON importer comparison unchanged');
  store.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
