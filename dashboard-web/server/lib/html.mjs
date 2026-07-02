function mdToHtml(md) {
  return md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/^(?!<[h1-6bq])/, '<p>') + '</p>';
}

// Sanitize a URL for safe use inside a double-quoted HTML href attribute.
// Enforces a scheme allow-list (only http/https/mailto survive; javascript:,
// data:, vbscript:, and any other scheme collapse to '#') and escapes the
// characters that could break out of the attribute. Idempotent on & < > so it is
// safe whether the caller passes a raw URL or one whose entities were already
// escaped upstream (reportMdToHtml escapes the whole line before this runs).
function safeHref(url) {
  const raw = String(url ?? '').trim();
  if (!/^(?:https?:\/\/|mailto:)/i.test(raw)) return '#';
  return raw
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Full markdown-to-HTML converter for evaluation reports (supports tables, lists, hr)
function reportMdToHtml(md) {
  const inline = t => t
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => `<a href="${safeHref(url)}" target="_blank" rel="noreferrer">${text}</a>`);

  const lines = md.split('\n');
  const out = [];
  let tableRows = [], inTable = false;
  let listItems = [], inList = false, listTag = 'ul';

  const flushTable = () => {
    if (!tableRows.length) return;
    const dataRows = tableRows.filter(r => r !== null);
    if (dataRows.length < 1) { tableRows = []; inTable = false; return; }
    out.push('<table>');
    out.push('<thead><tr>' + dataRows[0].map(h => `<th>${h}</th>`).join('') + '</tr></thead>');
    if (dataRows.length > 1) {
      out.push('<tbody>');
      dataRows.slice(1).forEach(r => out.push('<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>'));
      out.push('</tbody>');
    }
    out.push('</table>');
    tableRows = []; inTable = false;
  };

  const flushList = () => {
    if (!listItems.length) return;
    out.push(`<${listTag}>` + listItems.map(i => `<li>${i}</li>`).join('') + `</${listTag}>`);
    listItems = []; inList = false; listTag = 'ul';
  };

  for (const line of lines) {
    const t = line.trim();
    if (/^\|.+\|$/.test(t)) {
      inTable = true;
      if (/^\|[-: |]+\|$/.test(t)) { tableRows.push(null); continue; }
      const cells = t.split('|').map(c => inline(c.trim())).filter((_, i, a) => i > 0 && i < a.length - 1);
      tableRows.push(cells);
      continue;
    }
    if (inTable) flushTable();

    if (/^[-*]\s+/.test(t)) {
      if (inList && listTag !== 'ul') flushList();
      inList = true; listTag = 'ul';
      listItems.push(inline(t.replace(/^[-*]\s+/, '')));
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      if (inList && listTag !== 'ol') flushList();
      inList = true; listTag = 'ol';
      listItems.push(inline(t.replace(/^\d+\.\s+/, '')));
      continue;
    }
    if (inList) flushList();

    if (!t)                   { out.push(''); continue; }
    if (/^---+$/.test(t))     { out.push('<hr>'); continue; }
    if (/^### /.test(t))      { out.push(`<h3>${inline(t.slice(4))}</h3>`); continue; }
    if (/^## /.test(t))       { out.push(`<h2>${inline(t.slice(3))}</h2>`); continue; }
    if (/^# /.test(t))        { out.push(`<h1>${inline(t.slice(2))}</h1>`); continue; }
    if (/^> /.test(t))        { out.push(`<blockquote>${inline(t.slice(2))}</blockquote>`); continue; }
    out.push(`<p>${inline(t)}</p>`);
  }
  if (inTable) flushTable();
  if (inList)  flushList();
  return out.join('\n');
}

// Escape a string for safe interpolation into HTML text/attribute contexts.
// Rendered markdown bodies are escaped by mdToHtml/reportMdToHtml; this guards
// the surrounding metadata (titles, file paths, error messages) that is
// interpolated raw into response HTML.
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function v1ToFallbackHtml(data) {
  const e = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const s = data.summary || {};
  const c = data.comp || {};
  const lg = data.legitimacy || {};
  const out = [];

  out.push(`<h1>${e(data.company)} — ${e(data.role)}</h1>`);

  // TL;DR callout
  if (s.tldr) {
    out.push(`<blockquote><strong>TL;DR:</strong> ${e(s.tldr)}</blockquote>`);
  }

  // Snapshot table
  out.push('<table><tbody>');
  if (s.archetypeDetected) out.push(`<tr><td><strong>Archetype</strong></td><td>${e(s.archetypeDetected)}</td></tr>`);
  if (data.domain)         out.push(`<tr><td><strong>Domain</strong></td><td>${e(data.domain)}</td></tr>`);
  if (s.seniority)         out.push(`<tr><td><strong>Seniority</strong></td><td>${e(s.seniority)}</td></tr>`);
  if (s.remote)            out.push(`<tr><td><strong>Remote</strong></td><td>${e(s.remote)}</td></tr>`);
  if (s.teamSize)          out.push(`<tr><td><strong>Team size</strong></td><td>${e(s.teamSize)}</td></tr>`);
  if (s.compStated || c.stated) out.push(`<tr><td><strong>Comp</strong></td><td>${e(s.compStated || c.stated)}</td></tr>`);
  if (data.url)            out.push(`<tr><td><strong>JD</strong></td><td><a href="${safeHref(data.url)}" target="_blank" rel="noreferrer">${e(data.url)}</a></td></tr>`);
  out.push('</tbody></table>');

  // Company brief
  if (s.companyBrief) {
    out.push(`<h2>Company</h2><p>${e(s.companyBrief)}</p>`);
  }

  // Recommendation
  if (data.recommendation) {
    out.push(`<h2>Recommendation</h2><p>${e(data.recommendation)}</p>`);
  }

  // CV Match
  if (Array.isArray(data.cvMatch) && data.cvMatch.length) {
    out.push('<h2>CV Match</h2><table><thead><tr><th>Requirement</th><th>Evidence</th><th>Strength</th></tr></thead><tbody>');
    data.cvMatch.forEach(m => {
      out.push(`<tr><td>${e(m.req)}</td><td>${e(m.evidence)}</td><td>${e(m.strength)}</td></tr>`);
    });
    out.push('</tbody></table>');
  }

  // Gaps
  if (Array.isArray(data.gaps) && data.gaps.length) {
    out.push('<h2>Gaps</h2><table><thead><tr><th>Gap</th><th>Blocker</th><th>Mitigation</th></tr></thead><tbody>');
    data.gaps.forEach(g => {
      out.push(`<tr><td>${e(g.gap)}</td><td>${e(g.blocker)}</td><td>${e(g.mitigation)}</td></tr>`);
    });
    out.push('</tbody></table>');
  }

  // Red flag Q&A
  if (Array.isArray(data.redFlagQs) && data.redFlagQs.length) {
    out.push('<h2>Red Flag Q&amp;A</h2><ul>');
    data.redFlagQs.forEach(r => {
      out.push(`<li><strong>${e(r.q)}</strong>${r.a ? ' — ' + e(r.a) : ''}</li>`);
    });
    out.push('</ul>');
  }

  // Legitimacy
  if (lg.tier) {
    out.push(`<h2>Legitimacy — ${e(lg.tier)}</h2>`);
    if (lg.conclusion) out.push(`<p>${e(lg.conclusion)}</p>`);
    if (Array.isArray(lg.signals) && lg.signals.length) {
      out.push('<ul>');
      lg.signals.forEach(sig => {
        const text = typeof sig === 'string' ? sig : `${sig.signal || ''}${sig.finding ? ' — ' + sig.finding : ''}`;
        out.push(`<li>${e(text)}</li>`);
      });
      out.push('</ul>');
    }
  }

  return out.join('\n');
}

export { mdToHtml, reportMdToHtml, escapeHtml, v1ToFallbackHtml };

