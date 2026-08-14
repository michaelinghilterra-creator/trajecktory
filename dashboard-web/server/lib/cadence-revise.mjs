// server/lib/cadence-revise.mjs -- combined rhythm + plain-language revision pass
// for generated drafts. (Distinct from server/lib/cadence.mjs, the weekly tracker.)
//
// Cleaning fixes the cosmetic tells (invisible chars, em dashes, curly quotes).
// The two that need judgment are monotonous CADENCE (every sentence the same
// length/shape) and AI-flavored WORD CHOICE (delve, leverage, filler, cliche
// openers). This applies the always-safe filler swaps deterministically
// (stripRedundantFiller), then asks the model to vary the rhythm AND plain the
// language in one pass -- facts, numbers, names and approximate length unchanged.
// Honest quality improvement, not detection evasion.
//
// Safety: the LLM revision is ACCEPTED only if it did not make cadence worse and
// did not blow up the length. If rejected, the deterministic filler swaps still
// stand (they are always safe), so this can run on every draft without harming one.
import { generateText, draftModel } from './anthropic.mjs';
import { cleanProse, cleanEmailBody, analyzeCadence, stripRedundantFiller } from './text-hygiene.mjs';

const REVISE_PROMPT = (text) =>
  `Rewrite the text below so it reads like a person wrote it, not a machine.\n1. Vary the SENTENCE RHYTHM: mix short and long sentences, and vary how consecutive lines open (do not start several the same way).\n2. Use PLAIN words: avoid AI-flavored vocabulary (for example delve, leverage, robust, seamless, spearhead, foster, elevate, unlock, tapestry, pivotal, testament), cut filler and hedges, and do not open with a cliche or flattering line.\nDo not over-bullet prose. Keep EVERY fact, number, name, metric and claim exactly as given. Do not add or remove information. Keep roughly the same overall length. No em dashes. Output ONLY the rewritten text, nothing else.\n\n---\n${text}`;

// reviseForCadence(text, opts) -> { text, revised, reason, before, after }
//   opts.surface : 'email' | 'prose' (default) -- selects the cleaner for output
//   opts.model   : model override (default draftModel())
// Never throws; on any problem it returns the (filler-swapped) text, revised:false.
export async function reviseForCadence(text, opts = {}) {
  const { surface = 'prose', model } = opts;
  const clean = surface === 'email' ? cleanEmailBody : cleanProse;
  if (!text || !String(text).trim()) return { text, revised: false, reason: 'empty' };
  // Always-safe deterministic swaps first ("in order to" -> "to"); this is the
  // fallback we keep if the LLM revision is skipped or rejected.
  const base = stripRedundantFiller(String(text));
  const before = analyzeCadence(base);
  // Too few lines to have a rhythm (a short connect note): keep the swapped text.
  if (before.insufficient) return { text: base, revised: base !== text, reason: 'too-short', before };

  let out;
  try {
    out = clean((await generateText(REVISE_PROMPT(base), { model: model || draftModel(), maxTokens: 900 })).trim());
  } catch (err) {
    return { text: base, revised: base !== text, reason: 'error:' + err.message, before };
  }
  if (!out) return { text: base, revised: base !== text, reason: 'empty-output', before };

  const after = analyzeCadence(out);
  const lenOk = out.length >= base.length * 0.6 && out.length <= base.length * 1.6;
  // Accept only if cadence did not get worse. Scores are numbers unless insufficient.
  const notWorse =
    after.insufficient || before.insufficient || (after.score ?? 0) >= (before.score ?? 0) - 5;
  if (lenOk && notWorse) return { text: out, revised: out !== text, reason: 'ok', before, after };
  return { text: base, revised: base !== text, reason: 'rejected', before, after };
}
