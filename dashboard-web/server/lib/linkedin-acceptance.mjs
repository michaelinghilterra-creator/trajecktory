// lib/linkedin-acceptance.mjs — detect LinkedIn INVITE ACCEPTANCE for TA contacts.
//
// A TA contact carries a LinkedIn axis (tt-linkedin.mjs): Not Connected → Invite
// Pending → Connected. Sending an invite auto-sets "Invite Pending"; the only way
// it becomes "Connected" today is the user hand-flipping a dropdown. But the
// LinkedIn Connections.csv the user already imports for Referrals is a fresh list
// of every 1st-degree connection — i.e. everyone who has accepted. This module
// diffs that list against the Invite-Pending set to detect acceptances:
//   - EXACT LinkedIn-URL (slug) match → auto-flip to Connected (reliable identity).
//   - name + company match but no slug → surfaced to the user to confirm, never
//     auto-flipped (a shared name must not silently mark the wrong person).
//
// The slug + name normalizers are shared with resolveReferralLink (routes/
// referrals.mjs) so a "same person" decision is made one way across the app.

import { readLinkedInMap, setLinkedInStatus } from './tt-linkedin.mjs';
import { parseTargetTalentMd } from './target-talent.mjs';
import { loadConnections } from './linkedin-referrals.mjs';
import { linkedinKey } from './contact-identity.mjs';

// Name/company normalizer: lowercase, alphanumerics only. Matches routes/referrals
// resolveReferralLink so twin-matching and acceptance-matching agree.
export const normName = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const _todayYmd = () => new Date().toISOString().slice(0, 10);

const _MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

// Parse LinkedIn's "Connected On" cell (e.g. "18 May 2023" or "May 18, 2023") to
// YYYY-MM-DD. Returns null on anything unrecognized so the caller can fall back.
export function parseConnectedOn(on) {
  const s = String(on || '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);            // 18 May 2023
  if (m) { const mo = _MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, '0')}`; }
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{4})$/);              // May 18, 2023
  if (m) { const mo = _MONTHS[m[1].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${mo}-${m[2].padStart(2, '0')}`; }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function _pendingContacts(taRows) {
  const ta = taRows ?? parseTargetTalentMd();
  const liMap = readLinkedInMap();
  return ta.filter(t => (liMap[String(t.id)]?.state) === 'Invite Pending');
}

// Auto-flip Invite-Pending contacts to Connected on an EXACT slug match against the
// freshly imported connections. Writes the LinkedIn axis, stamping the acceptance
// date from the connection's "Connected On" (fallback: today). Returns the flips.
export function detectAcceptances({ connections, taRows } = {}) {
  const pending = _pendingContacts(taRows);
  if (!pending.length) return { flipped: [] };
  const conns = connections ?? (loadConnections().connections || []);
  const bySlug = new Map();
  for (const c of conns) { const s = linkedinKey(c.url); if (s && !bySlug.has(s)) bySlug.set(s, c); }
  const flipped = [];
  for (const t of pending) {
    const s = linkedinKey(t.linkedin);
    if (!s) continue;
    const c = bySlug.get(s);
    if (!c) continue;
    const date = parseConnectedOn(c.on) || _todayYmd();
    setLinkedInStatus(t.id, 'Connected', date);
    flipped.push({ id: t.id, name: `${t.first || ''} ${t.last || ''}`.trim(), company: t.company || '', date });
  }
  return { flipped };
}

// Derived (recomputable, survives reload): Invite-Pending contacts that match an
// imported connection by NAME + COMPANY but NOT by slug. These are the "looks
// accepted — confirm?" candidates. Reads the stored connections haystack, so it
// stays accurate between imports. Never writes.
export function computePendingAcceptances({ taRows } = {}) {
  const pending = _pendingContacts(taRows);
  if (!pending.length) return [];
  const connections = loadConnections().connections || [];
  const bySlug = new Set();
  const byNameCo = new Map();
  for (const c of connections) {
    const s = linkedinKey(c.url); if (s) bySlug.add(s);
    const key = `${normName(`${c.first} ${c.last}`)}|${normName(c.company)}`;
    if (!byNameCo.has(key)) byNameCo.set(key, c);
  }
  const out = [];
  for (const t of pending) {
    const s = linkedinKey(t.linkedin);
    if (s && bySlug.has(s)) continue;                 // slug hit → auto-flipped, not a confirm case
    const nn = normName(`${t.first} ${t.last}`);
    if (nn.length < 4) continue;
    const c = byNameCo.get(`${nn}|${normName(t.company)}`);
    if (c) out.push({ id: t.id, name: `${t.first || ''} ${t.last || ''}`.trim(), company: t.company || '', connectedOn: parseConnectedOn(c.on) });
  }
  return out;
}
