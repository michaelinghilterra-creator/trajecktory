import { probePostingGone } from './ats-gone.mjs';
import { normalizeForMatch } from './scan-core.mjs';

const SEG = /^[A-Za-z0-9._%-]+$/;

function validToken(token) {
  return SEG.test(token) && !token.includes('..');
}

export function cleanSearchTitle(title) {
  if (typeof title !== 'string') return '';
  const withoutPrefix = title.trim().replace(/^Job Application for /i, '');
  return withoutPrefix.replace(/^(.*) at .+$/i, '$1').trim();
}

export async function findCurrentGreenhousePosting(
  url,
  title,
  { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {},
) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (!['job-boards.greenhouse.io', 'boards.greenhouse.io'].includes(parsed.hostname.toLowerCase())) {
    return null;
  }
  const match = parsed.pathname.match(/^\/([^/]+)\/jobs\/(\d+)\/?$/);
  if (!match) return null;
  const [, token, originalId] = match;
  if (!validToken(token)) return null;

  try {
    const response = await fetchImpl(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response?.status !== 200) return null;
    const body = await response.json();
    if (!Array.isArray(body?.jobs)) return null;
    const targetTitle = normalizeForMatch(cleanSearchTitle(title));
    const current = body.jobs.find((job) =>
      String(job?.id) !== originalId
      && normalizeForMatch(job?.title) === targetTitle);
    if (!current) return null;
    return `https://job-boards.greenhouse.io/${token}/jobs/${current.id}`;
  } catch {
    return null;
  }
}

export async function checkDiscoveredJobs(
  jobs,
  { probe = probePostingGone, findCurrent = findCurrentGreenhousePosting, concurrency = 4 } = {},
) {
  const input = Array.isArray(jobs) ? jobs : [];
  const results = new Array(input.length);
  const workerCount = Math.min(input.length, Math.max(1, Math.floor(concurrency) || 1));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < input.length) {
      const index = nextIndex++;
      const job = input[index];
      let outcome;
      try {
        outcome = await probe(job.url);
      } catch {
        results[index] = { kind: 'keep', job };
        continue;
      }

      if (outcome?.verdict !== 'gone') {
        results[index] = { kind: 'keep', job };
        continue;
      }

      let currentUrl = null;
      try {
        currentUrl = await findCurrent(job.url, job.title);
      } catch {
        currentUrl = null;
      }
      if (currentUrl) {
        results[index] = {
          kind: 'replaced',
          job: { ...job, url: currentUrl },
          replacement: { from: job.url, to: currentUrl, title: job.title },
        };
      } else {
        results[index] = { kind: 'closed', job: { ...job, reason: outcome?.reason } };
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const keep = [];
  const closed = [];
  const replaced = [];
  for (const result of results) {
    if (result.kind === 'closed') closed.push(result.job);
    else keep.push(result.job);
    if (result.kind === 'replaced') replaced.push(result.replacement);
  }
  return { keep, closed, replaced };
}
