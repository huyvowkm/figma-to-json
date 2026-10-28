import { mkdtempSync, statSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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
  for (const folder of ['assets', 'exported']) {
    if (!statSync(join(cache, folder)).isDirectory()) throw new Error(`Startup did not create ${folder}.`);
  }
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
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  const exportPreview = (base64 = png) => fetch(`${manualConnection.url}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': token },
    body: JSON.stringify({ filename: 'test.json', payload: { ok: true, preview: { file: 'old-name.png' } }, preview: { base64 } }),
  });
  const second = await exportPreview().then((response) => response.json());
  if (second.saved !== 'test-2.json' || second.preview !== 'test-2.png') throw new Error('JSON and PNG suffixes did not match.');
  const secondPayload = JSON.parse(readFileSync(join(cache, 'exported', second.saved), 'utf8'));
  if (secondPayload.preview.file !== second.preview) throw new Error('Saved JSON did not reference its numbered PNG.');
  const third = await exportPreview().then((response) => response.json());
  if (third.saved !== 'test-3.json' || third.preview !== 'test-3.png') throw new Error('Repeated preview export overwrote files.');
  if (readFileSync(join(cache, 'exported', second.preview)).toString('base64') !== png) throw new Error('Saved preview bytes changed.');
  writeFileSync(join(cache, 'exported', 'test-4.png'), 'keep this orphan');
  const orphan = await exportPreview().then((response) => response.json());
  if (orphan.saved !== 'test-5.json' || readFileSync(join(cache, 'exported', 'test-4.png'), 'utf8') !== 'keep this orphan') throw new Error('Existing orphan PNG was overwritten.');
  if ((await exportPreview(Buffer.from('not PNG').toString('base64'))).status !== 400) throw new Error('Invalid PNG was accepted.');
  const saveIcon = (content, filename = 'icon-search-1-aabbcc.svg', overwrite = false) => fetch(`${manualConnection.url}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': token },
    body: JSON.stringify({ filename: 'icons.json', payload: { assets: [{ file: `../assets/${filename}` }] },
      assets: [{ filename, base64: Buffer.from(content).toString('base64'), overwrite }] }),
  });
  if ((await saveIcon('<svg>old</svg>')).status !== 201) throw new Error('SVG export failed.');
  if ((await saveIcon('<svg>old</svg>')).status !== 201) throw new Error('Identical SVG was not reused.');
  if ((await saveIcon('<svg>changed</svg>', 'icon-search-1-aabbcc.svg', true)).status !== 400) throw new Error('Existing SVG could be overwritten.');
  if (readFileSync(join(cache, 'assets', 'icon-search-1-aabbcc.svg'), 'utf8') !== '<svg>old</svg>') throw new Error('Previous SVG content changed.');
  if ((await saveIcon('<svg>changed</svg>', 'icon-search-1-ddeeff.svg')).status !== 201) throw new Error('New SVG revision could not be saved.');
  const iconPayload = JSON.parse(readFileSync(join(cache, 'exported', 'icons-3.json'), 'utf8'));
  if (iconPayload.assets[0].file !== '../assets/icon-search-1-ddeeff.svg') throw new Error('SVG revision reference was incorrect.');
  console.log('Bridge discovery, authentication, PNG pairs, asset reuse, immutable SVG revisions, and collision checks passed.');
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
