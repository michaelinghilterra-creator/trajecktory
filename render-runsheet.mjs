#!/usr/bin/env node
// render-runsheet.mjs - compile a runsheet-v1 sidecar into the standalone live board.
//
//   node render-runsheet.mjs "interview-prep/Example Co/example-co-round-1-screen.run.md"
//   node render-runsheet.mjs <in.run.md> -o <out.html>
//
// The board is the proven artifact: two columns, no scroll, a fixed answer overlay
// parked under the webcam. Spec: templates/runsheet-schema-v1.md
//
// Everything in the "Derived" table of the spec is computed HERE, never authored:
// collisions, the "use once" suffix, hero integrity, cue labels.

import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_ID = 'trajecktory-runsheet/v1';

// ---------------------------------------------------------------- load + parse
export function parseRunsheet(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('No JSON frontmatter found (expected --- ... --- at the top).');
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (err) {
    // Keep the parser's own error as `cause`: the message below names the file's
    // problem, but the position info that says WHERE the JSON broke lives on the
    // original SyntaxError, and dropping it makes a malformed sidecar harder to fix.
    throw new Error(`Frontmatter is not valid JSON: ${err.message}`, { cause: err });
  }
  // Exact match, never a regex. A v2 file must not be fed to the v1 renderer.
  if (data.schema !== SCHEMA_ID) {
    throw new Error(`Expected schema "${SCHEMA_ID}", got "${data.schema}".`);
  }
  return { data, body: m[2] || '' };
}

// ------------------------------------------------------------------- derivation
export function derive(d) {
  const answers = d.answers || {};
  const sections = d.sections || [];
  const cues = sections.flatMap(s => (s.cues || []).map(c => ({ ...c, section: s.id })));

  const problems = [];
  for (const c of cues) {
    if (!answers[c.answer]) problems.push(`Cue "${c.cue}" points at missing answer "${c.answer}".`);
  }

  // Collisions group by STORY, not by answer key: two different keys can tell one
  // story from two angles, and key-level dedupe is blind to exactly that.
  const heroKey = Object.keys(answers).find(k => answers[k].hero);
  const heroStory = heroKey ? answers[heroKey].story : null;

  const rowsByStory = new Map();
  for (const c of cues) {
    const story = answers[c.answer]?.story;
    if (story == null) continue;
    if (!rowsByStory.has(story)) rowsByStory.set(story, []);
    rowsByStory.get(story).push(c);
  }

  const warnings = [];
  const collidingKeys = new Set();
  for (const [story, rows] of rowsByStory) {
    // The hero's story is owned by the hero-integrity rule below. Counting it here
    // too would double-report it.
    if (story === heroStory) continue;
    if (rows.length < 2) continue;
    const keys = [...new Set(rows.map(r => r.answer))];
    keys.forEach(k => collidingKeys.add(k));
    const titles = keys.map(k => answers[k].title).join(' / ');
    warnings.push(
      `Story #${story} is reachable from ${rows.length} cues (${titles}). Tell it ONCE.`
    );
  }

  // Hero integrity: a hero reachable from outside its own section is the "I already
  // spent the hero on a behavioral" failure.
  const heroes = Object.keys(answers).filter(k => answers[k].hero);
  if (heroes.length > 1) problems.push(`${heroes.length} answers set hero:true. Only one is allowed.`);
  if (heroStory != null) {
    const strays = cues.filter(c => c.answer !== heroKey && answers[c.answer]?.story === heroStory);
    for (const s of strays) {
      warnings.push(
        `"${s.cue}" shares the HERO's story (#${heroStory}). Using it burns the hero. Prefer another story.`
      );
      collidingKeys.add(s.answer);
    }
  }

  return { cues, warnings, problems, collidingKeys, heroKey };
}

// ------------------------------------------------------------------------- html
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// **bold** -> <b>. Escape first, so authored text can never inject markup.
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

function buildBoard(d, der) {
  const { cues, warnings, collidingKeys, heroKey } = der;
  const answers = d.answers || {};

  // Split sections into two columns, balanced by cue count, order preserved.
  const secs = d.sections || [];
  const total = secs.reduce((n, s) => n + (s.cues || []).length, 0);
  const col1 = [], col2 = [];
  let run = 0;
  for (const s of secs) {
    (run < total / 2 ? col1 : col2).push(s);
    run += (s.cues || []).length;
  }

  const rowHtml = c => {
    const a = answers[c.answer] || {};
    const label = c.label || a.title || c.answer;
    return `      <div class="row" data-k="${esc(c.answer)}"><div class="cue">${esc(c.cue)}</div>` +
           `<span class="arw">&rarr;</span><div class="to">${esc(label)}</div></div>`;
  };

  const secHtml = s => {
    const cls = 'panel' + (s.style ? ' ' + s.style : '') + (s.cameraGap ? ' camgap' : '');
    const title = (s.n ? s.n + ' &middot; ' : '') + esc(s.title);
    return `    <section class="${cls}">\n      <h2>${title}</h2>\n` +
           (s.cues || []).map(rowHtml).join('\n') + `\n    </section>`;
  };

  const guardrails = [
    ...warnings.map(w => `<div class="norow derived">${esc(w)}</div>`),
    ...(d.guardrails || []).map(g => `<div class="norow">${esc(g)}</div>`),
  ].join('\n      ');

  const rulesPanel = guardrails
    ? `    <section class="panel rules">\n      <h2>Use once / do not get wrong</h2>\n      ${guardrails}\n    </section>`
    : '';

  // The answer payload. Bold is resolved here; the page never touches innerHTML
  // with authored strings beyond this compiled output.
  const S = {};
  for (const [k, a] of Object.entries(answers)) {
    const useOnce = a.useOnce || collidingKeys.has(k);
    const tagBits = [a.tag, useOnce ? 'use once' : null].filter(Boolean);
    S[k] = {
      t: a.title || k,
      g: tagBits.join(' &middot; '),
      p: (a.spoken || []).map(md),
      n: (a.notes || []).map(md),
      hero: !!a.hero,
    };
  }

  const s = d.session || {};
  const when = s.when ? new Date(s.when) : null;
  const whenTxt = when && !isNaN(when)
    ? when.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit' }) + (s.minutes ? ` &middot; ${s.minutes} min` : '')
    : (s.minutes ? `${s.minutes} min` : '');

  return { col1, col2, secHtml, rulesPanel, S, whenTxt, heroKey };
}

export function render(d, der) {
  const { col1, col2, secHtml, rulesPanel, S, whenTxt } = buildBoard(d, der);
  const s = d.session || {};
  const head = [d.company, s.who ? s.who : null, d.role].filter(Boolean).join(' &middot; ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.company)} &middot; Live Board</title>
<style>
  :root{
    /* Camera calibration. Bigger --box-top = answer box sits lower. */
    --box-top: 34vh;
    --camera-gap: 80px;
    --bg:#f4f5f7; --panel:#fff; --ink:#16181d; --muted:#6b7280; --line:#e0e2e7;
    --accent:#0a7d46; --hero:#8a4b00; --danger:#b0182b; --tint:#eef7f2; --hi:#fff6e0;
  }
  @media (prefers-color-scheme: dark){
    :root{ --bg:#12141a; --panel:#1b1e26; --ink:#e8eaee; --muted:#9aa3b2; --line:#2c313c;
           --accent:#4ade9a; --hero:#f0b866; --danger:#ff7b8a; --tint:#16241d; --hi:#2a2417; }
  }
  *{box-sizing:border-box;}
  body{margin:0;padding:16px;background:var(--bg);color:var(--ink);
       font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.4;}
  header{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
         padding:0 4px 10px;flex-wrap:wrap;}
  h1{font-size:20px;margin:0;}
  header .when{font-size:15.5px;color:var(--muted);}
  header .rule{font-size:15.5px;color:var(--accent);font-weight:700;}
  #detail{position:fixed;top:var(--box-top);left:16px;right:16px;z-index:50;
          background:var(--panel);border:2px solid var(--accent);border-radius:12px;
          padding:14px 20px 16px;box-shadow:0 14px 50px rgba(0,0,0,.5);
          max-height:56vh;display:none;flex-direction:column;}
  #detail.on{display:flex;}
  #detail .dhead{display:flex;justify-content:space-between;align-items:baseline;gap:14px;
                 margin-bottom:9px;padding-bottom:7px;border-bottom:1px solid var(--line);}
  #detail h3{margin:0;font-size:21px;color:var(--accent);}
  #detail .tag{font-size:12.5px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;
               color:var(--hero);white-space:nowrap;margin-left:auto;}
  #detail .close{font-size:13.5px;color:var(--muted);cursor:pointer;user-select:none;}
  #detail .close:hover{color:var(--danger);}
  .dbody{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:26px;overflow-y:auto;}
  @media (max-width:1100px){ .dbody{grid-template-columns:1fr;} }
  .spoken p{font-size:17.5px;line-height:1.56;margin:0 0 11px;}
  .spoken p:last-child{margin-bottom:0;}
  .spoken b{color:var(--accent);}
  .dnotes{border-left:2px solid var(--line);padding-left:18px;}
  .dnotes h4{font-size:11px;letter-spacing:.11em;text-transform:uppercase;color:var(--hero);
             margin:0 0 7px;font-weight:800;}
  .dnotes ul{margin:0;padding-left:16px;}
  .dnotes li{font-size:14px;color:var(--muted);margin:5px 0;}
  .dnotes li b{color:var(--danger);}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start;}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:10px;
         padding:11px 15px 12px;margin:0 0 13px;}
  .panel:last-child{margin-bottom:0;}
  .camgap{margin-top:var(--camera-gap);}
  .panel h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);
            margin:0 0 7px;font-weight:800;}
  .row{display:flex;gap:9px;padding:4px 7px;font-size:17px;border-bottom:1px dotted var(--line);
       cursor:pointer;border-radius:5px;transition:background .08s;}
  .row:last-child{border-bottom:none;}
  .row:hover{background:var(--tint);}
  .row.active{background:var(--hi);outline:2px solid var(--hero);}
  .row.spent{opacity:.4;}
  .row.spent .to::after{content:" &check; told";color:var(--danger);font-size:12px;}
  .cue{flex:1 1 52%;color:var(--muted);}
  .to{flex:1 1 48%;font-weight:700;}
  .arw{color:var(--accent);font-weight:800;}
  .panel.hero{border-color:var(--hero);}
  .panel.hero h2{color:var(--hero);}
  .panel.panic{border-color:var(--accent);border-width:2px;background:var(--tint);}
  .panel.rules h2{color:var(--danger);}
  .panel.rules .norow{color:var(--danger);font-size:16px;font-weight:600;
                      padding:5px 0;border-bottom:1px dotted var(--line);}
  .panel.rules .norow:last-child{border-bottom:none;}
  .panel.rules .norow.derived{color:var(--hero);}
  .panel.rules .norow.derived::before{content:"&#9888; ";}
</style>
</head>
<body>

<header>
  <h1>${head}</h1>
  <div class="when">${whenTxt}${d.stage ? ' &middot; ' + esc(d.stage) : ''}${d.round ? ' &middot; Round ' + d.round : ''}</div>
  <div class="rule">${esc(s.rule || 'One story per job. Click a cue. Eyes up.')}</div>
</header>

<div id="detail"></div>

<div class="cols">
  <div>
${col1.map(secHtml).join('\n\n')}
  </div>
  <div>
${col2.map(secHtml).join('\n\n')}
${rulesPanel ? '\n' + rulesPanel : ''}
  </div>
</div>

<script>
const S = ${JSON.stringify(S, null, 1)};
const detail = document.getElementById('detail');
let activeRow = null, openedAt = 0;

function markSpent(key){
  // Dwell, not click: an accidental tap is not "I told that story".
  if(!openedAt || Date.now() - openedAt < 8000) return;
  document.querySelectorAll('.row[data-k="'+key+'"]').forEach(r => r.classList.add('spent'));
}
function clearDetail(){
  if(activeRow){ markSpent(activeRow.dataset.k); activeRow.classList.remove('active'); activeRow = null; }
  openedAt = 0;
  detail.classList.remove('on');
  detail.innerHTML = '';
}
function show(key, rowEl){
  const s = S[key];
  if(!s) return;
  if(activeRow === rowEl){ clearDetail(); return; }
  if(activeRow){ markSpent(activeRow.dataset.k); activeRow.classList.remove('active'); }
  rowEl.classList.add('active');
  activeRow = rowEl; openedAt = Date.now();
  detail.classList.add('on');
  const notes = s.n && s.n.length
    ? '<aside class="dnotes"><h4>Delivery</h4><ul>' + s.n.map(x => '<li>'+x+'</li>').join('') + '</ul></aside>'
    : '';
  detail.innerHTML =
    '<div class="dhead"><h3>'+s.t+'</h3><span class="tag">'+(s.g||'')+'</span>' +
    '<span class="close" id="x">clear &#10005;</span></div>' +
    '<div class="dbody"><div class="spoken">' + s.p.map(x => '<p>'+x+'</p>').join('') + '</div>' + notes + '</div>';
  document.getElementById('x').addEventListener('click', clearDetail);
}
document.querySelectorAll('.row[data-k]').forEach(r => {
  r.addEventListener('click', () => show(r.dataset.k, r));
});
document.addEventListener('keydown', e => { if(e.key === 'Escape') clearDetail(); });
document.addEventListener('click', e => {
  if(!detail.contains(e.target) && !e.target.closest('.row[data-k]')) clearDetail();
});
</script>
</body>
</html>
`;
}

// ------------------------------------------------------------------------- main
const isMain = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMain) {
  const args = process.argv.slice(2);
  const src = args.find(a => !a.startsWith('-'));
  if (!src) {
    console.error('usage: node render-runsheet.mjs <file.run.md> [-o out.html]');
    process.exit(1);
  }
  const oIdx = args.indexOf('-o');
  const out = oIdx >= 0 ? args[oIdx + 1] : src.replace(/\.run\.md$/, '.board.html');

  const { data } = parseRunsheet(fs.readFileSync(src, 'utf8'));
  const der = derive(data);

  if (der.problems.length) {
    console.error('BLOCKING:');
    der.problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
  }

  fs.writeFileSync(out, render(data, der));

  const cueCount = der.cues.length;
  console.log(`${data.company} · ${data.stage} · round ${data.round} · template ${data.template}`);
  console.log(`${cueCount} cues · ${Object.keys(data.answers).length} answers · ${data.sections.length} sections`);
  if (cueCount > 48) console.log(`  ! ${cueCount} cues exceeds the 48 cap. It will scroll.`);
  der.warnings.forEach(w => console.log('  ⚠ ' + w));
  console.log(`\n-> ${out}`);
}
