/**
 * Pure derivation and added-line scanning for verify-pii-blindspots.mjs.
 *
 * This module is tracked. It therefore contains no personal value as a literal.
 * Every sensitive term arrives through an argument and every reported term is
 * masked before it leaves this module.
 */

// This list is a precision boundary, not a vocabulary exercise. Without it,
// table header cells became "real names" and matched nearly every file in the
// repository. Generic English and code words must never become evidence.
const COMMON_WORDS = Object.freeze(new Set([
  'first', 'last', 'name', 'field', 'page', 'daily', 'max', 'min', 'good',
  'best', 'green', 'red', 'block', 'array', 'arch', 'engine', 'place',
  'render', 'fetch', 'toast', 'honor', 'outreach', 'match', 'test', 'check',
  'value', 'data', 'type', 'list', 'item', 'note', 'file', 'line', 'code',
  'true', 'false', 'null', 'undefined', 'string', 'number', 'object', 'error',
  'state', 'source', 'target', 'company', 'role', 'status', 'date', 'time',
  'day', 'week', 'month', 'year', 'partner', 'people', 'talent', 'search',
  'sales', 'revenue', 'marketing', 'finance', 'director', 'manager', 'head',
  'chief', 'officer', 'president', 'vice', 'operations', 'analytics',
  'recruiter', 'recruiting', 'acquisition', 'executive', 'senior', 'lead',
  'principal', 'agency', 'peer', 'exec',
]));

const EMAIL_RX = /\b[\w.+-]+@[\w.-]+\.\w{2,}\b/g;
const PHONE_RX = /(?:\+?\d[\d().\s-]{7,}\d)/g;

function cleanCell(value) {
  return String(value ?? '').trim();
}

function tableCells(line) {
  if (!line.startsWith('| ')) return null;
  if (/^\|\s*:?-{3,}/.test(line)) return null;
  return line.split('|').map(cleanCell);
}

function isDataRow(cells) {
  return cells && /^\d+$/.test(cells[1] || '');
}

function addDistinctive(set, value, kind) {
  const clean = cleanCell(value);
  if (isDistinctive(clean, kind)) set.add(clean);
}

function addContactBookTerms(text, people, companies, titles) {
  for (const line of text.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (!isDataRow(cells)) continue;
    const last = cells[3];
    const first = cells[4];
    if (first && last) people.add(`${first} ${last}`);
    addDistinctive(companies, cells[2], 'company');
    addDistinctive(titles, cells[6], 'title');
  }
}

function addApplicationTerms(text, companies, titles) {
  for (const line of text.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (!isDataRow(cells)) continue;
    addDistinctive(companies, cells[3], 'company');
    addDistinctive(titles, cells[4], 'title');
  }
}

function addReferralTerms(text, people, companies, titles) {
  for (const line of text.split(/\r?\n/)) {
    const cells = tableCells(line);
    if (!isDataRow(cells)) continue;
    const words = (cells[2] || '').split(/\s+/).filter(Boolean);
    if (words.length >= 2) people.add(words.slice(0, 2).join(' '));
    addDistinctive(companies, cells[4], 'company');
    addDistinctive(titles, cells[5], 'title');
  }
}

function normalizePhone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function addContactValues(text, phones, emails) {
  for (const match of text.matchAll(PHONE_RX)) {
    const normalized = normalizePhone(match[0]);
    if (normalized) phones.add(normalized);
  }
  for (const match of text.matchAll(EMAIL_RX)) emails.add(match[0].toLowerCase());
}

export function isDistinctive(value, kind) {
  const clean = cleanCell(value);
  if (clean.length < 5) return false;
  const words = clean.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  if (!words.length) return false;
  if (kind === 'title' && words.length < 3) return false;
  return !words.every(word => COMMON_WORDS.has(word));
}

export function deriveTerms(sources) {
  const input = {
    profile: String(sources?.profile ?? ''),
    cv: String(sources?.cv ?? ''),
    apps: String(sources?.apps ?? ''),
    targetTalent: String(sources?.targetTalent ?? ''),
    referrals: String(sources?.referrals ?? ''),
  };
  const terms = {
    identity: new Set(),
    people: new Set(),
    companies: new Set(),
    titles: new Set(),
    phones: new Set(),
    emails: new Set(),
    derivedFrom: Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, value.trim().length > 0]),
    ),
  };

  for (const match of input.profile.matchAll(/^\s*(?:full_name|name):\s*["']?([^"'\n#]+)/gm)) {
    const value = match[1].trim();
    if (!value) continue;
    terms.identity.add(value);
    for (const part of value.split(/\s+/)) {
      if (part.length > 2) terms.identity.add(part);
    }
  }

  addContactBookTerms(input.targetTalent, terms.people, terms.companies, terms.titles);
  addApplicationTerms(input.apps, terms.companies, terms.titles);
  addReferralTerms(input.referrals, terms.people, terms.companies, terms.titles);
  for (const text of Object.values(input)) addContactValues(text, terms.phones, terms.emails);
  return terms;
}

export function maskValue(value) {
  const text = String(value ?? '');
  if (text.length < 4) return '***';
  return `${text[0]}${'*'.repeat(text.length - 2)}${text.at(-1)}`;
}

function escaped(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wholeWordMatch(line, value) {
  const pattern = `(?<![\\p{L}\\p{N}_])${escaped(value)}(?![\\p{L}\\p{N}_])`;
  return new RegExp(pattern, 'iu').test(line);
}

function rangesFor(line, pattern, capture = 0) {
  return [...line.matchAll(pattern)].map(match => {
    const value = match[capture];
    const start = match.index + match[0].indexOf(value);
    return { start, end: start + value.length };
  });
}

function rangeContains(ranges, start, end) {
  return ranges.some(range => start >= range.start && end <= range.end);
}

function ignoredEncodedRun(run, start, urlRanges, markdownTargetRanges) {
  const end = start + run.length;
  if (rangeContains(urlRanges, start, end)) return true;

  // A lowercase 40 character hex value is a git object id often printed in
  // changelog links. Short hex values in markdown targets are its abbreviated
  // form. A real credential can have the same 40 hex shape, but accepting that
  // blind spot here is deliberate: credential scanning is not this module's
  // job. verify-no-pii.mjs applies SECRET_PATTERNS to every tracked file and is
  // the tool responsible for catching keys without making this checker noisy.
  if (/^[0-9a-f]{40}$/.test(run)) return true;
  return /^[0-9a-fA-F]{7,12}$/.test(run)
    && rangeContains(markdownTargetRanges, start, end);
}

function termMatches(text, terms) {
  const hits = [];
  for (const term of terms.identity) {
    if (wholeWordMatch(text, term)) hits.push(['identity', term]);
  }
  for (const term of terms.people) {
    if (wholeWordMatch(text, term)) hits.push(['person', term]);
  }
  const lower = text.toLowerCase();
  for (const term of terms.companies) {
    if (lower.includes(term.toLowerCase())) hits.push(['company', term]);
  }
  for (const term of terms.titles) {
    if (lower.includes(term.toLowerCase())) hits.push(['title', term]);
  }
  for (const match of text.matchAll(PHONE_RX)) {
    const normalized = normalizePhone(match[0]);
    if (normalized && terms.phones.has(normalized)) hits.push(['phone', normalized]);
  }
  for (const term of terms.emails) {
    if (lower.includes(term.toLowerCase())) hits.push(['email', term]);
  }
  return hits;
}

// Decoded text only counts when it reads as text. Random bytes decoded from a
// hash or an asset id are mostly unprintable, which keeps this pass quiet.
function readableText(buffer) {
  if (buffer.length < 4) return null;
  const text = buffer.toString('utf8');
  if (text.includes('�')) return null;
  const printable = [...text].filter(ch => /[\p{L}\p{N}\p{P}\p{S}\p{Zs}\t\r\n]/u.test(ch)).length;
  return printable / [...text].length >= 0.9 ? text : null;
}

export function decodeEncodedRuns(text) {
  const decoded = [];
  // A slash is a base64 character and a path separator, so a URL path reads as
  // one long run. Each slash-separated segment is tried on its own as well.
  const runs = new Set();
  for (const match of String(text).matchAll(/[A-Za-z0-9+/_-]{12,}={0,2}/g)) {
    runs.add(match[0]);
    for (const segment of match[0].split('/')) {
      if (segment.length >= 12) runs.add(segment);
    }
  }
  for (const run of runs) {
    if (/^[0-9a-fA-F]+$/.test(run) && run.length % 2 === 0 && run.length >= 16) {
      const hex = readableText(Buffer.from(run, 'hex'));
      if (hex) decoded.push({ via: 'hex', text: hex });
    }
    const body = run.replace(/=+$/, '');
    if (body.length % 4 === 1) continue;
    const b64 = readableText(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    if (b64) decoded.push({ via: 'base64', text: b64 });
  }
  return decoded;
}

export function scanAddedLines(addedLines, terms) {
  const findings = [];
  const findingKeys = new Set();
  const checked = {
    identity: terms.identity.size,
    people: terms.people.size,
    companies: terms.companies.size,
    titles: terms.titles.size,
    phones: terms.phones.size,
    emails: terms.emails.size,
    encoded: 0,
  };
  const add = (kind, entry, term, via = null) => {
    const key = JSON.stringify([entry.file, entry.line, kind, term, via]);
    if (findingKeys.has(key)) return;
    findingKeys.add(key);
    const finding = {
      kind,
      file: entry.file,
      line: entry.line,
      fixture: entry.line,
      maskedTerm: term === null ? null : maskValue(term),
    };
    if (via) finding.via = via;
    findings.push(finding);
  };

  for (const entry of addedLines) {
    const line = String(entry.line ?? '');
    for (const [kind, term] of termMatches(line, terms)) add(kind, entry, term);

    // Real values hidden in encoded text. A decoded match is precise evidence,
    // so it ignores the URL and git id exemptions below: a real value inside an
    // encoded URL segment still ships. Two levels catch base64 of base64.
    for (const first of decodeEncodedRuns(line)) {
      for (const [kind, term] of termMatches(first.text, terms)) add(kind, entry, term, first.via);
      for (const second of decodeEncodedRuns(first.text)) {
        for (const [kind, term] of termMatches(second.text, terms)) add(kind, entry, term, `${first.via}+${second.via}`);
      }
    }

    // Public URLs routinely contain opaque path segments that resemble encoded
    // data. They are links, not concealed values shipped in the surrounding
    // source, so treating their contents as evidence creates release noise.
    const urlRanges = rangesFor(line, /https?:\/\/[^\s<>"']+/gi);
    const markdownTargetRanges = rangesFor(line, /\]\(([^\s)>]+)(?:\s+[^)]*)?\)/g, 1);
    const encodedMatches = [
      ...line.matchAll(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g),
      ...line.matchAll(/\b[0-9a-fA-F]{32,}\b/g),
    ].sort((left, right) => left.index - right.index);
    for (const match of encodedMatches) {
      if (!ignoredEncodedRun(match[0], match.index, urlRanges, markdownTargetRanges)) {
        add('encoded', entry, null);
      }
    }
  }

  return { findings, checked };
}
