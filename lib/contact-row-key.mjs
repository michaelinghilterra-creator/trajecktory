export function contactRowOccurrenceKey(raw, { occurrenceOf } = {}) {
  if (!raw.startsWith('| ')) return null;
  const id = parseInt(raw.split('|')[1]?.trim(), 10);
  if (Number.isNaN(id)) return null;
  const occurrence = occurrenceOf ? occurrenceOf(id) : 0;
  return `${id}#${occurrence}`;
}

export function contactIdFromOccurrenceKey(key) {
  return parseInt(String(key).split('#')[0], 10);
}
