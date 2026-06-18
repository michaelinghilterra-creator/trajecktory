// Parses a career-ops report .md file into the cheat-sheet shape expected by the drawer.

// ── Helpers ──────────────────────────────────────────────────────────────────

function getHeader(lines, key) {
  const line = lines.find(l => l.startsWith(`**${key}:**`));
  if (!line) return null;
  return line.replace(`**${key}:**`, '').trim()
    .replace(/[🟢🟡🔴❌✅⚠️]/g, '').trim();
}

// Extract all lines belonging to a section (## A), ## B), ## Block B —, etc.)
function getSectionLines(lines, letter) {
  // Matches: ## B) / ## B. / ## B — / ## Block B / ## Bloque B / ## Blok B
  const start = new RegExp(`^##\\s+(block\\s+|bloque\\s+|blok\\s+)?${letter}([).\\s—\\-]|$)`, 'i');
  const nextSection = new RegExp(`^##\\s+(block\\s+|bloque\\s+|blok\\s+)?[A-Z]([).\\s—\\-]|$)`, 'i');
  const idx = lines.findIndex(l => start.test(l.trim()));
  if (idx === -1) return [];
  const result = [];
  for (let i = idx + 1; i < lines.length; i++) {
    if (i > idx + 1 && nextSection.test(lines[i].trim())) break;
    if (/^---+$/.test(lines[i])) break;
    result.push(lines[i]);
  }
  return result;
}

// Parse a markdown table into array of row objects keyed by column index
function parseMdTable(lines) {
  const tableLines = lines.filter(l => /^\|.+\|/.test(l.trim()) && !/^\|[-: |]+\|$/.test(l.trim()));
  if (tableLines.length < 2) return { headers: [], rows: [] };
  const parseRow = l => l.split('|').map(c => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
  const headers = parseRow(tableLines[0]).map(h => h.toLowerCase());
  const rows = tableLines.slice(1).map(parseRow);
  return { headers, rows };
}

// Map markdown table to array of plain objects using best-guess column matching
function tableToObjects(lines, colMap) {
  const { headers, rows } = parseMdTable(lines);
  return rows.map(row => {
    const obj = {};
    for (const [key, candidates] of Object.entries(colMap)) {
      const idx = headers.findIndex(h => candidates.some(c => h.includes(c)));
      obj[key] = idx >= 0 ? (row[idx] || '').trim() : '';
    }
    return obj;
  }).filter(obj => Object.values(obj).some(v => v));
}

// Normalize strength string to strong / moderate / weak
function normalizeStrength(raw) {
  const s = raw.toLowerCase();
  if (s.includes('✅') || s === 'direct' || s.startsWith('direct') || s.includes('strong')) return 'strong';
  if (s.includes('⚠') || s.includes('adjacent') || s.includes('moderate') || s.includes('~')) return 'moderate';
  if (s.includes('❌') || s.includes('gap') || s.includes('weak')) return 'weak';
  return 'moderate'; // default to moderate rather than weak for unknowns
}

// Extract text after a bold heading on the same or next lines
function getBoldSection(lines, keyword) {
  const idx = lines.findIndex(l => l.toLowerCase().includes(keyword.toLowerCase()) && l.includes('**'));
  if (idx === -1) return null;
  // Inline value (same line)
  const inline = lines[idx].replace(/\*\*[^*]+\*\*:?\s*/, '').trim();
  if (inline) return inline;
  // Collect following lines until next bold heading or blank
  const result = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (/^\*\*/.test(l) || l.startsWith('#')) break;
    if (l.trim()) result.push(l.replace(/^[-*]\s+/, '').trim());
  }
  return result.join(' ') || null;
}

// Collect bullet points under a keyword section
function getBulletSection(lines, keyword) {
  const idx = lines.findIndex(l => l.toLowerCase().includes(keyword.toLowerCase()));
  if (idx === -1) return [];
  const bullets = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const l = lines[i].trim();
    if (/^\*\*/.test(l) && l.includes(':')) break;
    if (l.startsWith('#')) break;
    if (/^[-*"•]/.test(l)) bullets.push(l.replace(/^[-*"•]\s*[""]?/, '').replace(/[""]$/, '').trim());
  }
  return bullets.filter(Boolean);
}

// ── Section parsers ───────────────────────────────────────────────────────────

function parseHeader(lines) {
  return {
    url: getHeader(lines, 'URL'),
    legitimacy: getHeader(lines, 'Legitimacy') || getHeader(lines, 'Legitimidad'),
    archetypeDetected: getHeader(lines, 'Archetype') || getHeader(lines, 'Arquetipo'),
  };
}

function parseSectionA(lines) {
  const { headers, rows } = parseMdTable(lines);
  const kv = {};
  // Section A is a 2-column key-value table
  rows.forEach(row => {
    if (row.length >= 2) {
      const key = (row[0] || '').toLowerCase().replace(/\s+/g, '_');
      kv[key] = row[1];
    }
  });

  const get = (...keys) => {
    for (const k of keys) {
      const hit = Object.entries(kv).find(([key]) => keys.some(kk => key.includes(kk.toLowerCase())));
      if (hit) return hit[1];
    }
    return null;
  };

  // Find each field by fuzzy key match
  const field = (...candidates) => {
    for (const [k, v] of Object.entries(kv)) {
      if (candidates.some(c => k.includes(c.toLowerCase()))) return v;
    }
    return null;
  };

  // Company brief — multiple fallbacks since batch reports often omit it:
  //   1. **Company:** line (oldest convention)
  //   2. First prose paragraph after the table (some agents do this)
  //   3. TL;DR + Domain/Function from the table (batch reports always have these)
  const companyBriefLine = lines.find(l => /^\*\*Company[:\s*]/.test(l));
  let companyBrief;
  if (companyBriefLine) {
    companyBrief = companyBriefLine.replace(/^\*\*Company[^:]*:\*\*\s*/, '').trim();
  } else {
    // Fall back 2: first non-table, non-header, non-bullet paragraph that follows the table
    let pastTable = false;
    for (const l of lines) {
      const t = l.trim();
      if (/^\|.+\|/.test(t)) { pastTable = true; continue; }
      if (!pastTable) continue;
      if (!t || /^[#*\-|]/.test(t) || /^\|[-: |]+\|/.test(t)) continue;
      companyBrief = t.replace(/\*\*/g, '');
      break;
    }
  }

  const domainV    = field('domain');
  const functionV  = field('function');
  const tldrV      = field('tl;dr', 'tldr', 'resumen');

  // Fall back 3: synthesize from table fields. Always available in batch reports.
  if (!companyBrief && (domainV || functionV || tldrV)) {
    const parts = [];
    if (domainV)   parts.push(domainV);
    if (functionV) parts.push(functionV);
    const prefix = parts.length > 0 ? `${parts.join(' · ')}.` : '';
    companyBrief = [prefix, tldrV].filter(Boolean).join(' ').trim() || null;
  }

  return {
    archetypeDetected: field('archetype') || null,
    domain: domainV || null,
    function: functionV || null,
    seniority: field('seniority', 'nivel') || null,
    remote: field('remote', 'location', 'ubicación') || null,
    teamSize: field('team', 'equipo') || null,
    compStated: field('comp', 'salary', 'salario', 'compensation') || null,
    tldr: tldrV || null,
    companyBrief: companyBrief || null,
  };
}

function parseSectionB(lines) {
  // Split at the gaps sub-section — handles ### Gaps*, **Gaps*:**, **Gap*:** variants
  const gapHeadIdx = lines.findIndex(l =>
    /^#{2,4}\s+(gap|gaps|brecha|brechas)/i.test(l.trim()) ||
    /^\*\*(gap|gaps|brecha|brechas)[^*]*\*\*\s*:?\s*$/i.test(l.trim())
  );
  const matchLines = gapHeadIdx >= 0 ? lines.slice(0, gapHeadIdx) : lines;
  const gapLines   = gapHeadIdx >= 0 ? lines.slice(gapHeadIdx + 1) : [];

  // CV match table: JD Requirement | CV Evidence | Strength
  // Handles many header variants across report generations:
  // req:      "JD Requirement", "JD Signal", "JD Function", "JD Signal (Inferred)", "Dimension"
  // evidence: "CV Evidence", "CV Match", "the candidate's CV", "CV Coverage", "Match in CV", "the candidate's profile"
  const cvMatchObjs = tableToObjects(matchLines, {
    req: ['requirement', 'jd req', 'requisito', 'signal', 'jd function', 'jd signal'],
    evidence: ['cv match', 'evidence', 'cv evidence', 'coverage', 'match in'],
    strength: ['strength', 'fuerza', 'gap', 'match', 'source', 'status', 'level', 'type'],
  });

  const cvMatch = cvMatchObjs
    .filter(o => o.req && o.evidence)
    .map(o => ({
      req: o.req,
      evidence: o.evidence,
      strength: normalizeStrength(o.strength || ''),
    }));

  // Gaps table: Gap | Blocker? | Mitigation
  const { headers: gHeaders, rows: gRows } = parseMdTable(gapLines);
  const gaps = [];
  const gapIdx   = gHeaders.findIndex(h => h.includes('gap') || h.includes('brecha'));
  const mitIdx   = gHeaders.findIndex(h => h.includes('mitigation') || h.includes('mitigación') || h.includes('mitiga'));
  const blockIdx = gHeaders.findIndex(h => h.includes('blocker') || h.includes('bloqueo'));

  gRows.forEach(row => {
    const g = (row[gapIdx >= 0 ? gapIdx : 0] || '').trim();
    if (g && g !== 'Gap') {
      gaps.push({
        gap: g,
        mitigation: mitIdx >= 0 ? (row[mitIdx] || '').trim() : '',
        blocker: blockIdx >= 0 ? (row[blockIdx] || '').trim() : 'Nice-to-have',
      });
    }
  });

  return { cvMatch, gaps };
}

function parseSectionC(lines) {
  // Level match
  const levelLine = lines.find(l => /nivel detectado|level detected|level:|archetype level/i.test(l));
  const jdLevel = levelLine
    ? levelLine.replace(/\*\*/g, '').replace(/.*?:/i, '').trim()
    : null;

  // Sell senior: try bullet list first, then table format
  const sellBullets = getBulletSection(lines, 'sell senior');
  let sellSenior;
  if (sellBullets.length > 0) {
    sellSenior = sellBullets.map(b => ({ claim: b, proof: '', phrase: b }));
  } else {
    // Table format: | Claim | Proof point | Exact phrase |
    const sellHeadIdx = lines.findIndex(l => /sell senior/i.test(l));
    const sellTableLines = sellHeadIdx >= 0 ? lines.slice(sellHeadIdx + 1) : lines;
    const sellObjs = tableToObjects(sellTableLines, {
      claim: ['claim'],
      proof: ['proof'],
      phrase: ['phrase', 'exact phrase'],
    });
    sellSenior = sellObjs.filter(o => o.claim).map(o => ({
      claim: o.claim || '',
      proof: o.proof || '',
      phrase: o.phrase || o.claim || '',
    }));
  }

  // Downlevel plan: try bullets, then prose paragraph after the downlevel heading
  const downlevelBullets = getBulletSection(lines, 'downlevel');
  let downlevelPlan = downlevelBullets.join(' ') || getBoldSection(lines, 'downlevel') || null;
  if (!downlevelPlan) {
    const dlIdx = lines.findIndex(l => /downlevel|if they downlevel/i.test(l));
    if (dlIdx >= 0) {
      for (let i = dlIdx + 1; i < Math.min(dlIdx + 10, lines.length); i++) {
        const t = lines[i].trim();
        if (t && !/^[#|*\-]/.test(t)) { downlevelPlan = t.replace(/\*\*/g, ''); break; }
      }
    }
  }

  return {
    levelMatch: {
      jdLevel,
      naturalLevel: 'Director / Senior Director',
      verdict: getBoldSection(lines, 'level') || jdLevel,
    },
    sellSenior,
    downlevelPlan,
  };
}

function parseSectionD(lines) {
  // Expanded column matching: handles "Source|Data", "Factor|Detail", "Source|Figure", "Metric|Value" etc.
  const sourcesObjs = tableToObjects(lines, {
    src:  ['source', 'fuente', 'factor', 'metric', 'item', 'dimension', 'category'],
    data: ['data', 'dato', 'amount', 'range', 'figure', 'detail', 'value', 'comp', 'result'],
    note: ['reliability', 'note', 'nota', 'fiabilidad'],
  });

  const sources = sourcesObjs
    .filter(o => o.src && o.data)
    .map(o => ({ src: o.src, data: o.data, note: o.note || '' }));

  // For key-value style tables (Factor|Detail), try to find stated OTE by row label
  const statedRow = sources.find(o =>
    /ote|total comp|stated|posted salary|salary range|compensation range|estimated ote/i.test(o.src)
  );
  // If no good row, try the first row that contains a dollar sign
  const dollarRow = sources.find(o => /\$/.test(o.data));

  // Assessment/verdict: check both before first table row and after last table row
  const firstTableRow = lines.findIndex(l => /^\|/.test(l.trim()));
  const lastTableRow  = lines.reduce((last, l, i) => /^\|/.test(l.trim()) ? i : last, -1);

  const extractRichText = (slice) => slice
    .filter(l => l.trim() && !/^\|/.test(l.trim()) && !/^#{1,4}\s/.test(l.trim()) && !/^[-]{3,}/.test(l.trim()))
    .map(l => l.replace(/^\*\*[^*]+\*\*\s*:?\s*/, '').replace(/^>\s*/, '').replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean);

  const beforeTable = firstTableRow > 0 ? extractRichText(lines.slice(0, firstTableRow)) : [];
  const afterTable  = lastTableRow >= 0  ? extractRichText(lines.slice(lastTableRow + 1)) : [];

  // Also extract from bullet list / prose when no table present
  const allProse = extractRichText(lines);

  // Pick the richest source for the market/verdict text
  const richLines = afterTable.length ? afterTable : (beforeTable.length ? beforeTable : allProse);
  const verdict = richLines[0] || null;
  const market  = richLines.join(' ').trim() || verdict;

  // Extract stated comp — prefer explicit OTE/salary row, then dollar-value row, then prose regex
  let statedComp = statedRow?.data || dollarRow?.data || sources[0]?.data || null;
  if (!statedComp) {
    // Try to extract from prose: find first $X–$Y pattern
    const proseAll = lines.join(' ');
    const m = proseAll.match(/\$[\d,]+K?(?:–|—|-)\$?[\d,]+K?/);
    if (m) statedComp = m[0];
  }

  return {
    comp: {
      stated: statedComp,
      sources,
      score: null,
      walkaway: null,
      verdict,
      market,
    },
  };
}

function parseSectionE(lines) {
  // Split at "### Top 5 LinkedIn Changes" OR "**Top 5 LinkedIn Changes:**" to separate CV vs LI sections
  const liHeadIdx = lines.findIndex(l =>
    /###.*(linkedin|li\s+change)/i.test(l.trim()) ||
    /^\*\*top\s+\d+\s+linkedin/i.test(l.trim())
  );
  const cvLines = liHeadIdx >= 0 ? lines.slice(0, liHeadIdx) : lines;
  const liLines = liHeadIdx >= 0 ? lines.slice(liHeadIdx + 1) : [];

  const colMap = {
    section: ['section', 'sección'],
    current: ['current', 'estado actual', 'actual'],
    change: ['proposed', 'change', 'cambio', 'propuesto'],
    why: ['why', 'por qué', 'reason'],
  };

  // Parse numbered/bulleted list items as change objects (new batch report format)
  // Try to split "change — why" prose into separate fields when an em-dash is present
  const splitChangeWhy = (text) => {
    // Pattern: "Bold heading: change description — why explanation"
    // or just  "change description — why explanation"
    // The em-dash (—) or " - " near the end usually indicates the rationale
    const emDash = text.indexOf(' — ');
    const enDash = text.indexOf(' – ');
    // Only split on em/en-dash, never plain hyphen (too many false positives in compound terms)
    const splitIdx = emDash >= 0 ? emDash : enDash;
    if (splitIdx > 20 && splitIdx < text.length - 10) {
      // Heuristic: only split if the "why" half mentions a JD-mapping verb
      const after = text.slice(splitIdx + 3).trim();
      const before = text.slice(0, splitIdx).trim();
      if (/\b(maps?|aligns?|matches?|signals?|demonstrates?|directly|exact|because|since|to (?:show|demonstrate|signal|emphasize))/i.test(after) ||
          after.length < before.length * 0.8) {
        return { change: before, why: after };
      }
    }
    return { change: text, why: '' };
  };

  const parseBulletList = lineSet => lineSet
    .map(l => {
      const m = l.trim().match(/^(?:\d+\.|[-*•])\s+(.+)/);
      if (!m) return null;
      const text = m[1].trim();
      // Skip N/A stubs that some agents write when the role is not worth pursuing
      if (/^n\/a\b|not applicable|not recommended/i.test(text)) return null;
      // Strip leading "**Bold title:**" prefix and treat it as the section header
      const titled = text.match(/^\*\*([^*]+?)\*\*:?\s*(.+)/);
      let section = '';
      let body = text;
      if (titled) {
        section = titled[1].trim().replace(/:$/, '');
        body = titled[2].trim();
      }
      const { change, why } = splitChangeWhy(body);
      return { section, current: '', change, why };
    })
    .filter(Boolean);

  const mapObjs = lineSet => {
    const tableItems = tableToObjects(lineSet, colMap)
      .filter(o => o.section || o.change)
      .map(o => ({
        section: o.section || '',
        current: o.current || '',
        change: o.change || '',
        why: o.why || '',
      }));
    // Fallback to bullet/numbered list if no table found
    return tableItems.length > 0 ? tableItems : parseBulletList(lineSet);
  };

  return {
    customizationCV: mapObjs(cvLines),
    customizationLI: mapObjs(liLines),
  };
}

function parseSectionF(lines) {
  const starObjs = tableToObjects(lines, {
    req: ['requirement', 'jd req', 'requisito'],
    title: ['story star', 'title', 'historia', 'story'],
    S: [' s '],
    T: [' t '],
    A: [' a '],
    R: [' r '],
  });

  // Fallback: if columns not found by header, try positional (skip # col)
  const { headers, rows } = parseMdTable(lines);
  const stories = [];

  if (headers.length >= 6) {
    // Find S T A R columns positionally if headers are #, req, title, s, t, a, r
    rows.forEach(row => {
      if (row.length < 5) return;
      // Skip the # column (row[0])
      stories.push({
        req: row[1] || '',
        title: row[2] || '',
        S: row[3] || '',
        T: row[4] || '',
        A: row[5] || '',
        R: row[6] || '',
      });
    });
  }

  // Prose fallback: handles all batch report STAR story formats:
  // 1. "1. **Title (STAR):** description"      → title + desc
  // 2. "1. **STAR: Title** — description"       → title + desc
  // 3. "1. **Situation:** S. **Task:** T. ..."  → inline split
  // 4. "**1. Title**" header + bulleted "- *Situation:* ...\n- *Task:* ..." rows
  const parseProseStar = () => {
    const proseStories = [];

    // Format 4 first: "**N. Title**" header followed by bulleted *Situation:* / *Task:* lines
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].trim();
      const headMatch = h.match(/^\*\*\s*(\d+)\.\s+(.+?)\*\*\s*$/);
      if (!headMatch) continue;
      const title = headMatch[2].replace(/\s*\(.*?\)\s*$/, '').replace(/[:\s]+$/, '').trim();
      const extract = (keywords) => {
        const kwGroup = Array.isArray(keywords) ? keywords.join('|') : keywords;
        for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
          const ll = lines[j].trim();
          if (!ll) continue;
          if (/^##/.test(ll)) break;
          if (/^\*\*\s*\d+\.\s+/.test(ll)) break; // next story
          const rx = new RegExp(`^[-*•]?\\s*\\*{1,2}(?:${kwGroup})[:\\s]+\\*{0,2}\\s*(.+)`, 'i');
          const m = ll.match(rx);
          if (m && m[1]) return m[1].replace(/\*{1,2}$/, '').trim();
        }
        return '';
      };
      const S = extract('Situation');
      const T = extract('Task');
      const A = extract('Action');
      const R = extract('Result');
      if (S && (T || A || R)) {
        proseStories.push({ req: extract(['Relevance', 'Maps to']), title, S, T, A, R });
      }
    }
    if (proseStories.length > 0) return proseStories;

    for (const l of lines) {
      const t = l.trim();
      // Must start with a numbered item or bullet
      if (!/^(?:\d+\.|[-*•])\s+/.test(t)) continue;

      // Check for inline S/T/A/R format: "1. **Situation:** ... **Task:** ..."
      // Also accepts single-asterisk italics: "*Situation:* ... *Task:* ..."
      if (/\*\*?Situation[:\s]/i.test(t) || /\*\*?S:\s/i.test(t)) {
        const extract = (keyword) => {
          const rx = new RegExp(`\\*{1,2}${keyword}[:\\s]+\\*{0,2}(.+?)(?=\\*{1,2}(?:Situation|Task|Action|Result|S:|T:|A:|R:)|$)`, 'i');
          const m = t.match(rx);
          return m ? m[1].replace(/\*{1,2}$/, '').trim() : '';
        };
        // Extract title from the numbered prefix e.g. "1. **Situation:**" → no title; use S as title
        const S = extract('Situation');
        const T = extract('Task');
        const A = extract('Action');
        const R = extract('Result');
        if (S) {
          // Derive a title from the first ~6 words of S
          const titleWords = S.split(/\s+/).slice(0, 6).join(' ').replace(/[.,:;]$/, '');
          proseStories.push({ req: '', title: titleWords, S, T, A, R });
          continue;
        }
      }

      // General: "1. **Bold Title** — description" or "1. **Title:** description"
      // Allow em-dash (—), en-dash (–), hyphen, colon, or space as separator after **
      const mBold = t.match(/^(?:\d+\.|[-*•])\s+\*\*(.+?)\*\*[\s—–:\-]*(.*)/);
      if (mBold) {
        const rawTitle = mBold[1].trim();
        const desc = mBold[2].trim();
        // Skip "Not applicable" or "Omitted" stubs
        if (/not applicable|omitted|n\/a|not recommended/i.test(rawTitle)) continue;
        const title = rawTitle
          .replace(/\s*\(?\bstar\b\)?\s*/i, '')
          .replace(/^star:\s*/i, '')
          .replace(/:$/, '')
          .trim();
        if (title && (desc || rawTitle)) {
          proseStories.push({ req: '', title, S: desc || rawTitle, T: '', A: '', R: '' });
        }
        continue;
      }

      // Plain numbered item without bold: "1. Text — description" or "1. Plain text"
      const mPlain = t.match(/^(?:\d+\.|[-*•])\s+([^*\n]{8,})/);
      if (mPlain) {
        const text = mPlain[1].trim();
        // Skip stubs and N/A items
        if (/^n\/a\b|not applicable|not recommended|omitted/i.test(text)) continue;
        const emDash = text.indexOf('—'); // em-dash
        const enDash = text.indexOf('–'); // en-dash
        const dashIdx = emDash >= 0 ? emDash : (enDash >= 0 ? enDash : text.indexOf(' — '));
        const colonIdx = text.indexOf(':');
        let title, desc;
        if (dashIdx > 3) {
          title = text.slice(0, dashIdx).trim();
          desc = text.slice(dashIdx + 1).replace(/^[\s—–\-]+/, '').trim();
        } else if (colonIdx > 3 && colonIdx < 60) {
          title = text.slice(0, colonIdx).trim();
          desc = text.slice(colonIdx + 1).trim();
        } else {
          title = text.slice(0, 60);
          desc = text;
        }
        if (title) {
          proseStories.push({ req: '', title, S: desc || text, T: '', A: '', R: '' });
        }
      }
    }
    return proseStories;
  };

  const result = stories.length > 0
    ? stories
    : starObjs.length > 0
      ? starObjs.map(o => ({
          req: o.req || '',
          title: o.title || '',
          S: o.S || '',
          T: o.T || '',
          A: o.A || '',
          R: o.R || '',
        }))
      : parseProseStar();

  // Case study / lead story
  const caseStudyLine = lines.find(l => /case study|lead story/i.test(l));
  const leadText = caseStudyLine
    ? caseStudyLine.replace(/\*\*/g, '').replace(/.*?:/i, '').trim()
    : (result[0]?.title || null);

  // Red-flag Q handling
  const rfIdx = lines.findIndex(l => /red.flag/i.test(l));
  const redFlagQs = [];
  if (rfIdx >= 0) {
    const rfLines = lines.slice(rfIdx + 1);
    // Table format: | Question | Answer | (or | Q | How to answer | Red flag | Honest response | etc.)
    const tableObjs = tableToObjects(rfLines, {
      q: ['question', 'q', 'pregunta', 'red flag', 'red-flag'],
      a: ['answer', 'how to answer', 'response', 'respuesta', 'cómo responder', 'honest response'],
    });
    if (tableObjs.length > 0) {
      tableObjs.forEach(o => {
        if (o.q) redFlagQs.push({ q: o.q, behind: '', a: o.a || '' });
      });
    } else {
      // Bullet list format and **Q:** > answer blockquote format
      let pendingQ = null;
      for (let i = 0; i < rfLines.length && i < 40; i++) {
        const l = rfLines[i].trim();
        if (!l) { pendingQ = null; continue; }
        if (/^#{1,4}\s/.test(l)) break;
        // **Q: "..."** style (with or without closing **)
        const boldQ = l.match(/^\*\*Q:\s*["""]?(.+?)["""]?\*\*?\s*$/i);
        if (boldQ) { pendingQ = boldQ[1].trim(); continue; }
        // > "answer" blockquote or A: "answer" line after a boldQ
        if (pendingQ && /^>/.test(l)) {
          redFlagQs.push({ q: pendingQ, behind: '', a: l.replace(/^>\s*/, '').replace(/^["""]|["""]$/g, '').trim() });
          pendingQ = null;
          continue;
        }
        if (pendingQ && /^A:\s*/i.test(l)) {
          redFlagQs.push({ q: pendingQ, behind: '', a: l.replace(/^A:\s*/i, '').replace(/^["""]|["""]$/g, '').trim() });
          pendingQ = null;
          continue;
        }
        // bullet: - "Q?" → answer
        const qMatch = l.match(/^[-*]\s*["""]?(.+?)[?"""]?\s*[→=>]\s*(.+)/);
        if (qMatch) {
          redFlagQs.push({ q: qMatch[1].trim(), behind: '', a: qMatch[2].trim() });
        } else if (/^[-*]/.test(l)) {
          const plain = l.replace(/^[-*]\s*/, '');
          if (plain.includes('?')) {
            const [q, ...rest] = plain.split('?');
            redFlagQs.push({ q: q + '?', behind: '', a: rest.join('?').replace(/^[\s→=>]+/, '').trim() });
          } else {
            redFlagQs.push({ q: plain, behind: '', a: plain });
          }
        }
      }
    }
  }

  return {
    starStories: result.filter(s => s.req || s.title),
    leadStory: { title: leadText, reason: leadText, script: leadText },
    redFlagQs,
  };
}

function parseSectionG(lines) {
  // ── 1. Try table format (old reports) ──────────────────────────────────────
  const signalObjs = tableToObjects(lines, {
    signal: ['signal', 'señal', 'indicator'],
    finding: ['finding', 'hallazgo', 'result', 'detail'],
    weight: ['weight', 'peso', 'status', 'good', 'result'],
  });

  let legitimacySignals = signalObjs
    .filter(o => o.signal)
    .map(o => ({
      signal: o.signal,
      finding: o.finding || '',
      good: !/negative|bad|suspicious|red|❌|✕/i.test(o.weight + o.finding),
    }));

  // ── 2. Bullet list fallback (new batch format: **Signals:** + bullets) ─────
  if (legitimacySignals.length === 0) {
    // Find signals section: "**Signals:**" or "### Signals"
    const sigIdx = lines.findIndex(l =>
      /^\*\*signals?\*\*\s*:?\s*$/i.test(l.trim()) ||
      /^#{2,4}\s+signals?/i.test(l.trim())
    );
    if (sigIdx >= 0) {
      for (let i = sigIdx + 1; i < lines.length; i++) {
        const l = lines[i].trim();
        if (!l) continue;
        if (/^#{1,4}\s/.test(l) || (/^\*\*/.test(l) && l.includes(':**'))) break;
        const m = l.match(/^[-*•]\s+(.+)/);
        if (m) {
          const text = m[1].replace(/\*\*/g, '').trim();
          const good = !/❌|negative|bad|suspicious|red flag|hard-no|hard blocker/i.test(text);
          legitimacySignals.push({ signal: text, finding: '', good });
        }
      }
    }

    // If still no signals, extract non-boilerplate prose lines
    if (legitimacySignals.length === 0) {
      for (const l of lines) {
        const t = l.trim();
        if (!t) continue;
        if (/^#/.test(t)) continue;
        if (/^\|/.test(t)) continue;
        if (/^\*\*(?:verification|freshness|company news|batch|unverified)/i.test(t)) continue;
        // Take bullet points or standalone prose lines as signals (but NOT the Tier line itself)
        if (/^\*\*tier[^*]*\*\*/i.test(t)) continue;
        const raw = t.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '').trim();
        if (raw.length > 10) {
          const good = !/❌|negative|bad|suspicious|red flag|hard-no|unverified/i.test(raw);
          legitimacySignals.push({ signal: raw, finding: '', good });
          if (legitimacySignals.length >= 5) break; // cap prose extraction
        }
      }
    }

    // Last resort: if ONLY Verification + Tier lines exist, use the Tier content as a signal
    if (legitimacySignals.length === 0) {
      const tierLine2 = lines.find(l => /^\*\*tier[^*]*\*\*/i.test(l.trim()) || /^Tier:\s+/i.test(l.trim()));
      if (tierLine2) {
        const raw = tierLine2
          .replace(/^\*\*Tier[^*]*\*\*:?\s*/i, '')
          .replace(/\*\*/g, '')
          .trim();
        if (raw) {
          const good = !/caution|suspicious|questionable|proceed with caution/i.test(raw);
          legitimacySignals.push({ signal: raw, finding: '', good });
        }
      }
    }
  }

  // ── 3. Conclusion / context notes ─────────────────────────────────────────
  // Try after table first
  const tableLines = lines.filter(l => /^\|.+\|/.test(l.trim()));
  const lastTableLine = tableLines.length > 0
    ? lines.lastIndexOf(tableLines[tableLines.length - 1])
    : -1;
  const afterTable = lastTableLine >= 0 ? lines.slice(lastTableLine + 1) : [];

  const cleanLine = l => l
    .replace(/^\*\*(Conclusion|Verdict|Context|Notes?|Tier|Assessment|Freshness|Verification)[^*]*\*\*:?\s*/i, '')
    .replace(/\*\*/g, '')
    .replace(/^[-*•]\s*/, '')
    .trim();

  const conclusionLines = (afterTable.length > 0 ? afterTable : lines)
    .filter(l => {
      const t = l.trim();
      if (!t || /^#/.test(t) || /^\|/.test(t)) return false;
      if (/^\*\*(?:Assessment|Tier)[^*]*\*\*\s*:/i.test(t)) return false;
      return true;
    })
    .map(cleanLine)
    .filter(Boolean);

  // Prefer the Tier line as conclusion if present
  const tierLine = lines.find(l => /^\*\*tier[^*]*\*\*/i.test(l.trim()) || /^Tier:\s+/i.test(l.trim()));
  const tierText = tierLine ? cleanLine(tierLine) : null;

  const legitimacyConclusion = tierText ||
    conclusionLines.join(' ').trim() ||
    null;

  return { legitimacySignals, legitimacyConclusion };
}

function parseGlobalScoreSection(lines) {
  // Find ## Global Score section
  const startIdx = lines.findIndex(l => /^##\s+global\s+score/i.test(l.trim()));
  if (startIdx === -1) return { globalScore: [], recommendation: null };

  const sectionLines = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim()) && i > startIdx + 1) break;
    sectionLines.push(lines[i]);
  }

  // Parse score table: | Dimension | Score |
  const { rows } = parseMdTable(sectionLines);
  const globalScore = [];
  for (const row of rows) {
    if (row.length < 2) continue;
    const dim = (row[0] || '').replace(/\*\*/g, '').trim();
    const scoreRaw = (row[1] || '').replace(/[🟢🟡🔴✅⚠️❌]/g, '').trim();
    // Skip the **Global** total row
    if (!dim || /^global$/i.test(dim)) continue;
    const m = scoreRaw.match(/^(-?[\d.]+)/);
    if (!m) continue;
    const val = parseFloat(m[1]);
    globalScore.push({ dim, val, max: 5 });
  }

  // Parse recommendation: **Recommendation: ...** or **Recommendation:** ... line
  const recLine = sectionLines.find(l => /^\*\*recommendation/i.test(l.trim()));
  const recommendation = recLine
    ? recLine.replace(/^\*\*Recommendation[^*]*\*\*:?\s*/i, '').replace(/\*\*$/, '').trim()
    : null;

  return { globalScore, recommendation };
}

function parseKeywords(lines) {
  // Primary: explicit "## Keywords" / "## Keywords extraídas" / "## Extracted Keywords" section
  const idx = lines.findIndex(l => /keywords/i.test(l) && l.startsWith('#'));
  if (idx !== -1) {
    const kwLine = lines.slice(idx + 1).find(l => l.trim() && !/^#/.test(l));
    if (kwLine) {
      // Support comma-separated, pipe-separated, or bullet-list keywords
      const sep = kwLine.includes('|') && !kwLine.includes(',') ? '|' : ',';
      const single = kwLine.split(sep).map(k => k.trim().replace(/^[-*•]\s*/, '')).filter(Boolean);
      if (single.length > 1) return single;
      // If it was a single bullet, collect more bullets
      const bullets = [];
      for (let i = idx + 1; i < lines.length; i++) {
        const t = lines[i].trim();
        if (/^#/.test(t)) break;
        const m = t.match(/^[-*•]\s+(.+)/);
        if (m) bullets.push(m[1].trim());
      }
      if (bullets.length) return bullets;
    }
  }

  // Fallback: derive keywords from Block B's JD Requirements column.
  // These are literally the JD's must-haves — perfect ATS material.
  const blockBStart = lines.findIndex(l => /^##\s+(block\s+|bloque\s+)?B[).\s—\-]/i.test(l.trim()));
  if (blockBStart === -1) return [];
  const blockBEnd = lines.findIndex((l, i) => i > blockBStart && /^##\s+(block\s+|bloque\s+)?[A-Z][).\s—\-]/i.test(l.trim()));
  const bLines = blockBEnd === -1 ? lines.slice(blockBStart) : lines.slice(blockBStart, blockBEnd);

  const tableRows = bLines.filter(l => /^\|.+\|/.test(l.trim()) && !/^\|[-: |]+\|$/.test(l.trim()));
  if (tableRows.length < 2) return [];

  // First col of each row (after header) is the JD requirement
  const requirements = tableRows.slice(1)
    .map(r => r.split('|').map(c => c.trim()).filter(Boolean)[0])
    .filter(Boolean)
    .filter(req => req.length < 80 && !/^jd req/i.test(req)); // skip header re-appearances and prose

  // Cap at 20; longest match-first so the most specific items win
  return requirements.slice(0, 20);
}

// ── Legacy prose-format helpers ────────────────────────────────────────────────────

// V1: section A = "Role Fit" / "Archetype Match" (table-based CV match in section B)
function isLegacyProseFormat(lines) {
  return lines.some(l => /^##\s+A[.)]\s+.*(role fit|archetype match)/i.test(l.trim()));
}

// V2/V3: both batch formats use A–G sections and the same bullet structure.
// V2: "## A. CV Match — 4.0/5"   V3: "## Block A — CV Match (3.8/5)"
// Standard cheat-sheet format uses "## Block A — Role Summary" — must NOT match V2 detector.
function isLegacyProseFormatV2(lines) {
  return lines.some(l =>
    /^##\s+A[.)]\s+cv\s+match/i.test(l.trim()) ||
    /^##\s+block\s+A\b.*(?:cv\s+match|north\s+star)/i.test(l.trim())
  );
}

// Extract comp range string from prose (e.g. "$218,000–$273,000 base + equity")
function extractCompFromProse(lines) {
  for (const line of lines) {
    const m = line.match(/\$([\d,]+(?:[Kk])?)\s*[–\-—]+\s*\$([\d,]+(?:[Kk])?)/);
    if (m) return m[0].replace(/\s+/g, ' ');
    const m2 = line.match(/\$([\d,]+(?:[Kk])?)\s+(?:base|OTE|annually|\/yr)/i);
    if (m2) return m2[0];
  }
  return null;
}

// Extract first meaningful prose paragraph from section lines
function extractProseSummary(lines) {
  const paras = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || /^[#|*>-]/.test(t) || /^\|[-: |]+\|/.test(t)) continue;
    paras.push(t.replace(/\*\*/g, ''));
    if (paras.length >= 3) break;
  }
  return paras.join(' ').trim() || null;
}

// Extract location/remote signal from prose lines
function extractRemote(lines) {
  for (const line of lines) {
    const t = line.trim();
    if (/remote/i.test(t) || /hybrid/i.test(t) || /onsite/i.test(t) || /on-site/i.test(t)) {
      return t.replace(/\*\*/g, '').replace(/^[*-]\s*/, '').slice(0, 80);
    }
  }
  return null;
}

// Parse gaps from Section B prose ("**Gap:**" or "**Gaps:**" lines)
function extractGapsFromProse(lines) {
  const gaps = [];
  for (const line of lines) {
    const t = line.trim();
    if (!/^\*\*gap/i.test(t) && !/^gap[s]?:/i.test(t) && !/^\*\*framing note/i.test(t)) continue;
    const text = t.replace(/^\*\*[^*]+\*\*:?\s*/, '').replace(/^gap[s]?:\s*/i, '');
    if (!text) continue;
    // Split on ; or (N) numbered items
    const parts = text.split(/;\s*|\(\d+\)\s*/).filter(p => p.trim().length > 6);
    parts.forEach(p => gaps.push({ gap: p.trim().replace(/[.✅❌⚠️]+$/, ''), blocker: 'Nice-to-have', mitigation: '' }));
  }
  return gaps;
}

// Parse global A–F scores from section headings
function extractGlobalScore(lines) {
  const map = { A: 'Role Fit', B: 'Experience', C: 'Company', D: 'Compensation', E: 'Location', F: 'Trajectory' };
  const scores = [];
  for (const [letter, label] of Object.entries(map)) {
    const line = lines.find(l => new RegExp(`^##\\s+${letter}[.)\\s]`).test(l.trim()));
    if (!line) continue;
    const m = line.match(/([\d.]+)\s*\/\s*5/);
    if (m) scores.push({ dim: label, val: parseFloat(m[1]), max: 5 });
  }
  return scores;
}

// Extract recommendation from ## Summary section
function extractSummary(lines) {
  const idx = lines.findIndex(l => /^##\s+summary/i.test(l.trim()));
  if (idx === -1) return null;
  const parts = [];
  for (let i = idx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^##/.test(t)) break;
    if (t) parts.push(t.replace(/\*\*/g, ''));
  }
  return parts.join(' ').trim() || null;
}

// Parse the candidate's prose report format into the cheat-sheet shape
function parseLegacyProseReport(lines) {
  const header = parseHeader(lines);

  // B. Experience — CV match table (Requirement | the candidate's Evidence)
  const secBLines = getSectionLines(lines, 'B');
  const cvMatchObjs = tableToObjects(secBLines, {
    req:      ['requirement', 'jd req', 'requisito'],
    evidence: ['evidence', 'cv match', 'cv evidence'],
    strength: ['strength'],
  });
  const cvMatch = cvMatchObjs.filter(o => o.req && o.evidence).map(o => ({
    req: o.req,
    evidence: o.evidence,
    // Infer strength from ✅/❌/⚠ in evidence when no strength column
    strength: o.strength
      ? normalizeStrength(o.strength)
      : o.evidence.includes('✅') ? 'strong'
      : o.evidence.includes('❌') ? 'weak'
      : o.evidence.includes('⚠') ? 'moderate'
      : 'moderate',
  }));
  const gaps = extractGapsFromProse(secBLines);

  // C. Company Quality → companyBrief
  const companyBrief = extractProseSummary(getSectionLines(lines, 'C'));

  // D. Compensation → compStated
  const compStated = extractCompFromProse(getSectionLines(lines, 'D'));

  // E. Location → remote
  const remote = extractRemote(getSectionLines(lines, 'E'));

  // G. Legitimacy → conclusion
  const legitimacyConclusion = extractProseSummary(getSectionLines(lines, 'G'));

  // Summary → recommendation + tldr
  const recommendation = extractSummary(lines);

  // A. Role Fit → domain/function hint
  const secALines = getSectionLines(lines, 'A');
  const aText = secALines.map(l => l.trim()).join(' ');
  const domainMatch = aText.match(/(?:domain|archetype|function)[:\s]+([^.]+)/i);

  return {
    url: header.url,
    legitimacy: header.legitimacy || 'Tier 1',
    archetypeDetected: null,
    domain: domainMatch ? domainMatch[1].replace(/\*\*/g, '').trim().slice(0, 40) : null,
    function: null,
    seniority: 'Director / Senior Director',
    remote: remote || (aText.toLowerCase().includes('remote') ? 'Remote' : null),
    teamSize: null,
    compStated,
    tldr: recommendation,
    companyBrief,
    cvMatch,
    gaps,
    levelMatch: { jdLevel: null, naturalLevel: 'Director / Senior Director', verdict: null },
    sellSenior: [],
    downlevelPlan: null,
    comp: { stated: compStated, sources: [], score: null, walkaway: 180, verdict: recommendation, market: companyBrief },
    customizationCV: [],
    customizationLI: [],
    starStories: [],
    leadStory: { title: null, reason: null, script: null },
    redFlagQs: [],
    legitimacySignals: [],
    legitimacyConclusion,
    keywords: [],
    globalScore: extractGlobalScore(lines),
    recommendation,
  };
}

// ── Legacy prose-format V2 parser ──────────────────────────────────────────────────
// Handles the current batch report format:
//   A. CV Match  — prose: **Strong alignment:** bullets + **Gaps:** bullets + **Verdict:**
//   B. North Star — prose: archetype bullets
//   C. Comp       — prose: **Posted range:** line
//   D. Cultural Signals — company brief + **Positives:** + **Concerns:** bullets
//   E. Red Flags  — numbered list: N. **Label:** explanation
//   F. Global Score — table: Block | Score | Weight  +  **Recommendation:** line
//   G. Posting Legitimacy — bullet list

function parseLegacyProseReportV2(lines) {
  const header = parseHeader(lines);

  // ── Domain from injected "## A) Role Summary" table ───────────────────────
  // Some reports have a "## A) Role Summary" table injected before the batch-format
  // "## Block A — CV Match" section. Extract domain/tldr from that table here.
  const roleSummaryDomain = (() => {
    const idx = lines.findIndex(l => /^##\s+A\)\s+role\s+summary/i.test(l.trim()));
    if (idx === -1) return null;
    for (let i = idx + 1; i < Math.min(idx + 15, lines.length); i++) {
      if (/^##/.test(lines[i])) break;
      const m = lines[i].match(/^\|\s*domain\s*\|\s*(.+?)\s*\|/i);
      if (m) return m[1].trim();
    }
    return null;
  })();

  // ── Section A: CV Match ───────────────────────────────────────────────────
  // Find the actual CV Match section (## Block A — CV Match or ## A. CV Match),
  // skipping any injected "## A) Role Summary" table that may appear first.
  const cvMatchIdx = lines.findIndex(l =>
    /^##\s+block\s+A\b.*cv\s+match/i.test(l.trim()) ||
    /^##\s+A\.\s+cv\s+match/i.test(l.trim())
  );
  const secALines = cvMatchIdx >= 0
    ? (() => {
        const nextSec = /^##\s+(block\s+|bloque\s+|blok\s+)?[A-Z]([).\s—\-]|$)/i;
        const result = [];
        for (let i = cvMatchIdx + 1; i < lines.length; i++) {
          if (i > cvMatchIdx + 1 && nextSec.test(lines[i].trim())) break;
          if (/^---+$/.test(lines[i])) break;
          result.push(lines[i]);
        }
        return result;
      })()
    : getSectionLines(lines, 'A');
  const cvMatch = [];
  const gaps = [];

  let phase = 'none'; // 'strong' | 'gaps' | 'done'
  for (const rawLine of secALines) {
    const t = rawLine.trim();
    if (/^\*\*(strong\s*(alignment|match)?\s*:?)\*\*\s*:?\s*$/i.test(t)) { phase = 'strong'; continue; }
    if (/^\*\*(gap[s]?\s*:?)\*\*\s*:?\s*$/i.test(t))                    { phase = 'gaps';   continue; }
    if (/^\*\*verdict\b/i.test(t) || /^---+$/.test(t))               { phase = 'done';   continue; }

    if ((phase === 'strong' || phase === 'gaps') && /^[-*•]/.test(t)) {
      // Format: "- **Label:** Evidence or gap description"
      const m = t.match(/^[-*•]\s+\*\*([^*]+?)\*\*[:\s]*(.*)/);
      const label    = m ? m[1].replace(/:$/, '').trim() : t.replace(/^[-*•]\s+/, '').slice(0, 70);
      const bodyText = m ? m[2].trim() : '';

      if (phase === 'strong') {
        cvMatch.push({ req: label, evidence: bodyText || 'Confirmed in CV', strength: 'strong' });
      } else {
        gaps.push({ gap: label, blocker: 'Nice-to-have', mitigation: bodyText });
        cvMatch.push({ req: label, evidence: bodyText || 'Gap identified', strength: 'weak' });
      }
    }
  }

  const verdictLine = secALines.find(l => /^\*\*verdict\b/i.test(l.trim()));
  const tldr = verdictLine
    ? verdictLine.replace(/^\*\*Verdict[^*]*\*\*[:\s]*/i, '').replace(/\*\*/g, '').trim()
    : null;

  // ── Section B: North Star — extract primary archetype ────────────────────
  const secBLines = getSectionLines(lines, 'B');
  let archetypeDetected = null;
  for (const l of secBLines) {
    const t = l.trim();
    if (!t || /^[#|]/.test(t)) continue;
    // Bullet format: "- **Director/VP of Revenue Operations**"
    const mBullet = t.match(/^[-*•]\s+\*\*([^*]+)\*\*/);
    if (mBullet) { archetypeDetected = mBullet[1].trim(); break; }
    // Inline prose after "archetype": "...archetype: **Director/VP...**"
    const mInline = t.match(/archetype[^*]*\*\*([^*]+)\*\*/i);
    if (mInline) { archetypeDetected = mInline[1].trim(); break; }
    // Bold role title anywhere in line
    const mBold = t.match(/\*\*((?:Director|VP|Head of|Senior Director|Manager|Chief)[^*]+)\*\*/i);
    if (mBold) { archetypeDetected = mBold[1].trim(); break; }
    // Plain prose: "VP of Revenue Operations ... is the highest-priority archetype"
    const mProse = t.match(/^((?:VP|Director|Head of|Senior Director|Manager|Chief)\s+(?:of\s+)?[\w\s,&/]+?)(?:\s+(?:at|is\s+the|for|—|-)\s)/i);
    if (mProse) { archetypeDetected = mProse[1].trim().replace(/[,;]$/, ''); break; }
  }

  // ── Section C: Comp ───────────────────────────────────────────────────────
  const secCLines = getSectionLines(lines, 'C');
  const compStated = extractCompFromProse(secCLines);

  // Score from C heading: "## C. Comp — 4.5/5"
  const cHeading = lines.find(l => /^##\s+C[.)]/i.test(l.trim()));
  const compScore = cHeading ? (() => { const m = cHeading.match(/([\d.]+)\s*\/\s*5/); return m ? parseFloat(m[1]) : null; })() : null;

  // ── Section D: Cultural Signals — company brief + remote ─────────────────
  const secDLines = getSectionLines(lines, 'D');

  // Company brief: first prose line in section D. Handles plain text AND "**Company:** desc" format.
  // Skips phase headers (Positives/Concerns) and location/concern labels (V3 format).
  let companyBrief = null;
  for (const l of secDLines) {
    const t = l.trim();
    if (!t || /^[#\-|>]/.test(t)) continue;
    // Skip standalone bold headers (e.g. "**Positives:**")
    if (/^\*\*[^*]+\*\*\s*:?\s*$/.test(t)) continue;
    // Skip V3 phase labels: **Location concern:**, **Positive signals:**, **Concern:**, etc.
    if (/^\*\*(?:location|positive|negative|concern|signal|note|caution|flag|pro|con|benefit)/i.test(t)) continue;
    // Extract text — strip leading "**CompanyName:** " if present
    companyBrief = t.replace(/^\*\*[^*]+\*\*[:\s]+/, '').replace(/\*\*/g, '').trim();
    break;
  }

  // Company brief fallback: if section D had no plain prose, use first sentence from section B
  if (!companyBrief) {
    for (const l of secBLines) {
      const t = l.trim();
      if (!t || /^[#*\-|>]/.test(t)) continue;
      // Skip archetype/scoring lines
      if (/archetype|highest.priority|score|north star/i.test(t)) continue;
      companyBrief = t.replace(/\*\*/g, '').replace(/\s*\(Score:[^)]+\)/, '').trim();
      if (companyBrief.length > 20) break;
      companyBrief = null;
    }
  }

  // Remote: look for "Fully remote" or "remote" in positives bullets, then anywhere in D
  let remote = null;
  let inPositives = false;
  for (const l of secDLines) {
    const t = l.trim();
    if (/^\*\*(positives?|pros?|benefits?)\b/i.test(t)) { inPositives = true; continue; }
    if (/^\*\*(concerns?|cons?|negatives?)\b/i.test(t)) { inPositives = false; }
    if (inPositives && /remote/i.test(t)) {
      remote = t.replace(/^[-*•]\s*/, '').replace(/\*\*/g, '').slice(0, 80);
      break;
    }
  }
  // Fallback: any mention of remote/hybrid/location anywhere in D
  if (!remote) remote = extractRemote(secDLines);
  // Last fallback: pull location from first D line (V3 often starts with "The posting lists X, CA")
  if (!remote) {
    const firstD = secDLines.find(l => l.trim().length > 10);
    if (firstD) {
      const loc = firstD.replace(/\*\*/g, '').replace(/^\*\*[^*]+\*\*[:\s]+/, '').trim();
      const locMatch = loc.match(/(?:lists?|located in|HQ in|based in|office in)\s+([^.]+)/i);
      if (locMatch) remote = locMatch[1].trim().slice(0, 60);
    }
  }

  // ── Section E: Red Flags — numbered items as Q&A ─────────────────────────
  const secELines = getSectionLines(lines, 'E');
  const redFlagQs = [];
  for (const l of secELines) {
    const t = l.trim();
    // "1. **Label:** explanation" or "1. Plain text"
    const mBold = t.match(/^\d+\.\s+\*\*([^*]+?)\*\*[:\s]*(.*)/);
    if (mBold) {
      redFlagQs.push({ q: mBold[1].trim(), behind: '', a: mBold[2].trim() });
      continue;
    }
    const mPlain = t.match(/^\d+\.\s+(.+)/);
    if (mPlain) {
      const text = mPlain[1].replace(/\*\*/g, '');
      const colonIdx = text.indexOf(':');
      if (colonIdx > 0 && colonIdx < 60) {
        redFlagQs.push({ q: text.slice(0, colonIdx).trim(), behind: '', a: text.slice(colonIdx + 1).trim() });
      } else {
        redFlagQs.push({ q: text.slice(0, 80), behind: '', a: text });
      }
    }
  }

  // ── Section F: Global Score — table + recommendation ─────────────────────
  const secFLines = getSectionLines(lines, 'F');
  const { headers: fH, rows: fRows } = parseMdTable(secFLines);
  const globalScore = [];
  const blockCol = fH.findIndex(h => h.includes('block') || h.includes('dimension') || h.includes('section'));
  const scoreCol = fH.findIndex(h => h.includes('score'));
  fRows.forEach(row => {
    const rawDim   = ((blockCol >= 0 ? row[blockCol] : row[0]) || '').replace(/\*\*/g, '').trim();
    const rawScore = ((scoreCol >= 0 ? row[scoreCol] : row[1]) || '').replace(/\*\*/g, '').trim();
    if (!rawDim || /^(global|weighted|total)/i.test(rawDim)) return;
    // Strip section letter prefix and "(inverse)" suffix: "A. CV Match" → "CV Match"
    const dim = rawDim.replace(/^[A-G][.)]\s+/, '').replace(/\s*\(inverse\)\s*/i, '').trim();
    const mVal = rawScore.match(/^([\d.]+)/);
    if (mVal) globalScore.push({ dim, val: parseFloat(mVal[1]), max: 5 });
  });

  // Recommendation: first **Recommendation...** line in section F
  const recLine = secFLines.find(l => /^\*\*recommendation/i.test(l.trim()));
  let recommendation = null;
  if (recLine) {
    recommendation = recLine.replace(/^\*\*Recommendation[^*]*\*\*[:\s]*/i, '').replace(/\*\*/g, '').trim();
    // If the line itself is just the heading and the text follows on next lines, collect them
    if (recommendation.length < 10) {
      const recIdx = secFLines.indexOf(recLine);
      const trailing = [];
      for (let i = recIdx + 1; i < secFLines.length && i < recIdx + 6; i++) {
        const t = secFLines[i].trim();
        if (!t || /^##/.test(t)) break;
        trailing.push(t.replace(/\*\*/g, ''));
      }
      if (trailing.length) recommendation = trailing.join(' ').trim();
    }
  }

  // ── Section G: Posting Legitimacy ─────────────────────────────────────────
  const secGLines = getSectionLines(lines, 'G');
  const { legitimacySignals, legitimacyConclusion } = parseSectionG(secGLines);

  // Legitimacy tier from the section G heading: "## G. Posting Legitimacy — High Confidence"
  const gHeading = lines.find(l => /^##\s+G[.)]/i.test(l.trim()));
  const legitimacy = gHeading
    ? gHeading.replace(/^##\s+G[.)][^—–\-]*[-—–]+\s*/i, '').replace(/\*\*/g, '').trim()
    : (header.legitimacy || 'Tier 1');

  // ── Keywords from section A requirement labels ────────────────────────────
  const keywords = cvMatch.map(m => m.req).filter(r => r.length >= 4 && r.length <= 80).slice(0, 20);

  // ── Seniority from role title ──────────────────────────────────────────────
  const titleLine = lines.find(l => /^#\s+/.test(l));
  const roleTitle = titleLine ? titleLine.replace(/^#\s+/, '').split('—')[0].trim() : '';
  const seniority = /\bvp\b|vice\s*president/i.test(roleTitle) ? 'VP'
    : /senior\s*director/i.test(roleTitle) ? 'Senior Director'
    : /\bdirector\b/i.test(roleTitle) ? 'Director'
    : /head\s*of/i.test(roleTitle) ? 'Head of'
    : 'Director / Senior Director';

  return {
    url: header.url,
    legitimacy,
    archetypeDetected,
    domain: roleSummaryDomain || archetypeDetected,
    function: null,
    seniority,
    remote,
    teamSize: null,
    compStated,
    tldr,
    companyBrief,
    cvMatch,
    gaps,
    levelMatch: { jdLevel: seniority, naturalLevel: 'Director / Senior Director', verdict: null },
    sellSenior: [],
    downlevelPlan: null,
    comp: { stated: compStated, sources: [], score: compScore, walkaway: null, verdict: tldr, market: companyBrief },
    customizationCV: [],
    customizationLI: [],
    starStories: [],
    leadStory: { title: recommendation ? recommendation.slice(0, 100) : null, reason: null, script: null },
    redFlagQs,
    legitimacySignals,
    legitimacyConclusion,
    keywords,
    globalScore,
    recommendation,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function parseReport(mdText) {
  const lines = mdText.split('\n');

  // Route to the correct parser based on report format
  if (isLegacyProseFormatV2(lines)) {
    return parseLegacyProseReportV2(lines);
  }
  if (isLegacyProseFormat(lines)) {
    return parseLegacyProseReport(lines);
  }

  // Original cheat-sheet format
  const header = parseHeader(lines);
  const secA = parseSectionA(getSectionLines(lines, 'A'));
  const secB = parseSectionB(getSectionLines(lines, 'B'));
  const secC = parseSectionC(getSectionLines(lines, 'C'));
  const secD = parseSectionD(getSectionLines(lines, 'D'));
  const secE = parseSectionE(getSectionLines(lines, 'E'));
  const secF = parseSectionF(getSectionLines(lines, 'F'));
  const secG = parseSectionG(getSectionLines(lines, 'G'));
  const keywords = parseKeywords(lines);
  const { globalScore, recommendation } = parseGlobalScoreSection(lines);

  return {
    url: header.url,
    legitimacy: header.legitimacy || 'Proceed with Caution',
    archetypeDetected: header.archetypeDetected || secA.archetypeDetected,
    domain: secA.domain,
    function: secA.function,
    seniority: secA.seniority,
    remote: secA.remote,
    teamSize: secA.teamSize,
    compStated: secA.compStated,
    tldr: secA.tldr,
    companyBrief: secA.companyBrief,
    cvMatch: secB.cvMatch,
    gaps: secB.gaps,
    levelMatch: secC.levelMatch,
    sellSenior: secC.sellSenior,
    downlevelPlan: secC.downlevelPlan,
    comp: secD.comp,
    customizationCV: secE.customizationCV,
    customizationLI: secE.customizationLI,
    starStories: secF.starStories,
    leadStory: secF.leadStory,
    redFlagQs: secF.redFlagQs,
    legitimacySignals: secG.legitimacySignals,
    legitimacyConclusion: secG.legitimacyConclusion,
    keywords,
    globalScore,
    recommendation,
  };
}
