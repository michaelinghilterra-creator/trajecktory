export const REFUSAL_REASONS = Object.freeze(['missing_script_or_run_id', 'unknown_application', 'no_response_is_hand_set', 'no_evidence', 'employer_evidence_exists', 'no_change']);

export function planBulkRun({ script, run_id, operations, applications }) {
  const result = {
    mode: 'dry_run',
    script,
    run_id,
    planned: [],
    refused: [],
    ledger: []
  };

  if (!script || typeof script !== 'string' || !run_id || typeof run_id !== 'string') {
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      result.refused.push({ index: i, application_id: op.application_id, reason: 'missing_script_or_run_id' });
    }
    return result;
  }

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];
    const app = applications[op.application_id];

    if (!app) {
      result.refused.push({ index: i, application_id: op.application_id, reason: 'unknown_application' });
      continue;
    }

    if (op.field === 'status' && op.to === 'No Response') {
      result.refused.push({ index: i, application_id: op.application_id, reason: 'no_response_is_hand_set' });
      continue;
    }

    if (!op.evidence_ref || typeof op.evidence_ref !== 'string') {
      result.refused.push({ index: i, application_id: op.application_id, reason: 'no_evidence' });
      continue;
    }

    if (op.field === 'status') {
      const hasEmployerEvidence = (app.employer_messages ?? []).some(msg =>
        msg.kind === 'rejection' || msg.kind === 'human_reply'
      );
      if (hasEmployerEvidence) {
        result.refused.push({ index: i, application_id: op.application_id, reason: 'employer_evidence_exists' });
        continue;
      }
    }

    if (op.field === 'status' && op.to === app.status) {
      result.refused.push({ index: i, application_id: op.application_id, reason: 'no_change' });
      continue;
    }

    const from = op.field === 'status' ? app.status : null;
    result.planned.push({ index: i, application_id: op.application_id, field: op.field, from, to: op.to, tag: { script, run_id }, evidence_ref: op.evidence_ref });
    result.ledger.push({ index: i, application_id: op.application_id, evidence_ref: op.evidence_ref, script, run_id });
  }

  return result;
}

export function describePlan(plan) {
  const lines = [];
  const scriptDisplay = (!plan.script || typeof plan.script !== 'string') ? 'missing' : plan.script;
  const runIdDisplay = (!plan.run_id || typeof plan.run_id !== 'string') ? 'missing' : plan.run_id;
  lines.push(`DRY RUN ${scriptDisplay} ${runIdDisplay}: ${plan.planned.length} planned, ${plan.refused.length} refused`);

  const allItems = [];
  for (const item of plan.planned) {
    allItems.push({ ...item, type: 'planned' });
  }
  for (const item of plan.refused) {
    allItems.push({ ...item, type: 'refused' });
  }

  allItems.sort((a, b) => a.index - b.index);

  for (const item of allItems) {
    if (item.type === 'planned') {
      const fromDisplay = item.from === null ? 'null' : item.from;
      lines.push(`PLAN #${item.index} application ${item.application_id} ${item.field}: ${fromDisplay} -> ${item.to} [${item.tag.script} ${item.tag.run_id}] evidence ${item.evidence_ref}`);
    } else {
      lines.push(`REFUSED #${item.index} application ${item.application_id}: ${item.reason}`);
    }
  }

  return lines;
}
