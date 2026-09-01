// pricing.mjs — single source of truth for per-section model selection + cost.
//
// The dashboard runs LLM work on two paths (see anthropic.mjs / agent.mjs):
//   • Plan path  — `claude -p`, billed against the flat Claude subscription. No
//                  per-token dollar cost; the CLI takes bare aliases (opus/sonnet/
//                  haiku).
//   • API-key path — the Anthropic SDK, billed per token. Needs full model ids.
//
// The user's per-section choice is stored as an ALIAS (haiku/sonnet/opus) in a
// TJK_* env key (persisted to dashboard-web/.env by setup.mjs). agent.mjs passes
// the alias straight to `--model`; the SDK callers resolve it to a full id via
// resolveModelId(). The dollar figures below are APPROXIMATE and apply only to
// the API-key path — surface them as estimates, not billed truth (the real
// per-run cost is logged by the CLI and read back via /api/agent/cost-history).

// Per-model list price, US$ per million tokens (input / output). Approximate —
// verify against current Anthropic pricing before treating as authoritative.
// Aligned to the model ids the codebase already uses (resolveModelId below).
export const PRICING = {
  haiku:  { in: 1.00, out: 5.00 },   // claude-haiku-4-5
  sonnet: { in: 3.00, out: 15.00 },  // claude-sonnet-4-6 / claude-sonnet-5 (same list price)
  opus:   { in: 5.00, out: 25.00 },  // claude-opus-4-8
};

// Alias → full model id for the SDK (API-key) path. Kept to the ids already in
// the codebase so a saved preference never silently upgrades the model.
const MODEL_IDS = {
  haiku:  'claude-haiku-4-5',
  sonnet: 'claude-sonnet-4-6',
  opus:   'claude-opus-4-8',
};

// Per-family version pins the user can choose in Setup -> Models & cost. The FIRST
// entry of each family is the default and MUST equal MODEL_IDS above. This is what
// lets a user pin "Opus 4.8" instead of getting whatever the bare `opus` alias
// resolves to — the Claude CLI expands a bare alias to its own current latest
// (e.g. Opus 5), which is the drift this fixes. Add a new id when a version ships;
// never remove one that might be stored, or currentModelVersion falls back to the
// default. Keep the labels short (they render in a dropdown).
export const MODEL_VERSIONS = {
  haiku:  [{ id: 'claude-haiku-4-5', label: 'Haiku 4.5' }],
  sonnet: [{ id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' }, { id: 'claude-sonnet-5', label: 'Sonnet 5' }],
  opus:   [{ id: 'claude-opus-4-8', label: 'Opus 4.8' }, { id: 'claude-opus-5', label: 'Opus 5' }],
};

// The full model id a family currently resolves to, honoring the user's version
// pin (TJK_{FAMILY}_VERSION) and falling back to the family default (the first
// MODEL_VERSIONS entry) for an unset OR unrecognized/retired pin. That stale-pin
// fallback is deliberate: a pin naming a model that no longer exists must not
// hard-break a run, it should quietly use the current default.
export function currentModelVersion(family, env = process.env) {
  const list = MODEL_VERSIONS[family];
  if (!list) return MODEL_IDS[family] || family;
  const raw = (env[`TJK_${family.toUpperCase()}_VERSION`] || '').trim();
  return list.some((v) => v.id === raw) ? raw : list[0].id;
}

// Resolve a stored alias (or an already-full id) to a full model id. A known
// family alias resolves to its PINNED version (see currentModelVersion); an
// already-full id passes through unchanged; anything else is returned as-is.
export function resolveModelId(alias) {
  const key = String(alias || '').trim().toLowerCase();
  if (MODEL_VERSIONS[key]) return currentModelVersion(key);
  return alias;
}

// Per-section cost model. `tokensPerUnit` is the approximate total (in+out)
// tokens one unit of work consumes on the API-key path — anchored to the user's
// measured ~2M-token / ~$6 full workflow (a batch of ~10 Sonnet evals ≈ that,
// which pins Evaluate at ~125K tok/eval after prompt-cache savings). `split` is
// the input/output share used to weight the two price columns. These are rough;
// they exist to rank choices and show relative cost, not to bill.
export const SECTIONS = [
  {
    key: 'triage', label: 'Triage', envKey: 'TJK_TRIAGE_MODEL',
    hint: 'Cheap first-pass scoring of the pipeline top.',
    options: ['haiku', 'sonnet'], default: 'haiku',
    tokensPerUnit: 10_000, split: { in: 0.9, out: 0.1 },
    unitLabel: 'role', unitsPerRun: 15,
    warn: { sonnet: 'Sonnet costs more; Haiku is calibrated faithful for triage.' },
  },
  {
    key: 'scan', label: 'Agent Scan', envKey: 'TJK_SCAN_MODEL',
    hint: 'Widens the pipeline via Claude web search.',
    options: ['haiku', 'sonnet', 'opus'], default: 'haiku',
    tokensPerUnit: 15_000, split: { in: 0.8, out: 0.2 },
    unitLabel: 'role found', unitsPerRun: 10,
    warn: {},
  },
  {
    key: 'eval', label: 'Evaluate (batch)', envKey: 'TJK_EVAL_MODEL',
    hint: 'Full A-G reports. The cost driver.',
    options: ['sonnet', 'opus', 'haiku'], default: 'sonnet',
    tokensPerUnit: 125_000, split: { in: 0.85, out: 0.15 },
    unitLabel: 'eval', unitsPerRun: null,   // resolved to the effective batch size
    warn: { haiku: 'Scoring rubric is NOT validated at Haiku (quality may drop).' },
  },
  {
    key: 'insights', label: 'Insights', envKey: 'TJK_INSIGHTS_MODEL',
    hint: 'On-demand strategy narrative over pre-computed metrics.',
    options: ['sonnet', 'opus'], default: 'sonnet',
    tokensPerUnit: 40_000, split: { in: 0.6, out: 0.4 },
    unitLabel: 'run', unitsPerRun: 1,
    warn: {},
  },
  {
    key: 'draft', label: 'Drafts & Outreach', envKey: 'TJK_DRAFT_MODEL',
    hint: 'Cover letters, CV tailor, recruiter / TA / LinkedIn / follow-up.',
    options: ['haiku', 'sonnet'], default: 'haiku',
    tokensPerUnit: 5_000, split: { in: 0.4, out: 0.6 },
    unitLabel: 'action', unitsPerRun: 1,
    warn: {},
  },
];

// Batch-size knobs — the throughput/cost trade for the Evaluate step. Plan path
// stays small to protect the flat quota; the API-key path stays at 10 so the
// "more than the Pro plan" throughput the user wants is preserved.
export const BATCH = [
  { key: 'batch_plan', envKey: 'TJK_EVAL_BATCH',     label: 'Batch size (plan)', default: 5,  min: 1, max: 15 },
  { key: 'batch_key',  envKey: 'TJK_EVAL_BATCH_KEY', label: 'Batch size (key)',  default: 10, min: 1, max: 15 },
  // Rolling cap: the MOST roles one Evaluate click scores in total before it stops
  // on its own (it keeps rolling batch after batch until the queue drains OR this
  // cap is hit). Distinct from batch size, which is how many PER batch. Read by
  // rollMax() in routes/agent.mjs via currentBatch('roll_max'), so this is the one
  // source of truth for its default/range. Set to 1 to effectively disable rolling.
  { key: 'roll_max',   envKey: 'TJK_EVAL_ROLL_MAX',  label: 'Rolling cap (evals per run)', default: 60, min: 1, max: 200 },
  // Reconcile cap: the MOST companies one Reconcile click discovers before it stops.
  // Applies to the async discover-run fan-out AND the synchronous per-company routes.
  // Read by currentBatch('reconcile_max') in routes/tt-reconcile.mjs. Replaces the
  // old hardcoded MAX_DISCOVER_COMPANIES = 15.
  { key: 'reconcile_max', envKey: 'TJK_RECONCILE_MAX', label: 'Max companies per reconcile run', default: 15, min: 1, max: 50 },
];

const sectionByKey = Object.fromEntries(SECTIONS.map((s) => [s.key, s]));
const batchByKey = Object.fromEntries(BATCH.map((b) => [b.key, b]));

// Blended $/Mtok for a model given an in/out split.
function blendedRate(alias, split) {
  const p = PRICING[alias];
  if (!p) return 0;
  return p.in * split.in + p.out * split.out;
}

// Approximate US$ for one unit of a section's work on the given model.
export function costPerUnit(sectionKey, alias) {
  const s = sectionByKey[sectionKey];
  if (!s || !PRICING[alias]) return 0;
  return (s.tokensPerUnit / 1_000_000) * blendedRate(alias, s.split);
}

// Approximate US$ for a representative RUN of a section on the given model
// (unit cost × units per run). For Evaluate, unitsPerRun comes from the caller
// (the effective batch size); everything else uses the section's own figure.
export function costPerRun(sectionKey, alias, unitsPerRun) {
  const s = sectionByKey[sectionKey];
  if (!s) return 0;
  const units = unitsPerRun != null ? unitsPerRun : (s.unitsPerRun || 1);
  return costPerUnit(sectionKey, alias) * units;
}

// Read a section's currently-selected alias from the environment, falling back
// to the section default (and, for scan/eval, the legacy shared TJK_AGENT_MODEL).
export function currentModel(sectionKey, env = process.env) {
  const s = sectionByKey[sectionKey];
  if (!s) return null;
  const raw = (env[s.envKey] || '').trim().toLowerCase();
  if (s.options.includes(raw)) return raw;
  if ((sectionKey === 'scan' || sectionKey === 'eval')) {
    const legacy = (env.TJK_AGENT_MODEL || '').trim().toLowerCase();
    if (s.options.includes(legacy)) return legacy;
  }
  return s.default;
}

// Billing mode: which quota the workflow + drafts bill to. 'key' = the Anthropic
// API key (per-token cost); 'plan' = the flat Claude subscription (no per-token
// cost) even when a key is saved. Lets the user cap API spend for a few days
// without deleting their key. Default 'key' so existing key users are unaffected.
export function currentBilling(env = process.env) {
  return (env.TJK_BILLING_MODE || '').trim().toLowerCase() === 'plan' ? 'plan' : 'key';
}

// Read a batch knob's current value (clamped to its range), env-overridable.
export function currentBatch(batchKey, env = process.env) {
  const b = batchByKey[batchKey];
  if (!b) return null;
  const raw = parseInt(env[b.envKey], 10);
  if (!Number.isFinite(raw)) return b.default;
  return Math.max(b.min, Math.min(b.max, raw));
}

// Validate a POST body { section, value }. Returns { ok, envKey, value } or
// { ok:false, error }. Model values must be an allowed alias for that section;
// batch values must be an integer in range. This is the security gate — the
// stored value flows into agent.mjs as a --model argv element, so never accept
// anything outside the allow-list.
export function validateSetting(section, value) {
  const s = sectionByKey[section];
  if (s) {
    const v = String(value || '').trim().toLowerCase();
    if (!s.options.includes(v)) {
      return { ok: false, error: `Invalid model "${value}" for ${s.label}. Allowed: ${s.options.join(', ')}.` };
    }
    return { ok: true, envKey: s.envKey, value: v };
  }
  const b = batchByKey[section];
  if (b) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n) || n < b.min || n > b.max) {
      return { ok: false, error: `${b.label} must be an integer between ${b.min} and ${b.max}.` };
    }
    return { ok: true, envKey: b.envKey, value: String(n) };
  }
  const vm = section.match(/^(haiku|sonnet|opus)_version$/);
  if (vm) {
    const fam = vm[1];
    const v = String(value || '').trim();
    if (!MODEL_VERSIONS[fam].some((x) => x.id === v)) {
      return { ok: false, error: `Invalid ${fam} version "${value}".` };
    }
    return { ok: true, envKey: `TJK_${fam.toUpperCase()}_VERSION`, value: v };
  }
  if (section === 'billing') {
    const v = String(value || '').trim().toLowerCase();
    if (v !== 'key' && v !== 'plan') return { ok: false, error: 'Billing must be "key" or "plan".' };
    return { ok: true, envKey: 'TJK_BILLING_MODE', value: v };
  }
  return { ok: false, error: `Unknown setting: ${section}` };
}

// Build the full payload for GET /api/setup/models: current selections, allowed
// options, per-option run-cost estimates, batch knobs, pricing, and a full-run
// total (Triage + Evaluate batch). `evalBatch` is the effective batch size to
// price Evaluate at (the key-path size when a key is present, else the plan size).
export function modelsState({ keyPresent, evalBatch } = {}) {
  // Effective "is the API key being used" = a key is saved AND billing is set to
  // key. In plan mode the key stays saved but isn't charged, so hasKey is false
  // and the UI + estimates behave as keyless (plan flow, no per-token cost).
  const billingMode = currentBilling();
  const hasKey = !!keyPresent && billingMode === 'key';
  const batchPlan = currentBatch('batch_plan');
  const batchKey = currentBatch('batch_key');
  const effEvalBatch = evalBatch != null ? evalBatch : (hasKey ? batchKey : batchPlan);

  // SINGLE-RAIL: the billing toggle picks the rail and the WHOLE workflow bills it.
  // In key mode (hasKey) every step bills the API key — Triage, Agent Scan, and
  // Evaluate via `claude -p` (Claude Code bills the key whenever it sees it), plus
  // Insights and Drafts via the SDK. In plan mode / no key, nothing bills the key
  // and every step runs on the flat Claude subscription. So billsTo is uniform
  // across steps: it follows the rail, not the step.
  const sections = SECTIONS.map((s) => {
    const units = s.key === 'eval' ? effEvalBatch : (s.unitsPerRun || 1);
    return {
      key: s.key, label: s.label, hint: s.hint,
      options: s.options, default: s.default, warn: s.warn,
      unitLabel: s.unitLabel, unitsPerRun: units,
      current: currentModel(s.key),
      // 'api' = bills the API key; 'plan' = runs on the Claude subscription.
      billsTo: hasKey ? 'api' : 'plan',
      // Approx US$ per representative run, per allowed model (API-key path estimate).
      costs: Object.fromEntries(s.options.map((a) => [a, costPerRun(s.key, a, units)])),
    };
  });

  // Full-run estimate = a Triage pass + an Evaluate batch at their current models.
  const triage = sections.find((x) => x.key === 'triage');
  const evalS = sections.find((x) => x.key === 'eval');
  const totalPerRun = triage.costs[triage.current] + evalS.costs[evalS.current];

  return {
    hasKey,
    keyPresent: !!keyPresent,
    billingMode,
    sections,
    // Per-family version pins (e.g. Opus 4.8 vs Opus 5), for the Setup picker.
    modelVersions: Object.fromEntries(Object.keys(MODEL_VERSIONS).map((f) => [f, {
      current: currentModelVersion(f), options: MODEL_VERSIONS[f],
    }])),
    batch: BATCH.map((b) => ({ key: b.key, label: b.label, min: b.min, max: b.max, current: currentBatch(b.key) })),
    pricing: PRICING,
    totalPerRun,
    note: hasKey
      ? 'Billing set to your API key: the ENTIRE workflow bills your key while this is on — Triage, Agent Scan, and Evaluate (via claude -p), plus Insights and Drafts. $ figures are local estimates from token counts, not your invoice; set your real ceiling in your Anthropic console. Switch billing to your Claude plan to stop charging the key.'
      : (keyPresent
          ? 'Billing set to your Claude plan: NOTHING bills your saved API key — the whole workflow runs on your subscription (no per-token cost). $ figures are estimates of what the API-key path would cost, not real charges.'
          : 'No API key set: the whole workflow runs on your Claude subscription (no per-token cost). $ figures are estimates of what the API-key path would cost.'),
  };
}
