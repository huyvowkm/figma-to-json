import { execFileSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import { codexConfig, readTools } from './codex-config.mjs';
import { forgetServer, processAlive, serverName, trackedServers } from './server-state.mjs';
import { removeRegistration } from './registration.mjs';
import { displayPath } from './display-path.mjs';

const serverScript = fileURLToPath(new URL('../server/dist/index.js', import.meta.url));
const configuredServers = () => JSON.parse(execFileSync('codex', ['mcp', 'list', '--json'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
})).filter((entry) => entry.transport?.args?.[0] === serverScript && entry.transport?.env?.FIGMA_CACHE_ROOT);

async function probe(port) {
  try {
    const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(700) });
    if (!response.ok) return { state: 'unknown' };
    const health = await response.json();
    if (typeof health.project !== 'string' || typeof health.exportDirectory !== 'string' || health.port !== port) return { state: 'unknown' };
    return { state: 'running', health };
  } catch (error) {
    return { state: error.cause?.code === 'ECONNREFUSED' ? 'closed' : 'unknown' };
  }
}

async function exportInfo(cacheDir) {
  try {
    const folder = join(cacheDir, 'exported');
    const entries = await readdir(folder, { withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map(async (entry) => {
      const info = await stat(join(folder, entry.name));
      return { file: entry.name, at: info.mtime.toISOString() };
    }));
    files.sort((a, b) => b.at.localeCompare(a.at));
    return { count: files.length, latest: files[0] ?? null };
  } catch { return { count: null, latest: null }; }
}

export async function serverStatus() {
  const records = trackedServers();
  const configured = configuredServers();
  const ports = new Set([...Array.from({ length: 21 }, (_, i) => 3847 + i), ...records.map((record) => record.port)]);
  if (process.env.FIGMA_MCP_PORT) ports.add(Number(process.env.FIGMA_MCP_PORT));
  const validPorts = [...ports].filter((port) => Number.isInteger(port) && port > 0 && port <= 65535);
  const [checks, settings] = await Promise.all([
    Promise.all(validPorts.map(async (port) => [port, await probe(port)])),
    codexConfig('config/read', { includeLayers: false }),
  ]);
  const probes = new Map(checks);
  const rows = new Map(records.map((record) => [record.name, { ...record, tracked: true }]));
  for (const entry of configured) {
    const previous = rows.get(entry.name);
    const cacheDir = resolve(entry.transport.env.FIGMA_CACHE_ROOT);
    rows.set(entry.name, { ...previous, name: entry.name, project: previous?.project ?? cacheDir.replace(/[\\/]\.figma-cache$/, ''), cacheDir, entry });
  }
  for (const [port, { health }] of probes) {
    if (!health) continue;
    const entry = configured.find((item) => resolve(item.transport.env.FIGMA_CACHE_ROOT, 'exported') === resolve(health.exportDirectory));
    const name = entry?.name ?? health.server ?? serverName(resolve(health.project));
    rows.set(name, { ...rows.get(name), name, project: health.project, cacheDir: resolve(health.exportDirectory, '..'),
      port, bridgePid: health.pid, launcherPid: health.launcherPid, instanceId: health.instanceId, startedAt: health.startedAt, healthy: true });
  }
  return await Promise.all([...rows.values()].sort((a, b) => a.name.localeCompare(b.name)).map(async (row) => {
    const check = probes.get(row.port);
    const alive = processAlive(row.bridgePid) || processAlive(row.launcherPid);
    const state = row.healthy ? 'running' : row.tracked && !alive && check?.state === 'closed' ? 'stopped' : row.tracked ? 'unresponsive' : 'untracked';
    const policy = settings.config.mcp_servers?.[row.name];
    const approved = row.entry ? readTools.filter((tool) => (policy?.tools?.[tool]?.approval_mode ?? policy?.default_tools_approval_mode) === 'approve').length : 0;
    return {
      name: row.name, project: row.project, cacheDir: row.cacheDir, state,
      port: row.port ?? null, bridgePid: row.bridgePid ?? null, launcherPid: row.launcherPid ?? null,
      startedAt: row.startedAt ?? null, instanceId: row.instanceId ?? null,
      registered: Boolean(row.entry), enabled: row.entry?.enabled ?? false,
      approvedTools: approved, totalTools: readTools.length,
      exports: await exportInfo(row.cacheDir),
    };
  }));
}

export async function stopServer(name, rows) {
  rows ??= await serverStatus();
  const row = rows.find((item) => item.name === name);
  if (!row) throw new Error(`Unknown server: ${name}. Run figma-mcp status to list names.`);
  if (row.state !== 'running') throw new Error(`${name} is ${row.state}; no running bridge was verified.`);
  const { health } = await probe(row.port);
  if (!health || resolve(health.project) !== resolve(row.project) || resolve(health.exportDirectory) !== resolve(row.cacheDir, 'exported') || health.instanceId !== row.instanceId) {
    throw new Error(`${name} changed since the last refresh. Refresh before stopping it.`);
  }
  if (!health.supportsShutdown) throw new Error(`${name} uses an older bridge. Stop it in its original terminal and restart the updated launcher.`);
  const response = await fetch(`http://localhost:${row.port}/shutdown`, {
    method: 'POST', headers: { 'X-Figma-Mcp-Token': health.token }, signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Shutdown rejected for ${name} (HTTP ${response.status}).`);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(150);
    const result = await probe(row.port);
    if (result.state === 'closed' && !configuredServers().some((entry) => entry.name === name)) return;
  }
  throw new Error(`${name}: shutdown requested, but completion is still pending. Check status again.`);
}

export async function cleanServers(name) {
  const rows = await serverStatus();
  const records = trackedServers();
  const removed = [];
  for (const row of rows.filter((item) => item.state === 'stopped' && (name === undefined || item.name === name))) {
    const record = records.find((item) => item.name === row.name && item.instanceId === row.instanceId);
    if (!record) continue;
    const entry = configuredServers().find((item) => item.name === row.name);
    if (entry && !isDeepStrictEqual(entry.transport, record.transport)) continue;
    // Recheck immediately before mutation; a timeout or a live PID is never stale proof.
    if ((await probe(record.port)).state !== 'closed' || processAlive(record.bridgePid) || processAlive(record.launcherPid)) continue;
    if (trackedServers().find((item) => item.name === record.name)?.instanceId !== record.instanceId) continue;
    if (entry) removeRegistration(record.name, record.transport);
    if (configuredServers().some((item) => item.name === record.name)) continue;
    forgetServer(record);
    removed.push(record.name);
  }
  return removed;
}

const plain = (value) => String(value ?? '-').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
export function printStatus(rows) {
  if (!rows.length) console.log('No local Figma servers found.');
  else console.table(rows.map((row, index) => ({
    '#': index + 1, Server: plain(row.name), Bridge: row.state, Port: row.port ?? '-',
    PID: row.bridgePid ?? '-', Codex: row.registered ? row.enabled ? 'registered' : 'disabled' : 'removed',
    Approvals: row.registered ? `${row.approvedTools}/${row.totalTools}` : '-',
    Exports: row.exports.count ?? '?', 'Last export': row.exports.latest?.at ?? '-', Project: plain(displayPath(row.project)),
  })));
  console.log('Bridge = export server. Codex reader processes and tools already loaded in sessions are separate.');
}

async function monitor() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('monitor needs an interactive terminal. Use status or status --json instead.');
  const { startMonitor } = await import('./monitor-app.mjs');
  await startMonitor({ loadServers: serverStatus, stopServer, cleanServers });
}

export async function manageServers(args) {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h') {
    console.log('Usage: run figma-mcp [--output-dir <folder>]\n       run figma-mcp status [--json]\n       run figma-mcp monitor\n       run figma-mcp stop <server-name>\n       run figma-mcp clean');
  } else if (command === 'status' && (rest.length === 0 || rest.length === 1 && rest[0] === '--json')) {
    const rows = await serverStatus();
    if (rest[0] === '--json') console.log(JSON.stringify(rows, null, 2));
    else printStatus(rows);
  } else if (command === 'monitor' && !rest.length) await monitor();
  else if (command === 'stop' && rest.length === 1) { await stopServer(rest[0]); console.log(`Stopped ${rest[0]}.`); }
  else if (command === 'clean' && !rest.length) console.log(`Cleaned: ${(await cleanServers()).join(', ') || 'nothing stale'}.`);
  else throw new Error(`Invalid arguments. Run figma-mcp --help for usage.`);
}
