// Mock applications data — ~52 entries spanning all statuses
// Fields: id, date (ISO), company, role, archetype, score, status, salary, target, sector, size, notes
window.APPS = (() => {
  const rows = [
    [1,  "2026-04-30", "Contoso Health",    "VP, Revenue Operations",         "RevOps",        4.5, "Evaluated", 245, 240, "Healthtech",  "Mid",     "Strong PLG motion, fits comp band"],
    [2,  "2026-04-30", "Northwind",         "Director, Analytics",            "Analytics",     4.3, "Evaluated", 220, 230, "Fintech",     "Mid",     "Series C, analytics-led culture"],
    [3,  "2026-04-29", "Acme Corp",         "VP, Sales Operations",           "SalesOps",      4.4, "Evaluated", 260, 240, "Infra",       "Late",    "Hot comp, observability"],
    [4,  "2026-04-29", "Example Co",        "Director, Business Development", "BizDev",        4.0, "Evaluated", 210, 220, "Defense",     "Mid",     "Edge compute, gov-heavy"],
    [5,  "2026-04-28", "Lattice",           "VP, Revenue Operations",         "RevOps",        4.2, "Applied",   235, 240, "HR-Tech",     "Late",    "Recruiter reached out"],
    [6,  "2026-04-28", "Ramp",              "Head of Sales Operations",       "SalesOps",      4.6, "2nd Interview", 270, 250, "Fintech",     "Late",    "Round 2 with CRO Wed"],
    [7,  "2026-04-27", "Notion",            "Director, RevOps",               "RevOps",        4.1, "Responded", 225, 230, "Productivity","Late",    "Recruiter screen scheduled"],
    [8,  "2026-04-27", "Vanta",             "VP, Revenue Strategy",           "Strategy",      4.3, "Applied",   245, 240, "Security",    "Late",    "Solid comp, fast growth"],
    [9,  "2026-04-26", "Linear",            "Head of GTM Analytics",          "Analytics",     4.4, "1st Interview", 240, 235, "Productivity","Mid",     "Loop on Friday"],
    [10, "2026-04-26", "Modal Labs",        "Director, Sales Development",    "SalesDev",      3.6, "Evaluated", 195, 220, "AI Infra",    "Early",   "Early stage, scrappy"],
    [11, "2026-04-25", "Anthropic",         "VP, Revenue Operations",         "RevOps",        4.7, "Applied",   285, 260, "AI",          "Late",    "Dream comp"],
    [12, "2026-04-25", "Replicate",         "Director, BizDev",               "BizDev",        3.8, "Evaluated", 200, 220, "AI Infra",    "Early",   "Borderline, weigh equity"],
    [13, "2026-04-24", "Mercury",           "Head of Revenue Operations",     "RevOps",        4.2, "Applied",   235, 235, "Fintech",     "Mid",     "Banking-for-startups"],
    [14, "2026-04-24", "Retool",            "Director, Analytics",            "Analytics",     4.0, "Responded", 220, 225, "DevTools",    "Mid",     "Hiring manager wants chat"],
    [15, "2026-04-23", "Hex",               "VP, GTM Strategy",               "Strategy",      4.1, "Applied",   230, 230, "Analytics",   "Mid",     "Notebook-native"],
    [16, "2026-04-23", "Census",            "Director, RevOps",               "RevOps",        3.9, "Rejected",  210, 225, "Data",        "Mid",     "Comp gap, declined"],
    [17, "2026-04-22", "Airbyte",           "Head of Sales Development",      "SalesDev",      3.5, "Discarded", 180, 220, "Data",        "Mid",     "Below band"],
    [18, "2026-04-22", "WorkOS",            "VP, Revenue",                    "Strategy",      4.5, "3rd Interview", 265, 250, "Auth",        "Mid",     "Final loop next week"],
    [19, "2026-04-21", "Clay",              "Director, RevOps",               "RevOps",        4.3, "Applied",   240, 235, "GTM Tools",   "Early",   "Hot, very hot"],
    [20, "2026-04-21", "Apollo.io",         "VP, Sales Operations",           "SalesOps",      3.7, "Evaluated", 205, 225, "GTM Tools",   "Mid",     "Mature, slowing"],
    [21, "2026-04-20", "Pinecone",          "Director, BizDev",               "BizDev",        3.9, "Applied",   215, 225, "AI Infra",    "Mid",     "Sent referral"],
    [22, "2026-04-20", "Decagon",           "Head of GTM",                    "Strategy",      4.4, "Responded", 250, 245, "AI",          "Early",   "AI agents, fast"],
    [23, "2026-04-19", "Sierra",            "VP, Revenue Operations",         "RevOps",        4.6, "Applied",   270, 255, "AI",          "Early",   "Bret Taylor, premium"],
    [24, "2026-04-19", "Glean",             "Director, Analytics",            "Analytics",     4.2, "2nd Interview", 235, 235, "AI",          "Late",    "Onsite scheduled"],
    [25, "2026-04-18", "Writer",            "Head of RevOps",                 "RevOps",        3.8, "Rejected",  210, 230, "AI",          "Mid",     "Already filled"],
    [26, "2026-04-18", "Harvey",            "VP, Revenue",                    "Strategy",      4.7, "Applied",   290, 260, "Legal AI",    "Mid",     "Very strong fit"],
    [27, "2026-04-17", "Cohere",            "Director, Sales Operations",     "SalesOps",      3.6, "Discarded", 200, 230, "AI",          "Late",    "Restructuring"],
    [28, "2026-04-17", "ElevenLabs",        "Head of BizDev",                 "BizDev",        4.1, "Evaluated", 225, 230, "AI Audio",    "Mid",     "Sit > 7 days"],
    [29, "2026-04-16", "Together AI",       "VP, Revenue Operations",         "RevOps",        4.0, "Evaluated", 220, 230, "AI Infra",    "Mid",     "Sit > 7 days"],
    [30, "2026-04-16", "Tavus",             "Director, RevOps",               "RevOps",        3.4, "Discarded", 175, 220, "AI Video",   "Early",   "Too early stage"],
    [31, "2026-04-15", "Runway",            "Head of Sales Operations",       "SalesOps",      3.9, "Applied",   215, 225, "AI Video",   "Mid",     "Creative space"],
    [32, "2026-04-15", "Suno",              "Director, BizDev",               "BizDev",        3.7, "SKIP",      195, 230, "AI Audio",    "Early",   "Legal overhang"],
    [33, "2026-04-14", "Perplexity",        "VP, Revenue Strategy",           "Strategy",      4.5, "3rd Interview", 265, 250, "AI Search",   "Late",    "CRO loop"],
    [34, "2026-04-14", "Browserbase",       "Director, Analytics",            "Analytics",     3.8, "Evaluated", 205, 225, "AI Infra",    "Early",   "Borderline"],
    [35, "2026-04-13", "Crusoe",            "Head of Revenue Ops",            "RevOps",        4.1, "Applied",   230, 230, "AI Infra",    "Mid",     "Energy + AI angle"],
    [36, "2026-04-13", "Lambda Labs",       "VP, Sales Operations",           "SalesOps",      3.9, "Rejected",  210, 230, "AI Infra",    "Mid",     "Pulled the role"],
    [37, "2026-04-12", "Nuro",              "Director, BizDev",               "BizDev",        3.5, "Discarded", 185, 225, "Robotics",    "Late",    "Layoffs"],
    [38, "2026-04-12", "Saronic",           "Head of Revenue",                "Strategy",      4.2, "Applied",   240, 240, "Defense",     "Mid",     "Maritime defense"],
    [39, "2026-04-11", "Anduril",           "VP, Revenue Operations",         "RevOps",        4.6, "Phone Screen", 280, 255, "Defense",     "Late",    "Onsite Fri"],
    [40, "2026-04-11", "Helsing",           "Director, Sales Operations",     "SalesOps",      4.0, "Applied",   220, 230, "Defense",     "Mid",     "European AI defense"],
    [41, "2026-04-10", "Shield AI",         "Head of BizDev",                 "BizDev",        3.8, "Evaluated", 210, 225, "Defense",     "Mid",     "Sit > 7 days"],
    [42, "2026-04-10", "Skydio",            "VP, Revenue",                    "Strategy",      3.6, "Rejected",  200, 230, "Robotics",    "Late",    "Not a fit"],
    [43, "2026-04-09", "Fabric",            "Director, RevOps",               "RevOps",        3.9, "Applied",   215, 225, "Healthtech",  "Mid",     "Charts + RevOps"],
    [44, "2026-04-09", "Abridge",           "Head of Analytics",              "Analytics",     4.3, "1st Interview", 245, 240, "Healthtech",  "Mid",     "Clinical AI"],
    [45, "2026-04-08", "Hippocratic AI",    "VP, Revenue Operations",         "RevOps",        4.1, "Applied",   230, 230, "Healthtech",  "Mid",     "Patient care AI"],
    [46, "2026-04-08", "Tennr",             "Director, BizDev",               "BizDev",        3.7, "Discarded", 195, 225, "Healthtech",  "Early",   "Too early"],
    [47, "2026-04-07", "Persona",           "Head of Sales Operations",       "SalesOps",      4.0, "Offer",     230, 230, "Identity",    "Late",    "Verbal offer"],
    [48, "2026-04-07", "Alloy",             "VP, RevOps",                     "RevOps",        4.2, "Applied",   240, 235, "Fintech",     "Mid",     "Identity fraud"],
    [49, "2026-04-06", "Stytch",            "Director, Analytics",            "Analytics",     3.8, "Rejected",  205, 225, "Auth",        "Mid",     "Internal hire"],
    [50, "2026-04-06", "Rippling",          "VP, Revenue Operations",         "RevOps",        4.4, "Applied",   260, 250, "HR-Tech",     "Late",    "Multi-product"],
    [51, "2026-04-05", "Deel",              "Head of GTM Analytics",          "Analytics",     4.0, "Responded", 225, 230, "HR-Tech",     "Late",    "Global payroll"],
    [52, "2026-04-05", "Brex",              "Director, RevOps",               "RevOps",        3.9, "Applied",   215, 225, "Fintech",     "Late",    "Recruiter pinged"],
    [53, "2026-05-12", "Contoso Capital",   "Director of Revenue Operations", "RevOps",        4.2, "Evaluated", 250, 240, "Fintech",     "Mid",     "Series B lender; build RevOps from scratch"],
  ];
  return rows.map(r => ({
    id: r[0], date: r[1], company: r[2], role: r[3], archetype: r[4],
    score: r[5], status: r[6], salary: r[7], target: r[8], sector: r[9],
    size: r[10], notes: r[11],
  }));
})();

// Interview-family rungs, in funnel order. The single place the ladder is
// defined; the rest of the UI derives STATUSES / FUNNEL_ORDER / colors from it
// so we never re-hardcode the rounds per view. Mirrors templates/states.yml.
window.INTERVIEW_STAGES = ["Phone Screen","1st Interview","2nd Interview","3rd Interview","4th Interview"];
window.isInterviewStage = (s) => window.INTERVIEW_STAGES.includes(s);

window.STATUSES = ["Evaluated","Applied","Responded",...window.INTERVIEW_STAGES,"Offer","Rejected","Discarded","SKIP","Closed","Not a Fit","No Response"];
// "Unclassified" is the catch-all inferArchetype() falls through to (see
// server/lib/applications.mjs). It is a gap in the matching rules, not a cohort —
// keep it last and never treat it as a targeting recommendation.
window.ARCHETYPES = ["RevOps","SalesOps","Analytics","BizDev","SalesDev","Strategy","Unclassified"];

window.STATUS_META = {
  Evaluated:  { color: "#a78bfa", bg: "rgba(167,139,250,0.12)", icon: "◆" },
  Applied:    { color: "#60a5fa", bg: "rgba(96,165,250,0.12)",  icon: "↗" },
  Responded:  { color: "#22d3ee", bg: "rgba(34,211,238,0.12)",  icon: "↩" },
  // Interview ladder: amber -> deep-orange ramp (heats up toward Offer green).
  "Phone Screen":   { color: "#fcd34d", bg: "rgba(252,211,77,0.14)",  icon: "☎" },
  "1st Interview":  { color: "#fbbf24", bg: "rgba(251,191,36,0.14)",  icon: "①" },
  "2nd Interview":  { color: "#f59e0b", bg: "rgba(245,158,11,0.14)",  icon: "②" },
  "3rd Interview":  { color: "#f97316", bg: "rgba(249,115,22,0.14)",  icon: "③" },
  "4th Interview":  { color: "#ea580c", bg: "rgba(234,88,12,0.14)",   icon: "④" },
  // Defensive fallback for any legacy "Interview" rows (colored as 1st round).
  Interview:  { color: "#fbbf24", bg: "rgba(251,191,36,0.14)",  icon: "●" },
  Offer:      { color: "#22c55e", bg: "rgba(34,197,94,0.14)",   icon: "★" },
  Rejected:   { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   icon: "✕" },
  Discarded:  { color: "#71717a", bg: "rgba(113,113,122,0.14)", icon: "−" },
  SKIP:       { color: "#52525b", bg: "rgba(82,82,91,0.14)",    icon: "/" },
  Closed:     { color: "#78716c", bg: "rgba(120,113,108,0.14)", icon: "⊘" },
  "Not a Fit":{ color: "#b45309", bg: "rgba(180,83,9,0.12)",   icon: "≠" },
  "No Response":{ color: "#6b7280", bg: "rgba(107,114,128,0.14)", icon: "∅" },
};

window.scoreColor = (s) => s == null ? "#71717a" : s >= 4.0 ? "#22c55e" : s >= 3.0 ? "#eab308" : "#ef4444";
window.scoreBucket = (s) => s == null ? "n/a" : s >= 4.0 ? "strong" : s >= 3.0 ? "borderline" : "weak";
window.fmtScore = (s) => s != null ? s.toFixed(1) : "N/A";

// Funnel order — left to right. Derived from the interview ladder so the rungs
// live in exactly one place.
window.FUNNEL_ORDER = ["Evaluated","Applied","Responded",...window.INTERVIEW_STAGES,"Offer"];

// Parse a JD-stated comp string into a clean display + midpoint $K number.
// Handles ranges ("$165,000 – $185,000 USD/year" → mid 175), single numbers
// ("$200,000" → 200), shorthand ("$150K" → 150), and noise suffixes (USD,
// USD/year, /yr, annually). Currency is assumed USD for an American user.
window.parseComp = function parseComp(s) {
  if (!s || typeof s !== 'string') return { display: '—', salary: null };
  // Strip currency suffix noise. Replace USD-* tokens with a single space so
  // adjacent words don't run together ("USD base" → " base"), then collapse
  // multiple spaces.
  let clean = s
    .replace(/\bUSD\s*\/?\s*(year|yr|annually|annual)?\b/gi, ' ')
    .replace(/\s+\/\s*(year|yr|annually|annual)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  // Extract dollar amounts. Supports "$165,000", "$150K", "150k".
  // First normalize K/k shorthand to long form so the regex catches them.
  const norm = clean.replace(/\$?([\d,]+(?:\.\d+)?)\s*[kK]\b/g, (_, n) => '$' + Math.round(parseFloat(n.replace(/,/g, '')) * 1000));
  const nums = (norm.match(/\$[\d,]+/g) || [])
    .map(n => parseInt(n.replace(/[^\d]/g, ''), 10))
    .filter(n => n >= 30000 && n <= 2_000_000); // sanity filter — drop equity grants, signing bonuses, etc.
  if (!nums.length) return { display: clean, salary: null };
  if (nums.length === 1) return { display: clean, salary: Math.round(nums[0] / 1000) };
  // Use the midpoint of the first two numbers (the stated range), rounded to nearest $K.
  return { display: clean, salary: Math.round((nums[0] + nums[1]) / 2000) };
};

// `[reached: <stage>]` convention: when a role closes after we advance past
// Applied (Rejected / No Response after a screen or interview round), we prefix
// notes with the furthest stage reached, e.g. `[reached: 2nd Interview]`.
// This preserves the furthest-stage signal for analytics. The label can contain
// spaces ("2nd Interview"), so the capture runs to the closing bracket. Returns
// the reached stage string or null. For live funnel statuses appReached uses the
// status's own funnel position; the tag only matters for closed/terminal rows.
window.reachedStage = (app) => {
  const m = ((app && app.notes) || "").match(/\[reached:\s*([^\]]+)\]/i);
  return m ? m[1].trim() : null;
};

// Did this app reach `stage` (either currently at it, advanced past it,
// or got tagged `[reached: <stage-or-later>]` after closure)?
//
// Prefers `app.reached`, the furthest rung the server computed from the live
// status, the dated status-event log, and the [reached:] tag. The browser never
// sees the event log, so the fallback below can only credit the live status and
// the tag: a row that replied and was later rejected reads as "Rejected" and
// looks like it never replied. Keep the fallback for app objects built without
// a server round-trip.
window.appReached = (app, stage) => {
  const order = window.FUNNEL_ORDER;
  const idx = order.indexOf(stage);
  if (idx < 0) return false;
  if (app.reached != null) return order.indexOf(app.reached) >= idx;
  const currentIdx = order.indexOf(app.status);
  // Currently at this stage or later (only for canonical funnel stages)
  if (currentIdx >= idx) return true;
  // For Rejected / Discarded, check the [reached: X] tag
  const reached = window.reachedStage(app);
  if (!reached) return false;
  const reachedIdx = order.indexOf(reached);
  return reachedIdx >= idx;
};

window.TODAY = new Date();
window.daysAgo = (iso) => Math.floor((window.TODAY - new Date(iso)) / 86400000);

// ── Self-healing mutating fetch ──────────────────────────────────────────────
// The dashboard issues a per-start auth token as a cookie when the HTML loads,
// and requires it on every state-changing request (POST/PUT/PATCH/DELETE). That
// token rotates each time the server restarts (relaunch, update, dev restart),
// so a tab left open across a restart still holds the old token: reads keep
// working but writes 403 — the "I hit Save but it didn't stick" bug. Routing all
// writes through window.tjkMutate fixes it: on a 403 we re-GET the HTML root
// (which re-issues the Set-Cookie with the current token) and retry once, so the
// save lands without a manual reload and without losing the in-progress edit. A
// 403 is rejected by the auth middleware before any handler runs, so the retry
// never double-writes. Non-403 responses pass straight through unchanged.
window.tjkMutate = async function tjkMutate(url, options) {
  let res = await fetch(url, options);
  if (res && res.status === 403) {
    try { await fetch('/', { headers: { Accept: 'text/html' }, cache: 'no-store' }); } catch (e) { /* ignore */ }
    res = await fetch(url, options);
  }
  return res;
};
