import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const messages = [];
const exportCalls = [];
let failPreview = false;
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
const alias = (id) => ({ type: 'VARIABLE_ALIAS', id });
const collection = { name: 'Theme', defaultModeId: 'light', modes: [{ modeId: 'light', name: 'Light' }, { modeId: 'dark', name: 'Dark' }] };
const variables = new Map(['space', 'alias', 'text', 'hidden'].map((id) => [id, {
  id, key: `key-${id}`, name: id, resolvedType: 'FLOAT', description: '', scopes: ['ALL_SCOPES'], codeSyntax: {}, remote: false,
  variableCollectionId: 'theme', valuesByMode: { light: id === 'space' ? alias('alias') : id === 'alias' ? alias('space') : 16, dark: 24 },
  resolveForConsumer: () => ({ resolvedType: 'FLOAT', value: 24 }),
}]));
variables.set('paint', { ...variables.get('space'), id: 'paint', name: 'Accent', resolvedType: 'COLOR',
  valuesByMode: { light: { r: 1, g: 0, b: 0, a: 0.5 } },
  resolveForConsumer: () => ({ resolvedType: 'COLOR', value: { r: 1, g: 0, b: 0, a: 0.5 } }),
});
const text = { id: '1:2', name: 'Label', type: 'TEXT', visible: true, resolvedVariableModes: { theme: 'dark' },
  boundVariables: { fontSize: alias('text') }, effectStyleId: 'shadow',
  getStyledTextSegments: () => [{ start: 0, end: 4, boundVariables: { fontSize: alias('text') }, textStyleId: 'body', fills: [] }],
};
const hidden = { id: '1:3', name: 'Hidden', type: 'FRAME', visible: false, resolvedVariableModes: {}, boundVariables: { itemSpacing: alias('hidden') }, fillStyleId: 'hidden-style' };
const root = { id: '1:1', name: 'Checkout', type: 'FRAME', visible: true, width: 8000, height: 2000,
  resolvedVariableModes: { theme: 'dark' }, children: [text, hidden], boundVariables: { itemSpacing: alias('space'), paddingLeft: alias('missing') }, effectStyleId: 'missing-style', fillStyleId: 'paint-style', gridStyleId: 'grid-style',
  exportAsync: async (settings) => {
    exportCalls.push(settings);
    if (settings.format === 'PNG') {
      if (failPreview) throw new Error('Failed to export node. This node may not have any visible layers.');
      return png;
    }
    return { document: { id: '1:1', name: 'Checkout', type: 'FRAME', children: [
      { id: '1:2', name: 'Label', type: 'TEXT', characters: 'Next' },
      { id: '1:3', name: 'Hidden', type: 'FRAME', visible: false },
    ] } };
  },
};
text.parent = root;
hidden.parent = root;
const figma = {
  showUI() {}, on() {}, notify() {}, ui: { postMessage: (message) => messages.push(message) },
  currentPage: { name: 'Checkout page', selection: [root] },
  variables: { getVariableByIdAsync: async (id) => variables.get(id) ?? null, getVariableCollectionByIdAsync: async () => collection },
  getStyleByIdAsync: async (id) => id === 'body' ? Object.defineProperties({}, {
    name: { get: () => 'Body' }, type: { get: () => 'TEXT' }, fontSize: { get: () => 16 },
    boundVariables: { get: () => ({ fontSize: alias('text') }) },
  }) : ({
    'paint-style': { type: 'PAINT', paints: [{ type: 'SOLID', boundVariables: { color: alias('paint') } }] },
    'grid-style': { type: 'GRID', layoutGrids: [{ pattern: 'COLUMNS', count: 12 }] },
    shadow: { type: 'EFFECT', effects: [{ type: 'DROP_SHADOW', radius: 8 }] },
  }[id] ?? null),
};
const context = vm.createContext({ figma, __html__: '', console, setTimeout, Uint8Array });
vm.runInContext(readFileSync(new URL('../exporter/code.js', import.meta.url), 'utf8'), context);
const runExport = async (options = {}) => {
  messages.length = 0;
  exportCalls.length = 0;
  await figma.ui.onmessage({ type: 'export-selection', connectionMode: 'download', ...options });
  assert.ok(!messages.some((message) => message.type === 'export-error'), JSON.stringify(messages));
  return messages.filter((message) => message.type === 'download-file').map((message) => ({ filename: message.filename, payload: JSON.parse(message.content) }));
};
const [plain] = await runExport();
assert.equal(plain.payload.preview, undefined);
assert.equal(messages.some((message) => message.type === 'download-asset'), false);
assert.equal(exportCalls.some((settings) => settings.format === 'PNG'), false);
assert.equal(plain.payload.figma.document.children.length, 1);
assert.ok(plain.payload.variables.some((entry) => entry.name === 'text' && entry.value === 24 && entry.mode === 'Dark'));
assert.ok(plain.payload.variables.some((entry) => entry.id === 'missing' && entry.error));
assert.ok(plain.payload.styles.some((entry) => entry.id === 'missing-style' && entry.error));
assert.equal(plain.payload.styles.find((entry) => entry.id === 'body').fontSize, 16);
assert.equal(plain.payload.styles.find((entry) => entry.id === 'grid-style').layoutGrids[0].count, 12);
assert.equal(plain.payload.styles.find((entry) => entry.id === 'shadow').effects[0].radius, 8);
assert.equal(plain.payload.variables.find((entry) => entry.id === 'paint').hex, '#FF000080');
assert.equal(plain.payload.variableDefinitions.filter((entry) => entry.id === 'space').length, 1);
assert.ok(plain.payload.variableDefinitions.some((entry) => entry.id === 'alias'));
assert.ok(!plain.payload.variableDefinitions.some((entry) => entry.id === 'hidden'));
assert.ok(!plain.payload.styles.some((entry) => entry.id === 'hidden-style'));
figma.currentPage.selection = [root, root];
const previews = await runExport({ includePreview: true });
assert.equal(previews[0].payload.preview.file, previews[0].filename.replace('.json', '.png'));
assert.equal(previews[1].payload.preview.file, previews[1].filename.replace('.json', '.png'));
assert.notEqual(previews[0].filename, previews[1].filename);
assert.equal(exportCalls.find((settings) => settings.format === 'PNG').constraint.value, 0.512);
assert.equal(messages.filter((message) => message.type === 'download-asset').length, 2);
figma.currentPage.selection = [root];
const [unfiltered] = await runExport({ exportMode: 'no-filter' });
assert.ok(unfiltered.payload.variableDefinitions.some((entry) => entry.id === 'hidden'));
assert.equal(unfiltered.payload.figma.document.children.length, 2);
failPreview = true;
const [withoutPreview] = await runExport({ includePreview: true });
assert.equal(withoutPreview.payload.preview, undefined);
assert.equal(withoutPreview.payload.warnings[0].format, 'PNG');
assert.equal(withoutPreview.payload.warnings[0].nodeId, root.id);
assert.equal(messages.find((message) => message.type === 'download-complete').warnings.length, 1);
console.log('Exporter JSON-only defaults, previews, tokens, styles, and optional PNG failure handling passed.');
