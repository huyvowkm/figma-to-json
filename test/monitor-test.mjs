import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { serverStatus, stopServer, cleanServers } from '../bin/monitor.mjs';
import { trackServer } from '../bin/server-state.mjs';

const root = mkdtempSync(join(tmpdir(), 'figma-monitor-test-'));
const home = join(root, 'codex');
mkdirSync(home);
const original = { CODEX_HOME: process.env.CODEX_HOME, FIGMA_MCP_STATE_DIR: process.env.FIGMA_MCP_STATE_DIR, FIGMA_MCP_PORT: process.env.FIGMA_MCP_PORT };
process.env.CODEX_HOME = home;
process.env.FIGMA_MCP_STATE_DIR = join(root, 'state');
delete process.env.FIGMA_MCP_PORT;
const launcher = fileURLToPath(new URL('../bin/figma-mcp.mjs', import.meta.url));
const serverScript = fileURLToPath(new URL('../server/dist/index.js', import.meta.url));
const children = [];
const cli = (...args) => execFileSync('codex', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd: root });
const run = (...args) => execFileSync(process.execPath, [launcher, ...args], { encoding: 'utf8', cwd: root, timeout: 20000 });
async function start(name) {
  const project = join(root, name);
  mkdirSync(project);
  const child = spawn(process.execPath, [launcher, '--output-dir', project], { env: { ...process.env, FIGMA_MCP_PORT: '0' }, cwd: root });
  child.done = once(child, 'close');
  children.push(child);
  let output = '';
  let errors = '';
  child.stdout.on('data', (chunk) => output += chunk);
  child.stderr.on('data', (chunk) => errors += chunk);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timed out: ${errors}`)), 15000);
    child.stdout.on('data', () => { if (output.includes('Ready:')) { clearTimeout(timer); resolve(); } });
    child.once('close', () => { clearTimeout(timer); reject(new Error(`Startup failed: ${errors}`)); });
  });
  return { child, project };
}
async function closedPort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, 'localhost', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function register(name, cacheDir) {
  cli('mcp', 'add', '--env', `FIGMA_CACHE_ROOT=${cacheDir}`, name, '--', 'node', serverScript);
  return JSON.parse(cli('mcp', 'get', name, '--json')).transport;
}

try {
  writeFileSync(join(home, 'config.toml'), '# monitor test sentinel\napproval_policy = "on-request"\n');
  cli('mcp', 'add', 'unrelated', '--', 'node', 'unrelated.js');
  const first = await start('first project');
  const second = await start('second');
  const exported = join(first.project, '.figma-cache/exported/home.json');
  writeFileSync(exported, '{}');
  let rows = await serverStatus();
  const owned = (item) => item.project.startsWith(`${root}/`);
  assert.equal(rows.filter(owned).length, 2);
  const row = rows.find((item) => item.project === first.project);
  assert.equal(row.state, 'running');
  assert.equal(row.registered, true);
  assert.equal(row.approvedTools, 7);
  assert.equal(row.exports.count, 1);
  assert.equal(row.exports.latest.file, 'home.json');
  assert.ok(row.bridgePid && row.launcherPid && row.startedAt);
  const health = await fetch(`http://localhost:${row.port}/health`).then((r) => r.json());
  const json = run('status', '--json');
  assert.equal(JSON.parse(json).filter(owned).length, 2);
  assert.ok(!json.includes(health.token), 'Status must never expose the connection token');
  const forbidden = await fetch(`http://localhost:${row.port}/shutdown`, { method: 'POST' });
  assert.equal(forbidden.status, 403, 'Stopping requires authentication');
  assert.equal((await fetch(`http://localhost:${row.port}/health`)).status, 200);

  if (process.platform !== 'win32') {
    let previouslyStopped;
    const selectedCleanup = 'figma-clean-selected';
    const otherCleanup = 'figma-clean-other';
    for (const interaction of ['lowercase', 'uppercase']) {
      const arrowTarget = await start(`zz-${interaction}-target`);
      if (interaction === 'uppercase') {
        const port = await closedPort();
        for (const name of [selectedCleanup, otherCleanup]) {
          const cacheDir = join(root, name, '.figma-cache');
          const transport = register(name, cacheDir);
          trackServer({ name, project: join(root, name), cacheDir, port, transport,
            bridgePid: 2147483647, launcherPid: 2147483647, instanceId: name });
        }
      }
      const monitorRows = await serverStatus();
      const targetIndex = monitorRows.findIndex((item) => item.project === arrowTarget.project);
      const targetName = monitorRows[targetIndex].name;
      execFileSync('python3', ['-c', `
import fcntl, os, pty, re, select, signal, struct, subprocess, sys, termios, time, urllib.request
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
before = termios.tcgetattr(slave)
child = subprocess.Popen([sys.argv[1], sys.argv[2], 'monitor'], stdin=slave, stdout=slave, stderr=slave)
output = b''
index, count, name = int(sys.argv[3]), int(sys.argv[4]), sys.argv[5].encode()
uppercase = sys.argv[6] == 'uppercase'
cleanup_index, cleanup_name, other_name = int(sys.argv[8]), sys.argv[9].encode(), sys.argv[10].encode()
position = ('Server %s of %s' % (index + 1, count)).encode()
def selected(frame, value):
    return any(line.startswith('│ Server'.encode()) and value in line for line in frame.splitlines())
def latest_frame():
    # Ink repaints full frames with its own cursor/erase sequences.
    frame = output.rsplit(b'Figma MCP servers', 1)[-1]
    return re.sub(rb'\\x1b\\[[0-?]*[ -/]*[@-~]', b'', frame)
def wait_frame(predicate):
    global output
    deadline = time.monotonic() + 20
    while True:
        frame = latest_frame()
        if predicate(frame): return frame
        assert time.monotonic() < deadline, 'Monitor did not update: ' + latest_frame().decode(errors='replace')
        if select.select([master], [], [], 0.2)[0]: output += os.read(master, 8192)
try:
    wait_frame(lambda frame: ('Server 1 of %s' % count).encode() in frame)
    os.write(master, b'\\x1b[B' * index)
    wait_frame(lambda frame: position in frame and selected(frame, name))
    if uppercase:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 300, 0, 0))
        os.kill(child.pid, signal.SIGWINCH)
        wait_frame(lambda frame: position in frame and b'Folder' in frame and b'Last export' in frame and b'Selected server' not in frame)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 100, 0, 0))
        os.kill(child.pid, signal.SIGWINCH)
        wait_frame(lambda frame: position in frame and selected(frame, name))
    # Left/right and Enter must not activate any action.
    os.write(master, b'\\x1b[C\\r\\x1b[D\\r')
    time.sleep(0.2)
    with urllib.request.urlopen('http://localhost:' + sys.argv[7] + '/health', timeout=2) as response:
        assert response.status == 200, 'Enter must not stop the selected server'
    # Activate Refresh, then check the same server remains selected.
    os.write(master, b'R' if uppercase else b'r')
    wait_frame(lambda frame: position in frame and b'Refreshing' in frame)
    wait_frame(lambda frame: position in frame and b'Refreshed.' in frame and selected(frame, name))
    # Stop only the selected fixture server with one key.
    os.write(master, b'S' if uppercase else b's')
    wait_frame(lambda frame: b'Stopped ' + name in frame)
    if uppercase:
        # Plain c removes only the selected stopped fixture.
        os.write(master, b'\\x1b[A' * count + b'\\x1b[B' * cleanup_index)
        wait_frame(lambda frame: selected(frame, cleanup_name))
        os.write(master, b'c')
        wait_frame(lambda frame: b'Cleaned: ' + cleanup_name in frame)
        record = lambda value: os.path.join(os.environ['FIGMA_MCP_STATE_DIR'], value.decode() + '.json')
        assert not os.path.exists(record(cleanup_name)), 'c must remove the selected stale record'
        assert os.path.exists(record(other_name)), 'c must preserve other stale records'
        # A shifted C performs the separate all-stale action.
        os.write(master, b'C')
        wait_frame(lambda frame: b'Cleaning all stale rows' in frame)
        wait_frame(lambda frame: b'Cleaned:' in frame and b'Cleaning all stale rows' not in frame)
        assert not os.path.exists(record(other_name)), 'Shift+C must remove the other stale record'
        # Background refreshes must preserve the action result without generic status chatter.
        deadline = time.monotonic() + 2.5
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.2)[0]: output += os.read(master, 8192)
        assert b'Cleaned:' in latest_frame()
    assert b'Working' not in output and b'Stop unavailable' not in output
    os.write(master, b'Q' if uppercase else b'q')
    deadline = time.monotonic() + 10
    while child.poll() is None:
        assert time.monotonic() < deadline, 'Monitor did not quit: ' + output.decode(errors='replace')
        if select.select([master], [], [], 0.2)[0]:
            try: output += os.read(master, 8192)
            except OSError: break
    assert child.wait(timeout=2) == 0
    assert b'running' in output
    assert b'\\x1b[?25h' in output and b'\\x1b[?1049l' in output, 'Cursor and screen must be restored'
    assert termios.tcgetattr(slave) == before, 'Raw terminal settings must be restored'
finally:
    if child.poll() is None: child.kill(); child.wait()
    os.close(slave)
    os.close(master)
`, process.execPath, launcher, String(targetIndex), String(monitorRows.length), targetName, interaction, String(monitorRows[targetIndex].port), String(monitorRows.findIndex((item) => item.name === selectedCleanup)), selectedCleanup, otherCleanup], { cwd: root, timeout: 75000 });
      await arrowTarget.child.done;
      const after = await serverStatus();
      if (interaction === 'uppercase') {
        assert.ok(!after.some((item) => item.project === previouslyStopped), 'Shift+C must remove the previously stopped record');
        assert.ok(!after.some((item) => [selectedCleanup, otherCleanup].includes(item.name)));
      } else previouslyStopped = arrowTarget.project;
      assert.equal(after.find((item) => item.project === arrowTarget.project).state, 'stopped');
      assert.equal(after.filter((item) => owned(item) && item.state === 'running').length, 2, 'Only the selected server should stop');
    }
  }

  // Detect a changed instance instead of stopping whichever process now owns the port.
  await assert.rejects(stopServer(row.name, [{ ...row, instanceId: 'outdated' }]), /changed since/);
  run('stop', row.name);
  await first.child.done;
  rows = await serverStatus();
  assert.equal(rows.find((item) => item.name === row.name).state, 'stopped');
  assert.equal(rows.find((item) => item.project === second.project).state, 'running');
  assert.equal(readFileSync(exported, 'utf8'), '{}');

  const port = await closedPort();
  const staleCache = join(root, 'stale/.figma-cache');
  const transport = register('figma-stale', staleCache);
  trackServer({ name: 'figma-stale', project: join(root, 'stale'), cacheDir: staleCache, port,
    bridgePid: 2147483647, launcherPid: 2147483647, instanceId: 'stale', transport });
  const busyCache = join(root, 'unresponsive/.figma-cache');
  const busyTransport = register('figma-unresponsive', busyCache);
  trackServer({ name: 'figma-unresponsive', project: join(root, 'unresponsive'), cacheDir: busyCache, port,
    bridgePid: process.pid, launcherPid: process.pid, instanceId: 'busy', transport: busyTransport });
  register('figma-untracked', join(root, 'untracked/.figma-cache'));
  const changedCache = join(root, 'changed/.figma-cache');
  const changed = register('figma-changed', changedCache);
  trackServer({ name: 'figma-changed', project: join(root, 'changed'), cacheDir: changedCache, port,
    bridgePid: 2147483647, launcherPid: 2147483647, instanceId: 'changed', transport: { ...changed, command: 'different' } });
  rows = await serverStatus();
  assert.equal(rows.find((item) => item.name === 'figma-unresponsive').state, 'unresponsive');
  assert.equal(rows.find((item) => item.name === 'figma-untracked').state, 'untracked');
  assert.deepEqual(await cleanServers('figma-stale'), ['figma-stale']);
  assert.ok((await serverStatus()).some((item) => item.name === row.name), 'Named clean must preserve other stopped records');
  const cleaned = await cleanServers();
  assert.ok(cleaned.includes(row.name));
  const names = JSON.parse(cli('mcp', 'list', '--json')).map((entry) => entry.name);
  for (const name of ['unrelated', 'figma-unresponsive', 'figma-untracked', 'figma-changed']) assert.ok(names.includes(name));
  assert.ok(!names.includes('figma-stale'));
  assert.ok(readFileSync(join(home, 'config.toml'), 'utf8').includes('# monitor test sentinel'));
  const active = (await serverStatus()).find((item) => item.project === second.project);
  await stopServer(active.name);
  await second.child.done;
  assert.match(run('clean'), /Cleaned:/);
  console.log('Monitor passed: live/JSON status, seven approvals, exports, authenticated stop, PTY monitor, instance checks, stale cleanup, custom ports, and unrelated config preservation.');
} finally {
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await Promise.all(children.map((child) => child.done));
  for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
}
