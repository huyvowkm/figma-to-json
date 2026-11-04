import assert from 'node:assert/strict';
import { mkdtempSync, statSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { readBridgeState } from '../bin/bridge-state.mjs';

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
  assert.ok(!output.includes('Token:'), 'The helper must not print the local token.');
  for (const folder of ['assets', 'exported']) {
    if (!statSync(join(cache, folder)).isDirectory()) throw new Error(`Startup did not create ${folder}.`);
  }
  const healthResponse = await fetch(`http://localhost:${port}/health`);
  assert.equal(healthResponse.headers.get('access-control-allow-origin'), '*', 'Discovery metadata must remain readable by the plugin.');
  assert.equal(healthResponse.headers.get('cache-control'), 'no-store', 'Discovery must report the active helpers on each run.');
  const health = await healthResponse.json();
  assert.deepEqual(Object.keys(health).sort(), ['exportDirectoryName', 'instanceId', 'port', 'projectName', 'supportsShutdown'].sort());
  assert.equal(health.projectName, basename(root));
  assert.equal(health.exportDirectoryName, 'exported');
  assert.equal(health.port, port);
  assert.equal(typeof health.instanceId, 'string');
  const localState = readBridgeState(health.instanceId);
  assert.equal(localState?.token?.length, 48, 'The helper must keep its token in private local state.');
  assert.equal(localState?.project, root);
  assert.equal(localState?.exportDirectory, join(cache, 'exported'));
  assert.equal(typeof localState?.bridgePid, 'number');
  assert.equal(typeof localState?.launcherPid, 'number');
  const token = localState.token;
  const activeProject = {
    name: health.projectName,
    url: `http://localhost:${health.port}`,
  };
  if (activeProject.name !== basename(root) || activeProject.url !== `http://localhost:${port}`) {
    throw new Error('Health response could not produce the active project connection.');
  }
  const manualConnection = { url: `http://localhost:${port}` };
  assert.equal(manualConnection.url, activeProject.url, 'Manual fallback only needs the local server URL.');
  const origin = manualConnection.url;
  const sessionResponse = await fetch(`${origin}/session`, { headers: { Origin: 'null' } });
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.headers.get('access-control-allow-origin'), '*', 'The bundled Figma plugin flow requires wildcard CORS for its null origin.');
  assert.equal((await sessionResponse.json()).token, token);
  const exposedSession = await fetch(`${origin}/session`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(exposedSession.status, 200);
  assert.equal(exposedSession.headers.get('access-control-allow-origin'), '*', 'The legacy flow exposes the local session to cross-origin pages.');
  const sessionPreflight = await fetch(`${origin}/session`, { method: 'OPTIONS', headers: { Origin: 'null' } });
  assert.equal(sessionPreflight.headers.get('access-control-allow-origin'), '*');
  const uiResponse = await fetch(`${origin}/plugin-ui`);
  assert.equal(uiResponse.status, 404, 'The bundled UI stays in place; selection does not navigate to the bridge.');
  assert.equal(uiResponse.headers.get('access-control-allow-origin'), null);
  const hiddenRoute = await fetch(`${origin}/../package.json`);
  assert.notEqual(hiddenRoute.status, 200, 'The helper must not expose arbitrary project files.');

  const wrongHost = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: 'localhost', port }, () => {
      socket.write(`GET /session HTTP/1.1\r\nHost: attacker.example:${port}\r\nOrigin: ${origin}\r\nConnection: close\r\n\r\n`);
    });
    let response = '';
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Host validation request timed out.')); });
    socket.on('data', (chunk) => { response += chunk.toString(); });
    socket.on('end', () => resolve(response));
    socket.on('error', reject);
  });
  assert.match(wrongHost, /^HTTP\/1\.1 403/);

  const forbidden = await fetch(`${origin}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (forbidden.status !== 403) throw new Error(`Unauthenticated export was not rejected: ${forbidden.status}`);
  const crossOriginExport = await fetch(`${origin}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Design-Export-Token': token, Origin: 'null' }, body: JSON.stringify({ filename: 'cross-origin.json', payload: { ok: true } }) });
  assert.equal(crossOriginExport.status, 201);
  assert.equal(crossOriginExport.headers.get('access-control-allow-origin'), '*');
  assert.equal(statSync(join(cache, 'exported')).isDirectory(), true);
  const preflight = await fetch(`${origin}/export`, { method: 'OPTIONS', headers: { Origin: 'null', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-design-export-token' } });
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-headers') ?? '', /x-design-export-token/i);
  const wrongShutdown = await fetch(`${origin}/shutdown`, {
    method: 'POST', headers: { 'X-Figma-Mcp-Token': token, Origin: 'https://attacker.example' },
  });
  assert.equal(wrongShutdown.status, 403);
  assert.equal(wrongShutdown.headers.get('access-control-allow-origin'), null);

  const filesBeforeOversize = readdirSync(join(cache, 'exported')).sort();
  const oversizeResponse = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: 'localhost', port }, () => {
      socket.write(`POST /export HTTP/1.1\r\nHost: localhost:${port}\r\nContent-Type: application/json\r\nX-Design-Export-Token: ${token}\r\nContent-Length: ${128 * 1024 * 1024 + 1}\r\nConnection: close\r\n\r\n`);
    });
    let response = '';
    socket.setTimeout(3000, () => { socket.destroy(); reject(new Error('Oversize request was not rejected before reading its body.')); });
    socket.on('data', (chunk) => {
      response += chunk.toString();
      if (/^HTTP\/1\.1 413/m.test(response)) { socket.destroy(); resolve(response); }
    });
    socket.on('error', (error) => { if (error.code !== 'ECONNRESET') reject(error); });
  });
  assert.match(oversizeResponse, /^HTTP\/1\.1 413/m);
  assert.deepEqual(readdirSync(join(cache, 'exported')).sort(), filesBeforeOversize, 'Oversize request must not write files.');

  const saved = await fetch(`${manualConnection.url}/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Design-Export-Token': token }, body: JSON.stringify({ filename: 'test.json', payload: { ok: true } }) });
  if (saved.status !== 201) throw new Error(`Export endpoint failed: ${await saved.text()}`);
  if (JSON.parse(readFileSync(join(cache, 'exported', 'test.json'), 'utf8')).ok !== true) throw new Error('Export file content was incorrect.');
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
  const exportPreview = (base64 = png) => fetch(`${manualConnection.url}/export`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Design-Export-Token': token },
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
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Design-Export-Token': token },
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
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Design-Export-Token': token },
      body: JSON.stringify({ filename: 'images.json', payload: { ok: true }, assets: [{ filename: 'image-photo.png', base64: bytes.toString('base64') }] }),
    });
    if (response.status !== 201 || !readFileSync(join(cache, 'assets', 'image-photo.png')).equals(bytes)) throw new Error('Raster image was not overwritten.');
  }
  if (!statSync(join(cache, 'exported', 'images-2.json')).isFile()) throw new Error('Repeated image export did not preserve its earlier frame file.');
  console.log('Bridge startup, redacted discovery, cross-origin Figma sessions/exports, protected shutdown, size limits, PNG numbering, SVG and image replacement passed.');
} finally {
  child.kill();
  rmSync(root, { recursive: true, force: true });
}
