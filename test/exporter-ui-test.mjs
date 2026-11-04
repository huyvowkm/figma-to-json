import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../exporter/ui.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'The plugin UI script must be available for its connection checks.');
assert.doesNotMatch(html, /manual-token|Bridge token from the running helper/i);
assert.match(html, /id="manual-url"/);
assert.doesNotMatch(html, /localStorage|clientStorage/);

class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
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

function createUi({ origin, search = '', fetchImpl }) {
  const elements = new Map();
  const radios = [new Element('input'), new Element('input')];
  radios[0].value = 'local-server';
  radios[1].value = 'download';
  const document = {
    getElementById(id) {
      if (!elements.has(id)) {
        const element = new Element(id === 'export-mode' ? 'select' : 'div');
        if (id === 'export-mode') element.value = 'visible-only';
        if (id === 'asset-mode') element.value = 'json-only';
        if (id === 'preview-mode') element.value = 'none';
        elements.set(id, element);
      }
      return elements.get(id);
    },
    querySelectorAll(selector) { return selector.includes('connection-mode') ? radios : []; },
    createElement(tag) { return new Element(tag); },
  };
  const parentMessages = [];
  const context = vm.createContext({
    document,
    parent: { postMessage: (message, targetOrigin) => parentMessages.push({ message, targetOrigin }) },
    location: { origin, search },
    URL, URLSearchParams, Blob, AbortController, atob, console, setTimeout, clearTimeout,
    fetch: fetchImpl ?? (async () => ({ ok: true, status: 200, json: async () => ({ token: 'session-secret' }) })),
  });
  vm.runInContext(script, context);
  return { context, document, elements, radios, parentMessages };
}

const bundled = createUi({ origin: 'null' });
assert.ok(bundled.parentMessages.some(({ message }) => message.pluginMessage?.type === 'get-connection-mode'));
assert.equal(bundled.parentMessages.some(({ message }) => message.pluginMessage?.type === 'scan-bridges'), false);
await bundled.context.onmessage({ data: { pluginMessage: { type: 'connection-mode', connectionMode: 'local-server' } } });
assert.ok(bundled.parentMessages.some(({ message }) => message.pluginMessage?.type === 'scan-bridges'), 'Local mode scans again whenever the UI starts.');

bundled.document.getElementById('manual-url').value = 'http://localhost:3847/';
bundled.document.getElementById('use-manual').onclick();
const manual = bundled.parentMessages.at(-1).message.pluginMessage;
assert.deepEqual(JSON.parse(JSON.stringify(manual)), { type: 'connect-to-bridge', url: 'http://localhost:3847' });
assert.ok(!JSON.stringify(bundled.parentMessages).includes('session-secret'));

const requests = [];
const local = createUi({
  origin: 'http://localhost:3847', search: '?pluginId=assigned-plugin-id',
  fetchImpl: async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/session')) return { ok: true, status: 200, json: async () => ({ token: 'session-secret' }) };
    if (String(url).endsWith('/health')) return { ok: true, status: 200, json: async () => ({ projectName: 'checkout', exportDirectoryName: 'exported' }) };
    if (String(url).endsWith('/export')) return { ok: true, status: 201, json: async () => ({ saved: 'screen.json', assets: [] }) };
    throw new Error('Unexpected local UI request: ' + url);
  },
});
await new Promise((resolve) => setImmediate(resolve));
assert.ok(requests.some(({ url }) => url.endsWith('/session')), 'Local UI retrieves its session token from its own origin.');
assert.ok(local.parentMessages.every(({ targetOrigin }) => targetOrigin === 'https://www.figma.com'));
assert.ok(local.parentMessages.every(({ message }) => message.pluginId === 'assigned-plugin-id'));
assert.ok(!JSON.stringify(local.parentMessages).includes('session-secret'), 'The token must never travel through Figma messages.');

await local.context.onmessage({ data: { pluginMessage: {
  type: 'save-exports', count: 1, includeAssets: true, warnings: [], skippedRenders: [],
  entries: [{ filename: 'screen-visible-only.json', payload: { ok: true }, assets: [] }],
} } });
await new Promise((resolve) => setImmediate(resolve));
const exportRequest = requests.find(({ url }) => url.endsWith('/export'));
assert.ok(exportRequest, 'Local UI writes exports directly to the same-origin bridge.');
assert.equal(exportRequest.options.headers['X-Figma-Mcp-Token'], 'session-secret');
assert.equal(exportRequest.options.method, 'POST');
assert.match(local.document.getElementById('status').textContent, /Exported 1 item/);
console.log('Bundled discovery, URL-only fallback, local session retrieval, secure Figma messages, and same-origin exports passed.');
