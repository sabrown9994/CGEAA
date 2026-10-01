import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export function listAuthIds(projectDir: string): string[] {
  const raw = execSync('suitecloud account:manageauth --list', { cwd: projectDir }).toString();
  return raw
    .replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
    .split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.split('|')[0].trim()).filter(Boolean);
}

export function validateAuthId(projectDir: string, authId: string): void {
  const ids = listAuthIds(projectDir);
  if (!ids.includes(authId)) {
    throw new Error(
      `Unknown auth ID "${authId}". Configured auth IDs: ${ids.join(', ') || '(none)'}. ` +
      `Run 'cgeaa netsuite envs' to list them.`,
    );
  }
}

export function setDefaultAuthId(projectDir: string, authId: string): void {
  const path = join(projectDir, 'project.json');
  const current = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
  current['defaultAuthId'] = authId;
  writeFileSync(path, JSON.stringify(current, null, '\t'), 'utf-8');
}
