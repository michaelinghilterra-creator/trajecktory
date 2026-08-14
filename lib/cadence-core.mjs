// cadence.mjs -- measure the rhythm of writing (sentence length variety, opener
// repetition, template sameness) and report it. Pure, dependency-free.
//
// Why: cleaning invisible characters makes text LOOK clean, but the thing that
// actually reads as machine-written is CADENCE, whether every sentence has the
// same shape and length. A character scrub does nothing to rhythm. This analyzes
// rhythm and flags monotony so a human (or a model) can vary it.
//
// This is a WRITING-QUALITY signal, not a detector and not an evasion tool. It
// tells you your lines are all the same length; it does not claim to beat any
// AI-detection system, because varying rhythm is simply better writing, not a
// trick. Small samples are reported as "insufficient", on purpose: a handful of
// lines cannot support a confident rhythm judgment, and treating one as reliable
// is reading noise as signal.

// Split text into UNITS. Each non-empty line contributes at least one unit (so a
// bullet list is one unit per bullet, even without terminal punctuation), and a
// line holding multiple sentences splits on . ! ? boundaries.
function toUnits(text) {
  const units = [];
  for (const rawLine of String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.replace(/^\s*[-*+\u2022\u2023\u25E6]\s+/, '').trim(); // drop a leading bullet marker
    if (!line) continue;
    for (const part of line.split(/(?<=[.!?])["')\]]*\s+(?=[A-Z0-9"'(\[])/)) {
      const s = part.trim();
      if (s) units.push(s);
    }
  }
  return units;
}

function words(s) {
  return s.split(/\s+/).filter((t) => /[A-Za-z0-9]/.test(t));
}
function wordCount(s) { return words(s).length; }
function firstWord(s) {
  const w = words(s)[0] || '';
  return w.toLowerCase().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '');
}
function firstTwo(s) {
  const w = words(s).slice(0, 2).map((t) => t.toLowerCase().replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''));
  return w.join(' ').trim();
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / (xs.length || 1); }
function stdev(xs, m) {
  if (xs.length < 2) return 0;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length;
  return Math.sqrt(v);
}
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function topCount(vals) {
  const m = new Map();
  for (const v of vals) if (v) m.set(v, (m.get(v) || 0) + 1);
  let bestKey = '', best = 0;
  for (const [k, c] of m) if (c > best) { best = c; bestKey = k; }
  return { key: bestKey, count: best };
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Minimum units for a confident judgment. Below this we report insufficient
// rather than a number, because variance on a handful of lines is noise.
const MIN_UNITS = 5;

// analyzeCadence(text, opts) -> report. opts.minUnits overrides the floor.
export function analyzeCadence(text, opts = {}) {
  const minUnits = opts.minUnits || MIN_UNITS;
  const units = toUnits(text);
  const n = units.length;
  if (n < minUnits) {
    return {
      score: null,
      insufficient: true,
      units: n,
      message: `Too few lines to judge rhythm (need at least ${minUnits}, found ${n}).`,
      flags: [],
      metrics: {},
    };
  }

  const lengths = units.map(wordCount);
  const m = mean(lengths);
  const sd = stdev(lengths, m);
  const cov = m > 0 ? sd / m : 0;                       // coefficient of variation
  const burstiness = sd + m > 0 ? (sd - m) / (sd + m) : 0;
  const med = median(lengths);
  const band = Math.max(2, Math.round(med * 0.15));      // "same length" window
  const inBand = lengths.filter((l) => Math.abs(l - med) <= band).length;
  const bandFraction = inBand / n;
  const opener = topCount(units.map(firstWord));
  const openerFraction = opener.count / n;
  const template = topCount(units.map(firstTwo));
  const templateFraction = template.count / n;

  // Subscores in [0,1], higher = more human variety.
  const varLen = clamp01(cov / 0.55);                    // ~0.55+ CoV earns full marks
  const antiBand = clamp01((1 - bandFraction) / 0.6);    // <=40% clustered earns full marks
  const openerDiv = clamp01(1 - (openerFraction - 0.15) / 0.5); // <=15% repeat earns full marks
  const score = Math.round(100 * (0.5 * varLen + 0.3 * antiBand + 0.2 * openerDiv));

  const flags = [];
  const push = (type, severity, message) => flags.push({ type, severity, message });

  if (cov < 0.35) {
    push('low-variance', cov < 0.22 ? 'high' : 'medium',
      `Your lines barely vary in length (${inBand} of ${n} land within ${band} word${band === 1 ? '' : 's'} of ${med}). Mix in some short lines and some longer ones.`);
  } else if (bandFraction >= 0.7 && n >= 6) {
    push('length-clustering', 'medium',
      `${inBand} of ${n} lines are about the same length (~${med} words). Vary the length so it does not read as one uniform block.`);
  }
  if (m >= 22 && cov < 0.32) {
    push('long-and-uniform', 'high',
      `Every line is long and about the same length. A reader skims the first several words, and if they all land mid-clause the point never registers. Front-load the result and add shorter lines.`);
  }
  if (opener.count >= 3 && openerFraction >= 0.4) {
    push('repeated-openers', openerFraction >= 0.6 ? 'high' : 'medium',
      `${opener.count} of ${n} lines start with "${opener.key}". Vary the opening word.`);
  }
  if (template.count >= 3 && templateFraction >= 0.3 && template.key.split(' ').length === 2) {
    push('repeated-template', 'medium',
      `${template.count} lines open with the same two words ("${template.key} ..."). Reshape some so they do not follow one template.`);
  }

  return {
    score,
    insufficient: false,
    units: n,
    flags,
    metrics: {
      meanWords: Math.round(m * 10) / 10,
      stdevWords: Math.round(sd * 10) / 10,
      cov: Math.round(cov * 100) / 100,
      burstiness: Math.round(burstiness * 100) / 100,
      medianWords: med,
      bandFraction: Math.round(bandFraction * 100) / 100,
      topOpener: { word: opener.key, count: opener.count },
    },
  };
}

// formatCadenceReport(report) -> a printable multi-line string for a CLI/log.
export function formatCadenceReport(report) {
  if (!report) return '';
  if (report.insufficient) return `cadence: insufficient data. ${report.message}`;
  const lines = [];
  const verdict = report.score >= 70 ? 'varied' : report.score >= 45 ? 'somewhat uniform' : 'monotonous';
  lines.push(`cadence: ${report.score}/100 (${verdict}) over ${report.units} lines`);
  const mx = report.metrics;
  lines.push(`  mean ${mx.meanWords} words, stdev ${mx.stdevWords}, variation ${mx.cov}, ${Math.round(mx.bandFraction * 100)}% same-length`);
  if (report.flags.length) {
    lines.push('  flags:');
    for (const f of report.flags) lines.push(`    [${f.severity}] ${f.message}`);
  } else {
    lines.push('  no rhythm problems flagged.');
  }
  return lines.join('\n');
}
