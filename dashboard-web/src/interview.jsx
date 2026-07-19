// Interview tab — pick a company, pick a round, rehearse the prep, run the board.
//
// The board is a faithful port of render-runsheet.mjs, which renders the same run
// sheet to standalone HTML: two columns, 17px rows, cue -> answer, a fixed answer
// overlay parked under the webcam, click/swap/Esc/click-off. Those CSS values and
// that interaction model are proven; they are NOT redesigned here.
//
// Four things are load-bearing and easy to break:
//
//  0. THIS TAB NEVER GENERATES AND NEVER WRITES. Every round on screen was compiled
//     by the agent side; the tab is GETs only. The create flow is a prompt vending
//     machine: it hands the user `/trajecktory runsheet ...` or `/trajecktory
//     interview-prep ...` to run in their own Claude Code. That is the Launchpad
//     division of labor (AGENTS.md, "Launchpad — Visual Onboarding": deterministic
//     dashboard, generative agent). Do not "improve" it into a POST.
//
//  1. CSS SCOPING. The board's own stylesheet uses `.row`, which the dashboard also
//     defines globally (styles.css: `.row{display:flex;align-items:center;gap:8px}`).
//     Every board rule is therefore namespaced under `.ib`, and the board's palette
//     vars are declared ON `.ib` rather than :root — app.jsx writes --accent onto
//     documentElement, which would otherwise repaint the board.
//
//  2. PRESENT MODE PORTALS TO <body>. The nav eats ~232px of sidebar and the topbar
//     eats ~64px; a 2-column 17px 45-row board does not survive that. Present mode is
//     position:fixed/inset:0/z-index:1000 + real fullscreen, rendered through a portal
//     so no transformed/overflow ancestor can clip or contain it.
//
//  3. ZERO NETWORK IN PRESENT MODE. Every active round is prefetched on mount and the
//     Present button stays disabled until its board is cached. The tjk_token rotates on
//     server restart; a 403 mid-interview would be a catastrophe.
const { useState: useStateI, useEffect: useEffectI, useMemo: useMemoI, useRef: useRefI, useCallback: useCallbackI } = React;

// ── The board stylesheet ─────────────────────────────────────────────────────
// Ported from render-runsheet.mjs. Values are
// verbatim; only the selectors are namespaced. 17px rows are the floor — the fit
// preflight tells you to cut cues, it never shrinks the type.
const BOARD_CSS = `
.ib{
  /* Camera calibration. Bigger --box-top = answer box sits lower. */
  --box-top: 34vh;
  --camera-gap: 80px;
  --bg:#f4f5f7; --panel:#fff; --ink:#16181d; --muted:#6b7280; --line:#e0e2e7;
  --accent:#0a7d46; --hero:#8a4b00; --danger:#b0182b; --tint:#eef7f2; --hi:#fff6e0;
  background:var(--bg); color:var(--ink); border-radius:10px; padding:16px;
  font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif; line-height:1.4;
}
@media (prefers-color-scheme: dark){
  .ib{ --bg:#12141a; --panel:#1b1e26; --ink:#e8eaee; --muted:#9aa3b2; --line:#2c313c;
       --accent:#4ade9a; --hero:#f0b866; --danger:#ff7b8a; --tint:#16241d; --hi:#2a2417; }
}
.ib *{box-sizing:border-box;}
.ib .bhead{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
           padding:0 4px 10px;flex-wrap:wrap;}
.ib .bhead h1{font-size:20px;margin:0;font-weight:700;}
.ib .bhead .when{font-size:15.5px;color:var(--muted);}
.ib .bhead .rule{font-size:15.5px;color:var(--accent);font-weight:700;}

/* ===== the answer box: floats under the camera, only while open ===== */
.ib .detail{position:fixed;top:var(--box-top);left:16px;right:16px;z-index:1050;
        background:var(--panel);border:2px solid var(--accent);border-radius:12px;
        padding:14px 20px 16px;box-shadow:0 14px 50px rgba(0,0,0,.5);
        max-height:56vh;display:none;flex-direction:column;}
.ib .detail.on{display:flex;}
.ib .detail .dhead{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
               margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid var(--line);}
.ib .detail h3{margin:0;font-size:21px;color:var(--accent);}
/* Namespacing under .ib stops OUTBOUND leaks; nothing defends inbound. The global
   .tag (styles.css) paints a bordered, padded, mono chip — and it lands on the one
   element carrying the USE ONCE signal. Reset the box, then restyle. */
.ib .detail .tag{display:inline;border:none;padding:0;border-radius:0;background:none;
             font-family:inherit;
             font-size:12.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
             color:var(--hero);white-space:nowrap;margin-left:auto;}
.ib .detail .close{font-size:13.5px;color:var(--muted);cursor:pointer;user-select:none;
                   background:none;border:none;font-family:inherit;padding:0;}
.ib .detail .close:hover{color:var(--danger);}
.ib .dbody{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:26px;overflow-y:auto;}
@media (max-width:1100px){ .ib .dbody{grid-template-columns:1fr;} }
.ib .spoken p{font-size:17.5px;line-height:1.56;margin:0 0 11px;}
.ib .spoken p:last-child{margin-bottom:0;}
.ib .spoken b{color:var(--accent);}
.ib .dnotes{border-left:2px solid var(--line);padding-left:18px;}
.ib .dnotes h4{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--hero);
           margin:0 0 7px;font-weight:800;}
.ib .dnotes ul{margin:0;padding-left:16px;}
.ib .dnotes li{font-size:14px;color:var(--muted);margin:5px 0;}
.ib .dnotes li b{color:var(--danger);}

/* ===== panels ===== */
.ib .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;}
.ib .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;
       padding:11px 15px 12px;margin:0 0 13px;}
.ib .panel:last-child{margin-bottom:0;}
.ib .camgap{margin-top:var(--camera-gap);}
.ib .panel h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);
          margin:0 0 7px;font-weight:800;}
.ib .row{display:flex;align-items:stretch;gap:9px;padding:4px 7px;font-size:17px;
     border-bottom:1px dotted var(--line);cursor:pointer;border-radius:5px;
     transition:background .08s;text-align:left;width:100%;background:none;
     border-left:none;border-right:none;border-top:none;color:inherit;font-family:inherit;}
.ib .row:last-child{border-bottom:none;}
.ib .row:hover{background:var(--tint);}
.ib .row.active{background:var(--hi);outline:2px solid var(--hero);}
.ib .row.spent{opacity:.4;}
.ib .row.spent .to::after{content:" ✓ told";color:var(--danger);font-size:12px;}
.ib .cue{flex:1 1 52%;color:var(--muted);}
.ib .to{flex:1 1 48%;font-weight:700;}
.ib .arw{color:var(--accent);font-weight:800;}
.ib .panel.hero{border-color:var(--hero);}
.ib .panel.hero h2{color:var(--hero);}
.ib .panel.panic{border-color:var(--accent);border-width:2px;background:var(--tint);}
.ib .panel.rules h2{color:var(--danger);}
.ib .panel.rules .norow{color:var(--danger);font-size:16px;font-weight:600;
                    padding:5px 0;border-bottom:1px dotted var(--line);}
.ib .panel.rules .norow:last-child{border-bottom:none;}
.ib .panel.rules .norow.derived{color:var(--hero);}
.ib .panel.rules .norow.derived::before{content:"⚠ ";}

/* ===== present mode: over ALL app chrome ===== */
.ib-present{position:fixed;inset:0;z-index:1000;overflow:auto;background:#f4f5f7;}
@media (prefers-color-scheme: dark){ .ib-present{background:#12141a;} }
.ib-present .ib{border-radius:0;min-height:100%;}
.ib-exit{position:fixed;top:8px;right:12px;z-index:1060;font-size:11px;opacity:.25;
     background:none;border:none;color:#888;cursor:pointer;font-family:inherit;}
.ib-exit:hover{opacity:1;}
`;

// ── **bold** -> <b>, as React nodes ──────────────────────────────────────────
// Never dangerouslySetInnerHTML: the runsheet is authored text and the board is
// the one surface where a stray angle bracket cannot be allowed to become markup.
// split() with a capturing group alternates plain/captured, so odd indices are bold.
function mdBold(s) {
  const parts = String(s == null ? '' : s).split(/\*\*(.+?)\*\*/g);
  return parts.map((p, i) => (i % 2 ? <b key={i}>{p}</b> : p));
}

// ── Camera calibration ───────────────────────────────────────────────────────
// Keyed by DISPLAY, not by person: the laptop panel and the docked monitor put the
// webcam in completely different places, so they get their own numbers.
const CAM_DEFAULT = { boxTopVh: 34, camGapPx: 80 };

// The rail sits UNDER the board so the board itself gets the full width. It carries
// only pre-call material you would never touch mid-answer: camera calibration and the
// counts. Collapses to a stack when there isn't width for two.
const RAIL_CSS = `
.ib-rail{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,320px);
         gap:12px;align-items:start;}
@media (max-width:1200px){ .ib-rail{grid-template-columns:1fr;} }
`;

// How far the board may overrun the viewport before the fit banner fires. Rows are
// ~33px, so this is ~9 rows of scroll. Deliberately not zero: the banner tells you to
// cut cues, and telling someone to cut a third of a board that worked in a live
// interview because it overran by 4 rows is worse advice than staying quiet.
const FIT_TOLERANCE_PX = 300;
function camKey() {
  const w = (typeof screen !== 'undefined' && screen.width) || 0;
  const h = (typeof screen !== 'undefined' && screen.height) || 0;
  return 'tjk.board.cam.' + w + 'x' + h;
}
function loadCam() {
  try { return { ...CAM_DEFAULT, ...JSON.parse(localStorage.getItem(camKey()) || '{}') }; }
  catch { return { ...CAM_DEFAULT }; }
}
function saveCam(c) {
  try { localStorage.setItem(camKey(), JSON.stringify(c)); } catch { /* ignore */ }
}

// ── Runsheet -> board model (mirrors render-runsheet.mjs buildBoard) ──────────
// Sections split into two columns balanced by cue count, order preserved.
function splitColumns(sections) {
  const secs = sections || [];
  const total = secs.reduce((n, s) => n + ((s.cues || []).length), 0);
  const col1 = [], col2 = [];
  let run = 0;
  for (const s of secs) {
    (run < total / 2 ? col1 : col2).push(s);
    run += (s.cues || []).length;
  }
  return [col1, col2];
}

function whenText(session) {
  const s = session || {};
  const when = s.when ? new Date(s.when) : null;
  if (when && !isNaN(when)) {
    return when.toLocaleString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    }) + (s.minutes ? ` · ${s.minutes} min` : '');
  }
  return s.minutes ? `${s.minutes} min` : '';
}

// ════════════════════════════════════════════════════════════════════════════
// Board — the ported artifact.
// ════════════════════════════════════════════════════════════════════════════
// measureOnly: render the grid for measurement but wire up NOTHING interactive.
// A second live Board would put duplicate document keydown/click listeners behind
// the overlay and fight the real one over the Esc contract.
function Board({ data, derived, cam, present, onMeasure, openRef, measureOnly }) {
  const answers = data.answers || {};
  const der = derived || {};

  // The API hands back collidingKeys as an array; tolerate a Set-shaped payload.
  const colliding = useMemoI(
    () => new Set(Array.isArray(der.collidingKeys) ? der.collidingKeys : []),
    [der.collidingKeys]
  );

  // The answer payload. "use once" is DERIVED (authored useOnce OR a story reachable
  // from more than one cue) — never trusted from the file alone.
  const S = useMemoI(() => {
    const out = {};
    for (const [k, a] of Object.entries(answers)) {
      const useOnce = a.useOnce || colliding.has(k);
      out[k] = {
        t: a.title || k,
        g: [a.tag, useOnce ? 'use once' : null].filter(Boolean).join(' · '),
        p: a.spoken || [],
        n: a.notes || [],
        hero: !!a.hero,
      };
    }
    return out;
  }, [answers, colliding]);

  const [active, setActive] = useStateI(null);      // { rid, key }
  const [spent, setSpent] = useStateI(() => new Set());
  const openedAtRef = useRefI(0);
  const detailRef = useRefI(null);
  const rootRef = useRefI(null);

  const markSpent = useCallbackI((key) => {
    // Dwell, not click: an accidental tap is not "I told that story".
    if (!openedAtRef.current || Date.now() - openedAtRef.current < 8000) return;
    setSpent(s => { const n = new Set(s); n.add(key); return n; });
  }, []);

  const clearDetail = useCallbackI(() => {
    setActive(a => { if (a) markSpent(a.key); return null; });
    openedAtRef.current = 0;
    if (openRef) openRef.current = false;
  }, [markSpent, openRef]);

  const show = useCallbackI((key, rid) => {
    setActive(a => {
      if (a && a.rid === rid) { markSpent(a.key); openedAtRef.current = 0; if (openRef) openRef.current = false; return null; }
      if (a) markSpent(a.key);
      openedAtRef.current = Date.now();
      if (openRef) openRef.current = true;
      return { rid, key };
    });
  }, [markSpent, openRef]);

  // Publish "an answer is open" so present mode's Esc handler can defer to us.
  // A ref, not propagation: both handlers live on `document`, where
  // stopPropagation() does NOT stop sibling listeners, and this effect re-registers
  // on every `active` change — which shuffles listener order. The ref makes the
  // contract order-independent. Kept in sync eagerly AND on render.
  useEffectI(() => { if (openRef) openRef.current = !!active; }, [active, openRef]);
  useEffectI(() => () => { if (openRef) openRef.current = false; }, [openRef]);

  // Esc clears the answer box. In present mode the Esc that leaves fullscreen is
  // handled upstream (fullscreenchange) — the browser eats that keydown itself.
  useEffectI(() => {
    if (measureOnly) return undefined;
    const onKey = (e) => { if (e.key === 'Escape' && active) clearDetail(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active, clearDetail, measureOnly]);

  // Click anywhere off the box to dismiss it and get the full board back.
  useEffectI(() => {
    if (!active) return undefined;
    const onClick = (e) => {
      if (detailRef.current && detailRef.current.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.ib .row[data-k]')) return;   // the row handler owns it
      clearDetail();
    };
    if (measureOnly) return undefined;
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [active, clearDetail, measureOnly]);

  // Fit preflight. MUST be measured at present-mode geometry: the in-tab board sits
  // in a 50/50 .today-split grid (~633px) where every row wraps, so measuring it
  // over-reports by ~10x and would tell the user to cut a third of a board that
  // fits fine. Never shrink the type — the answer is to cut cues.
  useEffectI(() => {
    if (!onMeasure) return undefined;
    const measure = () => {
      const el = rootRef.current;
      if (!el) return;
      onMeasure({ scrollHeight: el.scrollHeight, viewport: window.innerHeight });
    };
    // Two frames: let layout settle before trusting scrollHeight.
    const raf = requestAnimationFrame(() => requestAnimationFrame(measure));
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', measure); };
  }, [onMeasure, data, cam, present]);

  const [col1, col2] = useMemoI(() => splitColumns(data.sections), [data.sections]);

  const rowFor = (c, rid) => {
    const a = answers[c.answer] || {};
    const label = c.label || a.title || c.answer;
    const isActive = active && active.rid === rid;
    const cls = 'row' + (isActive ? ' active' : '') + (spent.has(c.answer) ? ' spent' : '');
    return (
      <div
        key={rid}
        className={cls}
        data-k={c.answer}
        onClick={() => show(c.answer, rid)}
      >
        <div className="cue">{c.cue}</div>
        <span className="arw">→</span>
        <div className="to">{label}</div>
      </div>
    );
  };

  const sectionFor = (s) => (
    <section key={s.id} className={'panel' + (s.style ? ' ' + s.style : '') + (s.cameraGap ? ' camgap' : '')}>
      <h2>{(s.n ? s.n + ' · ' : '') + (s.title || '')}</h2>
      {(s.cues || []).map((c, i) => rowFor(c, s.id + ':' + i))}
    </section>
  );

  // Rules panel: derived warnings first (amber, ⚠), then the authored guardrails.
  const warnings = der.warnings || [];
  const guardrails = data.guardrails || [];
  const rulesPanel = (warnings.length || guardrails.length) ? (
    <section className="panel rules">
      <h2>Use once / do not get wrong</h2>
      {warnings.map((w, i) => <div key={'w' + i} className="norow derived">{w}</div>)}
      {guardrails.map((g, i) => <div key={'g' + i} className="norow">{g}</div>)}
    </section>
  ) : null;

  const sess = data.session || {};
  const head = [data.company, sess.who, data.role].filter(Boolean).join(' · ');
  const det = active ? S[active.key] : null;

  return (
    <div
      className="ib"
      ref={rootRef}
      style={{ '--box-top': cam.boxTopVh + 'vh', '--camera-gap': cam.camGapPx + 'px' }}
    >
      <div className="bhead">
        <h1>{head}</h1>
        <div className="when">
          {[whenText(sess), data.stage, data.round != null ? 'Round ' + data.round : null]
            .filter(Boolean).join(' · ')}
        </div>
        <div className="rule">{sess.rule || 'One story per job. Click a cue. Eyes up.'}</div>
      </div>

      {/* THE ANSWER BOX: fixed overlay under the camera */}
      <div className={'detail' + (det ? ' on' : '')} ref={detailRef}>
        {det && (
          <>
            <div className="dhead">
              <h3>{det.t}</h3>
              <span className="tag">{det.g}</span>
              <button type="button" className="close" onClick={clearDetail}>clear ✕</button>
            </div>
            <div className="dbody">
              <div className="spoken">
                {det.p.map((x, i) => <p key={i}>{mdBold(x)}</p>)}
              </div>
              {det.n && det.n.length ? (
                <aside className="dnotes">
                  <h4>Delivery</h4>
                  <ul>{det.n.map((x, i) => <li key={i}>{mdBold(x)}</li>)}</ul>
                </aside>
              ) : null}
            </div>
          </>
        )}
      </div>

      {/* THE BOARD: one full-height grid, no scroll */}
      <div className="cols">
        <div>{col1.map(sectionFor)}</div>
        <div>{col2.map(sectionFor)}{rulesPanel}</div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Problems panel — BLOCKING structural faults only (a cue pointing at a missing
// answer, etc). Renders nothing when clean, which is the normal case.
//
// Deliberately does NOT show derived `warnings`: the board's own red panel already
// renders those, and that copy is the one that survives into present mode. Showing
// them here too just printed the same seven lines twice on one screen. `problems`
// have no other home, so they keep one here.
// ════════════════════════════════════════════════════════════════════════════
function ProblemsPanel({ derived }) {
  const problems = (derived && derived.problems) || [];
  if (!problems.length) return null;
  return (
    <div className="card" style={{ padding: 12, borderColor: 'var(--red)' }}>
      <div className="card-head" style={{ marginBottom: 8 }}>
        <span className="card-title" style={{ color: 'var(--red)' }}>This board is broken</span>
        <span className="card-meta mono">{problems.length}</span>
      </div>
      <div className="col" style={{ gap: 6 }}>
        {problems.map((p, i) => (
          <div key={'p' + i} style={{ fontSize: 12.5, color: 'var(--red)', lineHeight: 1.5 }}>
            <strong>Blocking:</strong> {p}
          </div>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Camera calibration — --box-top and --camera-gap ARE the calibration.
// The answer box is position:fixed and --box-top is in vh, so the box lands at the
// same viewport spot here as it does in present mode: click any cue and adjust.
// ════════════════════════════════════════════════════════════════════════════
function CalibrationPanel({ cam, setCam }) {
  const set = (patch) => setCam(c => { const n = { ...c, ...patch }; saveCam(n); return n; });
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="card-head" style={{ marginBottom: 8 }}>
        <span className="card-title">Camera calibration</span>
        <span className="card-meta mono" title="Saved per display — laptop and docked are different numbers">
          {(typeof screen !== 'undefined' ? screen.width + '×' + screen.height : 'display')}
        </span>
      </div>
      <label className="col" style={{ gap: 3, marginBottom: 8 }}>
        <span className="dim" style={{ fontSize: 11 }}>
          Answer box top — <span className="mono">{cam.boxTopVh}vh</span> · bigger = box sits lower
        </span>
        <input type="range" min="10" max="70" step="1" value={cam.boxTopVh}
          onChange={e => set({ boxTopVh: parseInt(e.target.value, 10) })} />
      </label>
      <label className="col" style={{ gap: 3 }}>
        <span className="dim" style={{ fontSize: 11 }}>
          Camera gap — <span className="mono">{cam.camGapPx}px</span> · clearance so the camera misses a panel title
        </span>
        <input type="range" min="0" max="240" step="4" value={cam.camGapPx}
          onChange={e => set({ camGapPx: parseInt(e.target.value, 10) })} />
      </label>
      <button className="btn ghost sm" style={{ marginTop: 8 }}
        onClick={() => set({ ...CAM_DEFAULT })}>Reset</button>
      <div className="dim" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.4 }}>
        Click any cue to show the box, then line it up just under your webcam.
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Prep — the prose prep sheet.
//
// NOTE ON THE MARKDOWN CONVERTER: the codebase has exactly one (reportMdToHtml in
// server/lib/html.mjs) and it is SERVER-side — the client never parses markdown, it
// receives pre-rendered HTML (see /api/report-body/:id -> {html}, consumed by
// drawer.jsx). That converter cannot be reached from here: build.mjs transpiles each
// src/*.jsx independently (bundle:false) so there are no imports, and server/lib is
// not served. The spec'd endpoint returns { markdown }, so this renders the prose
// as React nodes — preferring `html` if the API ever supplies it, which is the
// one-line reuse of the existing converter. See the notes returned with this change.
// ════════════════════════════════════════════════════════════════════════════
const PREP_CSS = `
.ib-prep h1{font-size:16px;font-weight:700;margin:0 0 6px;color:var(--text)}
.ib-prep h2{font-size:12px;font-weight:600;margin:22px 0 7px;padding-bottom:5px;border-bottom:1px solid var(--border);color:var(--text-mute);text-transform:uppercase;letter-spacing:.06em}
.ib-prep h3{font-size:12.5px;font-weight:600;margin:14px 0 5px;color:var(--text)}
.ib-prep p{margin:4px 0;font-size:13px;color:var(--text);line-height:1.6}
.ib-prep hr{border:none;border-top:1px solid var(--border);margin:16px 0}
.ib-prep blockquote{border-left:3px solid var(--accent);margin:8px 0;padding:5px 12px;color:var(--text-mute)}
.ib-prep ul{margin:5px 0 9px;padding-left:18px}
.ib-prep li{margin:3px 0;font-size:13px;color:var(--text);line-height:1.55}
.ib-prep b{font-weight:600;color:var(--text)}

/* reportMdToHtml also emits table/thead/tbody/th/td/ol/code/a. Without these the
   prep sheets rendered them at UA defaults — th/td at padding:1px, no borders,
   border-collapse:separate — which turned every table into run-together text.
   The prep files are table-dense (question/anchor grids, gap tables, fact packs). */
.ib-prep table{border-collapse:collapse;width:100%;margin:9px 0;font-size:12.5px}
.ib-prep th{text-align:left;padding:6px 10px;background:var(--panel-2);border-bottom:1px solid var(--border-2);
            color:var(--text-dim);font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.06em}
.ib-prep td{padding:6px 10px;border-bottom:1px solid var(--border);vertical-align:top;line-height:1.5;color:var(--text)}
.ib-prep tbody tr:last-child td{border-bottom:none}
.ib-prep tbody tr:hover td{background:var(--panel-2)}
.ib-prep ol{margin:5px 0 9px;padding-left:20px}
.ib-prep ol li{margin:3px 0;font-size:13px;color:var(--text);line-height:1.55}
.ib-prep code{font-family:var(--mono);font-size:11.5px;background:var(--panel-3);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
.ib-prep a{color:var(--accent-2);text-decoration:none;border-bottom:1px solid rgba(var(--accent-rgb),.35)}
.ib-prep a:hover{border-bottom-color:var(--accent-2)}

/* ── Sectioned layout: rail + document ─────────────────────────────────────── */
.ib-prepwrap{display:grid;grid-template-columns:184px minmax(0,1fr);gap:22px;align-items:start}
/* .content is the scroll container (body is overflow:hidden), and it is the
   nearest scrolling ancestor, so sticky resolves against it. */
.ib-preprail{position:sticky;top:0;align-self:start;max-height:calc(100vh - 150px);
             overflow-y:auto;padding:2px 10px 8px 0;border-right:1px solid var(--border)}
/* MUST come after the base rule: same specificity, so order decides. With this
   block above it the rail kept position:sticky when stacked, pinning the whole
   section list to the top of a one-column layout. */
@media (max-width:1100px){
  .ib-prepwrap{grid-template-columns:1fr;gap:12px}
  .ib-preprail{position:static;max-height:none;overflow-y:visible;
               border-right:none;border-bottom:1px solid var(--border);padding:0 0 8px}
  .ib-preprail .ib-railttl{margin-left:0}
}
.ib-preprail .ib-railttl{font-size:9.5px;text-transform:uppercase;letter-spacing:.14em;
             color:var(--text-mute);font-family:var(--mono);margin:0 0 7px 8px}
.ib-navitem{display:flex;align-items:baseline;gap:7px;padding:4px 8px;border-radius:6px;
            cursor:pointer;border-left:2px solid transparent;margin-bottom:1px}
.ib-navitem:hover{background:var(--panel-2)}
.ib-navitem.on{background:var(--accent-bg);border-left-color:var(--accent)}
.ib-navitem .mk{font-family:var(--mono);font-size:9.5px;color:var(--text-mute);min-width:24px;flex:none}
.ib-navitem.on .mk{color:var(--accent-2)}
.ib-navitem .lb{font-size:11.5px;color:var(--text-dim);line-height:1.35}
.ib-navitem.on .lb{color:var(--text);font-weight:500}

.ib-sec{scroll-margin-top:14px;padding:20px 0 2px;border-top:1px solid var(--border)}
.ib-sec:first-of-type{border-top:none;padding-top:2px}
.ib-sechead{display:flex;align-items:center;gap:9px;margin-bottom:10px}
.ib-secmk{font-family:var(--mono);font-size:10px;padding:2px 7px;border-radius:99px;
          background:var(--panel-3);color:var(--text-dim);border:1px solid var(--border);flex:none}
.ib-sectitle{font-size:13.5px;font-weight:600;color:var(--text);letter-spacing:-.01em}
.ib-sec .ib-secbody > :first-child{margin-top:0}

/* Role treatments. Roles come from the heading TEXT, never the § number — see
   prepRole(). The point is that a line you deliver verbatim must not look like a
   line you merely need to know. */
.ib-sec[data-role="strip"] .ib-secbody,
.ib-sec[data-role="open"] .ib-secbody,
.ib-sec[data-role="hero"] .ib-secbody{
  border-left:3px solid var(--accent);background:var(--accent-bg);
  border-radius:0 8px 8px 0;padding:12px 15px}
.ib-sec[data-role="strip"] .ib-secbody p,
.ib-sec[data-role="open"] .ib-secbody p{font-size:14px;line-height:1.7}
.ib-sec[data-role="probes"] .ib-secbody,
.ib-sec[data-role="behavioral"] .ib-secbody{
  border-left:3px solid var(--orange);border-radius:0 8px 8px 0;padding:12px 15px;
  background:color-mix(in srgb, var(--orange) 7%, transparent)}
.ib-sec[data-role="ask"] .ib-secbody ul{list-style:none;padding-left:2px}
.ib-sec[data-role="ask"] .ib-secbody ul li{position:relative;padding-left:22px;margin:5px 0}
.ib-sec[data-role="ask"] .ib-secbody ul li::before{content:"☐";position:absolute;left:2px;top:-1px;
  color:var(--accent-2);font-size:13px}
.ib-sec[data-role="debrief"],.ib-sec[data-role="after"],.ib-sec[data-role="logistics"]{opacity:.82}

/* Preamble: 11 bolded key/value paragraphs that rendered as undifferentiated prose. */
.ib-meta{display:grid;grid-template-columns:minmax(96px,auto) minmax(0,1fr);gap:5px 14px;
         padding:13px 15px;margin-bottom:6px;background:var(--panel-2);
         border:1px solid var(--border);border-radius:var(--r-card)}
.ib-metak{font-size:9.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--text-mute);
          font-family:var(--mono);text-align:right;padding-top:3px;line-height:1.5}
.ib-metav{font-size:12.5px;color:var(--text);line-height:1.55}
.ib-metav a{color:var(--accent-2);text-decoration:none}
.ib-metav b{font-weight:600}
.ib-prephead{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
.ib-prepttl{font-size:15px;font-weight:600;color:var(--text);line-height:1.35;margin:0}

/* The debrief reuses .ib-prep typography but is a panel, not a document: its own
   h1 ("# Debrief") is redundant next to the <summary> label. */
.ib-debrief > summary::marker{color:var(--text-mute)}
.ib-debrief .ib-prep h1{display:none}
.ib-debrief .ib-prep h2{margin-top:14px}
`;

// Prose prep sheets are headings + paragraphs + bullets. Bold is the only inline
// form that carries meaning in them, and it reuses the board's mdBold.
function PrepProse({ markdown }) {
  const blocks = useMemoI(() => {
    const lines = String(markdown || '').split('\n');
    const out = [];
    let list = [];
    const flush = () => { if (list.length) { out.push({ t: 'ul', items: list }); list = []; } };
    for (const line of lines) {
      const t = line.trim();
      if (/^[-*]\s+/.test(t)) { list.push(t.replace(/^[-*]\s+/, '')); continue; }
      flush();
      if (!t) continue;
      if (/^---+$/.test(t)) { out.push({ t: 'hr' }); continue; }
      if (/^### /.test(t)) { out.push({ t: 'h3', s: t.slice(4) }); continue; }
      if (/^## /.test(t))  { out.push({ t: 'h2', s: t.slice(3) }); continue; }
      if (/^# /.test(t))   { out.push({ t: 'h1', s: t.slice(2) }); continue; }
      if (/^> /.test(t))   { out.push({ t: 'bq', s: t.slice(2) }); continue; }
      out.push({ t: 'p', s: t });
    }
    flush();
    return out;
  }, [markdown]);

  return (
    <div className="ib-prep">
      {blocks.map((b, i) => {
        if (b.t === 'hr') return <hr key={i} />;
        if (b.t === 'h1') return <h1 key={i}>{mdBold(b.s)}</h1>;
        if (b.t === 'h2') return <h2 key={i}>{mdBold(b.s)}</h2>;
        if (b.t === 'h3') return <h3 key={i}>{mdBold(b.s)}</h3>;
        if (b.t === 'bq') return <blockquote key={i}>{mdBold(b.s)}</blockquote>;
        if (b.t === 'ul') return <ul key={i}>{b.items.map((x, j) => <li key={j}>{mdBold(x)}</li>)}</ul>;
        return <p key={i}>{mdBold(b.s)}</p>;
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Sectioning the prep sheet.
//
// The prep files use a validated heading grammar (`## §0 — …`, enforced by
// verify-interview-prep.mjs and specified in modes/interview-prep.md). We do NOT
// re-parse the markdown to find those sections: that would mean a SECOND markdown
// parser in this file, and PrepProse right above is the standing proof of how much
// a hand-rolled one drops (tables, ordered lists, links, code). Instead the server
// converter keeps its job and we split the RESULTING HTML on its <h2> boundaries
// using the DOM. One converter, one grammar, and no regex over HTML.
// ════════════════════════════════════════════════════════════════════════════

// § NUMBERS DO NOT CARRY STABLE MEANING ACROSS TEMPLATES. §5 is "Top 3 Proof
// Points" on a screen round but "Hero Story" on an hm-round; §7 is "Questions to
// Ask" on a screen but "Tradeoff Probes" on an hm-round, where asking lives at §8
// (templates/interview-cheatsheet-{screen,hm-round,final-loop}.md). Anything keyed
// on the number is wrong on two templates out of three, so roles come from the
// heading TEXT.
//
// ORDER IS LOAD-BEARING: "Questions to Ask" has to win before the generic /likely/
// question rule, and "Hard Questions Prep" has to land on probes rather than ask.
const PREP_ROLE_RULES = [
  // The company-level intel documents phrase this several ways and never as the
  // template's "Questions to Ask": "Three Questions YOU Need to Ask Spencer",
  // "YOUR 4 Critical Questions".
  [/questions to ask|questions you need to ask|critical questions/i, 'ask'],
  [/reply to /i,                                        'reply'],
  [/pre-?call strip|pre-?panel strip/i,                 'strip'],
  [/mental model/i,                                     'model'],
  [/hero story|proof point/i,                           'hero'],
  [/behavio/i,                                          'behavioral'],
  // `will probe` / `what to avoid` come from the intel documents; \bprobes?\b also
  // covers "Judgment / Tradeoff Probes".
  [/tradeoff|tough question|hard question|red.?flag|will probe|what to avoid|\bprobes?\b/i, 'probes'],
  // `\bstories\b` catches the per-company phrasings the templates never anticipated
  // ("The Other Two Required Stories"). Safe here because the hero rule above has
  // already claimed anything calling itself a hero story.
  [/backup stor|story bank|\bstories\b/i,               'backup'],
  [/logistics/i,                                        'logistics'],
  [/debrief/i,                                          'debrief'],
  [/after the /i,                                       'after'],
  [/likely|case ?\/ ?exercise/i,                        'likely'],
  // \bframe\b, NOT /frame/: a bare substring matched "SQL / Python Honest REframe"
  // and dressed a gap-handling section up as an opening script — which also put it
  // in the cram sheet's "Say first" block. There is no word boundary inside
  // "Reframe", so the anchored form rejects it and still matches "90-Second Frame".
  [/pitch|opening|opener|\bframe\b|panel-by-panel/i,    'open'],
  [/^why|cross-panel/i,                                 'why'],
];
function prepRole(label) {
  for (const [re, role] of PREP_ROLE_RULES) if (re.test(label)) return role;
  return 'plain';
}

// THREE numbering grammars are on disk, not one:
//
//   "## §4B - Behavioral Question Bank"    the documented grammar
//   "## §0a — PAR Core Values Alignment"   lowercase suffix, and it sorts BEFORE §0
//   "## 7) Questions to Ask Kim"           an older sheet with no § at all
//
// and four separators between the marker and the title (`-`, `—`, `.`, `:`).
// Letter suffixes and out-of-band sections are real: verify-interview-prep.mjs
// checks that §0-§10 are PRESENT, never that extras are absent, so per-company
// sections must pass through intact rather than being dropped or renumbered.
const PREP_SEC_RE = /^(?:§\s*([0-9]+[A-Za-z]?)|([0-9]{1,2}[A-Za-z]?)\))\s*[-–—:.]?\s*([\s\S]*)$/;
function splitPrepHeading(raw) {
  const t = String(raw == null ? '' : raw).trim();
  const m = t.match(PREP_SEC_RE);
  if (!m) return { marker: '', label: t };
  // Show the marker in the grammar the document itself used: a file that never
  // wrote § should not sprout one in the rail.
  const marker = m[1] != null ? '§' + m[1] : m[2];
  return { marker, label: (m[3] || '').trim() || marker };
}
// Rail labels only: drop the parenthetical asides the headings carry
// ("Why-This-Role-This-Org (deeper than screen's why-now)").
const railLabel = (s) => String(s).replace(/\s*\([^)]*\)\s*/g, ' ').trim() || s;

const outerHtmlOf = (node) => {
  const holder = document.createElement('div');
  holder.appendChild(node.cloneNode(true));
  return holder.innerHTML;
};

// The block above §0: 3 blockquotes and ~11 `**Key:** value` paragraphs carrying
// the interviewer, the format, the time budget and the links. It is the richest
// structured data in the file and rendered as flat prose. Anything that is not a
// leading-bold key/value falls through to restHtml rather than being lost.
function parsePrepPreamble(nodes) {
  const kv = [], rest = [];
  for (const n of nodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'HR') continue;
    const strong = n.querySelector('strong, b');
    const lead = strong && strong.textContent.trim();
    if (lead && /:$/.test(lead) && n.textContent.trim().indexOf(lead) === 0) {
      const clone = n.cloneNode(true);
      const s = clone.querySelector('strong, b');
      if (s) s.remove();
      kv.push({ k: lead.replace(/:$/, '').trim(), html: clone.innerHTML.replace(/^(\s|&nbsp;)+/, '').trim() });
      continue;
    }
    rest.push(outerHtmlOf(n));
  }
  return { kv, restHtml: rest.join('') };
}

// Returns null when the grammar is absent, which is the signal to fall back to the
// flat render. Of the round files on disk, that protects any written before the
// heading discipline landed — verify-interview-prep.mjs calls those "legacy" and
// warns rather than failing, so they are a supported state, not an error.
function parsePrepDoc(html) {
  if (!html || typeof document === 'undefined') return null;
  const host = document.createElement('div');
  host.innerHTML = html;
  const pre = [];
  const sections = [];
  let cur = null, title = '';
  for (const node of Array.from(host.childNodes)) {
    const el = node.nodeType === 1 ? node : null;
    if (el && el.tagName === 'H1' && !cur && !title) { title = el.textContent.trim(); continue; }
    if (el && el.tagName === 'H2') {
      const { marker, label } = splitPrepHeading(el.textContent);
      cur = { id: 'ibsec-' + sections.length, marker, label, role: prepRole(label), html: '' };
      sections.push(cur);
      continue;
    }
    if (cur) cur.html += outerHtmlOf(node);
    else if (el) pre.push(el);
  }
  if (!sections.length) return null;
  return { title, sections, meta: parsePrepPreamble(pre) };
}

// The cram sheet's "do not" block. These live INSIDE other sections (the §1 mental
// model carries "Do NOT:", the probes section carries "Traps (do not step in):"),
// so they are pulled out by finding the label and taking the list that follows it.
function extractPrepDoNot(sections) {
  if (typeof document === 'undefined') return '';
  const out = [];
  for (const s of sections) {
    const host = document.createElement('div');
    host.innerHTML = s.html;
    const kids = Array.from(host.children);
    kids.forEach((k, i) => {
      if (!/^\s*(do not|don'?t|traps)\b/i.test(k.textContent || '')) return;
      const next = kids[i + 1];
      if (next && (next.tagName === 'UL' || next.tagName === 'OL')) out.push(next.outerHTML);
    });
  }
  return out.join('');
}

// ════════════════════════════════════════════════════════════════════════════
// PrepDoc — rail + sectioned document.
// ════════════════════════════════════════════════════════════════════════════
function PrepDoc({ doc, actions }) {
  const [active, setActive] = useStateI(doc.sections.length ? doc.sections[0].id : null);
  const nodes = useRefI({});

  // Scrollspy. The scroll container is .content, but the VIEWPORT is the correct
  // observer root anyway: .content fills it, so sections cross the viewport as it
  // scrolls and we never have to go find the container. The margins bias the
  // active band to the upper third so the highlight matches what you are reading.
  useEffectI(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const els = doc.sections.map(s => nodes.current[s.id]).filter(Boolean);
    if (!els.length) return;
    const seen = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => seen.set(e.target.id, e));
      let best = null;
      seen.forEach(e => {
        if (!e.isIntersecting) return;
        if (!best || e.boundingClientRect.top < best.boundingClientRect.top) best = e;
      });
      if (best) setActive(best.target.id);
    }, { rootMargin: '-6% 0px -72% 0px', threshold: 0 });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, [doc]);

  const jump = (id) => {
    const el = nodes.current[id];
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  };

  return (
    <div className="ib-prepwrap">
      <nav className="ib-preprail">
        <div className="ib-railttl">Sections</div>
        {doc.sections.map(s => (
          <div
            key={s.id}
            className={'ib-navitem' + (active === s.id ? ' on' : '')}
            onClick={() => jump(s.id)}
            title={s.label}
          >
            <span className="mk">{s.marker || '·'}</span>
            <span className="lb">{railLabel(s.label)}</span>
          </div>
        ))}
      </nav>

      <div className="ib-prep">
        <div className="ib-prephead">
          {doc.title ? <h2 className="ib-prepttl">{doc.title}</h2> : <span />}
          {actions}
        </div>

        {doc.meta.kv.length ? (
          <div className="ib-meta">
            {doc.meta.kv.map((r, i) => (
              <React.Fragment key={i}>
                <div className="ib-metak">{r.k}</div>
                <div className="ib-metav" dangerouslySetInnerHTML={{ __html: r.html }} />
              </React.Fragment>
            ))}
          </div>
        ) : null}
        {doc.meta.restHtml ? <div dangerouslySetInnerHTML={{ __html: doc.meta.restHtml }} /> : null}

        {doc.sections.map(s => (
          <section
            key={s.id}
            id={s.id}
            className="ib-sec"
            data-role={s.role}
            ref={el => { nodes.current[s.id] = el; }}
          >
            <div className="ib-sechead">
              {s.marker ? <span className="ib-secmk">{s.marker}</span> : null}
              <span className="ib-sectitle">{s.label}</span>
            </div>
            <div className="ib-secbody" dangerouslySetInnerHTML={{ __html: s.html }} />
          </section>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DebriefPanel — the narrative body under a .run.md's frontmatter.
//
// parseRunsheet has always returned { data, body } and the server only ever read
// `data`, so this content existed on disk and had no way onto the screen. It is
// post-call material, which is why it sits below the board rather than in it.
//
// Uses <details> so it is never hidden and never in the way: written-up notes open
// on arrival, an unwritten stub stays collapsed behind its own label instead of
// filling the page with empty headings.
// ════════════════════════════════════════════════════════════════════════════
function DebriefPanel({ debrief }) {
  if (!debrief || !debrief.html) return null;
  return (
    <details className="card ib-debrief" open={!!debrief.hasProse} style={{ padding: 12 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--text)' }}>
        Debrief
        <span className="dim" style={{ fontWeight: 400, marginLeft: 8, fontSize: 11 }}>
          {debrief.hasProse ? 'written up after the call' : 'template, not filled in yet'}
        </span>
      </summary>
      <div className="ib-prep" style={{ marginTop: 10 }} dangerouslySetInnerHTML={{ __html: debrief.html }} />
    </details>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Printing — offline review.
//
// PRINT THROUGH A PORTAL, NOT THE LIVE DOM. The app is a fixed-chrome SPA: <body>
// is overflow:hidden and the real scroll container is .content, so a print
// stylesheet over the live tree prints one clipped viewport and stops. Rather than
// unwind the sidebar, the topbar and the nested scroll containers one by one, this
// renders a separate document as a direct child of <body> (the same portal Present
// mode uses) and hides everything else. Nothing on screen moves.
//
// It also forces black-on-white. The default theme is --bg:#08080b; printing that
// wastes a cartridge and reads badly on paper.
// ════════════════════════════════════════════════════════════════════════════
const PRINT_CSS = `
.tjk-print-root{display:none}
@media print{
  @page{size:Letter;margin:.55in}
  html,body{overflow:visible!important;height:auto!important;background:#fff!important}
  body > *:not(.tjk-print-root){display:none!important}
  .tjk-print-root{display:block!important;position:static!important;color:#111;background:#fff;
    font-family:var(--sans);font-size:10pt;line-height:1.5;
    -webkit-print-color-adjust:exact;print-color-adjust:exact}

  .tjk-print-root .p-head{border-bottom:1.5pt solid #111;padding-bottom:6pt;margin-bottom:11pt}
  .tjk-print-root h1{font-size:17pt;font-weight:700;letter-spacing:-.01em;margin:0 0 3pt}
  .tjk-print-root .p-sub{font-size:9.5pt;color:#444;margin:1pt 0}
  .tjk-print-root .p-sub b{color:#111}

  .tjk-print-root h2{font-size:10.5pt;font-weight:700;margin:13pt 0 5pt;text-transform:uppercase;
    letter-spacing:.07em;border-bottom:.5pt solid #bbb;padding-bottom:2pt;
    break-after:avoid;page-break-after:avoid}
  .tjk-print-root h3{font-size:10.5pt;font-weight:700;margin:9pt 0 3pt;break-after:avoid;page-break-after:avoid}
  .tjk-print-root p{margin:3pt 0}
  .tjk-print-root ul,.tjk-print-root ol{margin:3pt 0 6pt;padding-left:15pt}
  .tjk-print-root li{margin:2pt 0;break-inside:avoid;page-break-inside:avoid}
  .tjk-print-root blockquote{margin:4pt 0;padding-left:8pt;border-left:2pt solid #999;color:#333}
  .tjk-print-root code{font-family:var(--mono);font-size:8.5pt;background:#f0f0f0!important;
    padding:.5pt 2.5pt;border-radius:2pt}
  .tjk-print-root hr{border:none;border-top:.5pt solid #ccc;margin:7pt 0}
  .tjk-print-root b,.tjk-print-root strong{font-weight:700;color:#000}

  .tjk-print-root table{border-collapse:collapse;width:100%;margin:5pt 0;font-size:8.5pt}
  .tjk-print-root th,.tjk-print-root td{border:.5pt solid #bbb;padding:3pt 5pt;text-align:left;vertical-align:top}
  .tjk-print-root th{background:#ededed!important;font-weight:700}
  /* Rows, not tables: a table long enough to need a break should get one. */
  .tjk-print-root tr{break-inside:avoid;page-break-inside:avoid}

  .tjk-print-root a{color:#111;text-decoration:none;border:none}
  .tjk-print-root[data-mode="full"] a[href^="http"]::after{content:" (" attr(href) ")";
    font-size:7.5pt;color:#666;word-break:break-all}

  .tjk-print-root .p-toc{margin-bottom:9pt}
  .tjk-print-root .p-toc ol{columns:2;column-gap:20pt;font-size:9pt;margin-top:2pt}

  .tjk-print-root .p-meta{border-bottom:.5pt solid #ccc;padding-bottom:7pt;margin-bottom:2pt}
  .tjk-print-root .p-metarow{display:grid;grid-template-columns:82pt minmax(0,1fr);gap:8pt;margin:2.5pt 0;
    break-inside:avoid;page-break-inside:avoid}
  .tjk-print-root .p-metak{font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;color:#666;
    text-align:right;padding-top:1.5pt}
  .tjk-print-root .p-metav{font-size:9pt}

  /* A section must be allowed to break, or a 1,100px fact pack starts its own page
     and the full document doubles in length. Only the cards below avoid breaking. */
  .tjk-print-root .p-sec{break-inside:auto;page-break-inside:auto}
  .tjk-print-root .p-sec[data-role="strip"] > .p-body,
  .tjk-print-root .p-sec[data-role="open"] > .p-body,
  .tjk-print-root .p-sec[data-role="hero"] > .p-body{border-left:2pt solid #111;padding-left:9pt}

  /* ── Cram sheet ─────────────────────────────────────────────────────────── */
  .tjk-print-root[data-mode="cram"]{font-size:9pt;line-height:1.4}
  .tjk-print-root[data-mode="cram"] .p-card{break-inside:avoid;page-break-inside:avoid;
    border:.75pt solid #888;border-radius:3pt;padding:6pt 9pt 7pt;margin:0 0 7pt}
  .tjk-print-root[data-mode="cram"] .p-card > h2{margin:0 0 4pt;border:none;padding:0;font-size:8.5pt;color:#000}
  .tjk-print-root[data-mode="cram"] .p-card h3{font-size:9pt;margin:5pt 0 2pt}
  .tjk-print-root[data-mode="cram"] .p-card p{margin:2pt 0}
  .tjk-print-root[data-mode="cram"] .p-warn{border-width:1.5pt;border-color:#111}
  .tjk-print-root[data-mode="cram"] hr{display:none}
}
`;

// Ordered exactly as the cram sheet reads: what you say, the story you land, what
// you must not do, what you ask. Selection is by ROLE, which is what lets one
// composition serve a screen, an hm-round and a final loop.
const CRAM_BLOCKS = [
  { label: 'Say first', roles: ['strip', 'open'] },
  { label: 'Hero story', roles: ['hero'] },
];

function PrepPrintDoc({ doc, mode, session, roundMeta }) {
  const metaHtml = (re) => {
    const hit = (doc.meta.kv || []).find(r => re.test(r.k));
    return hit ? hit.html : '';
  };
  const who = metaHtml(/hiring manager|interviewer|recruiter|panel/i);
  const when = metaHtml(/^format$/i) || metaHtml(/when|date|schedule/i);

  const head = (
    <header className="p-head">
      <h1>{(session && session.company) || doc.title || 'Interview prep'}</h1>
      <div className="p-sub">
        {session ? session.role : ''}
        {roundMeta ? <> · <b>Round {roundMeta.round}</b></> : null}
        {roundMeta && roundMeta.stage ? <> · {roundMeta.stage}</> : null}
      </div>
      {who ? <div className="p-sub">Interviewer: <span dangerouslySetInnerHTML={{ __html: who }} /></div> : null}
      {when ? <div className="p-sub"><span dangerouslySetInnerHTML={{ __html: when }} /></div> : null}
    </header>
  );

  if (mode === 'cram') {
    const pick = (roles) => doc.sections.filter(s => roles.includes(s.role));
    const donot = extractPrepDoNot(doc.sections);
    const ask = pick(['ask']);
    return (
      <div className="tjk-print-root" data-mode="cram">
        {head}
        {CRAM_BLOCKS.map(b => {
          const secs = pick(b.roles);
          if (!secs.length) return null;
          return (
            <section className="p-card" key={b.label}>
              <h2>{b.label}</h2>
              {secs.map(s => <div key={s.id} dangerouslySetInnerHTML={{ __html: s.html }} />)}
            </section>
          );
        })}
        {donot ? (
          <section className="p-card p-warn">
            <h2>Do not</h2>
            <div dangerouslySetInnerHTML={{ __html: donot }} />
          </section>
        ) : null}
        {ask.length ? (
          <section className="p-card">
            <h2>Ask them</h2>
            {ask.map(s => <div key={s.id} dangerouslySetInnerHTML={{ __html: s.html }} />)}
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tjk-print-root" data-mode="full">
      {head}
      {doc.meta.kv.length ? (
        <section className="p-meta">
          {doc.meta.kv.map((r, i) => (
            <div className="p-metarow" key={i}>
              <div className="p-metak">{r.k}</div>
              <div className="p-metav" dangerouslySetInnerHTML={{ __html: r.html }} />
            </div>
          ))}
        </section>
      ) : null}
      <nav className="p-toc">
        <h2>Contents</h2>
        <ol>{doc.sections.map(s => <li key={s.id}>{s.marker ? s.marker + '  ' : ''}{s.label}</li>)}</ol>
      </nav>
      {doc.sections.map(s => (
        <section className="p-sec" key={s.id} data-role={s.role}>
          <h2>{s.marker ? s.marker + '  ' : ''}{s.label}</h2>
          <div className="p-body" dangerouslySetInnerHTML={{ __html: s.html }} />
        </section>
      ))}
    </div>
  );
}

// Two outputs, so the control is a menu rather than a button. Closes on pick, on
// Escape, and on any click outside it.
function PrintMenu({ onPick, cram = true }) {
  const [open, setOpen] = useStateI(false);
  const box = useRefI(null);
  useEffectI(() => {
    if (!open) return;
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const pick = (mode) => { setOpen(false); onPick(mode); };
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button className="btn sm" onClick={() => setOpen(o => !o)} title="Print or save as PDF for offline review">
        ⎙ Print {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="card" style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 40,
          padding: 5, minWidth: 232, boxShadow: 'var(--shadow)',
        }}>
          <div className="ib-navitem" onClick={() => pick('full')} style={{ borderLeft: 'none' }}>
            <span className="lb" style={{ color: 'var(--text)' }}>
              Full prep document
              <div className="dim" style={{ fontSize: 10.5, marginTop: 1 }}>Everything, with contents</div>
            </span>
          </div>
          <div
            className="ib-navitem"
            onClick={cram ? () => pick('cram') : undefined}
            style={{ borderLeft: 'none', opacity: cram ? 1 : 0.45, cursor: cram ? 'pointer' : 'not-allowed' }}
            title={cram ? '' : 'This document has no opener, hero story or questions to ask'}
          >
            <span className="lb" style={{ color: 'var(--text)' }}>
              Cram sheet
              <div className="dim" style={{ fontSize: 10.5, marginTop: 1 }}>
                {cram ? 'Say / hero / do-not / ask, 1-2 pages' : 'Not available for this document'}
              </div>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// The create flow: a prompt vending machine.
//
// The tab can only ever list rounds it finds ON DISK, so without this a round with
// no prep file is invisible and there is no way to start one. The fix is NOT to
// generate here: the dashboard does deterministic work and hands generative work
// to the user's own Claude Code as a copy-paste prompt (AGENTS.md, "Launchpad —
// Visual Onboarding"). This is stateless: the button produces TEXT. Nothing is
// posted, nothing is persisted, and a "new round" exists only as a string until
// the agent writes the prep file and a reload finds it.
//
// These two commands are the contract with the agent side. Company is the display
// name off the prep folder (the legal suffix already stripped), which is what the
// modes match on.
// ════════════════════════════════════════════════════════════════════════════
const runsheetCmd = (company, round) =>
  `/trajecktory runsheet ${company} round ${round}`;
// The descriptor rides along after the pinned command: interview-prep files are
// named `{company-slug}-round-{N}-{stage-descriptor}.md` (modes/interview-prep.md),
// and the mode picks its stage template from the user's wording. Blank is fine,
// the mode asks.
const interviewPrepCmd = (company, round, descriptor) =>
  `/trajecktory interview-prep ${company} round ${round}` + (descriptor ? ` ${descriptor}` : '');

// The handoff box vends a ONE-LINE command, but `.ta` (styles.css) is sized for
// prose at min-height:80px, which drops a single command into an 80px void that
// reads as a broken editor. Override the height only; the field keeps its .ta
// border, mono type, and focus ring.
const HANDOFF_CSS = `
.ib-cmd{min-height:0;height:auto;resize:none;width:100%;white-space:pre;overflow-x:auto;}
`;

// Same idiom as launchpad.jsx's handoff box: an explanatory line, the prompt in a
// readOnly .ta, and a control that puts it on the clipboard.
//
// Clipboard access is NOT guaranteed. navigator.clipboard is undefined outside a
// secure context (localhost is secure; a LAN IP or a plain-http tunnel is not) and
// writeText can reject even where it exists (permission, unfocused document).
// launchpad.jsx swallows that with `?.` and toasts "Copied" regardless, which lies.
// The textarea IS the deliverable and the fallback: on failure, select it so the
// user's own Ctrl+C works and say what happened.
function PromptHandoff({ prompt, note }) {
  const [copied, setCopied] = useStateI('idle');     // 'idle' | 'ok' | 'manual'
  const taRef = useRefI(null);

  // A new prompt is a new thing to copy. Never leave "✓ Copied" sitting over text
  // that is no longer what is on the clipboard.
  useEffectI(() => setCopied('idle'), [prompt]);

  const copy = () => {
    const selectInstead = () => {
      const el = taRef.current;
      if (el) { el.focus(); el.select(); }
      setCopied('manual');
    };
    let p;
    try { p = navigator.clipboard && navigator.clipboard.writeText(prompt); }
    catch { selectInstead(); return; }                  // insecure context / blocked
    if (!p || typeof p.then !== 'function') { selectInstead(); return; }
    p.then(() => setCopied('ok'), selectInstead);
  };

  return (
    <div className="col" style={{ gap: 8 }}>
      {note ? <div className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}>{note}</div> : null}
      <textarea
        ref={taRef}
        className="ta ib-cmd"
        rows={1}
        readOnly
        value={prompt}
        onFocus={e => e.target.select()}
        spellCheck={false}
      />
      <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={copy}>{copied === 'ok' ? '✓ Copied' : 'Copy'}</button>
        <span className="dim" style={{ fontSize: 11 }}>
          {copied === 'manual'
            ? 'Clipboard blocked. The text is selected, press Ctrl+C.'
            : 'Paste it into your Claude Code.'}
        </span>
      </div>
    </div>
  );
}

// Default for "+ New round": the one after the furthest round on disk. A folder
// holding only round 2 is at round 2, so the next one is 3; an empty folder (an
// intel report and nothing else) starts at 1.
function nextRoundNumber(rounds) {
  if (!rounds || !rounds.length) return 1;
  return rounds.reduce((m, r) => Math.max(m, r.round), 0) + 1;
}

// ════════════════════════════════════════════════════════════════════════════
// InterviewTab
// ════════════════════════════════════════════════════════════════════════════
const IV_SUBTABS = [
  { id: 'prep', label: 'Prep' },
  { id: 'live', label: 'Live' },
];

// The round you are prepping for is the one whose stage matches the live tracker
// status. A round number and a stage can agree by coincidence (a 3-round process
// whose first round is a TA screen), so match on stage and fall back rather than
// assuming round == stage.
function defaultRound(s) {
  const rounds = (s && s.rounds) || [];
  if (!rounds.length) return null;
  const live = rounds.find(r => r.stage && s.status && r.stage === s.status);
  if (live) return live.round;
  if (s.round != null && rounds.some(r => r.round === s.round)) return s.round;
  const boards = rounds.filter(r => r.runPath || r.hasBoard);
  if (boards.length) return boards[boards.length - 1].round;
  return rounds[rounds.length - 1].round;
}

window.InterviewTab = function InterviewTab({ apps, toast }) {
  const [sessions, setSessions] = useStateI({ active: [], archive: [] });
  const [loading, setLoading] = useStateI(true);
  const [loadErr, setLoadErr] = useStateI(null);
  const [selId, setSelId] = useStateI(null);
  const [selRound, setSelRound] = useStateI(null);
  // A company-level document (intel report / cheat sheet) selected INSTEAD of a
  // round. Non-null takes over the pane: a doc belongs to the company, not to a
  // round, so it has no board and no Prep/Live split.
  const [selDoc, setSelDoc] = useStateI(null);
  const [docCache, setDocCache] = useStateI({});     // `${id}::${key}` -> { doc, docErr }
  const [sub, setSub] = useStateI('prep');
  const [cache, setCache] = useStateI({});           // `${id}:${round}` -> { run, runErr, prep, prepErr }
  const [present, setPresent] = useStateI(false);
  const [cam, setCam] = useStateI(loadCam);
  const [fit, setFit] = useStateI(null);             // { scrollHeight, viewport }
  const [showArchive, setShowArchive] = useStateI(false);
  // The "+ New round" form. Deliberately NOT persisted and never sent anywhere:
  // it is scratch input for a prompt string. { round: string, descriptor: string }
  // or null when the form is closed. `round` stays a string so the field can be
  // emptied mid-edit without the value snapping back to NaN.
  const [newRound, setNewRound] = useStateI(null);
  // null | { mode:'full'|'cram', seq }. Mounts the print document; cleared on
  // afterprint. It carries a seq because setting the SAME mode twice is a no-op in
  // React — it bails out on an identical value, the effect never re-runs, and if a
  // browser had skipped afterprint the menu would be permanently dead. A fresh
  // object per pick means every pick prints.
  const [printReq, setPrintReq] = useStateI(null);
  const askPrint = useCallbackI(
    (mode) => setPrintReq(r => ({ mode, seq: (r ? r.seq : 0) + 1 })),
    []
  );
  const inflight = useRefI(new Set());
  const answerOpenRef = useRefI(false);   // set by the mounted Board; see the Esc contract below

  // One GET per round, deduped. GETs only — no tjkMutate needed.
  const loadRound = useCallbackI((id, round) => {
    const k = id + ':' + round;
    if (inflight.current.has(k)) return;
    inflight.current.add(k);
    const asErr = (r, fallback) =>
      r.json().then(j => (j && j.error) || fallback).catch(() => fallback);
    const run = fetch(`/api/interview/runsheet/${encodeURIComponent(id)}/${encodeURIComponent(round)}`)
      .then(r => r.ok ? r.json().then(j => ({ run: j })) : asErr(r, 'No live board for this round.').then(e => ({ runErr: e })))
      .catch(() => ({ runErr: 'Could not load the board.' }));
    const prep = fetch(`/api/interview/prep/${encodeURIComponent(id)}/${encodeURIComponent(round)}`)
      .then(r => r.ok ? r.json().then(j => ({ prep: j })) : asErr(r, 'No prep file for this round.').then(e => ({ prepErr: e })))
      .catch(() => ({ prepErr: 'Could not load the prep sheet.' }));
    Promise.all([run, prep]).then(([a, b]) => setCache(c => ({ ...c, [k]: { ...a, ...b, done: true } })));
  }, []);

  // Same shape for a company document. NOT prefetched with the rounds: a doc is
  // reference reading, never opened mid-interview, so it does not have to satisfy
  // the zero-network-in-present rule that forces the round prefetch.
  const loadDoc = useCallbackI((id, key) => {
    const k = id + '::' + key;
    if (inflight.current.has(k)) return;
    inflight.current.add(k);
    fetch(`/api/interview/doc/${encodeURIComponent(id)}/${encodeURIComponent(key)}`)
      .then(r => r.ok
        ? r.json().then(j => ({ doc: j }))
        : r.json().then(j => ({ docErr: (j && j.error) || 'Document not found.' })).catch(() => ({ docErr: 'Document not found.' })))
      .catch(() => ({ docErr: 'Could not load the document.' }))
      .then(v => setDocCache(c => ({ ...c, [k]: { ...v, done: true } })));
  }, []);

  // Load on mount, and PREFETCH every active round. Present mode must never touch
  // the network — the token rotates on restart and a 403 mid-interview is fatal.
  useEffectI(() => {
    let dead = false;
    fetch('/api/interview/sessions')
      .then(r => r.json())
      .then(d => {
        if (dead) return;
        const active = Array.isArray(d.active) ? d.active : [];
        const archive = Array.isArray(d.archive) ? d.archive : [];
        setSessions({ active, archive });
        setLoading(false);
        if (active.length) {
          setSelId(active[0].id);
          setSelRound(defaultRound(active[0]));
        }
        active.forEach(s => (s.rounds || []).forEach(r => loadRound(s.id, r.round)));
      })
      .catch(() => { if (!dead) { setLoadErr('Could not load interview sessions. Is the server running?'); setLoading(false); } });
    return () => { dead = true; };
  }, [loadRound]);

  const allSessions = useMemoI(
    () => [...(sessions.active || []), ...(sessions.archive || [])],
    [sessions]
  );
  const session = useMemoI(() => allSessions.find(s => s.id === selId) || null, [allSessions, selId]);
  const rounds = (session && session.rounds) || [];
  const roundMeta = rounds.find(r => r.round === selRound) || null;
  const entry = cache[selId + ':' + selRound] || null;
  const runData = entry && entry.run ? entry.run : null;
  const boardReady = !!(runData && runData.data);
  // null when the § grammar is absent, which is the fall-back-to-flat signal.
  const prepDoc = useMemoI(
    () => parsePrepDoc(entry && entry.prep && entry.prep.html),
    [entry]
  );

  const docMeta = selDoc ? ((session && session.docs) || []).find(d => d.key === selDoc) || null : null;
  const docEntry = selDoc ? (docCache[selId + '::' + selDoc] || null) : null;
  const docParsed = useMemoI(
    () => parsePrepDoc(docEntry && docEntry.doc && docEntry.doc.html),
    [docEntry]
  );
  // What the Prep pane is actually showing right now: a company document if one is
  // selected, otherwise the round's prep sheet. Print follows the same choice.
  const shownDoc = selDoc ? docParsed : prepDoc;
  // The cram sheet is composed from delivery-critical roles. An intel report is all
  // research and may carry none of them, and printing a cram sheet that is just a
  // header is worse than not offering one, so the option is gated on having content.
  const cramAvailable = !!(shownDoc && shownDoc.sections.some(
    s => s.role === 'strip' || s.role === 'open' || s.role === 'hero' || s.role === 'ask'
  ));

  const pickSession = (s) => {
    setSelId(s.id);
    const r = defaultRound(s);
    setSelRound(r);
    setSelDoc(null);     // a doc key is per-company; never carry one across companies
    setFit(null);
    setNewRound(null);   // the default round number is per-company; don't carry it over
    if (r != null) loadRound(s.id, r);       // archive rounds aren't prefetched
  };
  const pickRound = (r) => { setSelRound(r); setSelDoc(null); setFit(null); loadRound(selId, r); };
  const pickDoc = (key) => { setSelDoc(key); setSub('prep'); loadDoc(selId, key); };

  // ── Present mode ───────────────────────────────────────────────────────────
  const exitPresent = useCallbackI(() => {
    setPresent(false);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  }, []);
  const enterPresent = useCallbackI(() => {
    setPresent(true);
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});   // denied is survivable: the overlay still covers the chrome
  }, []);

  // ── Print ──────────────────────────────────────────────────────────────────
  // window.print() blocks synchronously, so it cannot be called in the same tick
  // that sets the request: React would not have painted the print document yet and
  // the dialog would show an empty page. Set it, let it paint, then print.
  // afterprint clears it whether the user printed or cancelled.
  useEffectI(() => {
    if (!printReq) return;
    const done = () => setPrintReq(null);
    window.addEventListener('afterprint', done);
    const t = setTimeout(() => window.print(), 80);
    return () => { clearTimeout(t); window.removeEventListener('afterprint', done); };
  }, [printReq]);

  // Escape exits BOTH. In fullscreen the browser eats the Esc keydown and just drops
  // fullscreen, so fullscreenchange is what actually tears down the overlay; the
  // keydown path covers the case where fullscreen was denied.
  //
  // The first Esc belongs to the OPEN ANSWER, not to present mode — blowing the whole
  // board away mid-interview because someone closed an answer is the exact failure this
  // tab exists to prevent. Both handlers sit on `document`, so propagation can't
  // arbitrate; we defer on a ref the Board keeps current instead.
  useEffectI(() => {
    if (!present) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (answerOpenRef.current) return;   // the Board closes the answer; the board stays up
      exitPresent();
    };
    const onFs = () => { if (!document.fullscreenElement) setPresent(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      document.body.style.overflow = prev;
    };
  }, [present, exitPresent]);

  // Never strand the overlay if the tab unmounts mid-present.
  useEffectI(() => () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); }, []);

  const onMeasure = useCallbackI((m) => setFit(m), []);
  // A few rows of overshoot is survivable and not worth a warning: a full hm-round
  // board can overrun a 1266px viewport by ~135px (~4 rows) and still read fine.
  // Only warn once the scroll is deep enough to actually cost you mid-call.
  // ~300px is ~9 rows.
  const overshoot = fit ? fit.scrollHeight - fit.viewport : 0;
  const overflows = overshoot > FIT_TOLERANCE_PX;

  if (loading) return <div className="no-data" style={{ padding: 24 }}>Loading interview sessions…</div>;
  if (loadErr) return <div className="no-data" style={{ padding: 24 }}>{loadErr}</div>;

  const activeList = sessions.active || [];
  const archiveList = sessions.archive || [];

  return (
    <div className="col" style={{ gap: 0 }}>
      <style dangerouslySetInnerHTML={{ __html: BOARD_CSS + PREP_CSS + RAIL_CSS + HANDOFF_CSS + PRINT_CSS }} />

      {/* ── Picker: it is a 2-item list. No search, no table. ───────────────── */}
      <div className="col" style={{ gap: 8, marginBottom: 14 }}>
        {activeList.length === 0 ? (
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No interviews on deck</div>
            <div className="dim" style={{ fontSize: 12 }}>
              A row lands here once its tracker status reaches Phone Screen or beyond and it has a folder in <span className="mono">interview-prep/</span>.
            </div>
          </div>
        ) : activeList.map(s => (
          <div
            key={s.id}
            className={'focus-task' + (s.id === selId ? ' active' : '')}
            style={{ cursor: 'pointer' }}
            onClick={() => pickSession(s)}
          >
            <div className="focus-task-main">
              <div className="focus-task-label">{s.company}</div>
              <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{s.role}</div>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {window.StatusPill ? <window.StatusPill status={s.status} size="sm" /> : <span className="pill mono">{s.status}</span>}
            </div>
          </div>
        ))}

        {archiveList.length > 0 && (
          <>
            <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setShowArchive(a => !a)}>
              {showArchive ? '▾' : '▸'} Archive ({archiveList.length})
            </button>
            {showArchive && archiveList.map(s => (
              <div key={s.id} className={'focus-task' + (s.id === selId ? ' active' : '')}
                style={{ cursor: 'pointer', opacity: 0.75 }} onClick={() => pickSession(s)}>
                <div className="focus-task-main">
                  <div className="focus-task-label">{s.company}</div>
                  <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{s.role}</div>
                </div>
                <span className="pill mono" style={{ fontSize: 10.5 }}>{s.status || 'archived'}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {session && (
        <>
          {/* ── Header: BOTH the round and the stage. They agree by coincidence. ── */}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap', gap: 10 }}>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{session.company}</h1>
              {/* A company document is not a round, so the header must stop
                  reporting the round that happens to be selected behind it. */}
              <div className="dim mono" style={{ fontSize: 11, marginTop: 3 }}>
                {selDoc ? (
                  <>
                    <strong style={{ color: 'var(--text)' }}>
                      {(docMeta && docMeta.label) || 'Document'}
                    </strong>
                    {' · company-level'}
                  </>
                ) : (
                  <>
                    {selRound != null ? <strong style={{ color: 'var(--text)' }}>Round {selRound}</strong> : 'No rounds on disk'}
                    {roundMeta && roundMeta.stage ? <> · <strong style={{ color: 'var(--text)' }}>{roundMeta.stage}</strong></> : null}
                    {roundMeta && roundMeta.descriptor ? ' · ' + roundMeta.descriptor : ''}
                  </>
                )}
                {' · '}{session.role}
              </div>
            </div>
            <button
              className="btn accent sm"
              disabled={!boardReady || !!selDoc}
              onClick={enterPresent}
              title={
                selDoc ? 'Documents have no board. Pick a round to present.'
                  : boardReady ? 'Full-screen board over all app chrome (Esc exits)'
                    : 'This round has no live board on disk'
              }
            >⛶ Present</button>
          </div>

          {/* ── Round chips ─────────────────────────────────────────────────── */}
          <div className="filterbar" style={{ marginBottom: 12 }}>
            {rounds.map(r => {
              const live = !!(r.runPath || r.hasBoard);
              return (
                <span
                  key={r.round}
                  className={'chip' + (r.round === selRound && !selDoc ? ' on' : '')}
                  onClick={() => pickRound(r.round)}
                  title={r.descriptor || r.stage || ''}
                >
                  Round {r.round}
                  <span className="dim" style={{ marginLeft: 6, fontSize: 10 }}>{live ? 'Live' : 'Prep only'}</span>
                </span>
              );
            })}

            {/* Company-level documents: the intel report and the cheat sheet. These
                sit in the same folder as the rounds but carry no round number, so
                for as long as the tab only matched `-round-N-` filenames they were
                on disk and unreachable. They are chips beside the rounds, not
                rounds, because they describe the company rather than one call. */}
            {(session.docs || []).map(d => (
              <span
                key={d.key}
                className={'chip' + (selDoc === d.key ? ' on' : '')}
                onClick={() => pickDoc(d.key)}
                title={d.title || d.name}
              >
                {d.label}
                <span className="dim" style={{ marginLeft: 6, fontSize: 10 }}>doc</span>
              </span>
            ))}
            {/* The only entry point for a round that does not exist yet. Without it
                the tab is a viewer: a round with no prep file is invisible, so there
                is nothing to click. */}
            <span
              className={'chip' + (newRound ? ' on' : '')}
              onClick={() => setNewRound(n => (n ? null : { round: String(nextRoundNumber(rounds)), descriptor: '' }))}
              title="Get the prompt that starts a round that isn't on disk yet"
            >+ New round</span>
          </div>

          {/* ── New round: prompt only, nothing is written ────────────────────
              The dashboard cannot create a round: the prep file is generative
              work. It vends the command and gets out of the way. */}
          {newRound && (() => {
            const n = parseInt(newRound.round, 10);
            const valid = Number.isFinite(n) && n > 0;
            const desc = newRound.descriptor.trim();
            // Prep filenames embed the descriptor ({slug}-round-N-{descriptor}.md), so
            // "round N exists" does NOT mean this prompt rewrites it. A DIFFERENT
            // descriptor writes a SECOND round-N file: the chips then collide on
            // key={r.round} and rounds.find() only ever reaches the first, so the new
            // file is invisible. Say which case they are in, and default to rewriting.
            const hit = valid ? rounds.find(r => r.round === n) : null;
            const rewrites = hit && (!desc || desc === hit.descriptor);
            // With no descriptor typed, send the existing one so a rewrite is explicit
            // rather than depending on the mode re-deriving the same slug.
            const emitDesc = desc || (hit ? hit.descriptor : '');
            return (
              <div className="card" style={{ padding: 14, marginBottom: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Start a new round</div>
                <div className="row" style={{ gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
                  <label className="col" style={{ gap: 4, width: 92 }}>
                    <span className="dim" style={{ fontSize: 11 }}>Round</span>
                    <input
                      className="inp" type="number" min="1" value={newRound.round}
                      onChange={e => setNewRound(v => ({ ...v, round: e.target.value }))}
                    />
                  </label>
                  <label className="col" style={{ gap: 4, flex: '1 1 220px' }}>
                    <span className="dim" style={{ fontSize: 11 }}>Descriptor <span style={{ opacity: 0.6 }}>(optional)</span></span>
                    <input
                      className="inp" type="text" placeholder="final-loop, panel, hm…"
                      value={newRound.descriptor}
                      onChange={e => setNewRound(v => ({ ...v, descriptor: e.target.value }))}
                    />
                  </label>
                </div>
                {!valid ? (
                  <div className="dim" style={{ fontSize: 12 }}>Enter a round number.</div>
                ) : (
                  <PromptHandoff
                    prompt={interviewPrepCmd(session.company, n, emitDesc)}
                    note={
                      !hit
                        ? 'Run this in your Claude Code, then refresh this tab. Nothing exists here until it writes the prep file.'
                        : rewrites
                          ? `Round ${n} already exists as "${hit.descriptor}". This REWRITES that prep file. Run it in your Claude Code, then refresh.`
                          : `⚠ Round ${n} already exists as "${hit.descriptor}". A different descriptor writes a SECOND round-${n} file instead of replacing it, and only one of them will show up here. Use "${hit.descriptor}" to rewrite, or pick an unused round number.`
                    }
                  />
                )}
              </div>
            );
          })()}

          {/* No rounds on disk at all: the company folder exists (an intel report put it
              there) but nothing has been prepped yet. There is no round to select, so
              loadRound is never called and `entry` stays undefined forever — without this
              guard both subtabs would sit on "Loading…" for good. This is the documented
              FIRST state of any company, and the exact state "+ New round" exists for. */}
          {/* ── A company document ────────────────────────────────────────────
              Same three-tier render as a round's prep sheet, minus the subtabs:
              a document describes the company, so there is no board to switch to. */}
          {selDoc ? (
            !docEntry ? <div className="no-data">Loading document…</div>
              : docEntry.docErr ? <div className="no-data">{docEntry.docErr}</div>
                : docParsed
                  ? <PrepDoc doc={docParsed} actions={<PrintMenu onPick={askPrint} cram={cramAvailable} />} />
                  : docEntry.doc && docEntry.doc.html
                    ? <div className="ib-prep" dangerouslySetInnerHTML={{ __html: docEntry.doc.html }} />
                    : <PrepProse markdown={(docEntry.doc && docEntry.doc.markdown) || ''} />
          ) : selRound == null ? (
            <div className="no-data" style={{ padding: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>No rounds prepped yet</div>
              <div className="dim" style={{ fontSize: 12 }}>
                {session.company} has no prep files on disk. Hit <strong>+ New round</strong> above to get
                the command that writes one.
              </div>
            </div>
          ) : (
          <>
          <div className="subtabs">
            {IV_SUBTABS.map(s => (
              <div key={s.id} className={'subtab' + (sub === s.id ? ' active' : '')} onClick={() => setSub(s.id)}>{s.label}</div>
            ))}
          </div>

          {/* ── Prep ──────────────────────────────────────────────────────────
              Three renders, best first. PrepDoc needs the § grammar AND the server
              HTML; a legacy prep file with no § headings still gets the flat server
              render; and PrepProse stays the last resort for the case where
              reportMdToHtml threw and only { markdown } came back. */}
          {sub === 'prep' && (
            !entry ? <div className="no-data">Loading prep sheet…</div>
              : entry.prepErr ? <div className="no-data">{entry.prepErr}</div>
                : prepDoc
                  ? <PrepDoc doc={prepDoc} actions={<PrintMenu onPick={askPrint} cram={cramAvailable} />} />
                  : entry.prep && entry.prep.html
                    ? <div className="ib-prep" dangerouslySetInnerHTML={{ __html: entry.prep.html }} />
                    : <PrepProse markdown={(entry.prep && entry.prep.markdown) || ''} />
          )}

          {/* ── Live ────────────────────────────────────────────────────────── */}
          {sub === 'live' && (
            !entry ? <div className="no-data">Loading board…</div>
              : entry.runErr ? (
                /* Prep on disk, no board. The old copy sent people to
                   `/trajecktory cheat-sheet`, which is wrong twice: cheat-sheet
                   knows nothing about run sheets, and it emits a different artifact
                   (a compact skim doc). `runsheet` is the mode that compiles the
                   .run.md sidecar this tab renders. */
                <div className="card" style={{ padding: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>No live board for this round</div>
                  <PromptHandoff
                    prompt={runsheetCmd(session.company, selRound)}
                    note={`${entry.runErr} The board compiles from this round's prep file. Run this in your Claude Code, then reload.`}
                  />
                </div>
              ) : boardReady ? (
                /* Board full-bleed, rail underneath. The board is the product; a 50/50
                   split squeezed it to ~633px where every row wraps and it read nothing
                   like the real thing. The rail is reference material you read BEFORE the
                   call, so it costs nothing below the fold. */
                <div className="col" style={{ gap: 12 }}>
                  <div>
                    {overflows && (
                      <div className="card" style={{ padding: 12, marginBottom: 10, borderColor: 'var(--orange)' }}>
                        <div style={{ fontSize: 12.5, color: 'var(--orange)', lineHeight: 1.5 }}>
                          ⚠ <strong>This board overruns the screen by {overshoot}px</strong> (~{Math.round(overshoot / 33)} rows,
                          {' '}{fit.scrollHeight}px vs {fit.viewport}px). That is enough scrolling to lose your place mid-call.
                          <strong> Cut cues</strong> — 17px is the floor, the type does not shrink.
                        </div>
                      </div>
                    )}
                    {/* Unmounted while presenting: a second Board would put a duplicate
                        set of document keydown/click listeners behind the overlay and
                        fight the real one over the Esc contract. */}
                    {present ? (
                      <div className="no-data" style={{ padding: 24 }}>Presenting — press Esc to come back.</div>
                    ) : (
                      <Board
                        key={selId + ':' + selRound}
                        data={runData.data}
                        derived={runData}
                        cam={cam}
                        present={false}
                        openRef={answerOpenRef}
                      />
                    )}
                  </div>
                  {/* ProblemsPanel renders null unless the board is structurally broken.
                      Derived warnings are NOT repeated here: the board's own red panel
                      owns those, and it is the copy that survives into present mode. */}
                  <ProblemsPanel derived={runData} />
                  <DebriefPanel debrief={runData.debrief} />
                  <div className="ib-rail">
                    <CalibrationPanel cam={cam} setCam={setCam} />
                    <div className="card" style={{ padding: 12 }}>
                      <div className="dim" style={{ fontSize: 11, lineHeight: 1.5 }}>
                        <span className="mono">{(runData.data.sections || []).reduce((n, s) => n + (s.cues || []).length, 0)}</span> cues ·{' '}
                        <span className="mono">{Object.keys(runData.data.answers || {}).length}</span> answers ·{' '}
                        <span className="mono">{(runData.data.sections || []).length}</span> sections
                        {runData.heroKey ? <> · hero <span className="mono">{runData.heroKey}</span></> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ) : <div className="no-data">This round has no live board.</div>
          )}
          </>
          )}
        </>
      )}

      {/* ── FIT PREFLIGHT PROBE ──────────────────────────────────────────────
          The banner has to warn BEFORE the call, from inside the tab — but the
          in-tab board renders in a 50/50 split (~633px) where every row wraps, so
          measuring it over-reports by ~10x. Measure a hidden twin at real present
          geometry instead: portaled to <body>, full viewport, visibility:hidden so
          it costs layout but never paints, and measureOnly so it registers no
          listeners to fight the live board over Esc.                             */}
      {!present && boardReady && ReactDOM.createPortal(
        <div
          aria-hidden="true"
          style={{
            position: 'fixed', left: 0, top: 0, width: '100vw', height: '100vh',
            visibility: 'hidden', pointerEvents: 'none', zIndex: -1, overflow: 'hidden',
          }}
        >
          <div className="ib-present">
            <Board
              key={'probe:' + selId + ':' + selRound}
              data={runData.data}
              derived={runData}
              cam={cam}
              present
              measureOnly
              onMeasure={onMeasure}
            />
          </div>
        </div>,
        document.body
      )}

      {/* ── PRESENT MODE ─────────────────────────────────────────────────────
          Portaled to <body> so no transformed or overflowing ancestor can clip or
          contain it, fixed over the sidebar and topbar, plus real fullscreen.    */}
      {present && boardReady && ReactDOM.createPortal(
        <div className="ib-present">
          <button className="ib-exit" onClick={exitPresent}>esc</button>
          <Board
            data={runData.data}
            derived={runData}
            cam={cam}
            present
            openRef={answerOpenRef}
          />
        </div>,
        document.body
      )}

      {/* ── PRINT DOCUMENT ───────────────────────────────────────────────────
          Portaled to <body> so it is a SIBLING of the app root, which is what lets
          the print stylesheet hide the app with `body > *:not(.tjk-print-root)`
          instead of unwinding .content's overflow and the fixed chrome. It is
          display:none on screen, so mounting it disturbs nothing.               */}
      {printReq && shownDoc && ReactDOM.createPortal(
        <PrepPrintDoc
          doc={shownDoc}
          mode={printReq.mode}
          session={session}
          /* A company document has no round, so it must not print a round header
             borrowed from whatever round happened to be selected behind it. */
          roundMeta={selDoc ? null : roundMeta}
        />,
        document.body
      )}
    </div>
  );
};
