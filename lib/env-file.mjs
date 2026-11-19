// Parses the text of a .env file into a plain object. A file saved with Windows
// line endings leaves a carriage return at the end of every line, and `.` in a
// regular expression never matches one, so a line-by-line `(.*)$` match used to
// skip such a line without any error. Lines are split on either ending here.
export function parseEnvText(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) out[m[1].trim()] = m[2].trim();
  }
  return out;
}
