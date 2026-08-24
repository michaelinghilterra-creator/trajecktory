/**
 * One contact discovery implementation serves the talent route, principal
 * route, and background job. This module exists because copies of both searches
 * had already started multiplying and could silently drift when prompts changed.
 */

import { generateText, draftModel } from './anthropic.mjs';
import { validateStakeholder } from '../../../lib/stakeholder-additions.mjs';

const DEFAULT_TIMEOUT_MS = 90_000;

function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseSuggestions(fullText) {
  const jsonMatch = fullText.match(/\[[\s\S]*\]/);
  return jsonMatch ? (() => { try { return JSON.parse(jsonMatch[0]); } catch { return []; } })() : [];
}

// Injection is scoped to one call. A mutable module test seam can leak between
// tests, while a parameter cannot affect another request or later test.
export async function discoverTalentAtCompany({
  company,
  exampleRole = '',
  model = draftModel(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  generate = generateText,
}) {
  const prompt = `Find 2-3 Internal Talent Acquisition / People / Recruiting employees CURRENTLY employed at ${company} who would be relevant for a candidate targeting business/GTM/RevOps/Operations roles (specifically: ${exampleRole}).

INSTRUCTIONS:
1. USE THE web_search TOOL to search for current TA employees at ${company}. Try queries like:
   - site:linkedin.com/in "${company}" "talent acquisition"
   - site:linkedin.com/in "${company}" "recruiter"
   - "${company}" "head of talent" OR "head of recruiting"
   - "${company}" careers team
2. Prioritize people whose LinkedIn profile shows ${company} as their CURRENT employer.
3. Prefer: Heads/Directors/Sr. Managers of Talent Acquisition · Recruiters with business/commercial focus (not engineering) · People & Talent leads.
4. Verify each person's current employer before including them — recent job changes are common.

Output ONLY a JSON array (your final response after searching), no prose, no markdown:
[
  { "first": "First", "last": "Last", "title": "Senior Talent Acquisition Partner", "city": "New York", "state": "NY", "linkedin": "https://www.linkedin.com/in/example/", "confidence": "high|medium|low", "notes": "One line on where you found them + how recent the source." }
]

Confidence rules:
- high   = LinkedIn profile shows ${company} as current employer (or equivalent recent source)
- medium = found on a third-party source (ZoomInfo, RocketReach, company press release) but not directly verified on LinkedIn
- low    = inferred / weak evidence

If the search returns no reliable matches, return an empty array []. Never fabricate names.`;

  let timeoutId;
  try {
    console.log(`[discover] start: ${company}`);
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
      model,
      maxTokens: 3000,
      tools: [{
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 2,
        allowed_callers: ['direct'],
      }],
    });
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`discover timeout after 90s for ${company}`)), timeoutMs);
    });
    const fullText = await Promise.race([apiCall, timeout]);
    console.log(`[discover] done:  ${company}`);
    return { company, exampleRole, suggestions: parseSuggestions(fullText) };
  } catch (e) {
    console.log(`[discover] ERROR: ${company} — ${e.message}`);
    return { company, exampleRole, suggestions: [], error: e.message };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function discoverPrincipalAtCompany({
  company,
  exampleRole = '',
  model = draftModel(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  generate = generateText,
}) {
  const prompt = `Find 2-3 people who currently LEAD the ${exampleRole || 'Revenue Operations / GTM'} function at ${company}. We are looking for the HIRING MANAGER or their skip-level — the VP, Director, Senior Director, or Head of the target function — NOT a recruiter, HR person, or TA team member.

INSTRUCTIONS:
1. USE THE web_search TOOL to search for functional leaders at ${company}. Try queries like:
   - site:linkedin.com/in "${company}" "VP Revenue Operations"
   - site:linkedin.com/in "${company}" "Head of Sales Operations"
   - site:linkedin.com/in "${company}" "Director GTM"
   - "${company}" leadership team "${exampleRole || 'revenue operations'}"
2. Prioritize VP, Director, Senior Director, Head of — NOT Managers or ICs.
3. Target the person this ${exampleRole || 'role'} would REPORT TO (the direct manager), or their skip-level (one rung up).
4. Do NOT include TA, People, HR, or Recruiting people — only functional leaders.
5. Verify each person's current employer before including.

Output ONLY a JSON array (your final response after searching), no prose, no markdown:
[
  { "first": "First", "last": "Last", "title": "VP Revenue Operations", "city": "New York", "state": "NY", "linkedin": "https://www.linkedin.com/in/example/", "confidence": "high|medium|low", "notes": "One line on source and recency. [principal]" }
]

Confidence rules:
- high   = LinkedIn profile shows ${company} as current employer (or equivalent recent verified source)
- medium = found on third-party source (ZoomInfo, RocketReach, press release) but not verified on LinkedIn
- low    = inferred or weak evidence

If the search returns no reliable matches, return []. Never fabricate names or titles.`;

  let timeoutId;
  try {
    console.log(`[discover-principal] start: ${company}`);
    const apiCall = generate(prompt, {
      model,
      maxTokens: 3000,
      tools: [{
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 2,
        allowed_callers: ['direct'],
      }],
    });
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`discover-principal timeout after 90s for ${company}`)), timeoutMs);
    });
    const fullText = await Promise.race([apiCall, timeout]);
    console.log(`[discover-principal] done:  ${company}`);
    let suggestions = parseSuggestions(fullText);
    // Guarantee the [principal] tag is in every suggestion's notes (the model
    // is instructed to include it, but stamp it defensively on parse too).
    suggestions = suggestions.map(s => {
      const suggestion = {
        ...s,
        source: 'agent',
        notes: /\[principal\]/i.test(s.notes || '') ? s.notes : `${s.notes || ''}${s.notes ? ' ' : ''}[principal]`.trim(),
      };
      const validation = validateStakeholder({ ...suggestion, company }, {
        today: localDate(),
      });
      suggestion.validation = validation.ok
        ? { ok: true }
        : { ok: false, reasons: validation.reasons };
      return suggestion;
    });
    return { company, exampleRole, suggestions };
  } catch (e) {
    console.log(`[discover-principal] ERROR: ${company} — ${e.message}`);
    return { company, exampleRole, suggestions: [], error: e.message };
  } finally {
    clearTimeout(timeoutId);
  }
}
