// Launchpad — guided onboarding / setup module.
//
// A re-enterable wizard (and, once complete, an editable hub) that walks a new
// user from empty to ready-to-search. The dashboard NEVER calls an LLM: every
// generative step composes a prompt the user pastes into their OWN Claude Code
// (the same copy-and-poll pattern as WorkflowPanel). Deterministic scalar
// fields are saved via /api/setup/save; everything else is a handoff.
const { useState, useEffect, useCallback, useRef } = React;

// ---- section catalog -------------------------------------------------------
// kind: 'action' (run something), 'form' (scalar fields saved direct),
//       'gen' (hand off to Claude Code). req drives the readiness meter.
// ── Section copy: four fields, not one blurb ─────────────────────────────────
// Every section used to carry a single `why` string. In a first-install session a
// tester asked, out loud and unprompted, four separate questions at almost every
// step: "What does this do?", "Why do I have to do this?", "How does this help
// me?", and "So what?" The old blurbs answered at most the first, and not one of
// the eleven answered the question they asked most insistently — whether the step
// changed their score.
//
// So the shape is now structural rather than a matter of writing discipline:
//
//   does         what it does. One sentence, plain verb, no product nouns.
//   sowhat       what the user actually gets. A concrete outcome, not machinery.
//   affectsScore 'yes' | 'no' | 'filter'. Rendered as a badge, never as prose.
//   ifYouSkip    what really happens if they skip it, including "nothing".
//
// A blurb drifts back into machinery-speak one edit at a time; four labelled
// fields make an omission visible. `affectsScore` earns its place twice over: it
// answers the recurring question at a glance without reading, and it forces an
// honest answer about which steps are theatre. Three of these are 'no'.
//
// Reading level is enforced, not aspired to — see tests/onboarding-copy.test.mjs.
// Rules for edits here: second person, active voice, no jargon (no Node,
// Playwright, dependencies, geo filter, scanner exclusions, "lever on evaluation
// quality"), at most one analogy, and describe outcomes rather than internals.
const LP_SECTIONS = [
  { id: 'preflight',  kind: 'action', req: 'gate',        icon: 'preflight', label: 'Preflight check',
    title: 'Make sure the engine runs',
    does: 'Checks that the app has everything it needs to run.',
    sowhat: 'Ten seconds now, instead of finishing all of setup and then finding out something was broken the whole time.',
    affectsScore: 'no',
    ifYouSkip: 'You cannot. Everything else stays locked until this passes.' },
  { id: 'cv',         kind: 'gen', req: 'Required',        icon: 'cv', label: 'Your CV',
    title: 'Start here: your CV sets up the rest',
    does: 'Reads your resume and fills in most of the rest of this setup for you.',
    sowhat: 'This is the only step you really need. When it finishes you can start scoring real jobs today. Everything below just sharpens the results.',
    affectsScore: 'yes',
    ifYouSkip: 'You cannot. Nothing works without it.',
    extra: 'Paste your resume, share a LinkedIn URL, or upload a .docx or .pdf. A .docx also becomes the master your tailored resumes are built from.',
    handoff: 'cv' },
  { id: 'identity',   kind: 'form', req: 'Recommended',    icon: 'identity', label: 'Identity & links',
    title: 'Who you are',
    does: 'Your name, email, phone, and profile links.',
    sowhat: 'These get printed on every resume the app makes for you. They also sit behind a copy button, so you are not hunting for your LinkedIn address while you fill out a form.',
    affectsScore: 'no',
    ifYouSkip: 'Your resumes come out with blanks where your contact details go.' },
  { id: 'roles',      kind: 'gen', req: 'Recommended',     icon: 'roles', label: 'Roles & seniority',
    title: 'What you are targeting',
    does: 'The job titles you want, and how senior.',
    sowhat: 'This is the size of the net. A narrow net brings back a handful of very close jobs. A wide net brings back more to sort through. Most people start far too narrow and then wonder why they see almost nothing.',
    affectsScore: 'yes',
    ifYouSkip: 'The scanner does not know what to look for, and you get close to zero results.',
    handoff: 'roles' },
  { id: 'edge',       kind: 'gen', req: 'Recommended',     icon: 'edge', label: 'Your edge',
    title: 'What makes you the obvious hire',
    does: 'The two or three things that make you a stronger pick than the other people applying. Taken from your resume.',
    sowhat: 'This is the difference between a score that says you match the words in the posting, and one that says you would probably win it. It is also what your tailored resume leads with.',
    affectsScore: 'yes',
    ifYouSkip: 'Your scores get bland, and your resumes read like everyone else’s.',
    handoff: 'edge' },
  { id: 'comp',       kind: 'form', req: 'Recommended',    icon: 'comp', label: 'Compensation',
    title: 'Your numbers',
    does: 'What you want to earn, and the number you would turn down.',
    sowhat: 'Jobs that could never pay you enough get flagged before you spend an hour on the application.',
    affectsScore: 'yes',
    ifYouSkip: 'You will see roles you would never actually accept.' },
  { id: 'location',   kind: 'form', req: 'Recommended',    icon: 'location', label: 'Location & policy',
    title: 'Where you will and will not work',
    does: 'Where you will work, and how far you will travel.',
    sowhat: 'Drops jobs you could never take. Skip it and a chunk of your results sit in cities you are not moving to.',
    affectsScore: 'filter',
    ifYouSkip: 'You sort through a lot of jobs by hand that the app could have removed for you.',
    handoff: 'location', handoffLabel: 'Geocode + build scanner geo filter' },
  { id: 'evaluation', kind: 'gen', req: 'Later',           icon: 'evaluation', label: 'Evaluation tuning',
    title: 'Priorities & deal-breakers',
    does: 'Tells the scorer what matters most to you, and what you would never accept.',
    sowhat: 'Two jobs can look the same on paper. This is what makes the one with the manager title score higher, because you said that is what you are after.',
    affectsScore: 'yes',
    ifYouSkip: 'Skip it for now, on purpose. Come back after you have seen five or ten scores. It is much easier to correct a scorer you have watched than to guess up front.',
    handoff: 'evaluation' },
  { id: 'companies',  kind: 'gen', req: 'Recommended',     icon: 'companies', label: 'Companies to track',
    title: 'Where to look',
    does: 'The list of employers the app checks for new job postings.',
    sowhat: 'Every scan walks this list. Twenty companies you do not care about is twenty wasted checks. Two hundred good ones is a real pipeline.',
    affectsScore: 'filter',
    ifYouSkip: 'The app only looks where the starter list points, which may be nowhere near your field.',
    handoff: 'companies' },
  { id: 'outputs',    kind: 'form', req: 'Optional',       icon: 'outputs', label: 'Output locations',
    title: 'Where files land',
    does: 'Picks which folders your finished resumes and interview prep get saved in.',
    sowhat: 'Put them somewhere you will actually look, like your Documents folder.',
    affectsScore: 'no',
    ifYouSkip: 'Nothing breaks. The defaults are fine.' },
  { id: 'health',     kind: 'action', req: 'verify',       icon: 'health', label: 'Health check',
    title: 'Confirm everything works',
    does: 'Runs the checks one more time now that you are set up.',
    sowhat: 'Confirms your first scan will really work, instead of failing quietly and leaving you thinking there are no jobs out there.',
    affectsScore: 'no',
    ifYouSkip: 'You find out something is wrong later, when it is harder to trace.' },
];

const LP_OPTIONAL = [
  { id: 'apikey',    label: 'AI draft key (optional)',
    does: 'Adds an Anthropic API key.',
    sowhat: 'Most people should skip this. Resumes, cover letters, and emails already work on your Claude plan without a key. A key only makes them come back faster, and it costs money each time.',
    affectsScore: 'no',
    ifYouSkip: 'Everything still works. It is a little slower.' },
  { id: 'models',    label: 'Models & cost',
    does: 'Picks a cheaper or a smarter AI for each part of the work.',
    sowhat: 'Scanning job boards is simple, so a cheap model is fine. Scoring a job is not, so the smarter one is worth it there. This screen is where you trade money for quality.',
    affectsScore: 'no',
    ifYouSkip: 'Sensible defaults are already set.' },
  { id: 'discovery', label: 'Web discovery keys (optional)',
    does: 'Lets the app search the open web for employers you have not heard of.',
    sowhat: 'Without it, the app only checks the companies on your list. With it, it can go and find new ones.',
    affectsScore: 'no',
    ifYouSkip: 'Scanning still works. You just have to add companies yourself.' },
  { id: 'obsidian',  label: 'Obsidian vault',
    does: 'Copies notes about jobs you applied to into your Obsidian vault.',
    sowhat: 'Useful only if you already keep your notes there.',
    affectsScore: 'no',
    ifYouSkip: 'Nothing at all. Skip this one unless you use Obsidian.' },
  { id: 'language',  label: 'Market / language modes',
    does: 'Turns on German, French, or Japanese job postings.',
    sowhat: 'Only turn this on if you are applying for jobs in those languages.',
    affectsScore: 'filter',
    ifYouSkip: 'You get English postings, which is what most people want.' },
  { id: 'intensity', label: 'Search intensity',
    does: 'Sets how many jobs a week you are aiming for, and how often the app looks.',
    sowhat: 'Sets the pace, so you get a steady trickle instead of a flood you end up ignoring.',
    affectsScore: 'no',
    ifYouSkip: 'The default pace is reasonable.' },
  { id: 'import',    label: 'Import past applications',
    does: 'Brings jobs you already applied to into the tracker.',
    sowhat: 'Only worth doing if you have been tracking a search somewhere else and want the history in one place. A brand new search has nothing to import.',
    affectsScore: 'no',
    ifYouSkip: 'Nothing. Most people never need this.' },
];

// ── What is actually REQUIRED, versus what merely sharpens results ───────────
// This list used to hold eight ids and the header rendered "N/8 required". That
// was not a wording problem, it was a false claim the product made structurally:
// nothing is gated on these (see `gated`, engine-only), and the app is usable as
// soon as the CV step and its handoff finish. A beta tester read the meter the
// way it was written, worked through all eight, and lost about two hours before
// touching the product at all (report 2026-07-21).
//
// So: LP_REQUIRED is now the honest floor — what you truly cannot run without.
// Everything else is LP_REFINE, which drives its own progress bar and is framed
// as improving results rather than unlocking them.
const LP_REQUIRED = LP_SECTIONS.filter(s => s.req === 'Required').map(s => s.id);
const LP_REFINE = LP_SECTIONS.filter(s => s.req === 'Recommended' || s.req === 'Later' || s.req === 'Optional').map(s => s.id);

// ---- small presentational helpers ------------------------------------------

// The score badge. Deliberately a badge and not a sentence: the question "does
// this change my score?" came up at nearly every step during a first install, and
// a badge answers it on all eighteen sections at a glance, without reading.
const LP_SCORE_BADGE = {
  yes:    { text: 'Affects your score',      fg: 'var(--accent)',    bg: 'var(--accent-bg)',        bd: 'rgba(var(--accent-rgb),0.35)' },
  filter: { text: 'Changes what you see',    fg: 'var(--yellow)',    bg: 'rgba(234,179,8,0.09)',    bd: 'rgba(234,179,8,0.3)' },
  no:     { text: 'Does not affect scoring', fg: 'var(--text-mute)', bg: 'var(--panel-2)',          bd: 'var(--border)' },
};

function LpScoreBadge({ value }) {
  const b = LP_SCORE_BADGE[value];
  if (!b) return null;
  return (
    <span style={{ display: 'inline-block', fontSize: 10.5, fontWeight: 500, letterSpacing: 0.2,
      padding: '2px 8px', borderRadius: 999, color: b.fg, background: b.bg, border: `1px solid ${b.bd}` }}>
      {b.text}
    </span>
  );
}

// Renders the four-field explainer. One component for both the required sections
// and the optional boosters, so a booster can never quietly get a thinner
// explanation than a main step — which is how the API-key entry ended up reading
// like a capability unlock when it is really an optional speed-up.
function LpWhy({ item }) {
  if (!item) return null;
  return (
    <div style={{ margin: '0 0 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <LpScoreBadge value={item.affectsScore} />
      </div>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>{item.does}</p>
      <p style={{ margin: '0 0 8px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>{item.sowhat}</p>
      {item.extra && <p style={{ margin: '0 0 8px', fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>{item.extra}</p>}
      {item.ifYouSkip && (
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-mute)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--text-dim)', fontWeight: 500 }}>If you skip it:</b> {item.ifYouSkip}
        </p>
      )}
    </div>
  );
}

function LpDot({ status }) {
  const map = {
    complete: { ch: '✓', color: 'var(--green)' },
    empty:    { ch: '○', color: 'var(--text-mute)' },
    pending:  { ch: '⧖', color: 'var(--accent)' },
    error:    { ch: '✕', color: 'var(--red)' },
  };
  const g = map[status] || map.empty;
  return <span className="mono" style={{ color: g.color, width: 16, display: 'inline-flex', justifyContent: 'center' }}>{g.ch}</span>;
}

function LpField({ label, value, onChange, placeholder, optional, hint }) {
  // Uses the app's canonical .field + .inp styling so onboarding inputs match
  // every other form in the dashboard (mono, --bg-2, accent focus ring).
  // `hint` renders a PERSISTENT helper line below the input (unlike a
  // placeholder, it stays visible while typing — e.g. a pay-range example).
  return (
    <div className="field">
      <label>{label}{optional ? ' · optional' : ''}</label>
      <input
        className="inp" type="text" value={value || ''} placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)}
      />
      {hint && <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// Dropdown twin of LpField. Keeps an existing value that isn't in the curated
// list selectable (prepended), so prior setup (e.g. a CV-derived "United States"
// or "CST") round-trips instead of being wiped to blank.
function LpSelect({ label, value, onChange, options, optional, hint }) {
  const opts = (value && !options.includes(value)) ? [value, ...options] : options;
  return (
    <div className="field">
      <label>{label}{optional ? ' · optional' : ''}</label>
      <select className="inp" value={value || ''} onChange={e => onChange(e.target.value)}>
        <option value="">— select —</option>
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
      {hint && <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 3, lineHeight: 1.4 }}>{hint}</div>}
    </div>
  );
}

// Curated dropdown option sets for the Location section (#3). Existing custom
// values still round-trip via LpSelect's prepend.
const TZ_OPTIONS = ['Eastern (ET)', 'Central (CT)', 'Mountain (MT)', 'Pacific (PT)', 'Alaska (AKT)', 'Hawaii (HT)', 'UTC', 'London (GMT/BST)', 'Central Europe (CET)', 'India (IST)', 'Japan (JST)', 'Sydney (AET)'];
const COUNTRY_OPTIONS = ['United States', 'Canada', 'United Kingdom', 'Ireland', 'Germany', 'France', 'Netherlands', 'Spain', 'Italy', 'Switzerland', 'Austria', 'Belgium', 'Sweden', 'Denmark', 'Norway', 'Finland', 'Portugal', 'Poland', 'Australia', 'New Zealand', 'Japan', 'Singapore', 'India', 'United Arab Emirates', 'Mexico', 'Brazil'];
const VISA_OPTIONS = ['U.S. Citizen', 'U.S. Permanent Resident (Green Card)', 'Authorized to work, no sponsorship needed', 'Will need sponsorship now', 'Will need sponsorship in future (e.g., F-1/OPT)', 'H-1B', 'TN', 'EU Citizen', 'UK Right to Work'];

// Build the "how it's configured now" read-back rows + impact note for a
// customizable section, from state.values.configured. Returns null for sections
// with nothing to surface (so the box simply doesn't render). This is what lets
// the user review what each section set up (e.g. their location rules) and decide
// what to change, instead of seeing only a green checkmark.
function lpSectionSummary(id, cfg) {
  if (!cfg) return null;
  const cap = (arr, n = 12) => arr.length > n ? `${arr.slice(0, n).join(', ')}  (+${arr.length - n} more)` : arr.join(', ');
  const row = (label, val) => (val != null && val !== '' && !(Array.isArray(val) && !val.length)) ? [label, Array.isArray(val) ? cap(val) : String(val)] : null;
  let rows = [], impact = '';
  if (id === 'roles') {
    rows = [row('Targeting', cfg.targetRoles), row('Archetypes', (cfg.archetypes || []).length ? cfg.archetypes : null), cfg.scannerTitles != null ? ['Scanner searches', `${cfg.scannerTitles} title${cfg.scannerTitles === 1 ? '' : 's'}`] : null];
    impact = 'These titles are exactly what the scanner hunts for. Add or remove titles to widen or narrow what shows up in your pipeline.';
  } else if (id === 'edge' && cfg.edge) {
    rows = [row('Headline', cfg.edge.headline), ['Superpowers', `${cfg.edge.superpowers || 0}`], ['Proof points', `${cfg.edge.proofPoints || 0}`]];
    impact = 'This is the biggest lever on evaluation quality. It is how each role is scored against your strengths. Re-run to refine after a few evaluations.';
  } else if (id === 'location' && cfg.location) {
    const l = cfg.location;
    rows = [row('Home', l.home ? (l.radiusMiles != null ? `${l.home} (${l.radiusMiles} mi radius)` : l.home) : null), row('Will work in', l.allow), row('Hybrid / remote only', l.hybridRemoteOnly), row('Will NOT work in', l.hardNo)];
    impact = 'The scanner drops postings outside these rules before you ever see them. Edit to change which locations surface (for example, remove a city you no longer want).';
  } else if (id === 'evaluation' && cfg.evaluation) {
    const ev = cfg.evaluation;
    rows = [(ev.priorities || []).length ? ['Priorities', ev.priorities.map((p, i) => `${i + 1}. ${p}`).join('   ')] : null, row('Deal-breakers', ev.dealBreakers)];
    impact = 'Priorities tune the score; deal-breakers can override a high score and feed the scanner exclusions. Re-run, or edit modes/_profile.md, anytime to change how roles are judged.';
  } else if (id === 'companies' && cfg.companies) {
    const c = cfg.companies;
    rows = [['Tracking', `${c.count} compan${c.count === 1 ? 'y' : 'ies'}`], row('Including', (c.names || []).length ? `${c.names.join(', ')}${c.count > c.names.length ? ', …' : ''}` : null)];
    impact = 'The free API Scan checks these companies’ job boards every run. Add more to widen coverage.';
  }
  rows = rows.filter(Boolean);
  return rows.length ? { rows, impact } : null;
}

function LpSummaryBox({ id, configured }) {
  const s = lpSectionSummary(id, configured);
  if (!s) return null;
  return (
    <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(34,197,94,0.07)', border: '1px solid rgba(34,197,94,0.22)', fontSize: 12.5, lineHeight: 1.5 }}>
      <div style={{ color: 'var(--green)', fontWeight: 600, marginBottom: 6 }}>✓ How it's configured now</div>
      {s.rows.map(([label, val], i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
          <span style={{ color: 'var(--text-mute)', minWidth: 124, flexShrink: 0 }}>{label}</span>
          <span style={{ color: 'var(--text-dim)', flex: 1 }}>{val}</span>
        </div>
      ))}
      <div style={{ marginTop: 7, color: 'var(--text-mute)', fontStyle: 'italic' }}>{s.impact}</div>
    </div>
  );
}

// ── Models & Cost booster ─────────────────────────────────────────────────────
// Per-section model picker + approximate cost, plus the Evaluate batch knobs and
// a table of real recent-run costs. Reads/writes /api/setup/models (persists TJK_*
// to .env) and /api/agent/cost-history. Self-contained: manages its own state.
const LP_TIER = { haiku: 'fast · cheapest', sonnet: 'balanced', opus: 'deepest · priciest' };
const LP_MODE_LABEL = { pipeline: 'Evaluate', deep: 'Deep eval', scan: 'Agent Scan', triage: 'Triage' };
function lpUsd(n) {
  if (n == null || isNaN(n)) return '—';
  return n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}
function ModelsCostPanel() {
  const { useState, useEffect } = React;
  const [state, setState] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    fetch('/api/setup/models').then(r => r.json()).then(setState).catch(() => setMsg('Could not load model settings.'));
    fetch('/api/agent/cost-history').then(r => r.json()).then(d => setHistory(Array.isArray(d) ? d : [])).catch(() => {});
  }, []);

  function save(section, value) {
    setBusy(true); setMsg('');
    window.tjkMutate('/api/setup/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ section, value }) })
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (!ok || body.error) { setMsg(body.error || 'Save failed.'); return; }
        setState(body); setMsg('Saved. Takes effect on your next run.');
        // Nudge the workflow sidebar (shared.jsx) to re-read billing/key state now.
        try { window.dispatchEvent(new Event('trj:models-changed')); } catch {}
      })
      .catch(() => setMsg('Save failed.'))
      .finally(() => setBusy(false));
  }

  if (!state) return <div style={{ fontSize: 13, color: 'var(--text-mute)' }}>{msg || 'Loading model settings…'}</div>;

  const showCost = state.hasKey;
  return (
    <div>
      <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text)' }}>Models &amp; cost</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.6 }}>
        Choose which Claude model runs each step and see the approximate cost per run. Cheaper defaults are already applied; every step stays overridable.
      </p>
      <div style={{ fontSize: 12.5, marginBottom: 14, padding: '9px 12px', borderRadius: 'var(--r-ctl)',
        background: showCost ? 'rgba(34,197,94,0.07)' : 'var(--panel-2)', border: `1px solid ${showCost ? 'rgba(34,197,94,0.22)' : 'var(--border)'}`,
        color: 'var(--text-dim)', lineHeight: 1.5 }}>
        {showCost ? '● API key saved. '
          : state.keyPresent ? '○ Billing: Claude plan. Your saved key is not charged. '
          : '○ No API key. Steps run on your Claude subscription (no per-token cost). '}
        {state.note}
      </div>

      {/* Billing toggle — route everything to the flat plan without deleting the key */}
      {state.keyPresent && (
        <div className="field" style={{ marginBottom: 14 }}>
          <label>Bill workflow &amp; drafts to</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['key', 'API key'], ['plan', 'Claude plan']].map(([val, lbl]) => (
              <button key={val} disabled={busy} onClick={() => save('billing', val)} style={lpPillStyle(state.billingMode === val)}>{lbl}</button>
            ))}
          </div>
          {state.billingMode === 'plan' && (
            <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 5, lineHeight: 1.4 }}>
              Key stays saved. Runs use your Claude subscription (no per-token cost); flip back to API key anytime. The workflow uses the leaner plan flow while this is on.
            </div>
          )}
        </div>
      )}

      {/* Per-section model dropdowns */}
      {state.sections.map(s => {
        const warnMsg = s.warn && s.warn[s.current];
        return (
          <div key={s.key} className="field" style={{ marginBottom: 14 }}>
            <label>{s.label} <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>· {s.hint}</span>
              <span title={s.billsTo === 'api' ? 'Calls the Anthropic API directly and bills your API key.' : 'Runs on your Claude subscription via claude -p; only falls back to your API key if the subscription is unavailable.'}
                style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: s.billsTo === 'api' ? 'var(--accent)' : 'var(--text-mute)' }}>
                {s.billsTo === 'api' ? 'API key' : 'subscription'}
              </span>
            </label>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <select className="inp" style={{ flex: '1 1 auto' }} value={s.current} disabled={busy}
                onChange={e => save(s.key, e.target.value)}>
                {s.options.map(a => (
                  <option key={a} value={a}>
                    {a}{showCost ? ` · ~${lpUsd(s.costs[a])}/run` : ` · ${LP_TIER[a]}`}
                  </option>
                ))}
              </select>
              <span className="mono" style={{ minWidth: 92, textAlign: 'right', fontSize: 12,
                color: 'var(--text-dim)' }}>
                {showCost ? `~${lpUsd(s.costs[s.current])}` : LP_TIER[s.current]}
                <span style={{ color: 'var(--text-mute)' }}> / {s.unitLabel === 'eval' ? `run of ${s.unitsPerRun}` : s.unitLabel}</span>
              </span>
            </div>
            {warnMsg && <div style={{ fontSize: 11.5, color: 'var(--orange)', marginTop: 4, lineHeight: 1.4 }}>⚠ {warnMsg}</div>}
          </div>
        );
      })}

      {/* Batch-size knobs */}
      <div style={{ display: 'flex', gap: 16, marginTop: 4, marginBottom: 6 }}>
        {state.batch.map(b => (
          <div key={b.key} className="field" style={{ flex: 1 }}>
            <label>{b.label}</label>
            <input className="inp" type="number" min={b.min} max={b.max} value={b.current} disabled={busy}
              onChange={e => save(b.key, e.target.value)} />
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-mute)', lineHeight: 1.5, marginBottom: 14 }}>
        Batch size is the Evaluate throughput/cost trade: fewer per run costs less but clears the backlog slower. The API-key path stays higher so it does more than the plan alone.
      </div>

      {/* Full-run total */}
      <div style={{ padding: '10px 12px', borderRadius: 'var(--r-ctl)', background: 'var(--accent-bg)', border: '1px solid var(--accent)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>Estimated total per full run <span style={{ color: 'var(--text-mute)' }}>(Triage + Evaluate batch)</span></span>
        <span className="mono" style={{ fontSize: 15, color: 'var(--accent)', fontWeight: 600 }}>{showCost ? `~${lpUsd(state.totalPerRun)}` : 'subscription'}</span>
      </div>

      {/* Recent runs — Claude Code's local token-cost estimate, not the API invoice */}
      <div style={LP_SUB}>Recent runs (estimated cost)</div>
      {history.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--text-mute)' }}>No runs logged yet. Run Evaluate or Agent Scan and its estimated cost shows here.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="mono" style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ color: 'var(--text-mute)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px 4px 0', fontWeight: 500 }}>When</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>Step</th>
                <th style={{ padding: '4px 8px', fontWeight: 500 }}>Model</th>
                <th style={{ padding: '4px 0 4px 8px', fontWeight: 500, textAlign: 'right' }}>Cost</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i} style={{ color: 'var(--text-dim)', borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '4px 8px 4px 0' }}>{h.ts ? new Date(h.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</td>
                  <td style={{ padding: '4px 8px' }}>{LP_MODE_LABEL[h.mode] || h.mode}</td>
                  <td style={{ padding: '4px 8px' }}>{h.model && h.model !== 'default' ? h.model : '—'} <span style={{ color: 'var(--text-mute)' }}>· {h.billedTo === 'api' ? 'key avail.' : 'plan'}</span></td>
                  <td style={{ padding: '4px 0 4px 8px', textAlign: 'right' }} title="Local estimate from token counts, not your API invoice.">~{lpUsd(h.cost)} <span style={{ color: 'var(--text-mute)' }}>est.</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {history.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--text-mute)', marginTop: 6, lineHeight: 1.5 }}>
          Estimates from Claude Code token counts, not your API invoice. The scan/evaluate workflow runs on your Claude subscription (it only bills your API key if the subscription auth is unavailable), so these usually will not appear in your Anthropic console.
        </div>
      )}

      {msg && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-mute)' }}>{msg}</div>}
    </div>
  );
}

const LP_SUB = { fontSize: 10, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--text-mute)', fontFamily: 'var(--mono)', marginBottom: 7 };
function lpPillStyle(on) {
  return { background: on ? 'var(--accent-bg)' : 'var(--panel-2)', color: on ? 'var(--accent)' : 'var(--text-dim)',
    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 999, padding: '5px 13px', fontSize: 12, cursor: 'pointer' };
}
function lpChipStyle() {
  return { display: 'inline-flex', alignItems: 'center', background: 'var(--accent-bg)', color: 'var(--accent)', borderRadius: 999, padding: '4px 10px', fontSize: 12 };
}
// "you pick" (accent) vs "Claude Code generates" (green) legend for split sections.
function LpLegend() {
  return (
    <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-mute)' }}>
      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginRight: 5 }} />you pick</span>
      <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', marginRight: 5 }} />Claude Code generates</span>
    </div>
  );
}

// Inline SVG icon set — the dashboard's window.ICON has no brand/section icons,
// and we don't load an icon font, so the Launchpad ships its own small set.
function LpIcon({ name, size = 16, color = 'currentColor', style }) {
  const s = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style };
  switch (name) {
    case 'globe':    return <svg {...s}><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18" /></svg>;
    case 'linkedin': return <svg {...s}><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z" /><rect x="2" y="9" width="4" height="12" rx="1" /><circle cx="4" cy="4" r="2" /></svg>;
    case 'github':   return <svg {...s}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" /></svg>;
    case 'x':        return <svg {...s}><path d="M4 4l16 16M20 4L4 20" /></svg>;
    case 'preflight':return <svg {...s}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>;
    case 'cv':       return <svg {...s}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8" /></svg>;
    case 'identity': return <svg {...s}><path d="M19 21v-1a7 7 0 0 0-14 0v1" /><circle cx="12" cy="7" r="4" /></svg>;
    case 'roles':    return <svg {...s}><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" fill={color} stroke="none" /></svg>;
    case 'edge':     return <svg {...s}><path d="M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15l-1.9-4.1L5.5 9l4.6-1.4z" /></svg>;
    case 'comp':     return <svg {...s}><path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>;
    case 'location': return <svg {...s}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;
    case 'evaluation': return <svg {...s}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>;
    case 'companies':return <svg {...s}><path d="M3 21h18M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M19 21V11a1 1 0 0 0-1-1h-3" /><path d="M9 7h2M9 11h2M9 15h2" /></svg>;
    case 'outputs':  return <svg {...s}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></svg>;
    case 'health':   return <svg {...s}><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>;
    case 'bolt':     return <svg {...s}><path d="M13 2L3 14h9l-1 8 10-12h-9z" /></svg>;
    case 'plus':     return <svg {...s}><path d="M12 5v14M5 12h14" /></svg>;
    default:         return null;
  }
}
// Styled square checkbox to replace the mono ☑/☐ glyph in suggestion rows.
function LpCheck({ on }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 4, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${on ? 'var(--green)' : 'var(--border-2)'}`, background: on ? 'var(--green)' : 'transparent' }}>
      {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#07140c" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>}
    </span>
  );
}

// Contains a render crash to the active step instead of blanking the whole
// dashboard. A malformed staging file (e.g. an agent wrote companies.json in an
// unexpected shape) used to throw in renderCompanies and take down the entire
// app; now the user sees a friendly note and every other tab keeps working.
class LpErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.resetKey !== this.props.resetKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) {
      return (
        <div style={{ padding: 16, border: '1px solid var(--red)', borderRadius: 'var(--r-card)', background: 'rgba(239,68,68,0.06)' }}>
          <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 6 }}>This step hit a display problem</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
            The rest of the dashboard is fine. This usually means a config file came back in an unexpected shape. Switch to another step and back, or re-run this step in Claude Code.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

window.LaunchpadTab = function LaunchpadTab({ toast, setTab }) {
  const [state, setState] = useState(null);
  const [active, setActive] = useState('preflight');
  const [preflight, setPreflight] = useState(null);     // {ok, checks}
  const [pendingGen, setPendingGen] = useState({});     // sectionId -> prompt (copied, awaiting ack)
  const pendingBaseline = useRef({});                   // sectionId -> status when the handoff started (for empty→complete auto-clear)
  const [checkMsg, setCheckMsg] = useState({});         // sectionId -> 'checking' | {ok:false, text} after a verify attempt
  const [preview, setPreview] = useState(null);         // filter preview result (see runPreview)
  const [health, setHealth] = useState(null);           // {ok, output}
  const [apiKey, setApiKey] = useState({ has: null, input: '', saving: false, msg: '' });
  const [discKeys, setDiscKeys] = useState({ brave: null, muse: null, braveInput: '', museInput: '', saving: false, msg: '' });
  const [forms, setForms] = useState({});               // local form drafts
  const dirty = useRef(new Set());                       // "group.key" the user has actually edited

  // Merge fresh server values into the form state WITHOUT clobbering fields the
  // user is mid-edit on. Only "group.key" paths in `dirty` keep their local
  // value; everything else takes the server's value. This is what lets data the
  // user set up in Claude Desktop (name, email, location parsed from the CV)
  // appear on focus-refresh instead of needing a manual browser reload — the old
  // `{...s.values, ...f}` kept ALL stale local values once `f` was populated.
  const mergeServerValues = useCallback((f, serverValues) => {
    const sv = serverValues || {};
    const out = {};
    const groups = new Set([...Object.keys(sv), ...Object.keys(f || {})]);
    for (const g of groups) {
      const s = sv[g] || {}, l = (f && f[g]) || {};
      const merged = {};
      const keys = new Set([...Object.keys(s), ...Object.keys(l)]);
      for (const k of keys) {
        merged[k] = dirty.current.has(`${g}.${k}`)
          ? l[k]
          : (s[k] !== undefined ? s[k] : l[k]);
      }
      out[g] = merged;
    }
    return out;
  }, []);

  const refresh = useCallback(() => {
    fetch('/api/setup/state').then(r => r.json()).then(s => {
      setState(s);
      setForms(f => mergeServerValues(f, s.values));      // pull fresh values, keep my edits
    }).catch(() => {});
  }, [mergeServerValues]);

  useEffect(() => { refresh(); }, [refresh]);

  // Whether a draft API key is already saved (for the optional booster's status
  // line). Never fetches the key itself — only the boolean.
  useEffect(() => {
    fetch('/api/setup/anthropic-key').then(r => r.json())
      .then(d => setApiKey(k => ({ ...k, has: !!d.hasKey }))).catch(() => {});
  }, []);

  // Which optional web-discovery keys (Brave / Muse) are already set, for the
  // booster status lines. Booleans only — never the keys themselves.
  useEffect(() => {
    fetch('/api/setup/discovery-keys').then(r => r.json())
      .then(d => setDiscKeys(k => ({ ...k, brave: !!d.brave, muse: !!d.muse }))).catch(() => {});
  }, []);


  // Auto-run preflight on open so a healthy setup unlocks every section right
  // away. Without this, all sections sit disabled (showing a not-allowed
  // cursor) until the user manually runs preflight — confusing on a system
  // that's already fine. If preflight actually fails, the gate stays up.
  useEffect(() => {
    setPreflight({ running: true });
    window.tjkMutate('/api/setup/preflight', { method: 'POST' })
      .then(r => r.json())
      .then(setPreflight)
      .catch(() => setPreflight({ ok: false, error: 'request failed' }));
  }, []);

  // Staging for "split" sections: the dashboard owns the deterministic picks
  // (seniority + titles, radius + companies, manual certs) and saves them here;
  // the agent reads the same file, generates the rest, and writes suggestion
  // lists back for the UI to render.
  const [stages, setStages] = useState({ roles: {}, companies: {}, certs: {} });
  const loadStages = useCallback(() => {
    ['roles', 'companies', 'certs'].forEach(k =>
      fetch(`/api/setup/stage/${k}`).then(r => r.json())
        .then(d => setStages(s => ({ ...s, [k]: d || {} }))).catch(() => {}));
  }, []);
  useEffect(() => { loadStages(); }, [loadStages]);

  // When the user tabs back from Claude Desktop, re-read everything so changes
  // they ran there appear without a manual browser reload.
  useEffect(() => {
    const onFocus = () => { refresh(); loadStages(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh, loadStages]);

  // While a generative step is pending (the user is running its prompt in Claude
  // Code), poll setup state so the step checks itself off the instant its file
  // lands — no "did it work?" guessing and no manual refresh needed.
  useEffect(() => {
    if (!Object.keys(pendingGen).length) return;
    const t = setInterval(() => {
      fetch('/api/setup/state').then(r => r.json()).then(s => {
        setState(s);
        setPendingGen(p => {
          const next = { ...p }; let changed = false;
          for (const id of Object.keys(next)) {
            // Only auto-clear on an empty→complete transition. If the step was
            // already complete when the handoff started (e.g. re-running a step
            // on a machine that already has the file), leave the prompt up until
            // the user acks it, so it doesn't vanish on the first poll.
            if (s.sections?.[id]?.status === 'complete' && pendingBaseline.current[id] !== 'complete') {
              delete next[id]; changed = true;
            }
          }
          return changed ? next : p;
        });
      }).catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [pendingGen]);
  const saveStage = (key, data) => {
    setStages(s => ({ ...s, [key]: data }));
    if (state?.demo) { toast && toast('Setup is read-only in demo mode', 'warn'); return; }
    window.tjkMutate(`/api/setup/stage/${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).catch(() => {});
  };

  const sectionStatus = useCallback((id) => {
    if (id === 'preflight') return preflight ? ((preflight.engineOk ?? preflight.ok) ? 'complete' : 'error') : 'empty';
    if (id === 'health')    return health ? (health.ok ? 'complete' : 'error') : 'empty';
    if (pendingGen[id])     return 'pending';
    return state?.sections?.[id]?.status || 'empty';
  }, [state, preflight, health, pendingGen]);

  // Gate the steps on ENGINE readiness only (Node, deps, Playwright, folders).
  // Missing cv.md / profile.yml / portals.yml are non-blocking: they're created
  // in the steps below, so they must not lock those steps. Fall back to .ok for
  // older preflight payloads that predate engineOk.
  const preflightOk = preflight?.engineOk ?? preflight?.ok;
  const gated = (id) => id !== 'preflight' && !preflightOk;

  // canStart: the honest "you can use the product now" bar. Everything past this
  // improves results; none of it unlocks anything.
  const canStart = LP_REQUIRED.every(id => sectionStatus(id) === 'complete');
  const readiness = (() => {
    const done = LP_REFINE.filter(id => sectionStatus(id) === 'complete').length;
    return { done, total: LP_REFINE.length, pct: Math.round(done / LP_REFINE.length * 100) };
  })();
  const allReady = canStart && readiness.done === readiness.total;

  // ---- actions -------------------------------------------------------------
  const runPreflight = () => {
    setPreflight({ running: true });
    window.tjkMutate('/api/setup/preflight', { method: 'POST' }).then(r => r.json()).then(p => {
      setPreflight(p);
      if (p.ok) toast && toast('Preflight passed', 'success');
      else toast && toast(`Preflight: ${p.failures} issue${p.failures === 1 ? '' : 's'}`, 'warn');
    }).catch(() => { setPreflight({ ok: false, error: 'request failed' }); });
  };

  const runHealth = () => {
    setHealth({ running: true });
    window.tjkMutate('/api/setup/healthcheck', { method: 'POST' }).then(r => r.json()).then(h => {
      setHealth(h);
      toast && toast(h.ok ? 'Health check passed' : 'Health check found issues', h.ok ? 'success' : 'warn');
    }).catch(() => setHealth({ ok: false, output: 'request failed' }));
  };

  const startHandoff = (sectionId, handoffKey) => {
    pendingBaseline.current[sectionId] = state?.sections?.[sectionId]?.status || 'empty';
    window.tjkMutate(`/api/setup/handoff/${handoffKey || sectionId}`, { method: 'POST' })
      .then(r => r.json())
      .then(({ prompt }) => {
        navigator.clipboard?.writeText(prompt).catch(() => {});
        setPendingGen(p => ({ ...p, [sectionId]: prompt }));
        toast && toast('Prompt copied. Paste into your Claude Code', 'success');
      })
      .catch(() => toast && toast('Could not load prompt', 'error'));
  };

  // ── Verify the handoff, do not take the user's word for it ──────────────────
  // This replaced an "✓ I ran it" button that cleared the pending prompt and let
  // the step read as done on the user's say-so alone. A beta tester ran the roles
  // prompt, Claude never wrote data/setup/roles.json, and they advanced anyway
  // (report 2026-07-21) — the UI manufactured confidence that carried them through
  // several later steps.
  //
  // The question "did the agent write the file" is machine-checkable, and we were
  // already polling /api/setup/state every 3s to answer it. So ask the server,
  // and when the artifact is not there, SAY SO and keep the prompt on screen.
  const ackHandoff = (sectionId) => {
    setCheckMsg(m => ({ ...m, [sectionId]: 'checking' }));
    fetch('/api/setup/state').then(r => r.json()).then(s => {
      setState(s);
      loadStages(); // pick up suggestions / detected items the agent wrote back
      const done = s.sections?.[sectionId]?.status === 'complete';
      if (done) {
        setPendingGen(p => { const n = { ...p }; delete n[sectionId]; return n; });
        delete pendingBaseline.current[sectionId];
        setCheckMsg(m => { const n = { ...m }; delete n[sectionId]; return n; });
        toast && toast('Confirmed — that step is saved', 'success');
      } else {
        setCheckMsg(m => ({ ...m, [sectionId]: {
          ok: false,
          // No "Not saved yet." lead-in here: the renderer already supplies it in
          // bold, and having it in both places printed it twice.
          text: 'Nothing has landed on disk for this step, so it is not done. If Claude Code finished and asked you a question instead, answer it and let it run to the end. If it errored, re-copy the prompt and run it again.',
        } }));
      }
    }).catch(() => setCheckMsg(m => ({ ...m, [sectionId]: { ok: false, text: 'Could not reach the dashboard server to check.' } })));
  };

  // Let the user prove the step really is finished and move on anyway. Kept
  // deliberately separate from the check above and worded as an override, so
  // "I am sure" is a conscious act rather than the default path.
  const forceAck = (sectionId) => {
    setPendingGen(p => { const n = { ...p }; delete n[sectionId]; return n; });
    delete pendingBaseline.current[sectionId];
    setCheckMsg(m => { const n = { ...m }; delete n[sectionId]; return n; });
    refresh(); loadStages();
  };

  // ── 1.7: prove the filter works BEFORE the user invests in tuning it ────────
  const runPreview = () => {
    setPreview({ running: true });
    window.tjkMutate('/api/setup/preview-matches', { method: 'POST' })
      .then(r => r.json())
      .then(d => setPreview(d))
      .catch(() => setPreview({ error: 'Preview failed. Is the dashboard server still running?' }));
  };

  const saveForm = (sectionId) => {
    if (state?.demo) { toast && toast('Setup is read-only in demo mode', 'warn'); return; }
    const payload = {};
    const groups = { identity: 'candidate', comp: 'compensation', location: 'location', outputs: 'outputs' };
    const g = groups[sectionId];
    Object.assign(payload, forms[g] || {});
    window.tjkMutate(`/api/setup/save/${sectionId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    }).then(r => r.json()).then(res => {
      if (res.error) { toast && toast(res.error, 'error'); return; }
      if (res.state) { setState(res.state); }
      // Saved values now match the server, so drop their dirty marks — future
      // focus-refreshes should track the server again (e.g. if I edit them in
      // Claude Desktop later).
      for (const key of [...dirty.current]) if (key.startsWith(`${g}.`)) dirty.current.delete(key);
      toast && toast('Saved', 'success');
    }).catch(() => toast && toast('Save failed', 'error'));
  };

  const resetForm = (sectionId) => {
    window.tjkMutate(`/api/setup/reset/${sectionId}`, { method: 'POST' }).then(r => r.json()).then(res => {
      if (res.state) setState(res.state);
      const groups = { identity: 'candidate', comp: 'compensation', location: 'location', outputs: 'outputs' };
      const g = groups[sectionId];
      for (const key of [...dirty.current]) if (key.startsWith(`${g}.`)) dirty.current.delete(key);
      setForms(f => ({ ...f, [g]: (res.state?.values?.[g]) || {} }));
      toast && toast('Section reset', 'warn');
    }).catch(() => {});
  };

  const setFormVal = (group, key, val) => {
    dirty.current.add(`${group}.${key}`);                 // protect this field from focus-refresh overwrite
    setForms(f => ({ ...f, [group]: { ...(f[group] || {}), [key]: val } }));
  };


  // Save the user's Anthropic API key (drafts only). The server writes
  // dashboard-web/.env and updates the live process, so it works without a restart.
  const saveApiKey = () => {
    const key = (apiKey.input || '').trim();
    if (!key) { toast && toast('Paste your Anthropic API key first', 'warn'); return; }
    setApiKey(k => ({ ...k, saving: true, msg: '' }));
    window.tjkMutate('/api/setup/anthropic-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    }).then(r => r.json()).then(res => {
      if (res.error) { setApiKey(k => ({ ...k, saving: false, msg: res.error })); toast && toast(res.error, 'error'); return; }
      setApiKey({ has: true, input: '', saving: false, msg: 'Saved. Drafts will use the faster API path.' });
      toast && toast('API key saved', 'success');
    }).catch(() => { setApiKey(k => ({ ...k, saving: false, msg: 'Save failed' })); toast && toast('Save failed', 'error'); });
  };

  // Save the optional web-discovery keys (Brave / Muse). Server writes them to
  // dashboard-web/.env; Expand Coverage (discover.mjs) picks them up next run.
  const saveDiscoveryKeys = () => {
    const brave = (discKeys.braveInput || '').trim();
    const muse = (discKeys.museInput || '').trim();
    if (!brave && !muse) { toast && toast('Paste a Brave or Muse key first', 'warn'); return; }
    setDiscKeys(k => ({ ...k, saving: true, msg: '' }));
    window.tjkMutate('/api/setup/discovery-keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(brave ? { brave } : {}), ...(muse ? { muse } : {}) }),
    }).then(r => r.json()).then(res => {
      if (res.error) { setDiscKeys(k => ({ ...k, saving: false, msg: res.error })); toast && toast(res.error, 'error'); return; }
      setDiscKeys(k => ({ ...k, brave: !!res.brave, muse: !!res.muse, braveInput: '', museInput: '', saving: false, msg: 'Saved. Expand Coverage will use it on the next run.' }));
      toast && toast('Discovery keys saved', 'success');
    }).catch(() => { setDiscKeys(k => ({ ...k, saving: false, msg: 'Save failed' })); toast && toast('Save failed', 'error'); });
  };

  if (!state) {
    return <div style={{ padding: 40, color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: 13 }}>Loading setup…</div>;
  }

  const sec = LP_SECTIONS.find(s => s.id === active) || LP_SECTIONS[0];
  const st = sectionStatus(active);

  // ---- panel renderers -----------------------------------------------------
  function renderCv() {
    const sendFile = (file) => {
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => toast && toast('Could not read file', 'error');
      reader.onload = () => {
        window.tjkMutate('/api/setup/cv-upload', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, dataBase64: reader.result }),
        }).then(r => r.json()).then(res => {
          if (res.error) { toast && toast(res.error, 'error'); return; }
          pendingBaseline.current.cv = state?.sections?.cv?.status || 'empty';
          navigator.clipboard?.writeText(res.prompt).catch(() => {});
          setPendingGen(p => ({ ...p, cv: res.prompt }));
          toast && toast(res.seededMaster ? 'Uploaded. Also seeded resume master' : 'Uploaded. Prompt copied', 'success');
        }).catch(() => toast && toast('Upload failed', 'error'));
      };
      reader.readAsDataURL(file);
    };
    return (
      <div>
        <div
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); sendFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
          style={{ border: '1px dashed var(--border-2)', borderRadius: 'var(--r-card)', padding: '26px 16px', textAlign: 'center', background: 'var(--bg-2)' }}>
          <input id="lp-cv-file" type="file" accept=".docx,.pdf,.md,.txt" style={{ display: 'none' }} onChange={e => sendFile(e.target.files && e.target.files[0])} />
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ marginBottom: 8 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 9l5-5 5 5" /><path d="M12 4v12" />
          </svg>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
            Drag a file here, or <span onClick={() => document.getElementById('lp-cv-file').click()} style={{ color: 'var(--accent)', cursor: 'pointer' }}>browse your desktop</span>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', marginTop: 4 }}>.docx, .pdf, .md or .txt · a .docx also seeds your resume master</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={() => startHandoff('cv', 'cv-paste')}>Paste CV text</button>
          <button className="btn" onClick={() => startHandoff('cv', 'cv-linkedin')}>LinkedIn URL</button>
          <button className="btn" onClick={() => startHandoff('cv', 'cv-talk')}>Talk it through</button>
        </div>
        {pendingGen.cv && (
          <div style={{ marginTop: 14, border: '1px solid var(--accent)', borderRadius: 'var(--r-card)', padding: 14, background: 'var(--accent-bg)' }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)', marginBottom: 6 }}>One step in Claude Code sets up your whole profile</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.55 }}>The prompt below was copied to your clipboard. Paste it into Claude Code (the same chat you used to start the dashboard) and run it. It reads your CV and drafts your identity, target roles, and your edge, so the steps below fill in for you to review, then you can go straight to the first evaluation. This checks itself off the moment it finishes; you don't have to come back here.</div>
            <textarea readOnly value={pendingGen.cv} rows={4} className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
            {lpHandoffCheck("cv")}
          </div>
        )}
      </div>
    );
  }

  function renderHandoff(section) {
    const prompt = pendingGen[section.id];
    const isDone = sectionStatus(section.id) === 'complete';
    return (
      <div>
        {isDone && !prompt && (
          <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            <span style={{ color: 'var(--green)', fontWeight: 500 }}>✓ This is set up.</span> Claude Code saved it from your inputs, so nothing more is required here. To see exactly what it set or change it, re-run below, or ask Claude Code in chat to "show me my current {section.label.toLowerCase()}."
          </div>
        )}
        <button className="btn primary" disabled={gated(section.id)} onClick={() => startHandoff(section.id, section.handoff)}>
          {isDone ? `Re-run ${(section.handoffLabel || 'this step').toLowerCase()}` : (section.handoffLabel || 'Hand off to my Claude Code')} ⧉
        </button>
        {prompt && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Copied to your clipboard. Paste it into your Claude Code and let it finish. This checks itself off automatically the moment it saves.</div>
            <textarea readOnly value={prompt} rows={4}
              className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
            {lpHandoffCheck(section.id)}
          </div>
        )}
      </div>
    );
  }

  // Shared footer for every pending handoff: a real verification button plus the
  // honest result of the last check. See ackHandoff for why this is not an ack.
  //
  // Plain function returning JSX, called as {lpHandoffCheck(id)}, matching
  // handoffBox/renderRoles above. Do NOT turn this into <LpHandoffCheck /> — a
  // component declared inside the render body gets a fresh identity on every
  // parent render, so React unmounts and remounts the subtree each time and the
  // click handlers land on detached nodes.
  function lpHandoffCheck(id) {
    const c = checkMsg[id];
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--accent)' }}>⧖ Waiting for Claude Code to finish…</span>
          <button className="btn ghost sm" disabled={c === 'checking'} onClick={() => ackHandoff(id)}>
            {c === 'checking' ? 'Checking…' : 'Check if it saved'}
          </button>
        </div>
        {c && c !== 'checking' && !c.ok && (
          <div style={{ marginTop: 8, padding: '9px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(234,179,8,0.09)', border: '1px solid rgba(234,179,8,0.3)', fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.55 }}>
            <b style={{ color: 'var(--yellow)' }}>Not saved yet.</b> {c.text}
            <div style={{ marginTop: 7 }}>
              <button className="btn ghost sm" onClick={() => forceAck(id)}>Dismiss anyway</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Filter preview ──────────────────────────────────────────────────────────
  // The feedback loop that setup never had. Samples live postings through the
  // user's CURRENT filter and reports what would survive it, so a filter that
  // matches nothing is discovered in seconds instead of after an hour of tuning.
  function lpPreview() {
    const p = preview;
    return (
      <div style={{ marginTop: 4, padding: '11px 13px', borderRadius: 'var(--r-card)', background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" disabled={p?.running} onClick={runPreview}>
            {p?.running ? 'Checking live postings…' : 'Preview what this finds'}
          </button>
          <span style={{ fontSize: 11.5, color: 'var(--text-mute)' }}>Free. Reads a sample of real job boards, no AI involved.</span>
        </div>

        {p && !p.running && p.error && (
          <div style={{ marginTop: 9, fontSize: 12, color: 'var(--red)' }}>{p.error}</div>
        )}

        {p && !p.running && !p.error && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            {p.seen === 0 ? (
              <div>
                <b style={{ color: 'var(--yellow)' }}>Could not read any postings.</b> {p.reachedCompanies === 0
                  ? 'None of the sampled job boards responded. That is usually a network issue rather than a filter problem, so try again in a moment.'
                  : 'The boards responded but had no open postings in the sample.'}
              </div>
            ) : p.matched === 0 ? (
              // Coverage-aware wording. A thin sample can show zero matches simply
              // because it happened to pick companies the user does not target, so
              // it must not hand out confident "your filter is broken" advice. Only
              // once the sample covers a meaningful share of the list does a zero
              // become a statement about the filter rather than about the sample.
              (() => {
                const thin = p.totalCompanies > 0 && (p.sampledCompanies / p.totalCompanies) < 0.25;
                return thin ? (
                  <div>
                    <b style={{ color: 'var(--text)' }}>No matches in this sample.</b> It covered {p.sampledCompanies} of your {p.totalCompanies} tracked companies, which is too few to judge your filter. If those happened to be employers you do not target, this is expected.
                    <div style={{ marginTop: 5 }}>The number worth watching: your title filter dropped <b>{p.titleBlocked} of {p.seen}</b> postings, location dropped {p.geoBlocked}. On a narrow, well-tuned filter that is normal. On a brand-new setup it usually means the titles are too specific.</div>
                  </div>
                ) : (
                  <div>
                    <b style={{ color: 'var(--yellow)' }}>Nothing matches right now.</b> Out of {p.seen} live postings sampled, your title filter dropped {p.titleBlocked} and your location rules dropped {p.geoBlocked}.
                    {p.titleBlocked > p.geoBlocked
                      ? ' Most of the loss is on titles, so widen those first: add the other names employers use for your role.'
                      : ' Most of the loss is on location, so check your commute radius and work-mode settings.'}
                  </div>
                );
              })()
            ) : (
              <div>
                <b style={{ color: 'var(--green)' }}>{p.matched} of {p.seen} sampled postings match.</b> Your title filter dropped {p.titleBlocked}, location dropped {p.geoBlocked}.
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--text-mute)' }}>
              Sampled {p.sampledCompanies} of your {p.totalCompanies} tracked companies{p.reachedCompanies < p.sampledCompanies ? ` (${p.reachedCompanies} responded)` : ''}. A real scan covers all of them, so treat this as a direction check, not a forecast.
            </div>
            {p.examples?.length > 0 && (
              <div style={{ marginTop: 9 }}>
                <div style={{ fontSize: 11, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 }}>Examples that got through</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {p.examples.slice(0, 6).map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      <span style={{ color: 'var(--text)' }}>{e.title}</span>
                      <span style={{ color: 'var(--text-mute)' }}> · {e.company}{e.location ? ` · ${e.location}` : ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  function handoffBox(id) {
    if (!pendingGen[id]) return null;
    return (
      <div style={{ marginTop: 6 }}>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 6 }}>Copied to your clipboard. Paste it into your Claude Code and let it finish. This checks itself off automatically the moment it saves.</div>
        <textarea readOnly value={pendingGen[id]} rows={4} className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
        {lpHandoffCheck(id)}
      </div>
    );
  }

  function renderRoles() {
    const SENIORITY = ['Manager', 'Director', 'Senior Director', 'VP', 'Head of'];
    const r = (stages.roles && typeof stages.roles === 'object') ? stages.roles : {};
    const seniority = (Array.isArray(r.seniority) ? r.seniority : []).filter(s => typeof s === 'string');
    const titles = (Array.isArray(r.titles) ? r.titles : []).filter(t => typeof t === 'string');
    const suggestions = (Array.isArray(r.suggestions) ? r.suggestions : []).filter(s => s && typeof s === 'object' && s.title);
    const cfg = (state && state.values && state.values.configured) || {};
    const scannerTitles = cfg.scannerTitles != null ? cfg.scannerTitles : titles.length;
    const toggleSen = (s) => saveStage('roles', { ...r, seniority: seniority.includes(s) ? seniority.filter(x => x !== s) : [...seniority, s] });
    const addTitle = () => {
      const el = document.getElementById('lp-role-input'); const v = (el.value || '').trim();
      if (v && !titles.includes(v)) saveStage('roles', { ...r, titles: [...titles, v] });
      el.value = '';
    };
    const removeTitle = (t) => saveStage('roles', { ...r, titles: titles.filter(x => x !== t) });
    const toggleSug = (t) => saveStage('roles', { ...r, titles: titles.includes(t) ? titles.filter(x => x !== t) : [...titles, t] });
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LpLegend />
        <div>
          <div style={LP_SUB}>Seniority</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {SENIORITY.map(s => <button key={s} onClick={() => toggleSen(s)} style={lpPillStyle(seniority.includes(s))}>{s}</button>)}
          </div>
        </div>
        <div>
          <div style={LP_SUB}>Your titles</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="lp-role-input" className="inp" placeholder="e.g. Director of Revenue Operations" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') addTitle(); }} />
            <button className="btn" onClick={addTitle}>Add title</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {titles.length ? titles.map(t => (
              <span key={t} style={lpChipStyle()}>{t}<span onClick={() => removeTitle(t)} style={{ cursor: 'pointer', marginLeft: 6 }}>×</span></span>
            )) : <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>No titles yet.</span>}
          </div>
        </div>
        <div>
          <div style={{ ...LP_SUB, color: 'var(--green)' }}>Suggested from your CV. Tap to include</div>
          {suggestions.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {suggestions.map((s, i) => {
                const on = titles.includes(s.title);
                return (
                  <button key={i} onClick={() => toggleSug(s.title)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`, background: on ? 'rgba(34,197,94,0.10)' : 'var(--panel)', borderRadius: 'var(--r-ctl)', padding: '8px 11px', cursor: 'pointer' }}>
                    <LpCheck on={on} />
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13, color: on ? 'var(--green)' : 'var(--text)' }}>{s.title}</span>
                      {s.why && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>{s.why}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Run the generate step below. Claude Code will suggest adjacent roles here.</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Titles the scanner will search</span>
          <span className="mono" style={{ fontSize: 18, color: 'var(--accent)' }}>{scannerTitles}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={gated('roles')} onClick={() => startHandoff('roles', 'roles')}>Generate roles + scanner config ⧉</button>
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>Saves your picks, then Claude Code builds the title filters, queries, and suggestions.</span>
        </div>
        {handoffBox('roles')}
        {lpPreview()}
      </div>
    );
  }

  function renderCompanies() {
    const c = (stages.companies && typeof stages.companies === 'object') ? stages.companies : {};
    const radius = (typeof c.radiusMiles === 'number' && !isNaN(c.radiusMiles)) ? c.radiusMiles : 50;
    const picks = (Array.isArray(c.picks) ? c.picks : []).filter(x => typeof x === 'string');
    const suggestions = (Array.isArray(c.suggestions) ? c.suggestions : []).filter(s => s && typeof s === 'object' && s.name);
    const addCompany = () => {
      const el = document.getElementById('lp-co-input'); const v = (el.value || '').trim();
      if (v && !picks.includes(v)) saveStage('companies', { ...c, picks: [...picks, v] });
      el.value = '';
    };
    const removePick = (n) => saveStage('companies', { ...c, picks: picks.filter(x => x !== n) });
    const toggleSug = (n) => saveStage('companies', { ...c, picks: picks.includes(n) ? picks.filter(x => x !== n) : [...picks, n] });
    const badge = (api) => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 8px', borderRadius: 999, whiteSpace: 'nowrap', background: api ? 'rgba(34,197,94,0.14)' : 'rgba(245,158,11,0.14)', color: api ? 'var(--green)' : 'var(--orange)' }}><LpIcon name={api ? 'bolt' : 'globe'} size={11} />{api ? 'free' : 'web'}</span>
    );
    const sugRow = (s, i) => {
      const on = picks.includes(s.name);
      return (
        <button key={i} onClick={() => toggleSug(s.name)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`, background: on ? 'rgba(34,197,94,0.10)' : 'var(--panel)', borderRadius: 'var(--r-ctl)', padding: '8px 11px', cursor: 'pointer' }}>
          <LpCheck on={on} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 13, color: on ? 'var(--green)' : 'var(--text)' }}>{s.name}</span>
            {s.meta && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>{s.meta}</span>}
          </span>
          {badge(s.api)}
        </button>
      );
    };
    const local = suggestions.filter(s => s.kind === 'local');
    const industry = suggestions.filter(s => s.kind !== 'local');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <LpLegend />
        <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>A broad starter set of 123 employers ships by default, spread across 15 industries. It is a starting point, not a list picked for you, so expect to replace most of it. Add your own below, or pick from Claude Code's suggestions.</div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5, padding: '8px 11px', borderRadius: 'var(--r-ctl)', background: 'var(--panel-2)', border: '1px solid var(--border)' }}>💡 Tip: add a few companies you already care about <i>before</i> you run the suggestions. Claude Code uses them to tune what it recommends, so you'll get sharper local and industry matches.</div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={LP_SUB}>Commute radius</div>
          <input type="number" min="5" max="200" step="5" className="inp" value={radius} style={{ width: 90 }} onChange={e => saveStage('companies', { ...c, radiusMiles: parseInt(e.target.value || '0', 10) })} />
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>miles from home (for local suggestions)</span>
        </div>
        <div>
          <div style={LP_SUB}>Add your own</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input id="lp-co-input" className="inp" placeholder="Company name" style={{ flex: 1 }} onKeyDown={e => { if (e.key === 'Enter') addCompany(); }} />
            <button className="btn" onClick={addCompany}>Add</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
            {picks.length ? picks.map(n => <span key={n} style={lpChipStyle()}>{n}<span onClick={() => removePick(n)} style={{ cursor: 'pointer', marginLeft: 6 }}>×</span></span>)
              : <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>None added yet.</span>}
          </div>
        </div>
        {(local.length > 0 || industry.length > 0) ? (
          <>
            {local.length > 0 && <div><div style={{ ...LP_SUB, color: 'var(--green)' }}>Near you</div><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{local.map(sugRow)}</div></div>}
            {industry.length > 0 && <div><div style={{ ...LP_SUB, color: 'var(--green)' }}>By industry</div><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{industry.map(sugRow)}</div></div>}
            <div style={{ fontSize: 11, color: 'var(--text-mute)' }}><span style={{ color: 'var(--green)' }}>free</span> = zero-token ATS API scan · <span style={{ color: 'var(--orange)' }}>web</span> = website search (costs tokens)</div>
          </>
        ) : <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Run the step below. Claude Code will suggest local-by-radius and by-industry companies here.</div>}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>Companies you've selected to add</span>
          <span className="mono" style={{ fontSize: 18, color: 'var(--accent)' }}>{picks.length}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" disabled={gated('companies')} onClick={() => startHandoff('companies', 'companies')}>Suggest + merge companies ⧉</button>
          <span style={{ fontSize: 11, color: 'var(--text-mute)' }}>Claude Code resolves careers pages and merges picks without disturbing learned tuning.</span>
        </div>
        {handoffBox('companies')}
        {lpPreview()}
      </div>
    );
  }

  function renderForm(section) {
    if (section.id === 'identity') {
      const c = forms.candidate || {};
      const cert = stages.certs || {};
      const items = cert.items || [];
      const detected = cert.detected || [];
      const hasItem = (name) => items.some(it => it.name === name);
      const addCert = () => {
        const n = document.getElementById('lp-cert-name'), o = document.getElementById('lp-cert-org');
        const nm = (n.value || '').trim(); if (!nm) return;
        saveStage('certs', { ...cert, items: [...items, { name: nm, org: (o.value || '').trim() }] });
        n.value = ''; o.value = '';
      };
      const removeCert = (i) => saveStage('certs', { ...cert, items: items.filter((_, j) => j !== i) });
      const toggleDetected = (d) => hasItem(d.name)
        ? saveStage('certs', { ...cert, items: items.filter(it => it.name !== d.name) })
        : saveStage('certs', { ...cert, items: [...items, { name: d.name, org: d.issuer || '' }] });
      const linkRow = (icon, label, key, placeholder, optional) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
          <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center', color: key === 'portfolio_url' ? 'var(--accent)' : 'var(--text-dim)' }}><LpIcon name={icon} size={16} /></span>
          <span style={{ width: 150, flexShrink: 0, fontSize: 12.5, color: key === 'portfolio_url' ? 'var(--accent)' : 'var(--text)' }}>{label}{optional ? <span style={{ color: 'var(--text-mute)', fontSize: 11 }}> optional</span> : null}</span>
          <input className="inp" style={{ flex: 1 }} value={c[key] || ''} placeholder={placeholder} onChange={e => setFormVal('candidate', key, e.target.value)} />
        </div>
      );
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 10 }}>
            <LpField label="Full name" value={c.full_name} onChange={v => setFormVal('candidate', 'full_name', v)} />
            <LpField label="Email" value={c.email} onChange={v => setFormVal('candidate', 'email', v)} />
            <LpField label="Phone" value={c.phone} onChange={v => setFormVal('candidate', 'phone', v)} optional />
            <LpField label="Home base" value={c.location} onChange={v => setFormVal('candidate', 'location', v)} placeholder="City, ST" />
          </div>
          <div>
            <div style={LP_SUB}>Links</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {linkRow('globe', 'Portfolio / website', 'portfolio_url', 'https://yourname.com')}
              {linkRow('linkedin', 'LinkedIn', 'linkedin', 'linkedin.com/in/…')}
              {linkRow('github', 'GitHub', 'github', 'github.com/…', true)}
              {linkRow('x', 'X / Twitter', 'twitter', 'x.com/…', true)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={gated('identity') || state.demo} onClick={() => saveForm('identity')}>Save</button>
            <button className="btn ghost sm" onClick={() => resetForm('identity')}>Reset</button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <LpLegend />
            <div style={LP_SUB}>Certifications &amp; coursework</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="lp-cert-name" className="inp" placeholder="Certification or course" style={{ flex: 2 }} />
              <input id="lp-cert-org" className="inp" placeholder="Issuer" style={{ flex: 1, minWidth: 0 }} />
              <button className="btn" onClick={addCert}>Add</button>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {items.length ? items.map((it, i) => (
                <span key={i} style={lpChipStyle()}>{it.name}{it.org ? ` · ${it.org}` : ''}<span onClick={() => removeCert(i)} style={{ cursor: 'pointer', marginLeft: 6 }}>×</span></span>
              )) : <span style={{ fontSize: 12, color: 'var(--text-mute)' }}>No certifications added.</span>}
            </div>
            <div style={{ ...LP_SUB, color: 'var(--green)' }}>Detected from your CV. Tap to keep</div>
            {detected.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {detected.map((d, i) => {
                  const on = hasItem(d.name);
                  return (
                    <button key={i} onClick={() => toggleDetected(d)} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', border: `1px solid ${on ? 'var(--green)' : 'var(--border)'}`, background: on ? 'rgba(34,197,94,0.10)' : 'var(--panel)', borderRadius: 'var(--r-ctl)', padding: '8px 11px', cursor: 'pointer' }}>
                      <LpCheck on={on} />
                      <span style={{ flex: 1 }}><span style={{ display: 'block', fontSize: 13, color: on ? 'var(--green)' : 'var(--text)' }}>{d.name}</span>{d.issuer && <span style={{ display: 'block', fontSize: 11, color: 'var(--text-mute)' }}>{d.issuer}</span>}</span>
                    </button>
                  );
                })}
              </div>
            ) : <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Run detect. Claude Code will list certs from your CV here.</div>}
            <div><button className="btn" disabled={gated('identity')} onClick={() => startHandoff('identity', 'identity-certs')}>Detect certifications from CV ⧉</button></div>
            {handoffBox('identity')}
          </div>
        </div>
      );
    }
    if (section.id === 'comp') {
      const c = forms.compensation || {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
            <LpField label="Target range" value={c.target_range} onChange={v => setFormVal('compensation', 'target_range', v)} placeholder="$160K-210K" hint="Your ideal pay band. Example: $160K-210K" />
            <LpField label="Minimum (walk-away)" value={c.minimum} onChange={v => setFormVal('compensation', 'minimum', v)} placeholder="$140K" hint="The floor you would not go below. Example: $140K" />
            <LpField label="Currency" value={c.currency} onChange={v => setFormVal('compensation', 'currency', v)} placeholder="USD" hint="Example: USD" />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={state.demo} onClick={() => saveForm('comp')}>Save</button>
            <button className="btn ghost sm" onClick={() => resetForm('comp')}>Reset</button>
          </div>
        </div>
      );
    }
    if (section.id === 'location') {
      const c = forms.location || {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
            <LpField label="City" value={c.city} onChange={v => setFormVal('location', 'city', v)} placeholder="City, ST" />
            <LpSelect label="Country" value={c.country} onChange={v => setFormVal('location', 'country', v)} options={COUNTRY_OPTIONS} />
            <LpSelect label="Timezone" value={c.timezone} onChange={v => setFormVal('location', 'timezone', v)} options={TZ_OPTIONS} />
            <LpSelect label="Visa status" value={c.visa_status} onChange={v => setFormVal('location', 'visa_status', v)} options={VISA_OPTIONS} optional />
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn primary" disabled={state.demo} onClick={() => saveForm('location')}>Save</button>
            <button className="btn" onClick={() => startHandoff('location', 'location')}>Build geo filter (remote/onsite rules) ⧉</button>
            <button className="btn ghost sm" onClick={() => resetForm('location')}>Reset</button>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-mute)', lineHeight: 1.5 }}>"Build geo filter" first asks whether you want remote, hybrid, or on-site roles (and any cities you'd rule out), then sets your scanner's location rules. It won't assume your preferences.</div>
          {pendingGen.location && (
            <textarea readOnly value={pendingGen.location} rows={3}
              className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
          )}
        </div>
      );
    }
    if (section.id === 'outputs') {
      const c = forms.outputs || {};
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ padding: '9px 12px', borderRadius: 'var(--r-ctl)', background: 'var(--panel-2)', border: '1px solid var(--border)', fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
            This is where trajecktory saves the files it generates for you: every <b>tailored resume</b> (when you apply to a role) lands in the resume folder, and every <b>interview-prep note</b> lands in the prep folder. Check these folders after you apply or prep for an interview, that is where your documents are. <b>You can leave these as they are;</b> they default to your Documents folder (<span className="mono">Documents\trajecktory resumes</span> and <span className="mono">Documents\trajecktory interview prep</span>) and are created automatically. Only change them if you want the files somewhere specific.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 10 }}>
            <LpField label="Resume output folder" value={c.resume_dir} onChange={v => setFormVal('outputs', 'resume_dir', v)} placeholder="output" />
            <LpField label="Interview-prep folder" value={c.interview_prep_dir} onChange={v => setFormVal('outputs', 'interview_prep_dir', v)} placeholder="interview-prep" />
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>Company reports always stay in <span className="mono">reports/</span> so the dashboard can read them.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn primary" disabled={state.demo} onClick={() => saveForm('outputs')}>Save</button>
            <button className="btn ghost sm" onClick={() => resetForm('outputs')}>Reset</button>
          </div>
        </div>
      );
    }
    return null;
  }

  function renderAction(section) {
    if (section.id === 'preflight') {
      return (
        <div>
          <button className="btn primary" onClick={runPreflight}>{preflight?.running ? 'Checking…' : 'Run preflight check'}</button>
          {preflight && !preflight.running && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(preflight.checks || []).map((c, i) => {
                const tone = c.pass ? 'var(--green)' : (c.blocking ? 'var(--red)' : 'var(--orange)');
                const mark = c.pass ? '✓' : (c.blocking ? '✕' : '○');
                return (
                  <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                    <span className="mono" style={{ color: tone }}>{mark}</span>
                    <span style={{ flex: 1 }}>
                      <span style={{ color: 'var(--text)' }}>{c.label}</span>
                      {!c.pass && c.blocking && (c.fix || []).map((f, j) => (
                        <span key={j} style={{ display: 'block', color: 'var(--text-mute)', fontSize: 12, fontFamily: 'var(--mono)' }}>→ {f}</span>
                      ))}
                      {!c.pass && !c.blocking && (
                        <span style={{ display: 'block', color: 'var(--text-mute)', fontSize: 12 }}>You'll add this in the steps below.</span>
                      )}
                    </span>
                  </div>
                );
              })}
              {preflight.error && <div style={{ color: 'var(--red)', fontSize: 13 }}>{preflight.error}</div>}
            </div>
          )}
          {!preflightOk
            ? <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mute)' }}>The remaining steps unlock once the engine checks above pass.</div>
            : (preflight.checks || []).some(c => !c.pass)
              ? <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-mute)' }}>Engine ready. The amber items above are part of setup. Add them in the steps below. Nothing is locked.</div>
              : null}
        </div>
      );
    }
    if (section.id === 'health') {
      return (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 10 }}>
            Optional safety net. This double-checks that your saved data is formatted the way the dashboard expects. You don't need to run it to use trajecktory.
          </div>
          <button className="btn primary" disabled={gated('health')} onClick={runHealth}>{health?.running ? 'Running…' : 'Run health check'}</button>
          {health && !health.running && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: health.ok ? 'var(--green)' : 'var(--orange)', marginBottom: 6 }}>{health.ok ? '✓ Everything looks good' : 'Found a few formatting nits'}</div>
              {!health.ok && (
                <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, marginBottom: 8, padding: '9px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)' }}>
                  These are data-formatting issues, not crashes, and they usually clear up once evaluations run through the normal flow. Safe to ignore for now, or paste <span className="mono">fix the trajecktory pipeline health issues</span> into Claude Code and it will read the details below and clean them up.
                </div>
              )}
              {health.output && <pre style={{ background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-dim)', padding: 10, fontSize: 11, fontFamily: 'var(--mono)', maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{health.output}</pre>}
            </div>
          )}
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* header + readiness */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <svg width="26" height="26" viewBox="0 0 64 64" fill="none" aria-hidden="true">
          <circle cx="14" cy="50" r="3.2" fill="var(--text-mute)" />
          <path d="M14 50 C 27 46 41 35 50 14" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
          <circle cx="50" cy="14" r="7" fill="var(--accent)" />
        </svg>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, color: 'var(--text)' }}>Launchpad</h2>
          <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{allReady ? 'Setup complete. Edit any section below.' : canStart ? 'You can start using trajecktory now. The steps below sharpen your results.' : 'Get set up to search and apply. No YAML editing required.'}</div>
        </div>
        {allReady
          ? <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--green)' }}>✓ ready</span>
          : canStart
            ? <span className="pill mono" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>{readiness.done}/{readiness.total} sharpened</span>
            : <span className="pill mono" style={{ background: 'var(--accent-bg)', color: 'var(--accent)' }}>start with your CV</span>}
      </div>

      {/* The activation banner. This is the single highest-value thing on the
          page: it tells the user the product is usable BEFORE they grind through
          the remaining steps. Its absence cost a beta tester ~2 hours. */}
      {canStart && !allReady && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12, padding: '11px 13px', borderRadius: 'var(--r-card)', background: 'rgba(34,197,94,0.09)', border: '1px solid rgba(34,197,94,0.3)' }}>
          <span style={{ fontSize: 15 }}>✓</span>
          <span style={{ flex: 1, minWidth: 220, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
            <b style={{ color: 'var(--text)' }}>You are ready to use trajecktory.</b> Your CV is in, so you can start evaluating real jobs right now. The steps below are refinements, not requirements. Most people get more out of them after seeing a few scores, so feel free to come back later.
          </span>
          {setTab && <button className="btn primary" onClick={() => setTab('pipeline')}>Start using it →</button>}
        </div>
      )}

      <div style={{ height: 8, background: 'var(--panel-2)', borderRadius: 999, overflow: 'hidden', marginBottom: 6 }}>
        <div style={{ height: '100%', width: `${readiness.pct}%`, background: 'var(--accent)', borderRadius: 999, transition: 'width .25s' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-mute)', marginBottom: 12 }}>
        <span>{canStart ? 'Result quality (optional)' : 'Setup readiness'}</span>
        {state.demo ? <span style={{ color: 'var(--yellow)' }}>demo mode (read only)</span> : <span>{readiness.pct}%</span>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18, padding: '8px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <span style={{ color: 'var(--green)' }}>🛡</span>
        <span style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>Editing only updates your config. Your applications, reports, and scan history are never touched, and you can re-edit any section later.</span>
      </div>

      {/* rail + panel — flex-wrap so the panel drops below the rail on narrow
          widths instead of being crushed by a fixed grid column. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: '0 0 234px', minWidth: 200, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {LP_SECTIONS.map(s => {
            const isActive = s.id === active;
            const isGated = gated(s.id);
            return (
              <button key={s.id} onClick={() => setActive(s.id)} disabled={isGated}
                style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px',
                  borderRadius: 'var(--r-ctl)', cursor: isGated ? 'not-allowed' : 'pointer', opacity: isGated ? 0.5 : 1,
                  border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                  background: isActive ? 'var(--accent-bg)' : 'var(--panel)' }}>
                <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 'var(--r-ctl)', background: isActive ? 'rgba(var(--accent-rgb),0.18)' : 'var(--panel-2)', color: isActive ? 'var(--accent)' : 'var(--text-dim)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><LpIcon name={s.icon} size={15} /></span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: isActive ? 'var(--accent)' : 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
                  <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-mute)' }}>{s.req === 'gate' ? 'Required first' : s.req === 'payoff' ? 'The payoff' : s.req === 'verify' ? 'Verify' : s.req}</span>
                </span>
                <LpDot status={sectionStatus(s.id)} />
              </button>
            );
          })}
          <div style={{ fontSize: 10.5, color: 'var(--text-mute)', textTransform: 'uppercase', letterSpacing: 0.4, margin: '10px 0 2px 4px' }}>Optional boosters</div>
          {LP_OPTIONAL.map(o => (
            <button key={o.id} onClick={() => setActive('opt:' + o.id)} disabled={!preflightOk}
              style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 9, padding: '7px 10px',
                borderRadius: 'var(--r-ctl)', cursor: 'pointer', opacity: preflightOk ? 1 : 0.5,
                border: `1px solid ${active === 'opt:' + o.id ? 'var(--accent)' : 'var(--border)'}`, background: 'var(--panel)' }}>
              <span style={{ color: 'var(--text-mute)', width: 16, display: 'inline-flex', justifyContent: 'center' }}><LpIcon name="plus" size={13} /></span>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{o.label}</span>
            </button>
          ))}
        </div>

        <div className="card padded-lg" style={{ flex: '1 1 560px', minWidth: 0, minHeight: 280, padding: '22px 26px' }}>
          <LpErrorBoundary resetKey={active}>
          {active.startsWith('opt:') ? (() => {
            const o = LP_OPTIONAL.find(x => 'opt:' + x.id === active);
            if (o.id === 'models') {
              return <ModelsCostPanel />;
            }
            if (o.id === 'apikey') {
              return (
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text)' }}>{o.label}</h3>
                  <LpWhy item={o} />
                  {apiKey.has
                    ? <div style={{ fontSize: 13, color: 'var(--green)', marginBottom: 10 }}>✓ A key is saved. Drafts use the faster API path. Paste a new key to replace it.</div>
                    : <div style={{ fontSize: 13, color: 'var(--text-dim)', marginBottom: 10 }}>○ No key set. Drafts run on your Claude plan (the same login as Evaluate and Scan); a key just makes them faster.</div>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="password" value={apiKey.input} onChange={e => setApiKey(k => ({ ...k, input: e.target.value }))}
                      placeholder="sk-ant-…" className="inp" style={{ flex: 1 }} autoComplete="off" />
                    <button className="btn primary" disabled={apiKey.saving} onClick={saveApiKey}>{apiKey.saving ? 'Saving…' : 'Save key'}</button>
                  </div>
                  {apiKey.msg && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-mute)' }}>{apiKey.msg}</div>}
                  <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-mute)', lineHeight: 1.5 }}>
                    Get a key at console.anthropic.com → API keys. Stored locally in dashboard-web/.env; only ever sent to Anthropic.
                  </div>
                </div>
              );
            }
            if (o.id === 'discovery') {
              return (
                <div>
                  <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text)' }}>{o.label}</h3>
                  <LpWhy item={o} />
                  <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, margin: '0 0 4px' }}>Brave Search key</div>
                  {discKeys.brave
                    ? <div style={{ fontSize: 13, color: 'var(--green)', marginBottom: 8 }}>✓ Saved. Expand Coverage web search is on.</div>
                    : <div style={{ fontSize: 13, color: 'var(--orange)', marginBottom: 8 }}>○ Not set. Expand Coverage only registers companies already in your pipeline.</div>}
                  <input type="password" value={discKeys.braveInput} onChange={e => setDiscKeys(k => ({ ...k, braveInput: e.target.value }))}
                    placeholder="Brave Search API key" className="inp" style={{ width: '100%' }} autoComplete="off" />
                  <div style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 600, margin: '14px 0 4px' }}>Muse key <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(optional)</span></div>
                  {discKeys.muse
                    ? <div style={{ fontSize: 13, color: 'var(--green)', marginBottom: 8 }}>✓ Saved.</div>
                    : <div style={{ fontSize: 13, color: 'var(--text-mute)', marginBottom: 8 }}>○ Not set. Adds Director / VP roles from The Muse.</div>}
                  <input type="password" value={discKeys.museInput} onChange={e => setDiscKeys(k => ({ ...k, museInput: e.target.value }))}
                    placeholder="The Muse API key" className="inp" style={{ width: '100%' }} autoComplete="off" />
                  <div style={{ marginTop: 12 }}>
                    <button className="btn primary" disabled={discKeys.saving} onClick={saveDiscoveryKeys}>{discKeys.saving ? 'Saving…' : 'Save keys'}</button>
                  </div>
                  {discKeys.msg && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-mute)' }}>{discKeys.msg}</div>}
                  <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--text-mute)', lineHeight: 1.5 }}>
                    Brave: brave.com/search/api (free tier available). Muse: themuse.com/developers/api/v2. Stored locally in dashboard-web/.env; only ever sent to those services. Neither is needed for API Scan, Agent Scan, or Evaluate.
                  </div>
                </div>
              );
            }
            return (
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16, color: 'var(--text)' }}>{o.label}</h3>
                <LpWhy item={o} />
                <button className="btn primary" onClick={() => startHandoff('opt:' + o.id, o.id)}>Set up with my Claude Code ⧉</button>
                {pendingGen['opt:' + o.id] && (
                  <div style={{ marginTop: 12 }}>
                    <textarea readOnly value={pendingGen['opt:' + o.id]} rows={3}
                      className="ta" style={{ width: '100%', color: 'var(--text-dim)' }} />
                    <div style={{ marginTop: 8 }}><button className="btn success" onClick={() => ackHandoff('opt:' + o.id)}>✓ Done. Refresh</button></div>
                  </div>
                )}
              </div>
            );
          })() : (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                <span style={{ width: 30, height: 30, borderRadius: 'var(--r-ctl)', background: 'var(--accent-bg)', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><LpIcon name={sec.icon} size={16} /></span>
                <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>{sec.title}</h3>
                {st === 'complete' && <span className="pill" style={{ background: 'var(--accent-bg)', color: 'var(--green)', marginLeft: 'auto' }}>done</span>}
              </div>
              <LpWhy item={sec} />
              <LpSummaryBox id={sec.id} configured={state.values && state.values.configured} />
              {sec.id === 'cv' && state.sections?.cv?.warning === 'no-master-docx' && (
                <div style={{ marginBottom: 12, padding: '9px 12px', borderRadius: 'var(--r-ctl)', background: 'rgba(234,179,8,0.12)', color: 'var(--yellow)', fontSize: 12.5, lineHeight: 1.5 }}>
                  Your <span className="mono">cv.md</span> exists, but no Word master was found. Upload a <span className="mono">.docx</span> so tailored Word resumes can be generated.
                </div>
              )}
              {sec.kind === 'action' && renderAction(sec)}
              {sec.kind === 'form' && renderForm(sec)}
              {sec.kind === 'gen' && (
                sec.id === 'cv' ? renderCv()
                  : sec.id === 'roles' ? renderRoles()
                    : sec.id === 'companies' ? renderCompanies()
                      : renderHandoff(sec)
              )}
            </div>
          )}
          </LpErrorBoundary>
        </div>
      </div>
    </div>
  );
};

// ─── Setup shell — wraps Launchpad as sub-tab #1 plus added modules ──────────
const SETUP_ICONS = {
  launchpad: 'M5 3l14 9-14 9V3z',
  pitch:     'M21 11.5a8.38 8.38 0 0 1-9 8.5 8.38 8.38 0 0 1-4-1L3 21l1.5-5a8.38 8.38 0 0 1-1-4 8.5 8.5 0 0 1 17 0z',
  twc:       'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22z M12 6v6l4 2',
  changelog: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h6',
  about:     'M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22z M12 16v-4 M12 8h.01',
};
function SetupIcon({ name, size = 14 }) {
  const d = SETUP_ICONS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
      <path d={d} />
    </svg>
  );
}

const SETUP_SUBTABS = [
  { id: 'launchpad', label: 'Launchpad',              icon: 'launchpad' },
  { id: 'pitch',     label: 'Tell Me About Yourself', icon: 'pitch' },
  { id: 'twc',       label: 'TWC',                    icon: 'twc' },
  { id: 'changelog', label: 'Change Log',             icon: 'changelog' },
  { id: 'about',     label: 'About',                  icon: 'about' },
];

window.SetupTab = function SetupTab({ toast, setTab }) {
  const [view, setView] = useState('launchpad');
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="subtabs">
        {SETUP_SUBTABS.map(s => (
          <div key={s.id} className={'subtab' + (view === s.id ? ' active' : '')} onClick={() => setView(s.id)}>
            <span className="ico" style={{ display: 'inline-flex', marginRight: 6, verticalAlign: 'middle' }}>
              <SetupIcon name={s.icon} size={14} />
            </span>
            {s.label}
          </div>
        ))}
      </div>

      {view === 'launchpad' && window.LaunchpadTab && <window.LaunchpadTab toast={toast} setTab={setTab} />}
      {view === 'pitch'     && <TellMeAboutYouPanel />}
      {view === 'twc'       && <TwcPanel />}
      {view === 'changelog' && <ChangelogPanel />}
      {view === 'about'     && <AboutPanel />}
    </div>
  );
};

// ─── Tell Me About Yourself — AI elevator-pitch builder ──────────────────────
const PITCH_SENIORITY = ['IC', 'Manager', 'Director', 'VP'];
const PITCH_STAGES    = ['Recruiter screen', 'Hiring manager', 'Final loop'];
const PITCH_LENGTHS   = ['60s', '90s', '120s'];

function SetupSegmented({ label, options, value, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span className="mono dim" style={{ fontSize: 11, minWidth: 100 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {options.map(o => (
          <button key={o} className={'btn sm' + (value === o ? ' primary' : '')} onClick={() => onChange(o)} style={{ fontSize: 12 }}>{o}</button>
        ))}
      </div>
    </div>
  );
}

function TellMeAboutYouPanel() {
  const [seniority, setSeniority] = useState('Director');
  const [stage, setStage] = useState('Recruiter screen');
  const [length, setLength] = useState('90s');
  const [industry, setIndustry] = useState('');
  const [pitch, setPitch] = useState('');
  const [genAt, setGenAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/setup/pitch').then(r => r.json()).then(d => {
      if (!d) return;
      if (d.pitch) setPitch(d.pitch);
      if (d.generated_at) setGenAt(d.generated_at);
      if (d.tweaks) {
        setSeniority(d.tweaks.seniority || 'Director');
        setStage(d.tweaks.interviewStage || 'Recruiter screen');
        setLength(d.tweaks.length || '90s');
        setIndustry(d.tweaks.industry || '');
      }
    }).catch(() => {});
  }, []);

  const generate = () => {
    setLoading(true); setError(null); setSaved(false);
    window.tjkMutate('/api/setup/pitch/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seniority, industry, interviewStage: stage, length }) })
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        setLoading(false);
        if (!ok || b.error) { setError(b.error || 'Generation failed.'); return; }
        setPitch(b.pitch); setGenAt(b.generated_at); setDirty(false);
      })
      .catch(e => { setLoading(false); setError(e.message); });
  };
  const save = () => {
    window.tjkMutate('/api/setup/pitch/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pitch, tweaks: { seniority, industry, interviewStage: stage, length } }) })
      .then(() => { setSaved(true); setDirty(false); })
      .catch(() => {});
  };
  const wordCount = pitch.trim() ? pitch.trim().split(/\s+/).length : 0;

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>Tell me about yourself</h1>
          <div className="sub">A spoken answer to the most common interview opener, built from your Launchpad profile. Tweak the framing, then make it yours.</div>
        </div>
      </div>

      <div className="card padded-lg col" style={{ gap: 12 }}>
        <SetupSegmented label="Seniority" options={PITCH_SENIORITY} value={seniority} onChange={setSeniority} />
        <SetupSegmented label="Interview stage" options={PITCH_STAGES} value={stage} onChange={setStage} />
        <SetupSegmented label="Length" options={PITCH_LENGTHS} value={length} onChange={setLength} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono dim" style={{ fontSize: 11, minWidth: 100 }}>Industry</span>
          <input value={industry} onChange={e => setIndustry(e.target.value)} placeholder="blank = from your profile"
            style={{ flex: 1, minWidth: 160, background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', color: 'var(--text)', fontSize: 12.5 }} />
        </div>
        <div className="row" style={{ gap: 10 }}>
          <button className="btn primary" onClick={generate} disabled={loading}>{loading ? 'Writing…' : (pitch ? '↻ Regenerate' : 'Generate pitch')}</button>
          {genAt && <span className="mono dim" style={{ fontSize: 11 }}>Last generated {new Date(genAt).toLocaleString()}</span>}
        </div>
      </div>

      {error && (
        <div className="card padded-lg" style={{ borderColor: 'rgba(239,68,68,0.4)' }}>
          <div className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div>
        </div>
      )}

      <div className="card padded-lg col" style={{ gap: 10 }}>
        <div className="card-head">
          <span className="card-title"><span className="dot" style={{ background: 'var(--accent)' }} />Your pitch</span>
          <span className="card-meta mono">{wordCount ? wordCount + ' words' : ''}</span>
        </div>
        <textarea className="notes-ta" value={pitch} onChange={e => { setPitch(e.target.value); setDirty(true); setSaved(false); }}
          placeholder="Click Generate pitch to draft from your profile, then edit freely…"
          style={{ minHeight: 200, lineHeight: 1.6, fontSize: 13.5 }} />
        <div className="row" style={{ gap: 10 }}>
          <button className="btn primary sm" onClick={save} disabled={!pitch.trim()}>Save</button>
          {saved && !dirty && <span className="mono" style={{ fontSize: 11, color: 'var(--green)' }}>Saved</span>}
          {dirty && <span className="mono dim" style={{ fontSize: 11 }}>Unsaved edits</span>}
        </div>
      </div>
    </div>
  );
}

// ─── TWC placeholder ─────────────────────────────────────────────────────────
function TwcPanel() {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head"><div><h1>TWC</h1><div className="sub">Biweekly unemployment activity log.</div></div></div>
      <div className="card padded-lg">
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Coming soon.</div>
        <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>
          This module will help you assemble the biweekly work-search activity you report when you file
          for unemployment, pulled straight from your applications and outreach. Still collecting the data
          points. Details land soon.
        </div>
      </div>
    </div>
  );
}

// ─── Change Log — Release-Please CHANGELOG.md, skimmable ─────────────────────
function ChangelogPanel() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    fetch('/api/setup/changelog').then(r => r.json()).then(setData).catch(e => setError(e.message));
  }, []);
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>Change log</h1>
          <div className="sub">{data?.version ? `You're on v${data.version}. What's changed, newest first.` : "What's changed, newest first."}</div>
        </div>
      </div>
      {error && <div className="card padded-lg"><div className="mono" style={{ color: 'var(--red)', fontSize: 12 }}>{error}</div></div>}
      {!data && !error && <div className="card padded-lg dim" style={{ fontSize: 12 }}>Loading…</div>}
      {/* Say when these are commit subjects rather than notes written for a reader,
          instead of letting the raw fallback pass as the real thing. */}
      {data && data.source === 'changelog-md' && (data.entries || []).length > 0 && (
        <div className="card" style={{ padding: '9px 13px' }}>
          <div className="mono dim" style={{ fontSize: 11 }}>
            Showing the local changelog. Release notes could not be reached, so these are commit summaries rather than the written notes.
          </div>
        </div>
      )}
      {data && (data.entries || []).length === 0 && <div className="card padded-lg dim" style={{ fontSize: 12 }}>No changelog yet.</div>}
      {data && (data.entries || []).map((e, i) => (
        <div key={i} className="card padded-lg col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10, alignItems: 'baseline' }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>v{e.version}</span>
            {data.version === e.version && <span className="tag accent" style={{ fontSize: 10 }}>current</span>}
            <span className="mono dim" style={{ fontSize: 11, marginLeft: 'auto' }}>{e.date}</span>
          </div>
          {e.sections.map((sec, j) => (
            <div key={j} className="col" style={{ gap: 5 }}>
              {sec.heading && <div className="mono" style={{ fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--text-dim)' }}>{sec.heading.toUpperCase()}</div>}
              {/* A paragraph renders as a paragraph. Bulleting written prose turned
                  every sentence into a list item, which is exactly the look the
                  hand-written notes exist to replace. */}
              {sec.items.map((it, k) => it.type === 'bullet' ? (
                <div key={k} className="row" style={{ gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }}>•</span>
                  <span>{it.text}</span>
                </div>
              ) : (
                <div key={k} style={{ fontSize: 12.5, lineHeight: 1.55 }}>{it.text}</div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── About trajecktory ───────────────────────────────────────────────────────
function AboutPanel() {
  const [version, setVersion] = useState('');
  useEffect(() => {
    fetch('/api/system/version').then(r => r.json()).then(d => setVersion(d.version || '')).catch(() => {});
  }, []);
  const GH = 'https://github.com/michaelinghilterra-creator/trajecktory';
  const faqs = [
    { q: 'What is trajecktory?', a: 'An AI-assisted job-search command center: it tracks your pipeline, scores roles against your profile, drafts tailored resumes and outreach, and surfaces what to do next.' },
    { q: 'Does it apply to jobs for me?', a: 'No. It prepares everything (evaluation, resume, cover letter, form answers) but always stops before submit. You make the final call on every application.' },
    { q: 'Where does the AI run?', a: 'On your Claude plan by default (no API key needed) for writing features and Insights. An Anthropic API key is an optional faster path.' },
    { q: 'Where is my data?', a: 'Local. Your applications, reports, and contacts live in plain markdown files on your machine. Nothing is uploaded to a trajecktory server.' },
    { q: 'How do updates work?', a: 'A banner appears when a new version is available; one click updates and restarts. The Change Log tab shows what shipped.' },
    { q: 'Where did trajecktory come from?', a: 'trajecktory is built on career-ops by Santiago Fernández de Valderrama (santifer), an open-source, CLI-first job-search system released under the MIT License. trajecktory reshapes that foundation into a dashboard-driven product. Original project: github.com/santifer/career-ops.' },
  ];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="ta-head">
        <div>
          <h1>About trajecktory</h1>
          <div className="sub">{version ? `v${version} · ` : ''}AI-assisted job search, on your terms.</div>
        </div>
      </div>
      <div className="card padded-lg col" style={{ gap: 12 }}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <b>trajecktory</b> turns a messy job hunt into a tracked, scored, AI-assisted pipeline. It reads your CV
          and goals once, then helps you evaluate roles, tailor materials, time your follow-ups, and see what's
          actually working, without ever sending anything on your behalf.
        </div>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <a className="btn" href={GH} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>GitHub ↗</a>
        </div>
      </div>
      <div className="card padded-lg col" style={{ gap: 12 }}>
        <div className="card-head"><span className="card-title"><span className="dot" style={{ background: 'var(--accent)' }} />FAQ</span></div>
        {faqs.map((f, i) => (
          <div key={i} style={{ paddingBottom: 10, borderBottom: i < faqs.length - 1 ? '1px solid var(--border)' : 'none' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{f.q}</div>
            <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.55 }}>{f.a}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
