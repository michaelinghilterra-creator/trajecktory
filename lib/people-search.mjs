const TALENT_ROLES = [
  'recruiter',
  '"talent acquisition"',
  '"head of talent" OR "head of recruiting" OR "director of talent"',
  '"people partner" OR "HR business partner"',
];

const PRINCIPAL_ROLES = {
  revops: [
    '"revenue operations" OR "sales operations"',
    '"chief revenue officer" OR CRO',
    '"VP sales" OR "head of sales"',
    '"GTM" OR "go to market" director OR VP OR head',
    '"chief operating officer" OR "VP marketing"',
  ],
  salesdev: [
    '"VP sales"',
    '"sales development" VP OR head OR director',
    '"business development" VP OR head',
    '"chief revenue officer"',
    '"VP marketing"',
  ],
};

export const PEOPLE_QUERIES_PER_TIER = Object.freeze({ talent: 4, principal: 5 });

export function buildPeopleQueries({ company, tier, track = 'revops' }) {
  const roles = tier === 'principal'
    ? PRINCIPAL_ROLES[track === 'salesdev' ? 'salesdev' : 'revops']
    : TALENT_ROLES;
  return roles.map(role => `site:linkedin.com/in "${company}" ${role}`);
}

function truncate(value, length) {
  return String(value || '').trim().slice(0, length);
}

export function parseProfileHit({ url, title, description } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== 'https:' || !host.endsWith('.linkedin.com')) return null;
  const match = parsed.pathname.match(/^\/in\/([^/]+)\/?$/i);
  if (!match) return null;

  const cleanTitle = String(title || '').replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  const parts = cleanTitle.split(/\s+(?:-|\u2013|\u2014|\uFFFD\??)\s+/);
  const name = String(parts.shift() || '').trim();
  if (!/^[\p{L}][\p{L}'\u2019-]*(?:\s+[\p{L}][\p{L}'\u2019-]*)+$/u.test(name)) return null;

  return {
    linkedin: `https://www.linkedin.com/in/${match[1]}/`,
    name,
    headline: truncate(parts.join(' - '), 160),
    snippet: truncate(description, 300),
  };
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function collectPeople({
  company,
  tier,
  track,
  search,
  maxQueries,
  maxPeople = 40,
  // Each query is a different role. Without a per-query share the first query
  // fills the whole list and the later roles are never searched.
  maxPerQuery = 8,
  delayMs = 1100,
  sleep = defaultSleep,
}) {
  const queries = buildPeopleQueries({ company, tier, track });
  const limit = Number.isFinite(maxQueries) ? Math.max(0, Math.floor(maxQueries)) : queries.length;
  const selected = queries.slice(0, limit);
  const people = [];
  const seen = new Set();
  const errors = [];
  let queriesRun = 0;
  let failed = 0;
  let rateLimited = false;

  for (let index = 0; index < selected.length && people.length < maxPeople; index++) {
    const query = selected[index];
    try {
      queriesRun += 1;
      const hits = await search(query);
      let fromThisQuery = 0;
      for (const hit of Array.isArray(hits) ? hits : []) {
        const person = parseProfileHit(hit);
        if (!person || seen.has(person.linkedin)) continue;
        seen.add(person.linkedin);
        people.push(person);
        fromThisQuery += 1;
        if (people.length >= maxPeople || fromThisQuery >= maxPerQuery) break;
      }
    } catch (error) {
      failed += 1;
      const blocked = error?.status === 429 || /Brave API HTTP 429/.test(String(error?.message || error));
      errors.push({ query, error: String(error?.message || error), ...(blocked ? { rateLimited: true } : {}) });
      if (blocked) { rateLimited = true; break; }
    }
    if (index < selected.length - 1 && people.length < maxPeople && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  if (!rateLimited && selected.length > 0 && failed === selected.length) {
    const error = new Error(`people search failed: ${errors.map(item => item.error).join('; ')}`);
    error.queriesRun = queriesRun;
    throw error;
  }
  return { people, queriesRun, errors, ...(rateLimited ? { rateLimited: true } : {}) };
}

export function braveProfileSearch(key, { fetchFn = fetch } = {}) {
  return async query => {
    const response = await fetchFn(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=20`,
      {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': key,
        },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok) {
      const error = new Error(`Brave API HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    return (data.web?.results || []).map(result => ({
      url: result.url,
      title: result.title || '',
      description: result.description || '',
    }));
  };
}
