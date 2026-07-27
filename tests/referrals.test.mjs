#!/usr/bin/env node
/**
 * referrals.test.mjs — server/lib/referrals.mjs (the Referrals tracker store).
 * Hermetic: points TJK_DATA_DIR at a temp dir so it exercises the real write
 * paths without touching the user's data/referrals.md.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tjk-referrals-'));
process.env.TJK_DATA_DIR = tmp;

// Import AFTER setting the env so config.mjs resolves REFERRALS_MD into the temp dir.
const { parseReferralsMd, appendReferralRows, updateReferralLine, deleteReferralLine, REFERRAL_STATUSES } =
  await import('../dashboard-web/server/lib/referrals.mjs');

let n = 0;
const ok = (m) => { n++; console.log('  ok ' + m); };

// The ladder loaded from states.yml, not a hardcoded copy.
assert.ok(REFERRAL_STATUSES.includes('Not Asked'));
assert.ok(REFERRAL_STATUSES.includes('Applied w/ Referral'));
ok('statuses derive from states.yml (Not Asked .. Applied w/ Referral)');

// empty file -> empty list
assert.deepEqual(parseReferralsMd(), []);
ok('parse: missing file -> []');

// append assigns sequential ids and defaults an unknown/blank status to Not Asked
const [a] = appendReferralRows([{ name: 'Alex Rivera', how: 'Acme Corp, 2015-2019', target: 'Globex RevOps' }]);
const [b] = appendReferralRows([{ name: 'Sam Doe', status: 'bogus-status' }]);
assert.equal(a.id, 1);
assert.equal(b.id, 2);
let rows = parseReferralsMd();
assert.equal(rows.length, 2);
assert.equal(rows[0].name, 'Alex Rivera');
assert.equal(rows[0].status, 'Not Asked');
assert.equal(rows[1].status, 'Not Asked'); // invalid status coerced
ok('append: sequential ids, invalid status coerced to Not Asked');

// pipes in free text can never break the row layout
appendReferralRows([{ name: 'Pipe | Person', notes: 'a | b | c' }]);
rows = parseReferralsMd();
const piped = rows.find(r => r.id === 3);
assert.ok(piped, 'piped row parses back');
assert.ok(!piped.name.includes('|'), 'pipe neutralized in name');
ok('append: pipes in free text neutralized, row still parses');

// update a mutable cell; a valid status advances
assert.equal(updateReferralLine(1, { status: 'Asked', lastTouch: '2026-07-26', notes: 'sent reconnect' }), true);
rows = parseReferralsMd();
const updated = rows.find(r => r.id === 1);
assert.equal(updated.status, 'Asked');
assert.equal(updated.lastTouch, '2026-07-26');
assert.equal(updated.notes, 'sent reconnect');
ok('update: status / lastTouch / notes persist');

// updating a non-existent id touches nothing
assert.equal(updateReferralLine(999, { status: 'Asked' }), false);
ok('update: unknown id -> false');

// delete removes exactly one row, leaves the rest intact
assert.equal(deleteReferralLine(2), true);
rows = parseReferralsMd();
assert.equal(rows.length, 2);
assert.ok(!rows.some(r => r.id === 2));
assert.ok(rows.some(r => r.id === 1) && rows.some(r => r.id === 3));
ok('delete: removes one row, others intact');

assert.equal(deleteReferralLine(2), false);
ok('delete: already-gone id -> false');

// next id after a delete is still monotonic (max + 1, never reuses 2)
const [c] = appendReferralRows([{ name: 'New Person' }]);
assert.equal(c.id, 4);
ok('append after delete: id is max+1, never reused');

console.log(`\n  ${n} referrals checks passed`);
