/**
 * hunter-domain.mjs: read-only access to Hunter's Domain Search endpoint.
 *
 * WHY THIS EXISTS: trajecktory could find an address for a person it already
 * knew about, but it could not find the person. Domain Search supplies people
 * at a company with structured titles, seniority, and departments at a bounded
 * cost. It is the primary discovery source because it cannot invent a person
 * the way a language model can.
 *
 * This module deliberately only fetches and normalizes. It writes nothing and
 * makes no trust decision. Validation, filtering policy, and persistence belong
 * to a separate gate so an unvalidated discovery can never become a write.
 */

import { classifyTitle } from './influence-tier.mjs';

const text = value => typeof value === 'string' ? value : '';

export function mapDomainSearch(json) {
  const data = json?.data && typeof json.data === 'object' ? json.data : {};
  const emails = Array.isArray(data.emails) ? data.emails : [];

  const candidates = emails
    // Generic mailboxes are the single largest source of junk in Domain Search.
    .filter(entry => entry?.type !== 'generic')
    .map(entry => {
      const item = entry && typeof entry === 'object' ? entry : {};
      const first = text(item.first_name);
      const last = text(item.last_name);
      const title = text(item.position);
      return {
        first,
        last,
        fullName: `${first} ${last}`.trim(),
        title,
        seniority: text(item.seniority),
        department: text(item.department),
        email: text(item.value).trim().toLowerCase(),
        emailType: text(item.type),
        confidence: Number.isFinite(item.confidence) ? item.confidence : null,
        linkedin: text(item.linkedin),
        sourceCount: item.sources?.length ?? 0,
        // This is only a proposal. The downstream gate decides what to trust.
        proposedTier: title ? classifyTitle(title) : null,
      };
    });

  return {
    domain: text(data.domain).trim().toLowerCase(),
    organization: text(data.organization),
    pattern: text(data.pattern),
    // Catch-all addresses are weaker evidence, but policy belongs downstream.
    acceptAll: !!data.accept_all,
    candidates,
  };
}

// A caller-controlled domain becomes part of a URL this process requests. Keep
// it to a conservative hostname grammar so schemes, paths, credentials, and
// other attacker-controlled URL structure cannot redirect the request.
const SAFE_DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export async function hunterDomainSearch(domain, key, { limit = 25, department, seniority, timeoutMs = 25_000 } = {}) {
  if (typeof domain !== 'string' || !SAFE_DOMAIN.test(domain)) {
    throw new Error('Hunter: domain must be a plain hostname');
  }

  const params = new URLSearchParams({ domain, api_key: key, limit: String(limit) });
  if (department) params.set('department', department);
  if (seniority) params.set('seniority', seniority);
  const res = await fetch(`https://api.hunter.io/v2/domain-search?${params.toString()}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 429) throw new Error('Hunter rate limit (429) — wait and re-run');
  const json = await res.json();
  if (json?.errors) throw new Error(`Hunter: ${json.errors[0]?.details || 'error'}`);
  return mapDomainSearch(json);
}

export const DEFAULT_DOMAIN_LIMIT = 10;

// Domain Search spends ONE Hunter search credit per DOMAIN, regardless of how
// many people come back. It shares the hunterSearchesLeft and Email Finder
// bucket. That makes it cheap per person and expensive per company, the exact
// opposite of Finder and the reason it is the right primary discovery source.
export function planDomainBudget({ needed, limit = 0, creditsLeft = null }) {
  const wanted = limit > 0 ? limit : DEFAULT_DOMAIN_LIMIT;
  let cap = Math.min(needed, wanted);
  if (Number.isFinite(creditsLeft)) cap = Math.min(cap, Math.max(0, creditsLeft));
  return Math.max(0, cap);
}
