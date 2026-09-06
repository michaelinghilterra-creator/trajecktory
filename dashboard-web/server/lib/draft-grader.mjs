import {
  parseReviewed,
  getProfile,
  weightedScore,
  buildIndependentGradePrompt,
  buildPlainContract,
  buildRubricBlock,
  reviewFailureReason,
} from '../../../lib/outreach-rubric.mjs';
import { generateText, readOptionalProjectFile } from './anthropic.mjs';
import { getNarrative } from './profile.mjs';

const FIGURE_PATTERN = /\$\d[\d,]*(?:\.\d+)?(?:[KMB])?|\b\d[\d,]*(?:\.\d+)?%|\b(?:\d{1,3}(?:,\d{3})+|\d{3,})(?:\.\d+)?\b/gi;
const TIME_UNIT_PATTERN = /^\s*(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i;
const ORDINAL_PATTERN = /^(?:st|nd|rd|th)\b/i;

function sourceContains(figure, cvMd, proofPoints, additionalSources) {
  const sources = [typeof cvMd === 'string' ? cvMd : ''];
  if (Array.isArray(proofPoints)) {
    for (const point of proofPoints) {
      if (point && typeof point.heroMetric === 'string') sources.push(point.heroMetric);
    }
  }
  if (typeof additionalSources === 'string') sources.push(additionalSources);
  if (Array.isArray(additionalSources)) {
    for (const source of additionalSources) {
      if (typeof source === 'string') sources.push(source);
    }
  }
  const needle = figure.toLowerCase();
  return sources.some((source) => source.toLowerCase().includes(needle));
}

export function checkUnsourcedNumbers(body, cvMd, proofPoints, additionalSources) {
  try {
    const text = typeof body === 'string' ? body : '';
    const flagged = [];
    const seen = new Set();

    for (const match of text.matchAll(FIGURE_PATTERN)) {
      const figure = match[0];
      const plain = figure.replace(/[$,%]/g, '');
      const numeric = Number.parseFloat(plain);
      const after = text.slice((match.index || 0) + figure.length);
      const before = text.slice(Math.max(0, (match.index || 0) - 3), match.index || 0);
      const hasUnit = figure.startsWith('$') || figure.endsWith('%');

      if (!hasUnit && Number.isFinite(numeric) && numeric >= 1900 && numeric <= 2099) continue;
      if (!hasUnit && Number.isFinite(numeric) && numeric < 100) continue;
      if (ORDINAL_PATTERN.test(after)) continue;
      if (!hasUnit && TIME_UNIT_PATTERN.test(after)) continue;
      if (/24\/$/.test(before + figure) && /^7\b/.test(after)) continue;
      const figureKey = figure.toLowerCase();
      if (seen.has(figureKey)) continue;

      seen.add(figureKey);
      if (!sourceContains(figure, cvMd, proofPoints, additionalSources)) flagged.push(figure);
    }

    return { clean: flagged.length === 0, flagged };
  } catch {
    return { clean: true, flagged: [] };
  }
}

const TEMPLATED_ASK_PATTERNS = [
  /\bwhoever\b/i,
  /\bthe right (?:person|contact|team|group)\b/i,
  /\ba pointer\b/i,
  /\bpoint(?:ed|ing)? (?:me )?(?:to|toward|towards)\b/i,
  /\bif (?:that is|that's|you are|you're) not (?:you|the right)\b/i,
];

function closingText(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return '';

  const paragraphs = text.split(/\r?\n\s*\r?\n/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length > 1) return paragraphs[paragraphs.length - 1];

  const sentences = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [];
  return sentences.slice(-2).join(' ').trim();
}

function containsProperName(text) {
  for (const match of text.matchAll(/\b[A-Z][a-z]+(?:['’][A-Z]?[a-z]+)?\b/g)) {
    const before = text.slice(0, match.index).trimEnd();
    if (!before || /[.!?]$/.test(before)) continue;
    if (/\b(?:hi|hello|dear)\s*$/i.test(before)) continue;
    return true;
  }
  return false;
}

export function checkTemplatedAsk(body) {
  try {
    const closing = closingText(body);
    if (!closing) return { clean: true, matched: null };

    let matched = null;
    let matchedIndex = Number.POSITIVE_INFINITY;
    for (const pattern of TEMPLATED_ASK_PATTERNS) {
      const hit = pattern.exec(closing);
      if (hit && hit.index < matchedIndex) {
        matched = hit[0];
        matchedIndex = hit.index;
      }
    }

    if (!matched || containsProperName(closing)) return { clean: true, matched: null };
    return { clean: false, matched };
  } catch {
    return { clean: true, matched: null };
  }
}

function fallbackDraft(raw) {
  try {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed || typeof parsed.body !== 'string' || !parsed.body.trim()) return null;
    return {
      subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
      body: parsed.body,
      review: null,
    };
  } catch {
    return null;
  }
}

export function parseAndFinishDraft(raw, surfaceId, cvMd, companyResearch) {
  let result = null;
  try {
    result = parseReviewed(raw, surfaceId);
  } catch {
    result = null;
  }

  if (!result) result = fallbackDraft(raw);
  if (!result) return { error: 'unparseable' };

  if (!result.review) {
    const reason = reviewFailureReason(raw, surfaceId);
    console.warn('[rubric] surface=%s review=null reason=%s', surfaceId, reason);
    return {
      subject: result.subject,
      body: result.body,
      review: null,
      reviewStatus: reason === 'rubric-off' ? 'disabled' : `missing:${reason}`,
    };
  }

  try {
    const profile = getProfile(surfaceId);
    const proofPoints = getNarrative().proofPoints;
    const numberCheck = checkUnsourcedNumbers(result.body, cvMd, proofPoints, companyResearch);
    if (!numberCheck.clean) {
      const evidence = result.review.dimensions.find((dimension) => dimension.id === 'evidence');
      if (evidence) evidence.score = Math.min(evidence.score, 3);
      result.review.topFixes = [
        ...result.review.topFixes,
        ...numberCheck.flagged.filter((figure) => !result.review.topFixes.includes(figure)),
      ];
      result.review.score = weightedScore(result.review.dimensions, profile);
      result.review.unsourcedWarning = true;
    }
    if (profile.dims.some((dimension) => dimension.id === 'ask_strength')) {
      const askCheck = checkTemplatedAsk(result.body);
      if (!askCheck.clean) {
        const askStrength = result.review.dimensions.find((dimension) => dimension.id === 'ask_strength');
        if (askStrength) askStrength.score = Math.min(askStrength.score, 3);
        const fix = `Replace "${askCheck.matched}" with a specific next step tied to this message, or name the person you want to reach.`;
        if (!result.review.topFixes.includes(fix)) result.review.topFixes.push(fix);
        result.review.score = weightedScore(result.review.dimensions, profile);
        result.review.templatedAskWarning = true;
      }
    }
    return { subject: result.subject, body: result.body, review: result.review, reviewStatus: 'ok' };
  } catch {
    // The unsourced-number check never ran, so the evidence dimension is
    // unverified. Do not claim 'ok': an invented metric could pass unflagged.
    return {
      subject: result.subject,
      body: result.body,
      review: result.review,
      reviewStatus: 'ok:unverified',
    };
  }
}

const BANNED_OUTPUT_INSTRUCTIONS = [
  /Output ONLY/i,
  /Return ONLY the (message|reply|comment|post|body|note)/i,
  /no code fences/i,
  /^\s*\{\s*"(subject|body)"\s*:/m,
];

function contractConflict(prompt) {
  const text = String(prompt ?? '');
  for (const pattern of BANNED_OUTPUT_INSTRUCTIONS) {
    const match = pattern.exec(text);
    if (!match) continue;
    const start = Math.max(0, match.index - 40);
    return text.slice(start, match.index + match[0].length + 80).replace(/\s+/g, ' ').trim();
  }
  return null;
}

export async function generateWithRubric(prompt, surfaceId, opts = {}) {
  const { model, maxTokens = 1024, cvMd = '', rubricOpts = {}, plainTextFallback = false } = opts;

  const rubricBlock = (process.env.TJK_RUBRIC_DISABLED !== '1')
    ? buildRubricBlock(surfaceId, { cvExcerpt: cvMd, ...rubricOpts })
    : '';

  if (rubricBlock) {
    const excerpt = contractConflict(prompt);
    if (excerpt) {
      console.error('[rubric] surface=%s conflicting output contract: %s', surfaceId, excerpt);
      if (process.env.TJK_STRICT_CONTRACT === '1') {
        throw new Error(`Conflicting output contract for ${surfaceId}`);
      }
    }
  }

  const contract = rubricBlock || buildPlainContract(surfaceId);
  const fullPrompt = prompt + '\n\n' + contract;
  const effectiveMaxTokens = rubricBlock ? Math.max(maxTokens + 1200, 2200) : maxTokens;

  const raw = await generateText(fullPrompt, { model, maxTokens: effectiveMaxTokens });
  if (typeof raw === 'string' && !raw.trimEnd().endsWith('}')) {
    console.warn('[rubric] surface=%s response-truncated missing-closing-brace', surfaceId);
  }

  const result = parseAndFinishDraft(raw, surfaceId, cvMd, rubricOpts.companyResearch);
  if (!result.error) return result;

  if (plainTextFallback) {
    if (typeof raw !== 'string' || /"(?:dimensions|weakest_dimension|critique)"/i.test(raw)) {
      return { error: 'unparseable' };
    }
    const reason = reviewFailureReason(raw, surfaceId);
    return {
      body: raw.trim(),
      subject: undefined,
      review: null,
      reviewStatus: reason === 'rubric-off' ? 'disabled' : `missing:${reason}`,
    };
  }

  return result;
}

function parseIndependentReview(raw, body, surfaceId) {
  const direct = parseReviewed(raw, surfaceId);
  if (direct?.review) return direct.review;

  try {
    if (typeof raw !== 'string') return null;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    const adapted = {
      body,
      dimensions: parsed.dimensions,
      critique: {
        weakest_dimension: parsed.weakest_dimension,
        fixes: parsed.top_fixes,
      },
    };
    return parseReviewed(JSON.stringify(adapted), surfaceId)?.review || null;
  } catch {
    return null;
  }
}

export async function gradeIndependently(body, surfaceId, opts = {}) {
  try {
    const values = opts && typeof opts === 'object' ? opts : {};
    const promptOptions = { ...values, body: typeof body === 'string' ? body : '' };
    if (!promptOptions.cvExcerpt && typeof values.projectRoot === 'string') {
      // Exact sentinel match, not a leading-bracket test: a markdown CV that
      // opens with a link line would otherwise be dropped from the prompt.
      const cvMd = readOptionalProjectFile(values.projectRoot, 'cv.md');
      if (cvMd) promptOptions.cvExcerpt = cvMd;
    }
    const prompt = buildIndependentGradePrompt(surfaceId, promptOptions);
    if (!prompt) return null;
    const response = await generateText(prompt, { model: values.model, maxTokens: 2048 });
    return parseIndependentReview(response, promptOptions.body, surfaceId);
  } catch {
    return null;
  }
}
