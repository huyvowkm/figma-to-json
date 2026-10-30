import { createElement as h, useCallback, useEffect, useRef, useState } from 'react';
import { render, useApp, useInput, useStdin, useWindowSize } from 'ink';
import { MonitorView } from './monitor-ui.mjs';

function MonitorApp({ loadServers, stopServer, cleanServers }) {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { columns, rows: height } = useWindowSize();
  const [view, setView] = useState({ rows: [], selected: 0, message: '', loading: true });
  const state = useRef(view);
  const busy = useRef(false);
  const closed = useRef(false);
  const update = useCallback((change) => {
    if (closed.current) return;
    state.current = change(state.current);
    setView(state.current);
  }, []);
  const quit = useCallback(() => { closed.current = true; exit(); }, [exit]);
  const refresh = useCallback(async (manual = false, resultMessage) => {
    if (busy.current || closed.current) return;
    busy.current = true;
    if (manual) update((current) => ({ ...current, message: 'Refreshing…' }));
    try {
      const rows = await loadServers();
      update((current) => {
        const index = rows.findIndex((row) => row.name === current.rows[current.selected]?.name);
        return { rows, loading: false, selected: index >= 0 ? index : Math.max(0, Math.min(current.selected, rows.length - 1)),
          message: manual ? 'Refreshed.' : resultMessage ?? current.message };
      });
    } catch (error) { update((current) => ({ ...current, loading: false, message: error.message })); }
    finally { busy.current = false; }
  }, [loadServers, update]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(signal, quit);
    for (const event of ['end', 'close', 'error']) stdin.once(event, quit);
    return () => {
      closed.current = true;
      clearInterval(timer);
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.removeListener(signal, quit);
      for (const event of ['end', 'close', 'error']) stdin.removeListener(event, quit);
    };
  }, [refresh, quit, stdin]);

  useInput((input, key) => {
    const name = input.toLowerCase();
    if (name === 'q' && !key.ctrl && !key.meta || key.escape || key.ctrl && name === 'c') return quit();
    if (key.upArrow || key.downArrow) {
      update((current) => ({ ...current, selected: Math.max(0, Math.min(current.rows.length - 1, current.selected + (key.upArrow ? -1 : 1))) }));
      return;
    }
    if (key.ctrl || key.meta || !['s', 'c', 'r'].includes(name) || busy.current) return;
    if (name === 'r') { void refresh(true); return; }
    const row = state.current.rows[state.current.selected];
    const all = name === 'c' && (key.shift || input === 'C');
    if (name === 's' && row?.state !== 'running') {
      update((current) => ({ ...current, message: 'Select a running server to stop.' })); return;
    }
    if (name === 'c' && !all && row?.state !== 'stopped') {
      update((current) => ({ ...current, message: 'Select a stopped server to clean; Shift+C cleans all stale rows.' })); return;
    }
    busy.current = true;
    update((current) => ({ ...current, message: name === 's' ? `Stopping ${row.name}…` : all ? 'Cleaning all stale rows…' : `Cleaning ${row.name}…` }));
    void (async () => {
      let message;
      try {
        if (name === 's') { await stopServer(row.name, [row]); message = `Stopped ${row.name}.`; }
        else message = `Cleaned: ${(await cleanServers(all ? undefined : row.name)).join(', ') || 'nothing stale'}.`;
      } catch (error) { message = error.message; }
      finally { busy.current = false; await refresh(false, message); }
    })();
  });

  return h(MonitorView, { ...view, columns, height });
}

export async function startMonitor(services) {
  const app = render(h(MonitorApp, services), { alternateScreen: true, exitOnCtrlC: false, patchConsole: false, interactive: true });
  try { await app.waitUntilExit(); }
  finally { app.unmount(); }
}
