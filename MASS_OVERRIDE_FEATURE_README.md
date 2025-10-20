# Mass Override Feature Application

## Overview

The Mass Override Feature application is a Lightning Web Component (LWC) solution for managing CarGurus account feature overrides at scale. It enables administrators to activate or deactivate product features for multiple accounts within a parent account hierarchy, with support for complex metadata configurations and real-time validation.

The application provides a three-table interface where users can view available features, stage activation/deactivation overrides, review changes before saving, and persist overrides to both Salesforce and external systems via integration messages.

---

## Features

- **Three-Table Layout**: Separate views for Activated, Deactivated, and Available feature overrides
- **Bulk Operations**: Select and override multiple features simultaneously
- **Metadata Management**: Edit feature-specific metadata through inline drawer interface
- **Parent Account Support**: Manages overrides for all child accounts within a parent hierarchy
- **Confirmation Modal**: Preview all changes across accounts before committing
- **Current Override Display**: Real-time sidebar showing existing feature overrides per account
- **Integration Support**: Automatically generates integration messages for external systems
- **Responsive UI**: SLDS-compliant interface with proper loading states and error handling

---

## Component Structure

### 1. MassOverrideFeatureContainer (Parent Component)

**File**: `massOverrideFeatureContainer.js`

The main orchestration component that manages state, data loading, and coordination between child components.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `recordId` | String (API) | The parent Account ID for which to manage feature overrides |
| `context` | String (API) | Context identifier for navigation state |
| `displayTable` | Boolean | Controls visibility of feature tables |
| `featureList` | Array | Master list of features with override states |
| `accountMap` | Object | Map of child accounts under the parent |
| `accountFeatureMap` | Map | Features by account ID from initial data load |
| `features` | Map | Salesforce feature definitions (SF ID → Feature) |
| `showSpinner` | Boolean | Loading state indicator |

#### Key Methods

| Method | Description |
|--------|-------------|
| `loadInitialData()` | Fetches child accounts and their existing feature overrides |
| `wiredFeatures()` | Wire adapter for loading current features with metadata |
| `handleActivate()` | Moves selected features to activated state |
| `handleDeactivate()` | Moves selected features to deactivated state |
| `handleSave()` | Opens confirmation modal and saves overrides |
| `createOverrides()` | Persists feature overrides to Salesforce |
| `handleMetadataUpdate()` | Updates feature metadata from drawer edits |
| `removeFeature()` | Removes feature from activated/deactivated lists |

#### Data Flow

1. User navigates to parent Account record with `recordId`
2. `loadInitialData()` fetches child accounts and existing overrides
3. `wiredFeatures()` loads current feature state with metadata
4. Features mapped with `cgFeatureId → featureId` for compatibility
5. `preparedMetadataFields` generated for drawer display
6. User selections tracked in `featureList.selected` and `override` properties
7. Save operation builds `accountOverrideMap` for all child accounts
8. Confirmation modal displays preview
9. Apex controller persists and generates integration messages

---

### 2. MassOverrideFeatureTable (Child Component)

**File**: `massOverrideFeatureTable.js`

Reusable table component that displays features with selection capabilities and metadata editing drawers.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `tabletype` | String (API) | Table mode: 'available', 'activated', or 'deactivated' |
| `availableoverrides` | Array (API) | Features to display in this table |
| `openDrawers` | Set | Tracks which feature drawers are expanded |
| `masschecked` | Boolean | State of mass selection checkbox |

#### Computed Properties

| Property | Returns | Description |
|----------|---------|-------------|
| `tableName` | String | Display name based on table type |
| `getAvailable` | Boolean | True if table type is 'available' |
| `getActivated` | Boolean | True if table type is 'activated' |
| `processedFeatures` | Array | Features with drawer state and metadata fields |

#### Key Methods

| Method | Description |
|--------|-------------|
| `toggleDrawerVisibility()` | Expands/collapses metadata drawer for a feature |
| `handleCheckboxChange()` | Updates feature selection state |
| `handleMassCheck()` | Toggles all feature selections |
| `handleRemoveFeature()` | Fires event to remove feature from override list |
| `handleMetadataChange()` | Updates metadata field values |
| `handleDrawerSave()` | Validates and saves metadata changes |

#### Table Modes

**Available Mode** (`tabletype="available"`)
- Shows features available for override
- Displays mass selection checkbox
- No metadata editing (drawer hidden)
- Checkbox selection for bulk operations

**Activated Mode** (`tabletype="activated"`)
- Shows features staged for activation
- Displays "Edit Metadata" button when metadata exists
- Inline drawer for metadata editing
- Remove button to unstage feature

**Deactivated Mode** (`tabletype="deactivated"`)
- Shows features staged for deactivation
- No metadata editing
- Remove button to unstage feature

#### Metadata Drawer

The inline drawer expands below a feature row when "Edit Metadata" is clicked:

- **Field Types Supported**: Boolean (checkbox), Text (input), Number (input), Picklist (combobox)
- **Validation**: Required fields enforced before save
- **Error Handling**: Displays field-level errors for wire adapter failures
- **Dynamic Fields**: Generated from `preparedMetadataFields` in parent
- **Source Field Display**: Shows source object/field when available

---

### 3. MassOverrideConfirmationModal (Modal Component)

**File**: `massOverrideConfirmationModal.js`

Lightning modal that displays a preview of all feature override changes before saving.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `overrideMap` | Map (API) | Account Name → Array of CG_Account_Feature__c records |
| `featureMap` | Map (API) | Feature ID → Feature details for display names |
| `sfFeatureMap` | Map (API) | Salesforce Feature ID → CG_Feature__c records |
| `accordionData` | Array | Processed data for accordion display |

#### Display Structure

```
Account Name
  └─ Activate
      └─ Feature 1 (ID: 123)
          └─ Metadata: key1: value1, key2: value2
      └─ Feature 2 (ID: 456)
  └─ Deactivate
      └─ Feature 3 (ID: 789)
```

#### Sorting Logic

1. Accounts sorted alphabetically by name
2. Within each account, overrides grouped by Status (A before I)
3. Features within same status sorted by CG Feature ID

#### Actions

- **Cancel**: Closes modal without saving (`this.close()`)
- **Confirm**: Closes modal and returns `true` to parent (`this.close(true)`)

---

## Apex Controller

### MassOverrideFeatureController.cls

Central Apex controller providing data access and persistence for the LWC components.

#### Methods

##### `getInitialData(String recordId)`

**@AuraEnabled**

Returns initial data for parent account hierarchy.

**Parameters:**
- `recordId`: Parent Account ID

**Returns:**
```apex
{
    'features': Map<Id, CG_Feature__c>,           // All feature definitions
    'accountMap': Map<Id, Account>,                // Child accounts with existing overrides
    'accountFeatureMap': Map<Id, List<FeatureDTO>> // Current features by account
}
```

**Logic:**
1. Fetches all CG_Feature__c records via helper
2. Queries child Accounts where `ParentId` or `Ultimate_Parent_Account__c` equals recordId
3. Includes `CG_Account_Features__r` with `Status_Override__c = true`
4. Generates feature maps for each account via `CG_AccountFeatureMapHelper`
5. Converts `CG_AccountFeature` objects to `AccountFeatureDTO.FeatureDTO`

##### `getCurrentFeatures(Id accountId)`

**@AuraEnabled(cacheable=true)**

Retrieves current feature state for a single account, including metadata.

**Parameters:**
- `accountId`: Account ID to retrieve features for

**Returns:**
- `List<AccountFeatureDTO.FeatureDTO>`: Sorted list of features with metadata

**Logic:**
1. Calls `CG_AccountFeatureMapHelper.generateAccountFeaturesInstance(accountId)`
2. Retrieves `getCurrentFeatureMap()` (includes generated + overrides)
3. Converts each `CG_AccountFeature` to `AccountFeatureDTO.FeatureDTO`
4. Sorts by `cgFeatureId` using `FeatureDTOComparator`

**Note**: Uses `getCurrentFeatureMap()` instead of `getGeneratedFeatureMap()` to support single-store contexts.

##### `saveOverrides(String featuresToOverrideStr)`

**@AuraEnabled**

Persists feature overrides to Salesforce and generates integration messages.

**Parameters:**
- `featuresToOverrideStr`: JSON string of `List<CG_Account_Feature__c>` records

**Returns:**
- `List<CG_Account_Feature__c>`: Saved override records with IDs

**Logic:**
1. Deserializes JSON string to `List<CG_Account_Feature__c>`
2. Collects affected account IDs
3. Upserts feature override records
4. Calls `CG_AccountFeatureMessageHelper.generateAccountFeatureMessages()` for integration
5. Returns saved records with Salesforce IDs

**Error Handling:**
- Throws `AuraHandledException` on failures
- All operations within try-catch block

---

## Data Transfer Objects (DTOs)

### AccountFeatureDTO.FeatureDTO

**File**: `AccountFeatureDTO.cls`

Standardized data structure for transferring feature data between Apex and LWC.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `accountId` | Id | Account this feature belongs to |
| `sfFeatureId` | Id | Salesforce CG_Feature__c record ID |
| `overrideRecordId` | Id | CG_Account_Feature__c record ID (if override exists) |
| `cgFeatureId` | Integer | CarGurus feature ID |
| `featureStatus` | String | Current status ('A' or 'I') |
| `featureName` | String | Feature display name |
| `metadataString` | String | JSON string of metadata |
| `statusOverride` | Boolean | True if status has been overridden |
| `metadataOverride` | Boolean | True if metadata has been overridden |
| `hasMetadata` | Boolean | True if feature has metadata definitions |
| `metadata` | List<FeatureMetadataDTO> | Parsed metadata field definitions |

#### Constructor

```apex
public FeatureDTO(CG_AccountFeature feature)
```

**Processing:**
1. Maps core properties from `CG_AccountFeature`
2. Looks up feature metadata definitions via `CG_FeatureHelper`
3. Converts `CG_Feature_Metadata__c` records to `FeatureMetadataDTO` objects
4. Sets `hasMetadata` based on metadata presence

### AccountFeatureDTO.FeatureMetadataDTO

Represents a single metadata field definition.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `key` | String | Metadata field key/name |
| `value` | String | Current metadata value |
| `type` | String | Field type (Boolean, Text, Picklist, etc.) |
| `sourceObject` | String | Salesforce object containing source data |
| `sourceField` | String | Field on source object |
| `sourceFieldMultiplier` | Decimal | Multiplier for numeric source fields |
| `isOverrideable` | Boolean | Whether this field can be manually overridden |

---

## Technical Details

### Wire Adapters

The application uses two wire adapters in the container component:

#### 1. CurrentPageReference

```javascript
@wire(CurrentPageReference)
wiredGetStateParameters(currentPageReference)
```

**Purpose**: Captures navigation state parameters from URL

**Usage**: Extracts `c__recordId` and `c__context` from page state when navigating from other components

#### 2. getCurrentFeatures

```javascript
@wire(getCurrentFeatures, { accountId: '$recordId' })
wiredFeatures({ error, data })
```

**Purpose**: Loads current feature state with metadata (cacheable)

**Processing**:
- Spreads all DTO properties into feature list
- Maps `cgFeatureId → featureId` for backward compatibility
- Processes metadata into `preparedMetadataFields` for drawer
- Handles field types (Boolean, Text, Picklist)
- Sets initial UI state (selected, override, first)

### Event Communication

#### Parent → Child (Properties)

| Event | Component | Property | Description |
|-------|-----------|----------|-------------|
| Data Binding | MassOverrideFeatureTable | `availableoverrides` | Feature data array |
| Data Binding | MassOverrideFeatureTable | `tabletype` | Table mode configuration |

#### Child → Parent (Custom Events)

| Event | Component | Detail | Description |
|-------|-----------|--------|-------------|
| `fieldcheck` | MassOverrideFeatureTable | `{ rowId, isChecked, massSelection }` | Feature selection changed |
| `removefeature` | MassOverrideFeatureTable | `{ featureId }` | Remove feature from override list |
| `metadataupdate` | MassOverrideFeatureTable | `{ featureId, metadataChanges, allMetadata }` | Metadata values updated |

### Metadata Processing Flow

1. **Apex**: `CG_Feature_Metadata__c` records queried via `CG_FeatureHelper`
2. **DTO**: Converted to `FeatureMetadataDTO` with all properties
3. **Wire Adapter**: LWC receives `metadata` array in `FeatureDTO`
4. **Container**: Maps to `preparedMetadataFields` with UI properties:
   - `id`: Unique field identifier for input binding
   - `isBoolean`, `isText`, `isPicklist`: Type flags for conditional rendering
   - `disabled`: Based on `isOverrideable`
   - `options`: Picklist options (if applicable)
5. **Table**: Accesses via `feature.preparedMetadataFields`
6. **Drawer**: Renders appropriate input components per field type
7. **Update**: Changes flow back via `metadataupdate` event
8. **Save**: Updated values included in `CG_Account_Feature__c.Metadata__c` JSON

---

## Integration Points

### CG_AccountFeatureMap

The core feature calculation engine that determines which features should be active for an account.

**Used By**: `getCurrentFeatures()` method

**Methods**:
- `getCurrentFeatureMap()`: Returns current effective features (generated + overrides)
- `getGeneratedFeatureMap()`: Returns features based solely on subscriptions/rules

### CG_AccountFeatureMapHelper

Helper class for generating feature maps at scale.

**Methods Used**:
- `generateAccountFeaturesInstance(Id accountId)`: Creates single account feature map
- `generateAccountFeaturesMap(Set<Id> accountIds)`: Bulk feature map generation

### CG_FeatureHelper

Centralized helper for feature metadata and definitions.

**Methods Used**:
- `getFeatureSFIdMap()`: Returns all CG_Feature__c records by ID
- `getFeatureCGIdSFIdMap()`: Maps CarGurus feature IDs to Salesforce IDs

### CG_AccountFeatureMessageHelper

Generates integration messages for external systems.

**Usage**: Called after saving overrides to notify downstream systems

**Method**: `generateAccountFeatureMessages(Set<Id> accountIds, Boolean sendNow)`

---

## UI/UX Elements

### Layout Structure

```
┌─────────────────────────────────────────────────────────────┐
│  [Cancel]  [Save]                                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐ │
│  │ Activated       │  │ Deactivated     │  │ Current    │ │
│  │ Overrides       │  │ Overrides       │  │ Overrides  │ │
│  │                 │  │                 │  │            │ │
│  │ ☑ Feature 1     │  │ ☑ Feature 3     │  │ Account A  │ │
│  │   [Edit] [X]    │  │   [X]           │  │  Activated │ │
│  │                 │  │                 │  │   - Feat 5 │ │
│  │ ☑ Feature 2     │  │                 │  │            │ │
│  │   [X]           │  │                 │  │ Account B  │ │
│  │                 │  │                 │  │  ...       │ │
│  └─────────────────┘  └─────────────────┘  └────────────┘ │
│                                                             │
│            [Activate]  [Deactivate]                         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│  Available Product Feature Overrides                        │
│  ☑ Mass Select                                              │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ ☐ Feature 4 - Display Inventory                      │  │
│  │ ☐ Feature 6 - Analytics Dashboard                    │  │
│  │ ☐ Feature 7 - Custom Reporting                       │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Inline Drawer (Activated Table)

When "Edit Metadata" is clicked, drawer expands below feature row:

```
┌─────────────────────────────────────────────┐
│ ☑ Feature Name          [Edit] [X]          │
├─────────────────────────────────────────────┤
│ Edit Feature Metadata                       │
│                                             │
│ Field 1 (Boolean)      ☐                   │
│ Field 2 (Text)         [_____________]     │
│ Field 3 (Number)       [_____]             │
│                                             │
│ Source: Account.Custom_Field__c            │
│                                             │
│              [Cancel]  [Save Metadata]     │
└─────────────────────────────────────────────┘
```

### SLDS Styling

- **Tables**: Custom tables with SLDS box styling
- **Buttons**: 
  - Primary actions: `variant="brand"`
  - Activate: `variant="success"`
  - Deactivate: `variant="destructive"`
  - Cancel/Remove: `variant="neutral"`
- **Loading**: `lightning-spinner` with backdrop overlay
- **Icons**: `utility:chevronright` for accordion toggles
- **Spacing**: Consistent `slds-m-*` and `slds-p-*` classes

---

## Error Handling

### Apex-Level Errors

- **Try-Catch**: All Apex methods wrapped in error handling
- **AuraHandledException**: Used for user-facing error messages
- **Null Checks**: Validates data before processing

### LWC-Level Errors

- **Wire Adapter Errors**: Caught in `wiredFeatures()` error handler
- **Toast Notifications**: User-friendly error messages via `ShowToastEvent`
- **Console Logging**: Detailed errors logged for debugging
- **Validation**: Required field checks before saving metadata

### Common Error Scenarios

| Error | Handling |
|-------|----------|
| Missing recordId | Early return in `loadInitialData()` |
| No features found | Returns empty array, displays empty table |
| Wire adapter failure | Toast message + console error |
| Save failure | Toast with error message from Apex |
| Invalid metadata | Field-level validation before save |
| No overrides to save | Info toast, no server call |

---

## Usage Example

### Navigation from Account Record

```javascript
// From a parent Account record page
this[NavigationMixin.Navigate]({
    type: 'standard__component',
    attributes: {
        componentName: 'c__massOverrideFeatureContainer'
    },
    state: {
        c__recordId: this.accountId,
        c__context: 'parentAccount'
    }
});
```

### Typical User Workflow

1. **Navigate** to parent Account record
2. **Launch** Mass Override Feature component
3. **Review** available features in bottom table
4. **Select** features to activate/deactivate (checkbox)
5. **Click** "Activate" or "Deactivate" button
6. **Verify** features moved to top tables
7. **Edit Metadata** (if needed) by clicking "Edit Metadata" button
8. **Modify** metadata values in drawer
9. **Save Metadata** to close drawer
10. **Review** Current Overrides sidebar to see existing overrides
11. **Click** "Save" to open confirmation modal
12. **Review** all changes in modal accordion
13. **Confirm** to persist overrides
14. **Redirect** back to parent Account record

### Account Feature Override Record Structure

When saved, each override creates/updates a `CG_Account_Feature__c` record:

```javascript
{
    Id: '(existing override ID or null)',
    Account__c: '(child account ID)',
    CG_Feature__c: '(Salesforce feature ID)',
    Status_Override__c: true,
    Status__c: 'A', // or 'I'
    Metadata_Override__c: true, // if metadata edited
    Metadata__c: '{"key1":"value1","key2":"value2"}' // JSON string
}
```

---

## Performance Considerations

### Bulkification

- **Apex Queries**: Single SOQL query for all child accounts
- **Feature Map Generation**: Bulk helper methods for multiple accounts
- **Upsert Operations**: Single DML operation for all overrides
- **Integration Messages**: Batched generation per account set

### Caching

- **Wire Adapter**: `getCurrentFeatures()` marked as cacheable
- **Feature Maps**: `features` and `sfFeatureMap` cached in component state
- **Processed Features**: Computed properties for reactive updates

### Limitations

- **Account Hierarchy Depth**: Supports 2-level hierarchy (Parent → Children)
- **Feature Count**: UI tested with up to 100 features per account
- **Child Account Limit**: Recommended maximum of 50 child accounts
- **Metadata Fields**: Supports up to 20 metadata fields per feature

---

## Future Enhancements

### Planned for Single-Store Context Support

The application is currently designed for parent account (multi-store) contexts. Planned enhancements include:

1. **Context Detection**: Automatically detect single-store vs. multi-store context
2. **Simplified UI**: Hide account-level accordion for single-store
3. **Direct Feature Management**: Manage features for single account directly
4. **Filter Options**: Add filtering by feature type/category
5. **Search**: Feature name search functionality
6. **Bulk Metadata Editing**: Edit same metadata field across multiple features

### Technical Improvements

- **Picklist Support**: Complete implementation of picklist metadata fields
- **Field Dependencies**: Support dependent metadata fields
- **Validation Rules**: Custom validation rules per feature type
- **Audit Trail**: Comprehensive change tracking and history
- **Export**: Export override configurations as CSV/Excel

---

## Dependencies

### Salesforce Objects

- `Account`: Parent and child account records
- `CG_Feature__c`: Feature definitions
- `CG_Feature_Metadata__c`: Metadata field definitions
- `CG_Account_Feature__c`: Override records
- `CPQ_Subscription__c`: Subscription data for feature generation
- `Integration_Message__c`: External system integration

### Apex Classes

- `MassOverrideFeatureController`: Main controller
- `AccountFeatureDTO`: Data transfer object
- `CG_AccountFeatureMap`: Feature calculation engine
- `CG_AccountFeatureMapHelper`: Bulk processing helper
- `CG_FeatureHelper`: Feature metadata helper
- `CG_AccountFeature`: Feature wrapper class
- `CG_AccountFeatureMessageHelper`: Integration message generator

### Lightning Web Components

- `massOverrideFeatureContainer`: Parent container
- `massOverrideFeatureTable`: Reusable table component
- `massOverrideConfirmationModal`: Confirmation modal

### Platform Features

- Lightning Navigation Service
- Lightning Modal Service
- Lightning Data Service (wire adapters)
- Salesforce Lightning Design System (SLDS)

---

## Testing Recommendations

### Unit Testing

- **Apex Controller**: Test each @AuraEnabled method with bulk data
- **Data Processing**: Verify DTO conversion accuracy
- **Error Scenarios**: Test null inputs and invalid data
- **Integration**: Mock `CG_AccountFeatureMessageHelper` calls

### Integration Testing

- **Feature Calculation**: Verify `getCurrentFeatureMap()` accuracy
- **Save Flow**: End-to-end override creation and update
- **Metadata Processing**: Test all field types
- **Multiple Accounts**: Test with various account hierarchies

### UI Testing

- **Component Loading**: Verify wire adapter data flow
- **User Interactions**: Test all button clicks and selections
- **Drawer Functionality**: Test metadata editing for each field type
- **Modal Display**: Verify confirmation modal data accuracy
- **Error Handling**: Test toast messages for error scenarios

### Test Data Requirements

- Parent account with 5-10 child accounts
- 20-30 active features with various metadata configurations
- Existing overrides for some accounts
- Features with boolean, text, and number metadata fields

---

## Troubleshooting

### Common Issues

**Issue**: Features not loading
- **Check**: Wire adapter error in browser console
- **Verify**: Account has child accounts or is correct record type
- **Solution**: Ensure `recordId` is valid parent account

**Issue**: Metadata drawer not opening
- **Check**: Feature has `hasMetadata = true`
- **Verify**: `preparedMetadataFields` array has items
- **Solution**: Check feature metadata definitions in `CG_Feature_Metadata__c`

**Issue**: Save operation fails
- **Check**: Browser console for Apex error message
- **Verify**: User has edit permission on `CG_Account_Feature__c`
- **Solution**: Check field-level security and validation rules

**Issue**: Integration messages not created
- **Check**: `CG_AccountFeatureMessageHelper` logs
- **Verify**: Account IDs collected correctly
- **Solution**: Ensure helper method executes after upsert

---

## Maintenance

### Code Owners

- **Component**: Vlad Nov (vladnov)
- **Controller**: Sam Brown (sabrown@cargurus.com), Andrii Znak
- **Last Updated**: September 29, 2025

### Version History

- **v1.0** (Sept 2025): Initial implementation with multi-store support
- **v1.1** (Sept 2025): Added metadata drawer functionality
- **v1.2** (Sept 2025): Refactored to use `AccountFeatureDTO.FeatureDTO`
- **v1.3** (Oct 2025): Updated to use `getCurrentFeatures` for single-store support

---

## Related Documentation

- [Product Feature Framework README](./PRODUCT_FEATURE_FRAMEWORK_README.md)
- [CG_AccountFeatureMap Documentation](./docs/CG_AccountFeatureMap.md)
- [Feature Override Integration Guide](./docs/FeatureOverrideIntegration.md)
- [Lightning Web Components Developer Guide](https://developer.salesforce.com/docs/component-library/documentation/en/lwc)
