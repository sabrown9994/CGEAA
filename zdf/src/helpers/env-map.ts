// Cross-tenant env-id map: a per-record `_zdf` map keyed by env name, tracking the resource's id
// and natural key (where applicable) in EACH tenant it's been pulled into/pushed from. This lets
// a later "upsert" feature look up "does this record already exist in tenant B" without relying on
// per-tenant internal ids being stable across environments (they aren't — see zdf/CLAUDE.md).
import { getActiveEnv } from '../auth/config.js';

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
