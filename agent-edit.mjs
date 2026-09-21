#!/usr/bin/env node

import { patchRowInMd, parseApplicationsMd } from './dashboard-web/server/lib/applications.mjs';
import { appendFollowupRow } from './dashboard-web/server/lib/followups.mjs';
import { ALL_STATUSES } from './dashboard-web/server/lib/statuses.mjs';
import { localToday } from './lib/local-date.mjs';

const HELP = `Usage:
  node agent-edit.mjs application --id <num> [--company <name>] [--status <status>] [--role <title>] [--note <text>] [--append-note <text>] [--event-date <YYYY-MM-DD>] [--json]
  node agent-edit.mjs followup --app <num> --date <YYYY-MM-DD> --company <name> --role <title> --channel <channel> --contact <text> [--note <text>] [--json]`;
const JSON_REQUESTED = process.argv.includes('--json');

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) return { help: true };
  const command = argv[0];
  if (!['application', 'followup'].includes(command)) throw new Error('First argument must be application or followup');
  const allowed = command === 'application'
    ? new Set(['--id', '--company', '--status', '--role', '--note', '--append-note', '--event-date'])
    : new Set(['--app', '--date', '--company', '--role', '--channel', '--contact', '--note']);
  const options = { command, json: false };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') { options.json = true; continue; }
    if (!allowed.has(arg)) throw new Error(`Unknown argument: ${arg}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
    options[arg.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return options;
}

function required(options, names) {
  const missing = names.filter(name => options[name] === undefined || options[name] === '');
  if (missing.length) throw new Error(`Required argument missing: ${missing.map(name => `--${name}`).join(', ')}`);
}

function printResult(options, value, human) {
  if (options.json) console.log(JSON.stringify(value));
  else console.log(human);
}

function validateDate(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${flag} must be a real calendar date in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${flag} must be a real calendar date in YYYY-MM-DD format`);
  }
  const today = localToday();
  if (value < '2000-01-01' || value > today) {
    throw new Error(`${flag} must be between 2000-01-01 and ${today}`);
  }
}

function runApplication(options) {
  required(options, ['id']);
  if (!/^\d+$/.test(options.id)) throw new Error('--id must be an integer');
  if (options.note !== undefined && options.appendNote !== undefined) throw new Error('--note and --append-note cannot be used together');
  if (options.status !== undefined && !ALL_STATUSES.includes(options.status)) {
    throw new Error(`--status must be one of: ${ALL_STATUSES.join(', ')}`);
  }
  if (options.eventDate !== undefined) validateDate(options.eventDate, '--event-date');
  const id = Number(options.id);
  const updates = {};
  if (options.status !== undefined) updates.status = options.status;
  if (options.role !== undefined) updates.role = options.role;
  if (options.note !== undefined) updates.notes = options.note;
  if (options.appendNote !== undefined) {
    const rows = parseApplicationsMd();
    const row = rows.find(item => item.id === id && (!options.company || item.company === options.company))
      || rows.find(item => item.id === id);
    if (!row) {
      printResult(options, { ok: false, command: 'application', id, error: 'not_found' }, `Application #${id} was not found.`);
      process.exitCode = 1;
      return;
    }
    updates.notes = row.notes ? `${row.notes}. ${options.appendNote}` : options.appendNote;
  }
  if (!Object.keys(updates).length) throw new Error('No application change requested');
  const found = patchRowInMd(id, updates, { company: options.company, eventDate: options.eventDate });
  if (!found) {
    printResult(options, { ok: false, command: 'application', id, error: 'not_found' }, `Application #${id} was not found.`);
    process.exitCode = 1;
    return;
  }
  const fields = Object.keys(updates).map(field => field === 'notes' ? 'note' : field);
  printResult(options, { ok: true, command: 'application', id, fields }, `Updated application #${id}: ${fields.join(', ')}.`);
}

function runFollowup(options) {
  required(options, ['app', 'date', 'company', 'role', 'channel', 'contact']);
  if (!/^\d+$/.test(options.app)) throw new Error('--app must be an integer');
  validateDate(options.date, '--date');
  const appNum = Number(options.app);
  const n = appendFollowupRow({
    appNum, date: options.date, company: options.company, role: options.role,
    channel: options.channel, contact: options.contact, notes: options.note || '',
  });
  printResult(options, { ok: true, command: 'followup', n, app: appNum }, `Added follow-up #${n} for application #${appNum}.`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
  } else if (options.command === 'application') runApplication(options);
  else runFollowup(options);
} catch (error) {
  if (JSON_REQUESTED) console.log(JSON.stringify({ ok: false, error: error.message }));
  else console.error(`agent-edit: ${error.message}`);
  process.exitCode = 1;
}
