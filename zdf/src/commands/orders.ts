import { Command } from 'commander';
import { readFileSync } from 'fs';
import { apiGet, apiPost, apiPut, apiDelete } from '../api/client.js';
import { readResourceFile, writeResourceFile, renameResourceFile, resolveFilePath, getOutputDir } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';
import { assertSuccess, ZuoraWriteResponse } from '../helpers/zuora-response.js';
import { filterUpdatableFields } from '../helpers/updatable-fields.js';
import { resolveAndSync, getMaxItems } from '../helpers/dependency-graph.js';

const RESOURCE = 'order';
const ENDPOINT = '/v1/orders';

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

export function register(program: Command): void {
  const pullCmd = getOrCreate(program, 'pull', 'Fetch a resource from Zuora');
  const listCmd = getOrCreate(program, 'list', 'List resources from Zuora');
  const createCmd = getOrCreate(program, 'create', 'Create a resource in Zuora from a local file');
  const pushCmd = getOrCreate(program, 'push', 'Update a resource in Zuora from a local file');
  const deleteCmd = getOrCreate(program, 'delete', 'Delete a resource in Zuora');

  pullCmd
    .command('order <orderNumber>')
    .description('Fetch an order from Zuora by order number, including all line items')
    .action((orderNumber: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync(RESOURCE, orderNumber, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull order ${orderNumber} (see error above).`);
        }
        output.success(`Order ${orderNumber} written to ${resolveFilePath(RESOURCE, orderNumber)}`);
      })()
    );

  pullCmd
    .command('order-line-item <id>')
    .description('Fetch an order line item from Zuora by internal ID')
    .action((id: string) =>
      runCommand(program, async () => {
        const fetched = await resolveAndSync('order-line-item', id, 'pull');
        if (!fetched) {
          throw new Error(`Failed to pull order-line-item ${id} (see error above).`);
        }
        output.success(`Order line item ${id} written to ${resolveFilePath('order-line-item', id)}`);
      })()
    );

  listCmd
    .command('orders')
    .description('Fetch orders from Zuora and write to local storage')
    .option('--limit <n>', 'stop after fetching N orders total')
    .option('--account <key>', 'only fetch orders for the given account number/key via GET /v1/orders/subscriptionOwner/{key}')
    .option('--status <status>', 'only fetch orders with the given status')
    .option('--all', 'confirm a full-tenant export when no --limit/--account/--status is given')
    .action((opts: { limit?: string; account?: string; status?: string; all?: boolean }) =>
      runCommand(program, async () => {
        const limit = opts.limit !== undefined ? parseInt(opts.limit, 10) : undefined;
        const hasLimit = typeof limit === 'number' && Number.isFinite(limit);
        const hasFilter = Boolean(opts.account) || Boolean(opts.status);

        if (!hasLimit && !hasFilter && !opts.all) {
          throw new Error(
            'list orders with no --limit or filter would export the entire tenant. ' +
              'Re-run with --limit <n>, --account <id>, --status <status>, or pass --all to confirm a full export.'
          );
        }

        // The generic /v1/orders?accountId= filter is ignored server-side (observed on
        // intQA: byte-identical to the unfiltered list), so --account scopes via the
        // dedicated GET /v1/orders/subscriptionOwner/{accountKey} endpoint instead. That
        // endpoint has no documented `status` query param, so when --status is combined
        // with --account we filter the returned orders client-side.
        const clientSideStatusFilter = Boolean(opts.account) && Boolean(opts.status);

        // Each order's line items are fetched with one GET apiece and there is no
        // server-side limit on orderLineItems per order; an order (or set of orders)
        // with many line items would otherwise issue unbounded serial GETs. Reuse the
        // same effective cap as the dependency graph's --max-items (getMaxItems()) so
        // this loop degrades gracefully instead of throwing.
        const maxItems = getMaxItems();
        let lineItemCapWarned = false;

        let page = 1;
        let total = 0;
        let lineItemTotal = 0;
        let truncated = false;
        outer: while (true) {
          output.info(`Fetching page ${page}…`);
          const queryParams: string[] = [];
          if (!opts.account && opts.status) queryParams.push(`status=${opts.status}`);
          queryParams.push(`page=${page}`, 'pageSize=50');
          const url = opts.account
            ? `/v1/orders/subscriptionOwner/${encodeURIComponent(opts.account)}?${queryParams.join('&')}`
            : `/v1/orders?${queryParams.join('&')}`;
          const res = await apiGet<{ orders: Record<string, unknown>[]; nextPage?: string }>(url);
          let orders = res.orders ?? [];
          if (clientSideStatusFilter) {
            orders = orders.filter((order) => (order['status'] as string | undefined) === opts.status);
          }
          for (const order of orders) {
            if (hasLimit && total >= limit!) {
              truncated = true;
              break;
            }
            const orderNumber = order['orderNumber'] as string;
            writeResourceFile(RESOURCE, orderNumber, order);
            total += 1;
            const lineItems = (order['orderLineItems'] as Array<{ id: string }> | undefined) ?? [];
            for (const lineItem of lineItems) {
              if (lineItemTotal >= maxItems) {
                if (!lineItemCapWarned) {
                  lineItemCapWarned = true;
                  output.warn(
                    `list orders: reached the ${maxItems}-item cap on order-line-item fetches; ` +
                    `some line items were not fetched. Re-run with --max-items <n> to raise the cap.`
                  );
                }
                break outer;
              }
              const liRes = await apiGet<{ success: boolean; orderLineItem: Record<string, unknown> }>(
                `/v1/order-line-items/${lineItem.id}`
              );
              if (liRes.success && liRes.orderLineItem) {
                writeResourceFile('order-line-item', lineItem.id, liRes.orderLineItem);
                lineItemTotal += 1;
              }
            }
          }
          if (hasLimit && total >= limit!) {
            truncated = true;
          }
          if (truncated || !res.nextPage) break;
          page++;
        }
        if (truncated) {
          output.warn(`Stopped after reaching --limit ${limit}; more orders may remain on the server.`);
        }
        output.success(`Fetched ${total} orders and ${lineItemTotal} order line items to ${getOutputDir()}/.`);
      })()
    );

  createCmd
    .command('order <name>')
    .description('Create an order in Zuora from a local file')
    .option('-f, --file <path>', `path to JSON file (defaults to ${getOutputDir()}/orders/<name>.json)`)
    .action((name: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const body: unknown = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as unknown
          : readResourceFile(RESOURCE, name);
        const res = await apiPost<ZuoraWriteResponse & { orderNumber: string }>(`${ENDPOINT}`, body);
        assertSuccess(res, 'order create');
        if (!opts.file) renameResourceFile(RESOURCE, name, res.orderNumber);
        output.success(`Order created. Order number: ${res.orderNumber}`);
      })()
    );

  pushCmd
    .command('order <orderNumber>')
    .description('Update an order in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((orderNumber: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawFull: Record<string, unknown> = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile(RESOURCE, orderNumber) as Record<string, unknown>;
        // GET /v1/orders/{n} wraps the order under an 'order' key; unwrap for PUT
        const rawBody = (rawFull['order'] as Record<string, unknown> | undefined) ?? rawFull;
        const body = filterUpdatableFields(RESOURCE, rawBody);
        const res = await apiPut<ZuoraWriteResponse>(`${ENDPOINT}/${orderNumber}`, body);
        assertSuccess(res, 'order update');
        await resolveAndSync(RESOURCE, orderNumber, 'push');
        output.success(`Order ${orderNumber} updated.`);
      })()
    );

  pushCmd
    .command('order-line-item <itemId>')
    .description('Update an order line item in Zuora from a local file')
    .option('-f, --file <path>', 'path to JSON file')
    .action((itemId: string, opts: { file?: string }) =>
      runCommand(program, async () => {
        const rawBody = opts.file
          ? JSON.parse(readFileSync(opts.file, 'utf-8')) as Record<string, unknown>
          : readResourceFile('order-line-item', itemId) as Record<string, unknown>;
        const body = filterUpdatableFields('order-line-item', rawBody);
        const res = await apiPut<ZuoraWriteResponse>(`/v1/order-line-items/${itemId}`, body);
        assertSuccess(res, 'order line item update');
        await resolveAndSync('order-line-item', itemId, 'push');
        output.success(`Order line item ${itemId} updated.`);
      })()
    );

  deleteCmd
    .command('order <orderNumber>')
    .description('Delete an order in Zuora')
    .action((orderNumber: string) =>
      runCommand(program, async () => {
        const res = await apiDelete<ZuoraWriteResponse>(`${ENDPOINT}/${orderNumber}`);
        assertSuccess(res, 'order delete');
        await resolveAndSync(RESOURCE, orderNumber, 'delete');
        output.success(`Order ${orderNumber} deleted.`);
      })()
    );
}
