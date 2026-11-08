import { buildDecidedIndex, findDecided } from './identity.mjs';
import { buildSimilarityIndex, findSimilarText } from './jd-similarity.mjs';

// Lives for the life of the dashboard process so only the first paste pays for
// reading every snapshot.
const snapshotCache = new Map();

export function checkSelfDuplicate({ url, jd } = {}, { appsPath, rootDir } = {}) {
  try {
    const cleanUrl = typeof url === 'string' ? url.trim() : '';
    const cleanJd = typeof jd === 'string' ? jd.trim() : '';

    if (/^https?:\/\/\S+$/i.test(cleanUrl)) {
      const hit = findDecided(buildDecidedIndex({ appsPath, rootDir }), cleanUrl);
      if (hit) {
        return {
          kind: 'decided',
          num: hit.num,
          status: hit.status,
          company: hit.company || '',
          role: hit.role || '',
          similarity: 1,
          message: `Already evaluated as #${hit.num} (${hit.status}). Press Evaluate again to run it anyway.`,
        };
      }
    }

    if (cleanJd) {
      const index = buildSimilarityIndex({ appsPath, rootDir, allCompanies: true, cache: snapshotCache });
      const hit = findSimilarText(index, { text: cleanJd, url: cleanUrl, rootDir });
      if (hit) {
        return {
          kind: 'similar',
          num: hit.num,
          status: hit.status,
          company: hit.company,
          role: hit.role,
          similarity: hit.similarity,
          message: `Looks like a repost of #${hit.num} (${hit.status}), ${Math.round(hit.similarity * 100)}% alike. Press Evaluate again to run it anyway.`,
        };
      }
    }
  } catch {
    return null;
  }
  return null;
}
