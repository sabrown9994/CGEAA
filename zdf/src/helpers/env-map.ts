// Cross-tenant env-id map: a per-record `_zdf` map keyed by env name, tracking the resource's id
// and natural key (where applicable) in EACH tenant it's been pulled into/pushed from. This lets
// a later "upsert" feature look up "does this record already exist in tenant B" without relying on
// per-tenant internal ids being stable across environments (they aren't — see zdf/CLAUDE.md).
import { getActiveEnv } from '../auth/config.js';
import { readResourceFile, writeResourceFile, readResourceFileIfExists } from './file-io.js';
import { fileNameFor } from './resource-registry.js';

export const ENV_MAP_KEY = '_zdf';

export interface EnvEntry {
  id: string | null;
  key: string | null;
}

export type EnvMap = Record<string, EnvEntry>;

type Rec = Record<string, unknown>;

/** The name of the currently active environment (from auth config / CI env vars). */
export function activeEnvName(): string {
  return getActiveEnv().name;
}

/**
 * Returns a shallow clone of `body` with the `_zdf` env map removed — used to strip the map
 * before posting a record body to Zuora (Zuora would reject the unknown field). Safe no-op for
 * anything that isn't a plain object (null, undefined, arrays, primitives).
 */
export function stripEnvMap<T>(body: T): T {
  if (body === null || body === undefined || typeof body !== 'object' || Array.isArray(body)) {
    return body;
  }
  const clone = { ...(body as Rec) } as Rec;
  delete clone[ENV_MAP_KEY];
  return clone as T;
}

/** Reads a single env's entry out of a record's `_zdf` map, if present. */
export function getEnvEntry(record: Rec, envName: string): EnvEntry | undefined {
  const map = record[ENV_MAP_KEY] as EnvMap | undefined;
  return map?.[envName];
}

/**
 * Merges `entry` into `record`'s `_zdf` map under `envName`, preserving any other envs' entries
 * already present and merging (not replacing) the target env's existing id/key — a field is only
 * overwritten when `entry` explicitly provides it. Mutates and returns `record`.
 */
export function setEnvEntry(record: Rec, envName: string, entry: Partial<EnvEntry>): Rec {
  const existingMap = (record[ENV_MAP_KEY] as EnvMap | undefined) ?? {};
  const existingEntry = existingMap[envName] ?? { id: null, key: null };
  const mergedEntry: EnvEntry = {
    id: entry.id !== undefined ? entry.id : existingEntry.id,
    key: entry.key !== undefined ? entry.key : existingEntry.key,
  };
  record[ENV_MAP_KEY] = { ...existingMap, [envName]: mergedEntry };
  return record;
}

/**
 * The `_zdf` map must ACCUMULATE across environments — an account pulled from prod, then later
 * pulled/pushed against intQA, should end up with BOTH `_zdf.prod` and `_zdf.intQA`. A freshly
 * fetched Zuora record (or a locally-authored create/push body) never carries entries for envs
 * other than the one just set on it, so before writing, merge in whatever `_zdf` entries the
 * EXISTING local file already has for OTHER envs. `record`'s own entries (e.g. the active env,
 * already set via `setEnvEntry` before calling this) take precedence over the file's.
 *
 * CRITICAL: the lookup must key on the same FILENAME `writeResourceFile` is about to use — i.e.
 * `fileNameFor(resource, id, record)` — NOT on `id` via `readResourceFile`'s id-scan fallback.
 * `id` here is the CURRENT tenant's internal id, which is a DIFFERENT value per tenant for the
 * same logical record (the whole premise of cross-tenant upsert — see zdf/CLAUDE.md); an id-scan
 * lookup would either miss the file entirely (natural-keyed resources — the existing file is
 * named by natural key, not by any id) or, if it ever matched, would be matching on exactly the
 * value that's expected to differ. Going through the natural key IN `record` instead works
 * because that key (accountNumber, invoiceNumber, memo number, …) is assumed stable across
 * tenants for "the same" logical record — so the SAME filename resolves regardless of which
 * tenant's id triggered this write. For id-keyed resources with no natural key (`product`),
 * `fileNameFor` falls back to `id` itself, so this lookup can only find a file already at that
 * exact (tenant-specific) id — it does NOT solve product's cross-tenant case; that's handled by
 * the caller carrying the prior map forward explicitly (see `carryForwardEnvMap` below).
 *
 * A no-op (returns `record` unchanged) when no local file exists at that filename yet (first
 * pull/create) or it can't be parsed. Mutates and returns `record`.
 */
export function mergeExistingEnvMap(resource: string, id: string, record: Rec): Rec {
  const fileName = fileNameFor(resource, id, record);
  const existing = readResourceFileIfExists(resource, fileName);
  const existingMap = (existing as Rec | undefined)?.[ENV_MAP_KEY] as EnvMap | undefined;
  if (!existingMap || typeof existingMap !== 'object') return record;
  const currentMap = (record[ENV_MAP_KEY] as EnvMap | undefined) ?? {};
  record[ENV_MAP_KEY] = { ...existingMap, ...currentMap };
  return record;
}

/**
 * Merges `priorMap` — an `_zdf` map captured from a record's file BEFORE some later step could
 * lose track of it (e.g. before a cross-tenant `push` deletes the record's old, differently-id-
 * keyed local file, or before `resolveAndSync` re-fetches into a brand-new file that
 * `mergeExistingEnvMap` above has no way to associate with the old one for id-keyed resources)
 * — into `record`'s OWN `_zdf` map. `record`'s own entries (e.g. the just-set active env) win over
 * the same env in `priorMap`. No-op if `priorMap` is empty/undefined. Mutates and returns `record`.
 */
export function carryForwardEnvMap(record: Rec, priorMap: EnvMap | undefined): Rec {
  if (!priorMap || Object.keys(priorMap).length === 0) return record;
  const currentMap = (record[ENV_MAP_KEY] as EnvMap | undefined) ?? {};
  record[ENV_MAP_KEY] = { ...priorMap, ...currentMap };
  return record;
}

/**
 * Disk-level convenience wrapper around `carryForwardEnvMap`: reads the file `finalId` was just
 * written under (its FINAL filename — natural key for account/invoice/memos, `finalId` itself for
 * id-keyed resources like product), merges `priorMap` into its `_zdf`, and writes it back. Used
 * by command upsert flows AFTER `resolveAndSync`'s re-fetch/write has already run, to guarantee
 * the map an in-memory `priorMap` carried (captured from the file BEFORE the upsert) survives onto
 * the final on-disk record even when `mergeExistingEnvMap` (run inside that re-fetch) couldn't
 * find it itself (the id-keyed / cross-tenant case). No-op if `priorMap` is empty/undefined, or if
 * the just-written file can't be read (nothing to carry the map onto).
 */
export function carryForwardEnvMapToFile(resource: string, finalId: string, priorMap: EnvMap | undefined): void {
  if (!priorMap || Object.keys(priorMap).length === 0) return;
  let finalRecord: unknown;
  try {
    finalRecord = readResourceFile(resource, finalId);
  } catch {
    return;
  }
  if (!finalRecord || typeof finalRecord !== 'object' || Array.isArray(finalRecord)) return;
  const rec = finalRecord as Rec;
  carryForwardEnvMap(rec, priorMap);
  writeResourceFile(resource, finalId, rec);
}
