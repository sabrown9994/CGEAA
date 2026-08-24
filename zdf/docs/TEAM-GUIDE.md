# ZDF (Zuora Development Framework) — Team Guide

ZDF is a developer CLI for pulling Zuora objects to local JSON, editing them (including with
AI tooling), and pushing them back. It runs through `cgeaa zuora <args>` and operates on **one
active tenant at a time** (the selected auth environment).

- **Install / first-run only:** `README-CGEAA.md` → "Zuora (ZDF)".
- **Full command reference** (every resource, verb, endpoint, flag, limitation): [`../README-ZDF.md`](../README-ZDF.md).

---

## Install

**Prerequisites:** Node.js ≥ 18, and a Zuora **OAuth client id + secret** per tenant
(Zuora UI → Administration → Manage Users → OAuth Clients).

```bash
# From the CGEAA repo root — the global installer builds ZDF automatically:
./cgeaa-setup

# Or build ZDF directly from a clone:
cd zdf && npm install && npm run build && cd ..

# Confirm it works:
cgeaa zuora --help
```

## Authenticate (once per tenant)

`auth add` is **interactive** — it prompts for **name → region → environment type → client id →
client secret**, and derives the base URL from your region/environment-type choice:

```bash
cgeaa zuora auth add
#   Environment name:   intQA
#   Region:             US
#   Environment type:   US Developer & Central Sandbox   -> https://rest.test.zuora.com
#   Client ID:          <your id>
#   Client Secret:      <your secret>   (masked)

cgeaa zuora auth use intQA          # set the active tenant
cgeaa zuora auth env                # confirm the active tenant
cgeaa zuora list billing-templates  # read-only smoke test
```

Common environment-type choices: `US Developer & Central Sandbox` → `rest.test.zuora.com`;
`US API Sandbox (Cloud 2)` → `rest.apisandbox.zuora.com`; `US Production (Cloud 2)` →
`rest.zuora.com`. Credentials are stored in `~/.zdf/config.json` (never committed). Pulled files
land in `./zdf-output/<resource>/` (override with `ZDF_OUTPUT_DIR`).

For CI / non-interactive use, skip `auth add` and set `ZDF_CLIENT_ID` / `ZDF_CLIENT_SECRET` /
`ZDF_BASE_URL` (+ optional `ZDF_ENV_NAME`) instead.

---

## Use Case 1 — Config editing (`workflow`, `billing-template`)

Pull a config object to local JSON, edit it (by hand or with Claude Code), push it back to the
**same** tenant.

```bash
cgeaa zuora auth use intQA

# Workflow (full definition via export/import):
cgeaa zuora pull workflow <workflowId>          # -> zdf-output/workflows/<id>.json
#   ...edit the file (task graph, linkages, settings)...
cgeaa zuora push workflow <workflowId>          # imports as a NEW active version (in-place logic edit)
cgeaa zuora create workflow <name>              # import the file as a brand-new workflow
cgeaa zuora delete workflow <workflowId>

# Billing template (HTML invoice template):
cgeaa zuora list billing-templates
cgeaa zuora pull billing-template <id>          # decodes the HTML design JSON
cgeaa zuora push billing-template <id>
```

---

## Use Case 2 — Test data promotion, cross-tenant

Resources: `account`, `invoice`, `credit-memo`, `debit-memo`, `product`, plus
contact/subscription/order/order-line-item/bill-run.

Copy financial/test data from a **source** tenant into a **lower** tenant for QA and bug repro.
`push` is a cross-tenant **upsert**: it finds the record in the active (target) tenant via the
in-file `_zdf` id map or a natural-key search and **updates** it — or, if it's absent, **creates it
net-new** by adapting the pulled shape into the create body. The new id is recorded in the file, so
re-pushing is idempotent (no duplicates).

```bash
# 1. Pull from the SOURCE tenant
cgeaa zuora auth use intQA
cgeaa zuora pull account <accountId>            # also pulls its invoices, memos, etc.
#   (add --no-dependency to pull just the one object)

# 2. Switch active env to the TARGET tenant and push (dependency order: account first)
cgeaa zuora auth use StagingUAT
cgeaa zuora push account <accountNumber>        # creates it if absent, else updates
cgeaa zuora push invoice <invoiceNumber>        # FK to its account is auto-remapped
cgeaa zuora push credit-memo <memoNumber>
cgeaa zuora push debit-memo  <memoNumber>
```

Notes:
- Files are named by **natural key** (accountNumber, invoiceNumber, SKU, ...). You can reference a
  record by its natural key **or** its internal id.
- The `_zdf` block in each file tracks the record's id in every tenant it's been synced to — leave
  it in the file; it is stripped before every Zuora call.
- **Live-verified A→B** (two real tenants): account + invoice create-into-empty and update, product
  update-by-SKU, all idempotent.
- **Credit/debit-memo** create needs a source invoice whose items carry a SKU (i.e. subscription-
  billed invoices); `--invoice` is required on `create`.

---

## Use Case 3 — Targeted automation: product catalog

Resources: `product`, `product-rate-plan`, `product-rate-plan-charge`.

Scripted one-off creation, e.g. standing up a product (with its rate plan and charges) in a tenant
from a ticket. Use `template` to scaffold a correctly-shaped create file, fill in the tenant-specific
values, then `create`.

```bash
cgeaa zuora auth use intQA

cgeaa zuora template product                    # -> template-product-<n>.json
cgeaa zuora template product-rate-plan
cgeaa zuora template product-rate-plan-charge
#   ...edit the templates (pricing, accounting codes, required custom fields)...

cgeaa zuora create product <name>               # Commerce API — creates product + plan + charge
cgeaa zuora pull   product <SKU>                # product files are SKU-named
cgeaa zuora push   product <SKU>                # updates; resolves the internal id automatically
cgeaa zuora delete product <SKU>
```

---

## Safety & good-to-knows

- **Production guard:** writes to a Production tenant are **blocked** for financial resources unless
  you pass `--allow-prod-financial`, and prompt for confirmation otherwise. In CI / non-interactive
  shells, pass `-y` / `--yes` (or `ZDF_ASSUME_YES=true`). Default sandboxes need none of this.
- **CI auth:** set `ZDF_CLIENT_ID` / `ZDF_CLIENT_SECRET` / `ZDF_BASE_URL` (+ optional `ZDF_ENV_NAME`)
  instead of the config file.
- **Useful flags:** `--no-dependency` (skip the dependency tree — essential for large accounts),
  `--debug` (print every HTTP call), `--no-caps` (remove pagination caps).
- **Full reference:** [`../README-ZDF.md`](../README-ZDF.md).
