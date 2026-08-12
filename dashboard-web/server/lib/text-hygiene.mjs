// dashboard-web/server/lib/text-hygiene.mjs -- server-facing entry point for the
// text-hygiene layer. The transforms themselves live in the shared, dependency-free
// core (lib/text-hygiene-core.mjs) so the root Tier-B maintenance script
// (clean-generated-text.mjs) imports the SAME code. Server routes/libs import their
// presets from here, giving one local import path and a home for any future
// server-only helper.
//
// Presets, from safest to most aggressive:
//   cleanUniversal    - strip invisibles + fold Unicode spaces + normalize newlines.
//                       No punctuation changes. Use for non-English output.
//   cleanAtsField     - universal + curly->straight ONLY. Length-stable; use for the
//                       four resume docx slots (title/subtitle/summary/AoE).
//   cleanProse        - universal + curly + em-dash/"--" + ellipsis. General prose.
//   cleanEmailBody    - same house-style as prose, for email bodies.
//   cleanEmailSubject - prose house-style + newlines flattened to one line.
//   cleanMarkdownProse- prose minus the "--" rule (safe for markdown tables/rules).
//
// _replaceEmDashes is re-exported UNCHANGED so its existing consumers
// (routes/recruiters.mjs, routes/target-talent.mjs) keep importing it from here.
export {
  cleanText,
  cleanUniversal,
  cleanProse,
  cleanEmailBody,
  cleanEmailSubject,
  cleanAtsField,
  cleanMarkdownProse,
  _replaceEmDashes,
} from '../../../lib/text-hygiene-core.mjs';
