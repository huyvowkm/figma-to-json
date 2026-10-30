import assert from 'node:assert/strict';
import stringWidth from 'string-width';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { renderMonitor } from '../bin/monitor-ui.mjs';
import { displayPath } from '../bin/display-path.mjs';

const rows = Array.from({ length: 30 }, (_, index) => ({
  name: `figma-project-${index}`, project: `/projects/project-${index}`, state: index === 29 ? 'stopped' : 'running',
  port: 3847, bridgePid: 1234, registered: true, enabled: true, approvedTools: 7, totalTools: 7,
  exports: { count: 2, latest: { file: 'home.json', at: '2026-10-29T10:00:00Z' } },
}));
const strip = (value) => value.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
for (const columns of [44, 60, 80, 120]) {
  const frame = renderMonitor(rows, { selected: 29, columns, height: 24 });
  const lines = strip(frame).split('\n');
  assert.ok(lines.length <= 24);
  assert.ok(lines.every((line) => stringWidth(line) <= columns), `Frame must fit ${columns} columns`);
  assert.ok(frame.includes('Server 30 of 30'));
  assert.ok(frame.includes('figma-project-29'));
  assert.ok(strip(frame).includes('│ ›'));
  assert.ok(frame.includes('S Stop  R Refresh  c Clean row  Q Quit'));
  assert.ok(frame.includes('Shift+C Clean all stale'));
  assert.ok(!frame.includes('Enter') && !frame.includes('←/→'));
}
const empty = renderMonitor([], { columns: 80 });
assert.ok(empty.includes('No local Figma servers found.'));
assert.ok(!empty.includes('unavailable') && !empty.includes('Working'));
const loading = renderMonitor([], { columns: 240, loading: true });
assert.ok(loading.includes('Checking local Figma servers'));
assert.ok(!loading.includes('No local Figma servers found.') && !loading.includes('Last export'));
for (const columns of [44, 80, 160, 300]) {
  const frame = renderMonitor([], { columns });
  const lines = strip(frame).split('\n');
  assert.ok(frame.includes('No local Figma servers found.'));
  assert.ok(!frame.includes('No se…') && !frame.includes('Last export') && !frame.includes('Selected server'));
  assert.ok(lines.every((line) => stringWidth(line) <= Math.min(columns - 2, 72)), 'Empty state must stay compact');
}
assert.ok(renderMonitor(rows, { columns: 25 }).includes('Enlarge the terminal'));
assert.ok(renderMonitor(rows, { height: 10 }).includes('Enlarge the terminal'));
assert.ok(!renderMonitor([], { columns: 44 }).includes('Stop unavailable'));
const result = renderMonitor(rows, { selected: 29, message: 'Cleaned: nothing stale.' });
assert.ok(result.includes('Cleaned: nothing stale.'));
assert.ok(!result.includes('Stop unavailable') && !result.includes('Working'));
assert.ok(strip(renderMonitor(rows, { columns: 44, height: 18 })).split('\n').length <= 18);
const unsafe = renderMonitor([{ ...rows[0], project: '/projects/\x1b[2Jproject' }]);
assert.ok(!unsafe.includes('\x1b[2J'), 'Project names must not inject terminal control sequences');
const wide = renderMonitor(rows, { selected: 29, columns: 260, height: 24 });
assert.ok(!wide.includes('Selected server'), 'Wide terminals must put details in the main table');
for (const label of ['Server', 'Folder', 'State', 'Port', 'Config', 'PID', 'Tools', 'Exports', 'Last export']) {
  assert.ok(wide.split('\n')[2].includes(label), `Missing wide column ${label}`);
}
assert.ok(wide.includes('/projects/project-29'));
assert.ok(wide.includes('home.json · 2026-10-29T10:00:00Z'));
const extraWide = renderMonitor(rows, { selected: 29, columns: 400, height: 24 });
assert.equal(extraWide, wide, 'A full table must size to its data, not stretch Folder across spare columns');
const narrow = renderMonitor(rows, { selected: 29, columns: 80, height: 24 });
assert.equal(narrow.split('┌').length - 1, 2, 'Narrow layout needs list and selected-detail tables');
assert.ok(narrow.split('Selected server')[1].includes('figma-project-29'));
assert.ok(!narrow.split('Selected server')[1].includes('figma-project-28'));
const longRow = { ...rows[0], name: 'figma-998-14-jab-jab-mobile-6c4622f4', project: '/Users/huyvo/Documents/apps/日本語/ghi chú/📁/998_14_jab_jab-mobile' };
for (const columns of [44, 80, 160, 300]) {
  for (const height of [18, 24, 40]) {
    const lines = strip(renderMonitor([longRow], { columns, height })).split('\n');
    assert.ok(lines.length <= height, `Details must fit height ${height}`);
    assert.ok(lines.every((line) => stringWidth(line) <= columns), `Details must fit width ${columns}`);
  }
}
const homeProject = join(homedir(), 'Documents', 'apps', 'demo');
assert.equal(displayPath(homedir()), '~');
assert.equal(displayPath(homeProject), `~${sep}Documents${sep}apps${sep}demo`);
assert.equal(displayPath(`${homedir()}-other${sep}demo`), `${homedir()}-other${sep}demo`, 'Only a complete home-directory prefix may be shortened');
assert.equal(displayPath('/projects/demo'), '/projects/demo');
const homeRow = { ...rows[0], project: homeProject };
for (const columns of [80, 300]) {
  const frame = renderMonitor([homeRow], { columns });
  assert.ok(frame.includes(`~${sep}Documents${sep}apps${sep}demo`));
  assert.ok(!frame.includes(homedir()));
}
assert.equal(homeRow.project, homeProject, 'Presentation must preserve the full operational path');
console.log('Monitor UI passed: selection, scrolling, actions, empty state, narrow/short terminals, and control-character filtering.');
