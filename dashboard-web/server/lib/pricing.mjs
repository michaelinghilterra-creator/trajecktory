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

// Resolve a stored alias (or an already-full id) to a full model id for the SDK.
// Returns the input unchanged if it's not a known alias, so passing a full id
// through is a no-op.
export function resolveModelId(alias) {
  const key = String(alias || '').trim().toLowerCase();
  return MODEL_IDS[key] || alias;
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
    hint: 'Full A–G reports. The cost driver.',
    options: ['sonnet', 'opus', 'haiku'], default: 'sonnet',
    tokensPerUnit: 125_000, split: { in: 0.85, out: 0.15 },
    unitLabel: 'eval', unitsPerRun: null,   // resolved to the effective batch size
    warn: { haiku: 'Scoring rubric is NOT validated at Haiku — quality may drop.' },
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

  const sections = SECTIONS.map((s) => {
    const units = s.key === 'eval' ? effEvalBatch : (s.unitsPerRun || 1);
    return {
      key: s.key, label: s.label, hint: s.hint,
      options: s.options, default: s.default, warn: s.warn,
      unitLabel: s.unitLabel, unitsPerRun: units,
      current: currentModel(s.key),
      // Approx US$ per representative run, per allowed model (API-key path).
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
    batch: BATCH.map((b) => ({ key: b.key, label: b.label, min: b.min, max: b.max, current: currentBatch(b.key) })),
    pricing: PRICING,
    totalPerRun,
    note: hasKey
      ? 'Estimates are for the API-key path. Real per-run costs are shown below from your recent runs.'
      : (keyPresent
          ? 'Billing set to your Claude plan — your saved API key is not charged. Flip back to bill the key. $ figures show what the API-key path would cost.'
          : 'No API key set: workflow steps run on your Claude subscription (no per-token cost). $ figures show what the API-key path would cost.'),
  };
}
