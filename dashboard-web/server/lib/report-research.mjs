import fs from 'fs';
import { resolveReportPath } from './safe-path.mjs';
import { hasV1Frontmatter, parseV1 } from '../v1-loader.mjs';

const DEFAULT_BODY_LIMIT = 3000;

function boundedText(value, limit) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.slice(0, Math.max(0, limit));
}

export function extractCompanyResearch(reportText, { bodyLimit = DEFAULT_BODY_LIMIT } = {}) {
  try {
    if (typeof reportText !== 'string' || !reportText.trim()) return '';
    if (!hasV1Frontmatter(reportText)) return boundedText(reportText, bodyLimit);

    const { data, body } = parseV1(reportText);
    const companyBrief = data?.summary?.companyBrief ?? data?.companyBrief;
    if (typeof companyBrief === 'string' && companyBrief.trim()) {
      return boundedText(companyBrief, bodyLimit);
    }
    return boundedText(body, bodyLimit);
  } catch {
    return '';
  }
}

export function loadCompanyResearch(reportPath, options = {}) {
  try {
    const abs = resolveReportPath(reportPath);
    if (!abs) return '';
    return extractCompanyResearch(fs.readFileSync(abs, 'utf8'), options);
  } catch {
    return '';
  }
}
