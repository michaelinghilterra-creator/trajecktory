const RECRUITER_PATTERN = /\b(recruiter|recruiting|talent acquisition|talent partner|sourcer|ta partner|hr generalist|people partner)\b/;
const MANAGER_PATTERN = /\b(hiring manager|panel|director|vice president|vp|head of|chief|manager|lead)\b/;

export function proposeStageFromRole(roleText) {
  const text = typeof roleText === 'string' ? roleText.toLowerCase().trim() : '';
  const recruiter = text.match(RECRUITER_PATTERN);
  const panel = /\bpanel\b/.test(text);
  if (recruiter && panel) return { stage: null, matched: null, needs_owner: true };
  if (recruiter) return { stage: 'Phone Screen', matched: recruiter[0], needs_owner: false };
  const manager = text.match(MANAGER_PATTERN);
  if (manager) return { stage: 'Interview', matched: manager[0], needs_owner: false };
  return { stage: null, matched: null, needs_owner: true };
}

export function findRoleLine(text) {
  if (typeof text !== 'string' || text.trim() === '') return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '').slice(-8);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.length <= 80 && (RECRUITER_PATTERN.test(line.toLowerCase()) || MANAGER_PATTERN.test(line.toLowerCase()))) return line;
  }
  return null;
}

export function proposeStageFromMessage(text) {
  const role_line = findRoleLine(text);
  return { role_line, ...proposeStageFromRole(role_line) };
}
