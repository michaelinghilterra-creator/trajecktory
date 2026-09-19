/**
 * Pure functions to assess interview records and summarize them.
 */

import { evaluateHeldEvidence } from './held-evidence.mjs';

export function assessInterviewRecord(record, { today }) {
  const { id, scheduled_for, held_on, slot_end, evidence } = record;

  if (held_on !== undefined && held_on !== null) {
    if (held_on > today) {
      return { id, state: 'unconfirmed', reasons: ['future_held_on'] };
    }

    try {
      const { held, rejected } = evaluateHeldEvidence({ slot_end, items: evidence ?? [] });

      if (held) {
        return { id, state: 'counted', held_on, reasons: [] };
      }

      if (rejected.length > 0) {
        const distinctReasons = [...new Set(rejected.map(r => r.reason))];
        return { id, state: 'unconfirmed', reasons: distinctReasons };
      }

      return { id, state: 'unconfirmed', reasons: ['no_evidence'] };
    } catch {
      return { id, state: 'unconfirmed', reasons: ['bad_slot_end'] };
    }
  }

  if (scheduled_for !== undefined && scheduled_for !== null) {
    if (scheduled_for >= today) {
      return { id, state: 'scheduled', reasons: [] };
    }
    return { id, state: 'unconfirmed', reasons: ['slot_passed_unconfirmed'] };
  }

  return { id, state: 'unconfirmed', reasons: ['no_dates'] };
}

export function summarizeInterviews(records, { today }) {
  const counted = [];
  const unconfirmed = [];
  const scheduled = [];

  for (const record of records) {
    const result = assessInterviewRecord(record, { today });

    if (result.state === 'counted') {
      counted.push({ id: record.id, stage: record.stage, held_on: result.held_on });
    } else if (result.state === 'unconfirmed') {
      unconfirmed.push({ id: record.id, stage: record.stage, reasons: result.reasons });
    } else {
      scheduled.push({ id: record.id, stage: record.stage, scheduled_for: record.scheduled_for });
    }
  }

  return { counted, unconfirmed, scheduled };
}
