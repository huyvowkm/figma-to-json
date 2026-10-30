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
  const saveIcon = (content) => fetch(`${manualConnection.url}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': token },
    body: JSON.stringify({ filename: 'icons.json', payload: { assets: [{ file: '../assets/icon-search.svg' }], figma: { document: { id: '1:1', svgAsset: '../assets/icon-search.svg' } } },
      assets: [{ filename: 'icon-search.svg', base64: Buffer.from(content).toString('base64') }] }),
  });
  if ((await saveIcon('<svg>old</svg>')).status !== 201) throw new Error('SVG export failed.');
  const originalFrame = readFileSync(join(cache, 'exported', 'icons.json'), 'utf8');
  const changed = await saveIcon('<svg>changed</svg>');
  const changedResult = await changed.json();
  if (changed.status !== 201 || changedResult.saved !== 'icons-2.json' || changedResult.assets[0] !== 'icon-search.svg') throw new Error('Asset replacement or numbered frame naming failed.');
  if (readFileSync(join(cache, 'assets', 'icon-search.svg'), 'utf8') !== '<svg>changed</svg>') throw new Error('SVG was not overwritten.');
  if (readFileSync(join(cache, 'exported', 'icons.json'), 'utf8') !== originalFrame) throw new Error('Previous frame JSON was overwritten.');
  const iconPayload = JSON.parse(readFileSync(join(cache, 'exported', 'icons-2.json'), 'utf8'));
  if (iconPayload.assets[0].file !== '../assets/icon-search.svg' || iconPayload.figma.document.svgAsset !== '../assets/icon-search.svg') throw new Error('SVG references did not retain their simple name.');
  const imageBytes = Buffer.from(png, 'base64');
  for (const bytes of [imageBytes, Buffer.concat([imageBytes, Buffer.from('updated')])]) {
    const response = await fetch(`${manualConnection.url}/export`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Figma-Mcp-Token': token },
      body: JSON.stringify({ filename: 'images.json', payload: { ok: true }, assets: [{ filename: 'image-photo.png', base64: bytes.toString('base64') }] }),
    });
    if (response.status !== 201 || !readFileSync(join(cache, 'assets', 'image-photo.png')).equals(bytes)) throw new Error('Raster image was not overwritten.');
  }
  if (!statSync(join(cache, 'exported', 'images-2.json')).isFile()) throw new Error('Repeated image export did not preserve its earlier frame file.');
  console.log('Bridge startup, protected frame/PNG numbering, SVG and image replacement, and asset references passed.');
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
