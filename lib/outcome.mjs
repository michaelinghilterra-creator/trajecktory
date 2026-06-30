/**
 * lib/outcome.mjs — status normalization and outcome classification for the
 * analytics scripts.
 *
 * Extracted from analyze-patterns.mjs so classifyOutcome is unit-testable, and
 * to begin consolidating the status-alias logic the audit found duplicated
 * across scripts (full consolidation against templates/states.yml is M2-1).
 */

// Mirrors templates/states.yml aliases. (M2-1 will load states.yml directly so
// this copy stops drifting.)
export const ALIASES = {
  'evaluada': 'evaluated', 'condicional': 'evaluated', 'hold': 'evaluated',
  'evaluar': 'evaluated', 'verificar': 'evaluated',
  'aplicado': 'applied', 'enviada': 'applied', 'aplicada': 'applied',
  'applied': 'applied', 'sent': 'applied',
  'respondido': 'responded',
  // Interview ladder. Legacy 'interview'/'entrevista' fold into the 1st round.
  'entrevista': '1st interview', 'interview': '1st interview',
  'ta screen': 'phone screen', 'ta phone screen': 'phone screen',
  'recruiter screen': 'phone screen', 'hr screen': 'phone screen',
  'first interview': '1st interview', 'round 1': '1st interview',
  'second interview': '2nd interview', 'round 2': '2nd interview',
  'third interview': '3rd interview', 'round 3': '3rd interview',
  'fourth interview': '4th interview', 'round 4': '4th interview',
  'final round': '4th interview', 'final loop': '4th interview',
  'oferta': 'offer',
  'rechazado': 'rejected', 'rechazada': 'rejected',
  'descartado': 'discarded', 'descartada': 'discarded',
  'cerrada': 'discarded', 'cancelada': 'discarded',
  'no aplicar': 'skip', 'no_aplicar': 'skip', 'monitor': 'skip', 'geo blocker': 'skip',
};

export function normalizeStatus(raw) {
  const clean = String(raw ?? '').replace(/\*\*/g, '').trim().toLowerCase()
    .replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  return ALIASES[clean] || clean;
}

// The outcome buckets used by the analytics. Order matters only for display.
// 'closed' is a distinct bucket so that postings that closed before the user
// could act are NOT lumped into 'pending' (which would pollute the score-vs-
// outcome stats) and are excluded from conversion-rate denominators per the
// project's data rule (Closed != Discarded).
export const OUTCOMES = ['positive', 'negative', 'self_filtered', 'closed', 'pending'];

// Interview-family rungs (normalized lowercase), plus legacy 'interview'.
const INTERVIEW_STAGES = ['phone screen', '1st interview', '2nd interview', '3rd interview', '4th interview', 'interview'];

export function classifyOutcome(status) {
  const s = normalizeStatus(status);
  if ([...INTERVIEW_STAGES, 'offer', 'responded', 'applied'].includes(s)) return 'positive';
  if (['rejected', 'discarded'].includes(s)) return 'negative';
  if (s === 'closed') return 'closed';
  // 'not a fit' is a user self-filter (the user decided not to pursue), grouped
  // with skip rather than treated as an in-flight 'pending' row.
  if (['skip', 'not a fit', 'not_a_fit', 'naf'].includes(s)) return 'self_filtered';
  return 'pending'; // evaluated and anything else not yet acted on
}

// Build a zeroed { total, ...outcomes } counter so breakdown maps never miss a
// bucket key when a new outcome is added.
export function zeroOutcomeCounts() {
  const o = { total: 0 };
  for (const k of OUTCOMES) o[k] = 0;
  return o;
}

// Win rate among applications that actually reached a decision (positive or
// negative). Excludes closed, self-filtered, and still-pending rows from the
// denominator. Returns an integer percentage, 0 when nothing has been decided.
export function conversionRate(counts) {
  const decided = (counts.positive || 0) + (counts.negative || 0);
  return decided > 0 ? Math.round((counts.positive / decided) * 100) : 0;
}
