// style.mjs -- flag the non-rhythm "AI writing" tells and offer the one safe
// auto-fix. Pure, dependency-free.
//
// Cadence (cadence.mjs) covers sentence rhythm. This covers word choice and
// framing: overused AI vocabulary, filler, cliche/sycophantic openers, and
// bullet overload. It is a WRITING-QUALITY signal, not a detector.
//
// Two things ship here:
//   analyzeStyle(text)        -> DETECT only. A 0-100 plainness score + flags.
//                                Never changes the text.
//   stripRedundantFiller(text)-> the ONE safe auto-fix. A short, strict list of
//                                phrases whose replacement is correct in
//                                essentially every context ("in order to" -> "to").
//                                Everything judgment-heavy stays flag-only.

// --- AI vocabulary ------------------------------------------------------------
// HIGH: words that almost always read as machine-written.
const AI_WORDS_HIGH = [
  'delve', 'delved', 'delving', 'tapestry', 'realm', 'testament', 'underscore', 'underscores',
  'boasts', 'boasting', 'elevate', 'elevates', 'unlock', 'unlocks', 'harness', 'harnesses',
  'spearhead', 'spearheads', 'pivotal', 'meticulous', 'meticulously', 'foster', 'fosters',
  'nuanced', 'myriad', 'plethora', 'embark', 'cultivate', 'garner', 'garnered', 'bolster',
  'holistic', 'synergy', 'synergies', 'resonate', 'resonates', 'showcase', 'showcases',
  'endeavor', 'commendable', 'noteworthy', 'vibrant', 'seamless', 'seamlessly', 'multifaceted',
  'unparalleled', 'unwavering', 'ever-evolving', 'ever-changing', 'cutting-edge', 'game-changer',
  'game-changing', 'world-class', 'best-in-class', 'top-notch', 'paradigm', 'trailblazing',
];
// LOW: legitimate in RevOps / technical writing, so flagged softly, not penalized hard.
const AI_WORDS_LOW = [
  'leverage', 'leverages', 'leveraging', 'robust', 'streamline', 'streamlined', 'streamlines',
  'utilize', 'utilizes', 'utilizing', 'comprehensive', 'dynamic', 'optimize', 'optimizes',
  'scalable', 'innovative', 'strategic', 'impactful', 'actionable', 'deliverable', 'deliverables',
];
const AI_PHRASES = [
  "in today's fast-paced world", 'in the ever-evolving', 'navigate the landscape',
  'navigate the complexities', 'a testament to', 'plays a pivotal role', 'in the realm of',
  'unlock the potential', 'at the forefront', 'push the boundaries', 'take it to the next level',
  'a rich tapestry', 'the power of harnessing',
];

// --- Filler -------------------------------------------------------------------
// REDUNDANT: the ONLY auto-fixable set. Each is a pure inline 1:1 swap whose
// replacement is right in essentially every sentence (no deletion, no
// re-capitalization surprises). Keep this list short and strict.
const REDUNDANT = [
  ['in order to', 'to'],
  ['due to the fact that', 'because'],
  ['in spite of the fact that', 'although'],
  ['in the event that', 'if'],
  ['at this point in time', 'now'],
  ['at the present time', 'now'],
  ['a large number of', 'many'],
  ['the majority of', 'most of'],
  ['a majority of', 'most of'],
  ['on a daily basis', 'daily'],
  ['on a regular basis', 'regularly'],
  ['has the ability to', 'can'],
  ['have the ability to', 'can'],
  ['in the near future', 'soon'],
];
// HEDGE: often legitimate, so FLAG only, never auto-cut.
const HEDGE = [
  'very', 'really', 'just', 'actually', 'basically', 'simply', 'literally', 'essentially',
  'quite', 'arguably', 'somewhat', 'rather', 'definitely', 'certainly',
];
const HEDGE_PHRASES = ['when it comes to', 'the fact that', 'it is important to note that', 'it should be noted that', 'needless to say', 'it goes without saying', 'for all intents and purposes'];

// --- Openers (matched only at the very start of the text) ---------------------
const OPENERS = [
  'great question', "i'd be happy to", 'i am happy to', 'happy to help', 'certainly',
  'of course', 'absolutely', 'as an ai', 'thank you for reaching out',
  'i hope this (?:email|message|note|letter|finds)[^.!?\\n]*finds you well',
  "i hope (?:you are|you're)[^.!?\\n]*well",
  'i am writing to (?:express|apply|inquire)', 'i am (?:thrilled|excited|delighted) to (?:apply|be applying|share)',
  'please accept this (?:letter|application|proposal)', 'it is with great (?:interest|enthusiasm|pleasure)',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordsRe = (list) => new RegExp('\\b(?:' + list.map(esc).join('|') + ')\\b', 'gi');
const phraseRe = (list) => new RegExp('\\b(?:' + list.map((p) => p.split(/\s+/).map(esc).join('\\s+')).join('|') + ')\\b', 'gi');

const RE_AI_HIGH = wordsRe(AI_WORDS_HIGH);
const RE_AI_LOW = wordsRe(AI_WORDS_LOW);
const RE_AI_PHRASE = phraseRe(AI_PHRASES);
const RE_HEDGE = wordsRe(HEDGE);
const RE_HEDGE_PHRASE = phraseRe(HEDGE_PHRASES);
const RE_OPENER = new RegExp('^\\W*(?:' + OPENERS.join('|') + ')', 'i');
const RE_REDUNDANT = REDUNDANT.map(([p, r]) => [new RegExp('\\b' + p.split(/\s+/).map(esc).join('\\s+') + '\\b', 'gi'), r]);

function wordCount(s) { return (String(s).match(/[A-Za-z0-9][A-Za-z0-9'-]*/g) || []).length; }
function bulletRatio(s) {
  const lines = String(s).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { ratio: 0, bullets: 0, lines: 0 };
  const bullets = lines.filter((l) => /^([-*+\u2022\u2023\u25E6]|\d+[.)])\s+/.test(l)).length;
  return { ratio: bullets / lines.length, bullets, lines: lines.length };
}
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const uniq = (arr) => [...new Set(arr)];

const MIN_WORDS = 30;

// analyzeStyle(text, opts) -> report. opts.expectBullets suppresses the bullet
// flag (a resume WANTS bullets); opts.minWords overrides the floor.
export function analyzeStyle(text, opts = {}) {
  const minWords = opts.minWords || MIN_WORDS;
  const s = String(text == null ? '' : text);
  const words = wordCount(s);
  if (words < minWords) {
    return { score: null, insufficient: true, words, message: `Too little text to judge style (need ~${minWords} words, found ${words}).`, flags: [], counts: {}, density: {} };
  }

  const aiHigh = uniq((s.match(RE_AI_HIGH) || []).map((w) => w.toLowerCase()));
  const aiHighN = (s.match(RE_AI_HIGH) || []).length;
  const aiLow = uniq((s.match(RE_AI_LOW) || []).map((w) => w.toLowerCase()));
  const aiPhrase = uniq((s.match(RE_AI_PHRASE) || []).map((w) => w.toLowerCase().replace(/\s+/g, ' ')));
  const hedge = uniq((s.match(RE_HEDGE) || []).map((w) => w.toLowerCase()));
  const hedgeN = (s.match(RE_HEDGE) || []).length + (s.match(RE_HEDGE_PHRASE) || []).length;
  const redundantHits = RE_REDUNDANT.flatMap(([re, rep]) => (s.match(re) || []).map((m) => ({ m: m.toLowerCase().replace(/\s+/g, ' '), rep })));
  const opener = RE_OPENER.test(s.trimStart());
  const bl = bulletRatio(s);
  const bulletFlag = !opts.expectBullets && bl.ratio >= 0.6 && bl.bullets >= 4;

  const per100 = (n) => (words ? (n / words) * 100 : 0);
  const aiHighPer100 = per100(aiHighN + aiPhrase.length);
  const aiLowPer100 = per100(aiLow.length);
  const redundantPer100 = per100(redundantHits.length);
  const hedgePer100 = per100(hedgeN);

  const score = Math.round(clamp(
    100 - (aiHighPer100 * 12 + aiLowPer100 * 3 + redundantPer100 * 8 + hedgePer100 * 2 + (opener ? 10 : 0) + (bulletFlag ? 12 : 0)),
    0, 100));

  const flags = [];
  const cap = (arr, n) => arr.slice(0, n);
  for (const w of cap(aiHigh, 6)) flags.push({ type: 'ai-vocab', severity: 'high', term: w, message: `"${w}" reads as AI. Use a plainer word.` });
  for (const p of cap(aiPhrase, 3)) flags.push({ type: 'ai-vocab', severity: 'high', term: p, message: `"${p}" is an AI-writing cliche. Cut it or say it plainly.` });
  for (const w of cap(aiLow, 4)) flags.push({ type: 'ai-vocab', severity: 'low', term: w, message: `"${w}" is fine occasionally, but common in AI text. Consider a plainer word.` });
  for (const h of cap(uniq(redundantHits.map((x) => x.m)), 4)) {
    const rep = redundantHits.find((x) => x.m === h).rep;
    flags.push({ type: 'filler-redundant', severity: 'medium', term: h, message: `"${h}" -> "${rep}". stripRedundantFiller fixes this automatically.` });
  }
  for (const h of cap(hedge, 4)) flags.push({ type: 'filler-hedge', severity: 'low', term: h, message: `"${h}" is often filler. Cut it if the sentence holds without it.` });
  if (opener) flags.push({ type: 'opener', severity: 'medium', term: '(opening line)', message: 'Opens with a cliche/sycophantic line. Start with the substance instead.' });
  if (bulletFlag) flags.push({ type: 'bullets', severity: 'medium', term: `${Math.round(bl.ratio * 100)}% bullets`, message: `${bl.bullets} of ${bl.lines} lines are bullets. For prose (an email or cover letter), turn some into sentences.` });

  return {
    score, insufficient: false, words,
    counts: { aiVocab: aiHighN + aiPhrase.length, aiVocabLow: aiLow.length, fillerRedundant: redundantHits.length, fillerHedge: hedgeN, opener, bulletRatio: Math.round(bl.ratio * 100) / 100 },
    density: { aiVocabPer100: Math.round(aiHighPer100 * 10) / 10, fillerPer100: Math.round((redundantPer100 + hedgePer100) * 10) / 10 },
    flags,
  };
}

// stripRedundantFiller(text): apply ONLY the short, strict inline swaps. Case of
// the first letter is preserved ("In order to" -> "To"). null/undefined pass
// through. This is the one auto-fix; everything else stays detect-only.
export function stripRedundantFiller(s) {
  if (s == null) return s;
  let t = String(s);
  for (const [re, rep] of RE_REDUNDANT) {
    t = t.replace(re, (m) => (/^[A-Z]/.test(m) ? rep.charAt(0).toUpperCase() + rep.slice(1) : rep));
  }
  return t;
}

// formatStyleReport(report) -> printable summary for a CLI / log.
export function formatStyleReport(report) {
  if (!report) return '';
  if (report.insufficient) return `style: insufficient data. ${report.message}`;
  const verdict = report.score >= 75 ? 'plain' : report.score >= 50 ? 'somewhat AI-flavored' : 'reads as AI-written';
  const lines = [`style: ${report.score}/100 (${verdict}) over ${report.words} words`];
  const c = report.counts;
  lines.push(`  ai-vocab ${c.aiVocab} (+${c.aiVocabLow} soft) / filler ${c.fillerRedundant + c.fillerHedge} / ${c.opener ? 'cliche opener / ' : ''}${Math.round(c.bulletRatio * 100)}% bullets`);
  if (report.flags.length) { lines.push('  flags:'); for (const f of report.flags) lines.push(`    [${f.severity}] ${f.message}`); }
  else lines.push('  reads clean, nothing flagged.');
  return lines.join('\n');
}
