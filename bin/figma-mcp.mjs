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

const projectDir = args.length ? resolve(args[1]) : process.cwd();
const cacheDir = join(projectDir, '.figma-cache');
mkdirSync(join(cacheDir, 'exported'), { recursive: true });

const slug = basename(projectDir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-+$/g, '') || 'folder';
const pathId = createHash('sha1').update(projectDir).digest('hex').slice(0, 8);
const server = `figma-${slug}-${pathId}`;
const serverArgs = [
  'mcp', 'add', '--env', `FIGMA_CACHE_ROOT=${cacheDir}`, server, '--', 'node',
  fileURLToPath(new URL('../server/dist/index.js', import.meta.url)),
];

let config;
try {
  config = JSON.parse(execFileSync('codex', ['mcp', 'get', server, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
} catch {
  config = undefined;
}

if (config?.transport?.env?.FIGMA_CACHE_ROOT !== cacheDir) {
  if (config) execFileSync('codex', ['mcp', 'remove', server], { stdio: 'ignore' });
  execFileSync('codex', serverArgs, { stdio: 'inherit' });
}

console.log(`Ready: ${server}\nExport folder: ${join(cacheDir, 'exported')}\nStarting localhost bridge. Press Ctrl+C to stop.`);
execFileSync('node', [fileURLToPath(new URL('./bridge.mjs', import.meta.url)), projectDir, cacheDir], { stdio: 'inherit' });
