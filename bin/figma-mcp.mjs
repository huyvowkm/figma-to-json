#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--output-dir' || !args[1])) {
  throw new Error('Usage: node bin/figma-mcp.mjs [--output-dir <folder>] (defaults to the current directory)');
}

const outputDir = args.length ? resolve(args[1]) : process.cwd();
mkdirSync(join(outputDir, 'exported'), { recursive: true });

const slug = basename(outputDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-+$/g, '') || 'folder';
const pathId = createHash('sha1').update(outputDir).digest('hex').slice(0, 8);
const server = `figma-${slug}-${pathId}`;

try {
  execFileSync('codex', ['mcp', 'get', server], { stdio: 'ignore' });
} catch {
  execFileSync('codex', [
    'mcp', 'add', '--env', `FIGMA_CACHE_ROOT=${outputDir}`, server, '--', 'node',
    fileURLToPath(new URL('../server/dist/index.js', import.meta.url)),
  ], { stdio: 'inherit' });
}

console.log(`Ready: ${server}\nExport folder: ${join(outputDir, 'exported')}\nStarting localhost bridge. Press Ctrl+C to stop.`);
execFileSync('node', [fileURLToPath(new URL('./bridge.mjs', import.meta.url)), outputDir, outputDir], { stdio: 'inherit' });
