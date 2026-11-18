export const RATE_LIMIT_SKIP_REASON = 'rate limited, try again later';

export async function runEmailLookupBatch(rows, lookup, { concurrency = 6 } = {}) {
  const results = new Array(rows.length);
  let next = 0;
  let rateLimited = null;
  const worker = async () => {
    while (next < rows.length) {
      if (rateLimited) break;
      const index = next++;
      const row = rows[index];
      try {
        results[index] = { row, value: await lookup(row) };
      } catch (error) {
        const paused = / paused for this run:/.test(error?.message || '');
        if (error?.status === 429 || paused) {
          rateLimited ||= error?.service || String(error?.message || '').split(' paused')[0];
          results[index] = { row, skipped: true, reason: RATE_LIMIT_SKIP_REASON };
        } else {
          results[index] = { row, error: String(error?.message || error) };
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length || 1) }, worker));
  if (rateLimited) {
    for (let index = 0; index < rows.length; index++) {
      if (!results[index]) results[index] = { row: rows[index], skipped: true, reason: RATE_LIMIT_SKIP_REASON };
    }
  }
  return { results: results.filter(Boolean), rateLimited };
}
