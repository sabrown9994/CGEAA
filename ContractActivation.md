# Contract Activation Automation

## Overview

This document details all Apex automation that executes during Contract activation in Salesforce. Contract activation is a critical component of the CPQ workflow involving multiple triggers, batch jobs, and integration points.

## Process Flow

```
Opportunity (Closed Won) 
  ↓
Quote (Contracted)
  ↓
Order (Created & Activated)
  ↓
CPQ Subscriptions (Created & Activated)
  ↓
Contract (Pending Activation → Activated)
  ↓
Account Features Updated
  ↓
External System Integration Messages
```

---

## Trigger Architecture

### 1. ContractTrigger

**File:** `ContractTrigger.trigger` → `ContractTriggerHandler.cls` → `ContractTriggerFunctions.cls`

#### Before Insert
- **initialSetup()** - Sets Status='Pending Activation', stamps quote data (dates, contact, language)
- **setContractRenewalTerm()** - Stamps renewal term from quote (PGTM-1113)

#### Before Update
- **updatePrimaryContactFromQuoteOnContracts()** - Updates primary contact when order changes
- **TrialContractFunctions.checkAndExtendTrial()** - Trial extensions

#### After Insert
- **getContractPDF()** - Attaches quote PDF to contract (BR-4265)

#### After Update
- **updateAccountType()** - Updates Account.Type='Customer' when contract activates
- **getAmendContractPDF()** - Attaches amendment PDF (BR-4265)

### 2. OrderTrigger

**File:** `OrderTrigger.trigger` → `OrderTriggerHandler.cls` → `OrderTriggerFunctions.cls`

#### Before Update
- **checkAmendmentRenewalNeeded()** - Validates amendment renewal requirements
- **checkContracted()** - Queues activated orders for contracting via QueueableContractOrders

#### After Update
- **checkActivationStatusesPending()** - Triggers integrations (Zuora, PH Admin)
- **updateContractData()** - Updates contract end dates, pricing flags

### 3. CPQ_Subscription_Trigger

**File:** `CPQ_Subscription_Trigger.trigger` → `CPQ_Subscription_TriggerHandler.cls` → `CPQ_Subscription_TriggerFunctions.cls`

#### Before Insert
- **initialSetup()** - Sets Provisioning_Status__c='Pending Activation'

#### After Insert/Update
- **CG_CPQSubscriptionHelper.processAccountFeatureUpdates()** - Updates account features (CRM-5021)
- **setOrdersPending()** - Sets Order activation status fields to trigger integrations (BR-3884)
- **processPHIntegrationUpdates()** - Sends PH integration messages
- **updateAccountType()** - Updates Account.Type based on active subscriptions
- **evaluateDowngrades()** - Evaluates product downgrades (PGTM-2195)

---

## Key Methods

### Contract Setup

**ContractTriggerFunctions.initialSetup()**
```apex
// Sets initial contract fields from Quote
Status = 'Pending Activation'
EndDate = Quote.Initial_Term_End_Date__c
QuotePrimaryContact__c = Quote.SBQQ__PrimaryContact__c
ContractLanguage__c = Quote.SBQQ__QuoteLanguage__c
SBQQ__PreserveBundleStructureUponRenewals__c = true
Legacy_Contract__c = false
```

### Contract Activation

**ContractTriggerFunctions.updateAccountType()**
```apex
// When Contract.Status → 'Activated'|'Pending Activation'|'Delinquent'
// Updates Account.Type = 'Customer' if active CPQ subscriptions exist
```

### Order Contracting

**OrderTriggerFunctions.checkContracted()**
```apex
// When Order.Status = 'Activated' AND SBQQ__Contracted__c = false
// Enqueues QueueableContractOrders for each quote
// Batch size: 1 for amendments, 200 for new orders (BR-2732)
```

### Order Activation Integrations

**OrderTriggerFunctions.checkActivationStatusesPending()**
```apex
// Monitors activation status fields:
// - Activation_Status_Renew_Prior__c
// - Activation_Zuora_Subscription__c
// - Activation_Zuora_Invoice__c
// - Activation_PH_Admin_Centre__c

// When field → 'Pending', calls integration helpers:
ZuoraIntegration_SupplementOrderHelper.sendRenewalPriorToCancellation()
ZuoraIntegration_OrderHelper.createAndSendZOrderMessages()
ZuoraIntegration_InvoiceHelper.createAndSendZBillingMessages()
PHIntegration_AccountHelper.createAndSendPHAccountMessages()
```

### Subscription Order Integration Trigger

**CPQ_Subscription_TriggerFunctions.setOrdersPending()**
```apex
// After all OrderItems have CPQ Subscriptions:
// Sets Order activation fields to 'Pending'
// Triggers Zuora and PH integrations
```

### Feature Updates

**CG_CPQSubscriptionHelper.processAccountFeatureUpdates()**
```apex
// When CPQ Subscription fields change:
// - Collects Fulfillment Account IDs
// - Calls CG_AccountFeatureMessageHelper.generateAccountFeatureMessages()
// - Creates Integration_Message__c records for external systems
```

---

## Batch Jobs

### Batch_ActivatePendingContracts

**Purpose:** Activates contracts when dates become current (BR-1452)

**Schedule:** Daily

**Actions:**
1. Updates Contract.Status: 'Pending Activation' → 'Activated'
2. Updates Account.Type = 'Customer'
3. Updates Account.Product_Activation_Status__c = 'Active' (or 'Trial' for trial contracts)

**Query:**
```sql
SELECT Id FROM SBQQ__Subscription__c 
WHERE Provisioning_Status__c IN ('Activated','Pending Activation')
  AND SBQQ__Contract__r.Status = 'Pending Activation'
  AND SBQQ__Contract__r.StartDate <= TODAY
  AND SBQQ__Contract__r.EndDate >= TODAY
```

### Other Contract Batch Jobs

- **Batch_ExpireContracts** - Expires contracts past end date
- **Batch_CancelDelinquentContracts** - Cancels delinquent contracts
- **Batch_AutoExtendContracts** - Auto-extends contracts
- **Batch_RetryContractingOrders** - Retries failed contracting
- **Batch_ProcessBaseBundleFlaggedContracts** - Reviews base bundle subscriptions

---

## Integration Points

### 1. Zuora

**Order Creation:** `ZuoraIntegration_OrderHelper.createAndSendZOrderMessages()`
- Creates Zuora subscriptions from activated orders
- Trigger: Order.Activation_Zuora_Subscription__c = 'Pending'

**Invoice Generation:** `ZuoraIntegration_InvoiceHelper.createAndSendZBillingMessages()`
- Generates invoices in Zuora
- Trigger: Order.Activation_Zuora_Invoice__c = 'Pending'

**Renewal Prior to Cancellation:** `ZuoraIntegration_SupplementOrderHelper.sendRenewalPriorToCancellation()`
- Handles renewal scenarios
- Trigger: Order.Activation_Status_Renew_Prior__c = 'Pending'

### 2. PH (Piston Heads) Admin Centre

**Helper:** `PHIntegration_AccountHelper.createAndSendPHAccountMessages()`
- Sends activation/deactivation messages for PH products
- Trigger: Order.Activation_PH_Admin_Centre__c = 'Pending' OR subscription status changes

**PH Products:** Product codes containing 'PH-' or 'FEAT'

### 3. CG Feature Framework

**Helper:** `CG_AccountFeatureMessageHelper.generateAccountFeatureMessages()`
- Generates account feature maps for external CG systems
- Creates Integration_Message__c records
- Trigger: CPQ Subscription changes affecting features

### 4. NetSuite

**Handler:** `SubscriptionTriggerHandler.handleAfterUpdate()`
- NetSuite consumption model integration
- Trigger: CPQ Subscription updates

---

## Key Objects & Fields

### Contract

**Status Values:**
- 'Pending Activation' - Initial state
- 'Activated' - Contract is active
- 'Expired' - Past end date
- 'Cancelled' - Terminated early

**Key Fields:**
- `SBQQ__Quote__c` - Source quote
- `SBQQ__Order__c` - Related order
- `Initial_Term_End_Date__c` - Term end date
- `SBQQ__RenewalTerm__c` - Renewal term
- `QuotePrimaryContact__c` - Primary contact
- `ContractLanguage__c` - Contract language

### Order

**Key Fields:**
- `Status` - 'Activated' triggers contracting
- `Type` - 'Amendment' | 'Renewal' | 'New'
- `SBQQ__Contracted__c` - Contract creation flag
- `Activation_Status_Renew_Prior__c` - Integration status
- `Activation_Zuora_Subscription__c` - Integration status
- `Activation_Zuora_Invoice__c` - Integration status
- `Activation_PH_Admin_Centre__c` - Integration status

### SBQQ__Subscription__c

**Provisioning_Status__c Values:**
- 'Pending Activation' - Initial state
- 'Activated' - Active subscription
- 'Inactive' - Deactivated
- 'Delinquent' - Payment issues

**Key Fields:**
- `SBQQ__Contract__c` - Parent contract
- `Fulfillment_Account__c` - Fulfillment account
- `Product_Code__c` - Product identifier
- `SBQQ__Quantity__c` - Subscription quantity

### Account

**Type Values:**
- 'Customer' - Active customer
- 'Former Customer' - Past customer

**Product_Activation_Status__c Values:**
- 'Active' - Has active subscriptions
- 'Trial' - Trial contract
- 'Restricted - Activated' - Past cancellation period

---

## Constants

```apex
// Contract Statuses
CONTRACT_STATUS_PENDING = 'Pending Activation'
CONTRACT_STATUS_ACTIVE = 'Activated'

// Subscription Statuses
SUBSCRIPTION_PROVISIONINGSTATUS_ACTIVE = 'Activated'
SUBSCRIPTION_PROVISIONINGSTATUS_PENDING = 'Pending Activation'
SUBSCRIPTION_PROVISIONINGSTATUS_INACTIVE = 'Inactive'
SUBSCRIPTION_PROVISIONINGSTATUS_DELINQUENT = 'Delinquent'

// Activation Statuses
ACTIVATION_STATUS_PENDING = 'Pending'
ACTIVATION_STATUS_COMPLETE = 'Complete'
ACTIVATION_STATUS_NA = 'N/A'

// Product Codes
PRODUCT_PRODUCTCODE_CGBASE = 'CG-BASE'
```

---

## Flow Automation

### setContractFields Flow

**Type:** Screen Flow  
**Purpose:** Manual contract updates with subscription alignment

**Steps:**
1. Retrieves contract by recordId
2. Shows edit screen for Contract End Date and Auto Renewal Disable Date
3. Updates contract fields
4. Updates related CG-BASE Activated subscriptions with Auto_Renewal_Disable_Date__c

---

## Testing

### Minimum Test Data

1. Account (Type='Customer')
2. Opportunity (StageName='Closed Won')
3. SBQQ__Quote__c (SBQQ__Primary__c=true, SBQQ__Ordered__c=true)
4. Product2 (ProductCode='CG-BASE')
5. Order (Status='Activated')
6. SBQQ__Subscription__c (Provisioning_Status__c='Activated')
7. Contract (Status='Pending Activation')

### Test Classes

- `ContractTriggerFunctions_Test.cls`
- `OrderTriggerFunctions_Test.cls`
- `CPQ_Subscription_TriggerFunctions_Test.cls`
- `CG_FeatureFramework_Test.cls`

---

## Related Documentation

- NETSUITE_INTEGRATION_PLAN.md
- ZUORA_INTEGRATION_README.md
- PRODUCT_FEATURE_FRAMEWORK_README.md
- CONGA_COMPOSER_API_README.md

---

## JIRA References

- **BR-1452** - Contract activation batch job
- **BR-2732** - Order contracting queueable
- **BR-3884** - PH integration trigger
- **BR-4265** - Contract PDF attachment
- **BR-7299** - Account type update logic
- **CRM-5021** - Feature framework integration
- **PGTM-1113** - Renewal term stamping
- **PGTM-2195** - Downgrade evaluation

---

*Last Updated: 2025-01-05*
