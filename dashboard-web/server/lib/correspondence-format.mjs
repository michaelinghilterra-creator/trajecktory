// lib/correspondence-format.mjs: the on-disk format of a contact's message log,
// owned here and nowhere else. Both contact stores read and write through this.
//
// WHY THIS EXISTS
// The two stores each had their own regex for the same format, and the two
// disagreed in a way that under-counted outreach twice over. The referral parser
// was case-sensitive, so an entry written "SENT" did not match at all: the
// message was invisible to the timeline, the cap count, and last-touch. The
// target-talent parser was case-insensitive, so the same entry parsed, but its
// capture kept the original casing, and `outreachCapState` compares
// `direction === 'Sent'` exactly, so the touch was read and then not counted.
// Both made the app believe it had contacted someone less often than it had,
// which is the failure mode that leads to contacting a warm lead twice in a week.
//
// So the rule is: this module NORMALIZES, on read and on write. Direction is
// always one of Sent, Received, Draft. Channel is always Email or LinkedIn. A
// caller can neither read a variant spelling nor persist one.
//
// Eleven modules downstream compare `direction === 'Sent'` exactly, including the
// weekly touch floor and the TWC work-search log, so the normalization is
// load-bearing well beyond the queue. Measured before the change: zero entries in
// the live logs used a variant spelling, so this fixes nothing retroactively and
// prevents the whole class going forward. `report-correspondence-drift.mjs`
// re-checks that against real data on demand.
//
// Entry shape on disk:
//   ## YYYY-MM-DD[ HH:MM] | Direction | [Channel | ]Subject
//   <blank>
//   body, up to the next "## " or end of file
// The channel token is optional. Absent means Email, which is what legacy rows
// written before the column existed rely on.

const DIRECTIONS = new Map([
  ['sent', 'Sent'],
  ['received', 'Received'],
  ['draft', 'Draft'],
]);

function normalizeDirection(value) {
  return DIRECTIONS.get(String(value || '').trim().toLowerCase()) || '';
}

function normalizeChannel(value) {
  return /^linked\s?in$/i.test(String(value || '').trim()) ? 'LinkedIn' : 'Email';
}

export function parseCorrespondence(text) {
  const messages = [];
  const re = /^## (\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2})?) \| ([^|\r\n]+?) \| (?:(Email|Linked ?In) \| )?(.+?)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gim;
  let match;
  while ((match = re.exec(String(text || ''))) !== null) {
    const direction = normalizeDirection(match[2]);
    if (!direction) continue;   // unrecognized direction: skip, as both parsers did
    messages.push({
      timestamp: match[1],
      direction,
      channel: normalizeChannel(match[3]),
      subject: match[4].trim(),
      body: match[5].trim(),
    });
  }
  return messages;
}

// Normalizes on the way out as well as the way in. A caller that hands over
// `direction: 'SENT'` would otherwise write that spelling straight back to disk,
// re-creating the exact variant this module exists to eliminate. An unrecognized
// direction falls back to Draft, the only one of the three that is inert: it is
// not outbound, so it can neither satisfy nor trip an outreach guardrail. Guessing
// Sent there would fabricate a touch the user never made.
export function formatCorrespondence(messages) {
  return (Array.isArray(messages) ? messages : []).map(message => {
    const direction = normalizeDirection(message.direction) || 'Draft';
    // Only LinkedIn is written; Email is the implied default and stays absent, so
    // the file keeps the shape legacy rows already have.
    const channel = normalizeChannel(message.channel) === 'LinkedIn' ? 'LinkedIn | ' : '';
    return `## ${message.timestamp} | ${direction} | ${channel}${message.subject}\n\n${message.body}\n`;
  }).join('\n');
}
