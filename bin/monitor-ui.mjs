import { basename } from 'node:path';
import { createElement as h } from 'react';
import { Box, Text, renderToString } from 'ink';
import stringWidth from 'string-width';
import wrapAnsi from 'wrap-ansi';
import { displayPath } from './display-path.mjs';

const text = (value) => String(value ?? '-').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
const config = (row) => row?.registered ? row.enabled ? 'saved' : 'disabled' : 'removed';
const tools = (row) => `${row?.approvedTools ?? 0}/${row?.totalTools ?? 7}`;
const lastExport = (row) => row?.exports.latest ? `${row.exports.latest.file} · ${row.exports.latest.at}` : '-';

function monitorLayout(rows, selected, columns, height) {
  let width = columns - 2;
  const row = rows[selected];
  const fields = [
    { title: '', width: 1, value: (_, index) => index === selected ? '›' : ' ' },
    { title: 'Server', value: (item) => item.name },
    { title: 'Folder', value: (item) => displayPath(item.project) },
    { title: 'State', value: (item) => item.state },
    { title: 'Port', value: (item) => item.port },
    { title: 'Config', value: config },
    { title: 'PID', value: (item) => item.bridgePid },
    { title: 'Tools', value: tools },
    { title: 'Exports', value: (item) => item.exports.count ?? '?' },
    { title: 'Last export', value: lastExport },
  ];
  for (const field of fields) field.width ??= Math.max(stringWidth(field.title), ...rows.map((item, index) => stringWidth(text(field.value(item, index)))));
  const fullWidth = fields.reduce((total, field) => total + field.width + 3, 1);
  let detailFields;
  const details = [];
  if (fullWidth <= width) width = fullWidth;
  else {
    fields.splice(1, fields.length - 1,
      { title: 'Project', width: 0, value: (item) => basename(item.project) },
      { title: 'State', width: 12, value: (item) => item.state },
      { title: 'Port', width: 5, value: (item) => item.port },
    );
    if (width >= 72) fields.push(
      { title: 'Config', width: 8, value: config },
      { title: 'Tools', width: 5, value: tools },
    );
    if (width >= 105) fields.push({ title: 'Exports', width: 7, value: (item) => item.exports.count ?? '?' });
    fields[1].width = width - 1 - fields.length * 3 - fields.reduce((total, field) => total + field.width, 0);
    const values = [
      ['Server', row?.name ?? '-'], ['Folder', displayPath(row?.project) ?? '-'],
      ['Config / PID', `${config(row)} · PID ${row?.bridgePid ?? '-'}`],
      ['Tools / Exports', `${tools(row)} · ${row?.exports.count ?? '-'} exports`],
      ['Last export', lastExport(row)],
    ];
    detailFields = [{ width: 15 }, { width: width - 22 }];
    const wrapped = values.map(([, value]) => wrapAnsi(text(value), detailFields[1].width, { hard: true, wordWrap: false, trim: false }).split('\n'));
    const counts = values.map(() => 1);
    // Keep one list row and the footer visible; spend spare height on selected values.
    let spare = height - 13 - values.length;
    while (spare > 0) {
      const index = [1, 0, 4, 2, 3].find((i) => counts[i] < wrapped[i].length);
      if (index === undefined) break;
      counts[index] += 1;
      spare -= 1;
    }
    values.forEach(([label], i) => {
      for (let line = 0; line < counts[i]; line += 1) {
        details.push({ key: `${label}-${line}`, values: [line === 0 ? label : '', line === counts[i] - 1 ? wrapped[i].slice(line).join('') : wrapped[i][line]] });
      }
    });
  }
  const visible = Math.max(1, height - 9 - (detailFields ? details.length + 3 : 0));
  const start = Math.max(0, selected - visible + 1);
  const items = rows.slice(start, start + visible).map((item, offset) => ({
    key: item.name, selected: start + offset === selected, values: fields.map((field) => field.value(item, start + offset)),
  }));
  return { width, fields, items, detailFields, details };
}

function TableRow({ fields, values, selected = false, header = false }) {
  return h(Box, { flexDirection: 'row', height: 1, flexShrink: 0, backgroundColor: selected ? 'cyan' : undefined },
    fields.map((field, index) => h(Box, {
      key: index, width: field.width + 2 + (index < fields.length - 1 ? 1 : 0), paddingX: 1, flexShrink: 0,
      borderStyle: 'single', borderTop: false, borderBottom: false, borderLeft: false, borderRight: index < fields.length - 1,
    }, h(Text, { bold: header || selected, color: selected ? 'black' : undefined, wrap: 'truncate-end' }, text(values[index])))),
  );
}

function Table({ width, fields, items, header = false }) {
  return h(Box, { width, flexDirection: 'column', borderStyle: 'single', flexShrink: 0 },
    header && h(TableRow, { fields, values: fields.map((field) => field.title), header: true }),
    header && h(Box, { height: 1, flexShrink: 0, borderStyle: 'single', borderTop: false, borderLeft: false, borderRight: false, borderBottom: true }),
    ...items.map((item) => h(TableRow, { ...item, fields })),
  );
}

export function MonitorView({ rows, selected = 0, columns = 80, height = 24, message = '', loading = false }) {
  if (columns < 44 || height < 18) return h(Text, null, 'Figma MCP monitor\nEnlarge the terminal to at least 44 columns × 18 rows.\nQ / Esc: quit');
  if (!rows.length) {
    return h(Box, { width: Math.min(columns - 2, 72), flexDirection: 'column' },
      h(Text, { bold: true }, 'Figma MCP servers'),
      h(Box, { borderStyle: 'round', paddingX: 1, flexDirection: 'column' },
        h(Text, null, loading ? 'Checking local Figma servers…' : 'No local Figma servers found.'),
        !loading && h(Text, null, 'Start in a project: run figma-mcp'),
      ),
      h(Box, { height: 1 }, h(Text, { wrap: 'truncate-end' }, text(message))),
      h(Text, null, 'R Refresh  Shift+C Clean stale  Q Quit'),
    );
  }
  const layout = monitorLayout(rows, selected, columns, height);
  const line = (value, options = {}) => h(Box, { height: 1, flexShrink: 0 }, h(Text, { wrap: 'truncate-end', ...options }, text(value)));
  return h(Box, { width: layout.width, flexDirection: 'column', flexShrink: 0 },
    line('Figma MCP servers', { bold: true }),
    h(Table, { ...layout, header: true }),
    line(rows.length ? `Server ${selected + 1} of ${rows.length}` : 'No local Figma servers found.'),
    layout.detailFields && h(Box, { flexDirection: 'column', flexShrink: 0 },
      line('Selected server', { bold: true }),
      h(Table, { width: layout.width, fields: layout.detailFields, items: layout.details }),
    ),
    line(message),
    line('↑/↓ Select  Shift+C Clean all stale'),
    line('S Stop  R Refresh  c Clean row  Q Quit'),
  );
}

export function renderMonitor(rows, options = {}) {
  return renderToString(h(MonitorView, { rows, ...options }), { columns: options.columns ?? 80 }).trimEnd();
}
