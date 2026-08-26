import { Command } from 'commander';
import { setInvokedCommand } from './helpers/command-policy.js';
import { register as registerAuth } from './auth/commands.js';
import { register as registerAccounts } from './commands/accounts.js';
import { register as registerContacts } from './commands/contacts.js';
import { register as registerSubscriptions } from './commands/subscriptions.js';
import { register as registerProducts } from './commands/products.js';
import { register as registerProductRatePlans } from './commands/product-rate-plans.js';
import { register as registerProductRatePlanCharges } from './commands/product-rate-plan-charges.js';
import { register as registerWorkflows } from './commands/workflows.js';
import { register as registerBillingTemplates } from './commands/billing-templates.js';
import { register as registerDataQueries } from './commands/data-queries.js';
import { register as registerOrders } from './commands/orders.js';
import { register as registerInvoices } from './commands/invoices.js';
import { register as registerCreditMemos } from './commands/credit-memos.js';
import { register as registerDebitMemos } from './commands/debit-memos.js';
import { register as registerBillRuns } from './commands/bill-runs.js';
import { register as registerTemplates } from './commands/templates.js';

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('cgeaa zuora')
    .description(
      'Zuora commands (via `cgeaa zuora`) — pull Zuora objects to local JSON, edit them, ' +
      'and push them back to a single Zuora tenant.'
    )
    .version('1.0.0')
    // On an error (unknown command, missing arg, bad option) show a one-line pointer, NOT the
    // full help dump.
    .showHelpAfterError("Run 'cgeaa zuora' (or 'cgeaa zuora <command> --help') for usage.")
    .option('--debug', 'print every HTTP request URL and response body')
    .option('--no-dependency', 'skip dependency tree traversal')
    .option('--max-rows <n>', 'override the apiQuery pagination row cap for this run')
    .option('--max-nodes <n>', 'override the dependency traversal node ceiling for this run')
    .option('--max-items <n>', 'override the sub-item pagination cap for this run')
    .option('--no-caps', 'disable all pull caps (row/node/item) for this run — may take a long time on large tenants')
    .option('--unbounded', 'alias for --no-caps')
    .option('-y, --yes', 'assume "yes" for the production write confirmation (for non-interactive/CI use)')
    .option('--allow-prod-financial', 'permit create/push/delete of financial resources against a PRODUCTION environment');

  program.addHelpText(
    'after',
    `
Use cases (what these commands are for):
  1. Config editing   pull/push workflow & billing-template so they can be edited in your
                      IDE (including with AI tooling), then pushed back.
  2. Test data        pull/push accounts and their billing objects (contact, subscription,
                      order, invoice, credit-/debit-memo, bill-run) into LOWER environments
                      for QA and bug reproduction.
  3. Automation       scripted tasks against one tenant, e.g. creating products (with their
                      rate plans and charges) in production from a ticket.

These commands operate on ONE tenant at a time (the active 'auth' environment). This is NOT an
environment-promotion pipeline: promotion (IntQA -> StagingUAT -> Production) is handled by
Zuora's native Deployment Manager. See docs/promotion-deployment-manager.md.

Run 'cgeaa zuora <command> --help' (e.g. 'cgeaa zuora pull --help') to see the resources each verb supports.`
  );

  program.hook('preAction', (_thisCommand, actionCommand) => {
    const resource = actionCommand.name();
    const verb = actionCommand.parent?.name() ?? '';
    setInvokedCommand(verb, resource);
  });

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
  registerTemplates(program);

  return program;
}
