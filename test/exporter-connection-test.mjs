import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const messages = [];
let timeout;
let cleared = 0;
const frame = (id, name) => ({ id, name, type: 'FRAME', width: 200, height: 200, visible: true, resolvedVariableModes: {},
  exportAsync: async () => ({ document: { id, name, type: 'FRAME' } }),
});
const figma = { showUI() {}, on() {}, ui: { postMessage: (message) => messages.push(message) },
  currentPage: { name: 'Page', selection: [frame('1:1', 'Screen')] },
};
const context = vm.createContext({ figma, __html__: '', console,
  setTimeout: (callback, delay) => { assert.equal(delay, 15000); timeout = callback; return 1; },
  clearTimeout: () => { cleared++; timeout = undefined; },
});
vm.runInContext(readFileSync(new URL('../exporter/code.js', import.meta.url), 'utf8'), context);
const request = { type: 'export-selection', connectionMode: 'local-server', bridge: 'http://localhost:3847', token: 'test' };
const failed = async (fetch) => {
  messages.length = 0;
  context.fetch = fetch;
  await figma.ui.onmessage(request);
  const result = messages.find((message) => message.type === 'export-error');
  assert.ok(result, JSON.stringify(messages));
  assert.ok(!result.error.includes('[object Object]'));
  assert.ok(result.error.includes(request.bridge));
  assert.equal(timeout, undefined, 'Request timer must be cleared');
  return result;
};
assert.match((await failed(async () => { throw {}; })).error, /Cannot reach.*Start the helper/);
assert.match((await failed(async () => { throw { message: 'Connection refused' }; })).error, /Connection refused/);
assert.match((await failed(async () => ({ ok: false, status: 403 }))).error, /HTTP 403.*Refresh/);
assert.match((await failed(async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'Invalid filename' }) }))).error, /HTTP 400.*Invalid filename/);
assert.match((await failed(async () => ({ ok: false, status: 500, text: async () => 'Disk full' }))).error, /HTTP 500.*Disk full/);
assert.match((await failed(async () => ({ ok: true, json: async () => { throw {}; } }))).error, /invalid response/);
assert.match((await failed(async () => ({ ok: true, json: async () => ({}) }))).error, /did not confirm a saved filename/);
messages.length = 0;
context.fetch = async () => new Promise(() => {});
const hanging = figma.ui.onmessage(request);
for (let step = 0; step < 100 && !timeout; step++) await Promise.resolve();
assert.equal(typeof timeout, 'function');
timeout();
await hanging;
assert.match(messages.find((message) => message.type === 'export-error').error, /15 seconds.*Files may already have been saved/);
assert.equal(timeout, undefined);
figma.currentPage.selection.push(frame('1:2', 'Other screen'));
let calls = 0;
const partial = await failed(async () => {
  if (calls++ === 0) return { ok: true, json: async () => ({ saved: 'screen-visible-only.json' }) };
  throw {};
});
assert.deepEqual(Array.from(partial.files), ['screen-visible-only.json']);
assert.equal(calls, 2, 'Failed writes must not be automatically retried');
assert.ok(cleared >= 10);
console.log('Closed-server errors, expired token, HTTP details, malformed replies, timeout cleanup and partial saved files passed.');
