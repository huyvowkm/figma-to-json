import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { documentRoot, findNode, summarizeTree, walkNodes } from './screen-data.js';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cacheRoot = path.resolve(process.env.FIGMA_CACHE_ROOT ?? path.join(projectRoot, '.figma-cache'));
const screensDir = path.join(cacheRoot, 'exported');
await Promise.all(['assets', 'exported'].map((folder) => fs.mkdir(path.join(cacheRoot, folder), { recursive: true })));
function safeScreenName(name) {
    const normalized = name.toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalized))
        throw new Error('Screen name must contain only letters, digits, or hyphens, without an extension.');
    return normalized;
}
async function listScreenNames() {
    try {
        const entries = await fs.readdir(screensDir, { withFileTypes: true });
        return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name.slice(0, -5)).sort();
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return [];
        throw error;
    }
}
const server = new McpServer({ name: 'figma-to-json', version: '1.0.0' });
const readScreen = async (screen) => JSON.parse(await fs.readFile(path.join(screensDir, `${safeScreenName(screen)}.json`), 'utf8'));
const textResult = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const treeOptions = {
    depth: z.number().int().min(0).max(10).default(2).describe('Number of child levels to include.'),
    maxNodes: z.number().int().min(1).max(1000).default(200).describe('Maximum nodes to return; omitted children are marked.'),
};
server.registerTool('get_metadata', {
    description: 'Read a compact, bounded layer outline from a local export. Start here before reading a large screen.',
    inputSchema: { screen: z.string(), nodeId: z.string().optional(), ...treeOptions },
}, async ({ screen, nodeId, depth, maxNodes }) => {
    const root = documentRoot(await readScreen(screen));
    return textResult(summarizeTree(nodeId ? findNode(root, nodeId) : root, depth, maxNodes));
});
server.registerTool('get_node', {
    description: 'Read one exported node by its exact Figma ID. Returns its properties without descendants by default.',
    inputSchema: { screen: z.string(), nodeId: z.string(), ...treeOptions, depth: treeOptions.depth.default(0) },
}, async ({ screen, nodeId, depth, maxNodes }) => textResult(summarizeTree(findNode(documentRoot(await readScreen(screen)), nodeId), depth, maxNodes, false)));
server.registerTool('get_preview', {
    description: 'Read the locally saved PNG reference for a screen. Requires exporting with PNG preview enabled.',
    inputSchema: { screen: z.string() },
}, async ({ screen }) => {
    const data = await readScreen(screen);
    const filename = data.preview?.file;
    if (typeof filename !== 'string' || !/^[a-z0-9-]+\.png$/i.test(filename))
        throw new Error('No valid PNG preview is recorded. Re-export with PNG preview enabled.');
    const png = await fs.readFile(path.join(screensDir, filename));
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new Error('The recorded preview is not a PNG.');
    return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] };
});
server.registerTool('get_variables', {
    description: 'Read exported variable bindings, definitions and referenced styles. Optionally restrict bindings and styles to one exact consumer node ID.',
    inputSchema: { screen: z.string(), nodeId: z.string().optional() },
}, async ({ screen, nodeId }) => {
    const data = await readScreen(screen);
    if (nodeId)
        findNode(documentRoot(data), nodeId);
    return textResult({
        variables: (data.variables ?? []).filter((entry) => !nodeId || entry.consumerNodeId === nodeId),
        variableDefinitions: data.variableDefinitions ?? [],
        styles: (data.styles ?? []).filter((entry) => !nodeId || entry.consumerNodeIds?.includes(nodeId)),
        definitionsAvailable: Array.isArray(data.variableDefinitions),
        stylesAvailable: Array.isArray(data.styles),
    });
});
server.registerTool('list_screens', { description: 'List locally exported Figma screens.', inputSchema: {} }, async () => ({
    content: [{ type: 'text', text: JSON.stringify(await listScreenNames()) }],
}));
server.registerTool('get_screen', { description: 'Read one locally exported Figma screen.', inputSchema: { name: z.string() } }, async ({ name }) => {
    const filename = path.join(screensDir, `${safeScreenName(name)}.json`);
    return { content: [{ type: 'text', text: await fs.readFile(filename, 'utf8') }] };
});
server.registerTool('search_nodes', { description: 'Find matching node names or text in one locally exported screen.', inputSchema: { screen: z.string(), query: z.string() } }, async ({ screen, query }) => {
    const filename = path.join(screensDir, `${safeScreenName(screen)}.json`);
    const data = JSON.parse(await fs.readFile(filename, 'utf8'));
    const matches = [];
    const needle = query.toLowerCase();
    for (const node of walkNodes(documentRoot(data))) {
        if ((typeof node.name === 'string' && node.name.toLowerCase().includes(needle)) || (typeof node.characters === 'string' && node.characters.toLowerCase().includes(needle))) {
            matches.push(summarizeTree(node, 0, 1, false).tree);
            if (matches.length === 20)
                break;
        }
    }
    return textResult(matches);
});
await server.connect(new StdioServerTransport());
