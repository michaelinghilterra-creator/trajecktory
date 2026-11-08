import http from 'node:http';

// The first load after a start pays for reading every report header and building the read caches,
// about two seconds on a large tracker. Asking for the heavy reads once, right after the server is
// listening, moves that cost to before anyone opens the page.
export const PREWARM_PATHS = ['/api/applications', '/api/metrics/core', '/api/followups/stale', '/api/pipeline/inbox'];

function get({ host, port, path, token, timeoutMs }) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path, headers: { 'x-tjk-token': token }, timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

// One at a time, because the server is single threaded and a burst would only queue. Never throws:
// a failed warm-up costs nothing but the speed-up.
export async function prewarm({ port, token, host = '127.0.0.1', paths = PREWARM_PATHS, timeoutMs = 30000 } = {}) {
  let done = 0;
  let failed = 0;
  for (const path of paths) {
    if (await get({ host, port, path, token, timeoutMs })) done++;
    else failed++;
  }
  return { done, failed };
}
