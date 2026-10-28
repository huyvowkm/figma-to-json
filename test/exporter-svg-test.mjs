import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const messages = [];
const rendered = [];
let revision = 'black';
let nextId = 1;
const node = (type, name, width = 24, height = 24, children, extra = {}) => {
  const result = { id: `9:${nextId++}`, type, name, width, height, visible: true, exportSettings: [], resolvedVariableModes: {}, componentProperties: {}, ...extra };
  if (children) {
    result.children = children;
    children.forEach((child) => child.parent = result);
  }
  result.exportAsync = async (settings) => {
    if (settings.format === 'SVG_STRING') {
      rendered.push(result.id);
      return `<svg xmlns="http://www.w3.org/2000/svg"><path fill="${revision}" d="M0 0L12 12"/></svg>`;
    }
    return { document: toJson(result) };
  };
  return result;
};
const toJson = (n) => ({ id: n.id, type: n.type, name: n.name, visible: n.visible,
  ...('absoluteRenderBounds' in n ? { absoluteRenderBounds: n.absoluteRenderBounds } : {}),
  ...(n.children ? { children: n.children.map(toJson) } : {}),
});
const vector = (name = 'Vector') => node('VECTOR', name, 16, 16);
const glyph = node('GROUP', 'Search', 24, 24, [vector(), vector()]);
const button = node('FRAME', 'Icon Button', 48, 48, [node('RECTANGLE', 'Background', 48, 48), glyph]);
const named = node('INSTANCE', 'Icon.Search', 24, 24, [vector()]);
const standalone = vector('Close');
const explicit = node('GROUP', 'Logo', 180, 180, [vector()], { exportSettings: [{ format: 'SVG' }] });
const primitiveIcon = node('GROUP', 'Add', 24, 24, [node('LINE', 'Line', 16, 0), node('LINE', 'Line', 0, 16)]);
const hidden = node('INSTANCE', 'Icon/Hidden', 24, 24, [vector()], { visible: false });
const keyboardIcon = node('INSTANCE', 'Icon/Home', 24, 24, [vector()]);
const keyboard = node('FRAME', 'System Keyboard', 300, 200, [keyboardIcon]);
const blank = node('RECTANGLE', 'Border', 24, 24);
const large = node('VECTOR', 'Illustration', 400, 400);
const imageIcon = node('RECTANGLE', 'Icon/Photo', 24, 24, undefined, { fills: [{ type: 'IMAGE' }] });
const root = node('FRAME', 'Screen', 400, 800, [button, named, standalone, explicit, primitiveIcon, hidden, keyboard, blank, large, imageIcon]);
const figma = { showUI() {}, on() {}, notify() {}, ui: { postMessage: (message) => messages.push(message) }, currentPage: { name: 'Page', selection: [root] } };
const context = vm.createContext({ figma, __html__: '', console, Uint8Array });
vm.runInContext(readFileSync(new URL('../exporter/code.js', import.meta.url), 'utf8'), context);
const run = async (options = {}) => {
  messages.length = 0;
  rendered.length = 0;
  await figma.ui.onmessage({ type: 'export-selection', connectionMode: 'download', ...options });
  assert.ok(!messages.some((message) => message.type === 'export-error'), JSON.stringify(messages));
  return JSON.parse(messages.find((message) => message.type === 'download-file').content);
};
const plain = await run();
assert.equal(rendered.length, 0, 'JSON only must not render SVG');
assert.equal(plain.assets.length, 0);
const first = await run({ includeAssets: true });
assert.deepEqual(new Set(rendered), new Set([glyph.id, named.id, standalone.id, explicit.id, primitiveIcon.id]));
assert.ok(!rendered.includes(button.id));
assert.ok(!rendered.includes(glyph.children[0].id), 'A grouped icon must be exported once');
const find = (n, id) => n.id === id ? n : n.children?.map((child) => find(child, id)).find(Boolean);
assert.equal(find(first.figma.document, glyph.id).iconClassification, 'vector-shape');
assert.equal(find(first.figma.document, named.id).iconClassification, 'name-match');
assert.equal(find(first.figma.document, explicit.id).iconClassification, 'svg-export-setting');
assert.equal(find(first.figma.document, keyboardIcon.id).iconClassification, 'excluded-keyboard');
assert.equal(find(first.figma.document, button.id).isIcon, false);
assert.equal(first.assets.length, 5);
for (const asset of first.assets) {
  assert.equal(find(first.figma.document, asset.nodeId).svgAsset, asset.file);
  assert.match(asset.file, /-[a-f0-9]{16}\.svg$/);
}
const downloads = messages.filter((message) => message.type === 'download-asset');
assert.equal(downloads.length, 5);
assert.ok(Buffer.from(downloads[0].base64, 'base64').toString().includes('fill="black"'));
assert.equal(downloads[0].overwrite, undefined);
const repeated = await run({ includeAssets: true });
assert.equal(repeated.assets[0].file, first.assets[0].file, 'Unchanged SVG should have a stable name');
revision = 'white';
const changed = await run({ includeAssets: true });
assert.notEqual(changed.assets[0].file, first.assets[0].file, 'A changed SVG must use a different name');
const unfiltered = await run({ includeAssets: true, exportMode: 'no-filter' });
assert.ok(unfiltered.assets.some((asset) => asset.nodeId === hidden.id));
assert.ok(!unfiltered.assets.some((asset) => asset.nodeId === keyboardIcon.id));
figma.currentPage.selection = [keyboardIcon];
const directKeyboard = await run({ includeAssets: true, exportMode: 'no-filter' });
assert.equal(directKeyboard.assets.length, 0, 'Direct selection inside keyboard must stay excluded');
assert.equal(directKeyboard.source.iconClassification, 'excluded-keyboard');
const empty = node('FRAME', 'Empty asset', 24, 24, [], { exportSettings: [{ format: 'SVG' }] });
empty.exportAsync = async (settings) => {
  if (settings.format === 'SVG_STRING') throw new Error('Failed to export node. This node may not have any visible layers.');
  return { document: toJson(empty) };
};
root.children.push(empty);
empty.parent = root;
figma.currentPage.selection = [root];
const partial = await run({ includeAssets: true });
assert.equal(partial.assets.length, 5, 'Renderable icons must survive one failed SVG');
assert.equal(partial.warnings.length, 1);
assert.equal(partial.warnings[0].format, 'SVG');
assert.equal(partial.warnings[0].nodeId, empty.id);
assert.equal(find(partial.figma.document, empty.id).svgAsset, undefined);
assert.match(find(partial.figma.document, empty.id).svgExportError, /visible layers/);
assert.equal(messages.find((message) => message.type === 'download-complete').warnings[0].nodeName, 'Empty asset');
let sent;
context.fetch = async (_url, options) => {
  sent = JSON.parse(options.body);
  return { ok: true, json: async () => ({ saved: sent.filename, assets: sent.assets.map((asset) => asset.filename) }) };
};
messages.length = 0;
await figma.ui.onmessage({ type: 'export-selection', connectionMode: 'local-server', includeAssets: true, bridge: 'http://localhost:3847', token: 'test' });
assert.equal(sent.payload.warnings[0].nodeId, empty.id);
assert.equal(messages.find((message) => message.type === 'export-complete').warnings.length, 1);
assert.ok(!messages.some((message) => message.type === 'export-error'));
figma.currentPage.selection = [empty];
const noSvg = await run({ includeAssets: true });
assert.equal(noSvg.assets.length, 0);
assert.equal(noSvg.warnings.length, 1, 'JSON must remain available even if every SVG fails');
const clippedIcon = node('INSTANCE', 'Icon / folder-01', 16, 16, [vector()], { absoluteRenderBounds: null });
clippedIcon.exportAsync = async () => {
  rendered.push(clippedIcon.id);
  throw new Error('Failed to export node. This node may not have any visible layers.');
};
root.children.push(clippedIcon);
clippedIcon.parent = root;
named.absoluteRenderBounds = { x: 0, y: 0, width: 12, height: 24 };
figma.currentPage.selection = [root];
const clippedResult = await run({ includeAssets: true });
assert.ok(!rendered.includes(clippedIcon.id), 'Visible-only must not render fully clipped icons');
assert.ok(rendered.includes(named.id), 'A partially rendered icon must still export');
assert.ok(!clippedResult.warnings.some((warning) => warning.nodeId === clippedIcon.id));
assert.equal(clippedResult.skippedRenders[0].nodeId, clippedIcon.id);
assert.equal(find(clippedResult.figma.document, clippedIcon.id).svgExportSkipped, 'not-rendered');
assert.equal(find(clippedResult.figma.document, clippedIcon.id).svgAsset, undefined);
assert.equal(messages.find((message) => message.type === 'download-complete').skippedRenders.length, 1);
messages.length = 0;
await figma.ui.onmessage({ type: 'export-selection', connectionMode: 'local-server', includeAssets: true, bridge: 'http://localhost:3847', token: 'test' });
assert.equal(sent.payload.skippedRenders[0].nodeId, clippedIcon.id);
assert.equal(messages.find((message) => message.type === 'export-complete').skippedRenders.length, 1);
const unfilteredClipped = await run({ includeAssets: true, exportMode: 'no-filter' });
assert.ok(rendered.includes(clippedIcon.id), 'No filter must still attempt requested clipped assets');
assert.ok(unfilteredClipped.warnings.some((warning) => warning.nodeId === clippedIcon.id));
assert.equal(unfilteredClipped.skippedRenders.length, 0);
figma.currentPage.selection = [empty];
empty.exportAsync = async () => { throw new Error('Required JSON failed'); };
messages.length = 0;
await figma.ui.onmessage({ type: 'export-selection', connectionMode: 'download' });
const jsonError = messages.find((message) => message.type === 'export-error');
assert.ok(jsonError.error.includes('JSON export failed'));
assert.ok(jsonError.error.includes(empty.name) && jsonError.error.includes(empty.id));
assert.ok(!messages.some((message) => message.type === 'download-complete'));
console.log('SVG detection, clipping, exclusions, immutable revisions, and partial rendering failures in both modes passed.');
