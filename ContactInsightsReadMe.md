# Contact Insights Table - Component Documentation

## Overview
The Contact Insights Table is a Lightning Web Component that displays contact behavioral and demographic scores from Snowflake data models on the Account record page. It provides sortable columns, score-based filtering, and an intuitive slider interface for data exploration.

## Features
- **Dual Data Source Integration**: Pulls insights from both `Contact_Insights__c` and `ACR_Insights__c` objects
- **Smart Contact Matching**: Matches contacts to accounts via direct Contact relationship and AccountContactRelation records
- **Score Filtering**: Interactive slider to filter contacts by average score threshold (0-100)
- **Sortable Columns**: Click any column header to sort ascending/descending
- **Default Sorting**: Automatically sorts by average score (highest first)
- **Contact Navigation**: Click contact name to navigate to full contact record
- **Responsive Design**: SLDS-compliant styling with empty states and loading indicators

---

## Component Structure

### Files Created
```
force-app/main/default/
├── classes/
│   ├── ContactInsightsController.cls
│   ├── ContactInsightsController.cls-meta.xml
│   ├── ContactInsightsControllerTest.cls
│   └── ContactInsightsControllerTest.cls-meta.xml
└── lwc/
    └── contactInsightsTable/
        ├── contactInsightsTable.html
        ├── contactInsightsTable.js
        ├── contactInsightsTable.css
        └── contactInsightsTable.js-meta.xml
```

### Properties
| Property | Type | Description |
|----------|------|-------------|
| `recordId` | Id | Account record ID (automatically provided by Lightning page) |
| `allData` | Array | Complete dataset from Apex controller |
| `filteredData` | Array | Filtered dataset based on slider threshold |
| `filterValue` | Number | Current filter threshold (0-100) |
| `sortedBy` | String | Current sort column field name |
| `sortDirection` | String | Current sort direction ('asc' or 'desc') |

---

## Technical Details

### Apex Controller: `ContactInsightsController`

#### Method: `getContactInsights(Id accountId)`
**@AuraEnabled** method that retrieves and merges contact insight data.

**Logic Flow:**
1. Query all Contacts related to the Account
2. Query all AccountContactRelations for the Account
3. Query `Contact_Insights__c` records by ContactId
4. Query `ACR_Insights__c` records by ACRId
5. Build unified wrapper list with merged data
6. Calculate average score: `(Behavioral_Score + Demographic_Score) / 2`
7. Return `ContactInsightWrapper[]`

**Wrapper Class Properties:**
```apex
public class ContactInsightWrapper {
    @AuraEnabled public Id contactId;
    @AuraEnabled public String contactName;
    @AuraEnabled public String email;
    @AuraEnabled public String phone;
    @AuraEnabled public String title;
    @AuraEnabled public String acrRole;
    @AuraEnabled public Decimal behavioralScore;
    @AuraEnabled public Decimal demographicScore;
    @AuraEnabled public Decimal averageScore;
    @AuraEnabled public String source; // 'Contact_Insights', 'ACR_Insights', or 'Both'
}
```

### Data Objects Required

#### Custom Objects (or External Objects)
The component expects two objects with these field structures:

**Contact_Insights__c** (or `Contact_Insights__x` for external):
- `ContactId__c` - Lookup to Contact
- `Behavioral_Score__c` - Number (decimal)
- `Demographic_Score__c` - Number (decimal)

**ACR_Insights__c** (or `ACR_Insights__x` for external):
- `ACRId__c` - Lookup to AccountContactRelation
- `Behavioral_Score__c` - Number (decimal)
- `Demographic_Score__c` - Number (decimal)

---

## UI Elements

### Data Table Columns
| Column | Field | Type | Sortable |
|--------|-------|------|----------|
| Name | contactName | URL (navigable link) | Yes |
| Email | email | Email | Yes |
| Phone | phone | Phone | Yes |
| Title | title | Text | Yes |
| ACR Role | acrRole | Text | Yes |
| Behavioral Score | behavioralScore | Number | Yes |
| Demographic Score | demographicScore | Number | Yes |
| Average Score | averageScore | Number | Yes (default) |

### Filter Controls
- **Score Slider**: Horizontal range input (0-100)
  - Visual gradient: Red (0) → Yellow (50) → Green (100)
  - Displays current threshold value
  - Filters contacts with `averageScore >= filterValue`
  - Real-time filtering on change

### State Management
- **Loading State**: Spinner while fetching data
- **Empty State**: Icon + message when no contacts with scores exist
- **Error State**: Alert banner with error message
- **Data State**: Displays filtered table with row numbers

---

## Feature Details

### Sorting
- **Default**: Average Score (Descending)
- **Mechanism**: Client-side sorting in JavaScript
- **Behavior**: Click column header to toggle asc/desc
- **Implementation**: `handleSort()` method processes `lightning-datatable` sort events

### Filtering
- **Type**: Minimum threshold filter
- **Range**: 0-100
- **Default**: 0 (show all contacts)
- **Logic**: Filters `allData` to show only contacts where `averageScore >= filterValue`
- **Persistence**: Filter persists across sorts

### Contact Navigation
- **Type**: Lightning navigation URL
- **Format**: `/lightning/r/Contact/{contactId}/view`
- **Target**: Opens in new tab (`_blank`)
- **Implementation**: Uses `NavigationMixin` for proper Lightning Experience routing

### Duplicate Contact Handling (TODO)
When a contact appears in both `Contact_Insights__c` and `ACR_Insights__c`:
- **Current Behavior**: Adds ACR role to existing record from Contact_Insights
- **Source Field**: Set to 'Both' for debugging
- **Future Enhancement**: Team needs to decide merge strategy for scores

---

## Installation & Deployment

### Step 1: Create Custom Objects
Before deploying the component, create these objects in your org (or configure as External Objects):

```bash
# Using Salesforce CLI (placeholder - actual object creation may vary)
sf data create record -s Contact_Insights__c -v "Name='Test' ContactId__c='003...' Behavioral_Score__c=85 Demographic_Score__c=90"
```

### Step 2: Deploy Component
```bash
# Deploy to your org
sf project deploy start -d force-app/main/default/classes/ContactInsightsController.cls
sf project deploy start -d force-app/main/default/classes/ContactInsightsControllerTest.cls
sf project deploy start -d force-app/main/default/lwc/contactInsightsTable
```

### Step 3: Add to Account Page
1. Navigate to any Account record
2. Click **Setup** (gear icon) → **Edit Page**
3. Drag **Contact Insights Table** component onto the page
4. Save and activate the page

### Step 4: Assign Permissions
Ensure users have read access to:
- `Contact_Insights__c` (or External Object)
- `ACR_Insights__c` (or External Object)
- Contact object
- AccountContactRelation object
- Account object

---

## Best Practices

### Implementation
- **Error Handling**: Component catches and displays Apex errors gracefully
- **Bulkification**: Apex controller queries are bulkified for multiple records
- **Security**: Uses `with sharing` to respect org security model
- **Null Safety**: Handles null/empty data at all levels

### Performance
- **Query Optimization**: Single SOQL queries per object type
- **Client-Side Filtering**: No server round-trips for filter changes
- **Lazy Loading**: Data loaded once on component initialization
- **Efficient Sorting**: JSON parse/sort pattern for immutable data

### Error Handling
```javascript
// Example error handling in JS
.catch(error => {
    this.error = error.body?.message || error.message || 'Unknown error';
    console.error('Error loading contact insights:', error);
    this.isLoading = false;
});
```

---

## Usage Examples

### Basic Usage
Add component to Account Lightning page via App Builder:
```xml
<!-- Component is configured via metadata, no additional configuration needed -->
<contactInsightsTable></contactInsightsTable>
```

### Testing Apex Controller
```apex
// Example test scenario
Account acc = new Account(Name = 'Test Account');
insert acc;

Contact con = new Contact(FirstName = 'John', LastName = 'Doe', AccountId = acc.Id);
insert con;

Contact_Insights__c insight = new Contact_Insights__c(
    ContactId__c = con.Id,
    Behavioral_Score__c = 85,
    Demographic_Score__c = 92
);
insert insight;

// Call controller
List<ContactInsightsController.ContactInsightWrapper> results = 
    ContactInsightsController.getContactInsights(acc.Id);

// Verify average score calculation
System.assertEquals(88.5, results[0].averageScore);
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| "Account ID is required" | Null recordId passed | Ensure component is on Account page |
| "No Contact Insights Available" | No insight records | Insert test data into insight objects |
| SOQL errors | Object/field doesn't exist | Create custom objects with correct API names |
| FLS errors | User lacks field access | Grant read permissions via Profile/Permission Set |

### Troubleshooting
1. **Open Browser Console**: Check for JavaScript errors
2. **Check Debug Logs**: Review Apex logs for SOQL/DML errors
3. **Verify Data**: Query insight objects directly to confirm records exist
4. **Test Apex Directly**: Use Execute Anonymous to test `getContactInsights()` method

---

## Configuration Notes

### Switching from Custom Objects to External Objects
To use External Objects instead of Custom Objects:

1. **Update Apex Controller** (2 locations):
```apex
// Change from:
FROM Contact_Insights__c
// To:
FROM Contact_Insights__x

// Change from:
FROM ACR_Insights__c
// To:
FROM ACR_Insights__x
```

2. **Update Field API Names** if different in external system
3. **Update Test Class** to use External Objects or mock data
4. **Redeploy** component files

### Score Thresholds (TODO)
To add visual indicators for good/bad scores:
1. Define thresholds (e.g., Good >= 70, Medium 40-69, Poor < 40)
2. Add CSS classes for color coding
3. Update `columns` definition with `cellAttributes` for conditional formatting

---

## TODOs (Pending Team Decisions)

### 1. Duplicate Contact Handling
**Location**: `ContactInsightsController.cls` (line ~90)

**Current Behavior**: When contact appears in both insight sources, merges data by adding ACR role to Contact_Insights record.

**Decision Needed**: How to handle duplicate scores?
- **Option A**: Average the scores from both sources
- **Option B**: Prioritize one source (Contact_Insights or ACR_Insights)
- **Option C**: Show as separate rows
- **Option D**: Use highest/lowest scores

**Impact**: Affects average score calculation and display logic.

---

### 2. Score Threshold Definitions
**Location**: Future enhancement in CSS and JS

**Current State**: No visual indicators for score quality.

**Decision Needed**: Define thresholds for color-coding or badges:
- What score range = "Good"?
- What score range = "Medium"?
- What score range = "Poor"?

**Example Implementation**:
```javascript
// Add to columns definition
cellAttributes: { 
    class: { 
        fieldName: 'scoreClass' // Computed in Apex based on thresholds
    } 
}
```

---

## Clean-up

### Removing the Component
```bash
# Delete component files
sf project delete source -p force-app/main/default/lwc/contactInsightsTable
sf project delete source -p force-app/main/default/classes/ContactInsightsController.cls
sf project delete source -p force-app/main/default/classes/ContactInsightsControllerTest.cls
```

### Data Cleanup
```apex
// Delete test insight records
delete [SELECT Id FROM Contact_Insights__c];
delete [SELECT Id FROM ACR_Insights__c];
```

---

## Version History
- **v1.0** - Initial POC implementation with placeholder object names
- Future: Migration to External Objects (pending team decision)

---

## Support & Contact
For questions or issues with this component, contact the development team or refer to the inline TODOs in the code for pending decisions.
