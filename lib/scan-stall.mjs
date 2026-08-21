// lib/scan-stall.mjs — detect the Agent Scan "narrate-and-quit" failure.
//
// WHY THIS EXISTS:
// The scan agent's discovery half is an open-ended WebSearch step ("find
// companies not yet tracked"). A small model (Haiku, the cheap default) sometimes
// runs the deterministic prep steps, then at the discovery step emits a shell
// `echo "Performing discovery searches for emerging companies.."` — narrating the
// action instead of calling WebSearch — and ends its turn. The run exits cleanly,
// so the only symptom was the generic "wrote nothing" warning, which lumps this
// together with two unrelated causes. Reproduced 2026-08-21.
//
// The signature is precise and must NOT be confused with a legitimate empty run:
//   - STALL:  it never searched at all (webSearchCount === 0) AND nothing landed.
//   - NORMAL: it searched (webSearchCount > 0) and genuinely found no NEW company
//             — the common case (a narrow title filter, an already-swept universe).
//
// So the discriminator is webSearchCount, not the emptiness of the result. Only a
// zero-search run is a stall worth retrying on a stronger model; a searched-but-
// empty run is honest work and must be left alone.
//
// Pure and side-effect-free so it is unit-testable away from the spawn/agent
// plumbing (nothing tests a prompt; this makes the guard itself testable).
// Guarded by tests/scan-stall.test.mjs.

/**
 * @param {object} o
 * @param {number} o.webSearchCount  WebSearch tool calls the run issued.
 * @param {number} [o.added]         New companies merged into portals.yml.
 * @param {number} [o.rolesAdded]    New live roles those companies added to the pipeline.
 * @returns {boolean} true when the discovery step stalled (never searched, produced nothing).
 */
export function scanDiscoveryStalled({ webSearchCount, added = 0, rolesAdded = 0 } = {}) {
  const searched = Number(webSearchCount) > 0;
  const producedSomething = Number(added) > 0 || Number(rolesAdded) > 0;
  return !searched && !producedSomething;
}
