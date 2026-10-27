import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [root, cache] = process.argv.slice(2);
const token = randomBytes(24).toString('hex');
const preferredPort = Number(process.env.FIGMA_MCP_PORT ?? 3847);
const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Figma-Mcp-Token' });
  res.end(JSON.stringify(body));
};
function writeUniqueJson(filename, payload) {
  const outputDir = join(cache, 'exported');
  const base = filename.slice(0, -'.json'.length);
  for (let suffix = 1; ; suffix += 1) {
    const candidate = suffix === 1 ? filename : `${base}-${suffix}.json`;
    try {
      writeFileSync(join(outputDir, candidate), JSON.stringify(payload, null, 2), { flag: 'wx' });
      return candidate;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
}
function writeAssets(assets) {
  if (!Array.isArray(assets)) throw new Error('Invalid assets payload');
  if (!assets.length) return [];
  const outputDir = join(cache, 'assets');
  mkdirSync(outputDir, { recursive: true });
  const saved = [];
  for (const asset of assets) {
    if (!asset || typeof asset.filename !== 'string' || !/^(?:image|icon)-[a-z0-9_-]+\.(?:png|jpe?g|gif|webp|avif|svg|bmp|tiff?|bin)$/i.test(asset.filename) || typeof asset.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(asset.base64)) {
      throw new Error('Invalid image asset');
    }
    const bytes = Buffer.from(asset.base64, 'base64');
    if (!bytes.length || bytes.toString('base64') !== asset.base64) throw new Error(`Invalid image data for ${asset.filename}`);
    if (asset.overwrite === true) writeFileSync(join(outputDir, asset.filename), bytes);
    else {
      try { writeFileSync(join(outputDir, asset.filename), bytes, { flag: 'wx' }); }
      catch (error) { if (error?.code !== 'EEXIST') throw error; }
    }
    saved.push(asset.filename);
  }
  return saved;
}
const bridge = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { project: root, exportDirectory: join(cache, 'exported'), port: bridge.address()?.port, token });
  if (req.method !== 'POST' || req.url !== '/export' || req.headers['x-figma-mcp-token'] !== token) return send(res, 403, { error: 'Forbidden' });
  let raw = ''; req.on('data', (chunk) => raw += chunk); req.on('end', () => {
    try {
      const { filename, payload, assets = [] } = JSON.parse(raw);
      if (!/^[a-z0-9-]+\.json$/i.test(filename)) throw new Error('Invalid filename');
      const savedAssets = writeAssets(assets);
      const saved = writeUniqueJson(filename, payload);
      send(res, 201, { saved, assets: savedAssets });
    } catch (error) { send(res, 400, { error: String(error) }); }
  });
});
function listen(port) {
  bridge.once('error', async (error) => {
    if (!process.env.FIGMA_MCP_PORT && error.code === 'EADDRINUSE') {
      try {
        const response = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(500) });
        if (response.ok) {
          const existing = await response.json();
          if (resolve(existing.project) === resolve(root)) {
            if (resolve(existing.exportDirectory) === resolve(join(cache, 'exported'))) {
              console.log(`Figma bridge already running: http://localhost:${port}\nExport folder: ${join(cache, 'exported')}`);
              process.exit(0);
            }
            console.error(`A bridge for this project is already running at http://localhost:${port} with a different export folder (${existing.exportDirectory}). Stop it before restarting this helper.`);
            process.exit(1);
          }
        }
      } catch {}
      if (port < 3867) return listen(port + 1);
    }
    console.error(`Bridge failed: ${error.message}`); process.exit(1);
  });
  bridge.listen(port, 'localhost', () => console.log(`Figma bridge ready: http://localhost:${port}\nToken: ${token}\nExport folder: ${join(cache, 'exported')}`));
}
listen(preferredPort);
