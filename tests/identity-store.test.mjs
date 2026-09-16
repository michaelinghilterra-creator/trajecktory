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
  resolveCompany,
  resolvePosting,
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
  const expected = ['applications', 'companies', 'company_keys', 'people', 'person_aliases', 'person_identifiers', 'postings'];
  check(store.db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'fresh store is at SCHEMA_VERSION 2');
  check(expected.every(table => tables.includes(table)), 'fresh store has all seven identity tables');
  store.close();
}

{
  const dbPath = join(dir, 'migration.db');
  const db = new DatabaseSync(dbPath);
  db.exec(MIGRATIONS[0]);
  db.prepare(`
    INSERT INTO events (type, occurred_on, recorded_at, source, payload, definitions_version)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('note_added', '2030-01-01', '2030-01-01T00:00:00.000Z', 'cli', '{}', 'test-v1');
  db.exec('PRAGMA user_version = 1');
  db.close();
  const store = openEventStore(dbPath);
  check(store.db.prepare('PRAGMA user_version').get().user_version === SCHEMA_VERSION, 'v1 database migrates to version 2');
  check(readEvents(store).length === 1, 'migration preserves an existing event');
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
