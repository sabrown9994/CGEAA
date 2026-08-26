---
name: zuora
description: >-
  Use when a task involves Zuora billing objects — accounts, subscriptions, invoices,
  credit/debit memos, bill runs, products & rate plans/charges, workflows, or invoice
  (billing) templates — via the CGEAA `cgeaa zuora ...` CLI (the bundled Zuora Development
  Framework, "ZDF"). Covers three use cases: (1) editing Zuora config (workflows, billing
  templates) locally; (2) promoting test data across tenants (pull from one, push into a
  lower environment); (3) creating product catalog objects from a ticket. Trigger on
  mentions of Zuora, ZDF, `cgeaa zuora`, billing objects, or moving/creating them between tenants.
---

# Using ZDF (`cgeaa zuora`)

ZDF is a developer CLI that pulls Zuora objects to local JSON, lets you edit them, and pushes
them back. It talks to **one active tenant at a time** (the selected `auth` environment).
Every command is `cgeaa zuora <args>`.

## Before running anything

- Confirm the CLI is available: `cgeaa zuora --help`. If `cgeaa` isn't found, tell the user to
  run the repo's `./cgeaa-setup` (or `cd zdf && npm install && npm run build`) first — this skill
  does **not** install the binary.
- Check the active tenant before any write: `cgeaa zuora auth env`. Switch with
  `cgeaa zuora auth use <name>`. Add a tenant with `cgeaa zuora auth add` (interactive: prompts for
  name → region → environment type → client id → secret).
- Pulled files land in `./zdf-output/<resource>/` (override with `ZDF_OUTPUT_DIR`). Files are named
  by natural key (accountNumber, invoiceNumber, SKU, …); you may reference a record by its natural
  key **or** its internal id.
- Verbs: `pull`, `push` (update-or-create upsert), `create` (from a local file), `delete`, `list`,
  `template`. Useful flags: `--no-dependency` (skip the child-object tree — essential for large
  accounts), `--debug` (print every HTTP call).

## Use case 1 — Config editing (workflow, billing-template)

Pull to local JSON, edit (by hand or with the user), push back to the **same** tenant.

```
cgeaa zuora pull workflow <id>            # full definition via export
cgeaa zuora push workflow <id>            # re-imports edited logic as a new active version
cgeaa zuora pull billing-template <id>    # decodes the HTML design JSON
cgeaa zuora push billing-template <id>
```

## Use case 2 — Test-data promotion across tenants

Copy data from a source tenant into a lower one. `push` is an **upsert**: it finds the record in the
active (target) tenant via the in-file `_zdf` id map or a natural-key search and updates it, or
creates it net-new if absent. Re-pushing is idempotent. Do NOT strip the `_zdf` block from files —
it maps the record's id per tenant and is stripped automatically before each Zuora call.

```
cgeaa zuora auth use <source>
cgeaa zuora pull account <accountId>          # also pulls its invoices, memos, etc.

cgeaa zuora auth use <target>                 # switch active tenant
cgeaa zuora push account <accountNumber>      # account first (invoices/memos FK to it)
cgeaa zuora push invoice <invoiceNumber>
cgeaa zuora push credit-memo <memoNumber>
cgeaa zuora push debit-memo  <memoNumber>
```

Credit/debit-memo create needs a source invoice whose items carry a SKU (subscription-billed
invoices); `create` requires `--invoice <id>`.

## Use case 3 — Product-catalog automation

Scaffold a create-shaped file with `template`, fill in tenant-specific values (pricing, accounting
codes, required custom fields), then create.

```
cgeaa zuora template product                  # also: product-rate-plan, product-rate-plan-charge
cgeaa zuora create product <name>             # Commerce API: product + plan + charge
cgeaa zuora pull   product <SKU>              # product files are SKU-named
cgeaa zuora push   product <SKU>
```

## Safety

- Writes to a **Production** tenant are blocked for financial resources unless `--allow-prod-financial`
  is passed, and prompt for confirmation otherwise. In CI / non-interactive shells add `-y`/`--yes`
  (or `ZDF_ASSUME_YES=true`). Sandboxes need none of this. Always confirm the target with
  `cgeaa zuora auth env` before a write, and prefer a lower environment for test data.
- For CI, authenticate via `ZDF_CLIENT_ID` / `ZDF_CLIENT_SECRET` / `ZDF_BASE_URL` instead of `auth add`.

## Full reference

For every resource, verb, endpoint, flag, and limitation, read `zdf/README-ZDF.md` in the repo.
