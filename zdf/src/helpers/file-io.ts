import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { RESOURCE_SUBFOLDERS, OUTPUT_DIR } from '../constants.js';
import { fileNameFor, hasNaturalKey, recordId } from './resource-registry.js';

/**
 * Natural-key-named resources write their file as `<naturalKey>.json`, but `pull` is typically
 * invoked with the internal Zuora id — so a later `push`/`delete` by that same id would miss the
 * file. When the direct `<nameOrId>.json` path doesn't exist for such a resource, scan the folder
 * for the .json whose STORED record id matches `nameOrId` and return that path. Returns null if
 * nothing matches (or the resource isn't natural-keyed / dir absent). JSON only.
 */
function findByStoredId(resourceType: string, nameOrId: string): string | null {
  if (!hasNaturalKey(resourceType)) return null;
  const dir = join(outputDir(), sanitizeSegment(RESOURCE_SUBFOLDERS[resourceType] ?? resourceType));
  if (!existsSync(dir)) return null;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      const rec = JSON.parse(readFileSync(join(dir, f), 'utf-8')) as Record<string, unknown>;
      if (recordId(rec) === nameOrId) return join(dir, f);
    } catch {
      // ignore unparseable files
    }
  }
  return null;
}

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
  let p = resourcePath(resourceType, nameOrId, ext);
  if (!existsSync(p)) {
    // Natural-key-named resource pulled by internal id: find the file by its stored id.
    const alt = ext === 'json' ? findByStoredId(resourceType, nameOrId) : null;
    if (alt) {
      p = alt;
    } else {
      const hint = hasNaturalKey(resourceType)
        ? ` (Note: ${resourceType} files are named by their natural key — check the path printed by 'pull'.)`
        : '';
      throw new Error(
        `No file found at ${p}. Run 'zdf pull ${resourceType} ${nameOrId}' first or provide --file <path>.${hint}`
      );
    }
  }
  const contents = readFileSync(p, 'utf-8');
  if (ext === 'sql') return contents;
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error(`Failed to parse JSON at ${p}: file may be malformed.`);
  }
}

export function writeResourceFile(resourceType: string, id: string, data: unknown, ext = 'json'): string {
  // Name the file by the resource's natural key when it has one (derived from the record);
  // otherwise fall back to the id. JSON only — non-JSON artifacts (e.g. data-query .sql) use the id.
  const fileName = ext === 'json' && data && typeof data === 'object'
    ? fileNameFor(resourceType, id, data as Record<string, unknown>)
    : id;
  const p = resourcePath(resourceType, fileName, ext);
  mkdirSync(dirname(p), { recursive: true });
  const content = ext === 'sql' ? String(data) : JSON.stringify(data, null, 2);
  writeFileSync(p, content, 'utf-8');
  return p;
}

/**
 * Write a resource file under a LITERAL filename (no natural-key derivation). Used by the
 * `template` command, whose skeleton bodies carry placeholder values that must not drive the
 * filename. Returns the written path.
 */
export function writeResourceFileAs(resourceType: string, fileName: string, data: unknown, ext = 'json'): string {
  const p = resourcePath(resourceType, fileName, ext);
  mkdirSync(dirname(p), { recursive: true });
  const content = ext === 'sql' ? String(data) : JSON.stringify(data, null, 2);
  writeFileSync(p, content, 'utf-8');
  return p;
}

export function renameResourceFile(resourceType: string, oldName: string, newId: string, ext = 'json'): void {
  const oldPath = resourcePath(resourceType, oldName, ext);
  const newPath = resourcePath(resourceType, newId, ext);
  renameSync(oldPath, newPath);
}

export function deleteResourceFile(resourceType: string, id: string, ext = 'json'): void {
  let p = resourcePath(resourceType, id, ext);
  // Natural-key-named resource being cleaned up by internal id: find the real file by stored id
  // so we don't leave an orphaned local file after the remote record is gone.
  if (!existsSync(p) && ext === 'json') {
    p = findByStoredId(resourceType, id) ?? p;
  }
  if (existsSync(p)) unlinkSync(p);
}

export function resolveFilePath(resourceType: string, nameOrId: string, ext = 'json'): string {
  return resourcePath(resourceType, nameOrId, ext);
}
