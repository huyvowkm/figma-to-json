import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { removeRegistration } from './registration.mjs';
import { readBridgeState, removeBridgeState, writeBridgeState } from './bridge-state.mjs';
import { readLimitedBody } from './read-limited-body.mjs';

let registration;
process.on('message', (message) => {
  if (message.type === 'registration') registration = message;
});
process.once('disconnect', () => {
  if (registration) removeRegistration(registration.server, registration.transport);
  process.exit(process.exitCode ?? 0);
});

const [root, cache] = process.argv.slice(2);
for (const folder of ['assets', 'exported']) mkdirSync(join(cache, folder), { recursive: true });
const token = randomBytes(24).toString('hex');
const instanceId = randomBytes(16).toString('hex');
const startedAt = new Date().toISOString();
const preferredPort = Number(process.env.FIGMA_MCP_PORT ?? 3847);
const exportCorsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Figma-Mcp-Token',
};
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(body));
};
const localOrigin = () => `http://localhost:${bridge.address()?.port}`;
const localHost = () => `localhost:${bridge.address()?.port}`;
function isLocalHost(req) {
  const host = req.headers.host;
  return !host || host.toLowerCase() === localHost();
}
function isLocalRequest(req) {
  const host = req.headers.host;
  const origin = req.headers.origin;
  const site = req.headers['sec-fetch-site'];
  return (!host || host.toLowerCase() === localHost())
    && (origin === undefined || origin === localOrigin())
    && (site === undefined || site === 'same-origin');
}
function writeUniqueJson(filename, payload, preview) {
  const outputDir = join(cache, 'exported');
  const base = filename.slice(0, -'.json'.length);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? filename : `${base}-${suffix}.json`;
    const previewName = `${candidate.slice(0, -5)}.png`;
    let previewWritten = false;
    try {
      if (preview) {
        writeFileSync(join(outputDir, previewName), preview, { flag: 'wx' });
        previewWritten = true;
      }
      const savedPayload = preview ? { ...payload, preview: { file: previewName, mimeType: 'image/png' } } : payload;
      writeFileSync(join(outputDir, candidate), JSON.stringify(savedPayload, null, 2), { flag: 'wx' });
      return { saved: candidate, ...(preview ? { preview: previewName } : {}) };
    } catch (error) {
      if (previewWritten) unlinkSync(join(outputDir, previewName));
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}
function writeAssets(assets) {
  if (!Array.isArray(assets)) throw new Error('Invalid assets payload');
  const outputDir = join(cache, 'assets');
  mkdirSync(outputDir, { recursive: true });
  const saved = [];
  for (const asset of assets) {
    if (!asset || typeof asset.filename !== 'string' || !/^(?:image|icon)-[a-z0-9_-]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|bin)$/i.test(asset.filename) || typeof asset.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) {
      throw new Error('Invalid image asset');
    }
    const bytes = Buffer.from(asset.base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== asset.base64) throw new Error(`Invalid image data for ${asset.filename}`);
    writeFileSync(join(outputDir, asset.filename), bytes);
    saved.push(asset.filename);
  }
  return saved;
}
const bridge = http.createServer((req, res) => {
  const path = req.url?.split('?')[0];
  if (req.method === 'OPTIONS' && path === '/health') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
    res.end();
    return;
  }
  if (req.method === 'OPTIONS' && path === '/session') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET' });
    res.end();
    return;
  }
  if (req.method === 'OPTIONS' && path === '/export') {
    res.writeHead(204, exportCorsHeaders);
    res.end();
    return;
  }
  if (req.method === 'GET' && path === '/health') return send(res, 200, {
    projectName: basename(resolve(root)),
    exportDirectoryName: basename(join(cache, 'exported')),
    port: bridge.address()?.port,
    instanceId,
    supportsShutdown: true,
  }, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  if (req.method === 'GET' && path === '/session') {
    if (!isLocalHost(req)) {
      req.resume();
      return send(res, 403, { error: 'Forbidden' });
    }
    return send(res, 200, { token }, { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  }
  if (req.method === 'POST' && path === '/shutdown') {
    if (!isLocalRequest(req) || req.headers['x-figma-mcp-token'] !== token) {
      req.resume();
      return send(res, 403, { error: 'Forbidden' });
    }
    res.once('finish', () => setImmediate(() => {
      bridge.close(() => process.exit(0));
      bridge.closeIdleConnections();
    }));
    send(res, 200, { stopping: true });
    return;
  }
  if (req.method === 'POST' && path === '/export') {
    if (!isLocalHost(req) || req.headers['x-figma-mcp-token'] !== token) {
      req.resume();
      return send(res, 403, { error: 'Forbidden' }, exportCorsHeaders);
    }
    readLimitedBody(req).then((raw) => {
      try {
        const { filename, payload, assets = [], preview } = JSON.parse(raw);
        if (!/^[a-z0-9-]+\.json$/i.test(filename)) throw new Error('Invalid filename');
        let previewBytes;
        if (preview !== undefined) {
          if (!preview || typeof preview.base64 !== 'string') throw new Error('Invalid preview');
          previewBytes = Buffer.from(preview.base64, 'base64');
          if (previewBytes.toString('base64') !== preview.base64 || !previewBytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG preview');
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Preview requires an object payload');
        }
        const savedAssets = writeAssets(assets);
        const saved = writeUniqueJson(filename, payload, previewBytes);
        send(res, 201, { ...saved, assets: savedAssets }, exportCorsHeaders);
      } catch (error) { send(res, 400, { error: String(error) }, exportCorsHeaders); }
    }).catch((error) => {
      if (error.code === 'PAYLOAD_TOO_LARGE') return send(res, 413, { error: error.message }, exportCorsHeaders);
      send(res, 400, { error: String(error) }, exportCorsHeaders);
    });
    return;
  }
  req.resume();
  send(res, 404, { error: 'Not found' });
});
function privateState() {
  return {
    token,
    instanceId,
    project: resolve(root),
    exportDirectory: resolve(join(cache, 'exported')),
    port: bridge.address()?.port,
    bridgePid: process.pid,
    launcherPid: process.ppid,
    startedAt,
    server: registration?.server,
    supportsShutdown: true,
  };
}
bridge.once('listening', () => {
  writeBridgeState(privateState());
  process.once('exit', () => removeBridgeState(instanceId));
  process.send?.({ type: 'ready', port: bridge.address().port, pid: process.pid, instanceId, startedAt });
  console.log(`Figma bridge ready: http://localhost:${bridge.address().port}\nExport folder: ${join(cache, 'exported')}`);
});
function listen(port) {
  bridge.once('error', async (error) => {
    if (!process.env.FIGMA_MCP_PORT && error.code === 'EADDRINUSE') {
      try {
        const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          const existing = await response.json();
          const existingState = typeof existing.instanceId === 'string' ? readBridgeState(existing.instanceId) : null;
          const existingProject = existingState?.project ?? existing.project;
          const existingExportDirectory = existingState?.exportDirectory ?? existing.exportDirectory;
          if (typeof existingProject === 'string' && resolve(existingProject) === resolve(root)) {
            if (typeof existingExportDirectory === 'string' && resolve(existingExportDirectory) === resolve(join(cache, 'exported'))) {
              console.log(`Figma bridge already running: http://localhost:${port}\nExport folder: ${join(cache, 'exported')}`);
              process.exit(0);
            }
            console.error(`A bridge for this project is already running at http://localhost:${port} with a different export folder (${existingExportDirectory}). Stop it before restarting this helper.`);
            process.exit(1);
          }
        }
      } catch {}
      if (port < 3867) return listen(port + 1);
    }
    console.error(`Bridge failed: ${error.message}`); process.exit(1);
  });
  bridge.listen(port, 'localhost');
}
listen(preferredPort);
