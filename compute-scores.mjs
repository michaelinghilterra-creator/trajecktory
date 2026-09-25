#!/usr/bin/env node
/**
 * compute-scores.mjs — the deterministic step that turns an evaluation's
 * per-dimension ratings into the headline score.
 *
 * This is the "code computes the headline" half of the scoring redesign. The eval
 * model rates each dimension 0-5 with evidence (the keyed globalScore array); this
 * script derives the headline via lib/score.mjs and stamps it into the report as
 * `score` + `scoreSource: "derived"` + `scoreBasis` (the audit trail). The model
 * never authors the number, so it can never disagree with its own breakdown.
 *
 * A report with no KEYED dimensions (every historical report, which used unkeyed
 * labels) is left completely untouched and read as legacy: we never silently
 * recompute a number that was authored under the old rubric.
 *
 * Usage:
 *   node compute-scores.mjs reports/123-foo-2026-07-23.md            # dry run (default)
 *   node compute-scores.mjs reports/123-foo-2026-07-23.md --apply    # write the fields
 *   node compute-scores.mjs --all [--apply]                          # every derivable report
 *   node compute-scores.mjs reports/123-foo.md --print-score         # print only the number
 *
 * Dry run is the default (prints what would change, writes nothing), matching the
 * data-safety discipline in this repo. The report body below the frontmatter is
 * preserved exactly; only the JSON frontmatter is rewritten.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasV1Frontmatter, parseV1 } from './dashboard-web/server/v1-loader.mjs';
import { deriveScore, loadScoringWeights, SCORE_DIMENSIONS, applyLevelFloor, leadTitle, DEFAULT_MINIMUM_LEVEL, compCeiling, buildDepthCeiling } from './lib/score.mjs';

const round1 = (n) => Math.round(n * 10) / 10;

// Pure core: given a report's markdown, return the derivation outcome and (when
// derivable) the rewritten markdown. No file I/O, so it is unit-tested directly.
//   reason: 'not-v1' | 'no-keyed-dims' | 'not-derivable' | 'ok'
export function deriveReportScore(md, { weights, redFlagPenalty, minimumLevel, compMinimum, nonManagementTitles, buildDepthCeilings } = {}) {
  if (!hasV1Frontmatter(md)) return { ok: false, reason: 'not-v1' };
  let parsed;
  try { parsed = parseV1(md); } catch { return { ok: false, reason: 'not-v1' }; }
  const { data, body } = parsed;
  const gs = Array.isArray(data.globalScore) ? data.globalScore : [];
  const keyed = new Set(SCORE_DIMENSIONS.map(s => s.key));
  // Only NEW-style reports carry keyed positive dimensions. Legacy labels have no
  // key, so this leaves every historical report untouched (implicit legacy).
  const hasKeyed = gs.some(d => d && typeof d.key === 'string' && keyed.has(d.key));
  if (!hasKeyed) return { ok: false, reason: 'no-keyed-dims', score: data.score ?? null };

  // Level-match policy: a Manager-or-above JD title is a FULL level match, never a
  // downlevel (scope is open from Manager up). Floor the level dimension BEFORE
  // deriving so no model rating can drag the headline for an in-scope title. The
  // candidate's own title comes from levelMatch/summary; leadTitle() inside
  // applyLevelFloor strips "(reports to Director…)"-style context so a role that
  // merely reports to a Director is not misread as one.
  const detectedLevel = (data.levelMatch && data.levelMatch.jdLevel) || (data.summary && data.summary.seniority) || null;
  const floor = applyLevelFloor(gs, detectedLevel, minimumLevel, nonManagementTitles);
  const dimsForScore = floor.dims;

  // A hard ceiling (a location you will not work, visa you cannot get) caps the
  // headline no matter how well the rest scores. The eval sets it; the code enforces it.
  //
  // EXCEPT for comp. "Is this band below the floor" is arithmetic, and models get
  // the direction wrong (see tests/comp-ceiling.test.mjs). When a report says its
  // cap is a COMP cap, the authored number is discarded and recomputed from
  // compensation.minimum.
  //
  // WHICH cap it is must be declared, never inferred from prose. This first
  // matched /\b(comp|pay|salary|base|band|floor|OTE)\b/ against ceilingReason,
  // which is wrong in both directions: a LOCATION cap whose reason mentions "base
  // pay" would be silently replaced by a comp computation, and an evaluator can
  // steer around the pattern by choosing different words. One did exactly that and
  // said so, which is how this was found. Attribution by substring over free text
  // is the same defect as levelRank matching "Manager" inside "Product Manager".
  //
  // ceilingBasis is the declaration: "comp" | "location" | "level" | "buildDepth"
  // | "requirement" | "other". "comp" and "buildDepth" trigger recomputation,
  // because both are arithmetic over something already in the report: a stated
  // band against the configured floor, and a 0-5 rating against the configured
  // tiers. The rest are judgment and keep the authored number.
  //
  // A report with a ceiling but NO ceilingBasis keeps its authored number
  // untouched. That is deliberate: every historical report predates this field,
  // and guessing their basis from prose is the very thing being removed.
  let ceiling = typeof data.scoreCeiling === 'number' && Number.isFinite(data.scoreCeiling) ? data.scoreCeiling : null;
  let ceilingSource = ceiling === null ? null : 'authored';
  const basis = typeof data.ceilingBasis === 'string' ? data.ceilingBasis.trim().toLowerCase() : '';
  if (basis === 'comp') {
    const cc = compCeiling(data.summary && data.summary.compStated, { minimum: compMinimum });
    ceiling = cc.ceiling;
    ceilingSource = `comp:${cc.reason}`;
  } else if (basis === 'builddepth') {
    const bd = gs.find((d) => d && d.key === 'buildDepth');
    const bc = buildDepthCeiling(bd && (bd.val ?? bd.score), { ceilings: buildDepthCeilings });
    ceiling = bc.ceiling;
    ceilingSource = `buildDepth:${bc.reason}`;
  }
  const res = deriveScore(dimsForScore, { weights, redFlagPenalty, ceiling });
  if (!res.derivable) return { ok: false, reason: 'not-derivable', score: data.score ?? null };

  const weightedAverage = round1(res.contributions.reduce((a, c) => a + c.points, 0));
  const scoreBasis = {
    weights: res.weightsUsed,          // renormalized weights actually applied
    contributions: res.contributions,  // { key, val, weight, points } — points reconstruct the average
    penalty: res.penalty,
    weightedAverage,
    // Record the level floor when it fired, so the score change is auditable and the
    // drawer can explain why a Manager+ title scores a full 5 on level.
    ...(floor.floored ? { levelFloor: { applied: true, detectedLevel, from: floor.from, to: 5, minimumLevel: minimumLevel || DEFAULT_MINIMUM_LEVEL } } : {}),
    // `uncapped` rides along only when a ceiling exists, because that is the only
    // time it differs from the headline. Without it the drawer prints a formula
    // summing to one number under a headline showing another.
    ...(res.ceiling !== null ? { ceiling: res.ceiling, ceilingApplied: res.ceilingApplied, uncapped: res.uncapped } : {}),
  };
  // When the floor fired, persist the raised level dimension so the report's own
  // breakdown matches the headline (the drawer reads globalScore) and annotate the
  // evidence so the change is self-explaining. Otherwise globalScore is untouched.
  let globalScore = data.globalScore;
  if (floor.floored) {
    const label = leadTitle(detectedLevel) || String(detectedLevel);
    globalScore = dimsForScore.map((d) => {
      if (d && d.key === 'level') {
        const base = typeof d.evidence === 'string' && d.evidence ? d.evidence.trimEnd() + ' ' : '';
        return { ...d, evidence: `${base}[Level floored to 5: "${label}" is at or above the ${minimumLevel || DEFAULT_MINIMUM_LEVEL} minimum — an in-scope title is a full level match, not a downlevel (policy 2026-08-17).]` };
      }
      return d;
    });
  }
  // Preserve key order: keep score in place, append the new keys. The body is
  // re-emitted byte-for-byte; only the frontmatter JSON is rewritten.
  const newData = { ...data, globalScore, score: res.score, scoreSource: 'derived', scoreBasis };
  const newMd = `---\n${JSON.stringify(newData, null, 2)}\n---\n${body}`;
  return {
    ok: true, reason: 'ok', score: res.score, prevScore: data.score ?? null,
    changed: newMd !== md, newMd, scoreBasis,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
export function writeReportIfChanged(file, originalMd, result, writer = fs.writeFileSync) {
  if (result.newMd === originalMd) return false;
  writer(file, result.newMd);
  return true;
}

function isMain() {
  try { return path.resolve(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; }
}

function listAllReports() {
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'reports');
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)); }
  catch { return []; }
}

function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const all = args.includes('--all');
  const printScore = args.includes('--print-score');
  const files = args.filter(a => !a.startsWith('--'));

  const weights = loadScoringWeights();
  const targets = all ? listAllReports() : files;
  if (!targets.length) {
    console.error('Usage: node compute-scores.mjs <report.md> [--apply] | --all [--apply] | <report.md> --print-score');
    process.exit(2);
  }

  let derived = 0, skipped = 0, wrote = 0, unchanged = 0;
  for (const file of targets) {
    let md;
    try { md = fs.readFileSync(file, 'utf8'); }
    catch { console.error(`  ✗ cannot read ${file}`); skipped++; continue; }
    const r = deriveReportScore(md, weights);
    if (!r.ok) {
      // Silent for the common legacy case under --all; explicit for a single file.
      if (!all) console.log(`  – ${path.basename(file)}: left as-is (${r.reason}${r.score != null ? `, score ${r.score}` : ''})`);
      skipped++;
      continue;
    }
    if (printScore) { console.log(r.score); continue; }
    derived++;
    const verb = apply ? 'set' : 'would set';
    console.log(`  ${apply ? '✓' : '·'} ${path.basename(file)}: ${verb} score ${r.score} (was ${r.prevScore ?? 'unset'}) [derived]`);
    if (apply && r.changed) {
      try { if (writeReportIfChanged(file, md, r)) wrote++; else unchanged++; }
      catch (e) { console.error(`    ✗ write failed: ${e.message}`); }
    } else if (apply) {
      unchanged++;
    }
  }

  if (!printScore) {
    const mode = apply ? 'applied' : 'dry run';
    console.log(`\n${derived} derivable, ${skipped} left as-is, ${wrote} written, ${unchanged} unchanged (${mode}).`);
    if (!apply && derived > 0) console.log('Re-run with --apply to write.');
  }
}

if (isMain()) main();
