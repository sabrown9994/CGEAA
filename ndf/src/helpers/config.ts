import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.cgeaa', 'config');

export function readCgeaaConfig(): Record<string, string> {
  if (!existsSync(CONFIG_PATH)) return {};
  const lines = readFileSync(CONFIG_PATH, 'utf-8').split('\n');
  const result: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      result[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
  }
  return result;
}

export function writeCgeaaConfigKey(key: string, value: string): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  let content = '';
  if (existsSync(CONFIG_PATH)) {
    content = readFileSync(CONFIG_PATH, 'utf-8');
  }
  const lines = content.length ? content.replace(/\n$/, '').split('\n') : [];
  const idx = lines.findIndex((l) => l.startsWith(`${key}=`));
  if (idx >= 0) {
    lines[idx] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  writeFileSync(CONFIG_PATH, lines.join('\n') + '\n', 'utf-8');
}
