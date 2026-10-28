import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StdioClientTransport } from '../server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js';

const cache = mkdtempSync(join(tmpdir(), 'figma-context-'));
const dir = join(cache, 'exported');
mkdirSync(dir);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=';
const document = { id: '1:1', name: 'Checkout', type: 'FRAME', absoluteBoundingBox: { x: 0, y: 0, width: 400, height: 800 }, children: [
  { id: '1:2', type: 'FRAME', name: 'Card', fills: [{ type: 'SOLID' }], children: [
    { id: '1:3', name: 'Label', type: 'TEXT', characters: 'Continue' },
  ] },
  { id: '1:4', name: 'Footer', type: 'FRAME' },
] };
writeFileSync(join(dir, 'checkout.json'), JSON.stringify({
  figma: { document }, preview: { file: 'checkout.png' },
  variables: [{ consumerNodeId: '1:3', name: 'Spacing' }],
  variableDefinitions: [{ id: 'var1', name: 'Card' }],
  styles: [{ id: 'style1', consumerNodeIds: ['1:3'], name: 'Body' }],
}));
writeFileSync(join(dir, 'checkout.png'), Buffer.from(png, 'base64'));
writeFileSync(join(dir, 'legacy.json'), JSON.stringify({ figma: { document } }));
writeFileSync(join(dir, 'unsafe.json'), JSON.stringify({ figma: { document }, preview: { file: '../secret.png' } }));
const client = new Client({ name: 'context-test', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../server/dist/index.js', import.meta.url))],
    env: { ...process.env, FIGMA_CACHE_ROOT: cache },
  }));
  const call = (name, args) => client.callTool({ name, arguments: args });
  const json = async (name, args) => {
    const result = await call(name, args);
    assert.ok(!result.isError, JSON.stringify(result));
    return JSON.parse(result.content[0].text);
  };
  const metadata = await json('get_metadata', { screen: 'checkout', depth: 1 });
  assert.equal(metadata.tree.childCount, 2);
  assert.equal(metadata.tree.children[0].children, undefined);
  assert.equal(metadata.truncated, true);
  assert.equal(metadata.nodeCount, 3);
  assert.equal(metadata.tree.children[0].fills, undefined);
  const bounded = await json('get_metadata', { screen: 'checkout', depth: 10, maxNodes: 2 });
  assert.equal(bounded.nodeCount, 2);
  assert.equal(bounded.truncated, true);
  const node = await json('get_node', { screen: 'checkout', nodeId: '1:2' });
  assert.equal(node.tree.id, '1:2');
  assert.equal(node.tree.fills.length, 1);
  assert.equal(node.tree.children, undefined);
  assert.equal(node.tree.childCount, 1);
  assert.equal((await json('get_node', { screen: 'checkout', nodeId: '1:2', depth: 1 })).tree.children[0].id, '1:3');
  assert.ok((await call('get_node', { screen: 'checkout', nodeId: 'missing' })).isError);
  const search = await json('search_nodes', { screen: 'checkout', query: 'continue' });
  assert.equal(search[0].id, '1:3');
  assert.equal((await json('search_nodes', { screen: 'checkout', query: 'Card' })).length, 1);
  const variables = await json('get_variables', { screen: 'checkout', nodeId: '1:3' });
  assert.equal(variables.styles[0].id, 'style1');
  assert.equal((await json('get_variables', { screen: 'checkout', nodeId: '1:4' })).variables.length, 0);
  assert.equal((await json('get_variables', { screen: 'legacy' })).stylesAvailable, false);
  assert.equal((await json('get_metadata', { screen: 'legacy' })).tree.id, '1:1');
  assert.equal((await call('get_preview', { screen: 'checkout' })).content[0].data, png);
  assert.ok((await call('get_preview', { screen: 'legacy' })).isError);
  assert.ok((await call('get_preview', { screen: 'unsafe' })).isError);
  assert.ok((await call('get_screen', { name: '../checkout' })).isError);
  console.log('MCP metadata, node lookup, previews, variables, legacy exports, and path validation passed.');
} finally {
  await client.close();
  rmSync(cache, { recursive: true, force: true });
}
