#!/usr/bin/env node
import { Command } from 'commander';
import { register as registerAuth } from '../src/auth/commands.js';
import { register as registerAccounts } from '../src/commands/accounts.js';
import { register as registerContacts } from '../src/commands/contacts.js';
import { register as registerSubscriptions } from '../src/commands/subscriptions.js';
import { register as registerProducts } from '../src/commands/products.js';
import { register as registerProductRatePlans } from '../src/commands/product-rate-plans.js';
import { register as registerProductRatePlanCharges } from '../src/commands/product-rate-plan-charges.js';
import { register as registerWorkflows } from '../src/commands/workflows.js';
import { register as registerBillingTemplates } from '../src/commands/billing-templates.js';
import { register as registerDataQueries } from '../src/commands/data-queries.js';
import { register as registerOrders } from '../src/commands/orders.js';
import { register as registerInvoices } from '../src/commands/invoices.js';
import { register as registerCreditMemos } from '../src/commands/credit-memos.js';
import { register as registerDebitMemos } from '../src/commands/debit-memos.js';
import { register as registerBillRuns } from '../src/commands/bill-runs.js';
import { register as registerSyncDiff } from '../src/commands/sync-diff.js';

const program = new Command();
program
  .name('zdf')
  .description('Zuora Development Framework CLI')
  .version('1.0.0')
  .option('--debug', 'print every HTTP request URL and response body')
  .option('--no-dependency', 'skip dependency tree traversal')
  .option('--max-rows <n>', 'override the apiQuery pagination row cap for this run')
  .option('--max-nodes <n>', 'override the dependency traversal node ceiling for this run')
  .option('--max-items <n>', 'override the sub-item pagination cap for this run')
  .option('--no-caps', 'disable all pull caps (row/node/item) for this run — may take a long time on large tenants')
  .option('--unbounded', 'alias for --no-caps');

registerAuth(program);
registerAccounts(program);
registerContacts(program);
registerSubscriptions(program);
registerProducts(program);
registerProductRatePlans(program);
registerProductRatePlanCharges(program);
registerWorkflows(program);
registerBillingTemplates(program);
registerDataQueries(program);
registerOrders(program);
registerInvoices(program);
registerCreditMemos(program);
registerDebitMemos(program);
registerBillRuns(program);
registerSyncDiff(program);

program.parse();
