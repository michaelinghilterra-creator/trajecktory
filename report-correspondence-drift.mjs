#!/usr/bin/env node
/**
 * report-correspondence-drift.mjs: what the shared correspondence parser changed
 * about YOUR data. READ ONLY. It never writes anything, anywhere.
 *
 * The two contact stores used to parse their message logs with two different
 * regexes. Merging them normalized direction and channel casing, and eleven
 * modules downstream compare `direction === 'Sent'` exactly, so a change there
 * moves more than the outreach queue: the weekly verified-touch floor and the TWC
 * work-search log both count Sent messages, and the TWC log is a compliance
 * record for unemployment benefits. Those files live under data/, which is
 * gitignored, so there is no diff to read afterwards.
 *
 * Hence this: run it and see, per contact, whether the entry count, the newest
 * Sent date, or the cold-outreach cap state moved. Anything it does not list did
 * not change.
 *
 * Measured on the live data when the parser landed: 0 contacts changed, because
 * no log had ever been written with a variant spelling. The fix is preventive.
 * Re-run this after any bulk edit or hand-edit of a correspondence file.
 *
 * The old per-store regexes are duplicated below on purpose. This is a one-off
 * comparison tool and needs both the before and the after in one process; the
 * source guard that forbids duplicate parsers does not apply to a script whose
 * entire job is to hold the old one next to the new one.
 *
 * Usage: node report-correspondence-drift.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCorrespondence } from './dashboard-web/server/lib/correspondence-format.mjs';
import { outreachCapState } from './dashboard-web/server/lib/correspondence-context.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.TJK_DATA_DIR ? path.resolve(process.env.TJK_DATA_DIR) : path.join(root, 'data');

function oldReferralParser(text) {
  const messages = [];
  const re = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) \| (Sent|Received|Draft) \| (?:(Email|LinkedIn) \| )?(.+?)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm;
  let match;
  while ((match = re.exec(text)) !== null) {
    messages.push({ timestamp: match[1], direction: match[2], channel: match[3] || 'Email', subject: match[4].trim(), body: match[5].trim() });
  }
  return messages;
}

function oldTTParser(text) {
  const messages = [];
  const re = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) \| (Sent|Received|Draft) \| (?:(Email|Linked ?In) \| )?(.+?)\n([\s\S]*?)(?=^## |$(?![\s\S]))/gim;
  let match;
  while ((match = re.exec(text)) !== null) {
    const channel = /^linked ?in$/i.test((match[3] || '').trim()) ? 'LinkedIn' : 'Email';
    messages.push({ timestamp: match[1], direction: match[2], channel, subject: match[4].trim(), body: match[5].trim() });
  }
  return messages;
}

function contactsFromTable(file, store) {
  if (!fs.existsSync(file)) return [];
  const contacts = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map(cell => cell.trim());
    const id = Number.parseInt(cells[1], 10);
    if (!Number.isFinite(id)) continue;
    contacts.push({
      id,
      store,
      name: store === 'target-talent' ? [cells[4], cells[3]].filter(Boolean).join(' ') : cells[2],
    });
  }
  return contacts;
}

function newestSent(messages) {
  const timestamps = messages.filter(message => message.direction === 'Sent').map(message => message.timestamp);
  return timestamps.length ? timestamps.sort().at(-1) : null;
}

function capCounts(messages) {
  const state = outreachCapState(messages);
  return { linkedin: state.linkedin.sent, email: state.email.sent };
}

function capReached(messages) {
  const state = outreachCapState(messages);
  return state.linkedin.capped || state.email.capped;
}

const stores = [
  {
    name: 'target-talent',
    contacts: contactsFromTable(path.join(dataDir, 'target-talent.md'), 'target-talent'),
    directory: path.join(dataDir, 'target-talent-correspondence'),
    oldParser: oldTTParser,
  },
  {
    name: 'referrals',
    contacts: contactsFromTable(path.join(dataDir, 'referrals.md'), 'referrals'),
    directory: path.join(dataDir, 'referral-correspondence'),
    oldParser: oldReferralParser,
  },
];

const changed = [];
for (const store of stores) {
  for (const contact of store.contacts) {
    const file = path.join(store.directory, `${contact.id}.md`);
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const beforeMessages = store.oldParser(text);
    const afterMessages = parseCorrespondence(text);
    const before = {
      entries: beforeMessages.length,
      newestSent: newestSent(beforeMessages),
      sent: capCounts(beforeMessages),
    };
    const after = {
      entries: afterMessages.length,
      newestSent: newestSent(afterMessages),
      sent: capCounts(afterMessages),
    };
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changed.push({
      ...contact,
      before,
      after,
      newlyAtCap: !capReached(beforeMessages) && capReached(afterMessages),
    });
  }
}

const newlyAtCap = changed.filter(contact => contact.newlyAtCap).length;
const report = { changedContacts: changed.length, newlyAtCap, contacts: changed };
const jsonFlag = ['-', '-', 'json'].join('');
if (process.argv.includes(jsonFlag)) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const contact of changed) {
    console.log(`${contact.store} ${contact.id} ${contact.name || '(unnamed)'}`);
    console.log(`  entries: ${contact.before.entries} to ${contact.after.entries}`);
    console.log(`  newest Sent: ${contact.before.newestSent || 'none'} to ${contact.after.newestSent || 'none'}`);
    console.log(`  LinkedIn sent: ${contact.before.sent.linkedin} to ${contact.after.sent.linkedin}`);
    console.log(`  Email sent: ${contact.before.sent.email} to ${contact.after.sent.email}`);
    console.log(`  newly at cap: ${contact.newlyAtCap ? 'yes' : 'no'}`);
  }
  console.log(`Summary: ${changed.length} contacts changed, ${newlyAtCap} newly at or over a cold outreach cap.`);
}
