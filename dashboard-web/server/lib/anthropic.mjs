import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
// Side-effect import: ensures dashboard-web/.env is loaded before the client
// reads ANTHROPIC_API_KEY.
import '../config.mjs';
import { getIdentity } from './profile.mjs';
import { runClaudePrompt } from './claude-cli.mjs';
import { resolveModelId, currentModel, currentBilling } from './pricing.mjs';

export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// Unified text generation. When an ANTHROPIC_API_KEY is present we use the API
// directly (fast, model-pinned, supports tools/thinking). Otherwise we run the
// prompt on the user's Claude PLAN via the bundled `claude` CLI — no key needed.
// Returns the model's text; callers do their own JSON.parse / stripping on it.
// Pass `tools` (a web_search tool def) to enable web search on either path.
export async function generateText(prompt, opts = {}) {
  const { system, model, maxTokens = 1024, tools, ...rest } = opts;
  if (apiKeyActive()) {
    const msg = await anthropic.messages.create({
      // Callers may pass a bare alias (haiku/sonnet/opus) or a full id; the SDK
      // needs a full id, so resolve. Falls back to Haiku when unset.
      model: resolveModelId(model) || 'claude-haiku-4-5',
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      ...(tools ? { tools } : {}),
      ...rest, // e.g. thinking / output_config for insights
      messages: [{ role: 'user', content: prompt }],
    });
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

// Replace em dashes with commas (and clean up the spacing/double-comma it
// creates). The model is told no em dashes in the prompt but ignores it
// often. Em dash (U+2014) is the AI-prose tell; comma is the safest
// universal replacement that preserves clause structure.
function _replaceEmDashes(body) {
  if (!body) return body;
  return body
    .replace(/\s+—\s+/g, ', ')    // " — " (spaced) → ", "
    .replace(/—/g, ', ')           // bare em dash → ", "
    .replace(/\s+,/g, ',')         // remove space-before-comma artifacts
    .replace(/,\s*,+/g, ',');      // collapse double commas
}
function readProjectFile(projectRoot, relPath) {
  try {
    return fs.readFileSync(path.join(projectRoot, relPath), 'utf8');
  } catch {
    return `[${relPath} not found]`;
  }
}

export { _stripLeadingSalutation, _stripTrailingSignature, _replaceEmDashes, readProjectFile };

