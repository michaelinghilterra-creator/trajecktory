import { _stripLeadingSalutation, _stripTrailingSignature } from './anthropic.mjs';
import {
  cleanProse,
  cleanEmailBody,
  cleanEmailSubject,
  stripDraftMeta,
  stripRedundantFiller,
} from './text-hygiene.mjs';
import { reviseForCadence } from './cadence-revise.mjs';
import { SURFACES } from '../../../lib/outreach-rubric.mjs';

function continueAfterError(surface, step, value, transform) {
  try {
    return transform(value);
  } catch (err) {
    console.error(`[finishDraft:${surface}] ${step} failed: ${err?.message || err}`);
    return value;
  }
}

export async function finishDraft({
  body, subject,
  surface,
  review = null,
  reviewStatus = review === null ? 'disabled' : 'ok',
  cleaner = 'prose',
  stripSalutationFor = null,
  stripSignature = true,
  cadence = 'auto',
  subjectTransform = null,
  flatten = false, hardFit = null,
  context = {},
}) {
  if (!SURFACES.includes(surface)) {
    throw new Error(`Unknown draft surface: ${surface}`);
  }

  void context;
  let finishedBody = body;
  let finishedSubject = subject;

  if (stripSalutationFor) {
    finishedBody = continueAfterError(surface, 'strip salutation', finishedBody,
      (value) => _stripLeadingSalutation(value, stripSalutationFor));
  }
  if (stripSignature) {
    finishedBody = continueAfterError(surface, 'strip signature', finishedBody,
      (value) => _stripTrailingSignature(value));
  }
  finishedBody = continueAfterError(surface, 'strip draft metadata', finishedBody, stripDraftMeta);

  const cleaners = {
    email: cleanEmailBody,
    prose: cleanProse,
    none: (value) => value,
  };
  const clean = cleaners[cleaner];
  if (clean) {
    finishedBody = continueAfterError(surface, `${cleaner} cleaning`, finishedBody, clean);
  } else {
    console.error(`[finishDraft:${surface}] unknown cleaner: ${cleaner}`);
  }

  if (cadence === 'auto' && review === null) {
    try {
      finishedBody = (await reviseForCadence(finishedBody, { surface: cleaner })).text;
    } catch (err) {
      console.error(`[finishDraft:${surface}] cadence revision failed: ${err?.message || err}`);
    }
  }

  finishedBody = continueAfterError(surface, 'strip redundant filler', finishedBody, stripRedundantFiller);

  if (finishedSubject !== undefined) {
    if (typeof subjectTransform === 'function') {
      finishedSubject = continueAfterError(surface, 'subject transform', finishedSubject, subjectTransform);
    }
    finishedSubject = continueAfterError(surface, 'subject cleaning', finishedSubject, cleanEmailSubject);
  }

  if (flatten) {
    finishedBody = continueAfterError(surface, 'flatten', finishedBody, (value) => String(value ?? '')
      .replace(/\s*[\r\n]+\s*/g, ' ')
      .replace(/ {2,}/g, ' ')
      .trim());
  }
  if (hardFit !== null && hardFit !== undefined) {
    finishedBody = continueAfterError(surface, 'hard fit', finishedBody,
      (value) => String(value ?? '').slice(0, hardFit));
  }

  const text = String(finishedBody ?? '');
  const length = hardFit !== null && hardFit !== undefined
    ? text.length
    : (text.trim() ? text.trim().split(/\s+/).length : 0);

  return { body: finishedBody, subject: finishedSubject, length, review, reviewStatus };
}
