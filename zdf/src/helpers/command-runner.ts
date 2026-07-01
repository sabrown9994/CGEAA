import { Command } from 'commander';
import { getActiveEnv } from '../auth/config.js';
import { confirmProduction } from './production-guard.js';
import { output } from './output.js';
import { setDebug } from '../api/client.js';
import { setNoDependency } from './dependency-graph.js';
import type { ZuoraErrorResponse } from '../types.js';

export function runCommand(program: Command, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const debug = program.opts().debug as boolean | undefined;
    const noDep = program.opts().dependency === false;
    setDebug(!!debug);
    setNoDependency(noDep);
    try {
      const env = getActiveEnv();
      await confirmProduction(env.isProduction, env.name);
      await fn();
    } catch (e) {
      if (e instanceof Error && e.message === 'Aborted by user.') {
        process.exit(0);
      }
      const zuoraErr = e as Partial<ZuoraErrorResponse>;
      if (zuoraErr.statusCode) {
        output.error(`Zuora error ${zuoraErr.statusCode}: ${zuoraErr.message}`);
        if (zuoraErr.errors?.length) {
          for (const err of zuoraErr.errors) output.error(`  ${err.code}: ${err.message}`);
        }
      } else {
        output.error(e instanceof Error ? e.message : String(e));
        if (debug) console.error(e);
      }
      process.exit(1);
    }
  };
}
