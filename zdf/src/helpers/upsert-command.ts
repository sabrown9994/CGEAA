// Shared glue for the account/product/invoice "create-or-update" (upsert) push commands: the
// getOrCreate command-registration helper (Commander disallows registering the same verb command
// twice across resource modules) and the `_zdf` env-map capture-before/carry-forward-after
// ceremony each upsert flow needs around resolveAndSync's re-fetch/write. See env-map.ts for why
// the capture must happen BEFORE any mutation and the carry-forward must happen explicitly AFTER
// resolveAndSync's write (its own `mergeExistingEnvMap` can't recover the map for id-keyed
// resources, and can't run at all before the record has a target-tenant id on create).
import { Command } from 'commander';
import { ENV_MAP_KEY, EnvMap, carryForwardEnvMap, carryForwardEnvMapToFile } from './env-map.js';

type Rec = Record<string, unknown>;

/** Finds an existing top-level verb command (pull/create/push/delete) or registers a new one.
 * Commander throws if the same command name is registered twice, and every resource's `register()`
 * shares these four verbs — so each resource command module must reuse, not recreate, them. */
export function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

/**
 * Captures a record's accumulated `_zdf` cross-tenant env map BEFORE any upsert mutation runs —
 * read straight off the in-memory record (not re-derived from disk), since a later step in the
 * upsert flow (a re-fetch/write under a different id, or a local file delete/rename) may make the
 * map otherwise unrecoverable. Pass the result to `carryForwardEnvMap` / `carryForwardEnvMapToFile`
 * once the write has completed. Returns `undefined` for a nullish/non-object record.
 */
export function capturePriorEnvMap(record: Rec | undefined): EnvMap | undefined {
  return record?.[ENV_MAP_KEY] as EnvMap | undefined;
}

export { carryForwardEnvMap, carryForwardEnvMapToFile };
