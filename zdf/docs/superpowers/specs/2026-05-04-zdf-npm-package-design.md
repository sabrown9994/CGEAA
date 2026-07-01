# ZDF — Zuora Development Framework CLI
## Design Spec | 2026-05-04

---

## Overview

`zdf` is an npm package that provides a terminal CLI for interacting with Zuora via its REST API. Developers install it globally (`npm install -g zdf`) and use the `zdf` command to perform CRUD operations against Zuora resources. Retrieved resources are written to a local folder structure; files in that folder are used as the source of truth for create and update operations.

---

## Project Structure

```
zuora-development-framework/
├── bin/
│   └── zdf.js                        # CLI entry point, registered as "zdf" binary
├── src/
│   ├── auth/
│   │   └── auth.js                   # Environment & token management
│   ├── api/
│   │   └── client.js                 # Axios HTTP client, auth injection, request builder
│   ├── commands/
│   │   ├── accounts.js
│   │   ├── contacts.js
│   │   ├── subscriptions.js
│   │   ├── products.js
│   │   ├── product-rate-plans.js
│   │   ├── product-rate-plan-charges.js
│   │   ├── workflows.js
│   │   ├── billing-templates.js      # Covers invoice, credit memo, debit memo templates
│   │   ├── data-queries.js
│   │   └── orders.js                 # Orders and order line items
│   └── helpers/
│       ├── file-io.js                # Read/write/rename local resource files
│       ├── output.js                 # Consistent console output (success, error, info, warn)
│       ├── delete-guard.js           # Known-unsupported delete checks
│       ├── zuora-response.js         # assertSuccess helper and ZuoraWriteResponse type
│       └── updatable-fields.js       # filterUpdatableFields — strips read-only and null fields
├── docs/
│   └── superpowers/
│       └── specs/
│           └── 2026-05-04-zdf-npm-package-design.md
├── package.json
└── README.md
```

Each command file exports a `register(program)` function that attaches its subcommands to the Commander program instance. `bin/zdf.js` imports all command files and calls their `register` functions.

---

## Authentication & Environment Management

Credentials and environment configuration are stored in `~/.zdf/config.json`. The file is created on first `zdf auth add`. It supports an arbitrary number of named environments; one is marked active at any time.

### Config shape

```json
{
  "active": "my-sandbox",
  "environments": {
    "my-sandbox": {
      "name": "my-sandbox",
      "type": "US API Sandbox (Cloud 2)",
      "baseUrl": "https://rest.apisandbox.zuora.com",
      "isProduction": false,
      "clientId": "...",
      "clientSecret": "...",
      "token": "...",
      "tokenExpiresAt": 1234567890
    },
    "my-prod": {
      "name": "my-prod",
      "type": "US Production (Cloud 2)",
      "baseUrl": "https://rest.zuora.com",
      "isProduction": true,
      "clientId": "...",
      "clientSecret": "...",
      "token": "...",
      "tokenExpiresAt": 1234567890
    }
  }
}
```

### Auth commands

| Command | Description |
|---|---|
| `zdf auth add` | Add a new named environment (interactive prompt) |
| `zdf auth list` | List all configured environments, marking the active one |
| `zdf auth use <name>` | Switch the active environment |
| `zdf auth env` | Show the currently active environment name and type |
| `zdf auth remove <name>` | Remove a named environment |

### `zdf auth add` interactive flow

When run, the CLI first prints:
> `For a reference of environment types and their base URLs, see: https://developer.zuora.com/v1-api-reference/introduction`

Then prompts:
1. **Custom name** — free text label for this environment
2. **Region** — choice: `US`, `EU`, `APAC`
3. **Environment type** — filtered by region:

| Region | Available types |
|---|---|
| US | US Production (Cloud 1), US Production (Cloud 2), US API Sandbox (Cloud 1), US API Sandbox (Cloud 2), US Developer & Central Sandbox |
| EU | EU Production, EU API Sandbox, EU Developer & Central Sandbox |
| APAC | APAC Production, APAC Developer & Central Sandbox |

4. **client_id** — plain text input
5. **client_secret** — masked input

The base URL is inferred silently from the environment type; the user never sees or types it. `isProduction` is inferred: any type containing "Production" sets it to `true`.

### Environment type → base URL mapping

| Environment type | Base URL |
|---|---|
| US Production (Cloud 1) | `https://rest.na.zuora.com` |
| US Production (Cloud 2) | `https://rest.zuora.com` |
| US API Sandbox (Cloud 1) | `https://rest.sandbox.na.zuora.com` |
| US API Sandbox (Cloud 2) | `https://rest.apisandbox.zuora.com` |
| US Developer & Central Sandbox | `https://rest.test.zuora.com` |
| EU Production | `https://rest.eu.zuora.com` |
| EU API Sandbox | `https://rest.sandbox.eu.zuora.com` |
| EU Developer & Central Sandbox | `https://rest.test.eu.zuora.com` |
| APAC Production | `https://rest.ap.zuora.com` |
| APAC Developer & Central Sandbox | `https://rest.test.ap.zuora.com` |

### Token management

Before every API request, `client.js` calls `ensureToken(envConfig)` in `auth.js`. If the cached token is missing or expired, a new one is fetched automatically:

```
POST /oauth/token
  grant_type=client_credentials
  client_id=<stored>
  client_secret=<stored>
```

The new token and its expiry (`tokenExpiresAt = Date.now() + expires_in * 1000`) are written back to `~/.zdf/config.json`. Token refresh is invisible to the user.

### Production guard

Any `get`, `create`, `update`, or `delete` command run against an environment where `isProduction: true` displays a confirmation prompt before proceeding:

> `You are about to run this command against a PRODUCTION environment (my-prod). Are you sure? (y/N)`

Answering `N` exits cleanly with no API call made.

---

## CLI Commands & Resource Operations

### Syntax

```
zdf <verb> <resource> <id-or-name> [--file <path>]
```

### Verbs

- `get` — fetch from Zuora, write to local file
- `list` — fetch all records (paginated), write each to local file
- `create` — read local file, POST to Zuora, rename file to Zuora-assigned ID
- `update` — read local file, PUT to Zuora (field-filtered via `filterUpdatableFields`)
- `delete` — check delete guard, then DELETE in Zuora

### Resources & Zuora endpoint mapping

| Resource keyword | Zuora API endpoint | Local subfolder |
|---|---|---|
| `account` | `GET/POST/PUT/DELETE /v1/accounts/{id}` | `zdf-output/accounts/` |
| `contact` | `GET/POST/PUT/DELETE /v1/contacts/{id}` | `zdf-output/contacts/` |
| `subscription` | `GET/POST/PUT /v1/subscriptions/{id}` | `zdf-output/subscriptions/` |
| `product` | `GET/POST/PUT/DELETE /v1/catalog/products/{id}` | `zdf-output/products/` |
| `product-rate-plan` | `GET/POST/PUT/DELETE /v1/rateplan/{id}` | `zdf-output/product-rate-plans/` |
| `product-rate-plan-charge` | `GET/POST/PUT/DELETE /v1/catalog/products/{productId}/productrateplans/{rplanId}/productrateplanscharges/{id}` | `zdf-output/product-rate-plan-charges/` |
| `workflow` | `GET/POST/PUT/DELETE /v1/api/workflows/{id}` | `zdf-output/workflows/` |
| `billing-template` | `GET/POST/PUT/DELETE /v1/billing-documents/templates/{id}` | `zdf-output/billing-templates/` |
| `data-query` | `GET/POST/DELETE /query/jobs/{id}` | `zdf-output/data-queries/` |
| `order` | `GET(list)/POST/PUT/DELETE /v1/orders/{orderNumber}` | `zdf-output/orders/` |
| `order-line-item` | `GET/PUT /v1/order-line-items/{itemId}` | `zdf-output/order-line-items/` |

### Per-verb behavior details

**`zdf get <resource> <id>`**
- Fetches the resource from Zuora by internal ID
- Strips response metadata (HTTP headers, `success` boolean, request timing)
- Writes the resource fields only to `./zdf-output/<resource-type>/<id>.json`
- Creates the subfolder if it does not exist

**`zdf create <resource> <name>`**
- Looks for `./zdf-output/<resource-type>/<name>.json` (or `--file <path>` override)
- POSTs the file contents to Zuora
- On success, renames the local file from `<name>.json` to `<zuora-assigned-id>.json`
- Prints the new Zuora-assigned ID to the terminal

**`zdf update <resource> <id>`**
- Looks for `./zdf-output/<resource-type>/<id>.json` (or `--file <path>` override)
- Uses PUT by default; each command file specifies the correct HTTP method per Zuora's documentation for that resource
- If no local file is found, prints: `"No file found at zdf-output/<resource-type>/<id>.json. Run 'zdf get <resource> <id>' first or provide --file <path>."`

**`zdf delete <resource> <id>`**
- Runs the delete guard check first
- If allowed, sends DELETE to Zuora
- Surfaces Zuora's full error response if the delete fails

### Orders special behavior

Orders use `orderNumber` (e.g. `O-00000001`) as their identifier, not a UUID. The list command paginates through all orders and also fetches full order line item details:

- `zdf list orders` — paginates `GET /v1/orders`, writes each order to `zdf-output/orders/<orderNumber>.json`; for each order, iterates `orderLineItems[].id` and calls `GET /v1/order-line-items/{itemId}` for full detail, writing to `zdf-output/order-line-items/<itemId>.json`
- `zdf create order <name>` — reads local file, POSTs to Zuora, renames file to the returned `orderNumber`
- `zdf update order <orderNumber>` — reads local file, filters to updatable fields, PUTs to `/v1/orders/{orderNumber}`
- `zdf delete order <orderNumber>` — deletes the order via `DELETE /v1/orders/{orderNumber}`
- `zdf update order-line-item <itemId>` — reads `zdf-output/order-line-items/<itemId>.json` (or `--file`), filters to updatable fields, PUTs to `/v1/order-line-items/{itemId}`

### Data query special behavior

Data query files use **`.sql`** extension (not `.json`) so users can write SQL in their IDE.

- `zdf get data-query <id>` — fetches the job status/results for an existing query job ID, writes to `./zdf-output/data-queries/<id>.json`
- `zdf create data-query <name>` — reads `./zdf-output/data-queries/<name>.sql`, POSTs it as a new async query job, polls until complete, writes results to `./zdf-output/data-queries/<zuora-job-id>.json`; the original `.sql` file is left unchanged
- `zdf delete data-query <id>` — stops/cancels the running query job

### Delete guard

`src/helpers/delete-guard.js` exports `checkDeleteAllowed(resource)`. It throws with a user-friendly message for known-unsupported resources before any API call is made:

| Resource | Message |
|---|---|
| `subscription` | `"Subscriptions cannot be deleted in Zuora. To cancel a subscription, use the Zuora UI or Orders API."` |

All other resources pass through; Zuora's own error is surfaced if the DELETE fails downstream.

---

## API Client & Helpers

### `src/api/client.js`

- Loads the active environment config via `auth.getActiveConfig()`
- Calls `auth.ensureToken(envConfig)` before every request
- Exposes: `get(path)`, `post(path, body)`, `put(path, body)`, `patch(path, body)`, `delete(path)`
- Sets `Authorization: Bearer <token>` and `Content-Type: application/json` on all requests
- On non-2xx responses, extracts Zuora's error structure and throws `{ statusCode, message, errors[] }`

### `src/helpers/file-io.js`

- `readResourceFile(resourceType, nameOrId, ext = 'json')` — resolves and reads `./zdf-output/<resourceType>/<nameOrId>.<ext>`; accepts any extension, e.g. `'sql'` for data queries
- `writeResourceFile(resourceType, id, data, ext = 'json')` — writes to `./zdf-output/<resourceType>/<id>.<ext>`, creates subfolders as needed
- `renameResourceFile(resourceType, oldName, newId, ext = 'json')` — renames the file after Zuora assigns an ID on create

### `src/helpers/output.js`

Thin wrappers for consistent console output using `chalk`:
- `success(msg)` — green
- `error(msg)` — red
- `info(msg)` — cyan
- `warn(msg)` — yellow

### `src/helpers/delete-guard.js`

- `checkDeleteAllowed(resource)` — throws with a descriptive message for `subscription`; all others pass through silently

### `src/helpers/zuora-response.js`

- `ZuoraWriteResponse` type — `{ success: boolean; reasons?: [...]; errors?: [...]; processId?: string }`
- `assertSuccess(res, label)` — checks `res.success`; if false, throws with formatted `reasons`/`errors` detail. All write operations (create, update, delete) call this after every Zuora response.

### `src/helpers/updatable-fields.js`

- `filterUpdatableFields(resource, data)` — strips fields not in the Zuora-defined updatable allowlist for that resource, then removes any remaining null values. Custom fields ending in `__c` always pass through. Resources without a defined allowlist (contacts, subscriptions, etc.) pass through all non-null fields unchanged.
- Allowlists defined for: `account`, `order-line-item`. Other resources use pass-through until defined.

### `src/auth/auth.js`

- `addEnvironment()` — interactive prompt flow for `zdf auth add`
- `listEnvironments()` — returns all configured environments
- `useEnvironment(name)` — sets the active environment
- `currentEnvironment()` — returns the active environment config
- `removeEnvironment(name)` — removes a named environment
- `getActiveConfig()` — returns the active environment config (used by `client.js`)
- `ensureToken(envConfig)` — checks expiry, fetches new token if needed, saves back to config

---

## Package Setup

### `package.json` key fields

```json
{
  "name": "zdf",
  "version": "1.0.0",
  "description": "Zuora Development Framework CLI",
  "type": "module",
  "bin": {
    "zdf": "./bin/zdf.js"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Dependencies

| Package | Purpose |
|---|---|
| `commander` | CLI argument parsing and subcommand registration |
| `axios` | HTTP client for Zuora API calls |
| `inquirer` | Interactive prompts for `zdf auth add` |
| `chalk` | Colored terminal output |
| `ora` | Spinner for async operations (token fetch, data query polling) |

### `bin/zdf.js` structure

```js
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

const program = new Command();
program.name('zdf').description('Zuora Development Framework CLI').version('1.0.0');
program.option('--debug', 'print full stack traces on error');

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
registerOrders(program); // registers: list orders, create/update/delete order, update order-line-item

program.parse();
```

---

## Error Handling

- Zuora API errors are caught in `client.js`, extracted from the response body, and rethrown as `{ statusCode, message, errors[] }`
- Zuora returns HTTP 200 with `success: false` for validation failures — all write operations call `assertSuccess(res, label)` to catch these and surface the `reasons`/`errors` detail
- Command files catch errors and pass to `output.error()` — no raw stack traces shown unless `--debug` flag is passed
- File-not-found on `create`/`update` shows: `"No file found at zdf-output/<resource-type>/<id>.json. Run 'zdf get <resource> <id>' first or provide --file <path>."`
- Production guard answering `N` exits cleanly with code 0, no API call made
- Delete guard exits with code 1 and a descriptive message before any API call

---

## Local Output Folder Structure (example)

```
./zdf-output/
├── accounts/
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0001.json
├── subscriptions/
│   └── A-S00000001.json
├── products/
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0099.json
├── product-rate-plans/
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0100.json
├── product-rate-plan-charges/
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0101.json
├── workflows/
│   └── 12345.json
├── billing-templates/
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0200.json
├── contacts/
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0300.json
├── data-queries/
│   ├── my-revenue-query.sql
│   └── 8a80812f7e6e3b1c017e6e4c2b5a0400.json
├── orders/
│   └── O-00000001.json
└── order-line-items/
    └── 8a80812f7e6e3b1c017e6e4c2b5a0500.json
```
