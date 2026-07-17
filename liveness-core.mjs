const HARD_EXPIRED_PATTERNS = [
  /job (is )?no longer available/i,
  /job.*no longer open/i,
  /position has been filled/i,
  /this job has expired/i,
  /job posting has expired/i,
  /no longer accepting applications/i,
  /this (position|role|job) (is )?no longer/i,
  /this job (listing )?is closed/i,
  /job (listing )?not found/i,
  /the page you are looking for doesn.t exist/i,
  /diese stelle (ist )?(nicht mehr|bereits) besetzt/i,
  /offre (expirée|n'est plus disponible)/i,
];

const LISTING_PAGE_PATTERNS = [
  /\d+\s+jobs?\s+found/i,
  /search for jobs page is loaded/i,
];

const EXPIRED_URL_PATTERNS = [
  /[?&]error=true/i,
];

const APPLY_PATTERNS = [
  /\bapply\b/i,
  /\bsolicitar\b/i,
  /\bbewerben\b/i,
  /\bpostuler\b/i,
  /submit application/i,
  /easy apply/i,
  /start application/i,
  /ich bewerbe mich/i,
];

const MIN_CONTENT_CHARS = 300;

function firstMatch(patterns, text = '') {
  return patterns.find((pattern) => pattern.test(text));
}

function hasApplyControl(controls = []) {
  return controls.some((control) => APPLY_PATTERNS.some((pattern) => pattern.test(control)));
}

export function classifyLiveness({ status = 0, finalUrl = '', bodyText = '', applyControls = [] } = {}) {
  if (status === 404 || status === 410) {
    return { result: 'expired', reason: `HTTP ${status}` };
  }

  const expiredUrl = firstMatch(EXPIRED_URL_PATTERNS, finalUrl);
  if (expiredUrl) {
    return { result: 'expired', reason: `redirect to ${finalUrl}` };
  }

  const expiredBody = firstMatch(HARD_EXPIRED_PATTERNS, bodyText);
  if (expiredBody) {
    return { result: 'expired', reason: `pattern matched: ${expiredBody.source}` };
  }

  if (hasApplyControl(applyControls)) {
    return { result: 'active', reason: 'visible apply control detected' };
  }

  const listingPage = firstMatch(LISTING_PAGE_PATTERNS, bodyText);
  if (listingPage) {
    return { result: 'expired', reason: `pattern matched: ${listingPage.source}` };
  }

  if (bodyText.trim().length < MIN_CONTENT_CHARS) {
    return { result: 'expired', reason: 'insufficient content — likely nav/footer only' };
  }

  return { result: 'uncertain', reason: 'content present but no visible apply control found' };
}

// ── Workday liveness via the CXS JSON API ─────────────────────────────────────
//
// Workday serves job pages (…/job/…/Title_R12345) as JS-rendered SPAs that 404
// or time out on a raw Playwright navigation of the direct job path — even when
// the posting is genuinely live. That makes classifyLiveness() (which trusts the
// nav status) systematically false-flag every Workday job URL as dead.
//
// The public CXS JSON API resolves those postings reliably. It is the same API
// scan.mjs's fetchWorkdayJobs() already uses successfully. So for Workday job
// URLs we check liveness there instead of via a page load, and only fall back to
// Playwright when the API can't give a definitive answer.

const WORKDAY_HOST_RX = /^https?:\/\/([^./]+)\.(wd\d+)\.myworkdayjobs\.com(\/[^?#]*)?/i;
const LOCALE_SEG_RX = /^[a-z]{2}-[A-Za-z]{2}$/;   // en-US, fr-FR, en-GB, …

// The trailing "_RNNNNN" (or "_JR-000627-1", "_2025-02593") of the last path
// segment is the requisition id. It always follows the LAST underscore — Workday
// slugifies the title with dashes, never underscores.
function reqIdFromPath(path = '') {
  const last = String(path).split('/').filter(Boolean).pop() || '';
  const i = last.lastIndexOf('_');
  if (i === -1 || i === last.length - 1) return null;
  return last.slice(i + 1);
}

function sameReq(a, b) {
  return !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
}

/**
 * Parse a Workday DIRECT JOB url into its API coordinates. Returns null for
 * anything that isn't a Workday `…/job/…` page (board/search URLs, other hosts),
 * so callers know to use the normal Playwright path.
 *
 *   { tenant, shard, siteFromUrl, externalPath, reqId }
 *
 * Handles both URL shapes seen in the wild (tenants and requisitions below are
 * invented; a real posting the maintainer was tracking does not belong in a doc
 * comment that ships to every user):
 *   short: https://contoso.wd1.myworkdayjobs.com/job/Remote-NY/Director--Revenue-Operations_R00000
 *          → siteFromUrl null (site not in path; resolve from hints/tenant)
 *   full:  https://fabrikam.wd1.myworkdayjobs.com/en-US/Fabrikam_External_Careers/job/…_R-000000
 *          → siteFromUrl "Fabrikam_External_Careers" (leading en-US locale dropped)
 */
export function parseWorkdayUrl(url) {
  if (typeof url !== 'string') return null;
  const m = url.match(WORKDAY_HOST_RX);
  if (!m) return null;
  const [, tenant, shard, rawPath = ''] = m;
  const segs = rawPath.split('/').filter(Boolean);
  const jobIdx = segs.indexOf('job');
  if (jobIdx === -1) return null;   // board / search / careers-home URL, not a job page

  let siteSegs = segs.slice(0, jobIdx);
  if (siteSegs[0] && LOCALE_SEG_RX.test(siteSegs[0])) siteSegs = siteSegs.slice(1);
  const siteFromUrl = siteSegs.length ? siteSegs.join('/') : null;

  const externalPath = '/' + segs.slice(jobIdx).join('/');   // /job/…/Title_Req
  return { tenant, shard, siteFromUrl, externalPath, reqId: reqIdFromPath(externalPath) };
}

/**
 * Extract the CXS career-site name from a Workday BOARD/careers url (the shape
 * portals.yml stores, e.g. https://zendesk.wd1.myworkdayjobs.com/zendesk or
 * https://datarobot.wd1.myworkdayjobs.com/en-US/DataRobot_External_Careers).
 * Returns the site name (leading xx-XX locale dropped, first path segment) or
 * null. Kept separate from parseWorkdayUrl because that one requires a /job/
 * path; a careers_url has no /job/ segment. Used to build gate-pipeline's
 * tenant→site hints.
 */
export function workdaySiteFromCareersUrl(careersUrl) {
  if (typeof careersUrl !== 'string') return null;
  const m = careersUrl.match(WORKDAY_HOST_RX);
  if (!m) return null;
  let segs = (m[3] || '').split('/').filter(Boolean);
  if (segs[0] && LOCALE_SEG_RX.test(segs[0])) segs = segs.slice(1);
  return segs[0] || null;
}

/**
 * Check whether a Workday job posting is live via the CXS JSON API.
 *
 * Returns { result: 'active' | 'expired', reason } when the API is conclusive,
 * or null when it cannot decide (unknown career site, tenant blocks the API,
 * network error) — in which case the caller should fall back to Playwright.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string[]} [opts.siteHints]  Career-site names to try (e.g. from portals.yml)
 * @param {Function} [opts.fetchImpl]  Injectable fetch (tests pass a stub)
 * @param {number}  [opts.timeoutMs]   Per-request timeout
 */
export async function checkWorkdayLiveness(url, opts = {}) {
  const parsed = parseWorkdayUrl(url);
  if (!parsed) return null;

  const { siteHints = [], fetchImpl = globalThis.fetch, timeoutMs = 12000 } = opts;
  if (typeof fetchImpl !== 'function') return null;

  const { tenant, shard, siteFromUrl, externalPath, reqId } = parsed;
  const base = `https://${tenant}.${shard}.myworkdayjobs.com`;

  // Try the site embedded in the URL first, then any caller hints (portals.yml),
  // then the tenant itself (site === tenant works on many Workday instances).
  const candidateSites = [...new Set([siteFromUrl, ...siteHints, tenant].filter(Boolean))];

  const JSON_HEADERS = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) trajecktory/liveness',
  };

  const doFetch = async (u, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(u, { ...init, signal: controller.signal });
      let json = null;
      try { json = await res.json(); } catch { /* non-JSON / empty body */ }
      return { status: res.status ?? 0, ok: !!res.ok, json };
    } catch {
      return { status: 0, ok: false, json: null };   // network / timeout / abort
    } finally {
      clearTimeout(timer);
    }
  };

  // A live requisition need only surface on ONE candidate site, so any 'active'
  // signal returns immediately, but we must exhaust EVERY candidate before
  // concluding 'expired' — a multi-site tenant can host the req on a later
  // candidate that an earlier valid-but-wrong site knew nothing about.
  let sawValidSite = false;   // ≥1 candidate whose board search returned 200

  for (const site of candidateSites) {
    // 1) Direct job-detail lookup — most authoritative (exact path, no search
    //    indexing dependency). 200 + a job title ⇒ the posting is served; but a
    //    posting Workday still serves with canApply:false is closed to
    //    applications, so let those fall through to the open-reqs board search
    //    (which won't list them) and gate as expired.
    const detail = await doFetch(`${base}/wday/cxs/${tenant}/${site}${externalPath}`, {
      method: 'GET',
      headers: JSON_HEADERS,
    });
    const detailInfo = detail.json?.jobPostingInfo;
    if (detail.ok && detailInfo?.title && detailInfo.canApply !== false) {
      return { result: 'active', reason: `Workday API: live posting "${detailInfo.title}"` };
    }

    // 2) Job-board search. Clean failure modes: 404 ⇒ this career site doesn't
    //    exist (wrong site guess), 200 ⇒ valid site (whether or not it matches).
    const search = await doFetch(`${base}/wday/cxs/${tenant}/${site}/jobs`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: reqId || '' }),
    });

    if (search.status === 404) continue;   // wrong career site — try the next candidate
    if (!search.ok) continue;              // 5xx / network — inconclusive, try the next

    sawValidSite = true;
    const postings = Array.isArray(search.json?.jobPostings) ? search.json.jobPostings : [];
    const match = reqId
      ? postings.some((p) => sameReq(reqIdFromPath(p?.externalPath), reqId))
      : postings.some((p) => p?.externalPath === externalPath);
    if (match) {
      return { result: 'active', reason: `Workday API: requisition ${reqId || externalPath} in job board` };
    }
    // Valid site, requisition absent here — keep trying the other candidates
    // before concluding it's gone.
  }

  // Exhausted every candidate with no 'active' hit.
  //   • A valid career site + a real req id ⇒ the board authoritatively lacks it
  //     (Workday indexes req ids; scan.mjs trusts this same search) ⇒ expired.
  //   • No req id (can't prove absence) or no resolvable career site (every
  //     candidate 404'd / errored) ⇒ inconclusive ⇒ defer to Playwright.
  if (sawValidSite && reqId) {
    return { result: 'expired', reason: `Workday API: requisition ${reqId} absent from job board` };
  }
  return null;
}
