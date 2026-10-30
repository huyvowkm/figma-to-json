import { homedir } from 'node:os';
import { sep } from 'node:path';

export function displayPath(value) {
  const home = homedir();
  if (value === home) return '~';
  return value?.startsWith(`${home}${sep}`) ? `~${value.slice(home.length)}` : value;
}
