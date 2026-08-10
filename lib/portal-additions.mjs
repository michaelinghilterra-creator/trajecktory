// lib/portal-additions.mjs — the single owner of agent-discovered portals.yml writes.
//
// WHY THIS EXISTS: the dashboard Agent Scan told the headless agent to append the
// companies it discovered straight into portals.yml. Two things made that fail:
//
//   1. The eval sandbox denies Edit AND Write on portals.yml (a deliberate guard:
//      the eval/deep/triage modes fetch attacker-controlled JDs, and a prompt-
//      injected posting must never be able to write a scan target). All modes
//      share one sandbox, so the scan mode — whose whole job is to grow
//      portals.yml — was blocked too. Discovery silently dead-ended into a
//      throwaway suggestions .md, portals.yml stopped growing, and the zero-token
//      API scan slowly starved of new companies. Every run then reported "No new
//      postings were written this run."
//   2. Even when it could write, the agent's WebSearch discovery invented
//      companies and "live" roles it never actually read (the same stitched-from-
//      search-results failure the eval prompt warns about). Two phantom Director
//      roles were produced on 2026-08-10, neither live on its ATS board.
//
// The fix is the same shape this codebase already uses for triage-results and
// report numbering: the agent emits STRUCTURED OUTPUT, and deterministic server
// code does the write. Here that means:
//   • the agent names discovered companies as { name, ats, slug } — never a URL;
//   • this module CONSTRUCTS every careers_url/api from (ats, slug) via
//     buildPortalsEntry, so an attacker-influenced string can never become a host
//     that scan.mjs will fetch (closing the SSRF the sandbox deny existed to stop
//     — so the deny STAYS, and the agent never writes portals.yml at all);
//   • it verifies each board is actually live over its ATS API before adding it,
//     so a hallucinated slug is rejected instead of parked as a 404 forever;
//   • it dedupes through lib/portals.mjs (name + every known slug), so an ATS
//     migration can't masquerade as a new company;
//   • real live roles are surfaced afterward by re-running the zero-token scanner
//     over the newly-added companies — from their real boards, not from the LLM.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import yaml from 'js-yaml';
import {
  buildCompanyIndex, addCompanyToIndex, findKnownCompany,
  buildPortalsEntry, insertPortalsEntries, slugToName,
} from './portals.mjs';

export const START_MARKER = '<<<PORTAL_ADDITIONS>>>';
export const END_MARKER = '<<<END_PORTAL_ADDITIONS>>>';

// The only ATS platforms scan.mjs can read. An agent-named platform outside this
// set is dropped: we cannot construct a scannable board for it, so tracking it
// would only add a permanent 404.
const ATS = new Set(['greenhouse', 'ashby', 'lever']);

// A board slug becomes part of a URL that scan.mjs fetches. Constrain it to the
// characters real ATS slugs use so a value like "acme/../../etc" or one carrying
// a query/scheme can never be built into a request. (Ashby slugs are additionally
// encodeURIComponent'd in buildPortalsEntry.)
const SAFE_SLUG = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,79})$/;

// A company display name is emitted UNQUOTED after "- name: " (matching every
// existing entry), so it must not carry YAML-structural characters. Keep letters,
// digits, spaces and the punctuation that appears in real company names; drop the
// rest; collapse whitespace; cap length. Colons become spaces (a " : " would read
// as a YAML mapping). Returns '' when nothing usable survives, so the caller can
// fall back to a name derived from the slug.
export function sanitizeCompanyName(name) {
  return String(name || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/:/g, ' ')
    .replace(/[^A-Za-z0-9 ().,&/'+-]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[#\-&*!|>%@`.\s]+/, '')   // strip YAML-hostile leading chars
    .trim()
    .slice(0, 80)
    .trim();
}

// Extract and validate the JSON array between the markers. Returns
// { companies, errors } — errors are per-entry and never thrown, so one bad entry
// does not discard a whole run's discovery. Each company is { ats, slug, name },
// fully validated and safe to hand to buildPortalsEntry.
export function parsePortalAdditions(text) {
  const errors = [];
  const s = String(text || '');
  const startIdx = s.indexOf(START_MARKER);
  const endIdx = s.indexOf(END_MARKER);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    return { companies: [], errors: ['no PORTAL_ADDITIONS block found in the agent output'] };
  }
  let jsonText = s.slice(startIdx + START_MARKER.length, endIdx).trim();
  const fenced = jsonText.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fenced) jsonText = fenced[1].trim();

  let parsed;
  try { parsed = JSON.parse(jsonText); }
  catch (e) { return { companies: [], errors: [`PORTAL_ADDITIONS block is not valid JSON: ${e.message}`] }; }
  if (!Array.isArray(parsed)) return { companies: [], errors: ['PORTAL_ADDITIONS block is not a JSON array'] };

  const companies = [];
  for (const [i, entry] of parsed.entries()) {
    if (!entry || typeof entry !== 'object') { errors.push(`entry ${i}: not an object`); continue; }
    const ats = String(entry.ats || entry.platform || '').trim().toLowerCase();
    const slug = String(entry.slug || '').trim();
    if (!ATS.has(ats)) { errors.push(`entry ${i}: ats "${entry.ats ?? entry.platform ?? ''}" is not greenhouse/ashby/lever`); continue; }
    if (!SAFE_SLUG.test(slug)) { errors.push(`entry ${i}: slug "${slug}" is missing or has unsafe characters`); continue; }
    const name = sanitizeCompanyName(entry.name) || slugToName(slug);
    companies.push({ ats, slug, name });
  }
  return { companies, errors };
}

// Construct the ATS list-API URL for a board. Same shapes scan.mjs/detectApi use.
function boardApiUrl(ats, slug) {
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`;
  if (ats === 'ashby')      return `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`;
  if (ats === 'lever')      return `https://api.lever.co/v0/postings/${slug}`;
  return '';
}

// Is this board real and reachable? Returns { live, jobCount }:
//   live === true  → the ATS API answered 200 with a job list (add it)
//   live === false → the ATS API answered non-200 or unparseable (a hallucinated
//                    or dead slug — reject it)
//   live === null  → the request itself failed (timeout/network) — UNKNOWN, so the
//                    caller adds it anyway and lets the next scan surface a 404 if
//                    the slug is wrong. Fails open, matching scan.mjs's age filter.
export async function verifyBoardLive(ats, slug, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = boardApiUrl(ats, slug);
  if (!url) return { live: false, jobCount: null };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal });
    if (!res.ok) return { live: false, jobCount: null };
    const json = await res.json().catch(() => null);
    if (json == null) return { live: false, jobCount: null };
    const count = Array.isArray(json) ? json.length : (Array.isArray(json.jobs) ? json.jobs.length : null);
    return { live: true, jobCount: count };
  } catch {
    return { live: null, jobCount: null };   // network/timeout → unknown, fail open
  } finally {
    clearTimeout(timer);
  }
}

// Validate-and-merge discovered companies into portals.yml. Deterministic, and
// the ONLY write path for agent-discovered companies. Returns a full accounting so
// the run summary can be honest about what happened to every candidate.
//
//   { added, entries, skippedDuplicate, skippedDead, collisions, errors }
//
// `entries` carries { name, careers_url, slug, ats } for each company actually
// added, so the caller can scan exactly those boards for their real live roles.
// `collisions` are name-matches on a different board (an ATS migration, or two
// real companies sharing a name) — never added silently, always surfaced, exactly
// as discover.mjs does.
export async function mergePortalAdditions(portalsPath, companies, { today = '', verify = true, fetchImpl = fetch } = {}) {
  const result = { added: 0, entries: [], skippedDuplicate: 0, skippedDead: 0, collisions: [], errors: [] };
  if (!companies || !companies.length) return result;
  if (!existsSync(portalsPath)) { result.errors.push('portals.yml not found'); return result; }

  const portalsRaw = readFileSync(portalsPath, 'utf8');
  let config;
  try { config = yaml.load(portalsRaw); }
  catch (e) { result.errors.push(`portals.yml is not valid YAML: ${e.message}`); return result; }
  const index = buildCompanyIndex(config?.tracked_companies || []);

  const newEntries = [];
  for (const c of companies) {
    const hit = findKnownCompany(index, { slug: c.slug, name: c.name });
    if (hit) {
      if (hit.matchedOn === 'name') {
        // Same name, different board: a migration (skip) or two real companies
        // sharing a name (only a human can tell). Surface, never silently drop.
        result.collisions.push({ ats: c.ats, slug: c.slug, name: c.name, existing: hit.entry.name });
      } else {
        result.skippedDuplicate++;
      }
      continue;
    }
    if (verify) {
      const { live } = await verifyBoardLive(c.ats, c.slug, { fetchImpl });
      if (live === false) { result.skippedDead++; continue; }   // hallucinated/dead slug
    }
    const note = `Agent-discovered ${today} via Agent Scan (WebSearch); validated + added server-side.`;
    const entry = buildPortalsEntry({ type: c.ats, slug: c.slug }, { today, note, companyHint: c.name });
    addCompanyToIndex(index, entry.company);   // dedupe the rest of this run
    newEntries.push(entry);
    result.entries.push({ name: entry.name, careers_url: entry.company.careers_url, slug: c.slug, ats: c.ats });
  }

  if (newEntries.length) {
    writeFileSync(portalsPath, insertPortalsEntries(portalsRaw, newEntries.map(e => e.yaml)), 'utf8');
    result.added = newEntries.length;
  }
  return result;
}
