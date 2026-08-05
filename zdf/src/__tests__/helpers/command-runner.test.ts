import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';

const mockSetDebug = vi.hoisted(() => vi.fn());
const mockSetMaxRows = vi.hoisted(() => vi.fn());
vi.mock('../../api/client.js', () => ({
  setDebug: mockSetDebug,
  setMaxRows: mockSetMaxRows,
  APIQUERY_MAX_ROWS: 5000,
}));

const mockSetNoDependency = vi.hoisted(() => vi.fn());
const mockSetMaxTraversalNodes = vi.hoisted(() => vi.fn());
const mockSetMaxItems = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/dependency-graph.js', () => ({
  setNoDependency: mockSetNoDependency,
  setMaxTraversalNodes: mockSetMaxTraversalNodes,
  setMaxItems: mockSetMaxItems,
  MAX_TRAVERSAL_NODES: 500,
  FETCH_ALL_ITEMS_MAX: 5000,
}));

vi.mock('../../helpers/production-guard.js', () => ({ confirmProduction: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../auth/config.js', () => ({ getActiveEnv: () => ({ isProduction: false, name: 'sandbox' }) }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock('../../helpers/output.js', () => ({ output: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warn: mockWarn } }));

import { runCommand } from '../../helpers/command-runner.js';

function makeProgram(): Command {
  const p = new Command();
  p.option('--debug')
    .option('--no-dependency')
    .option('--max-rows <n>')
    .option('--max-nodes <n>')
    .option('--max-items <n>')
    .option('--no-caps')
    .option('--unbounded');
  p.command('run').action(() => runCommand(p, async () => {})());
  return p;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('runCommand cap flag wiring', () => {
  it('with no flags, sets all caps back to their defaults (no leakage from a prior invocation)', async () => {
    await makeProgram().parseAsync(['node', 'zdf', 'run']);
    expect(mockSetMaxRows).toHaveBeenCalledWith(5000);
    expect(mockSetMaxTraversalNodes).toHaveBeenCalledWith(500);
    expect(mockSetMaxItems).toHaveBeenCalledWith(5000);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('--max-rows <n> calls setMaxRows with the parsed value', async () => {
    await makeProgram().parseAsync(['node', 'zdf', '--max-rows', '10', 'run']);
    expect(mockSetMaxRows).toHaveBeenCalledWith(10);
  });

  it('--max-nodes <n> calls setMaxTraversalNodes with the parsed value', async () => {
    await makeProgram().parseAsync(['node', 'zdf', '--max-nodes', '7', 'run']);
    expect(mockSetMaxTraversalNodes).toHaveBeenCalledWith(7);
  });

  it('--max-items <n> calls setMaxItems with the parsed value', async () => {
    await makeProgram().parseAsync(['node', 'zdf', '--max-items', '3', 'run']);
    expect(mockSetMaxItems).toHaveBeenCalledWith(3);
  });

  it('--no-caps sets all three caps to Infinity and warns', async () => {
    await makeProgram().parseAsync(['node', 'zdf', '--no-caps', 'run']);
    expect(mockSetMaxRows).toHaveBeenCalledWith(Infinity);
    expect(mockSetMaxTraversalNodes).toHaveBeenCalledWith(Infinity);
    expect(mockSetMaxItems).toHaveBeenCalledWith(Infinity);
    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn.mock.calls[0][0]).toMatch(/no-caps/i);
  });

  it('--unbounded behaves the same as --no-caps', async () => {
    await makeProgram().parseAsync(['node', 'zdf', '--unbounded', 'run']);
    expect(mockSetMaxRows).toHaveBeenCalledWith(Infinity);
    expect(mockSetMaxTraversalNodes).toHaveBeenCalledWith(Infinity);
    expect(mockSetMaxItems).toHaveBeenCalledWith(Infinity);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('--no-caps takes precedence over an explicit --max-rows (caps stay disabled)', async () => {
    await makeProgram().parseAsync(['node', 'zdf', '--no-caps', '--max-rows', '10', 'run']);
    expect(mockSetMaxRows).toHaveBeenCalledWith(Infinity);
  });
});
