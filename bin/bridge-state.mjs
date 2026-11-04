import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

const stateDirectory = () => {
  const userId = createHash('sha256').update(homedir()).digest('hex').slice(0, 16);
  const directory = join(tmpdir(), `design-to-json-bridge-${userId}`);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const metadata = lstatSync(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw new Error('Bridge state path is not a private directory.');
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new Error('Bridge state directory belongs to another user.');
  if (process.platform !== 'win32') chmodSync(directory, 0o700);
  return directory;
};

const statePath = (instanceId) => {
  if (typeof instanceId !== 'string' || !/^[a-f0-9]{32}$/.test(instanceId)) throw new Error('Invalid bridge instance ID.');
  return join(stateDirectory(), `${instanceId}.json`);
};

export function writeBridgeState(state) {
  const destination = statePath(state.instanceId);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, destination);
  } catch (error) {
    try { unlinkSync(temporary); } catch {}
    throw error;
  }
}

export function readBridgeState(instanceId) {
  try { return JSON.parse(readFileSync(statePath(instanceId), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export function removeBridgeState(instanceId) {
  try { unlinkSync(statePath(instanceId)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
