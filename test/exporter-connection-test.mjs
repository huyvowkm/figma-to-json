import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function makeHarness(pluginId = 'test-plugin-id') {
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
    ...(pluginId ? { pluginId } : {}),
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
      fetches.push(String(url));
      fetchOptions.push(options);
      const port = Number(String(url).match(/:(\d+)\/health$/)?.[1]);
      if (port !== 3847) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({
        port, instanceId: 'a'.repeat(32), projectName: 'checkout', exportDirectoryName: 'exported', supportsShutdown: true,
        token: 'must-not-leak', project: '/private/user/project', pid: 1234,
      }) };
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
assert.equal(harness.uiCalls.length, 2);
assert.match(harness.uiCalls[1].html, /http:\/\/localhost:3847\/plugin-ui\?pluginId=test-plugin-id/);
assert.equal(harness.timers.size, 1, 'A local UI load timeout provides a recovery path.');
await harness.figma.ui.onmessage({ type: 'local-ui-ready' });
assert.equal(harness.timers.size, 0);

await harness.figma.ui.onmessage({ type: 'get-connection-mode' });
assert.equal(harness.messages.at(-1).message.connectionMode, 'local-server');
assert.equal(harness.messages.at(-1).options.origin, 'http://localhost:3847');
await harness.figma.ui.onmessage({ type: 'set-connection-mode', connectionMode: 'download' });
assert.deepEqual([...harness.storage.entries()], [['connection-mode', 'download']]);

await harness.figma.ui.onmessage({ type: 'export-selection', connectionMode: 'local-server' });
const pendingSave = harness.messages.find(({ message }) => message.type === 'save-exports');
assert.ok(pendingSave, 'The plugin sends export data to the selected local UI for same-origin saving.');
assert.equal(pendingSave.options.origin, 'http://localhost:3847');
assert.equal(pendingSave.message.entries[0].filename, 'screen-visible-only.json');
assert.ok(!JSON.stringify(pendingSave).includes('token'));
assert.ok(!JSON.stringify(pendingSave).includes('bridge'));
assert.ok(!harness.fetches.some((url) => url.endsWith('/export')));

const navigationTimeout = makeHarness();
await navigationTimeout.figma.ui.onmessage({ type: 'connect-to-bridge', url: 'http://localhost:3847' });
const pendingNavigation = [...navigationTimeout.timers.values()][0];
pendingNavigation.callback();
assert.equal(navigationTimeout.uiCalls.length, 3, 'A stalled local UI navigation returns to the bundled UI.');
assert.equal(navigationTimeout.uiCalls.at(-1).html, '<div>bundled</div>');
assert.equal(navigationTimeout.messages.some(({ message }) => message.type === 'connection-error'), false,
  'The recovery message waits until the bundled UI is ready to receive it.');
await navigationTimeout.figma.ui.onmessage({ type: 'get-connection-mode' });
assert.match(navigationTimeout.messages.at(-1).message.error, /local connection screen did not load/i);
assert.equal(navigationTimeout.messages.at(-1).options, undefined);

const withoutPluginId = makeHarness('');
await withoutPluginId.figma.ui.onmessage({ type: 'connect-to-bridge', url: 'http://localhost:3847' });
assert.equal(withoutPluginId.uiCalls.length, 1, 'Without an assigned plugin ID, the plugin must stay on the bundled UI.');
assert.match(withoutPluginId.messages.at(-1).message.error, /Figma-assigned plugin ID/i);
console.log('Local helper discovery, URL validation, assigned-ID navigation, message origins, and token-free main-thread exports passed.');
