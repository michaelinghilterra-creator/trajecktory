// InMail budget. LinkedIn Premium gives a small monthly allotment of InMail
// credits (default 15) for messaging people OUTSIDE your network. Connection
// requests are free and unlimited and never touch this.
//
// We track a REMAINING count that auto-resets each month and that the user can
// reconcile against LinkedIn's real balance at any time. An exact ledger is
// impossible: LinkedIn refunds an InMail when the recipient replies within 90
// days, and unused credits roll over month to month up to a cap. So this count
// is a close, correctable estimate, not truth. The reconcile ("set to N") is how
// the real balance re-enters the system when the two drift.
import fs from 'fs';
import path from 'path';
import { DATA_DIR } from '../config.mjs';

// DATA_DIR, never ROOT_DIR + 'data'. See tests/data-dir-sandbox.test.mjs.
const FILE = path.join(DATA_DIR, 'inmail-usage.json');
const ALLOTMENT = 15;   // LinkedIn Premium monthly default
const CAP = 99;         // generous ceiling for reconcile (rollover accumulates)

const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const today = () => new Date().toISOString().slice(0, 10);

function read() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; } }
function write(o) { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(o, null, 2)); } catch { /* best effort */ } }

// Read the budget, auto-resetting to the monthly allotment when the month rolls.
// Reset-on-the-first is billing-cycle-agnostic on purpose: the reconcile absorbs
// whatever LinkedIn's real cycle and rollover produce.
export function getInmailBudget() {
  const period = thisMonth();
  let raw = read();
  if (!raw || raw.period !== period) {
    raw = { remaining: ALLOTMENT, period, updatedAt: today() };
    write(raw);
  }
  const remaining = Math.max(0, Math.min(CAP, Number(raw.remaining) || 0));
  return { remaining, allotment: ALLOTMENT, period };
}

// Spend one credit (marking an InMail follow-up sent to a non-connection).
export function decrementInmail() {
  const b = getInmailBudget();
  write({ remaining: Math.max(0, b.remaining - 1), period: b.period, updatedAt: today() });
  return getInmailBudget();
}

// Reconcile to LinkedIn's real number.
export function setInmailRemaining(n) {
  const b = getInmailBudget();
  const val = Math.floor(Number(n));
  if (!Number.isFinite(val)) return b;
  write({ remaining: Math.max(0, Math.min(CAP, val)), period: b.period, updatedAt: today() });
  return getInmailBudget();
}
