export const ATS_SITE_RE = /greenhouse\.io|ashbyhq\.com|lever\.co/i;

const DEFAULT_SITES = [
  'job-boards.greenhouse.io',
  'jobs.ashbyhq.com',
  'jobs.lever.co',
];
const MAX_QUERY_CHARS = 380;
const MAX_QUERY_WORDS = 45;

function cleanList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const cleaned = String(value || '').trim().replace(/\s+/g, ' ');
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function withinCaps(query) {
  return query.length <= MAX_QUERY_CHARS && query.split(/\s+/).length <= MAX_QUERY_WORDS;
}

function queriesForFunction(site, fn, seniority) {
  const prefix = `site:${site}`;
  const alternatives = seniority.flatMap(level => [
    `"${level} of ${fn}"`,
    `"${level} ${fn}"`,
  ]);
  const queries = [];
  let current = '';

  for (const alternative of alternatives) {
    const candidate = current
      ? `${prefix} ${current} OR ${alternative}`
      : `${prefix} ${alternative}`;
    if (withinCaps(candidate)) {
      current = current ? `${current} OR ${alternative}` : alternative;
      continue;
    }
    if (current) queries.push(`${prefix} ${current}`);
    current = alternative;
  }
  if (current) queries.push(`${prefix} ${current}`);
  return queries.filter(withinCaps);
}

export function generateQueries(titleFilter, { sites = DEFAULT_SITES } = {}) {
  const matrix = titleFilter?.matrix;
  if (!matrix) return [];
  const seniority = cleanList(matrix.seniority);
  const functions = cleanList([
    ...(matrix.functions_bare || []),
    ...(matrix.functions_ranked || []),
  ]);
  const queries = [];
  for (const site of cleanList(sites)) {
    for (const fn of functions) queries.push(...queriesForFunction(site, fn, seniority));
  }
  return cleanList(queries);
}

export function buildPool(portals) {
  const configured = (portals?.search_queries || [])
    .filter(item => item && item.enabled !== false && item.query && ATS_SITE_RE.test(item.query))
    .map(item => item.query);
  return cleanList([...generateQueries(portals?.title_filter), ...configured]);
}

export function nextSlice(pool, cursor, perRun) {
  const total = pool.length;
  if (!total) return { queries: [], nextCursor: 0, from: 0, to: 0, total: 0 };

  const start = Number.isInteger(cursor) && cursor >= 0 ? cursor % total : 0;
  const requested = Number.isFinite(Number(perRun)) ? Math.floor(Number(perRun)) : 0;
  const count = Math.min(total, Math.max(0, requested));
  const queries = Array.from({ length: count }, (_, index) => pool[(start + index) % total]);
  const nextCursor = (start + count) % total;
  const to = count ? ((start + count - 1) % total) + 1 : start + 1;
  return { queries, nextCursor, from: start + 1, to, total };
}
