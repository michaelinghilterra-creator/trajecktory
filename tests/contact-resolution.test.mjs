#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePeople } from '../dashboard-web/server/lib/contact-identity.mjs';

const li = 'https://www.linkedin.com/in/jane-example';
const signature = people => people.map(person => ({ refs: person.refs, matchedBy: person.matchedBy }));

let people = resolvePeople({ ta: [{ id: 1, first: 'Jane', last: 'Doe', linkedin: li }], referrals: [{ id: 2, name: 'Jane Doe', linkedin: li }] });
assert.deepEqual(people[0].refs, ['referral:2', 'ta:1']);
assert.equal(people[0].matchedBy, 'linkedinKey');

people = resolvePeople({ ta: [{ id: 1, linkedin: 'n/a' }], referrals: [{ id: 2, linkedin: 'n/a' }] });
assert.equal(people.length, 2);

people = resolvePeople({ ta: [{ id: 42 }], referrals: [{ id: 7, notes: 'Created FROM ta outreach #42 today' }] });
assert.equal(people.length, 1);
assert.equal(people[0].matchedBy, 'backref');
assert.equal(resolvePeople({ referrals: [{ id: 7, notes: 'from TA Outreach #404' }] }).length, 1);

people = resolvePeople({ ta: [{ id: 1, first: 'Sam', last: 'Lee', company: 'One' }], referrals: [{ id: 2, name: 'Sam Lee', where: '' }, { id: 3, name: 'Sam Lee', where: 'Two' }] });
assert.equal(people.length, 3);

people = resolvePeople({ ta: [{ id: 1 }], referrals: [{ id: 2 }], pins: { 'ta:1': { with: 'referral:2' } } });
assert.equal(people[0].matchedBy, 'pin');

people = resolvePeople({ ta: [{ id: 1, linkedin: li }], referrals: [{ id: 2, linkedin: li }], pins: { 'ta:1': { alone: true } } });
assert.equal(people.length, 2);

people = resolvePeople({ ta: [{ id: 1, linkedin: li }], referrals: [{ id: 2, linkedin: li }], influencers: [{ id: 3, linkedinUrl: li }], pins: { 'ta:1': { alone: true } } });
assert.deepEqual(people.map(person => person.refs), [['influencer:3', 'referral:2'], ['ta:1']]);

const input = { ta: [{ id: 2, linkedin: li }, { id: 1 }], referrals: [{ id: 4 }, { id: 3, linkedin: li }] };
const shuffled = { ta: [...input.ta].reverse(), referrals: [...input.referrals].reverse() };
assert.deepEqual(signature(resolvePeople(input)), signature(resolvePeople(shuffled)));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'contact-links-'));
process.env.TJK_DATA_DIR = sandbox;
const links = await import(`../dashboard-web/server/lib/contact-links.mjs?test=${Date.now()}`);
assert.deepEqual(links.readPins(), {});
fs.writeFileSync(path.join(sandbox, 'contact-links.json'), '');
assert.deepEqual(links.readPins(), {});
fs.writeFileSync(path.join(sandbox, 'contact-links.json'), '{broken');
assert.deepEqual(links.readPins(), {});

console.log('contact-resolution.test.mjs passed');
