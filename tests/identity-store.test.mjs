#!/usr/bin/env node

import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  openEventStore,
  readEvents,
} from '../lib/event-store.mjs';
import {
  IdentityConflictError,
  addApplication,
  addIdentifier,
  addPerson,
  companyKey,
  findCompany,
  findPerson,
  findPersonByAlias,
  keepCompaniesSeparate,
  keepPeopleSeparate,
  mergeCompanies,
  mergePeople,
  personMembers,
  resolveCompany,
  resolveCompanyId,
  resolvePersonId,
  resolvePosting,
  unmergeCompanies,
  unmergePeople,
  wereKeptSeparate,
} from '../lib/identity-store.mjs';
import { makeSandbox } from './helpers/sandbox.mjs';

let passed = 0, failed = 0;
function check(condition, message) {
  if (condition) { console.log(`  ✅ ${message}`); passed++; }
  else { console.log(`  ❌ ${message}`); failed++; }
}

function catches(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

const ctx = {
  occurred_on: '2030-04-05',
  source: 'cli',
  definitions_version: 'test-v1',
  evidence_ref: 'test-evidence',
};

console.log('identity-store.test.mjs');
const dir = makeSandbox('identity-store-test');

{
  const store = openEventStore(join(dir, 'fresh.db'));
  const tables = store.db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name
  `).all().map(row => row.name);
  const expected = [
    'applications', 'companies', 'companies_separate', 'company_keys', 'company_merges',
    'company_unmerges', 'people', 'people_separate', 'person_aliases', 'person_identifiers',
    'person_merges', 'person_unmerges', 'postings',
  ];
  check(SCHEMA_VERSION === 4 && store.db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'fresh store is at SCHEMA_VERSION 4');
  check(expected.every(table => tables.includes(table)), 'fresh store has all identity and merge tables');
  store.close();
}

{
  const dbPath = join(dir, 'migration.db');
  const db = new DatabaseSync(dbPath);
  db.exec(MIGRATIONS[0]);
  db.exec(MIGRATIONS[1]);
  const event = db.prepare(`
    INSERT INTO events (type, occurred_on, recorded_at, source, payload, definitions_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('note_added', '2030-01-01', '2030-01-01T00:00:00.000Z', 'cli', '{}', 'test-v1');
  const eventId = Number(event.lastInsertRowid);
  db.prepare('INSERT INTO people (id, display_name, created_event_id) VALUES (?, ?, ?)')
    .run('per_migration', 'Example Person Migration', eventId);
  db.prepare('INSERT INTO companies (id, name, created_event_id) VALUES (?, ?, ?)')
    .run('co_migration', 'Example Migration', eventId);
  db.prepare('INSERT INTO postings (id, company_id, title, canonical_url, created_event_id) VALUES (?, ?, ?, ?, ?)')
    .run('pst_migration', 'co_migration', 'Example Role', 'https://jobs.example.test/migration', eventId);
  db.exec('PRAGMA user_version = 2');
  db.close();
  const store = openEventStore(dbPath);
  check(store.db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'v2 database migrates to version 4');
  check(
    readEvents(store).length === 1
      && store.db.prepare('SELECT id FROM people WHERE id = ?').get('per_migration')?.id === 'per_migration'
      && store.db.prepare('SELECT id FROM companies WHERE id = ?').get('co_migration')?.id === 'co_migration'
      && store.db.prepare('SELECT id FROM postings WHERE id = ?').get('pst_migration')?.id === 'pst_migration',
    'v2 migration preserves existing event and identity rows',
  );
  store.close();
}

{
  const variants = ['Example', 'example', 'Example, Inc.', 'EXAMPLE LLC'].map(companyKey);
  check(new Set(variants).size === 1, 'companyKey folds case, punctuation, and legal suffixes');
  check(companyKey('Example') !== companyKey('Example.io'), 'companyKey keeps distinct non-suffix names apart');
  check(companyKey('Co') === 'co', 'companyKey does not strip a suffix that is the whole name');
  check(companyKey('見本') === '見本', 'companyKey preserves non-ASCII letters');
  check(companyKey('Café') === companyKey('Cafe'), 'companyKey folds Latin accents');
  check(companyKey('ガス') !== companyKey('カス'), 'companyKey keeps Japanese voicing marks distinct');
  check(companyKey('ｅｘａｍｐｌｅ') === companyKey('Example'), 'companyKey folds full-width letters');
}

{
  const store = openEventStore(join(dir, 'companies.db'));
  const first = resolveCompany(store, 'Example, Inc.', ctx);
  const second = resolveCompany(store, 'example', ctx);
  check(first.created && !second.created && first.id === second.id, 'resolveCompany reuses a spelling variant');
  check(findCompany(store, 'EXAMPLE LLC') === first.id, 'findCompany uses the normalized company key');
  check(readEvents(store, { type: 'company_added' }).length === 1, 'one resolved company writes one company_added event');
  store.close();
}

{
  const store = openEventStore(join(dir, 'people.db'));
  const firstId = addPerson(store, {
    name: 'Example Person One',
    emails: [' Person.One@Example.Test '],
    linkedinUrls: ['https://www.linkedin.com/in/example-person-one/'],
    aliases: [{ source: 'target_talent', legacyId: '900017' }],
  }, ctx);
  const identifiers = store.db.prepare(
    'SELECT kind, value FROM person_identifiers WHERE person_id = ? ORDER BY kind',
  ).all(firstId);
  check(identifiers.some(row => row.kind === 'email' && row.value === 'person.one@example.test'), 'addPerson stores a normalized email');
  check(identifiers.some(row => row.kind === 'linkedin' && row.value === 'example-person-one'), 'addPerson stores a normalized LinkedIn slug');
  check(findPerson(store, { email: 'PERSON.ONE@EXAMPLE.TEST' }) === firstId, 'findPerson finds a normalized email');
  check(findPerson(store, { linkedin: 'https://linkedin.com/in/example-person-one' }) === firstId, 'findPerson finds a LinkedIn profile');
  check(findPersonByAlias(store, 'target_talent', '900017') === firstId, 'findPersonByAlias finds a legacy alias');

  const beforeConflict = readEvents(store).length;
  const emailConflict = catches(() => addPerson(store, {
    name: 'Example Person Two',
    emails: ['PERSON.ONE@EXAMPLE.TEST'],
  }, ctx));
  const linkedinConflict = catches(() => addPerson(store, {
    name: 'Example Person Three',
    linkedinUrls: ['https://linkedin.com/in/example-person-one'],
  }, ctx));
  check(emailConflict instanceof IdentityConflictError && emailConflict.conflicts[0].existingId === firstId, 'shared email reports the existing person');
  check(linkedinConflict instanceof IdentityConflictError && linkedinConflict.conflicts[0].existingId === firstId, 'shared LinkedIn slug reports the existing person');
  check(readEvents(store).length === beforeConflict && store.db.prepare('SELECT COUNT(*) AS count FROM people').get().count === 1, 'person conflicts write no event and no person row');

  const sameNameA = addPerson(store, { name: 'Sample Name' }, ctx);
  const sameNameB = addPerson(store, { name: 'Sample Name' }, ctx);
  check(sameNameA !== sameNameB, 'the same name without shared identifiers creates two people');

  check(addIdentifier(store, firstId, { kind: 'email', value: 'person.one@example.test' }, ctx) === false, 'adding an existing own identifier is a no-op');
  const otherId = addPerson(store, { name: 'Example Person Four', emails: ['person.four@example.test'] }, ctx);
  const otherConflict = catches(() => addIdentifier(store, firstId, { kind: 'email', value: 'person.four@example.test' }, ctx));
  check(otherConflict instanceof IdentityConflictError && otherConflict.conflicts[0].existingId === otherId, 'adding another person identifier throws a conflict');
  const emailEventsBefore = readEvents(store, { type: 'email_found' }).length;
  check(addIdentifier(store, firstId, { kind: 'email', value: 'new@example.test' }, ctx) === true, 'adding a new identifier succeeds');
  check(readEvents(store, { type: 'email_found' }).length === emailEventsBefore + 1, 'a new email writes one email_found event');

  addIdentifier(store, otherId, { kind: 'linkedin', value: 'https://linkedin.com/in/example-person-four' }, ctx);
  const splitMatch = catches(() => findPerson(store, {
    email: 'person.one@example.test',
    linkedin: 'https://linkedin.com/in/example-person-four',
  }));
  check(splitMatch instanceof IdentityConflictError, 'findPerson rejects identifiers belonging to different people');
  store.close();
}

{
  const store = openEventStore(join(dir, 'people-merges.db'));
  const fromId = addPerson(store, {
    name: 'Example Person Merge From',
    emails: ['merge.from@example.test'],
  }, ctx);
  const intoId = addPerson(store, {
    name: 'Example Person Merge Into',
    emails: ['merge.into@example.test'],
  }, ctx);
  const mergeId = mergePeople(store, { fromId, intoId }, ctx);
  check(Number.isInteger(mergeId), 'mergePeople returns the merge row id');
  check(
    findPerson(store, { email: 'merge.from@example.test' }) === intoId
      && findPerson(store, { email: 'merge.into@example.test' }) === intoId
      && findPerson(store, {
        email: 'merge.from@example.test',
        linkedin: undefined,
      }) === intoId,
    'findPerson resolves identifiers from either merged person to the into root',
  );
  check(
    JSON.stringify(personMembers(store, intoId)) === JSON.stringify([fromId, intoId].sort()),
    'personMembers lists the root and merged member in sorted order',
  );
  check(readEvents(store, { type: 'people_merged' }).length === 1, 'a person merge writes one people_merged event');

  const eventsBeforeNoOps = readEvents(store).length;
  const rowsBeforeNoOps = store.db.prepare('SELECT COUNT(*) AS count FROM person_merges').get().count;
  check(
    mergePeople(store, { fromId, intoId }, ctx) === null
      && mergePeople(store, { fromId: intoId, intoId: fromId }, ctx) === null,
    'merging members of the same root in either direction returns null',
  );
  check(
    readEvents(store).length === eventsBeforeNoOps
      && store.db.prepare('SELECT COUNT(*) AS count FROM person_merges').get().count === rowsBeforeNoOps,
    'same-root person merges write nothing',
  );

  check(
    addIdentifier(store, intoId, { kind: 'email', value: 'merge.from@example.test' }, ctx) === false,
    'addIdentifier returns false for an identifier owned by a merged member',
  );
  const otherId = addPerson(store, {
    name: 'Sample Person Other Root',
    emails: ['other.root@example.test'],
  }, ctx);
  const conflict = catches(() => addIdentifier(
    store,
    fromId,
    { kind: 'email', value: 'other.root@example.test' },
    ctx,
  ));
  check(
    conflict instanceof IdentityConflictError && conflict.conflicts[0].existingId === otherId,
    'addIdentifier reports a conflicting identifier owner as its resolved root',
  );
  store.close();
}

{
  const store = openEventStore(join(dir, 'person-chain.db'));
  const aId = addPerson(store, { name: 'Example Person Chain A' }, ctx);
  const bId = addPerson(store, { name: 'Example Person Chain B' }, ctx);
  const cId = addPerson(store, { name: 'Example Person Chain C' }, ctx);
  const dId = addPerson(store, { name: 'Example Person Unmerged Branch D' }, ctx);
  const firstMergeId = mergePeople(store, { fromId: aId, intoId: bId }, ctx);
  mergePeople(store, { fromId: bId, intoId: cId }, ctx);
  const branchMergeId = mergePeople(store, { fromId: dId, intoId: bId }, ctx);
  check(resolvePersonId(store, aId) === cId, 'resolvePersonId follows a merge chain to its root');
  unmergePeople(store, { mergeId: branchMergeId }, ctx);
  check(
    JSON.stringify(personMembers(store, cId)) === JSON.stringify([aId, bId, cId].sort()),
    'personMembers follows an incoming merge chain and excludes an unmerged branch',
  );
  unmergePeople(store, { mergeId: firstMergeId }, ctx);
  check(
    resolvePersonId(store, aId) === aId && resolvePersonId(store, bId) === cId,
    'unmergePeople restores only its link and leaves later merges active',
  );
  const unmergeEvent = readEvents(store, { type: 'people_unmerged' })
    .find(event => event.payload.merge_id === firstMergeId);
  const mergeEventId = store.db.prepare('SELECT event_id FROM person_merges WHERE id = ?').get(firstMergeId).event_id;
  check(unmergeEvent.corrects_event_id === mergeEventId, 'an unmerge event corrects the original merge event');
  const eventsBeforeRetry = readEvents(store).length;
  const unmergesBeforeRetry = store.db.prepare('SELECT COUNT(*) AS count FROM person_unmerges').get().count;
  check(/already undone/.test(String(catches(() => unmergePeople(store, { mergeId: firstMergeId }, ctx))?.message)), 'unmerging an already undone person merge throws');
  check(
    readEvents(store).length === eventsBeforeRetry
      && store.db.prepare('SELECT COUNT(*) AS count FROM person_unmerges').get().count === unmergesBeforeRetry,
    'a repeated person unmerge writes nothing',
  );
  store.close();
}

{
  const store = openEventStore(join(dir, 'company-merges.db'));
  const example = resolveCompany(store, 'Example', ctx);
  const exampleIo = resolveCompany(store, 'Example.io', ctx);
  const withUrl = resolvePosting(store, {
    companyId: exampleIo.id,
    title: 'Example Gadget Role',
    url: 'https://jobs.example.test/roles/company-merge',
  }, ctx);
  const withoutUrl = resolvePosting(store, {
    companyId: exampleIo.id,
    title: 'Example Gizmo Role',
  }, ctx);
  mergeCompanies(store, { fromId: exampleIo.id, intoId: example.id }, ctx);
  check(
    findCompany(store, 'Example.io') === example.id
      && resolveCompanyId(store, exampleIo.id) === example.id,
    'company lookup and id resolution return the merged company root',
  );
  const reusedUrl = resolvePosting(store, {
    companyId: example.id,
    title: 'Changed Example Title',
    url: 'https://jobs.example.test/roles/company-merge',
  }, ctx);
  check(!reusedUrl.created && reusedUrl.id === withUrl.id, 'a merged company reuses its member canonical URL posting');
  const reusedTitle = resolvePosting(store, {
    companyId: example.id,
    title: 'Example Gizmo Role',
  }, ctx);
  check(!reusedTitle.created && reusedTitle.id === withoutUrl.id, 'a merged company finds a URL-less role across all members');
  store.close();
}

{
  const store = openEventStore(join(dir, 'kept-separate.db'));
  const personA = addPerson(store, { name: 'Example Person Separate A' }, ctx);
  const personB = addPerson(store, { name: 'Example Person Separate B' }, ctx);
  const personC = addPerson(store, { name: 'Example Person Separate C' }, ctx);
  const personD = addPerson(store, { name: 'Example Person Separate D' }, ctx);
  const companyA = resolveCompany(store, 'Example Separate', ctx).id;
  const companyB = resolveCompany(store, 'Sample Labs Separate', ctx).id;
  check(keepPeopleSeparate(store, { aId: personB, bId: personA }, ctx), 'keepPeopleSeparate records an ordered pair');
  const peopleEvents = readEvents(store, { type: 'people_kept_separate' }).length;
  check(
    keepPeopleSeparate(store, { aId: personA, bId: personB }, ctx) === false
      && readEvents(store, { type: 'people_kept_separate' }).length === peopleEvents
      && wereKeptSeparate(store, 'person', personA, personB)
      && wereKeptSeparate(store, 'person', personB, personA),
    'person separation is order-independent and a repeated call writes no event',
  );
  mergePeople(store, { fromId: personA, intoId: personC }, ctx);
  check(
    wereKeptSeparate(store, 'person', personC, personB),
    'a separation decision follows a person after it is merged into another root',
  );
  check(
    keepPeopleSeparate(store, { aId: personA, bId: personD }, ctx),
    'keepPeopleSeparate accepts a merged member when recording a new decision',
  );
  const expectedRootPair = [personC, personD].sort();
  const rootedPair = store.db.prepare(`
    SELECT a_id, b_id FROM people_separate WHERE a_id = ? AND b_id = ?
  `).get(...expectedRootPair);
  const rootedEvent = readEvents(store, { type: 'people_kept_separate' }).at(-1);
  check(
    rootedPair?.a_id === expectedRootPair[0]
      && rootedPair?.b_id === expectedRootPair[1]
      && rootedEvent.payload.a_id === expectedRootPair[0]
      && rootedEvent.payload.b_id === expectedRootPair[1]
      && rootedEvent.payload.requested_a_id === personA
      && rootedEvent.payload.requested_b_id === personD,
    'recording through a merged person stores and emits roots while preserving requested ids',
  );
  const eventsBeforeSameRoot = readEvents(store).length;
  const separationsBeforeSameRoot = store.db.prepare('SELECT COUNT(*) AS count FROM people_separate').get().count;
  const sameRootError = catches(() => keepPeopleSeparate(
    store,
    { aId: personA, bId: personC },
    ctx,
  ));
  check(
    sameRootError?.message === 'already the same person'
      && readEvents(store).length === eventsBeforeSameRoot
      && store.db.prepare('SELECT COUNT(*) AS count FROM people_separate').get().count === separationsBeforeSameRoot,
    'recording two members of one person root throws and writes nothing',
  );
  check(keepCompaniesSeparate(store, { aId: companyB, bId: companyA }, ctx), 'keepCompaniesSeparate records an ordered pair');
  const companyEvents = readEvents(store, { type: 'companies_kept_separate' }).length;
  check(
    keepCompaniesSeparate(store, { aId: companyA, bId: companyB }, ctx) === false
      && readEvents(store, { type: 'companies_kept_separate' }).length === companyEvents
      && wereKeptSeparate(store, 'company', companyA, companyB)
      && wereKeptSeparate(store, 'company', companyB, companyA),
    'company separation is order-independent and a repeated call writes no event',
  );

  const personMergeId = mergePeople(store, { fromId: personA, intoId: personB }, ctx);
  const companyMergeId = mergeCompanies(store, { fromId: companyA, intoId: companyB }, ctx);
  check(
    Number.isInteger(personMergeId)
      && Number.isInteger(companyMergeId)
      && resolvePersonId(store, personA) === personB
      && resolveCompanyId(store, companyA) === companyB,
    'a kept-separate pair can still be merged later',
  );
  unmergePeople(store, { mergeId: personMergeId }, ctx);
  unmergeCompanies(store, { mergeId: companyMergeId }, ctx);

  const protectedWrites = [
    () => store.db.prepare('UPDATE person_merges SET from_person_id = ? WHERE id = ?').run(personB, personMergeId),
    () => store.db.prepare('DELETE FROM person_merges WHERE id = ?').run(personMergeId),
    () => store.db.prepare('UPDATE person_unmerges SET event_id = event_id WHERE merge_id = ?').run(personMergeId),
    () => store.db.prepare('DELETE FROM person_unmerges WHERE merge_id = ?').run(personMergeId),
    () => store.db.prepare('UPDATE company_merges SET from_company_id = ? WHERE id = ?').run(companyB, companyMergeId),
    () => store.db.prepare('DELETE FROM company_merges WHERE id = ?').run(companyMergeId),
    () => store.db.prepare('UPDATE companies_separate SET event_id = event_id WHERE a_id = ? AND b_id = ?').run(...[companyA, companyB].sort()),
    () => store.db.prepare('DELETE FROM companies_separate WHERE a_id = ? AND b_id = ?').run(...[companyA, companyB].sort()),
  ];
  check(
    protectedWrites.every(operation => /append-only/.test(String(catches(operation)?.message))),
    'merge and separation UPDATE and DELETE triggers reject direct writes',
  );
  store.close();
}

{
  const store = openEventStore(join(dir, 'postings.db'));
  const company = resolveCompany(store, 'Example', ctx);
  const otherCompany = resolveCompany(store, 'Sample Labs', ctx);
  const first = resolvePosting(store, {
    companyId: company.id,
    title: 'Example Sprocket Role',
    url: 'https://jobs.example.test/roles/900123?utm_source=test',
  }, ctx);
  const tracked = resolvePosting(store, {
    companyId: company.id,
    title: 'Different Title',
    url: 'https://jobs.example.test/roles/900123?utm_campaign=test',
  }, ctx);
  const distinctUrl = resolvePosting(store, {
    companyId: company.id,
    title: 'Example Sprocket Role',
    url: 'https://jobs.example.test/roles/900456',
  }, ctx);
  check(first.created && !tracked.created && first.id === tracked.id, 'canonical URL resolves tracking variants to one posting');
  check(distinctUrl.created && distinctUrl.id !== first.id, 'different URLs with identical titles create two postings');

  const beforeCanonicalConflict = readEvents(store).length;
  const canonicalConflict = catches(() => resolvePosting(store, {
    companyId: otherCompany.id,
    title: 'Other Company Role',
    url: 'https://jobs.example.test/roles/900123?utm_medium=test',
  }, ctx));
  check(
    canonicalConflict instanceof IdentityConflictError
      && canonicalConflict.conflicts.length === 1
      && canonicalConflict.conflicts[0].kind === 'canonical_url'
      && canonicalConflict.conflicts[0].value === 'https://jobs.example.test/roles/900123'
      && canonicalConflict.conflicts[0].existingId === first.id,
    'canonical URL at another company reports the existing posting conflict',
  );
  check(
    readEvents(store).length === beforeCanonicalConflict
      && store.db.prepare('SELECT COUNT(*) AS count FROM postings').get().count === 2,
    'cross-company canonical URL conflict writes nothing',
  );

  const noUrl = resolvePosting(store, { companyId: company.id, title: 'Example Sprocket Analyst' }, ctx);
  const noUrlAgain = resolvePosting(store, { companyId: company.id, title: 'Example Sprocket Analyst' }, ctx);
  const otherNoUrl = resolvePosting(store, { companyId: otherCompany.id, title: 'Example Sprocket Analyst' }, ctx);
  check(noUrl.created && !noUrlAgain.created && noUrl.id === noUrlAgain.id, 'URL-less matching title reuses the company posting');
  check(otherNoUrl.created && otherNoUrl.id !== noUrl.id, 'URL-less title at another company creates a posting');

  const eventCount = readEvents(store).length;
  check(addApplication(store, { id: 900101, postingId: first.id }, ctx) === '900101', 'valid application stores and returns its digit id');
  check(readEvents(store, { applicationId: '900101' }).filter(row => row.type === 'application_submitted').length === 1, 'valid application writes one application_submitted event');
  const duplicate = catches(() => addApplication(store, { id: '900102', postingId: first.id }, ctx));
  check(duplicate instanceof IdentityConflictError, 'second application for one posting throws');
  check(readEvents(store).length === eventCount + 1, 'duplicate application writes nothing');
  check(catches(() => addApplication(store, { id: '10x', postingId: distinctUrl.id }, ctx)) instanceof Error, 'non-digit application id throws');

  const personId = addPerson(store, {
    name: 'Trigger Example',
    emails: ['trigger@example.test'],
  }, ctx);
  const protectedWrites = [
    () => store.db.prepare('UPDATE people SET display_name = ? WHERE id = ?').run('Changed', personId),
    () => store.db.prepare('DELETE FROM people WHERE id = ?').run(personId),
    () => store.db.prepare("UPDATE person_identifiers SET value = ? WHERE person_id = ? AND kind = 'email'").run('changed@example.test', personId),
    () => store.db.prepare("DELETE FROM person_identifiers WHERE person_id = ? AND kind = 'email'").run(personId),
    () => store.db.prepare('UPDATE postings SET title = ? WHERE id = ?').run('Changed', first.id),
    () => store.db.prepare('DELETE FROM postings WHERE id = ?').run(first.id),
  ];
  check(protectedWrites.every(operation => /append-only/.test(String(catches(operation)?.message))), 'identity UPDATE and DELETE triggers reject direct writes');
  store.close();
}

{
  const store = openEventStore(join(dir, 'rollback.db'));
  const eventsBefore = readEvents(store).length;
  const failed = catches(() => addPerson(store, {
    name: 'Rollback Example',
    aliases: [{ source: 'unsupported', legacyId: '1' }],
  }, ctx));
  check(failed instanceof Error, 'a row failure after event insertion throws');
  check(readEvents(store).length === eventsBefore, 'row failure rolls back the inserted event');
  check(store.db.prepare('SELECT COUNT(*) AS count FROM people').get().count === 0, 'row failure rolls back identity rows');
  store.close();
}

{
  const store = openEventStore(join(dir, 'merge-rollback.db'));
  const fromId = addPerson(store, { name: 'Example Person Rollback From' }, ctx);
  const intoId = addPerson(store, { name: 'Example Person Rollback Into' }, ctx);
  const eventsBefore = readEvents(store).length;
  const failedMerge = catches(() => mergePeople(store, { fromId, intoId }, {
    ...ctx,
    occurred_on: '2030-02-30',
  }));
  check(/occurred_on/.test(String(failedMerge?.message)), 'an invalid merge event throws');
  check(
    readEvents(store).length === eventsBefore
      && store.db.prepare('SELECT COUNT(*) AS count FROM person_merges').get().count === 0,
    'a failed merge event writes no event or merge row',
  );
  store.close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
