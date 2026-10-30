import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';

// Isolate both Codex configuration and the bridge; never touch the user's config.
const root = mkdtempSync(join(tmpdir(), 'figma-launcher-cleanup-'));
const bin = join(root, 'bin');
mkdirSync(bin);
copyFileSync(new URL('../bin/figma-mcp.mjs', import.meta.url), join(bin, 'figma-mcp.mjs'));
copyFileSync(new URL('../bin/registration.mjs', import.meta.url), join(bin, 'registration.mjs'));
for (const file of ['codex-config.mjs', 'server-state.mjs', 'monitor.mjs', 'monitor-ui.mjs', 'monitor-app.mjs', 'display-path.mjs']) {
  copyFileSync(new URL(`../bin/${file}`, import.meta.url), join(bin, file));
}
writeFileSync(join(bin, 'bridge.mjs'), `
import { writeFileSync } from 'node:fs';
if (process.env.BRIDGE_MODE === 'duplicate') process.exit(0);
if (process.env.BRIDGE_MODE === 'failure') process.exit(1);
writeFileSync(process.env.BRIDGE_PID, String(process.pid));
process.send({ type: 'ready' });
process.on('SIGUSR2', () => process.exit(0));
setInterval(() => {}, 1000);
`);
writeFileSync(join(bin, 'codex'), `#!/usr/bin/env node
const fs = require('node:fs');
const file = process.env.TEST_CONFIG;
if (process.argv[2] === 'app-server') {
  const lines = require('node:readline').createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    const request = JSON.parse(line);
    if (request.method === 'initialize') console.log(JSON.stringify({ id: request.id, result: {} }));
    if (request.method === 'config/batchWrite') {
      const config = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const edit of request.params.edits) {
        const [, name, , tool, key] = edit.keyPath.split('.');
        config[name].tools ??= {};
        config[name].tools[tool] ??= {};
        config[name].tools[tool][key] = edit.value;
      }
      fs.writeFileSync(file, JSON.stringify(config));
      console.log(JSON.stringify({ id: request.id, result: {} }));
    }
  });
  return;
}
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
const [, action, ...args] = process.argv.slice(2);
if (action === 'get') {
  if (!config[args[0]]) process.exit(1);
  console.log(JSON.stringify(config[args[0]]));
} else if (action === 'list') {
  console.log(JSON.stringify(Object.values(config)));
} else if (action === 'add') {
  const [key, value] = args[1].split('=');
  const name = args[2];
  config[name] = { name, transport: { command: args[4], args: args.slice(5), env: { [key]: value } } };
  fs.writeFileSync(file, JSON.stringify(config));
} else if (action === 'remove') {
  delete config[args[0]];
  fs.writeFileSync(file, JSON.stringify(config));
} else process.exit(2);
`, { mode: 0o755 });

const children = [];
async function launch(folder, mode) {
  const child = spawn(process.execPath, [join(bin, 'figma-mcp.mjs'), '--output-dir', folder], {
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIGMA_MCP_STATE_DIR: join(root, 'state'), TEST_CONFIG: join(folder, 'config.json'), BRIDGE_PID: join(folder, 'bridge.pid'), BRIDGE_MODE: mode ?? '' },
  });
  children.push(child);
  child.done = once(child, 'close');
  let output = '';
  let errors = '';
  child.stdout.on('data', (data) => output += data);
  child.stderr.on('data', (data) => errors += data);
  if (!mode) {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Launcher timed out: ${errors}`)), 5000);
      child.stdout.on('data', () => {
        if (output.includes('Ready:')) { clearTimeout(timeout); resolve(); }
      });
      child.once('close', () => { clearTimeout(timeout); reject(new Error(`Launcher exited early: ${errors}`)); });
    });
  }
  return child;
}
const unrelated = { name: 'unrelated', transport: { command: 'keep-me' } };
function setup(name) {
  const folder = join(root, name);
  mkdirSync(folder);
  writeFileSync(join(folder, 'config.json'), JSON.stringify({ unrelated }));
  return folder;
}
const read = (folder) => JSON.parse(readFileSync(join(folder, 'config.json'), 'utf8'));

try {
  for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM']) {
    const folder = setup(signal);
    const child = await launch(folder);
    assert.equal(Object.keys(read(folder)).length, 2);
    const registration = Object.values(read(folder)).find((entry) => entry.name !== 'unrelated');
    assert.deepEqual(registration.tools, Object.fromEntries(
      ['list_screens', 'get_screen', 'get_metadata', 'get_node', 'get_preview', 'get_variables', 'search_nodes']
        .map((tool) => [tool, { approval_mode: 'approve' }]),
    ));
    const exported = join(folder, '.figma-cache/exported/screen.json');
    writeFileSync(exported, '{}');
    const pid = Number(readFileSync(join(folder, 'bridge.pid'), 'utf8'));
    child.kill(signal);
    await child.done;
    assert.deepEqual(read(folder), { unrelated }, `${signal} must remove only its registration`);
    assert.equal(existsSync(exported), true);
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'Bridge must stop too');
  }

  const folder = setup('bridge-exit');
  const owner = await launch(folder);
  const duplicate = await launch(folder, 'duplicate');
  assert.equal((await duplicate.done)[0], 0);
  assert.equal(Object.keys(read(folder)).length, 2, 'Duplicate must preserve owner registration');
  process.kill(Number(readFileSync(join(folder, 'bridge.pid'), 'utf8')), 'SIGTERM');
  await owner.done;
  assert.deepEqual(read(folder), { unrelated }, 'Unexpected bridge exit must unregister');

  for (const signal of ['SIGUSR2', 'SIGKILL']) {
    const folder = setup(`child-${signal}`);
    const child = await launch(folder);
    process.kill(Number(readFileSync(join(folder, 'bridge.pid'), 'utf8')), signal);
    const [code] = await child.done;
    if (signal === 'SIGUSR2') assert.equal(code, 0, 'Normal bridge exit must preserve success status');
    assert.deepEqual(read(folder), { unrelated }, 'Normal exit and bridge crashes must unregister');
  }

  for (const change of ['modified', 'removed']) {
    const folder = setup(change);
    const child = await launch(folder);
    const config = read(folder);
    const name = Object.keys(config).find((name) => name !== 'unrelated');
    if (change === 'modified') config[name].transport.env.FIGMA_CACHE_ROOT = '/different/cache';
    else delete config[name];
    writeFileSync(join(folder, 'config.json'), JSON.stringify(config));
    child.kill('SIGINT');
    await child.done;
    assert.deepEqual(read(folder), config, 'Externally changed or removed registrations must stay untouched');
  }

  const failure = setup('startup-failure');
  const child = await launch(failure, 'failure');
  assert.equal((await child.done)[0], 1);
  assert.deepEqual(read(failure), { unrelated });
  if (process.platform !== 'win32') {
    const folder = setup('terminal-close');
    execFileSync('python3', ['-c', `
import os, pty, select, subprocess, sys, time
master, slave = pty.openpty()
# No controlling-terminal/session setup: closing this PTY sends no SIGHUP.
child = subprocess.Popen([sys.argv[1], sys.argv[2], '--output-dir', sys.argv[3]], stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
os.close(slave)
output = b''
try:
    deadline = time.monotonic() + 15
    while b'Ready:' not in output:
        assert time.monotonic() < deadline, 'Launcher did not become ready'
        if select.select([child.stdout], [], [], 0.2)[0]:
            chunk = os.read(child.stdout.fileno(), 4096)
            assert chunk, 'Launcher exited before becoming ready: ' + child.stderr.read().decode()
            output += chunk
    os.close(master)
    master = None
    child.communicate(timeout=10)
finally:
    if master is not None: os.close(master)
    if child.poll() is None:
        child.kill()
        child.communicate(timeout=5)
`, process.execPath, join(bin, 'figma-mcp.mjs'), folder], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_CONFIG: join(folder, 'config.json'), BRIDGE_PID: join(folder, 'bridge.pid'), BRIDGE_MODE: '' },
      timeout: 30000,
    });
    assert.deepEqual(read(folder), { unrelated }, 'Terminal closure without SIGHUP must unregister');
    console.log('PTY closure without SIGHUP stops the launcher and removes its registration.');
  }
  if (process.argv.includes('--real-codex')) {
    const folder = setup('real-codex');
    const codexHome = join(folder, 'codex-home');
    mkdirSync(codexHome);
    const env = { ...process.env, CODEX_HOME: codexHome, BRIDGE_PID: join(folder, 'bridge.pid'), BRIDGE_MODE: '' };
    const cli = (...args) => execFileSync('codex', args, { env, cwd: folder, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const configFile = join(codexHome, 'config.toml');
    writeFileSync(configFile, '# Keep this comment\napproval_policy = "on-request"\n');
    cli('mcp', 'add', 'unrelated', '--', 'node', 'unrelated.js');
    const before = readFileSync(configFile, 'utf8');
    const child = spawn(process.execPath, [join(bin, 'figma-mcp.mjs'), '--output-dir', folder], { env, cwd: folder });
    children.push(child);
    child.done = once(child, 'close');
    let output = '';
    let errors = '';
    child.stdout.on('data', (chunk) => output += chunk);
    child.stderr.on('data', (chunk) => errors += chunk);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Real Codex startup timed out: ${errors}`)), 15000);
      child.stdout.on('data', () => { if (output.includes('Ready:')) { clearTimeout(timeout); resolve(); } });
      child.once('close', () => { clearTimeout(timeout); reject(new Error(`Real Codex startup failed: ${errors}`)); });
    });
    const config = readFileSync(configFile, 'utf8');
    for (const tool of ['list_screens', 'get_screen', 'get_metadata', 'get_node', 'get_preview', 'get_variables', 'search_nodes']) {
      assert.ok(config.includes(`.tools.${tool}]\napproval_mode = "approve"`), `Missing persisted approval for ${tool}`);
    }
    assert.ok(config.startsWith(before), 'Existing config and comments must survive');
    cli('app-server', '--strict-config', '--print-startup-config');
    assert.equal(JSON.parse(cli('mcp', 'list', '--json')).length, 2);
    child.kill('SIGINT');
    await child.done;
    assert.deepEqual(JSON.parse(cli('mcp', 'list', '--json')).map((server) => server.name), ['unrelated']);
    assert.equal(readFileSync(configFile, 'utf8'), before, 'Shutdown must remove permissions too');
    console.log('Real Codex integration passed: seven saved tool approvals, strict config validation, comment preservation, and complete shutdown cleanup.');
  }
  if (process.argv.includes('--with-bridge')) {
    copyFileSync(new URL('../bin/bridge.mjs', import.meta.url), join(bin, 'bridge.mjs'));
    const folder = setup('real-bridge');
    const owner = await launch(folder);
    const duplicate = await launch(folder, 'duplicate');
    assert.equal((await duplicate.done)[0], 0);
    assert.equal(Object.keys(read(folder)).length, 2, 'Real duplicate must preserve owner registration');
    owner.kill('SIGHUP');
    await owner.done;
    assert.deepEqual(read(folder), { unrelated });
    const orphanFolder = setup('launcher-killed');
    const orphanOwner = await launch(orphanFolder);
    orphanOwner.kill('SIGKILL');
    await Promise.race([
      orphanOwner.done,
      new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Bridge survived launcher death')), 10000); timer.unref(); }),
    ]);
    assert.deepEqual(read(orphanFolder), { unrelated }, 'Bridge must remove config after launcher death');
    const restarted = await launch(orphanFolder);
    restarted.kill('SIGINT');
    await restarted.done;
    assert.deepEqual(read(orphanFolder), { unrelated });
    console.log('Launcher death stops its bridge, removes config, and permits immediate restart.');
    console.log('Real bridge integration passed: startup, duplicate detection, and terminal-close cleanup.');
  }
  console.log('Launcher cleanup passed: SIGINT, SIGHUP, SIGTERM, bridge exit, duplicate launch, external changes, startup failure, and export preservation.');
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.all(children.map((child) => child.done));
  rmSync(root, { recursive: true, force: true });
}
