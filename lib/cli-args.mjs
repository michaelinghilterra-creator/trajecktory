export function checkArgs(argv, {
  flags = [], valueFlags = [], usage = '', allowPositional = false,
} = {}) {
  const args = Array.from(argv || []);
  if (args.includes('--help') || args.includes('-h')) return { help: true, usage };

  const flagSet = new Set(flags);
  const valueSet = new Set(valueFlags);
  const unknown = [];
  for (let i = 0; i < args.length; i++) {
    const arg = String(args[i]);
    if (valueSet.has(arg)) {
      i++;
      continue;
    }
    const equals = arg.indexOf('=');
    if (equals > 0 && valueSet.has(arg.slice(0, equals))) continue;
    if (flagSet.has(arg)) continue;
    if (!arg.startsWith('-') && allowPositional) continue;
    unknown.push(arg);
  }
  return unknown.length ? { unknown, usage } : { ok: true, usage };
}

export function enforceArgs(argv, options) {
  const result = checkArgs(argv, options);
  if (result.help) {
    console.log(options.usage);
    return 0;
  }
  if (result.unknown) {
    console.error(`Unknown option: ${result.unknown[0]}`);
    console.error(options.usage);
    return 2;
  }
  return null;
}
