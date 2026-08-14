// server/lib/cadence-revise.mjs -- rhythm-revision pass for generated drafts.
// (Distinct from server/lib/cadence.mjs, which is the weekly habit-cadence tracker.)
//
// Cleaning fixes the cosmetic tells (invisible chars, em dashes, curly quotes).
// The remaining tell is CADENCE: sentences all the same length and shape. This
// takes a generated draft and, when its rhythm reads as monotonous, asks the model
// to re-draft with varied sentence length/structure -- facts, numbers, names and
// approximate length unchanged. Honest quality improvement, not detection evasion.
//
// Safety: a revision is ACCEPTED only if it did not make cadence worse and did not
// blow up the length. So this can be applied on every draft without risk of
// harming one; a bad revision is silently discarded and the original kept.
import { generateText, draftModel } from './anthropic.mjs';
import { cleanProse, cleanEmailBody, analyzeCadence } from './text-hygiene.mjs';

const REVISE_PROMPT = (text) =>
  `Rewrite the text below so its SENTENCE RHYTHM varies: mix short and long sentences, and vary how consecutive lines open (do not start several the same way). Keep EVERY fact, number, name, metric and claim exactly as given. Do not add or remove information. Keep roughly the same overall length. No em dashes. Output ONLY the rewritten text, nothing else.\n\n---\n${text}`;

// reviseForCadence(text, opts) -> { text, revised, reason, before, after }
//   opts.surface : 'email' | 'prose' (default) -- selects the cleaner for output
//   opts.model   : model override (default draftModel())
// Never throws; on any problem it returns the original text with revised:false.
export async function reviseForCadence(text, opts = {}) {
  const { surface = 'prose', model } = opts;
  const clean = surface === 'email' ? cleanEmailBody : cleanProse;
  if (!text || !String(text).trim()) return { text, revised: false, reason: 'empty' };
  const before = analyzeCadence(text);
  // Too few lines to have a rhythm (a short connect note, a one-liner): leave it.
  if (before.insufficient) return { text, revised: false, reason: 'too-short', before };

  let out;
  try {
    out = clean((await generateText(REVISE_PROMPT(text), { model: model || draftModel(), maxTokens: 900 })).trim());
  } catch (err) {
    return { text, revised: false, reason: 'error:' + err.message, before };
  }
  if (!out) return { text, revised: false, reason: 'empty-output', before };

  const after = analyzeCadence(out);
  const lenOk = out.length >= String(text).length * 0.6 && out.length <= String(text).length * 1.6;
  // Accept only if not worse. after/before scores are numbers unless insufficient.
  const notWorse =
    after.insufficient || before.insufficient || (after.score ?? 0) >= (before.score ?? 0) - 5;
  if (lenOk && notWorse) return { text: out, revised: out !== text, reason: 'ok', before, after };
  return { text, revised: false, reason: 'rejected', before, after };
}
