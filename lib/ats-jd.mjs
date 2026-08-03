// lib/ats-jd.mjs — resolve ONE job-posting URL to its JD text via the public
// ATS API.
//
// Why this exists: the triage and deep-eval agents read a posting with a plain
// fetch of its page. Modern ATS posting pages (Ashby, Workday, SmartRecruiters,
// Greenhouse-embedded, iCIMS, Eightfold) are JavaScript apps that render nothing
// to a plain fetch, so every role on those platforms was silently skipped
// ("skip any you cannot read"). But those same platforms expose the JD over a
// public JSON API — the same APIs scan.mjs already uses to LIST a board. This
// module fetches ONE posting's description from its URL, so a pre-step can snapshot
// the JD to jds/ and let the agents read it locally.
//
// Sibling to scan.mjs's detectApi (board → job list); this is url → one JD.
// parseWorkdayUrl is reused from liveness-core.mjs (single source for Workday).

import { parseWorkdayUrl } from '../liveness-core.mjs';

// HTML → readable plain text. ATS descriptions are HTML fragments; the agents
// read plain text, so flatten tags to newlines and decode the common entities.
export function htmlToText(h) {
  return String(h || '')
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/tr)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;|&#x27;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&hellip;/g, '…')
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Parse a posting URL into a descriptor the fetcher understands, or null when the
// URL is not a recognized single-posting URL (a board/search/home page, or an
// unknown platform). `needsBoard` (Greenhouse gh_jid on a company domain) means
// the id is known but the board slug must come from a hint (portals.yml).
export function parsePostingUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;

  // Greenhouse, direct board host: (job-boards|boards).greenhouse.io/{board}/jobs/{id}
  let m = url.match(/(?:job-boards|boards)\.greenhouse\.io\/([^/?#]+)\/jobs\/(\d+)/i);
  if (m) return { ats: 'greenhouse', board: m[1], id: m[2] };

  // Greenhouse, embedded on a company domain via ?gh_jid=. Board slug unknown.
  m = url.match(/[?&]gh_jid=(\d+)/i);
  if (m) return { ats: 'greenhouse', id: m[1], needsBoard: true };

  // Ashby: jobs.ashbyhq.com/{slug}/{uuid}
  m = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)\/([0-9a-f-]{16,})/i);
  if (m) return { ats: 'ashby', slug: m[1], id: m[2] };

  // SmartRecruiters: jobs.smartrecruiters.com/{company}/{postingId}
  m = url.match(/jobs\.smartrecruiters\.com\/([^/?#]+)\/(\d+)/i);
  if (m) return { ats: 'smartrecruiters', company: m[1], id: m[2] };

  // Lever: jobs.lever.co/{company}/{postingId}
  m = url.match(/jobs\.lever\.co\/([^/?#]+)\/([0-9a-f-]{16,})/i);
  if (m) return { ats: 'lever', company: m[1], id: m[2] };

  // Workable: apply.workable.com/{slug}/j/{SHORTCODE}
  m = url.match(/apply\.workable\.com\/([^/?#]+)\/j\/([^/?#]+)/i);
  if (m) return { ats: 'workable', slug: m[1], shortcode: m[2] };

  // Workday: reuse the shared parser (requires a /job/ path).
  const wd = parseWorkdayUrl(url);
  if (wd) return { ats: 'workday', ...wd };

  return null;   // board/search/home page, or an unsupported platform
}

async function jget(url, fetchImpl, opts) {
  const r = await fetchImpl(url, { headers: { accept: 'application/json' }, ...opts });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Fetch one posting's JD text. Returns { title, text } or throws.
// opts.boardHint       — Greenhouse board slug for a needsBoard descriptor.
// opts.workdaySiteHints — extra Workday career-site names to try (from portals.yml).
export async function fetchJdText(desc, { boardHint = null, workdaySiteHints = [], fetchImpl = globalThis.fetch } = {}) {
  if (!desc) throw new Error('no descriptor');

  if (desc.ats === 'greenhouse') {
    const board = desc.board || boardHint;
    if (!board) { const e = new Error('greenhouse board slug unknown (needs portals hint)'); e.code = 'NEEDS_BOARD'; throw e; }
    const j = await jget(`https://boards-api.greenhouse.io/v1/boards/${board}/jobs/${desc.id}`, fetchImpl);
    return { title: j.title || '', text: htmlToText(j.content) };
  }

  if (desc.ats === 'ashby') {
    const b = await jget(`https://api.ashbyhq.com/posting-api/job-board/${desc.slug}`, fetchImpl);
    const p = (b.jobs || []).find(x => x.id === desc.id);
    if (!p) throw new Error('posting id not on Ashby board (filled or private)');
    return { title: p.title || '', text: htmlToText(p.descriptionHtml || p.descriptionPlain) };
  }

  if (desc.ats === 'smartrecruiters') {
    const j = await jget(`https://api.smartrecruiters.com/v1/companies/${desc.company}/postings/${desc.id}`, fetchImpl);
    const s = (j.jobAd && j.jobAd.sections) || {};
    const text = ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map(k => s[k] && s[k].text ? `## ${(s[k].title || k)}\n${htmlToText(s[k].text)}` : '')
      .filter(Boolean).join('\n\n');
    return { title: j.name || '', text };
  }

  if (desc.ats === 'lever') {
    const j = await jget(`https://api.lever.co/v0/postings/${desc.company}/${desc.id}?mode=json`, fetchImpl);
    const lists = (j.lists || []).map(l => `## ${htmlToText(l.text)}\n${htmlToText(l.content)}`).join('\n\n');
    const text = [htmlToText(j.description || j.descriptionPlain), lists, htmlToText(j.additional)].filter(Boolean).join('\n\n');
    return { title: j.text || '', text };
  }

  if (desc.ats === 'workable') {
    const b = await jget(`https://apply.workable.com/api/v1/widget/accounts/${desc.slug}?details=true`, fetchImpl);
    const p = (b.jobs || []).find(x => x.shortcode === desc.shortcode || x.id === desc.shortcode);
    if (!p) throw new Error('shortcode not on Workable board (filled or private)');
    return { title: p.title || '', text: htmlToText(p.description) + '\n\n' + htmlToText(p.requirements) };
  }

  if (desc.ats === 'workday') {
    const { tenant, shard, siteFromUrl, externalPath } = desc;
    const base = `https://${tenant}.${shard}.myworkdayjobs.com`;
    // Try the site in the URL, caller hints, then the tenant itself (works on many
    // Workday instances) — same fallback order as checkWorkdayLiveness.
    const sites = [...new Set([siteFromUrl, ...workdaySiteHints, tenant].filter(Boolean))];
    let lastErr;
    for (const site of sites) {
      try {
        const j = await jget(`${base}/wday/cxs/${tenant}/${site}${externalPath}`, fetchImpl);
        const info = j.jobPostingInfo;
        if (info && info.jobDescription) return { title: info.title || '', text: htmlToText(info.jobDescription) };
      } catch (e) { lastErr = e; }
    }
    throw new Error(`workday CXS unresolved (tried sites: ${sites.join(', ') || 'none'})${lastErr ? ' — ' + lastErr.message : ''}`);
  }

  throw new Error(`unsupported ats: ${desc.ats}`);
}
