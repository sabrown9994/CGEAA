import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { RESOURCE_SUBFOLDERS, OUTPUT_DIR } from '../constants.js';

function outputDir(): string {
  return process.env.ZDF_OUTPUT_DIR ?? OUTPUT_DIR;
}

/**
 * Returns the effective output directory (honors ZDF_OUTPUT_DIR override).
 * Use this for generic/bare directory references in user-facing messages
 * where a specific resource path via resolveFilePath() doesn't apply
 * (e.g. help text with a placeholder name, or a batch-completion summary).
 */
export function getOutputDir(): string {
  return outputDir();
}

/**
 * Sanitize a path segment to prevent path traversal attacks.
 * Only allows alphanumeric characters, hyphens, underscores, and dots.
 */
function sanitizeSegment(segment: string): string {
  if (segment.length === 0) {
    throw new Error('Path segment cannot be empty.');
  }
  if (/[^a-zA-Z0-9\-_.]/.test(segment)) {
    throw new Error(`Invalid path segment "${segment}": only alphanumeric, hyphens, underscores, and dots are allowed.`);
  }
  return segment;
}

function resourcePath(resourceType: string, nameOrId: string, ext = 'json'): string {
  const rawSubfolder = RESOURCE_SUBFOLDERS[resourceType] ?? resourceType;
  const safeSubfolder = sanitizeSegment(rawSubfolder);
  const safeNameOrId = sanitizeSegment(nameOrId);
  const safeExt = sanitizeSegment(ext);
  return join(outputDir(), safeSubfolder, `${safeNameOrId}.${safeExt}`);
}

export function readResourceFile(resourceType: string, nameOrId: string, ext = 'json'): unknown {
  const p = resourcePath(resourceType, nameOrId, ext);
  if (!existsSync(p)) {
    throw new Error(
      `No file found at ${p}. Run 'zdf pull ${resourceType} ${nameOrId}' first or provide --file <path>.`
    );
  }
  const contents = readFileSync(p, 'utf-8');
  if (ext === 'sql') return contents;
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`Failed to parse JSON at ${p}: file may be malformed.`);
  }
}

export function writeResourceFile(resourceType: string, id: string, data: unknown, ext = 'json'): void {
  const p = resourcePath(resourceType, id, ext);
  mkdirSync(dirname(p), { recursive: true });
  const content = ext === 'sql' ? String(data) : JSON.stringify(data, null, 2);
  writeFileSync(p, content, 'utf-8');
}

export function renameResourceFile(resourceType: string, oldName: string, newId: string, ext = 'json'): void {
  const oldPath = resourcePath(resourceType, oldName, ext);
  const newPath = resourcePath(resourceType, newId, ext);
  renameSync(oldPath, newPath);
}

export function deleteResourceFile(resourceType: string, id: string, ext = 'json'): void {
  const p = resourcePath(resourceType, id, ext);
  if (existsSync(p)) unlinkSync(p);
}

export function resolveFilePath(resourceType: string, nameOrId: string, ext = 'json'): string {
  return resourcePath(resourceType, nameOrId, ext);
}
