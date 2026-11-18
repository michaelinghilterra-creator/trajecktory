export const MAX_KEEP_TALENT = 2;
export const MAX_KEEP_PRINCIPAL = 5;

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

export function applyLabels({ people, labels, tier, maxKeep }) {
  const allowed = tier === 'principal' ? new Set(['hm', 'exec']) : new Set(['talent']);
  const rank = { high: 0, medium: 1, low: 2 };
  return (Array.isArray(labels) ? labels : [])
    .map((label, order) => ({ label, order, person: people[Number(label?.n) - 1] }))
    .filter(({ label, person }) => person && label.current !== false && label.tier !== 'other' && allowed.has(label.tier))
    .sort((a, b) => (rank[a.label.confidence] ?? 3) - (rank[b.label.confidence] ?? 3) || a.order - b.order)
    .slice(0, maxKeep)
    .map(({ label, person }) => {
      const { first, last } = splitName(person.name);
      return {
        first,
        last,
        title: String(label.title || person.headline || ''),
        city: '',
        state: '',
        linkedin: person.linkedin,
        confidence: ['high', 'medium', 'low'].includes(label.confidence) ? label.confidence : 'low',
        notes: String(label.reason || ''),
      };
    });
}
