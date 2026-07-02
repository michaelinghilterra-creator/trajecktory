// Run a one-shot prompt on the user's Claude PLAN (their `claude login`), via the
// bundled Claude Code CLI — no Anthropic API key. This is the keyless path for
// the dashboard's AI writing features; the API-key path lives in anthropic.mjs.
// The spawn pattern mirrors routes/agent.mjs (which runs Scan/Evaluate the same
// way), with one key difference: the prompt is delivered over STDIN, so long,
// multi-line draft prompts aren't subject to Windows shell quoting.
import { spawn } from 'child_process';
import os from 'os';

// Map an Anthropic model id to a CLI alias the `claude` CLI understands.
function modelAlias(model) {
  if (!model) return null;
  const m = String(model).toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('haiku')) return 'haiku';
  // Allow-list any passthrough id so an unexpected value can never become a
  // shell-injectable argv element (spawn uses shell:true on Windows). A value
  // that is not opus/sonnet/haiku or a claude-* id yields no --model flag.
  return /^claude-[a-z0-9.-]+$/i.test(m) ? model : null;
}

function startErr(e) {
  if (e && e.code === 'ENOENT') {
    return 'Claude Code CLI not found. Make sure `claude` is installed and on your PATH, then retry.';
  }
  return (e && e.message) || 'Failed to start Claude Code.';
}

// Normalize a failure into a user-actionable message. The common case is "not
// signed in" — the same `claude login` the user already did for Scan/Evaluate.
function planErr(msg, stderr) {
  const all = `${msg || ''}\n${stderr || ''}`;
  if (/not recognized|command not found|ENOENT/i.test(all)) {
    return 'Claude Code CLI not found. Make sure `claude` is installed and on your PATH.';
  }
  if (/\b401\b|login|authenticat|unauthor|not logged in|sign ?in|token (?:expired|invalid)/i.test(all)) {
    return 'Not signed in to Claude. Run `claude login` in a terminal (the same login used for Scan and Evaluate), then retry.';
  }
  return msg || 'Claude Code failed to generate a response.';
}

// Resolve to the generated text, or reject with a clear Error.
export function runClaudePrompt(prompt, { model, system, allowedTools, timeoutMs = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const alias = modelAlias(model);
    const args = ['-p', '--output-format', 'json', '--no-session-persistence'];
    if (alias) args.push('--model', alias);
    if (allowedTools) args.push('--allowedTools', allowedTools);

    // Run on the Claude subscription, not the API key: Claude Code bills
    // ANTHROPIC_API_KEY whenever it sees it, so strip it from the child env.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    let child;
    try {
      // Run from a neutral dir (NOT the repo) so the CLI does not auto-load the
      // project CLAUDE.md/AGENTS.md (onboarding/update/batch instructions) into a
      // self-contained draft prompt. Draft prompts already embed all context.
      child = spawn('claude', args, { cwd: os.tmpdir(), env, shell: isWin, windowsHide: true });
    } catch (e) {
      return reject(new Error(startErr(e)));
    }

    let out = '', err = '', settled = false;
    const finish = (fn, val) => { if (!settled) { settled = true; clearTimeout(timer); fn(val); } };
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish(reject, new Error('Claude timed out while generating. Try again, or add an ANTHROPIC_API_KEY for the faster path.'));
    }, timeoutMs);

    child.on('error', (e) => finish(reject, new Error(startErr(e))));
    child.stdout && child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr && child.stderr.on('data', (d) => { err += d.toString(); });

    // Deliver the prompt (system folded in) over stdin, then close it.
    if (child.stdin) {
      try {
        child.stdin.write(system ? `${system}\n\n${prompt}` : prompt);
        child.stdin.end();
      } catch { /* stdin already closed */ }
    }

    child.on('close', (code) => {
      // `--output-format json` prints one result object: { result, is_error, ... }
      let parsed = null;
      try { parsed = JSON.parse(out.trim()); } catch { /* not JSON */ }
      if (parsed && typeof parsed.result === 'string' && !parsed.is_error) {
        return finish(resolve, parsed.result);
      }
      if (parsed && parsed.is_error) {
        return finish(reject, new Error(planErr(parsed.result, err)));
      }
      if (code !== 0) {
        return finish(reject, new Error(planErr(err || `claude exited ${code}`, err)));
      }
      // Exit 0 but unparseable JSON — fall back to raw stdout if any.
      if (out.trim()) return finish(resolve, out.trim());
      return finish(reject, new Error(planErr(err || 'Claude returned no output', err)));
    });
  });
}
