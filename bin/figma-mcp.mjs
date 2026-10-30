#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:os';
import { removeRegistration } from './registration.mjs';
import { codexConfig, readTools } from './codex-config.mjs';
import { serverName, trackServer } from './server-state.mjs';

const args = process.argv.slice(2);
if (['status', 'monitor', 'stop', 'clean', '--help', '-h'].includes(args[0])) {
  try {
    const { manageServers } = await import('./monitor.mjs');
    await manageServers(args);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode ?? 0);
}
if (args.length && (args.length !== 2 || args[0] !== '--output-dir' || !args[1])) {
  throw new Error('Usage: node bin/figma-mcp.mjs [--output-dir <folder>] (defaults to the current directory)');
}

const projectDir = args.length ? resolve(args[1]) : process.cwd();
const cacheDir = join(projectDir, '.figma-cache');
for (const folder of ['assets', 'exported']) mkdirSync(join(cacheDir, folder), { recursive: true });

const server = serverName(projectDir);
const serverArgs = [
  'mcp', 'add', '--env', `FIGMA_CACHE_ROOT=${cacheDir}`, server, '--', 'node',
  fileURLToPath(new URL('../server/dist/index.js', import.meta.url)),
];

const codex = (args, output = 'ignore') => execFileSync('codex', ['mcp', ...args], {
  encoding: 'utf8', stdio: ['ignore', output, 'ignore'], timeout: 5000,
});
function readConfig() {
  return JSON.parse(codex(['get', server, '--json'], 'pipe'));
}

let registeredTransport;
process.once('exit', () => removeRegistration(server, registeredTransport));

const bridge = spawn(process.execPath, [fileURLToPath(new URL('./bridge.mjs', import.meta.url)), projectDir, cacheDir], {
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
});
let stoppedBy;
function stop(signal = 'SIGHUP') {
  stoppedBy ??= signal;
  bridge.kill(signal);
}
for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
  process.on(signal, () => stop(signal));
}
// Some terminals close the PTY without delivering a signal to the launcher.
if (process.stdin.isTTY) {
  process.stdin.once('end', () => stop());
  process.stdin.once('close', () => stop());
  process.stdin.once('error', () => stop());
  process.stdin.resume();
}
const shellPid = process.ppid;
const shellWatch = setInterval(() => {
  if (process.ppid !== shellPid) stop();
}, 1000);
shellWatch.unref();
bridge.on('message', async (message) => {
  if (message.type !== 'ready' || stoppedBy) return;
  try {
    const record = Number.isInteger(message.port) ? {
      name: server, project: projectDir, cacheDir, port: message.port, bridgePid: message.pid,
      launcherPid: process.pid, instanceId: message.instanceId, startedAt: message.startedAt,
    } : null;
    if (record) trackServer(record);
    let config;
    try { config = readConfig(); } catch {}
    if (config?.transport?.env?.FIGMA_CACHE_ROOT !== cacheDir) {
      if (config) codex(['remove', server]);
      execFileSync('codex', serverArgs, { stdio: 'inherit', timeout: 5000 });
    }
    registeredTransport = readConfig().transport;
    // The bridge can perform the same guarded cleanup if this launcher is killed.
    bridge.send({ type: 'registration', server, transport: registeredTransport });
    await codexConfig('config/batchWrite', { edits: readTools.map((tool) => ({
      keyPath: `mcp_servers.${server}.tools.${tool}.approval_mode`, value: 'approve', mergeStrategy: 'upsert',
    })) });
    if (stoppedBy) return;
    if (record) trackServer({ ...record, transport: registeredTransport });
    console.log(`Ready: ${server}\nLocal read tools are approved. Press Ctrl+C to stop and unregister this server.`);
  } catch (error) {
    console.error(`MCP registration failed: ${error.message}`);
    process.exitCode = 1;
    bridge.kill();
  }
});
bridge.on('error', (error) => {
  console.error(`Bridge failed: ${error.message}`);
  process.exitCode = 1;
});
bridge.on('close', (code, signal) => {
  process.stdin.pause();
  clearInterval(shellWatch);
  const exitSignal = stoppedBy ?? signal;
  process.exitCode ||= exitSignal ? 128 + constants.signals[exitSignal] : code ?? 1;
});
