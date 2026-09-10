import express from 'express';
import { ROOT_DIR } from '../config.mjs';
import { gradeIndependently } from '../lib/draft-grader.mjs';
import { finishDraft } from '../lib/finish-draft.mjs';
import { parseApplicationsMd } from '../lib/applications.mjs';
import { loadCompanyResearch } from '../lib/report-research.mjs';
import { generateText, gradeModel, readOptionalProjectFile } from '../lib/anthropic.mjs';
import {
  SURFACES,
  buildImprovePrompt,
  getProfile,
  parseReviewed,
} from '../../../lib/outreach-rubric.mjs';
import { getNarrative } from '../lib/profile.mjs';

export const router = express.Router();

function researchForApplication(appId) {
  try {
    if (appId === undefined || appId === null || String(appId).trim() === '') return '';
    if (typeof appId !== 'number' && typeof appId !== 'string') return '';
    const parsedId = Number(appId);
    if (!Number.isInteger(parsedId)) return '';
    const app = parseApplicationsMd().find((candidate) => candidate.id === parsedId);
    return app ? loadCompanyResearch(app.report) : '';
  } catch {
    return '';
  }
}

function gradeContextFields(value) {
  const context = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const clean = (field) => typeof context[field] === 'string' ? context[field].trim().slice(0, 200) : '';
  return {
    recipientRole: clean('recipientRole'),
    recipientTier: clean('recipientTier'),
    appliedRole: clean('appliedRole'),
    appliedDate: clean('appliedDate'),
  };
}

function draftGradeContext(gradeContext, fallbackAppId) {
  const context = gradeContext && typeof gradeContext === 'object' && !Array.isArray(gradeContext)
    ? gradeContext
    : null;
  const contextAppId = context
    && (typeof context.appId === 'number' || typeof context.appId === 'string')
    ? context.appId
    : fallbackAppId;
  const narrative = getNarrative();
  return {
    cvExcerpt: readOptionalProjectFile(ROOT_DIR, 'cv.md'),
    proofPoints: narrative.proofPoints,
    superpowers: narrative.superpowers,
    companyResearch: researchForApplication(contextAppId),
    ...gradeContextFields(context),
  };
}

router.post('/api/drafts/review', async (req, res) => {
  try {
    const { body, subject, surfaceId, gradeContext } = req.body || {};

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required and must be a non-empty string.' });
    }
    if (!surfaceId || !SURFACES.includes(surfaceId)) {
      return res.status(400).json({ error: `surfaceId must be one of: ${SURFACES.join(', ')}` });
    }

    // A rubric-off surface cannot be graded. Say so, rather than letting it fall
    // through to the generic "could not parse review" 500, which reads like a
    // model failure instead of a bad request.
    if (!getProfile(surfaceId)?.rubric) {
      return res.status(400).json({ error: `surfaceId ${surfaceId} is not graded by the rubric.` });
    }

    // Generation grades evidence against the CV plus the narrative proof points.
    // Feed the independent grader the same sources, or the two disagree on the
    // evidence dimension by construction and the calibration gap is meaningless.
    const contextOptions = draftGradeContext(gradeContext);
    const review = await gradeIndependently(body, surfaceId, {
      model: gradeModel(),
      subject: typeof subject === 'string' ? subject : '',
      ...contextOptions,
    });

    if (!review) {
      return res.status(500).json({ error: 'Could not parse review from model output.' });
    }

    res.json({ ok: true, review });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/drafts/improve', async (req, res) => {
  try {
    const {
      body, subject, surfaceId, fixes = [], gradeContext, appId,
      recipientFirst: _recipientFirst, originalScore: _originalScore,
    } = req.body || {};
    void _recipientFirst;
    void _originalScore;

    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required and must be a non-empty string.' });
    }
    if (!surfaceId || !SURFACES.includes(surfaceId)) {
      return res.status(400).json({ error: `surfaceId must be one of: ${SURFACES.join(', ')}` });
    }
    if (!Array.isArray(fixes) || fixes.length > 8
      || fixes.some((fix) => typeof fix !== 'string' || fix.length > 500)) {
      return res.status(400).json({ error: 'fixes must be an array of up to 8 strings, each no longer than 500 characters.' });
    }

    const profile = getProfile(surfaceId);
    if (!profile?.rubric) {
      return res.status(400).json({ error: `surfaceId ${surfaceId} is not graded by the rubric.` });
    }

    const contextOptions = draftGradeContext(gradeContext, appId);
    const prompt = buildImprovePrompt(surfaceId, {
      body,
      subject: typeof subject === 'string' ? subject : '',
      fixes,
      ...contextOptions,
    });
    const raw = await generateText(prompt, { model: gradeModel(), maxTokens: 2200, label: `improve:${surfaceId}` });
    const parsed = parseReviewed(raw, surfaceId);
    if (!parsed || typeof parsed.body !== 'string' || !parsed.body.trim()) {
      return res.status(500).json({ error: 'Could not parse an improved draft with a usable body from model output.' });
    }

    const hasSubject = profile.dims.some((dimension) => dimension.id === 'subject');
    const hasCharacterCap = profile.hardCapUnit === 'chars';

    // Map finish behavior from the rubric profile so callers cannot weaken it.
    const finished = await finishDraft({
      body: parsed.body,
      subject: parsed.subject,
      cleaner: hasSubject ? 'email' : 'prose',
      flatten: hasCharacterCap,
      hardFit: hasCharacterCap ? profile.hardCap : null,
      stripSalutationFor: null,
      stripSignature: false,
      surface: surfaceId,
      review: null,
      reviewStatus: 'pending',
    });

    const gradeOptions = {
      model: gradeModel(),
      ...contextOptions,
    };
    const [originalReview, rewriteReview] = await Promise.all([
      gradeIndependently(body, surfaceId, {
        ...gradeOptions,
        subject: typeof subject === 'string' ? subject : '',
      }),
      gradeIndependently(finished.body, surfaceId, {
        ...gradeOptions,
        subject: finished.subject,
      }),
    ]);
    const gradesExist = Boolean(originalReview && rewriteReview);
    const gradesComplete = gradesExist && !originalReview.incomplete && !rewriteReview.incomplete;
    const improved = gradesComplete && rewriteReview.score >= originalReview.score + 3;
    const reason = !gradesExist
      ? 'grade-failed'
      : !gradesComplete ? 'grade-incomplete' : null;
    return res.json({
      ok: true,
      improved,
      draft: improved ? { subject: finished.subject, body: finished.body } : null,
      review: rewriteReview,
      originalReview,
      reviewOf: 'independent',
      original: { subject, body },
      ...(reason ? { reason } : {}),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
