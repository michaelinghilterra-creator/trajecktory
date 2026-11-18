export const MAX_KEEP_TALENT = 2;
export const MAX_KEEP_PRINCIPAL = 5;

const OUT_OF_SCOPE_EXECUTIVE_PHRASES = [
  'chief technology officer',
  'cto',
  'chief information officer',
  'cio',
  'chief information security officer',
  'ciso',
  'chief security officer',
  'chief product officer',
  'cpo',
  'chief design officer',
  'chief legal officer',
  'general counsel',
  'chief architect',
  'chief scientist',
  'chief data officer',
  'chief ai officer',
];

const OUT_OF_SCOPE_SENIORITY = ['vp', 'svp', 'evp', 'head', 'director', 'chief'];
const OUT_OF_SCOPE_FUNCTIONS = [
  'engineering',
  'data engineering',
  'security',
  'legal',
  'design',
  'infrastructure',
  'it',
  'information technology',
  'product',
];
const TARGET_FUNCTIONS = [
  'sales',
  'revenue',
  'marketing',
  'operations',
  'growth',
  'commercial',
  'customer',
  'partnerships',
];

function words(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function containsWholePhrase(value, phrase) {
  return ` ${words(value)} `.includes(` ${words(phrase)} `);
}

function sameCompany(left, right) {
  const normalize = value => String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
  return normalize(left) !== '' && normalize(left) === normalize(right);
}

export function cleanTitle(title, company) {
  let cleaned = String(title || '').replace(/\s+/g, ' ').trim();
  const lower = cleaned.toLowerCase();
  if (
    lower.includes('title not stated')
    || lower.includes('not stated')
    || /\bunknown\b/i.test(cleaned)
    || /\bn\/a\b/i.test(cleaned)
    || /^(leader hiring|person who|someone who)\b/i.test(cleaned)
    || /\shiring a\s/i.test(cleaned)
  ) return '';

  cleaned = cleaned.replace(/\s+(?:at|@)\s+.+$/i, '').trim();
  const companySuffix = cleaned.match(/^(.*)\s+(?:\||-)\s+(.+)$/);
  if (companySuffix && sameCompany(companySuffix[2], company)) {
    cleaned = companySuffix[1].trim();
  }
  return cleaned.length > 120 ? '' : cleaned;
}

export function isOutOfScopeExecutive(title) {
  if (TARGET_FUNCTIONS.some(phrase => containsWholePhrase(title, phrase))) return false;
  if (OUT_OF_SCOPE_EXECUTIVE_PHRASES.some(phrase => containsWholePhrase(title, phrase))) return true;

  const normalized = words(title);
  return OUT_OF_SCOPE_SENIORITY.some(seniority => OUT_OF_SCOPE_FUNCTIONS.some(func => (
    containsWholePhrase(normalized, `${seniority} ${func}`)
    || containsWholePhrase(normalized, `${seniority} of ${func}`)
  )));
}

export function buildLabelPrompt({ company, tier, exampleRole = '', people }) {
  const lines = people.map((person, index) => `${index + 1}. ${person.name} | ${person.headline} | ${person.snippet} | ${person.linkedin}`);
  return `Label the search results for ${company}. The requested tier is ${tier}. The example role is ${exampleRole || 'not supplied'}.

Judge only from the text given. current is true only when the headline or snippet shows ${company} as the present employer. A different company with the same or a similar name is other. Never add people who are not in the list. Never output a link.

People:
${lines.join('\n')}

Return ONLY a JSON array with one object per result you can label:
[{ "n": 1, "current": true, "tier": "talent", "title": "their title at the company", "confidence": "high", "reason": "one short line" }]

Allowed current values: true, false, "unknown".
Allowed tier values: "talent", "hm", "exec", "peer", "other".
Allowed confidence values: "high", "medium", "low".`;
}

function splitName(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return { first: parts.shift() || '', last: parts.join(' ') };
}

export function applyLabelsWithDrops({ people, labels, tier, maxKeep, classify, company = '' }) {
  const allowed = tier === 'principal' ? new Set(['hm', 'exec']) : new Set(['talent']);
  const rank = { high: 0, medium: 1, low: 2 };
  const dropped = [];
  const eligible = (Array.isArray(labels) ? labels : [])
    .map((label, order) => ({ label, order, person: people[Number(label?.n) - 1] }))
    .filter(({ label, person }) => person && label.current !== false && label.tier !== 'other' && allowed.has(label.tier))
    .map(({ label, order, person }) => {
      const title = cleanTitle(label.title || person.headline, company);
      let reason = '';
      if (!title) reason = 'no_title';
      else if (isOutOfScopeExecutive(title)) reason = 'out_of_scope';
      else if (classify && classify(title) === null) reason = 'unclassified';
      if (reason) {
        dropped.push({ name: String(person.name || '').replace(/\s+/g, ' ').trim(), reason });
        return null;
      }
      return { label, order, person, title };
    })
    .filter(Boolean)
    .sort((a, b) => (rank[a.label.confidence] ?? 3) - (rank[b.label.confidence] ?? 3) || a.order - b.order);

  const suggestions = eligible
    .slice(0, maxKeep)
    .map(({ label, person, title }) => {
      const { first, last } = splitName(person.name);
      return {
        first,
        last,
        title,
        city: '',
        state: '',
        linkedin: person.linkedin,
        confidence: ['high', 'medium', 'low'].includes(label.confidence) ? label.confidence : 'low',
        notes: String(label.reason || ''),
      };
    });
  return { suggestions, dropped };
}

export function applyLabels(options) {
  return applyLabelsWithDrops(options).suggestions;
}
