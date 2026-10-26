import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = mkdtempSync(join(tmpdir(), 'figma-mcp-test-'));
const cache = join(root, '.figma-cache');
const port = 39000 + Math.floor(Math.random() * 1000);
const toolRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(toolRoot, 'exporter', 'manifest.json'), 'utf8'));
if (!manifest.networkAccess.allowedDomains.every((domain) => domain.endsWith('/'))) {
  throw new Error('Manifest must allow /health and /export paths with trailing slashes.');
}
const ui = readFileSync(join(toolRoot, 'exporter', 'ui.html'), 'utf8');
if (ui.includes('localStorage')) throw new Error('Plugin UI must not depend on browser localStorage.');
mkdirSync(join(cache, 'exported'), { recursive: true });
const child = spawn('node', [new URL('../bin/bridge.mjs', import.meta.url).pathname, root, cache], { env: { ...process.env, FIGMA_MCP_PORT: String(port) } });
let output = '';
child.stdout.on('data', (chunk) => output += chunk);
let errors = '';
child.stderr.on('data', (chunk) => errors += chunk);

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Bridge did not start: ${errors}`)), 3000);
    child.stdout.on('data', () => {
      if (output.includes('Figma bridge ready:')) {
        clearTimeout(timeout);
        resolve(undefined);
      }
    });
    child.on('exit', () => {
      clearTimeout(timeout);
      reject(new Error(`Bridge exited before starting: ${errors}`));
    });
  });
  const token = output.match(/Token: ([a-f0-9]+)/)?.[1];
  if (!token) throw new Error('Bridge did not print a token.');
  const health = await fetch(`http://localhost:${port}/health`).then((response) => response.json());
  if (health.project !== root) throw new Error('Health endpoint returned the wrong project.');
  if (health.port !== port || health.token !== token) throw new Error('Health endpoint did not return a selectable bridge.');
  const activeProject = {
    name: health.project.split('/').pop(),
    url: `http://localhost:${health.port}`,
    token: health.token,
  };
  if (activeProject.name !== root.split('/').pop() || activeProject.url !== `http://localhost:${port}` || activeProject.token !== token) {
    throw new Error('Health response could not produce the plugin active-project entry.');
  }
  const manualConnection = { url: `http://localhost:${port}`, token };
  if (manualConnection.url !== activeProject.url || manualConnection.token !== activeProject.token) {
    throw new Error('Manual connection values would not match the active bridge.');
  }
  const forbidden = await fetch(`http://localhost:${port}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (forbidden.status !== 403) throw new Error(`Unauthenticated export was not rejected: ${forbidden.status}`);
  const saved = await fetch(`${manualConnection.url}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': manualConnection.token }, body: JSON.stringify({ filename: 'test.json', payload: { ok: true } }) });
  if (saved.status !== 201) throw new Error(`Export endpoint failed: ${await saved.text()}`);
  if (JSON.parse(readFileSync(join(cache, 'exported', 'test.json'), 'utf8')).ok !== true) throw new Error('Export file content was incorrect.');
  console.log('Plugin active-project, manual connection, bridge health, authentication, and export test passed.');
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
