import { Command } from 'commander';
import { readFileSync } from 'fs';
import { runCommand } from '../helpers/command-runner.js';
import { getOutputDir } from '../helpers/file-io.js';
import { parseNameStatus, planFromDiff } from '../helpers/sync-diff.js';
import type { PlanItem } from '../helpers/sync-diff.js';

interface SyncDiffOpts {
  dryRun?: boolean;
  apply?: boolean;
  diffFile?: string;
  format?: string;
  root?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function summary(plan: PlanItem[]): string {
  const toCreate = plan.filter((p) => p.op === 'create' && p.eligible).length;
  const toPush = plan.filter((p) => p.op === 'push' && p.eligible).length;
  const toDelete = plan.filter((p) => p.op === 'delete' && p.eligible).length;
  const skipped = plan.filter((p) => !p.eligible).length;
  return `${toCreate} to create, ${toPush} to push, ${toDelete} to delete, ${skipped} skipped`;
}

function renderText(plan: PlanItem[]): string {
  if (plan.length === 0) return 'No changes to plan.\n\n0 to create, 0 to push, 0 to delete, 0 skipped';
  const lines = plan.map((p) => {
    const target = [p.resource, p.id].filter(Boolean).join(' ');
    const state = p.eligible ? 'eligible' : `SKIPPED (${p.reason ?? 'ineligible'})`;
    return `[${p.status}] ${p.file} -> ${p.op}${target ? ` ${target}` : ''} — ${state}`;
  });
  return [...lines, '', summary(plan)].join('\n');
}

function renderMarkdown(plan: PlanItem[]): string {
  const header = '| file | status | resource | id | op | eligible | reason |';
  const sep = '|---|---|---|---|---|---|---|';
  const rows = plan.map(
    (p) =>
      `| ${p.file} | ${p.status} | ${p.resource ?? ''} | ${p.id ?? ''} | ${p.op} | ${p.eligible} | ${p.reason ?? ''} |`
  );
  return [header, sep, ...rows, '', summary(plan)].join('\n');
}

function renderJson(plan: PlanItem[]): string {
  return JSON.stringify(plan, null, 2);
}

function render(plan: PlanItem[], format: string): string {
  if (format === 'markdown') return renderMarkdown(plan);
  if (format === 'json') return renderJson(plan);
  return renderText(plan);
}

export function register(program: Command): void {
  program
    .command('sync-diff')
    .description('Map a git diff --name-status of the zdf-output tree to zdf create/push/delete actions (CI/CD)')
    .option('--dry-run', 'resolve and print the plan without executing anything (default)')
    .option('--apply', 'execute the planned actions (Phase 2 — not yet implemented)')
    .option('--diff-file <path>', 'path to a file containing git diff --name-status output (default: read stdin)')
    .option('--format <fmt>', 'output format: text|markdown|json', 'text')
    .option('--root <dir>', 'zdf-output root directory (default: resolved via getOutputDir())')
    .action((opts: SyncDiffOpts) =>
      runCommand(program, async () => {
        if (opts.apply) {
          throw new Error('sync-diff --apply is not yet implemented (Phase 2). Use --dry-run to preview the plan.');
        }

        const raw = opts.diffFile ? readFileSync(opts.diffFile, 'utf-8') : await readStdin();
        const root = opts.root ?? getOutputDir();
        const entries = parseNameStatus(raw);
        const plan = planFromDiff(entries, root);

        console.log(render(plan, opts.format ?? 'text'));
      })()
    );
}
