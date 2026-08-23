import { normalizeCompany } from '../../../lib/identity.mjs';
import { nameTokens } from './contact-identity.mjs';

const storeOf = ref => String(ref || '').split(':')[0];

function crossStoreRefs(left, right) {
  for (const a of left.refs || []) {
    for (const b of right.refs || []) {
      if (storeOf(a) !== storeOf(b)) return { a, b };
    }
  }
  return null;
}

export function suggestMerges(people = []) {
  const suggestions = [];
  for (let i = 0; i < people.length; i++) {
    const left = people[i];
    if (left?.matchedBy === 'pin' && left?.refs?.length === 1) continue;
    const company = normalizeCompany(left?.company);
    if (!company) continue;
    const tokens = new Set(nameTokens(left?.name).filter(token => token.length > 2));
    if (!tokens.size) continue;

    for (let j = i + 1; j < people.length; j++) {
      const right = people[j];
      if (right?.matchedBy === 'pin' && right?.refs?.length === 1) continue;
      if (normalizeCompany(right?.company) !== company) continue;
      if (!nameTokens(right?.name).some(token => token.length > 2 && tokens.has(token))) continue;
      const refs = crossStoreRefs(left, right);
      if (!refs) continue;
      suggestions.push({ ...refs, reason: 'Same company, and they share a name.', confidence: 'low' });
    }
  }
  return suggestions;
}
