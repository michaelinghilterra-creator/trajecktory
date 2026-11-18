/**
 * One contact discovery implementation serves the talent route, principal
 * route, and background job. This module exists because copies of both searches
 * had already started multiplying and could silently drift when prompts changed.
 */

import { generateText, draftModel } from './anthropic.mjs';
import { validateStakeholder } from '../../../lib/stakeholder-additions.mjs';
import { collectPeople } from '../../../lib/people-search.mjs';
import { applyLabels, buildLabelPrompt, MAX_KEEP_PRINCIPAL, MAX_KEEP_TALENT } from '../../../lib/people-label.mjs';

const DEFAULT_TIMEOUT_MS = 90_000;
const MIN_TIMEOUT_MS = 1_000;

export function resolveTimeoutMs(timeoutMs) {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.min(DEFAULT_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, timeoutMs));
}

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function decoratePrincipalSuggestions(suggestions, company) {
  return suggestions.map(s => {
    const suggestion = {
      ...s,
      source: 'agent',
      notes: /\[principal\]/i.test(s.notes || '') ? s.notes : `${s.notes || ''}${s.notes ? ' ' : ''}[principal]`.trim(),
    };
    const validation = validateStakeholder({ ...suggestion, company }, { today: localDate() });
    suggestion.validation = validation.ok
      ? { ok: true }
      : { ok: false, reasons: validation.reasons };
    return suggestion;
  });
}

function timeoutPromise(message, timeoutMs) {
  let timeoutId;
  const promise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return { promise, clear: () => clearTimeout(timeoutId) };
}

// Parse the answer, and say whether it held a list at all. "[]" is a real
// empty result. Text with no list in it is an answer nobody could read, and the
// try counter must not treat the two alike.
function readSuggestions(fullText) {
  const jsonMatch = String(fullText || '').match(/\[[\s\S]*\]/);
  if (!jsonMatch) return { suggestions: [], unreadable: true };
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? { suggestions: parsed, unreadable: false } : { suggestions: [], unreadable: true };
  } catch {
    return { suggestions: [], unreadable: true };
  }
}

// Injection is scoped to one call. A mutable module test seam can leak between
// tests, while a parameter cannot affect another request or later test.
export async function discoverTalentAtCompany({
  company,
  exampleRole = '',
  model,
  timeoutMs,
  generate = generateText,
  search,
}) {
  // Bound timers so a bad option cannot cause resource exhaustion by extending a search indefinitely.
  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);
  // Keep invalid model options on the configured draft model instead of passing unchecked values downstream.
  const resolvedModel = typeof model === 'string' && model.trim() ? model : draftModel();
  const prompt = `Find every relevant current Internal Talent Acquisition / People / Recruiting employee you can verify at ${company}, up to 3 people, for a candidate targeting business/GTM/RevOps/Operations roles (specifically: ${exampleRole}).

INSTRUCTIONS:
1. USE THE web_search TOOL to search for current TA employees at ${company}. Try queries like:
   - site:linkedin.com/in "${company}" "talent acquisition"
   - site:linkedin.com/in "${company}" "recruiter"
   - "${company}" "head of talent" OR "head of recruiting"
   - "${company}" careers team
2. Prioritize people whose LinkedIn profile shows ${company} as their CURRENT employer.
3. Prefer: Talent Acquisition Partners / Recruiters / TA Business Partners / HR Business Partners (HRBPs) / People-team members focused on business, GTM, or commercial hiring, at any seniority (at a small company the Head of Talent may be the right person). Do NOT return revenue-function leaders (VP/Head/Director of Revenue Operations, Sales Operations, GTM, Sales, or Marketing): those belong to the decision-maker search, not here.
4. Verify each person's current employer before including them — recent job changes are common.

Each linkedin value must be copied exactly from a search result. Use an empty string when no profile link was seen.

Output ONLY a JSON array (your final response after searching), no prose, no markdown:
[
  { "first": "First", "last": "Last", "title": "Senior Talent Acquisition Partner", "city": "New York", "state": "NY", "linkedin": "https://www.linkedin.com/in/example/", "confidence": "high|medium|low", "notes": "One line on where you found them + how recent the source." }
]

Confidence rules:
- high   = LinkedIn profile shows ${company} as current employer (or equivalent recent source)
- medium = found on a third-party source (ZoomInfo, RocketReach, company press release) but not directly verified on LinkedIn
- low    = inferred / weak evidence

If the search returns no reliable matches, return an empty array []. Never fabricate names.`;

  let timer;
  let searchesUsed = 0;
  try {
    console.log(`[discover] start: ${company}`);
    if (search) {
      timer = timeoutPromise(`discover timeout after 90s for ${company}`, resolvedTimeoutMs);
      const operation = (async () => {
        const collected = await collectPeople({ company, tier: 'talent', search });
        searchesUsed = collected.queriesRun;
        if (collected.rateLimited) return { company, exampleRole, suggestions: [], error: 'Brave API HTTP 429', rateLimited: true, searchesUsed };
        if (collected.people.length === 0) return { company, exampleRole, suggestions: [], searchesUsed };
        const labelPrompt = buildLabelPrompt({ company, tier: 'talent', exampleRole, people: collected.people });
        const fullText = await generate(labelPrompt, { model: resolvedModel, maxTokens: 3000 });
        const read = readSuggestions(fullText);
        const suggestions = applyLabels({
          people: collected.people,
          labels: read.suggestions,
          tier: 'talent',
          maxKeep: MAX_KEEP_TALENT,
        });
        return { company, exampleRole, suggestions, searchesUsed, ...(read.unreadable ? { unreadable: true } : {}) };
      })();
      const result = await Promise.race([operation, timer.promise]);
      console.log(`[discover] done:  ${company}`);
      return result;
    }
    // Haiku 4.5 chosen over Sonnet 4.6 for the discover task: the hosted
    // web_search tool pulls full page snippets into input context, which
    // makes a single call blow past entry-tier Sonnet rate limits (30K
    // input-tokens-per-minute on this org). Haiku has its own rate-limit
    // pool, much higher headroom, and is plenty capable of "find 2-3 TA
    // people at company X" with structured JSON output.
    // 90-second hard cap per company: a stalled web_search must NOT hang
    // the whole batch. Promise.race rejects, the catch below logs + returns
    // an empty suggestion list, and the rest of the batch keeps going.
    // Hybrid: web search via the API key (hosted web_search tool) when a key
    // is set, else via the Claude plan's WebSearch tool. generateText returns
    // the concatenated text; we extract the JSON array from it.
    const apiCall = generate(prompt, {
      model: resolvedModel,
      maxTokens: 3000,
      tools: [{
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 4,
        allowed_callers: ['direct'],
      }],
    });
    timer = timeoutPromise(`discover timeout after 90s for ${company}`, resolvedTimeoutMs);
    const fullText = await Promise.race([apiCall, timer.promise]);
    console.log(`[discover] done:  ${company}`);
    const read = readSuggestions(fullText);
    return { company, exampleRole, suggestions: read.suggestions, searchesUsed, ...(read.unreadable ? { unreadable: true } : {}) };
  } catch (e) {
    console.log(`[discover] ERROR: ${company} — ${e.message}`);
    searchesUsed = e.queriesRun ?? searchesUsed;
    return { company, exampleRole, suggestions: [], error: e.message, searchesUsed };
  } finally {
    timer?.clear();
  }
}

/**
 * Two static query sets keyed by track. The model's web_search tool is capped at
 * The model fallback is limited, so order matters: the top titles do the work.
 */
const DM_QUERIES = {
  revops: [
    '"VP Revenue Operations" OR "Head of Revenue Operations"',
    '"VP Sales Operations" OR "Head of Sales Operations"',
    '"Chief Revenue Officer"',
    '"Director GTM" OR "Head of GTM"',
    '"VP Marketing"',
  ],
  salesdev: [
    '"VP Sales"',
    '"VP Sales Development" OR "Head of Sales Development"',
    '"VP Business Development"',
    '"Chief Revenue Officer"',
    '"VP Marketing"',
  ],
};

export function detectTrack(exampleRole) {
  const lower = (exampleRole || '').toLowerCase();
  if (/\b(sdr|bdr|sales development|business development)\b/.test(lower)) return 'salesdev';
  return 'revops';
}

export async function discoverPrincipalAtCompany({
  company,
  exampleRole = '',
  model,
  timeoutMs,
  generate = generateText,
  search,
}) {
  // Bound timers so a bad option cannot cause resource exhaustion by extending a search indefinitely.
  const resolvedTimeoutMs = resolveTimeoutMs(timeoutMs);
  // Keep invalid model options on the configured draft model instead of passing unchecked values downstream.
  const resolvedModel = typeof model === 'string' && model.trim() ? model : draftModel();
  const track = detectTrack(exampleRole);
  const queryLines = DM_QUERIES[track]
    .map(q => `   - site:linkedin.com/in "${company}" ${q}`)
    .join('\n');
  const prompt = `Find 2-3 people who currently LEAD the ${exampleRole || 'Revenue Operations / GTM'} function at ${company}. We are looking for the HIRING MANAGER or their skip-level — the VP, Director, Senior Director, or Head of the target function — NOT a recruiter, HR person, or TA team member.

INSTRUCTIONS:
1. USE THE web_search TOOL to search for functional leaders at ${company}. Try queries like:
${queryLines}
   - "${company}" leadership team "${exampleRole || 'revenue operations'}"
2. Prioritize VP, Director, Senior Director, Head of — NOT Managers or ICs.
3. Target the person this ${exampleRole || 'role'} would REPORT TO (the direct manager), or their skip-level (one rung up).
4. Do NOT include TA, People, HR, or Recruiting people — only functional leaders.
5. Verify each person's current employer before including.

Each linkedin value must be copied exactly from a search result. Use an empty string when no profile link was seen.

Output ONLY a JSON array (your final response after searching), no prose, no markdown:
[
  { "first": "First", "last": "Last", "title": "${track === 'salesdev' ? 'VP Sales' : 'VP Revenue Operations'}", "city": "New York", "state": "NY", "linkedin": "https://www.linkedin.com/in/example/", "confidence": "high|medium|low", "notes": "One line on source and recency. [principal]" }
]

Confidence rules:
- high   = LinkedIn profile shows ${company} as current employer (or equivalent recent verified source)
- medium = found on third-party source (ZoomInfo, RocketReach, press release) but not verified on LinkedIn
- low    = inferred or weak evidence

If the search returns no reliable matches, return []. Never fabricate names or titles.`
    .replace('Find 2-3 people who currently LEAD', 'Find every relevant current employee you can verify, up to 5 people, who leads');

  let timer;
  let searchesUsed = 0;
  try {
    console.log(`[discover-principal] start: ${company}`);
    if (search) {
      timer = timeoutPromise(`discover-principal timeout after 90s for ${company}`, resolvedTimeoutMs);
      const operation = (async () => {
        const collected = await collectPeople({ company, tier: 'principal', track, search });
        searchesUsed = collected.queriesRun;
        if (collected.rateLimited) return { company, exampleRole, suggestions: [], error: 'Brave API HTTP 429', rateLimited: true, searchesUsed };
        if (collected.people.length === 0) return { company, exampleRole, suggestions: [], searchesUsed };
        const labelPrompt = buildLabelPrompt({ company, tier: 'principal', exampleRole, people: collected.people });
        const fullText = await generate(labelPrompt, { model: resolvedModel, maxTokens: 3000 });
        const read = readSuggestions(fullText);
        const suggestions = decoratePrincipalSuggestions(applyLabels({
          people: collected.people,
          labels: read.suggestions,
          tier: 'principal',
          maxKeep: MAX_KEEP_PRINCIPAL,
        }), company);
        return { company, exampleRole, suggestions, searchesUsed, ...(read.unreadable ? { unreadable: true } : {}) };
      })();
      const result = await Promise.race([operation, timer.promise]);
      console.log(`[discover-principal] done:  ${company}`);
      return result;
    }
    const apiCall = generate(prompt, {
      model: resolvedModel,
      maxTokens: 3000,
      tools: [{
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 4,
        allowed_callers: ['direct'],
      }],
    });
    timer = timeoutPromise(`discover-principal timeout after 90s for ${company}`, resolvedTimeoutMs);
    const fullText = await Promise.race([apiCall, timer.promise]);
    console.log(`[discover-principal] done:  ${company}`);
    const read = readSuggestions(fullText);
    const suggestions = decoratePrincipalSuggestions(read.suggestions, company);
    return { company, exampleRole, suggestions, searchesUsed, ...(read.unreadable ? { unreadable: true } : {}) };
  } catch (e) {
    console.log(`[discover-principal] ERROR: ${company} — ${e.message}`);
    searchesUsed = e.queriesRun ?? searchesUsed;
    return { company, exampleRole, suggestions: [], error: e.message, searchesUsed };
  } finally {
    timer?.clear();
  }
}
