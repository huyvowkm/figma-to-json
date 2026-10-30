import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export const readTools = ['list_screens', 'get_screen', 'get_metadata', 'get_node', 'get_preview', 'get_variables', 'search_nodes'];

// Use Codex's own config editor to preserve TOML settings and comments.
export async function codexConfig(method, params) {
  const editor = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] });
  const lines = createInterface({ input: editor.stdout });
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out accessing Codex configuration')), 10000);
      const fail = (error) => { clearTimeout(timer); reject(error); };
      editor.once('error', fail);
      editor.once('exit', () => fail(new Error('Codex config editor exited before responding')));
      editor.stdin.on('error', fail);
      const send = (message) => editor.stdin.write(`${JSON.stringify(message)}\n`);
      lines.on('line', (line) => {
        try {
          const response = JSON.parse(line);
          if (response.error) throw new Error(response.error.message);
          if (response.id === 0) {
            send({ method: 'initialized' });
            send({ id: 1, method, params });
          } else if (response.id === 1) {
            clearTimeout(timer);
            resolve(response.result);
          }
        } catch (error) { fail(error); }
      });
      send({ id: 0, method: 'initialize', params: { clientInfo: { name: 'figma-mcp', version: '1.0.0' }, capabilities: null } });
    });
  } finally {
    lines.close();
    editor.kill();
  }
}
