import { Command } from 'commander';
import { createInterface } from 'readline';
import { getProjectDir, getProductionAuthId, getRunTests } from '../helpers/project-dir.js';
import { getActiveAuthId, ProductionGuardError } from '../helpers/production-guard.js';
import { getCurrentBranch } from '../helpers/git.js';
import { validateAuthId, setDefaultAuthId } from '../helpers/auth.js';
import { runSuitecloud } from '../helpers/suitecloud.js';
import { parseMissingObjectRefs } from '../helpers/dependency-parser.js';
import { runBuild } from '../helpers/build-runner.js';
import { output } from '../helpers/output.js';

function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a); }));
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy')
    .description('Build and deploy feature changes to a target NetSuite environment, auto-resolving object dependencies')
    .requiredOption('--target <authId>', 'target environment auth ID to deploy to')
    .option('--source <authId>', 'source environment auth ID to import absent objects from')
    .option('--auto-import', 'permit importing absent objects without confirmation (for CI)')
    .option('--dry-run', 'validate against the target and preview; never deploys or imports')
    .option('--skip-tests', 'skip SuiteCloud Jest tests for this deploy')
    .option('--max-import-rounds <n>', 'max import+retry iterations', '10')
    .option('--base <ref>', 'git ref to diff against (default: main)', 'main')
    .option('--allow-production', 'required opt-in confirmation to deploy to the production auth ID')
    .action(async (opts: {
      target: string; source?: string; autoImport?: boolean; dryRun?: boolean;
      skipTests?: boolean; maxImportRounds: string; base?: string; allowProduction?: boolean;
    }) => {
      const projectDir = getProjectDir();
      let failed = false;
      let restoreAuthId: string | undefined;
      try {
        validateAuthId(projectDir, opts.target);
        if (opts.source) validateAuthId(projectDir, opts.source);

        // Production guard on the TARGET (before any swap/network).
        if (opts.target === getProductionAuthId()) {
          const branch = getCurrentBranch(projectDir);
          if (branch !== 'main') {
            throw new ProductionGuardError(branch);
          }
          if (!opts.allowProduction) {
            throw new Error(
              `Refusing to deploy to production "${opts.target}" without --allow-production. ` +
              `Re-run with --allow-production to confirm this intentional production deploy.`,
            );
          }
        }

        const maxRounds = Math.max(1, parseInt(opts.maxImportRounds, 10) || 10);
        const skipTests = opts.skipTests || getRunTests() === false;
        const env = skipTests
          ? { ...process.env, NDF_SKIP_TESTS: 'true' }
          : { ...process.env, NDF_SKIP_TESTS: undefined };
        if (skipTests) output.info('Skipping SuiteCloud Jest tests for this deploy (NDF_SKIP_TESTS=true).');

        restoreAuthId = getActiveAuthId(projectDir);
        const importedObjectPaths: string[] = [];
        let source = opts.source;

        for (let round = 1; ; round++) {
          await runBuild({ projectDir, dryRun: false, base: opts.base, extraObjectPaths: importedObjectPaths });

          setDefaultAuthId(projectDir, opts.target);
          const cmd = opts.dryRun ? ['project:validate'] : ['project:deploy'];
          const res = runSuitecloud(cmd, { cwd: projectDir, env });
          process.stdout.write(res.output);
          if (res.status === 0) { output.success(opts.dryRun ? 'Validation passed.' : 'Deploy complete.'); break; }

          const missing = parseMissingObjectRefs(res.output);
          if (missing.length === 0) {
            throw new Error('Deploy failed with no resolvable missing-object dependency (see output above).');
          }
          if (round >= maxRounds) {
            throw new Error(
              `Reached max import rounds (${maxRounds}). Imported: ${importedObjectPaths.map(objId).join(', ') || '(none)'}; still missing: ${missing.join(', ')}.`,
            );
          }
          if (opts.dryRun) {
            output.info(`Would import from source: ${missing.join(', ')} (dry run — not importing).`);
            break;
          }

          // Need a source account to import from.
          if (!source) {
            if (process.stdin.isTTY) {
              source = (await ask(`Objects to import: ${missing.join(', ')}. Source auth ID: `)).trim();
              validateAuthId(projectDir, source);
            } else {
              throw new Error(`Missing objects require import: ${missing.join(', ')}. Re-run with --source <authId>.`);
            }
          }

          // Gate the import.
          let permitted: boolean;
          if (process.stdin.isTTY) {
            const a = (await ask(`Import ${missing.join(', ')} from ${source}? [y/N] `)).trim().toLowerCase();
            permitted = a === 'y' || a === 'yes';
          } else {
            permitted = !!opts.autoImport;
          }
          if (!permitted) {
            throw new Error(
              `Import of ${missing.join(', ')} not permitted` +
              (process.stdin.isTTY ? ' (declined).' : ' — pass --auto-import to allow in non-interactive mode.'),
            );
          }

          // Import named objects from source, then loop (runBuild will include them).
          setDefaultAuthId(projectDir, source);
          const imp = runSuitecloud(
            ['object:import', '--scriptid', ...missing, '--type', 'ALL', '--destinationfolder', '/Objects'],
            { cwd: projectDir },
          );
          process.stdout.write(imp.output);
          if (imp.status !== 0) throw new Error(`object:import failed:\n${imp.output}`);
          for (const id of missing) importedObjectPaths.push(`src/Objects/${id}.xml`);
          if (importedObjectPaths.length) {
            output.info(`Imported from ${source}: ${missing.join(', ')}`);
          }
        }
      } catch (err) {
        output.error(err instanceof Error ? err.message : String(err));
        failed = true;
      } finally {
        if (restoreAuthId !== undefined) setDefaultAuthId(projectDir, restoreAuthId);
      }
      if (failed) process.exit(1);
    });
}

function objId(path: string): string { return path.replace(/^src\/Objects\//, '').replace(/\.xml$/, ''); }
