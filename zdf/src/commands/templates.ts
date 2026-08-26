import { Command } from 'commander';
import { writeResourceFileAs } from '../helpers/file-io.js';
import { output } from '../helpers/output.js';
import { runCommand } from '../helpers/command-runner.js';

// Starter skeletons for the catalog resources `create` supports. Placeholders read REPLACE_ME;
// tenant-specific values (accounting codes, custom-field picklist values, parent ids) must be
// filled in before `create`. Product create POSTs the body VERBATIM to the Commerce API, so the
// product skeleton contains no extra annotation fields. Rate-plan / charge use the legacy
// /v1/object/ endpoints (PascalCase).

const PRODUCT_TEMPLATE = {
  name: 'REPLACE_ME product name',
  sku: 'REPLACE_ME-SKU',
  state: 'Active',
  start_date: '2026-01-01',
  item__c: 'REPLACE_ME',
  productfamily__c: 'REPLACE_ME',
  plans: [
    {
      name: 'REPLACE_ME plan name',
      start_date: '2026-01-01',
      charges: [
        {
          name: 'REPLACE_ME charge name',
          charge_type: 'recurring',
          charge_model: 'flat_fee',
          bill_cycle: 'default',
          end_date_condition: 'subscription_end',
          pricing: { flatAmounts: { USD: 0 } },
          accounting: {
            accounting_code: 'REPLACE_ME',
            deferred_revenue_account: 'Deferred Revenue',
            recognized_revenue_account: 'REPLACE_ME',
            unbilled_receivables_account: 'Unbilled Accounts Receivable',
            contract_asset_account: 'REPLACE_ME',
            contract_liability_account: 'REPLACE_ME',
            contract_recognized_revenue_account: 'REPLACE_ME',
            adjustment_liability_account: 'REPLACE_ME',
            adjustment_revenue_account: 'REPLACE_ME',
          },
          pobidentifier__c: 'REPLACE_ME',
          pobname__c: 'REPLACE_ME',
        },
      ],
    },
  ],
};

const PRODUCT_RATE_PLAN_TEMPLATE = {
  ProductId: 'REPLACE_ME (Zuora product id in the target tenant)',
  Name: 'REPLACE_ME rate plan name',
  Description: '',
  EffectiveStartDate: '2026-01-01',
  EffectiveEndDate: '2099-01-01',
};

const PRODUCT_RATE_PLAN_CHARGE_TEMPLATE = {
  ProductRatePlanId: 'REPLACE_ME (Zuora product-rate-plan id in the target tenant)',
  Name: 'REPLACE_ME charge name',
  ChargeType: 'Recurring',
  ChargeModel: 'Flat Fee Pricing',
  BillingPeriod: 'Month',
  TriggerEvent: 'ContractEffective',
  POBIdentifier__c: 'REPLACE_ME',
  ProductRatePlanChargeTierData: {
    ProductRatePlanChargeTier: [{ Currency: 'USD', Price: 0 }],
  },
};

const TEMPLATES: Record<string, unknown> = {
  product: PRODUCT_TEMPLATE,
  'product-rate-plan': PRODUCT_RATE_PLAN_TEMPLATE,
  'product-rate-plan-charge': PRODUCT_RATE_PLAN_CHARGE_TEMPLATE,
};

/** Short numeric suffix so repeated `template` runs don't clobber each other. */
export function templateSuffix(): string {
  return String(Date.now() % 100000);
}

function getOrCreate(program: Command, name: string, description: string): Command {
  return program.commands.find((c) => c.name() === name) ?? program.command(name).description(description);
}

function emit(program: Command, resource: string): void {
  const fileName = `template-${resource}-${templateSuffix()}`;
  const path = writeResourceFileAs(resource, fileName, TEMPLATES[resource]);
  output.success(
    `Wrote ${resource} template to ${path}. Fill the REPLACE_ME placeholders (accounting codes / ` +
    `custom-field values / parent ids are tenant-specific), then run: cgeaa zuora create ${resource} ${fileName}`
  );
}

export function register(program: Command): void {
  const templateCmd = getOrCreate(
    program,
    'template',
    'Generate a starter JSON file (for `create`) for a catalog resource'
  );
  for (const resource of Object.keys(TEMPLATES)) {
    templateCmd
      .command(resource)
      .description(`Write a starter template-${resource}-<n>.json usable by 'cgeaa zuora create ${resource}'`)
      .action(() => runCommand(program, async () => { emit(program, resource); })());
  }
}
