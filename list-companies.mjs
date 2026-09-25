#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { atsSlug, buildCompanyIndex, normalizeToken } from './lib/portals.mjs';

const portals = yaml.load(readFileSync('portals.yml', 'utf8')) || {};
const index = buildCompanyIndex(portals.tracked_companies || []);
const companies = [...new Set(index.values())];

for (const company of companies) {
  const slug = atsSlug(company.api) || atsSlug(company.careers_url) || normalizeToken(company.name);
  console.log(`${company.name || ''}\t${slug}`);
}
