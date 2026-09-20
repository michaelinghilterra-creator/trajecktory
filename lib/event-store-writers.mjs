import { spawnSync } from 'node:child_process';

// The flip and rollback commands demand --no-other-writers, the operator's statement that the dashboard
// and every script are stopped. The dashboard is a local web server, so a port that accepts connections
// proves the statement false. Scripts started from a terminal cannot be found this way, and the commands
// say so instead of pretending.

const DEFAULT_PORTS = [3000, 3001, 3333, 5173, 8080];

const PROBE = [
  "const net = require('node:net');",
  'const [host, port, timeout] = process.argv.slice(1);',
  'const socket = net.connect({ host, port: Number(port) });',
  'socket.setTimeout(Number(timeout), () => process.exit(1));',
  'socket.on(\'connect\', () => process.exit(0));',
  'socket.on(\'error\', () => process.exit(1));',
].join(' ');

export function dashboardPorts(env = process.env) {
  const ports = new Set(DEFAULT_PORTS);
  const configured = Number(env.PORT);
  if (Number.isInteger(configured) && configured >= 1 && configured <= 65535) ports.add(configured);
  return [...ports].sort((a, b) => a - b);
}

// Synchronous on purpose: the commands are synchronous. Each port is tried in a short child process.
export function findOtherWriters({ ports = dashboardPorts(), host = '127.0.0.1', timeoutMs = 500, spawn = spawnSync } = {}) {
  const found = [];
  for (const port of ports) {
    const result = spawn(process.execPath, ['-e', PROBE, host, String(port), String(timeoutMs)], {
      encoding: 'utf8',
      timeout: timeoutMs + 2000,
    });
    if (result.status === 0) found.push(`something is accepting connections on ${host}:${port}`);
  }
  return found;
}
