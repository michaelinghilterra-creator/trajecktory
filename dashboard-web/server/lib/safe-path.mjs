import path from 'path';
import { ROOT_DIR } from '../config.mjs';

// ── Containment for paths that come out of data files ────────────────────────
// A path read from applications.md is not request input, which is why it kept
// getting treated as trusted. It is not: that file is AGENT-written, and the same
// rule is already stated on the JD route ("a report is agent-written and
// therefore not trusted input either"). One poisoned row is a file-read
// primitive, and on the apply path the file it reads is then sent into a model
// prompt, so a read becomes an exfiltration.
//
// This lived as a local helper in the reports route first, and that is exactly
// how the gap survived: four MORE call sites in the apply flow read the same
// field through a different helper with no check at all. One implementation, so
// there is one place to be right.
//
// The trailing-separator comparison matters. A bare prefix test lets a sibling
// directory through: `reports-backup` starts with `reports` and is not inside it.
//
// WHERE A PATH RESOLVES FROM AND WHERE IT MUST LAND ARE TWO DIFFERENT THINGS, and
// collapsing them is a bug rather than a simplification. Tracker paths are
// REPO-relative ("reports/0001-x.md"), so they resolve from the repo root; the
// containment root is reports/. Resolve from the containment root instead and
// every real path doubles its prefix, which still passes a containment check
// while pointing at a file that does not exist. `resolveFrom` defaults to the
// containment root because that is right for the simple case.
export function resolveInside(containRootAbs, rel, { resolveFrom } = {}) {
  const raw = String(rel == null ? '' : rel);
  if (!raw.trim()) return null;
  const root = path.resolve(containRootAbs);
  const abs = path.resolve(resolveFrom ? path.resolve(resolveFrom) : root, raw);
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

// An evaluation report may only ever live under reports/, but its path is written
// repo-relative, so it resolves from the repo root.
const REPORTS_ROOT = path.resolve(ROOT_DIR, 'reports');
export function resolveReportPath(rel) {
  return resolveInside(REPORTS_ROOT, rel, { resolveFrom: ROOT_DIR });
}
