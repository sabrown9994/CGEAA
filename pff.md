# Product Feature Framework

## Table of Contents
- [Overview](#overview)
- [Architecture](#architecture)
- [Data Model](#data-model)
- [Core Components](#core-components)
- [User Interfaces](#user-interfaces)
- [Business Logic](#business-logic)
- [Testing](#testing)
- [Best Practices](#best-practices)

---

## Overview

The **Product Feature Framework** is a comprehensive Salesforce-based system that manages product features for accounts across multiple countries. It provides dynamic feature activation based on product subscriptions (CPQ), account status, and custom business rules.

### Key Capabilities
- **Dynamic Feature Generation**: Automatically determines account features based on active CPQ subscriptions and account status
- **Manual Overrides**: Allows business users to override generated features at account level
- **Mass Override Management**: Bulk management of feature overrides across multiple accounts
- **Integration**: Synchronizes feature data with external CarGurus systems
- **Metadata Support**: Complex feature configurations with dynamic metadata values
- **Audit Trail**: Tracks feature changes and maintains history

### Supported Countries
- **US** - United States
- **CA** - Canada  
- **GB** - United Kingdom

---

## Architecture

### High-Level Design

```
CPQ Products/Subscriptions → Feature Generation → Account Features
Product Activation Status → Feature Generation → Account Features
Manual Overrides → Override Processing → Integration Messages → External Systems
```

### Design Principles
1. **Separation of Concerns**: Generated features vs. overridden features
2. **Data-Driven Configuration**: Metadata-based feature definitions
3. **Country-Specific Logic**: Multi-region support
4. **Lazy Loading**: Efficient caching
5. **Bulkification**: All operations support bulk processing

---

## Data Model

### Core Objects

#### `CG_Feature__c`
Master definition of available features.

| Field | Description |
|-------|-------------|
| `Name` | Feature name |
| `CG_Feature_Id__c` | External feature ID |
| `Active__c` | Feature active status |

---

#### `CG_Feature_Metadata__c`
Configurable metadata definitions for features.

| Field | Description |
|-------|-------------|
| `CG_Feature__c` | Parent feature (Lookup) |
| `Country__c` | Semicolon-separated country codes |
| `Key__c` | Metadata key name |
| `Type__c` | Data type (Boolean, Text, Number) |
| `Value__c` | Default value |
| `Overrideable__c` | Can users override? |
| `Source_Object__c` | Salesforce object for dynamic values |
| `Source_Field__c` | Field name for dynamic values |
| `Source_Field_Multiplier__c` | Multiplier for numeric values |

---

#### `CG_Product_Feature__c`
Junction object linking Products to Features.

| Field | Description |
|-------|-------------|
| `Product__c` | Product2 lookup |
| `CG_Feature__c` | Feature lookup |
| `Country__c` | Country codes |

**Business Logic**: Active CPQ subscription triggers feature activation.

---

#### `CG_Status_Feature__c`
Links features to Product Activation Status values.

| Field | Description |
|-------|-------------|
| `CG_Feature__c` | Feature lookup |
| `Product_Activation_Status__c` | Status value |
| `Country__c` | Country codes |

---

#### `CG_Account_Feature__c`
Override records for account-specific customization.

| Field | Description |
|-------|-------------|
| `Account__c` | Account lookup |
| `CG_Feature__c` | Feature lookup |
| `Status__c` | A (Active) or I (Inactive) |
| `Status_Override__c` | Is status overridden? |
| `Metadata__c` | JSON metadata override |
| `Metadata_Override__c` | Is metadata overridden? |

---

### Data Hierarchy

```
Account
  ├── CPQ Subscriptions → Products → Product Features → Features
  ├── Product Activation Status → Status Features → Features
  └── CG Account Features (Manual Overrides)
```

---

## Core Components

### Apex Classes

#### `CG_FeatureHelper`
Central utility class for feature data access with lazy-loaded caching.

**Key Methods**:
- `getFeatureSFIdMap()`: All active features with metadata
- `getProductFeatureIdsMapByCountry(String)`: Product → Features map
- `getStatusFeatureIdsMapByCountry(String)`: Status → Features map
- `getFeatureMetadata(Id, String)`: Metadata definitions

---

#### `CG_AccountFeatureMap`
Instance class representing all features for a single account.

**Key Methods**:
- `getGeneratedFeatureMap()`: Generated features (no overrides)
- `getCurrentFeatureMap()`: Current features (includes overrides)
- `getOverrideFeatureMap()`: Only overridden features

**Resolution Logic**:
1. Check manual override → Use override
2. Check CPQ subscription feature → Use subscription
3. Check Product Activation Status → Use status
4. Default to Inactive

---

#### `CG_AccountFeatureMapHelper`
Generates feature maps for accounts (single or bulk).

**Key Methods**:
- `generateAccountFeaturesInstance(Id)`: Single account
- `generateAccountFeaturesMap(Set<Id>)`: Bulk accounts
- `generateFeatureMetadataString(Id, Account)`: Dynamic metadata JSON

---

#### `CG_AccountFeature`
Wrapper class for single account-feature relationship.

**Key Properties**:
- `cgFeatureId`, `sfFeatureId`, `featureName`
- `featureStatus`: 'A' or 'I'
- `featureMetadataString`: JSON
- `statusOverride`, `metadataOverride`: Override flags

---

#### `MassOverrideFeatureController`
Apex controller for Lightning Web Components.

**Methods**:
- `getInitialData(String)`: Loads accounts and features
- `getGeneratedFeatures(Id)`: Returns generated features
- `saveOverrides(String)`: Upserts overrides, triggers integration

---

#### `CG_AccountFeatureMessageHelper`
Manages integration message generation.

**Methods**:
- `generateAccountFeatureMessages(Set<Id>, Boolean)`: Creates Integration_Message__c records
- Delay: 10 minutes by default
- Process: 'Feature Framework'

---

#### `DowngradeFeatureUpdateBatch`
Batch class for processing product downgrades.

**Logic**:
1. Identifies downgraded accounts
2. Removes invalid overrides (takeaways no longer needed, giveaways on downgrade)
3. Sends notifications to Account Owners
4. Triggers integration messages

---

### Lightning Web Components

#### `massOverrideFeatureContainer`
Parent component for managing feature overrides across multiple accounts.

**Features**:
- Three tables: Generated, Activated Overrides, Deactivated Overrides
- Generate button to refresh data
- Mass override operations
- Confirmation modal integration

---

#### `massOverrideFeatureTable`
Child component displaying features in `lightning-datatable`.

**Features**:
- Table types: 'generated', 'activated', 'deactivated'
- Inline drawer for metadata editing (activated only)
- Chevron expand/collapse indicator
- Dynamic metadata field generation
- Real-time validation

**Wire Adapters** (in parent):
- `getObjectInfo`: Account, Contact, Opportunity metadata
- Determines field types dynamically

---

#### `massOverrideConfirmationModal`
Confirmation modal for bulk operations (extends `LightningModal`).

---

## Business Logic

### Feature Generation Algorithm

```
For each Account:
  1. Get features from Product Activation Status
  2. Get features from CPQ Subscriptions
     a. Aggregate "Highlight" product quantities
     b. Combine "New Car Advantage" makes
  3. Get manual overrides
  4. Build current feature map (override > subscription > status > default)
```

---

### Special Product Handling

#### Highlight Product
- **Aggregation**: Sum `SBQQ__Quantity__c` across all subscriptions
- **Reason**: Multiple subscriptions need total quantity

#### New Car Advantage
- **Combination**: Merge all `Make__c` values from Active/Pending subscriptions
- **Output**: Comma-separated makes

---

### Metadata Generation

Dynamic metadata based on `CG_Feature_Metadata__c`:

```
If Source_Object__c and Source_Field__c defined:
  1. Get field value from source
  2. Apply multiplier
  3. Format by type
  4. Add to JSON
```

**Example**:
```
Source_Object__c = "Account"
Source_Field__c = "Listings_CMRR__c"
Source_Field_Multiplier__c = 100
→ { "cmrr": 15000 }
```

---

### Country-Specific Logic

1. Get `Account.BillingCountryCode`
2. Filter junction/metadata records by country
3. Multi-country via semicolon-separated values (e.g., "US;CA")

---

## Testing

### Test Classes

#### `CG_FeatureFramework_Test`
Core framework test coverage.

**Scenarios**:
- Feature generation from subscriptions
- Feature generation from status
- Override handling
- Country-specific logic
- Integration messages
- Special products (Highlight, New Car Advantage)

---

#### `CG_FeatureFramework_TestData`
Test data factory.

**Methods**:
- `createFeatures()`: Sample features
- `createProductFeatures()`: Junction records
- `createFeatureMetadata()`: Metadata configs
- `createAccountWithSubscriptions()`: Complete setup

---

#### `DowngradeFeatureUpdateBatch_Test`
Downgrade batch test coverage.

---

### Testing Best Practices

1. **Use Test Data Factory**: `CG_FeatureFramework_TestData`
2. **Test Bulk**: 200+ records
3. **Test All Countries**: US, CA, GB
4. **Mock Callouts**: Use `HttpCalloutMock`
5. **Test Overrides**: Status only, metadata only, both, none
6. **Test Special Products**: Highlight, New Car Advantage

---

## Best Practices

### Development Guidelines

#### 1. Use Helper Methods
```apex
// ✅ Correct
Map<Id,CG_Feature__c> features = CG_FeatureHelper.getFeatureSFIdMap();

// ❌ Wrong - no caching
List<CG_Feature__c> features = [SELECT Id FROM CG_Feature__c];
```

---

#### 2. Bulk Process
```apex
// ✅ Correct
Map<Id, CG_AccountFeatureMap> maps = 
    CG_AccountFeatureMapHelper.generateAccountFeaturesMap(accountIds);

// ❌ Wrong - loop queries
for (Id accountId : accountIds) {
    CG_AccountFeatureMap map = 
        CG_AccountFeatureMapHelper.generateAccountFeaturesInstance(accountId);
}
```

---

#### 3. Respect Override Flags
```apex
cgAccountFeature.Status_Override__c = true;
cgAccountFeature.Metadata_Override__c = false; // Only status overridden
```

---

#### 4. Async Integration Messages
```apex
CG_AccountFeatureMessageHelper.generateAccountFeatureMessages(accountIds, true);
```

---

#### 5. Handle Metadata as JSON
```apex
Map<String, Object> metadata = new Map<String, Object>{'key' => 'value'};
cgAccountFeature.Metadata__c = JSON.serialize(metadata);
```

---

### Configuration Guidelines

1. **Feature Metadata**:
   - Mark `Overrideable__c = true` only if users should edit
   - `Source_Object__c` must match Salesforce API name
   - `Source_Field__c` is case-sensitive
   - `Type__c` must match actual field type

2. **Country Configuration**:
   - Use semicolon format: `US;CA;GB`
   - Test country logic thoroughly

3. **Product Linking**:
   - Link at SKU level, not family
   - Match country codes to markets

---

### Performance Optimization

1. **Minimize SOQL**: Use cached static maps
2. **Bulkify Triggers**: Process sets, not individual records
3. **Lazy Load**: Helper methods query once per transaction

---

### Security

1. **Sharing**: Helper classes are `without sharing` for data access
2. **FLS**: Ensure read access to Account, Subscription, Service Provider fields
3. **Object Permissions**:
   - Read: Feature objects
   - Create/Edit: CG_Account_Feature__c
   - Create: Integration_Message__c

---

## Troubleshooting

### Features Not Generating
1. Check `CG_Feature__c.Active__c = true`
2. Verify `CG_Product_Feature__c` junction exists
3. Confirm `Account.BillingCountryCode` matches
4. Check subscription `Provisioning_Status__c` (Active/Pending)

### Override Not Working
1. Verify override flags = true
2. Check Account__c and CG_Feature__c match
3. Confirm record not deleted
4. Query `CG_Account_Feature__c` directly

### Integration Messages Not Sending
1. Check `Integration_Controls__mdt.Enable_Feature_Map_Generation__c = true`
2. Query `Integration_Message__c` for Process = 'Feature Framework'
3. Review `Request_Status__c` and `Send_After__c`
4. Verify Account has Service_Provider__c records

### Metadata Issues
1. Validate JSON format
2. Check `CG_Feature_Metadata__c` configuration
3. Verify source field has value
4. Review multiplier calculation

---

## Additional Resources

- Jira: [CRM-5021](https://cargurus.atlassian.net/browse/CRM-5021) - Feature Framework Initiative
- Jira: [CRM-4804](https://cargurus.atlassian.net/browse/CRM-4804) - Account Feature Map
- Test Coverage: `CG_FeatureFramework_Test`, `DowngradeFeatureUpdateBatch_Test`
- Test Data Factory: `CG_FeatureFramework_TestData`

---

**Last Updated**: 2025-10-07  
**Framework Version**: 2.0  
**Maintained By**: CarGurus Enterprise Applications Team
