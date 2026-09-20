/**
 * Read-only review builders (D-5 and D-9 wiring). Pure functions over data the caller has loaded.
 */

import { findStatusMismatches } from './employer-status.mjs';
import { validateOverride } from './override-evidence.mjs';

const REPLY_HEADER = /^### Reply logged \((\d{4})-(\d{2})-(\d{2})\)$/;
const SENTIMENT_TAIL = / \[(positive|negative|neutral)\]$/;
const LONG_DASH_SEPARATOR = ' \u2014 ';
const COLON_SEPARATOR = ': ';

function isRealDate(year, month, day) {
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

/**
 * A logged employer reply is a note whose first line is `### Reply logged (YYYY-MM-DD)`, whose second
 * line is `<sender>: <subject> [<sentiment>]` (older notes use a long dash instead of the colon), and
 * whose body follows a blank line. sent_on is the day the reply was logged, not the day it arrived.
 */
export function parseReplyNote(entry) {
  if (typeof entry?.text !== 'string') return null;
  const lines = entry.text.split('\n');
  const header = REPLY_HEADER.exec(lines[0]);
  if (!header) return null;
  const [year, month, day] = header.slice(1).map(Number);
  if (!isRealDate(year, month, day)) return null;

  let rest = (lines[1] ?? '').trim();
  const tail = SENTIMENT_TAIL.exec(rest);
  const sentiment = tail ? tail[1] : 'neutral';
  if (tail) rest = rest.slice(0, tail.index).trim();

  const colon = rest.indexOf(COLON_SEPARATOR);
  const dash = rest.indexOf(LONG_DASH_SEPARATOR);
  const candidates = [[colon, COLON_SEPARATOR], [dash, LONG_DASH_SEPARATOR]].filter(([at]) => at !== -1);
  let sender = '';
  let subject = rest;
  if (candidates.length) {
    const [at, separator] = candidates.reduce((first, next) => (next[0] < first[0] ? next : first));
    sender = rest.slice(0, at).trim();
    subject = rest.slice(at + separator.length).trim();
  }

  const blank = lines.findIndex((line, index) => index >= 2 && line.trim() === '');
  const body = blank === -1 ? '' : lines.slice(blank + 1).join('\n').trim();
  return { sent_on: `${header[1]}-${header[2]}-${header[3]}`, sender, subject, sentiment, body };
}

/** Map of application id to its logged employer replies, as messages for employer-status. */
export function repliesByApplication(notesByApp) {
  const byApp = new Map();
  for (const [appId, notes] of Object.entries(notesByApp ?? {})) {
    if (!Array.isArray(notes)) continue;
    const messages = [];
    for (const note of notes) {
      const parsed = parseReplyNote(note);
      if (!parsed) continue;
      messages.push({
        message_id: `note:${appId}:${note.timestamp ?? ''}`,
        direction: 'from_employer',
        subject: parsed.subject,
        body: parsed.body,
        sent_on: parsed.sent_on,
      });
    }
    if (messages.length) byApp.set(String(appId), messages);
  }
  return byApp;
}

/** D-5: applications set to No Response although an employer reply is on record. */
export function statusMismatchReport(applications, notesByApp) {
  const replies = repliesByApplication(notesByApp);
  const list = applications.map(app => ({
    id: app.id,
    status: app.status,
    messages: replies.get(String(app.id)) ?? [],
  }));
  const noResponse = list.filter(app => app.status === 'No Response');
  return {
    mismatches: findStatusMismatches(list),
    checked: noResponse.length,
    with_messages: noResponse.filter(app => app.messages.length > 0).length,
  };
}

/** D-9: interview overrides that do not cite evidence that resolves. */
export function overrideEvidenceGaps(interviewOverrides, resolve) {
  const entries = Array.isArray(interviewOverrides) ? interviewOverrides : [];
  const gaps = [];
  entries.forEach((entry, index) => {
    const named = entry?.appId !== undefined && entry?.appId !== '' && entry?.stage !== undefined && entry?.stage !== '';
    const verdict = validateOverride({
      event_id: named ? `${entry.appId}:${entry.stage}` : '',
      stage: entry?.stage,
      date: entry?.date,
      evidence_ref: entry?.evidence_ref,
    }, resolve);
    if (!verdict.ok) {
      gaps.push({ index, appId: entry?.appId, stage: entry?.stage, date: entry?.date, reason: verdict.reason });
    }
  });
  return { total: entries.length, ok: entries.length - gaps.length, gaps };
}
