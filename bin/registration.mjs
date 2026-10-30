import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';

export function removeRegistration(server, transport) {
  if (!transport) return;
  const run = (...args) => execFileSync('codex', ['mcp', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
  });
  try {
    const current = JSON.parse(run('list', '--json')).find((entry) => entry.name === server);
    if (current && isDeepStrictEqual(current.transport, transport)) run('remove', server);
  } catch {
    console.error(`Could not confirm cleanup of ${server}. Check with codex mcp list; remove it with codex mcp remove ${server} if still present.`);
    process.exitCode = 1;
  }
}
