// Browser launch for untrusted pages (job postings).
//
// Installed Chrome comes first: it picks up Chrome's security fixes as they ship,
// while Playwright's bundled Chromium only moves when Playwright releases. When
// Chrome is not installed the bundled Chromium is used instead. Either way the
// sandbox is forced on, because Playwright launches with it off unless asked, and
// a caller cannot turn it back off through options or args.
import { chromium } from 'playwright';

export function sandboxedLaunchOptions(options = {}) {
  const args = (options.args || []).filter(arg => arg !== '--no-sandbox');
  return { headless: true, ...options, args, chromiumSandbox: true };
}

export async function launchSandboxedChromium(options = {}, launcher = chromium) {
  const base = sandboxedLaunchOptions(options);
  try {
    return await launcher.launch({ ...base, channel: 'chrome' });
  } catch (error) {
    const reason = String(error?.message || error).split('\n')[0];
    process.stderr.write(`Installed Chrome unavailable (${reason}); using Playwright's bundled Chromium with the sandbox on.\n`);
    return launcher.launch(base);
  }
}
