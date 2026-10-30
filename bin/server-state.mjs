import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

const stateDir = () => process.env.FIGMA_MCP_STATE_DIR || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'figma-mcp', 'servers');
const filename = (name) => {
  if (!/^figma-[a-z0-9-]+$/.test(name)) throw new Error('Invalid local Figma server name');
  return join(stateDir(), `${name}.json`);
};
export function serverName(project) {
  const slug = basename(project).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-+$/g, '') || 'folder';
  return `figma-${slug}-${createHash('sha1').update(project).digest('hex').slice(0, 8)}`;
}
export function trackServer(record) {
  mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  const file = filename(record.name);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(record, null, 2), { mode: 0o600 });
  renameSync(temp, file);
}
export function trackedServers() {
  let files;
  try { files = readdirSync(stateDir()); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  return files.filter((file) => /^figma-[a-z0-9-]+\.json$/.test(file)).flatMap((file) => {
    try {
      const record = JSON.parse(readFileSync(join(stateDir(), file), 'utf8'));
      if (`${record.name}.json` !== file || typeof record.project !== 'string' || typeof record.cacheDir !== 'string') return [];
      return [record];
    } catch { return []; }
  });
}
export function forgetServer(record) {
  const file = filename(record.name);
  try {
    const current = JSON.parse(readFileSync(file, 'utf8'));
    if (current.instanceId === record.instanceId) unlinkSync(file);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
