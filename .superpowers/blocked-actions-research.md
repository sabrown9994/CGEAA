# Blocked ZDF actions — root cause research (2026-08-07, intQA)

| Action | Root cause | Sandbox-only? | Fixable by admin? | Confidence |
|---|---|---|---|---|
| create product | POST /v1/catalog/products → 405 (route disabled on this tenant/tier). /v1/object/product also requires unknown custom field ProductFamily__c. | Likely tenant/API-tier config, not universal | Probably yes (needs ProductFamily__c value + catalog API access) | PLAUSIBLE |
| create subscription | Tenant has Orders enabled (enableOrderUI:true) — legacy Subscriptions API disabled by design | No — permanent Orders migration | Possible but major change | CONFIRMED |
| delete subscription | Zuora has no DELETE /v1/subscriptions endpoint (405) — fundamental API limitation | No | No — Zuora API limitation | CONFIRMED |
| create invoice (standalone) | Finance > Manage Non-Subscription Items settings not configured (revenue recognition codes missing) | No — tenant config gap | Yes — admin can configure | CONFIRMED |
| create credit-memo | Invoice Settlement IS enabled; endpoint returns schema validation (not feature-gate). Valid source invoice + correct body needed. NOT truly blocked. | No | N/A | CONFIRMED |
| create debit-memo | Same as credit-memo. NOT truly blocked. | No | N/A | CONFIRMED |
