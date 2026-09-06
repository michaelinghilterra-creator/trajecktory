// outreach-rubric.mjs: assemble and score a shared outreach quality rubric.
//
// Why: outreach generation has several independent rules lists, so quality can
// drift by surface and model scores can disagree with the visible dimensions.
// This file centralizes prompt calibration, hardened parsing, and deterministic
// scoring. It deliberately makes no model calls and has no dependencies.
//
// The output contract puts critique and dimensions before subject and body on
// purpose. Models generate keys from left to right, so the final message is
// conditioned on defects already identified in the same response. Reordering
// those keys turns critique then revise into a rating of an unrevised draft.

export const DIMENSIONS = {
  relevance: {
    id: 'relevance',
    name: 'Relevance to Recipient',
    anchors: `Does the message speak to this person's actual role, seniority, and relationship to the opening?
A talent partner screening a req and a VP who owns the team need different first sentences.
1-3:  Generic. Could be addressed to anyone at any company in any function.
4-5:  Gets the function right but ignores seniority, or the reverse.
6-7:  Appropriate for the role but says nothing only this recipient would care about.
8-9:  Clearly written for this person's seat, and references the opening or team correctly.
10:   The recipient would think this person understands what my week actually looks like.`,
  },
  personalization: {
    id: 'personalization',
    name: 'Specificity to This Company',
    anchors: `Named, checkable references: the requisition, a funding round, a product, a named team, a
leadership change. Merge-tag output and vague praise are not personalization.
1-3:  Zero research signal, or empty flattery ("your innovative culture", "your impressive growth").
4-5:  Names the company but nothing that required looking anything up.
6-7:  Surface facts anyone could get in ten seconds (headcount, industry, city).
8-9:  References something that took real reading, and ties it to why the sender is writing.
10:   The research IS the hook. Remove it and the message has no reason to exist.`,
  },
  evidence: {
    id: 'evidence',
    name: 'Evidence Grounding',
    anchors: `Every metric, title, scope figure, headcount, dollar amount and date must trace to the CV excerpt
or the VERIFIABLE CLAIMS block. This is the hardest rule in the rubric and it is not negotiable.
1-3:  Contains a figure, title or scope claim that appears nowhere in the source material.
      ANY unsourced number lands here regardless of how good the rest of the message is.
4-5:  All claims are technically sourced but vague ("significant improvement", "large team").
6-7:  Sourced and specific, but the proof point chosen does not fit what this recipient cares about.
8-9:  A specific, sourced, quantified proof point, well matched to the recipient.
10:   The proof point is the strongest available one for this exact reader, quoted accurately.`,
  },
  earned_ask: {
    id: 'earned_ask',
    name: 'Earned Ask',
    anchors: `Does the message pay for its ask before making it? This is NOT a pronoun count. A job-search
message is allowed and expected to say what the sender did. What it may not do is ask for
something before giving the reader a reason to keep reading.
1-3:  Opens with wanting something. "I'm reaching out because I'm looking for a role."
4-5:  Opens with the sender's background and reaches the ask before giving the reader anything.
6-7:  Gives something first, but it is generic enthusiasm rather than substance.
8-9:  A concrete, relevant proof point or observation lands before the ask.
10:   The message would be worth reading even if the ask were deleted.`,
  },
  clarity: {
    id: 'clarity',
    name: 'Clarity',
    anchors: `Could a busy person scanning on a phone understand the point in five seconds?
1-3:  After a full read it is still unclear what the sender wants or why they wrote.
4-5:  Clear by the end, but the opener is vague or throat-clearing.
6-7:  Clear, but the point is buried behind setup or context.
8-9:  The point is in the first two sentences.
10:   The first line alone carries it.`,
  },
  ask_strength: {
    id: 'ask_strength',
    name: 'Ask Strength',
    anchors: `Exactly one ask, specific, and low friction for this recipient's seniority.
HARD RULE: any request for a call, chat, conversation, meeting, or a named quantity of the
recipient's time ("15 minutes", "20-min intro", "quick chat", "grab time") caps this dimension at
3, no matter how well written the rest is. Asking a stranger for time reads as tone-deaf.
For a connection request the note should give a reason to accept, never request a meeting.
PLAIN WORDS: the closing must be readable by someone outside the sender's function. Insider
vocabulary in the ask ("seat", "req", "motion", "ICP", "top of funnel", "in-seat") caps this at 5.
The reader should not have to decode the last line of the message.
NO CONDITIONAL OPENER: do not begin the closing sentence with "If". "If this isn't the right
fit..." leads with the reader's reason to say no and makes the ask an afterthought. State the ask
first, then qualify it only if the qualification earns its place.
NOT A TEMPLATE: if the closing would read identically in a message to a different company, it is a
template rather than an ask. The most common form is asking to be redirected to an unnamed person,
which costs the reader work and commits the sender to nothing. Name the specific next step you
want, tied to something in this message.
1-3:  No ask at all, or a time request (see the hard rule), or several competing asks.
4-5:  One ask, but vague ("would love to connect"), too heavy for a cold contact, or phrased in
      insider jargon the recipient has to decode.
6-7:  Clear and appropriately light, but phrased generically, or opens with a conditional that
      leads with the reason to decline.
8-9:  Specific, easy to say yes to, and matched to how well they know the sender.
10:   Reads as an obvious next step rather than a request, and could not be pasted into a message
      to a different company unchanged.`,
  },
  length_fit: {
    id: 'length_fit',
    name: 'Length and Format Fit',
    anchors: `Measured against this surface's stated length norm, which is supplied in the prompt.
Also: sentence length variety, paragraph breaks, scannability.
1-3:  Far outside the norm, or a single undifferentiated block of text.
4-5:  Somewhat over, or dense and hard to scan.
6-7:  Within the norm but some sentences are overlong or every sentence is the same length.
8-9:  Right length, varied rhythm, clean structure.
10:   Every sentence earns its place and no two are shaped alike.`,
  },
  authenticity: {
    id: 'authenticity',
    name: 'Authenticity',
    anchors: `Does it read as one person writing to another, or as output?
Banned openers and filler, any of which is an automatic signal: "I hope this finds you well",
"just following up", "just checking in", "touching base", "circling back", "reaching out",
"I wanted to reach out", "I am writing to express my interest".
Banned vocabulary: delve, leverage, robust, seamless, spearhead, foster, elevate, unlock,
tapestry, pivotal, testament, synergy, game-changer, passionate, results-driven, dynamic,
proven track record.
Em dashes and double hyphens are banned outright.
1-3:  Multiple banned phrases, or opens with a cliche, or contains an em dash.
4-5:  One banned phrase, or noticeably uniform sentence rhythm.
6-7:  Clean but with minor tells: slightly formal, one hedge too many.
8-9:  Reads like a person wrote it deliberately.
10:   Indistinguishable from a well-written personal note.`,
  },
  thread_awareness: {
    id: 'thread_awareness',
    name: 'Thread Awareness',
    anchors: `Only scored on replies and follow-ups. Does the message answer what the other person actually
said, avoid re-issuing an ask that is already pending, and describe timing honestly?
1-3:  Ignores what they wrote, or repeats a previous ask verbatim, or misstates when something
      happened relative to the timing language supplied in the prompt.
4-5:  Acknowledges the thread but adds nothing new.
6-7:  Responds to the thread and adds something, but leans on the earlier message's content.
8-9:  Answers what they said and brings exactly one genuinely new thing.
10:   Advances the conversation. The prior message did not need to be reread to follow it.`,
  },
  subject: {
    id: 'subject',
    name: 'Subject Line',
    anchors: `Only scored on email surfaces.
1-3:  Generic or spammy. "Quick question." "Introduction." "Following up." "Exciting opportunity."
4-5:  Relevant but interchangeable with a hundred others.
6-7:  Clear and accurate but not a reason to open.
8-9:  Specific to this recipient and honest about the contents. Four to eight words.
10:   Would be opened on a busy day because it signals something the reader actually wants.`,
  },
};

export const RUBRIC_PROFILES = {
  outreach_email: {
    id: 'outreach_email',
    dims: [
      { id: 'relevance', weight: 0.18 },
      { id: 'personalization', weight: 0.18 },
      { id: 'evidence', weight: 0.16 },
      { id: 'earned_ask', weight: 0.12 },
      { id: 'clarity', weight: 0.10 },
      { id: 'ask_strength', weight: 0.10 },
      { id: 'length_fit', weight: 0.06 },
      { id: 'authenticity', weight: 0.05 },
      { id: 'subject', weight: 0.05 },
    ],
    lengthNorm: '90-140 words in the body',
    hardCap: null,
    hardCapUnit: null,
    paragraphs: null,
    rubric: true,
    note: 'Cold outbound email uses the full first-contact rubric.',
  },
  outreach_dm: {
    id: 'outreach_dm',
    dims: [
      { id: 'relevance', weight: 0.18 },
      { id: 'personalization', weight: 0.16 },
      { id: 'evidence', weight: 0.16 },
      { id: 'earned_ask', weight: 0.14 },
      { id: 'clarity', weight: 0.12 },
      { id: 'ask_strength', weight: 0.12 },
      { id: 'length_fit', weight: 0.07 },
      { id: 'authenticity', weight: 0.05 },
    ],
    lengthNorm: '40-110 words',
    hardCap: null,
    hardCapUnit: null,
    paragraphs: null,
    rubric: true,
    note: 'Direct messages have no subject and are not yet a thread.',
  },
  thread_reply: {
    id: 'thread_reply',
    dims: [
      { id: 'thread_awareness', weight: 0.28 },
      { id: 'relevance', weight: 0.14 },
      { id: 'evidence', weight: 0.14 },
      { id: 'clarity', weight: 0.14 },
      { id: 'ask_strength', weight: 0.12 },
      { id: 'length_fit', weight: 0.08 },
      { id: 'authenticity', weight: 0.06 },
      { id: 'subject', weight: 0.04 },
    ],
    lengthNorm: '90-120 words',
    hardCap: null,
    hardCapUnit: null,
    paragraphs: null,
    rubric: true,
    note: 'Drops personalization because you already know them.',
  },
  app_followup: {
    id: 'app_followup',
    dims: [
      { id: 'evidence', weight: 0.20 },
      { id: 'relevance', weight: 0.18 },
      { id: 'clarity', weight: 0.16 },
      { id: 'ask_strength', weight: 0.16 },
      { id: 'thread_awareness', weight: 0.12 },
      { id: 'length_fit', weight: 0.10 },
      { id: 'authenticity', weight: 0.04 },
      { id: 'subject', weight: 0.04 },
    ],
    lengthNorm: 'under 100 words',
    hardCap: null,
    hardCapUnit: null,
    paragraphs: null,
    rubric: true,
    note: 'Drops personalization because the recipient is often an unknown ATS address.',
  },
  connect_note: {
    id: 'connect_note',
    dims: [
      { id: 'personalization', weight: 0.28 },
      { id: 'relevance', weight: 0.22 },
      { id: 'ask_strength', weight: 0.20 },
      { id: 'clarity', weight: 0.16 },
      { id: 'authenticity', weight: 0.14 },
    ],
    lengthNorm: '200-280 characters',
    hardCap: 300,
    hardCapUnit: 'chars',
    paragraphs: null,
    rubric: true,
    note: 'Drops evidence and earned_ask because 300 characters cannot carry a quantified proof point.',
  },
  cover_letter: {
    id: 'cover_letter',
    contentKeys: ['salutation', 'p1', 'p2', 'p3', 'closing'],
    dims: [
      { id: 'evidence', weight: 0.30 },
      { id: 'relevance', weight: 0.24 },
      { id: 'clarity', weight: 0.18 },
      { id: 'earned_ask', weight: 0.12 },
      { id: 'length_fit', weight: 0.10 },
      { id: 'authenticity', weight: 0.06 },
    ],
    lengthNorm: 'under 350 words across exactly 3 body paragraphs',
    hardCap: null,
    hardCapUnit: null,
    paragraphs: 3,
    rubric: true,
    note: 'Has no recipient to research and a structurally fixed close.',
  },
  short_public: {
    id: 'short_public',
    dims: [
      { id: 'relevance', weight: 0.35 },
      { id: 'clarity', weight: 0.30 },
      { id: 'authenticity', weight: 0.25 },
      { id: 'length_fit', weight: 0.10 },
    ],
    lengthNorm: 'under 60 words',
    hardCap: null,
    hardCapUnit: null,
    paragraphs: null,
    rubric: false,
    note: 'Too short for the rubric to have signal, so it is manual-only.',
  },
};

export const SURFACE_PROFILE = {
  ta_email: 'outreach_email',
  referral_email: 'outreach_email',
  ta_dm: 'outreach_dm',
  referral_dm: 'outreach_dm',
  li_followup: 'outreach_dm',
  reply_email: 'thread_reply',
  followup_sent: 'thread_reply',
  app_followup: 'app_followup',
  connect_note_influencer: 'connect_note',
  connect_note_generic: 'connect_note',
  cover_letter: 'cover_letter',
  li_comment: 'short_public',
  li_dm_reply: 'short_public',
  post: 'short_public',
  post_reply: 'short_public',
};

export const SURFACE_OVERRIDES = {
  li_followup: { lengthNorm: '40-150 words' },
};

export const SURFACES = Object.freeze(Object.keys(SURFACE_PROFILE));

function owns(object, key) {
  return object != null && Object.prototype.hasOwnProperty.call(object, key);
}

export function getProfile(surfaceId) {
  try {
    const isSurface = owns(SURFACE_PROFILE, surfaceId);
    const profileId = isSurface ? SURFACE_PROFILE[surfaceId] : surfaceId;
    if (!owns(RUBRIC_PROFILES, profileId)) return null;
    const base = RUBRIC_PROFILES[profileId];
    const override = isSurface && owns(SURFACE_OVERRIDES, surfaceId) ? SURFACE_OVERRIDES[surfaceId] : {};
    return { ...base, ...override };
  } catch {
    return null;
  }
}

function normalizedOptions(opts) {
  const value = opts && typeof opts === 'object' ? opts : {};
  return {
    proofPoints: Array.isArray(value.proofPoints) ? value.proofPoints : [],
    superpowers: Array.isArray(value.superpowers) ? value.superpowers : [],
    cvExcerpt: typeof value.cvExcerpt === 'string' ? value.cvExcerpt : '',
    toneNote: typeof value.toneNote === 'string' ? value.toneNote : '',
    companyResearch: typeof value.companyResearch === 'string'
      ? value.companyResearch.trim().slice(0, 1200)
      : '',
    body: typeof value.body === 'string' ? value.body : '',
    subject: typeof value.subject === 'string' ? value.subject : '',
  };
}

function rubricBody(profile, opts) {
  const lines = [];
  lines.push(`Length norm: ${profile.lengthNorm}.`);
  if (profile.hardCap != null && profile.hardCapUnit) {
    lines.push(`Hard cap: ${profile.hardCap} ${profile.hardCapUnit}.`);
  }
  if (profile.paragraphs != null) {
    lines.push(`Required body paragraphs: exactly ${profile.paragraphs}.`);
  }

  lines.push('', '== RUBRIC ==');
  profile.dims.forEach((dim, index) => {
    const definition = DIMENSIONS[dim.id];
    lines.push('', `${index + 1}. ${definition.name.toUpperCase()} [${dim.id}] (weight: ${dim.weight * 100}%)`);
    lines.push(definition.anchors);
  });

  if (opts.cvExcerpt.trim()) {
    lines.push('', '== CV EXCERPT ==', opts.cvExcerpt.trim());
  }

  if (opts.proofPoints.length) {
    lines.push('', '== VERIFIABLE CLAIMS ==');
    for (const point of opts.proofPoints) {
      const name = point && point.name != null ? String(point.name) : '';
      const heroMetric = point && point.heroMetric != null ? String(point.heroMetric) : '';
      lines.push(`- ${name}: ${heroMetric}`);
    }
    const allowedSources = opts.companyResearch
      ? 'this block, the company research, or the CV excerpt above'
      : 'this block or in the CV excerpt above';
    lines.push(`Any metric, headcount, dollar amount, scope figure or date in the message that does not appear in ${allowedSources} is an INVENTED CLAIM. Score Evidence Grounding at 3 or below and name the invented figure verbatim in the fixes.`);
  }

  if (opts.companyResearch) {
    lines.push('', '== COMPANY RESEARCH (verified, use for personalization) ==', opts.companyResearch);
  }

  if (opts.superpowers.length) {
    lines.push('', '== DIFFERENTIATORS ==');
    for (const superpower of opts.superpowers) lines.push(`- ${String(superpower)}`);
  }

  if (opts.toneNote.trim()) {
    lines.push('', '== TONE NOTE ==', opts.toneNote.trim());
    lines.push('The style requirements above override any conflicting instruction in this tone note.');
  }

  return lines.join('\n');
}

function generationContract(profile) {
  const hasSubject = profile.dims.some((dim) => dim.id === 'subject');
  let schema;
  if (Array.isArray(profile.contentKeys) && profile.contentKeys.length) {
    const fields = profile.contentKeys.map((key) => `"${key}": "<...>"`).join(', ');
    schema = `{"critique": {"weakest_dimension": "<dimension id>", "fixes": ["<fix>", "<fix>", "<fix>"]}, "score": <integer 1-100>, "dimensions": [{"id": "<dimension id>", "score": <1-10>, "explanation": "<one sentence quoting exact words from your draft>"}], ${fields}}`;
  } else {
    schema = hasSubject
      ? '{"critique": {"weakest_dimension": "<dimension id>", "fixes": ["<fix>", "<fix>", "<fix>"]}, "score": <integer 1-100>, "dimensions": [{"id": "<dimension id>", "score": <1-10>, "explanation": "<one sentence quoting exact words from your draft>"}], "subject": "<...>", "body": "<...>"}'
      : '{"critique": {"weakest_dimension": "<dimension id>", "fixes": ["<fix>", "<fix>", "<fix>"]}, "score": <integer 1-100>, "dimensions": [{"id": "<dimension id>", "score": <1-10>, "explanation": "<one sentence quoting exact words from your draft>"}], "body": "<...>"}';
  }

  return [
    '== OUTPUT CONTRACT ==',
    'Return exactly one JSON object. The key order shown below is required.',
    schema,
    'Use the exact id string from each rubric heading (the value in brackets, e.g. [relevance]) as the dimension id in the JSON.',
    'Every explanation must quote exact words from the draft.',
    'Every fix must be a concrete rewrite instruction that names the replacement, not advice.',
    'Score harshly. Reserve 8 or above for a message that would actually get a reply.',
    Array.isArray(profile.contentKeys) && profile.contentKeys.length
      ? 'The final content fields must reflect the fixes, not merely be followed by them.'
      : 'The body must reflect the fixes, not merely be followed by them.',
  ].join('\n');
}

export function buildPlainContract(surfaceId) {
  const profile = getProfile(surfaceId);
  const hasSubject = Boolean(profile && profile.dims.some((dim) => dim.id === 'subject'));
  const schema = hasSubject
    ? '{"subject": "<...>", "body": "<...>"}'
    : '{"body": "<...>"}';

  return [
    '== OUTPUT CONTRACT ==',
    'Return exactly one JSON object.',
    schema,
  ].join('\n');
}

export function buildRubricBlock(surfaceId, opts = {}) {
  const profile = getProfile(surfaceId);
  if (!profile || !profile.rubric) return '';
  const values = normalizedOptions(opts);
  return [
    'Draft the message, critique that draft against the rubric below, then write the final version.',
    rubricBody(profile, values),
    generationContract(profile),
  ].join('\n\n');
}

export function buildIndependentGradePrompt(surfaceId, opts = {}) {
  const profile = getProfile(surfaceId);
  if (!profile || !profile.rubric) return '';
  const values = normalizedOptions(opts);
  const message = [];
  if (profile.dims.some((dim) => dim.id === 'subject') && values.subject.trim()) {
    message.push(`Subject: ${values.subject.trim()}`);
  }
  message.push(values.body);

  return [
    'Grade a message written by someone else against the rubric below.',
    rubricBody(profile, values),
    '== MESSAGE TO GRADE ==\n' + message.join('\n\n'),
    [
      '== OUTPUT CONTRACT ==',
      'Return exactly one JSON object in the required key order shown below.',
      '{"score": <integer 1-100>, "dimensions": [{"id": "<dimension id>", "score": <1-10>, "explanation": "<one sentence quoting exact words from the message>"}], "top_fixes": ["<fix>", "<fix>", "<fix>"]}',
      'Every explanation must quote exact words from the message.',
      'Every top fix must be a concrete rewrite instruction that names the replacement, not advice.',
      'Score harshly. Reserve 8 or above for a message that would actually get a reply.',
    ].join('\n'),
  ].join('\n\n');
}

export function buildImprovePrompt(surfaceId, opts = {}) {
  const profile = getProfile(surfaceId);
  if (!profile || !profile.rubric) return '';
  const values = normalizedOptions(opts);
  const message = [];
  if (profile.dims.some((dim) => dim.id === 'subject') && values.subject.trim()) {
    message.push(`Subject: ${values.subject.trim()}`);
  }
  message.push(values.body);

  return [
    "Grade the message below against the rubric, then rewrite it so that every fix you name is applied. Preserve every fact, name, metric and the sender's intent. Introduce no claim that is not grounded in the supplied sources.",
    'Use a named, checkable fact from the company research to replace any generic praise. If the research contains nothing specific enough, DELETE the generic sentence rather than inventing a fact or keeping the vague version.',
    rubricBody(profile, values),
    '== MESSAGE TO IMPROVE ==\n' + message.join('\n\n'),
    generationContract(profile),
  ].join('\n\n');
}

function extractFirstObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (start < 0) {
      if (char !== '{') continue;
      start = index;
      depth = 1;
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth++;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }

  return null;
}

function clampDimensionScore(score) {
  return Math.min(10, Math.max(1, score));
}

export function weightedScore(dimensions, profile) {
  if (!Array.isArray(dimensions) || !dimensions.length || !profile || !Array.isArray(profile.dims)) {
    return null;
  }

  const scores = new Map();
  for (const dimension of dimensions) {
    if (!dimension || typeof dimension.id !== 'string' || !Number.isFinite(dimension.score)) continue;
    scores.set(dimension.id, clampDimensionScore(dimension.score));
  }

  let total = 0;
  let presentWeight = 0;
  for (const dimension of profile.dims) {
    if (!scores.has(dimension.id) || !Number.isFinite(dimension.weight)) continue;
    total += scores.get(dimension.id) * dimension.weight;
    presentWeight += dimension.weight;
  }
  if (presentWeight <= 0) return null;

  return Math.min(100, Math.max(1, Math.round((total / presentWeight) * 10)));
}

function parseReviewedContent(raw, surfaceId, selectContent) {
  try {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    const source = extractFirstObject(raw);
    if (!source) return null;

    let parsed;
    try {
      parsed = JSON.parse(source);
    } catch {
      return null;
    }

    const profile = getProfile(surfaceId);
    if (!parsed || typeof parsed !== 'object') return null;
    const content = selectContent(parsed, profile);
    if (!content) return null;
    const draft = { ...content, review: null };
    if (!profile) return draft;

    const validIds = new Set(profile.dims.map((dimension) => dimension.id));
    const dimensionsValid = Array.isArray(parsed.dimensions)
      && parsed.dimensions.length > 0
      && parsed.dimensions.every((dimension) => dimension
        && typeof dimension.id === 'string'
        && validIds.has(dimension.id)
        && Number.isFinite(dimension.score));
    const fixesValid = parsed.critique
      && typeof parsed.critique === 'object'
      && Array.isArray(parsed.critique.fixes)
      && parsed.critique.fixes.some((fix) => typeof fix === 'string' && fix.trim());
    if (!dimensionsValid || !fixesValid) return draft;

    const profileDims = new Map(profile.dims.map((dimension) => [dimension.id, dimension]));
    const dimensions = parsed.dimensions.map((dimension) => {
      const profileDimension = profileDims.get(dimension.id);
      return {
        id: dimension.id,
        name: DIMENSIONS[dimension.id].name,
        weight: profileDimension.weight,
        score: clampDimensionScore(dimension.score),
        explanation: dimension.explanation,
      };
    });
    const score = weightedScore(dimensions, profile);
    if (score == null) return draft;

    const topFixes = parsed.critique.fixes
      .filter((fix) => typeof fix === 'string' && fix.trim())
      .map((fix) => fix.trim());
    const weakest = typeof parsed.critique.weakest_dimension === 'string'
      && validIds.has(parsed.critique.weakest_dimension)
      ? parsed.critique.weakest_dimension
      : null;

    return {
      ...content,
      review: { score, dimensions, topFixes, weakest },
    };
  } catch {
    return null;
  }
}

export function parseReviewed(raw, surfaceId) {
  return parseReviewedContent(raw, surfaceId, (parsed, profile) => {
    if (typeof parsed.body !== 'string' || !parsed.body.trim()) return null;
    const hasSubject = Boolean(profile && profile.dims.some((dimension) => dimension.id === 'subject'));
    return {
      subject: hasSubject ? parsed.subject : undefined,
      body: parsed.body,
    };
  });
}

export function parseReviewedFields(raw, surfaceId) {
  return parseReviewedContent(raw, surfaceId, (parsed, profile) => {
    if (!profile || !Array.isArray(profile.contentKeys) || !profile.contentKeys.length) return null;
    const fields = {};
    for (const key of profile.contentKeys) {
      if (typeof parsed[key] !== 'string' || !parsed[key].trim()) return null;
      fields[key] = parsed[key];
    }
    return { fields };
  });
}

export function reviewFailureReason(raw, surfaceId) {
  const profile = getProfile(surfaceId);
  if (process.env.TJK_RUBRIC_DISABLED === '1' || !profile || !profile.rubric) return 'rubric-off';
  if (typeof raw !== 'string' || !raw.trim()) return 'no-json';

  const source = extractFirstObject(raw);
  if (!source) return 'no-json';

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    return 'no-json';
  }

  if (!parsed || typeof parsed !== 'object') return 'no-body';
  if (Array.isArray(profile.contentKeys) && profile.contentKeys.length) {
    const fieldsValid = profile.contentKeys.every((key) => typeof parsed[key] === 'string' && parsed[key].trim());
    if (!fieldsValid) return 'no-fields';
  } else if (typeof parsed.body !== 'string' || !parsed.body.trim()) {
    return 'no-body';
  }
  if (!Array.isArray(parsed.dimensions) || parsed.dimensions.length === 0) return 'no-dimensions';

  const validIds = new Set(profile.dims.map((dimension) => dimension.id));
  const dimensionsValid = parsed.dimensions.every((dimension) => dimension
    && typeof dimension.id === 'string'
    && validIds.has(dimension.id)
    && Number.isFinite(dimension.score));
  if (!dimensionsValid) return 'bad-dimension-ids';

  const fixesValid = parsed.critique
    && typeof parsed.critique === 'object'
    && Array.isArray(parsed.critique.fixes)
    && parsed.critique.fixes.some((fix) => typeof fix === 'string' && fix.trim());
  if (!fixesValid) return 'no-fixes';

  if (weightedScore(parsed.dimensions, profile) == null) return 'no-weight';
  // Every check above passed, yet the caller still got review: null. That is an
  // unexpected state, so name it rather than borrowing another code.
  return 'unknown';
}

export function violatesHardConstraint(text, profile) {
  if (!profile || typeof profile !== 'object') return null;
  const value = String(text == null ? '' : text);

  if (profile.hardCap != null && Number.isFinite(profile.hardCap)) {
    let actual = null;
    if (profile.hardCapUnit === 'chars') actual = value.length;
    if (profile.hardCapUnit === 'words') actual = value.trim() ? value.trim().split(/\s+/).length : 0;
    if (actual != null && actual > profile.hardCap) {
      return { kind: profile.hardCapUnit, actual, limit: profile.hardCap };
    }
  }

  if (profile.paragraphs != null && Number.isFinite(profile.paragraphs)) {
    const normalized = value.replace(/\r\n?/g, '\n').trim();
    const actual = normalized ? normalized.split(/\n\s*\n+/).filter((block) => block.trim()).length : 0;
    if (actual !== profile.paragraphs) {
      return { kind: 'paragraphs', actual, limit: profile.paragraphs };
    }
  }

  return null;
}
