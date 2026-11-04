import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeHarness() {
  const messages = [];
  const uiCalls = [];
  const timers = new Map();
  const storage = new Map();
  const fetches = [];
  const fetchOptions = [];
  let timerId = 0;
  const frame = { id: '1:1', name: 'Screen', type: 'FRAME', width: 200, height: 200, visible: true,
    resolvedVariableModes: {}, exportAsync: async () => ({ document: { id: '1:1', name: 'Screen', type: 'FRAME' } }) };
  const figma = {
    showUI: (html, options) => uiCalls.push({ html, options }),
    on() {}, notify() {},
    ui: { postMessage: (message, options) => messages.push({ message, options }) },
    clientStorage: {
      getAsync: async (key) => storage.get(key),
      setAsync: async (key, value) => storage.set(key, value),
    },
    currentPage: { name: 'Page', selection: [frame] },
  };
  const context = vm.createContext({
    figma, __html__: '<div>bundled</div>', console,
    URL,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, options) => {
      const requestUrl = String(url);
      fetches.push(requestUrl);
      fetchOptions.push(options);
      const port = Number(requestUrl.match(/:(\d+)\/(?:health|session|export)$/)?.[1]);
      if (port !== 3847) return { ok: false, status: 404 };
      if (requestUrl.endsWith('/health')) return { ok: true, json: async () => ({
        port, instanceId: 'a'.repeat(32), projectName: 'checkout', exportDirectoryName: 'exported', supportsShutdown: true,
        token: 'must-not-leak', project: '/private/user/project', pid: 1234,
      }) };
      if (requestUrl.endsWith('/session')) return { ok: true, json: async () => ({ token: 'session-secret' }) };
      if (requestUrl.endsWith('/export')) return { ok: true, status: 201, json: async () => ({ saved: 'screen-visible-only.json', assets: [] }) };
      return { ok: false, status: 404 };
    },
  });
  vm.runInContext(readFileSync(new URL('../exporter/code.js', import.meta.url), 'utf8'), context);
  return { figma, messages, uiCalls, timers, storage, fetches, fetchOptions };
}

const harness = makeHarness();
assert.equal(harness.uiCalls.length, 1, 'The bundled discovery UI opens first.');
assert.equal(harness.uiCalls[0].html, '<div>bundled</div>');
await harness.figma.ui.onmessage({ type: 'scan-bridges' });
assert.ok(harness.fetchOptions.every((options) => options.cache === 'no-store'), 'Discovery must bypass stale health responses on every run.');
const scan = harness.messages.find(({ message }) => message.type === 'bridge-results').message;
assert.deepEqual(JSON.parse(JSON.stringify(scan.projects)), [{
  port: 3847, projectName: 'checkout', exportDirectoryName: 'exported', supportsShutdown: true,
}]);
assert.ok(!JSON.stringify(scan).includes('must-not-leak'));
assert.ok(!JSON.stringify(scan).includes('/private/user/project'));

for (const url of [
  'https://localhost:3847',
  'http://127.0.0.1:3847',
  'http://localhost:3868',
  'http://localhost:3847/project',
  'http://localhost:3847/?token=secret',
]) {
  const count = harness.uiCalls.length;
  await harness.figma.ui.onmessage({ type: 'connect-to-bridge', url });
  assert.equal(harness.uiCalls.length, count, 'Invalid local URLs must not navigate the plugin UI.');
  assert.match(harness.messages.at(-1).message.error, /localhost.*3847.*3867/i);
}

await harness.figma.ui.onmessage({ type: 'connect-to-bridge', url: 'http://localhost:3847/' });
assert.equal(harness.uiCalls.length, 1, 'Selecting a helper must keep the existing plugin panel open.');
assert.ok(harness.fetches.includes('http://localhost:3847/session'), 'Selecting a helper opens a session without requiring a plugin ID.');
assert.equal(harness.messages.at(-1).message.type, 'connection-ready');
assert.equal(harness.messages.at(-1).message.url, 'http://localhost:3847');
assert.ok(!JSON.stringify(harness.messages).includes('session-secret'), 'The session token must stay out of plugin messages.');

await harness.figma.ui.onmessage({ type: 'get-connection-mode' });
assert.equal(harness.messages.at(-1).message.connectionMode, 'local-server');
assert.equal(harness.messages.at(-1).options, undefined);
await harness.figma.ui.onmessage({ type: 'set-connection-mode', connectionMode: 'download' });
assert.deepEqual([...harness.storage.entries()], [['connection-mode', 'download']]);

await harness.figma.ui.onmessage({ type: 'export-selection', connectionMode: 'local-server' });
assert.ok(harness.fetches.includes('http://localhost:3847/export'), 'The main thread writes to the selected bridge.');
const exportRequest = harness.fetchOptions.find((options, index) => harness.fetches[index].endsWith('/export'));
assert.equal(exportRequest.headers['X-Figma-Mcp-Token'], 'session-secret');
assert.equal(harness.messages.at(-1).message.type, 'export-complete');
assert.ok(!JSON.stringify(harness.messages).includes('session-secret'));
console.log('Per-run helper discovery, URL validation, in-panel server selection, no-ID connection, and main-thread exports passed.');
