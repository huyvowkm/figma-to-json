import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const root = mkdtempSync(join(tmpdir(), 'figma-port-retry-'));
const cache = join(root, '.figma-cache');
mkdirSync(join(cache, 'exported'), { recursive: true });
const blocker = http.createServer((req, res) => { res.writeHead(404); res.end(); });
await new Promise((resolve, reject) => {
  blocker.once('error', (error) => error.code === 'EADDRINUSE' ? resolve() : reject(error));
  blocker.listen(3847, 'localhost', resolve);
});
const env = { ...process.env };
delete env.FIGMA_MCP_PORT;
const child = spawn(process.execPath, [new URL('../bin/bridge.mjs', import.meta.url).pathname, root, cache], { env });
let output = '';
let errors = '';
child.stdout.on('data', (chunk) => output += chunk);
child.stderr.on('data', (chunk) => errors += chunk);

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Startup timed out: ${errors}`)), 10000);
    child.stdout.on('data', () => {
      if (output.includes('Export folder:')) { clearTimeout(timeout); resolve(); }
    });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error(`Bridge exited: ${errors}`)); });
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
  });
  // Allow any additional startup callbacks to flush their output before checking it.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const ready = [...output.matchAll(/Figma bridge ready: http:\/\/localhost:(\d+)/g)];
  assert.equal(ready.length, 1, 'Port retries must print exactly one ready message');
  const port = Number(ready[0][1]);
  assert.notEqual(port, 3847, 'The bridge must skip the occupied port');
  assert.equal((output.match(/Token:/g) || []).length, 1);
  assert.equal((output.match(/Export folder:/g) || []).length, 1);
  const health = await fetch(`http://localhost:${port}/health`).then((response) => response.json());
  assert.equal(health.port, port);
  assert.equal(health.project, root);
  assert.equal(health.exportDirectory, join(cache, 'exported'));
  console.log('Occupied-port retry reports one accurate URL, token, and export folder.');
} finally {
  const stopped = once(child, 'close');
  child.kill();
  await stopped;
  if (blocker.listening) await new Promise((resolve) => blocker.close(resolve));
  rmSync(root, { recursive: true, force: true });
}
