export function agentTail(output) {
  return (output || '')
    .split(/\r?\n/)
    .map(line => line.replace(/<<<[A-Z_]+>>>/g, '').trim())
    .filter(Boolean)
    .slice(-3)
    .join('\n');
}
