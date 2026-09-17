import { parseTargetTalentText } from '../../dashboard-web/server/lib/target-talent.mjs';
import { parseReferralsText } from '../../dashboard-web/server/lib/referrals.mjs';
import {
  cleanName,
  linkedinKey,
  resolvePeople,
} from '../../dashboard-web/server/lib/contact-identity.mjs';
import {
  IdentityConflictError,
  addAlias,
  addIdentifier,
  addPerson,
  companyKey,
  emailKey,
  findPerson,
  findPersonByAlias,
  keepPeopleSeparate,
  linkedinIdentifier,
  mergePeople,
  resolveCompany,
  resolvePersonId,
} from '../identity-store.mjs';
import { appendEvents } from '../event-store.mjs';

const FILES = Object.freeze({
  target_talent: 'target-talent.md',
  referral: 'referrals.md',
});

function acceptedRows(targetTalentText, referralsText) {
  const targetTalent = parseTargetTalentText(targetTalentText ?? '', {});
  const referrals = parseReferralsText(referralsText ?? '');
  const withLines = (rows, text, source) => {
    const indexes = new Map();
    String(text ?? '').split('\n').forEach((line, index) => {
      if (!indexes.has(line)) indexes.set(line, []);
      indexes.get(line).push(index);
    });
    const used = new Map();
    return rows.map(row => {
      const offset = used.get(row.raw) ?? 0;
      const lineIndex = indexes.get(row.raw)?.[offset];
      used.set(row.raw, offset + 1);
      const isTargetTalent = source === 'target_talent';
      return {
        row,
        file: FILES[source],
        source,
        ref: `${isTargetTalent ? 'ta' : 'referral'}:${row.id}`,
        line_index: lineIndex,
        raw: row.raw,
        name: isTargetTalent
          ? [row.first, row.last].filter(Boolean).join(' ').trim()
          : String(row.name ?? '').trim(),
        company: String(isTargetTalent ? row.company : row.where).trim(),
        email: String(row.email ?? '').trim(),
        linkedin: String(row.linkedin ?? '').trim(),
      };
    });
  };
  return {
    targetTalent,
    referrals,
    rows: [
      ...withLines(targetTalent, targetTalentText, 'target_talent'),
      ...withLines(referrals, referralsText, 'referral'),
    ],
  };
}

function context(row, definitionsVersion, importedOn) {
  return {
    occurred_on: importedOn,
    source: 'import',
    definitions_version: definitionsVersion,
    evidence_ref: `${row.file}#line${row.line_index}`,
  };
}

function rowOptions(row, companyId, withDedupe = true) {
  return {
    payload: {
      file: row.file,
      line_index: row.line_index,
      raw: row.raw,
      ...(companyId ? { company_id: companyId } : {}),
    },
    ...(withDedupe ? { dedupeKey: `import:${row.file}:line:${row.line_index}` } : {}),
  };
}

function flag(flags, type, fields) {
  flags.push({ type, ...fields });
}

function aliasParts(ref) {
  const [prefix, ...rest] = String(ref ?? '').split(':');
  return {
    source: prefix === 'ta' ? 'target_talent' : prefix,
    legacyId: rest.join(':'),
  };
}

function rootForRef(store, ref) {
  const alias = aliasParts(ref);
  if (!alias.source || !alias.legacyId) return null;
  return findPersonByAlias(store, alias.source, alias.legacyId);
}

function safeCompanyKey(value) {
  try { return companyKey(value); } catch { return ''; }
}

function personRoots(store) {
  const roots = new Map();
  for (const person of store.db.prepare('SELECT id FROM people').all()) {
    roots.set(person.id, resolvePersonId(store, person.id));
  }
  return roots;
}

function recordUnaliasedRow(store, personId, row, companyId, ctx) {
  appendEvents(store, [{
    type: 'person_updated',
    person_id: resolvePersonId(store, personId),
    occurred_on: ctx.occurred_on,
    source: ctx.source,
    definitions_version: ctx.definitions_version,
    evidence_ref: ctx.evidence_ref,
    dedupe_key: `import:${row.file}:line:${row.line_index}`,
    payload: rowOptions(row, companyId, false).payload,
  }]);
}

function duplicateLists(store, rows) {
  const rootsById = personRoots(store);
  const aliases = store.db.prepare('SELECT source, legacy_id, person_id FROM person_aliases').all();
  const idByRef = new Map(aliases.map(alias => [
    `${alias.source === 'target_talent' ? 'ta' : alias.source}:${alias.legacy_id}`,
    rootsById.get(alias.person_id),
  ]));
  const separatedRoots = new Set();
  for (const separation of store.db.prepare('SELECT a_id, b_id FROM people_separate').all()) {
    const a = rootsById.get(separation.a_id);
    const b = rootsById.get(separation.b_id);
    if (a && b && a !== b) separatedRoots.add([a, b].sort().join('\0'));
  }
  const byRoot = new Map();
  for (const row of rows) {
    const personId = idByRef.get(row.ref);
    if (!personId) continue;
    const name = cleanName(row.name);
    if (name.split(' ').filter(Boolean).length < 2) continue;
    if (!byRoot.has(personId)) byRoot.set(personId, []);
    byRoot.get(personId).push({ name, company: safeCompanyKey(row.company) });
  }

  const possible = [];
  const other = [];
  const roots = [...byRoot.keys()].sort();
  for (let left = 0; left < roots.length; left++) {
    for (let right = left + 1; right < roots.length; right++) {
      const a = roots[left];
      const b = roots[right];
      if (separatedRoots.has([a, b].sort().join('\0'))) continue;
      let sharedName = false;
      let reason = '';
      for (const first of byRoot.get(a)) {
        for (const second of byRoot.get(b)) {
          if (first.name !== second.name) continue;
          sharedName = true;
          if (first.company && first.company === second.company) reason = 'same_company';
          else if (first.company && second.company) {
            const shorter = first.company.length <= second.company.length ? first.company : second.company;
            const longer = shorter === first.company ? second.company : first.company;
            if (shorter.length >= 4 && longer.startsWith(shorter)) reason ||= 'related_company';
          }
        }
      }
      if (reason) possible.push({ a_person_id: a, b_person_id: b, reason });
      else if (sharedName) other.push({ a_person_id: a, b_person_id: b });
    }
  }
  return { possible, other };
}

export function importPeople(store, {
  targetTalentText = '',
  referralsText = '',
  pins = {},
  definitionsVersion,
  importedOn,
}) {
  const parsed = acceptedRows(targetTalentText, referralsText);
  const flags = [];
  const counts = {
    target_talent_rows: parsed.targetTalent.length,
    referral_rows: parsed.referrals.length,
    people_created: 0,
    aliases_attached: 0,
    identifiers_added: 0,
    pin_merges: 0,
    pin_already_same: 0,
    backref_merges: 0,
    backref_already_same: 0,
    companies_created: 0,
    companies_reused: 0,
    person_roots: 0,
  };
  const idsSeen = new Map();
  const eventByDedupeKey = store.db.prepare('SELECT id FROM events WHERE dedupe_key = ?');

  for (const row of parsed.rows) {
    const dedupeKey = `import:${row.file}:line:${row.line_index}`;
    if (eventByDedupeKey.get(dedupeKey)) {
      throw new Error(`people import dedupe key already exists: ${dedupeKey}`);
    }
  }

  const aloneRefs = new Set(Object.entries(pins ?? {})
    .filter(([, pin]) => pin?.alone === true)
    .map(([ref]) => ref));
  const orderedRows = [
    ...parsed.rows.filter(row => !aloneRefs.has(row.ref)),
    ...parsed.rows.filter(row => aloneRefs.has(row.ref)),
  ];

  for (const row of orderedRows) {
    const ctx = context(row, definitionsVersion, importedOn);
    let companyId = null;
    const key = safeCompanyKey(row.company);
    if (!key) flag(flags, 'no_company', { ref: row.ref });
    else {
      const company = resolveCompany(store, row.company, ctx);
      companyId = company.id;
      counts[company.created ? 'companies_created' : 'companies_reused']++;
    }

    let email = '';
    if (row.email) {
      try { email = emailKey(row.email); }
      catch { flag(flags, 'invalid_email', { ref: row.ref }); }
    }
    let linkedin = '';
    if (row.linkedin) {
      try { linkedin = linkedinIdentifier(row.linkedin); }
      catch { flag(flags, 'unparseable_linkedin', { ref: row.ref }); }
    }
    if (!email && !linkedin) flag(flags, 'no_identifier', { ref: row.ref });
    if (!row.name) flag(flags, 'no_name', { ref: row.ref });

    const idKey = `${row.source}:${row.row.id}`;
    const duplicateId = idsSeen.has(idKey);
    if (duplicateId) flag(flags, 'duplicate_id', { ref: row.ref });
    idsSeen.set(idKey, true);

    const emailOwner = email ? findPerson(store, { email }) : null;
    const linkedinOwner = linkedin ? findPerson(store, { linkedin: row.linkedin }) : null;
    const alias = { source: row.source, legacyId: row.row.id };
    const options = rowOptions(row, companyId);
    const name = row.name || row.ref;
    const isAlone = aloneRefs.has(row.ref);

    if (isAlone && (emailOwner || linkedinOwner)) {
      const owners = [...new Set([emailOwner, linkedinOwner].filter(Boolean))];
      const withheldIdentifierKinds = [
        ...(emailOwner ? ['email'] : []),
        ...(linkedinOwner ? ['linkedin'] : []),
      ];
      const personId = addPerson(store, {
        name,
        emails: email && !emailOwner ? [email] : [],
        linkedinUrls: linkedin && !linkedinOwner ? [row.linkedin] : [],
        aliases: duplicateId ? [] : [alias],
      }, ctx, options);
      counts.people_created++;
      counts.identifiers_added += Number(Boolean(email && !emailOwner))
        + Number(Boolean(linkedin && !linkedinOwner));
      if (!duplicateId) counts.aliases_attached++;
      else {
        try {
          if (addAlias(store, personId, alias, ctx, rowOptions(row, companyId, false))) {
            counts.aliases_attached++;
          }
        } catch (error) {
          if (!(error instanceof IdentityConflictError)) throw error;
        }
      }
      for (const owner of owners) {
        keepPeopleSeparate(store, { aId: personId, bId: owner }, {
          occurred_on: importedOn,
          source: 'import',
          definitions_version: definitionsVersion,
          evidence_ref: 'contact-links.json',
        }, { dedupeKey: `import:contact-links.json:alone:${row.ref}:${owner}` });
      }
      flag(flags, 'pin_alone_conflict', {
        ref: row.ref,
        person_id: personId,
        owners,
        withheld_identifier_kinds: withheldIdentifierKinds,
      });
      continue;
    }

    if (!emailOwner && !linkedinOwner) {
      const personId = addPerson(store, {
        name,
        emails: email ? [email] : [],
        linkedinUrls: linkedin ? [row.linkedin] : [],
        aliases: duplicateId ? [] : [alias],
      }, ctx, options);
      counts.people_created++;
      counts.identifiers_added += Number(Boolean(email)) + Number(Boolean(linkedin));
      if (!duplicateId) counts.aliases_attached++;
      else {
        try {
          if (addAlias(store, personId, alias, ctx, rowOptions(row, companyId, false))) {
            counts.aliases_attached++;
          }
        } catch (error) {
          if (!(error instanceof IdentityConflictError)) throw error;
        }
      }
      continue;
    }

    if (emailOwner && linkedinOwner && emailOwner !== linkedinOwner) {
      let attached = false;
      try {
        attached = addAlias(store, emailOwner, alias, ctx, options);
        if (attached) counts.aliases_attached++;
      } catch (error) {
        if (!(error instanceof IdentityConflictError)) throw error;
      }
      if (!attached) recordUnaliasedRow(store, emailOwner, row, companyId, ctx);
      flag(flags, 'identity_bridge', {
        ref: row.ref,
        email_owner: emailOwner,
        linkedin_owner: linkedinOwner,
      });
      continue;
    }

    const owner = emailOwner || linkedinOwner;
    let attached = false;
    try {
      attached = addAlias(store, owner, alias, ctx, options);
      if (attached) counts.aliases_attached++;
    } catch (error) {
      if (!(error instanceof IdentityConflictError)) throw error;
    }
    if (!attached) recordUnaliasedRow(store, owner, row, companyId, ctx);
    if (email && !emailOwner && addIdentifier(
      store, owner, { kind: 'email', value: email }, ctx,
    )) counts.identifiers_added++;
    if (linkedin && !linkedinOwner && addIdentifier(
      store, owner, { kind: 'linkedin', value: row.linkedin }, ctx,
    )) counts.identifiers_added++;
    flag(flags, 'duplicate_person_row', {
      ref: row.ref,
      person_id: resolvePersonId(store, owner),
      matched_by: emailOwner && linkedinOwner ? 'both' : emailOwner ? 'email' : 'linkedin',
    });
  }

  const referralsClaimedByPins = new Set();
  for (const [ref, pin] of Object.entries(pins ?? {})) {
    const personId = rootForRef(store, ref);
    if (pin?.with) {
      if (aloneRefs.has(ref) || aloneRefs.has(pin.with)) {
        flag(flags, 'pin_skipped_alone', { ref, with: pin.with });
        continue;
      }
      const otherId = rootForRef(store, pin.with);
      if (!personId || !otherId) {
        flag(flags, 'pin_missing_ref', { ref });
        continue;
      }
      const merged = mergePeople(store, { fromId: personId, intoId: otherId }, {
        occurred_on: importedOn,
        source: 'import',
        definitions_version: definitionsVersion,
        evidence_ref: 'contact-links.json',
      }, {
        dedupeKey: `import:contact-links.json:${ref}`,
        payload: {
          pin_ref: ref,
          pin_with: pin.with,
          pin_by: pin.by,
          pin_at: pin.at,
        },
      });
      counts[merged === null ? 'pin_already_same' : 'pin_merges']++;
      if (ref.startsWith('referral:')) referralsClaimedByPins.add(ref);
      if (String(pin.with).startsWith('referral:')) referralsClaimedByPins.add(pin.with);
    } else if (pin?.alone === true) {
      if (!personId) {
        flag(flags, 'pin_missing_ref', { ref });
      }
    } else {
      flag(flags, 'pin_unrecognized', { ref });
    }
  }

  for (const referral of parsed.referrals) {
    const ref = `referral:${referral.id}`;
    if (referralsClaimedByPins.has(ref)) continue;
    const match = String(referral.notes ?? '').match(/from\s+TA\s+Outreach\s+#(\d+)\b/i);
    if (!match) continue;
    const targetRef = `ta:${match[1]}`;
    if (aloneRefs.has(ref) || aloneRefs.has(targetRef)) {
      flag(flags, 'pin_skipped_alone', { ref, with: targetRef });
      continue;
    }
    const referralId = rootForRef(store, ref);
    const targetId = rootForRef(store, targetRef);
    if (!targetId) {
      flag(flags, 'backref_missing_ta', { ref });
      continue;
    }
    const merged = mergePeople(store, { fromId: referralId, intoId: targetId }, {
      occurred_on: importedOn,
      source: 'import',
      definitions_version: definitionsVersion,
      evidence_ref: `${FILES.referral}#backref:${referral.id}`,
    }, { dedupeKey: `import:referrals.md:backref:${referral.id}` });
    counts[merged === null ? 'backref_already_same' : 'backref_merges']++;
  }

  counts.person_roots = new Set(personRoots(store).values()).size;
  const duplicates = duplicateLists(store, parsed.rows);
  return {
    counts,
    flags,
    possible_duplicate_people: duplicates.possible,
    same_name_other_company: duplicates.other,
  };
}

export function rebuildContactRows(store, file) {
  return store.db.prepare(`
    SELECT payload FROM events
    WHERE json_extract(payload, '$.file') = ?
      AND json_type(payload, '$.raw') = 'text'
    ORDER BY CAST(json_extract(payload, '$.line_index') AS INTEGER), id
  `).all(file).map(event => JSON.parse(event.payload).raw);
}

function mismatchCount(original, rebuilt) {
  let mismatches = 0;
  const length = Math.max(original.length, rebuilt.length);
  for (let index = 0; index < length; index++) {
    if (original[index] !== rebuilt[index]) mismatches++;
  }
  return mismatches;
}

export function comparePeople({ targetTalentText = '', referralsText = '' }, store) {
  const parsed = acceptedRows(targetTalentText, referralsText);
  const compare = (file, rows) => {
    const original = rows.map(row => row.raw);
    const rebuilt = rebuildContactRows(store, file);
    return {
      original_rows: original.length,
      rebuilt_rows: rebuilt.length,
      mismatches: mismatchCount(original, rebuilt),
    };
  };
  const targetTalent = compare(FILES.target_talent, parsed.targetTalent);
  const referrals = compare(FILES.referral, parsed.referrals);
  return {
    match: targetTalent.mismatches === 0 && referrals.mismatches === 0,
    target_talent: targetTalent,
    referrals,
  };
}

function groupedPairs(groups) {
  const pairs = new Set();
  for (const refs of groups) {
    const ordered = [...new Set(refs)].sort();
    for (let left = 0; left < ordered.length; left++) {
      for (let right = left + 1; right < ordered.length; right++) {
        pairs.add(`${ordered[left]}\0${ordered[right]}`);
      }
    }
  }
  return pairs;
}

export function compareGroupingWithResolvePeople(store, {
  targetTalentText = '', referralsText = '', pins = {},
}) {
  const parsed = acceptedRows(targetTalentText, referralsText);
  const aliases = store.db.prepare('SELECT source, legacy_id, person_id FROM person_aliases').all();
  const rootsById = personRoots(store);
  const oursByRoot = new Map();
  for (const alias of aliases) {
    const root = rootsById.get(alias.person_id);
    if (!oursByRoot.has(root)) oursByRoot.set(root, []);
    oursByRoot.get(root).push(`${alias.source === 'target_talent' ? 'ta' : alias.source}:${alias.legacy_id}`);
  }
  const theirs = resolvePeople({ ta: parsed.targetTalent, referrals: parsed.referrals, pins });
  const ourPairs = groupedPairs(oursByRoot.values());
  const theirPairs = groupedPairs(theirs.map(group => group.refs));
  const byUsOnly = [...ourPairs].filter(pair => !theirPairs.has(pair)).sort();
  const byThemOnly = [...theirPairs].filter(pair => !ourPairs.has(pair)).sort();
  const rowByRef = new Map(parsed.rows.map(row => [row.ref, row]));
  const reasons = { email: 0, linkedin: 0, merge: 0 };
  for (const pair of byUsOnly) {
    const [aRef, bRef] = pair.split('\0');
    const a = rowByRef.get(aRef);
    const b = rowByRef.get(bRef);
    let sameEmail = false;
    try { sameEmail = Boolean(a?.email && b?.email && emailKey(a.email) === emailKey(b.email)); } catch {}
    const sameLinkedin = Boolean(a?.linkedin && b?.linkedin
      && linkedinKey(a.linkedin) && linkedinKey(a.linkedin) === linkedinKey(b.linkedin));
    reasons[sameEmail ? 'email' : sameLinkedin ? 'linkedin' : 'merge']++;
  }
  return {
    our_groups: oursByRoot.size,
    their_groups: theirs.length,
    pairs_grouped_by_us_only: byUsOnly.length,
    pairs_grouped_by_them_only: byThemOnly.length,
    by_us_only_reasons: reasons,
    by_us_only_pairs: byUsOnly.map(pair => pair.split('\0')),
    by_them_only_pairs: byThemOnly.map(pair => pair.split('\0')),
  };
}
