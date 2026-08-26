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
      if (matchesStoredId(rec, nameOrId)) return join(dir, f);
    } catch {
      // ignore unparseable files
    }
  }
  return null;
}

/** A record matches an internal id if it's the record's own current id (recordId) OR ANY id stored
 * in its `_zdf` cross-tenant map. The `_zdf` fallback matters after a cross-tenant push: the file is
 * re-fetched from the target tenant, so `recordId` becomes the TARGET id, while a sibling FK (e.g. an
 * invoice's `accountId`) still references the SOURCE-tenant id — which lives on in `_zdf[sourceEnv].id`.
 * Matching on `_zdf` ids keeps the file findable by the id in any tenant it's known in. */
function matchesStoredId(rec: Record<string, unknown>, id: string): boolean {
  if (recordId(rec) === id) return true;
  const envMap = rec['_zdf'];
  if (envMap && typeof envMap === 'object') {
    for (const entry of Object.values(envMap as Record<string, unknown>)) {
      if (entry && typeof entry === 'object' && (entry as Record<string, unknown>)['id'] === id) return true;
    }
  }
  return false;
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
        `No file found at ${p}. Run 'cgeaa zuora pull ${resourceType} ${nameOrId}' first or provide --file <path>.${hint}`
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

/**
 * Reads a resource file by its EXACT filename — no `findByStoredId` id-scan fallback. Used by the
 * cross-tenant `_zdf` map merge (env-map.ts `mergeExistingEnvMap`), which must look up the
 * existing file by the SAME name `writeResourceFile` is about to use (typically derived from the
 * record's natural key), not by an internal id that differs per tenant — the id-scan fallback
 * would either miss the file (natural key case, wrong scan target) or match the wrong file
 * entirely (id-keyed case, since the tenant-specific id is exactly what's changing). Returns
 * `undefined` (never throws) when the file doesn't exist or can't be parsed.
 */
export function readResourceFileIfExists(resourceType: string, fileName: string, ext = 'json'): unknown | undefined {
  const p = resourcePath(resourceType, fileName, ext);
  if (!existsSync(p)) return undefined;
  const contents = readFileSync(p, 'utf-8');
  if (ext === 'sql') return contents;
  try {
    return JSON.parse(contents);
  } catch {
    return undefined;
  }
}

/**
 * Reads a resource file when the caller's reference could be EITHER the natural key (the file's
 * actual on-disk name for natural-keyed resources) OR the resource's internal Zuora id (e.g. a
 * cross-tenant FK captured on another record, like a memo's `invoiceId`) — mirrors
 * `readResourceFile`'s own id-scan fallback, but never throws. Tries the exact filename first
 * (`readResourceFileIfExists`); if that misses and the resource is natural-keyed, falls back to
 * `findByStoredId` to scan for the file whose STORED record id matches `idOrName`. Returns
 * `undefined` (never throws) when nothing matches either way. JSON only (no `sql` ext — that
 * extension has no natural-key/id ambiguity to resolve).
 */
export function readResourceFileByIdOrName(resourceType: string, idOrName: string): unknown | undefined {
  const direct = readResourceFileIfExists(resourceType, idOrName);
  if (direct !== undefined) return direct;
  const altPath = findByStoredId(resourceType, idOrName);
  if (!altPath) return undefined;
  try {
    return JSON.parse(readFileSync(altPath, 'utf-8'));
  } catch {
    return undefined;
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
