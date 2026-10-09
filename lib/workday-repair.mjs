// Repairing stored Workday links that lost their careers-site segment.
//
// Until v5.13.1 the scanner saved Workday postings as
//   https://{tenant}.{shard}.myworkdayjobs.com/job/{Location}/{Title}_{ReqId}
// which is not a page: Workday needs the careers site before /job/. These helpers
// find such a link and rebuild it from portals.yml. The site the scanner used to
// LIST a posting is the site in that company's careers_url, so it is the right one
// to put back. A tenant with several different sites, or none known, is reported
// and never guessed.

import { workdaySiteFromCareersUrl } from '../liveness-core.mjs';

const SITELESS_RX = /^(https?:\/\/)([^./]+)\.(wd\d+)\.myworkdayjobs\.com\/job\/(.+)$/i;
const WORKDAY_HOST_RX = /^https?:\/\/([^./]+)\.(wd\d+)\.myworkdayjobs\.com(?:\/|$)/i;

const tenantKey = (tenant, shard) => `${String(tenant).toLowerCase()}.${String(shard).toLowerCase()}`;

// True for a Workday posting link with no careers-site segment before /job/.
export function isSitelessWorkdayUrl(url) {
  return typeof url === 'string' && SITELESS_RX.test(url.trim());
}

// entries: portals.yml company objects. Reads `careers_url` and `api` (the two
// fields the scanner resolves a board from) and returns
// Map<"tenant.shard" (lowercase), Map<lowercased site, site as first written>>.
export function buildWorkdaySiteMap(entries) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const field of ['careers_url', 'api']) {
      const url = entry && typeof entry[field] === 'string' ? entry[field].trim() : '';
      const host = url.match(WORKDAY_HOST_RX);
      if (!host) continue;
      const site = workdaySiteFromCareersUrl(url);
      if (!site) continue;
      const key = tenantKey(host[1], host[2]);
      if (!map.has(key)) map.set(key, new Map());
      const sites = map.get(key);
      if (!sites.has(site.toLowerCase())) sites.set(site.toLowerCase(), site);
    }
  }
  return map;
}

// Returns { status, url?, site?, sites? }:
//   not-siteless  the link is not a site-less Workday posting; leave it alone
//   no-site       no portals entry for this tenant and shard
//   ambiguous     the tenant has more than one distinct site; a person must choose
//   repaired      url is the corrected link, site the segment that was added
export function repairWorkdayUrl(url, siteMap) {
  const m = typeof url === 'string' ? url.trim().match(SITELESS_RX) : null;
  if (!m) return { status: 'not-siteless' };
  const [, scheme, tenant, shard, rest] = m;
  const sites = siteMap && siteMap.get(tenantKey(tenant, shard));
  if (!sites || sites.size === 0) return { status: 'no-site' };
  if (sites.size > 1) return { status: 'ambiguous', sites: [...sites.values()] };
  const [site] = sites.values();
  return { status: 'repaired', site, url: `${scheme}${tenant}.${shard}.myworkdayjobs.com/${site}/job/${rest}` };
}
