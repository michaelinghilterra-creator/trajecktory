import { SPARK_URL, SPARK_MODEL, codeLocationCap, productionVerdict } from './spark-eval.mjs';

export const READOUT_DIMENSIONS = [
  ['fit', 'Fit / CV Match'], ['northStar', 'North Star Alignment'], ['level', 'Level Match'],
  ['comp', 'Comp'], ['location', 'Location / Logistics'], ['buildDepth', 'Build Depth'],
  ['redFlags', 'Red Flags'],
]; // each rated 0 to 5
// The code location cap applies only when the expected location rating is at or below this, because
// an unsure model with a split between a low and a middle rating should not discard a role on location.
export const LOCATION_CAP_MAX_EV = 1.5;
export const READOUT_FIELDS = [
  { key: 'jdLevel', type: 'text', maxTokens: 12, after: false },
  { key: 'compStated', type: 'text', maxTokens: 24, after: false },
  { key: 'scoreCeiling', type: 'choice', choices: ['n', '0', '1', '2', '3', '4', '5'], after: true,
    meaning: 'n means no ceiling; otherwise the highest overall score this role can get' },
  { key: 'ceilingBasis', type: 'choice', choices: ['n', 'c', 'l', 'v', 'b', 'r', 'o'], after: true,
    meaning: 'the blocker behind scoreCeiling: n none, c comp (pay), l location, v level, b build depth, r a requirement or visa, o other' },
  { key: 'ceilingReason', type: 'text', maxTokens: 40, after: true },
];

const jsonStr = (s) => JSON.stringify(s);
const fieldsText = (obj) => Object.entries(obj).map(([k, v]) => `${jsonStr(k)}:${jsonStr(v)}`).join(',');
const ratingsText = (obj) => Object.entries(obj).map(([k, v]) => `${jsonStr(k)}:${v}`).join(',');

export function formatSection() {
  const before = READOUT_FIELDS.filter((f) => !f.after).map((f) =>
    f.type === 'text'
      ? `${jsonStr(f.key)}:"..."`
      : `${jsonStr(f.key)}:"<one of ${f.choices.join(', ')}>"`).join(',');
  const ratings = READOUT_DIMENSIONS.map(([key]) => `${jsonStr(key)}:<integer 0 to 5>`).join(',');
  const after = READOUT_FIELDS.filter((f) => f.after).map((f) =>
    f.type === 'text'
      ? `${jsonStr(f.key)}:"..."`
      : `${jsonStr(f.key)}:"<one of ${f.choices.join(', ')}>"`).join(',');
  const lines = [
    '# Output format',
    '',
    'Your reply is one JSON object written by the scoring engine:',
    `{"fields":{${before}},"ratings":{${ratings}},"after":{${after}}}`,
    '',
    'Each rating is a single digit. Meaning of each rating:',
    ...READOUT_DIMENSIONS.map(([key, label]) => `- ${key} (${label}): 0 = worst, 5 = best`),
    '',
    'Fields:',
    ...READOUT_FIELDS.map((f) => {
      let line = f.type === 'text'
        ? `- ${f.key}: free text, at most ${f.maxTokens} tokens`
        : `- ${f.key}: one of ${f.choices.join(', ')}`;
      if (f.after) line += ' (written after the ratings)';
      if (f.meaning) line += `. ${f.meaning}`;
      return line;
    }),
    '',
    'Write each text field as plain prose with no quote characters.',
  ];
  return lines.join('\n');
}

export function buildUserMessage(preamble, jdText) {
  return preamble + '\n\n' + formatSection() + '\n\n---\n\n# Item to score\n\n' + jdText;
}

export function fieldPrefix(done, key) {
  return '{"fields":{' + fieldsText(done) + (Object.keys(done).length ? ',' : '') + jsonStr(key) + ':"';
}

export function ratingPrefix(fields, ratings, key) {
  return '{"fields":{' + fieldsText(fields) + '},"ratings":{' + ratingsText(ratings) +
    (Object.keys(ratings).length ? ',' : '') + jsonStr(key) + ':';
}

export function afterPrefix(fields, ratings, afterDone, key) {
  return '{"fields":{' + fieldsText(fields) + '},"ratings":{' + ratingsText(ratings) +
    '},"after":{' + fieldsText(afterDone) + (Object.keys(afterDone).length ? ',' : '') + jsonStr(key) + ':"';
}

export function readDistribution(topLogprobs) {
  const raw = [0, 0, 0, 0, 0, 0];
  for (const entry of topLogprobs || []) {
    const token = String(entry?.token ?? '').trim();
    if (/^[0-5]$/.test(token)) raw[Number(token)] += entry.logprob == null ? 0 : Math.exp(entry.logprob);
  }
  const mass = raw.reduce((sum, value) => sum + value, 0);
  if (mass === 0) return null;
  const probs = raw.map((value) => value / mass);
  const ev = probs.reduce((sum, probability, value) => sum + value * probability, 0);
  const sd = Math.sqrt(probs.reduce((sum, probability, value) => sum + probability * (value - ev) ** 2, 0));
  let argmax = 0;
  for (let value = 1; value <= 5; value++) {
    if (probs[value] > probs[argmax]) argmax = value;
  }
  return { ev, argmax, sd, mass, probs };
}

export function readChoice(topLogprobs, choices) {
  const raw = Object.fromEntries(choices.map((choice) => [choice, 0]));
  for (const entry of topLogprobs || []) {
    const token = String(entry?.token ?? '').trim();
    if (Object.hasOwn(raw, token)) raw[token] += entry.logprob == null ? 0 : Math.exp(entry.logprob);
  }
  const mass = Object.values(raw).reduce((sum, value) => sum + value, 0);
  if (mass === 0) return null;
  const probs = Object.fromEntries(choices.map((choice) => [choice, raw[choice] / mass]));
  let value = choices[0];
  for (const choice of choices.slice(1)) {
    if (probs[choice] > probs[value]) value = choice;
  }
  return { value, mass, probs };
}

let sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export function _setSleep(fn) {
  sleep = fn;
}

async function chat(user, prefix, extra) {
  const body = {
    model: SPARK_MODEL,
    messages: [{ role: 'user', content: user }, { role: 'assistant', content: prefix }],
    continue_final_message: true,
    temperature: 0,
    ...extra,
  };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${SPARK_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) return await response.json();
      const error = new Error(`endpoint: HTTP ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      if (String(error?.message || '').startsWith('endpoint:') &&
          !/^endpoint: HTTP (429|5\d\d)$/.test(error.message)) throw error;
      lastError = String(error?.message || '').startsWith('endpoint:')
        ? error
        : new Error(`endpoint: ${error?.message || String(error)}`);
    }
    if (attempt < 2) await sleep((attempt + 1) * 1000);
  }
  throw lastError || new Error('endpoint: request failed');
}

async function nextTokenLogprobs(user, prefix) {
  const data = await chat(user, prefix, { max_tokens: 1, logprobs: true, top_logprobs: 20 });
  return {
    topLogprobs: data?.choices?.[0]?.logprobs?.content?.[0]?.top_logprobs ?? [],
    completionTokens: data?.usage?.completion_tokens ?? 0,
  };
}

async function generateText(user, prefix, maxTokens) {
  const data = await chat(user, prefix, { max_tokens: maxTokens, stop: ['"'] });
  let value = String(data?.choices?.[0]?.message?.content || '').trim();
  if (value.endsWith('"')) value = value.slice(0, -1).trim();
  return { value, completionTokens: data?.usage?.completion_tokens ?? 0 };
}

function betterMass(first, second) {
  if (!first) return second;
  if (!second) return first;
  return second.mass > first.mass ? second : first;
}

export async function scoreOneReadout(item, { preamble }) {
  try {
    const user = buildUserMessage(preamble, item.jdText);
    const fields = {};
    const ratings = {};
    const dist = {};
    const afterDone = {};
    let completionTokens = 0;

    for (const field of READOUT_FIELDS.filter((entry) => !entry.after)) {
      const result = await generateText(user, fieldPrefix(fields, field.key), field.maxTokens);
      fields[field.key] = result.value;
      completionTokens += result.completionTokens;
    }

    for (const [key] of READOUT_DIMENSIONS) {
      const prefix = ratingPrefix(fields, ratings, key);
      const first = await nextTokenLogprobs(user, prefix);
      completionTokens += first.completionTokens;
      let distribution = readDistribution(first.topLogprobs);
      if (!distribution || distribution.mass < 0.5) {
        const retry = await nextTokenLogprobs(user, prefix + ' ');
        completionTokens += retry.completionTokens;
        distribution = betterMass(distribution, readDistribution(retry.topLogprobs));
      }
      if (!distribution) return { id: item.id, ok: false, reason: `no rating mass for ${key}` };
      ratings[key] = distribution.argmax;
      dist[key] = distribution;
    }

    for (const field of READOUT_FIELDS.filter((entry) => entry.after)) {
      const prefix = afterPrefix(fields, ratings, afterDone, field.key);
      if (field.type === 'choice') {
        const first = await nextTokenLogprobs(user, prefix);
        completionTokens += first.completionTokens;
        let selected = readChoice(first.topLogprobs, field.choices);
        if (!selected || selected.mass < 0.5) {
          const retry = await nextTokenLogprobs(user, prefix + ' ');
          completionTokens += retry.completionTokens;
          selected = betterMass(selected, readChoice(retry.topLogprobs, field.choices));
        }
        if (!selected) return { id: item.id, ok: false, reason: `no choice mass for ${field.key}` };
        afterDone[field.key] = selected.value;
      } else {
        const result = await generateText(user, prefix, field.maxTokens);
        completionTokens += result.completionTokens;
        afterDone[field.key] = result.value;
      }
    }

    const jdLevel = fields.jdLevel;
    const compStated = fields.compStated;
    const basisMap = { c: 'comp', l: 'location', v: 'level', b: 'buildDepth', r: 'requirement', o: 'other' };
    let authored = /^[0-5]$/.test(afterDone.scoreCeiling) ? Number(afterDone.scoreCeiling) : null;
    const basis = basisMap[afterDone.ceilingBasis] || '';
    if (basis === 'location') authored = null;
    // The code location cap is applied to the most likely location rating, because the averaged rating rarely equals a cap key.
    const cap = dist.location.ev <= LOCATION_CAP_MAX_EV
      ? await codeLocationCap(dist.location.argmax)
      : null;
    const codeCapWins = cap !== null && (authored === null || cap < authored);
    const report = {
      schema: 'trajecktory-report/v1', company: '', role: '',
      summary: { seniority: jdLevel, compStated },
      levelMatch: { jdLevel },
      globalScore: READOUT_DIMENSIONS.map(([key, dim]) =>
        ({ key, dim, val: dist[key].ev, hardVal: dist[key].argmax, max: 5, evidence: '' })),
      scoreCeiling: codeCapWins ? cap : authored,
      ceilingBasis: codeCapWins ? '' : (authored === null ? '' : basis),
      ceilingReason: codeCapWins
        ? 'location rating ' + dist.location.argmax
        : (authored === null ? '' : afterDone.ceilingReason),
      recommendation: '',
    };
    const raw = JSON.stringify(report);
    const verdict = await productionVerdict(raw);
    return {
      id: item.id, ok: verdict.ok, score: verdict.score, reason: verdict.reason,
      data: verdict.data, raw, finishReason: 'readout', promptTokens: null,
      completionTokens, retried: false,
    };
  } catch (error) {
    const reason = error?.message || String(error);
    if (reason.startsWith('endpoint:')) return { id: item.id, ok: false, reason, endpointError: true };
    return { id: item.id, ok: false, reason };
  }
}

export async function probeReadout() {
  try {
    const user = 'Reply with one JSON object holding a single integer rating from 0 to 5.';
    const prefix = '{"rating":';
    const first = await nextTokenLogprobs(
      user,
      prefix,
    );
    const token = first.topLogprobs[0]?.token;
    let distribution = readDistribution(first.topLogprobs);
    if (!distribution || distribution.mass < 0.5) {
      const retry = await nextTokenLogprobs(user, prefix + ' ');
      distribution = betterMass(distribution, readDistribution(retry.topLogprobs));
    }
    if (distribution && distribution.mass >= 0.5) return { ok: true };
    return {
      ok: false,
      reason: `endpoint ignores continue_final_message (top token ${token == null ? 'none' : JSON.stringify(token)})`,
    };
  } catch (error) {
    return { ok: false, reason: error?.message || String(error) };
  }
}
