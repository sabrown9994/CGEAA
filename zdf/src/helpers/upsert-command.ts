// Shared glue for the account/product/invoice "create-or-update" (upsert) push commands: the
// getOrCreate command-registration helper (Commander disallows registering the same verb command
// twice across resource modules) and the `_zdf` env-map capture-before/carry-forward-after
// ceremony each upsert flow needs around resolveAndSync's re-fetch/write. See env-map.ts for why
// the capture must happen BEFORE any mutation and the carry-forward must happen explicitly AFTER
// resolveAndSync's write (its own `mergeExistingEnvMap` can't recover the map for id-keyed
// resources, and can't run at all before the record has a target-tenant id on create).
import { Command } from 'commander';
import { ENV_MAP_KEY, EnvMap, carryForwardEnvMap, carryForwardEnvMapToFile } from './env-map.js';
import { deleteResourceFile, readResourceFile } from './file-io.js';
import { fileNameFor } from './resource-registry.js';

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

/**
 * After a push UPSERT CREATE branch (target not found -> create) writes the new record under a
 * filename derived from the CREATED record's natural key (via `resolveAndSync`'s re-fetch +
 * `carryForwardEnvMapToFile`), the ORIGINAL source file — the one the CLI arg pointed at — is
 * stale whenever that natural key differs from the source file's own key (e.g. Zuora assigns a
 * NEW invoiceNumber/memoNumber/accountNumber in the target tenant). Left on disk, that stale file
 * would be re-read by a repeat `push <arg>` — still unmapped for this env, still keyed by the OLD
 * natural key — so `resolveTargetId` would report not-found again, causing an UNBOUNDED duplicate
 * create on every repeat push. This deletes the stale source file, but ONLY when the computed
 * filenames actually differ: a same-tenant push-create, or a create that happens to preserve the
 * source's natural key, is a no-op — it must never delete the file it (or `resolveAndSync`) just
 * wrote. Mirrors the pattern `push product` already uses (product has no natural key, so its
 * equivalent check is simply `id !== finalId`); this generalizes it to natural-keyed resources
 * (account/invoice/credit-memo/debit-memo) via `fileNameFor`, since for those the on-disk filename
 * is the natural key, not the internal id. Never throws — if the final file can't be (re)read,
 * nothing is deleted (an orphaned source file is a lesser problem than deleting the wrong one).
 */
export function deleteStaleSourceFile(
  resource: string,
  arg: string,
  sourceRecord: Rec,
  finalId: string
): void {
  const sourceFileName = fileNameFor(resource, arg, sourceRecord);
  let finalRecord: unknown;
  try {
    finalRecord = readResourceFile(resource, finalId);
  } catch {
    return;
  }
  if (!finalRecord || typeof finalRecord !== 'object' || Array.isArray(finalRecord)) return;
  const finalFileName = fileNameFor(resource, finalId, finalRecord as Rec);
  if (sourceFileName !== finalFileName) {
    deleteResourceFile(resource, arg);
  }
}
