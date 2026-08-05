import { Command } from 'commander';
import { getActiveEnv } from '../auth/config.js';
import { confirmProduction } from './production-guard.js';
import { output } from './output.js';
import { setDebug, setMaxRows, APIQUERY_MAX_ROWS } from '../api/client.js';
import {
  setNoDependency,
  setMaxTraversalNodes,
  setMaxItems,
  MAX_TRAVERSAL_NODES,
  FETCH_ALL_ITEMS_MAX,
} from './dependency-graph.js';
import type { ZuoraErrorResponse } from '../types.js';

export function runCommand(program: Command, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const opts = program.opts();
    const debug = opts.debug as boolean | undefined;
    const noDep = opts.dependency === false;
    const noCaps = opts.caps === false || opts.unbounded === true;
    setDebug(!!debug);
    setNoDependency(noDep);

    if (noCaps) {
      output.warn(
        'Running with --no-caps: the apiQuery row cap, dependency traversal node ceiling, and ' +
        'sub-item pagination cap are all disabled for this run. This may take a long time and ' +
        'enumerate entire tables on a large tenant.'
      );
      setMaxRows(Infinity);
      setMaxTraversalNodes(Infinity);
      setMaxItems(Infinity);
    } else {
      const maxRows = opts.maxRows !== undefined ? parseInt(opts.maxRows, 10) : undefined;
      const maxNodes = opts.maxNodes !== undefined ? parseInt(opts.maxNodes, 10) : undefined;
      const maxItems = opts.maxItems !== undefined ? parseInt(opts.maxItems, 10) : undefined;
      // Always set explicitly (falling back to the default constant) so state from a
      // prior invocation in the same process (e.g. in tests) never leaks into this one —
      // mirrors setDebug/setNoDependency above, which are unconditional too.
      setMaxRows(maxRows !== undefined && !Number.isNaN(maxRows) ? maxRows : APIQUERY_MAX_ROWS);
      setMaxTraversalNodes(maxNodes !== undefined && !Number.isNaN(maxNodes) ? maxNodes : MAX_TRAVERSAL_NODES);
      setMaxItems(maxItems !== undefined && !Number.isNaN(maxItems) ? maxItems : FETCH_ALL_ITEMS_MAX);
    }

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
