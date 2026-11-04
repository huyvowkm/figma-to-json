import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const pluginMessages = [];
const requests = [];
const toMain = [];
const toUi = [];
let activePorts = new Set([3847]);
let uiContext;
const frame = {
  id: '1:1', name: 'Screen', type: 'FRAME', width: 200, height: 200, visible: true,
  parent: null, resolvedVariableModes: {}, componentProperties: {},
  exportAsync: async () => ({ document: { id: '1:1', name: 'Screen', type: 'FRAME' } }),
};
const figma = {
  showUICalls: [],
  showUI(html, options) { this.showUICalls.push({ html, options }); },
  on() {}, notify() {},
  ui: {
    postMessage(message) {
      pluginMessages.push(message);
      if (uiContext?.onmessage) toUi.push(uiContext.onmessage({ data: { pluginMessage: message } }));
    },
  },
  clientStorage: { getAsync: async () => undefined, setAsync: async () => undefined },
  currentPage: { name: 'Page', selection: [frame] },
};

const mainContext = vm.createContext({
  figma,
  __html__: '<div>bundled</div>',
  console,
  Uint8Array,
  setTimeout,
  clearTimeout,
  fetch: async (url, options = {}) => {
    const requestUrl = String(url);
    requests.push({ url: requestUrl, options });
    const port = Number(requestUrl.match(/:(\d+)\/(?:health|session|export)$/)?.[1]);
    if (!activePorts.has(port)) return { ok: false, status: 404, json: async () => ({}) };
    if (requestUrl.endsWith('/health')) return {
      ok: true,
      json: async () => ({ port, projectName: `checkout-${port}`, exportDirectoryName: 'exported', supportsShutdown: true }),
    };
    if (requestUrl.endsWith('/session')) return { ok: true, json: async () => ({ token: `private-session-token-${port}` }) };
    return { ok: false, status: 404, json: async () => ({}) };
  },
});
vm.runInContext(readFileSync(new URL('../exporter/code.js', import.meta.url), 'utf8'), mainContext);

class Element {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.hidden = false;
    this.checked = false;
    this.value = '';
    this.textContent = '';
    this.className = '';
    this.disabled = false;
  }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
}
const elements = new Map();
const radios = [new Element(), new Element()];
radios[0].value = 'local-server';
radios[1].value = 'download';
const document = {
  getElementById(id) {
    if (!elements.has(id)) {
      const element = new Element();
      if (id === 'export-mode') element.value = 'visible-only';
      if (id === 'asset-mode') element.value = 'json-only';
      if (id === 'preview-mode') element.value = 'none';
      elements.set(id, element);
    }
    return elements.get(id);
  },
  querySelectorAll(selector) { return selector.includes('connection-mode') ? radios : []; },
  createElement() { return new Element(); },
};
const html = readFileSync(new URL('../exporter/ui.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script);
uiContext = vm.createContext({
  document,
  parent: {
    postMessage(message, targetOrigin) {
      assert.equal(targetOrigin, '*');
      toMain.push(figma.ui.onmessage(message.pluginMessage));
    },
  },
  location: { origin: 'null', search: '' },
  URL,
  URLSearchParams,
  Blob,
  AbortController,
  atob,
  console,
  setTimeout,
  clearTimeout,
});
vm.runInContext(script, uiContext);

async function settleMessages() {
  for (let pass = 0; pass < 20; pass++) {
    const mainJobs = toMain.splice(0);
    const uiJobs = toUi.splice(0);
    if (!mainJobs.length && !uiJobs.length) return;
    await Promise.all([...mainJobs, ...uiJobs]);
  }
  throw new Error('Plugin/UI messages did not settle.');
}

await settleMessages();
assert.equal(figma.showUICalls.length, 1, 'The original plugin panel stays open through connection.');
assert.equal(requests.filter(({ url }) => url.endsWith('/health')).length, 21, 'Startup scans the whole supported port range.');
let activeFolders = document.getElementById('projects').children;
assert.equal(activeFolders.length, 1, 'The active helper appears in the list.');
await uiContext.onmessage({ data: { pluginMessage: {
  type: 'selection-summary', selectedCount: 1, exportableCount: 1, visibleExportableCount: 1,
} } });
activePorts = new Set([3847, 3848]);
document.getElementById('refresh').onclick();
await settleMessages();
activeFolders = document.getElementById('projects').children;
assert.equal(activeFolders.length, 2, 'Refresh finds a helper started after the plugin was opened.');
activeFolders[1].onclick();
await settleMessages();
assert.ok(requests.some(({ url }) => url === 'http://localhost:3848/session'), 'The selected latest helper opens its own session.');
assert.equal(document.getElementById('projects').children[1].className, 'project selected', 'The selected row is visibly marked.');
assert.equal(document.getElementById('export').disabled, false, 'Selecting the helper connects in place and enables export.');
assert.match(document.getElementById('status').textContent, /connected to checkout-3848/i);
assert.ok(!JSON.stringify(pluginMessages).includes('private-session-token'), 'The session token never crosses the Figma message channel.');
console.log('End-to-end startup/refresh discovery, latest active server selection, visible selected state, no-ID connection, and in-panel ready state passed.');
