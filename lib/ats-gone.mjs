const SEG = /^[A-Za-z0-9._%-]+$/;

function validSegment(value) {
  return typeof value === 'string' && SEG.test(value) && !value.includes('..');
}

function failureReason(ats, error) {
  const name = String(error?.name || '');
  if (name === 'TimeoutError' || name === 'AbortError') return `${ats}: request timed out`;
  const message = String(error?.message || error || 'unknown error').replace(/[\r\n]+/g, ' ').trim();
  return `${ats}: request failed${message ? ` (${message})` : ''}`;
}

async function request(url, ats, fetchImpl, timeoutMs) {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const status = Number(response?.status);
    if (!Number.isFinite(status)) return { error: `${ats}: invalid response` };
    return { response, status };
  } catch (error) {
    return { error: failureReason(ats, error) };
  }
}

export async function probePostingGone(url, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
  let raw;
  try {
    raw = String(url || '').trim();
  } catch {
    return { verdict: 'unknown', reason: 'unrecognized url' };
  }
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { verdict: 'unknown', reason: 'unrecognized url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { verdict: 'unknown', reason: 'unrecognized url' };
  }

  const greenhouse = raw.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (greenhouse) {
    const [, token, id] = greenhouse;
    if (!validSegment(token) || !validSegment(id)) return { verdict: 'unknown', reason: 'unrecognized url' };
    const result = await request(`https://boards-api.greenhouse.io/v1/boards/${token}/jobs/${id}`, 'greenhouse', fetchImpl, timeoutMs);
    if (result.error) return { verdict: 'unknown', reason: result.error };
    if (result.status === 200) return { verdict: 'live', reason: 'greenhouse: job found (200)' };
    if (result.status === 404) return { verdict: 'gone', reason: 'greenhouse: job removed (404)' };
    return { verdict: 'unknown', reason: `greenhouse: unexpected status ${result.status}` };
  }

  const lever = raw.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{16,})/i);
  if (lever) {
    const [, token, id] = lever;
    if (!validSegment(token) || !validSegment(id)) return { verdict: 'unknown', reason: 'unrecognized url' };
    const result = await request(`https://api.lever.co/v0/postings/${token}/${id}`, 'lever', fetchImpl, timeoutMs);
    if (result.error) return { verdict: 'unknown', reason: result.error };
    if (result.status === 200) return { verdict: 'live', reason: 'lever: job found (200)' };
    if (result.status === 404) return { verdict: 'gone', reason: 'lever: job removed (404)' };
    return { verdict: 'unknown', reason: `lever: unexpected status ${result.status}` };
  }

  const ashby = raw.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{16,})/i);
  if (ashby) {
    const [, slug, id] = ashby;
    if (!validSegment(slug) || !validSegment(id)) return { verdict: 'unknown', reason: 'unrecognized url' };
    const result = await request(`https://api.ashbyhq.com/posting-api/job-board/${slug}`, 'ashby', fetchImpl, timeoutMs);
    if (result.error) return { verdict: 'unknown', reason: result.error };
    if (result.status === 404) return { verdict: 'gone', reason: 'ashby: board removed (404)' };
    if (result.status !== 200) return { verdict: 'unknown', reason: `ashby: unexpected status ${result.status}` };
    try {
      const body = await result.response.json();
      if (!Array.isArray(body?.jobs)) return { verdict: 'unknown', reason: 'ashby: invalid board response' };
      const target = id.toLowerCase();
      const present = body.jobs.some((job) =>
        String(job?.id || '').toLowerCase() === target
        || String(job?.jobUrl || '').toLowerCase().includes(target));
      return present
        ? { verdict: 'live', reason: 'ashby: job found on board' }
        : { verdict: 'gone', reason: 'ashby: not on the board' };
    } catch (error) {
      return { verdict: 'unknown', reason: failureReason('ashby', error) };
    }
  }

  return { verdict: 'unknown', reason: 'no ATS probe for this host' };
}
