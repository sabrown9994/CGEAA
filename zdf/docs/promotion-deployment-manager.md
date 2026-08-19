# Promotion between Zuora environments — Deployment Manager (not ZDF)

**Status:** design decision, 2026-08-19.
**TL;DR:** Config promotion (IntQA → StagingUAT → Production) is done with Zuora's native
**Deployment Manager**, driven outside ZDF. ZDF is a developer CLI, not a promotion pipeline.

---

## The question we were answering

We wanted a feature-based promotion flow across three protected branches mapped to three Zuora
tenants:

| Branch | Zuora tenant |
|---|---|
| `qa` | IntQA (sandbox) |
| `staging` | StagingUAT (sandbox) |
| `main` | Production |

The original plan had ZDF host the promotion engine: commit the pulled `zdf-output/` tree to
git, and on merge run `git diff → zdf create/push/delete` per changed object (the `sync-diff`
command). The open question was whether that could instead ride on Zuora's **Deployment
Manager** API — specifically whether the API can deploy **only the specific objects** a feature
changed.

## What the Deployment Manager API actually offers

The metadata-deployment API has **6 endpoints**:

| Method | Path | Purpose |
|---|---|---|
| POST | `/deployment-manager/deployments/tenants` | Compare + deploy a source tenant to a target tenant |
| POST | `/deployment-manager/deployments/templates` | Compare + deploy a **template file** to a tenant |
| POST | `/deployment-manager/deployments/tenant/product_catalog` | Deploy the whole product catalog, tenant → tenant |
| POST | `/deployment-manager/deployments/template/product_catalog` | Deploy product catalog from a template file |
| POST | `/deployment-manager/deployments/{migrationId}/revert` | Revert a deployment |
| GET | `/deployment-manager/deployments/{migrationId}` | Retrieve a deployment log / status |

**Granularity: component-type, all-or-nothing within a type.** The tenant-deploy endpoint takes
boolean toggles per component **type** — `settings`, `notifications`, `workflows`,
`customFields`, `customObjects`, `productCatalog`, `taxation`, `userRoles`, `reporting` — plus
`name`, `description`, `sendEmail`, `sourceTenantId`. There is **no field to name individual
objects** (a specific workflow, a specific product by id/name). Toggling `workflows: true`
deploys *all* workflows; `productCatalog: true` deploys the *entire* catalog.

The `templates` endpoints get closer to a curated subset, but the template is a **file authored
in the Zuora UI** and uploaded via `multipart/form-data` (`template` field) — the API exposes no
object-selection payload either, and there is no API to *build* a template from a chosen subset.

**Conclusion:** the Deployment Manager API **cannot target specific objects.** The finest
control is per component-type. So "detect the feature's changed objects with a diff, then
generate a deployment of just those objects" is not achievable on this API.

## Why that killed the ZDF-as-pipeline idea (and why that's fine)

1. **Object-level promotion isn't available at the platform level.** If Zuora itself only moves
   whole component types, a bespoke per-object pipeline in ZDF would be fighting the platform,
   re-implementing cross-tenant matching Zuora already does internally.
2. **Internal ids aren't cross-environment identifiers.** Zuora generates ids per tenant and
   re-keys sandboxes on refresh, so an id pulled from IntQA does not address the same object in
   StagingUAT/Production. Deployment Manager sidesteps this by doing its own source→target
   matching; a ZDF pipeline would have had to invent natural-key matching per resource type.
3. **The two mechanisms have different jobs.** Deployment Manager = coarse, whole-component
   promotion between tenants. ZDF = surgical, object-level developer interaction with a single
   tenant. They compose; neither needs to be the other.

## The resulting split

- **Promotion (IntQA → StagingUAT → Production):** Zuora **Deployment Manager**. Drive it from a
  GitHub Action (or the Zuora UI) that calls `POST /deployment-manager/deployments/tenants` with
  the relevant component-type toggles (`workflows`, `productCatalog`, etc.), `sourceTenantId` set
  to the lower tenant, authenticated against the target. Gate the production deploy behind a
  protected GitHub Environment with manual approval. **This lives outside ZDF.**
- **Developer CLI (object-level):** **ZDF**, scoped to three use cases:
  1. pull/push `workflow` and `billing-template` between Zuora and the IDE for AI-assisted editing;
  2. pull/push financial/test data into **lower** environments for QA and bug reproduction;
  3. targeted automation such as creating products (+ rate plans / charges) in production from a
     ticket.

## Follow-ups (not yet decided)

- Whether the GitHub Action for Deployment Manager lives in this repo or in FinSys
  (`cargurus-ea/FinTech`, alongside the existing `zuora-deploy-all.yml`).
- Whether billing/invoice **templates** promote via `settings` in the tenant deploy or via a
  UI-authored Deployment Manager **template file** — needs a live check of what component type
  they fall under.
- Guardrails for ZDF financial-data pushes to production (should stay blocked absent an explicit
  opt-in flag).
