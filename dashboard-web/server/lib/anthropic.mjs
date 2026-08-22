import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
// Side-effect import: ensures dashboard-web/.env is loaded before the client
// reads ANTHROPIC_API_KEY.
import '../config.mjs';
import { getIdentity } from './profile.mjs';
import { runClaudePrompt } from './claude-cli.mjs';
import { resolveModelId, currentModel, currentBilling } from './pricing.mjs';
import { _replaceEmDashes } from './text-hygiene.mjs';

// The SDK captures the key at CONSTRUCTION, so a client built when this module
// first loads holds whatever key existed then, forever. That broke the promise
// the Setup screen makes: saving a key writes .env AND updates process.env "so it
// works immediately, no restart". It does for the CLI path, which reads the
// environment per spawn. It did not for this path — hasAnthropicKey() would start
// returning true, apiKeyActive() would route here, and the client underneath
// still had no key, so the very first draft after saving a key failed with an
// auth error that pointed at nothing the user could see.
//
// Rebuilt when the key CHANGES rather than per call: constructing a client is
// cheap but not free, and this also picks up a key that was rotated or removed
// mid-session (billing switched to the plan, key deleted from .env by hand).
// Keyed on the value, so the comparison is the whole test.
let _client = null;
let _clientKey = null;
export function anthropicClient() {
  const key = (process.env.ANTHROPIC_API_KEY || '').trim();
  if (!_client || _clientKey !== key) {
    _client = new Anthropic({ apiKey: key });
    _clientKey = key;
  }
  return _client;
}

// The model the draft/outreach features should use, from the user's per-section
// choice (TJK_DRAFT_MODEL, default haiku). Returned as a full model id for the
// SDK path; generateText down-maps it to a CLI alias on the plan path.
export function draftModel() {
  return resolveModelId(currentModel('draft'));
}

// The SDK-based draft features (cover letters, resume tailoring, recruiter / TA
// / LinkedIn outreach) need the user's own ANTHROPIC_API_KEY. Evaluate and Scan
// do NOT — they run on the user's Claude Pro login via the `claude` CLI. The SDK
// does not throw at construction when the key is absent, so the server still
// boots for a keyless install; draft routes guard with this and return a clear
// message instead of surfacing a raw SDK auth error at call time.
export function hasAnthropicKey() {
  return !!(process.env.ANTHROPIC_API_KEY || '').trim();
}
export const NO_KEY_ERROR = 'AI drafts need either an Anthropic API key (ANTHROPIC_API_KEY in dashboard-web/.env, the faster path) or a signed-in Claude (run `claude login`, the same login used by Scan and Evaluate).';

// Billing mode gate: 'plan' forces everything onto the flat Claude subscription
// even when a key is saved (the Models & Cost billing toggle), so the user can
// cap API spend without deleting their key.
export function planForced() { return currentBilling() === 'plan'; }

// Whether the API key should actually be used right now: a key is present AND
// billing isn't forced to the plan. This is the switch both AI paths honor —
// generateText (below) and effectivePower in routes/agent.mjs.
export function apiKeyActive() { return hasAnthropicKey() && !planForced(); }

// Turn a raw Anthropic SDK error into a clear, actionable message for the user.
// The single-rail rule is "no silent fallback": when billing is the key and the
// key is refused (usage limit / spend cap / rate limit / bad key), we stop with a
// message that names the fix, rather than quietly re-running on the plan. This is
// the exact failure that shipped as a raw 400 ("You have reached your specified
// API usage limits") and killed draft generation with no explanation.
export const CONSOLE_LIMITS_URL = 'https://console.anthropic.com/settings/limits';
export function apiKeyErrorMessage(err) {
  const status = err?.status ?? err?.statusCode;
  const raw = (err?.message || String(err || '')).trim();
  const capped = status === 429
    || /usage limit|spend|quota|rate limit|reached your|credit balance|insufficient|billing/i.test(raw);
  if (capped) {
    return `Your Anthropic API key was refused (usage limit or spend cap): ${raw}. `
      + `Raise or check the cap at ${CONSOLE_LIMITS_URL}, or switch Setup -> Models & cost `
      + `billing to your Claude plan to run this on your subscription instead. No automatic `
      + `fallback: your billing choice is respected.`;
  }
  return `The Anthropic API call failed on your API key: ${raw}. Check the key in `
    + `dashboard-web/.env, or switch Setup -> Models & cost billing to your Claude plan.`;
}

// Unified text generation. When an ANTHROPIC_API_KEY is present we use the API
// directly (fast, model-pinned, supports tools/thinking). Otherwise we run the
// prompt on the user's Claude PLAN via the bundled `claude` CLI — no key needed.
// Returns the model's text; callers do their own JSON.parse / stripping on it.
// Pass `tools` (a web_search tool def) to enable web search on either path.
export async function generateText(prompt, opts = {}) {
  // Test seam: return a canned response without touching the model or the network,
  // so route smoke-tests can exercise a handler's full path (including its response
  // assembly) and fail on a dangling variable the way a real click would. Default
  // is a JSON object string because most draft handlers JSON.parse the output.
  if (process.env.TJK_FAKE_LLM) {
    return process.env.TJK_FAKE_LLM_TEXT || '{"subject":"Stub subject","body":"Stub body."}';
  }
  const { system, model, maxTokens = 1024, tools, ...rest } = opts;
  if (apiKeyActive()) {
    // Single-rail: billing is set to the key, so a capped/failing key does NOT
    // silently fall back to the plan (that would bill a rail the user did not
    // choose). Surface a clear, actionable message and let the user decide —
    // raise the console cap, or switch Setup -> Models & cost billing to the plan.
    let msg;
    try {
      msg = await anthropicClient().messages.create({
        // Callers may pass a bare alias (haiku/sonnet/opus) or a full id; the SDK
        // needs a full id, so resolve. Falls back to Haiku when unset.
        model: resolveModelId(model) || 'claude-haiku-4-5',
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        ...(tools ? { tools } : {}),
        ...rest, // e.g. thinking / output_config for insights
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (err) {
      throw new Error(apiKeyErrorMessage(err));
    }
    return (msg.content || [])
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  }
  // Keyless: run on the Claude plan. `tools` maps to the CLI's WebSearch tool.
  return runClaudePrompt(prompt, {
    model,
    system,
    allowedTools: tools ? 'WebSearch' : undefined,
  });
}

// Strip a leading salutation line ("Hi Emmi,", "Hello Emmi,", "Dear Emmi,",
// or bare "Emmi,") that the model sometimes prepends even when told not to.
// The TA drawer (and any other UI) renders its own "Hi {first}," — without
// this strip, both lines appear and the email reads as "Hi Emmi,\n\nEmmi,\n…".
function _stripLeadingSalutation(body, firstName) {
  if (!body) return body;
  let s = body.replace(/^\s+/, '');
  const first = (firstName || '').trim();
  const firstPattern = first ? first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '[A-Z][a-zA-Z\\-\']{1,30}';
  // Greeting + name: "Hi Emmi," / "Hello Emmi,"  / "Dear Emmi,"
  const greetingRe = new RegExp(`^(?:hi|hello|hey|dear|greetings)\\s+${firstPattern}\\s*[,\\-—:]+\\s*\\n+`, 'i');
  s = s.replace(greetingRe, '');
  // Bare name on its own line OR inline: "Emmi,\n…" / "Emmi, I'm reaching out…"
  // (only strip if it matches the contact's first name)
  if (first) {
    const bareRe = new RegExp(`^${firstPattern}\\s*[,\\-—:]\\s*`, 'i');
    s = s.replace(bareRe, '');
  }
  return s.replace(/^\s+/, '');
}

// Strip a trailing sign-off block ("Best,\n<first name>" / "Regards,\n<full
// name>" / "Sincerely,\n..." / etc.) that the model sometimes appends even
// when told no signature block. The UI wraps drafts with the user's own
// contact-rich sign-off, so any model-appended one is a duplicate. The user's
// name comes from config/profile.yml (via getIdentity) — nothing hardcoded.
function _stripTrailingSignature(body, userFirstName, userLastName) {
  if (!body) return body;
  if (userFirstName === undefined) userFirstName = getIdentity().firstName;
  if (userLastName === undefined) userLastName = getIdentity().lastName;
  const s = body.replace(/\s+$/, '');
  const lines = s.split('\n');

  // Bare user-name line at the bottom (first name, or full name on its own) —
  // the model often appends this as an informal sign-off even when told not
  // to. Strip it; the UI's signature owns the closer. Only act when we know
  // the name (a fresh, pre-onboarding profile yields empty names).
  const fn = (userFirstName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ln = (userLastName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (fn || ln) {
    const alts = [fn ? `${fn}(?:\\s+${ln})?` : '', ln].filter(Boolean).join('|');
    const userNameRe = new RegExp(`^(?:${alts})\\s*[,.!]?\\s*$`, 'i');
    while (lines.length > 0) {
      const last = lines[lines.length - 1].trim();
      if (!last) { lines.pop(); continue; }
      if (userNameRe.test(last)) { lines.pop(); continue; }
      break;
    }
  }

  // Patterns that identify a "signature-shaped" trailing line. The model
  // sometimes signs off with a closer word ("Best,"), sometimes just appends
  // the user's name, sometimes drops a bare contact row with no closer at
  // all. We walk lines from the bottom and strip anything signature-like
  // until we hit real prose.
  const closerRe       = /^(?:best|regards|sincerely|cheers|thanks|thank you|warmly|all the best|best regards|kind regards|warm regards|talk soon|looking forward)\s*[,!.]?\s*$/i;
  const phoneLineRe    = /^\s*\+?\d[\d\s.()\-]{6,}\s*$/;
  const emailLineRe    = /^\s*[\w.+\-]+@[\w.\-]+\.[a-z]{2,}\s*$/i;
  const urlLineRe      = /^\s*(?:https?:\/\/)?(?:www\.)?[\w\-]+(?:\.[\w\-]+)+(?:\/\S*)?\s*$/i;
  const pipeRowRe      = /\s\|\s/;                       // contact-row format with pipe separators
  const shortNameRe    = /^[A-Z][a-zA-Z'\-]+(?:\s+[A-Z][a-zA-Z'\-]+){0,3}$/;  // 1–4 capitalized tokens

  let strippedAnchor = false;  // gate name-line stripping until we've removed a closer/contact line
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) { lines.pop(); continue; }
    if (closerRe.test(last) || phoneLineRe.test(last) || emailLineRe.test(last) ||
        urlLineRe.test(last) || pipeRowRe.test(last)) {
      lines.pop();
      strippedAnchor = true;
      continue;
    }
    if (shortNameRe.test(last)) {
      // Name-only line: strip if we've already stripped a closer/contact
      // line OR if the line directly above is a closer ("Best,\n<name>"
      // pattern). Without the lookback, simple "Best,\n<name>" sign-offs
      // never trigger because the name is the bottom line.
      const prevIdx = lines.length - 2;
      const prevLine = prevIdx >= 0 ? lines[prevIdx].trim() : '';
      if (strippedAnchor || closerRe.test(prevLine)) {
        lines.pop();
        strippedAnchor = true;
        continue;
      }
    }
    break;
  }
  return lines.join('\n').replace(/\s+$/, '');
}

// _replaceEmDashes now lives in the shared hygiene core (lib/text-hygiene-core.mjs)
// and is imported + re-exported here UNCHANGED, so its two consumers
// (routes/recruiters.mjs, routes/target-talent.mjs) keep importing it from this
// module. See dashboard-web/server/lib/text-hygiene.mjs for the full preset set.
function readProjectFile(projectRoot, relPath) {
  try {
    return fs.readFileSync(path.join(projectRoot, relPath), 'utf8');
  } catch {
    return `[${relPath} not found]`;
  }
}

export { _stripLeadingSalutation, _stripTrailingSignature, _replaceEmDashes, readProjectFile };

