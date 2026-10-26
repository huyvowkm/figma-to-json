import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cacheRoot = path.resolve(process.env.FIGMA_CACHE_ROOT ?? path.join(projectRoot, '.figma-cache'));
const screensDir = path.join(cacheRoot, 'exported');

function safeScreenName(name: string): string {
  const normalized = name.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!normalized) throw new Error('Screen name must contain letters, digits, or hyphens.');
  return normalized;
}

async function listScreenNames(): Promise<string[]> {
  try {
    const entries = await fs.readdir(screensDir, { withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.json')).map((entry) => entry.name.slice(0, -5)).sort();
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

const server = new McpServer({ name: 'figma-to-json', version: '1.0.0' });

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
  const matches: unknown[] = [];
  const needle = query.toLowerCase();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.name === 'string' && node.name.toLowerCase().includes(needle)) matches.push(node);
    for (const child of Object.values(node)) Array.isArray(child) ? child.forEach(walk) : walk(child);
  };
  walk(data);
  return { content: [{ type: 'text', text: JSON.stringify(matches.slice(0, 20), null, 2) }] };
});

await server.connect(new StdioServerTransport());
