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
await bundled.context.onmessage({ data: { pluginMessage: {
  type: 'bridge-results', projects: [{ port: 3847, projectName: 'checkout', exportDirectoryName: 'exported' }],
} } });
await bundled.context.onmessage({ data: { pluginMessage: {
  type: 'selection-summary', selectedCount: 1, exportableCount: 1, visibleExportableCount: 1,
} } });
const projectButton = bundled.document.getElementById('projects').children[0];
assert.ok(projectButton, 'A discovered active server must appear as a selectable row.');
projectButton.onclick();
const selectedServer = bundled.parentMessages.at(-1).message.pluginMessage;
assert.deepEqual(JSON.parse(JSON.stringify(selectedServer)), {
  type: 'connect-to-bridge', url: 'http://localhost:3847', name: 'checkout · exported',
});
assert.equal(bundled.document.getElementById('export').disabled, true, 'Export stays disabled until the server connection succeeds.');
await bundled.context.onmessage({ data: { pluginMessage: { type: 'connection-ready', url: 'http://localhost:3847' } } });
assert.equal(bundled.document.getElementById('export').disabled, false, 'A successful selection enables export in the same panel.');
assert.match(bundled.document.getElementById('status').textContent, /connected/i);
assert.ok(!JSON.stringify(bundled.parentMessages).includes('session-secret'));

const exportControl = bundled.document.getElementById('export');
exportControl.onclick();
const exportMessage = bundled.parentMessages.at(-1).message.pluginMessage;
assert.equal(exportMessage.type, 'export-selection');
assert.equal(exportMessage.connectionMode, 'local-server');
assert.ok(!JSON.stringify(exportMessage).includes('token'));
assert.ok(!JSON.stringify(exportMessage).includes('bridge'));

bundled.document.getElementById('manual-url').value = 'http://localhost:3847/';
bundled.document.getElementById('use-manual').onclick();
const manual = bundled.parentMessages.at(-1).message.pluginMessage;
assert.deepEqual(JSON.parse(JSON.stringify(manual)), { type: 'connect-to-bridge', url: 'http://localhost:3847', name: 'localhost:3847' });
assert.ok(!JSON.stringify(bundled.parentMessages).includes('session-secret'));

const downloadStartup = createUi({ origin: 'null' });
await downloadStartup.context.onmessage({ data: { pluginMessage: { type: 'connection-mode', connectionMode: 'download' } } });
assert.ok(downloadStartup.parentMessages.some(({ message }) => message.pluginMessage?.type === 'scan-bridges'), 'Discovery refreshes on every run even when Download mode was last selected.');
console.log('Every-run discovery, selectable active servers, in-panel connection feedback, URL-only fallback, and token-free UI messages passed.');
