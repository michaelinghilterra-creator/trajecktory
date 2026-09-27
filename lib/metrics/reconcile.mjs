// Tie-out checks for the metrics core: the same fact is drawn in several places (the funnel's first rung and
// every rate's denominator, this week's tiles and the weekly chart's last bar), so each place is checked against
// the others. The dashboard shows a warning instead of numbers that disagree. Pure; never throws.

const RATE_PATHS = [
  ['response', 'all'], ['response', 'mature'], ['response', 'warm'], ['response', 'notWarm'],
  ['positive', 'all'], ['positive', 'mature'],
  ['interview', 'all'], ['interview', 'mature'], ['interview', 'warm'], ['interview', 'notWarm'],
  ['referral', 'all'], ['outreach', 'email'], ['outreach', 'linkedin'],
];

const MISSING = Symbol('missing');

function rule(id, test) {
  try {
    const out = test();
    if (out === MISSING) return { id, ok: false, detail: 'missing' };
    return { id, ok: out.ok === true, detail: out.detail || '' };
  } catch {
    return { id, ok: false, detail: 'missing' };
  }
}

const isNum = value => typeof value === 'number' && Number.isFinite(value);
const need = (...values) => values.every(value => value !== undefined && value !== null);

function rateOk(r) {
  if (!r || !isNum(r.k) || !isNum(r.n)) return false;
  if (r.k < 0 || r.k > r.n) return false;
  return r.n > 0 ? r.pct === Math.round((r.k / r.n) * 100) : r.pct === null;
}

/** One `{ id, ok, detail }` per tie-out rule, in a fixed order. */
export function reconcileCore(core) {
  const c = core && typeof core === 'object' ? core : {};
  const res = c.results || {};
  const funnel = Array.isArray(c.funnel) ? c.funnel : null;
  const rated = c.ratedApplications;

  return [
    rule('funnel_top_is_rated', () => {
      if (!funnel || !funnel.length || !need(rated)) return MISSING;
      return { ok: funnel[0].n === rated, detail: `funnel ${funnel[0].n}, rated ${rated}` };
    }),
    rule('rates_share_denominator', () => {
      const ns = [res.response?.all?.n, res.positive?.all?.n, res.interview?.all?.n, res.referral?.all?.n];
      if (!need(rated, ...ns)) return MISSING;
      return { ok: ns.every(n => n === rated), detail: `rated ${rated}, denominators ${ns.join(' ')}` };
    }),
    rule('funnel_heard_back_is_response', () => {
      if (!funnel || funnel.length < 2 || !need(res.response?.all?.k)) return MISSING;
      return { ok: funnel[1].n === res.response.all.k, detail: `funnel ${funnel[1].n}, response k ${res.response.all.k}` };
    }),
    rule('funnel_screen_is_interview_rate', () => {
      if (!funnel || funnel.length < 3 || !need(res.interview?.all?.k)) return MISSING;
      return { ok: funnel[2].n === res.interview.all.k, detail: `funnel ${funnel[2].n}, interview k ${res.interview.all.k}` };
    }),
    rule('funnel_never_grows', () => {
      if (!funnel) return MISSING;
      const bad = funnel.findIndex((rung, i) => i > 0 && rung.n > funnel[i - 1].n);
      return { ok: bad === -1, detail: bad === -1 ? '' : `rung ${bad} is larger than the rung above` };
    }),
    rule('funnel_conversions', () => {
      if (!funnel) return MISSING;
      const bad = funnel.findIndex((rung, i) => {
        if (i === 0) return false;
        const prev = funnel[i - 1].n;
        return prev > 0 ? rung.ofPrev !== Math.round((rung.n / prev) * 100) : rung.ofPrev !== null;
      });
      return { ok: bad === -1, detail: bad === -1 ? '' : `rung ${bad} conversion does not match its counts` };
    }),
    rule('positive_within_response', () => {
      const i = res.interview?.all?.k, p = res.positive?.all?.k, r = res.response?.all?.k;
      if (!need(i, p, r)) return MISSING;
      return { ok: i <= p && p <= r, detail: `interview ${i}, positive ${p}, response ${r}` };
    }),
    rule('mature_within_all', () => {
      const groups = ['response', 'positive', 'interview'].map(name => [res[name]?.mature, res[name]?.all]);
      if (groups.some(([m, a]) => !m || !a)) return MISSING;
      return { ok: groups.every(([m, a]) => m.n <= a.n && m.k <= a.k), detail: '' };
    }),
    rule('warm_split_adds_up', () => {
      const groups = ['response', 'interview'].map(name => res[name]);
      if (groups.some(g => !g?.warm || !g?.notWarm || !g?.all)) return MISSING;
      const ok = groups.every(g => g.warm.n + g.notWarm.n === g.all.n && g.warm.k + g.notWarm.k === g.all.k);
      return { ok, detail: '' };
    }),
    rule('rates_are_consistent', () => {
      const rates = RATE_PATHS.map(([a, b]) => res[a]?.[b]);
      if (rates.some(r => !r)) return MISSING;
      const bad = RATE_PATHS.filter((_, i) => !rateOk(rates[i])).map(([a, b]) => `${a}.${b}`);
      return { ok: bad.length === 0, detail: bad.join(', ') };
    }),
    rule('this_week_is_last_week_bar', () => {
      const last = Array.isArray(c.weeks) ? c.weeks[c.weeks.length - 1] : null;
      if (!last || !c.week || !c.thisWeek) return MISSING;
      const fields = ['applications', 'followups', 'linkedin', 'screensHeld'];
      const bad = fields.filter(f => last[f] !== c.thisWeek[f]);
      const ok = last.from === c.week.from && bad.length === 0;
      return { ok, detail: bad.length ? `differs: ${bad.join(', ')}` : (ok ? '' : 'last bar is not this week') };
    }),
    rule('cohorts_are_subsets', () => {
      if (!Array.isArray(c.weeks)) return MISSING;
      const bad = c.weeks.filter(w => !w.cohort || w.cohort.n > w.applications
        || w.cohort.responded > w.cohort.n || w.cohort.screened > w.cohort.responded);
      return { ok: bad.length === 0, detail: bad.map(w => w.from).join(', ') };
    }),
    rule('score_bands_within_rated', () => {
      const bands = c.scoreBands?.bands;
      if (!Array.isArray(bands) || !need(rated)) return MISSING;
      const applied = bands.reduce((sum, b) => sum + b.applied, 0);
      return { ok: bands.every(b => b.applied <= b.total) && applied <= rated, detail: `applied ${applied}, rated ${rated}` };
    }),
    rule('segments_add_up', () => {
      const sets = [c.segments?.archetype, c.segments?.source];
      if (sets.some(s => !s || !Array.isArray(s.rows) || !s.small) || !need(rated)) return MISSING;
      const ok = sets.every(s => s.rows.reduce((sum, r) => sum + r.n, 0) + s.small.n === rated
        && s.rows.every(r => r.response?.n === r.n && r.interview?.n === r.n));
      return { ok, detail: '' };
    }),
  ];
}

/** `{ ok, total, failed }` for a list of results from reconcileCore. */
export function reconcileSummary(results) {
  const list = Array.isArray(results) ? results : [];
  const failed = list.filter(r => !r.ok).map(r => r.id);
  return { ok: list.length > 0 && failed.length === 0, total: list.length, failed };
}
