import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { recordJsonSnapshots } from '../legacy-files.mjs';
import { compareApplyDates, importApplyEvidence } from './apply-import.mjs';
import { compareStatusHistory, importStatusHistory } from './status-import.mjs';
import { compareTracker, importTracker } from './tracker-import.mjs';
import {
  compareGroupingWithResolvePeople,
  comparePeople,
  importPeople,
} from './people-import.mjs';
import { compareFollowups, importFollowups } from './followups-import.mjs';
import { compareCorrespondence, importCorrespondence } from './correspondence-import.mjs';
import { compareLinkedIn, importLinkedIn } from './linkedin-import.mjs';
import { compareTwc, importTwc } from './twc-import.mjs';

function readOptionalText(dataDir, name) {
  const file = resolve(dataDir, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function readTableText(dataDir, name) {
  const text = readOptionalText(dataDir, name);
  return { text: text ?? '', missing: text === null };
}

function readContactLinks(text) {
  if (text === null) return { document: {}, unreadable: false };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { document: {}, unreadable: true };
    }
    return { document: value, unreadable: false };
  } catch {
    return { document: {}, unreadable: true };
  }
}

function readCorrespondenceDirectory(dataDir, name) {
  const directory = resolve(dataDir, name);
  if (!existsSync(directory)) return { files: {}, missing: true };
  const files = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
    files[entry.name] = readFileSync(resolve(directory, entry.name), 'utf8');
  }
  return { files, missing: false };
}

export function importDataFolder(store, {
  dataDir,
  outputDir,
  ownerName,
  definitionsVersion,
  importedOn,
}) {
  const tracker = readTableText(dataDir, 'applications.md');
  const status = readTableText(dataDir, 'status-events.tsv');
  const targetTalent = readTableText(dataDir, 'target-talent.md');
  const referrals = readTableText(dataDir, 'referrals.md');
  const followups = readTableText(dataDir, 'follow-ups.md');
  const applyDatesText = readOptionalText(dataDir, 'apply-dates.json');
  const applyDates = applyDatesText === null ? {} : JSON.parse(applyDatesText);
  const contactLinksText = readOptionalText(dataDir, 'contact-links.json');
  const contactLinksRead = readContactLinks(contactLinksText);
  const contactPins = contactLinksRead.document.pins
    && typeof contactLinksRead.document.pins === 'object'
    && !Array.isArray(contactLinksRead.document.pins)
    ? contactLinksRead.document.pins : {};
  const targetTalentCorrespondence = readCorrespondenceDirectory(dataDir, 'target-talent-correspondence');
  const referralCorrespondence = readCorrespondenceDirectory(dataDir, 'referral-correspondence');
  const linkedinFiles = {
    connectsText: readOptionalText(dataDir, 'linkedin-connects.json'),
    sidecarText: readOptionalText(dataDir, 'tt-linkedin.json'),
    connectionsText: readOptionalText(dataDir, 'linkedin-connections.json'),
  };
  const twcFiles = {
    eventsText: readOptionalText(dataDir, 'twc-events.json'),
    overridesText: readOptionalText(dataDir, 'twc-overrides.json'),
  };
  const jsonTexts = {
    'apply-dates.json': applyDatesText,
    'linkedin-connects.json': linkedinFiles.connectsText,
    'tt-linkedin.json': linkedinFiles.sidecarText,
    'linkedin-connections.json': linkedinFiles.connectionsText,
    'twc-events.json': twcFiles.eventsText,
    'twc-overrides.json': twcFiles.overridesText,
    'contact-links.json': contactLinksText,
    'app-notes.json': readOptionalText(dataDir, 'app-notes.json'),
    'google-sync.json': readOptionalText(dataDir, 'google-sync.json'),
  };
  const outputFiles = readdirSync(outputDir, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name);

  const trackerReport = importTracker(store, tracker.text, {
    definitionsVersion, importedOn, exists: !tracker.missing,
  });
  const trackerComparison = compareTracker(tracker.text, store);
  const applyReport = importApplyEvidence(store, {
    applyDates, outputFiles, definitionsVersion, importedOn, ownerName,
  });
  const applyComparison = compareApplyDates(applyDates, store);
  const statusReport = importStatusHistory(store, status.text, {
    definitionsVersion, importedOn, exists: !status.missing,
  });
  const statusComparison = compareStatusHistory(status.text, store);
  const peopleReport = importPeople(store, {
    targetTalentText: targetTalent.text,
    referralsText: referrals.text,
    pins: contactPins,
    definitionsVersion,
    importedOn,
    targetTalentExists: !targetTalent.missing,
    referralsExists: !referrals.missing,
  });
  const peopleComparison = comparePeople({
    targetTalentText: targetTalent.text,
    referralsText: referrals.text,
  }, store);
  const groupingComparison = compareGroupingWithResolvePeople(store, {
    targetTalentText: targetTalent.text,
    referralsText: referrals.text,
    pins: contactPins,
  });
  const followupsReport = importFollowups(store, followups.text, {
    definitionsVersion, importedOn, exists: !followups.missing,
  });
  const followupsComparison = compareFollowups(followups.text, store);
  const correspondenceReport = importCorrespondence(store, {
    targetTalentFiles: targetTalentCorrespondence.files,
    referralFiles: referralCorrespondence.files,
    definitionsVersion,
    importedOn,
  });
  const correspondenceComparison = compareCorrespondence({
    targetTalentFiles: targetTalentCorrespondence.files,
    referralFiles: referralCorrespondence.files,
  }, store);
  const linkedinReport = importLinkedIn(store, {
    ...linkedinFiles, definitionsVersion, importedOn,
  });
  const linkedinComparison = compareLinkedIn(linkedinFiles, store);
  const twcReport = importTwc(store, { ...twcFiles, definitionsVersion, importedOn });
  const twcComparison = compareTwc(twcFiles, store);
  recordJsonSnapshots(store, { texts: jsonTexts, definitionsVersion, importedOn });

  applyReport.counts.apply_dates_file_missing = applyDatesText === null;
  trackerReport.counts.tracker_file_missing = tracker.missing;
  statusReport.counts.status_events_file_missing = status.missing;
  peopleReport.counts.target_talent_file_missing = targetTalent.missing;
  peopleReport.counts.referrals_file_missing = referrals.missing;
  peopleReport.counts.contact_links_file_missing = contactLinksText === null;
  peopleReport.counts.pins_file_unreadable = contactLinksRead.unreadable;
  followupsReport.counts.followups_file_missing = followups.missing;
  correspondenceReport.counts.target_talent_dir_missing = targetTalentCorrespondence.missing;
  correspondenceReport.counts.referral_dir_missing = referralCorrespondence.missing;

  const texts = {
    'applications.md': tracker.missing ? null : tracker.text,
    'status-events.tsv': status.missing ? null : status.text,
    'target-talent.md': targetTalent.missing ? null : targetTalent.text,
    'referrals.md': referrals.missing ? null : referrals.text,
    'follow-ups.md': followups.missing ? null : followups.text,
    ...jsonTexts,
  };
  for (const [directory, input] of [
    ['target-talent-correspondence', targetTalentCorrespondence.files],
    ['referral-correspondence', referralCorrespondence.files],
  ]) {
    for (const [file, text] of Object.entries(input)) texts[`${directory}/${file}`] = text;
  }

  return {
    reports: {
      tracker: trackerReport,
      trackerComparison,
      apply: applyReport,
      applyComparison,
      status: statusReport,
      statusComparison,
      people: peopleReport,
      peopleComparison,
      groupingComparison,
      followups: followupsReport,
      followupsComparison,
      correspondence: correspondenceReport,
      correspondenceComparison,
      linkedin: linkedinReport,
      linkedinComparison,
      twc: twcReport,
      twcComparison,
      correspondenceInputs: {
        'target-talent-correspondence': targetTalentCorrespondence.files,
        'referral-correspondence': referralCorrespondence.files,
      },
    },
    texts,
  };
}
