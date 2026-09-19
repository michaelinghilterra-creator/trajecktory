export const EVIDENCE_REF_KINDS = Object.freeze(['message_id', 'calendar_event_id', 'file']);

function isValidDate(dateStr) {
  if (typeof dateStr !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (month < 1 || month > 12) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return false;
  return true;
}

export function validateOverride(override, resolve) {
  if (!override.event_id || override.event_id === '') {
    return { ok: false, reason: 'no_event_id' };
  }

  if (override.stage === undefined && override.date === undefined) {
    return { ok: false, reason: 'no_change' };
  }

  if (override.date !== undefined && !isValidDate(override.date)) {
    return { ok: false, reason: 'bad_date' };
  }

  if (override.evidence_ref === undefined || typeof override.evidence_ref !== 'object' || override.evidence_ref === null) {
    return { ok: false, reason: 'no_evidence' };
  }

  const { kind, id } = override.evidence_ref;
  if (!EVIDENCE_REF_KINDS.includes(kind)) {
    return { ok: false, reason: 'bad_evidence_kind' };
  }

  if (!id || id === '') {
    return { ok: false, reason: 'empty_evidence_id' };
  }

  const resolved = resolve(kind, id);
  if (resolved !== true) {
    return { ok: false, reason: 'unresolved_evidence' };
  }

  return { ok: true };
}

export function applyOverride(state, override, resolve) {
  const validation = validateOverride(override, resolve);
  if (!validation.ok) {
    throw new Error(`override rejected: ${validation.reason}`);
  }

  const eventIndex = state.events.findIndex(e => e.id === override.event_id);
  if (eventIndex === -1) {
    throw new Error('override rejected: unknown_event');
  }

  const newEvents = state.events.map((e, i) => {
    if (i === eventIndex) {
      return {
        ...e,
        stage: override.stage !== undefined ? override.stage : e.stage,
        date: override.date !== undefined ? override.date : e.date
      };
    }
    return e;
  });

  const newOverrides = [...state.overrides, { ...override }];

  return { events: newEvents, overrides: newOverrides };
}

export function validateOverrides(overrides, resolve) {
  const accepted = [];
  const rejected = [];

  for (let i = 0; i < overrides.length; i++) {
    const override = overrides[i];
    const validation = validateOverride(override, resolve);
    if (validation.ok) {
      accepted.push(override);
    } else {
      rejected.push({ index: i, reason: validation.reason });
    }
  }

  return { accepted, rejected };
}
