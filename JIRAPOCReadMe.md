# JIRA Ticket Live Updates LWC - POC Plan

## Project Overview
Lightning Web Component that displays real-time updates from JIRA tickets within Salesforce.

---

## 🎯 Desired Features (Add Your Requirements Below)
<!-- Add any extra features we think of here -->

- [ ] Feature 1: 

---

## 📋 Implementation Summary

### ✅ What We Have
- **Named Credential:** `JIRA_API` already configured and working
- **Wrapper Class:** `JiraTicketWrapper.cls` for parsing JIRA responses
- **Pattern:** `Batch_UpdateTickerTape.cls` as reference implementation
- **API Endpoint:** `/rest/api/3/search/jql` (JIRA Cloud REST API v3)

### ✅ Decisions Made
- **Auth:** Reuse existing Named Credential pattern
- **Storage:** Pure API calls (no local storage to save space)
- **Updates:** JavaScript polling for POC
- **Filters:** Default filters first, custom JQL later
- **Scope:** TBD tomorrow (base structure supports any scope)

### 🎯 Next Steps (Today)
1. Build base structure components
2. Create `JiraDashboardController.cls` (wrapper around API)
3. Create `jiraTicketDashboard` LWC skeleton
4. Wire up authentication using existing pattern
5. Test basic connectivity

---

## 🔄 Reusable Patterns from TickerTape

We can leverage the existing JIRA integration patterns from `Batch_UpdateTickerTape.cls`:

### Authentication Pattern
```apex
// Use existing Named Credential (line 54)
private String namedCredentialName = 'JIRA_API';

// Build callout (lines 167-172)
HttpRequest req = new HttpRequest();
String encodedJql = EncodingUtil.urlEncode(jql, 'UTF-8');
String endpoint = 'callout:' + namedCredentialName + '/rest/api/3/search/jql?jql=' + encodedJql;
req.setEndpoint(endpoint);
req.setMethod('GET');
req.setTimeout(120000);
```

### Custom Metadata Configuration Pattern
- `TickerTape_Settings__mdt` - Stores configuration
- We can create `JIRA_Dashboard_Settings__mdt` for our component

### Response Parsing Pattern ✅
- **`JiraTicketWrapper.cls`** - Already exists and parses JIRA JSON responses!
  - Handles: `issues`, `fields`, `summary`, `description`, `assignee`, `priority`, `status`, `fixVersions`
  - Helper methods: `getImpactAreaString()`, `getBusinessValue()`, `getDescription()`
  - Fully tested with `JiraTicketWrapperTest.cls`
- **We can reuse this directly** - No need to rebuild parsing logic!

---

## Architecture Components

### 1. Backend (Apex)

#### JiraApiService.cls
Core JIRA REST API integration
- Authentication handling (OAuth 2.0 or API token)
- HTTP callout methods for ticket queries
- Response parsing and data transformation
- Error handling and retry logic

#### JiraTicketController.cls
LWC controller for data exposure
- `@AuraEnabled` methods for LWC consumption
- Query builder for filtered ticket retrieval
- Cacheable methods for performance
- Error handling and logging

#### JiraTicketBatch.cls (Optional)
Scheduled batch job for periodic sync
- Sync JIRA data to custom objects
- Update tracking for change detection
- Scheduled execution configuration

---

### 2. Frontend (LWC)

#### jiraTicketDashboard
Main component for ticket display
- **HTML Template**
  - lightning-datatable for ticket list
  - Filter controls (status, assignee, project)
  - Search input
  - Refresh button
  - Loading spinner
  
- **JavaScript Controller**
  - Wire service for initial data load
  - Imperative Apex calls for refresh
  - Polling mechanism for live updates
  - State management for filters
  
- **CSS Styling**
  - Status color coding
  - Priority indicators
  - Responsive layout
  - Custom SLDS styling

---

### 3. Data Model

#### JIRA_Ticket__c (Custom Object - Optional)
Cache JIRA data locally for performance
- `Ticket_Key__c` (External ID, Unique)
- `Summary__c` (Text)
- `Status__c` (Picklist)
- `Assignee__c` (Text)
- `Assignee_Email__c` (Email)
- `Priority__c` (Picklist)
- `Type__c` (Text)
- `Project__c` (Text)
- `Last_Updated__c` (DateTime)
- `JIRA_URL__c` (URL)
- `Description__c` (Long Text Area)

#### JIRA_Configuration__c (Custom Metadata Type)
Store JIRA instance configuration
- `JIRA_Instance_URL__c` (URL)
- `Default_Project_Keys__c` (Text)
- `Default_JQL_Filter__c` (Text Area)
- `Refresh_Interval_Seconds__c` (Number)
- `API_Version__c` (Text)

---

### 4. Integration Layer

#### Named Credential
- Name: `JIRA_API`
- URL: `https://{instance}.atlassian.net`
- Authentication: Named Principal / Per User
- Identity Type: Named Principal (for POC)

#### Remote Site Settings
- URL: `https://*.atlassian.net`

#### Platform Events (Optional - Phase 4)
- `JIRA_Update__e` - Push notifications for real-time updates
  - `Ticket_Key__c` (Text)
  - `Update_Type__c` (Text) - New, Updated, Deleted
  - `Timestamp__c` (DateTime)

---

## Implementation Phases

### ✅ Phase 1: Setup & Authentication (Day 1)
**Status:** Not Started

**Tasks:**
- [ ] Create Named Credential for JIRA API
- [ ] Add Remote Site Settings for JIRA instance
- [ ] Create JIRA_Configuration__c custom metadata type
- [ ] Build JiraApiService with basic authentication test
- [ ] Test API connection with `GET /myself`

**Deliverable:** Working JIRA API connection from Salesforce

---

### ✅ Phase 2: Core API Integration (Day 2)
**Status:** Not Started

**Tasks:**
- [ ] Implement JiraApiService methods:
  - `getTickets(String jql)` - Query tickets using JQL
  - `getTicketDetails(String ticketKey)` - Get single ticket
  - `getTicketComments(String ticketKey)` - Fetch comments
  - `parseJiraResponse(String jsonResponse)` - Parse API response
- [ ] Create JiraTicketController with @AuraEnabled methods
- [ ] Add error handling and governor limit considerations
- [ ] Write unit tests for API service (mock callouts)
- [ ] Test with various JQL queries

**Deliverable:** Apex classes that successfully retrieve JIRA tickets

---

### ✅ Phase 3: LWC Component (Day 3-4)
**Status:** Not Started

**Tasks:**
- [ ] Create component bundle: jiraTicketDashboard
- [ ] Build HTML template:
  - lightning-datatable for tickets
  - Filter controls (status, assignee, project)
  - Search bar
  - Manual refresh button
  - Loading spinner
- [ ] Implement JavaScript controller:
  - Wire Apex methods for initial load
  - Handle user interactions (filter, search, refresh)
  - Data transformation for datatable
  - Error handling with toast messages
- [ ] Add CSS styling:
  - Status badge colors
  - Priority icons
  - Responsive layout
- [ ] Test component in Salesforce org

**Deliverable:** Functional LWC displaying JIRA tickets

---

### ✅ Phase 4: Real-time Updates (Day 5)
**Status:** Not Started

**Option A: Polling (Simpler for POC)**
- [ ] Implement JavaScript polling with setInterval
- [ ] Configurable refresh interval (30-60 seconds)
- [ ] Visual indicators for new/updated tickets
- [ ] Timestamp display for last refresh
- [ ] Cleanup on component disconnect

**Option B: Platform Events (More Robust)**
- [ ] Create JIRA_Update__e platform event
- [ ] Build scheduled Apex job to poll JIRA
- [ ] Publish platform events for updates
- [ ] LWC subscribes via lightning/empApi
- [ ] Handle event updates in component

**Deliverable:** Live-updating ticket list

---

### ✅ Phase 5: Polish & Testing (Day 6)
**Status:** Not Started

**Tasks:**
- [ ] Add ticket detail view (modal or drawer pattern)
- [ ] Implement priority/status color coding
- [ ] Add SLDS styling and responsive design
- [ ] Create sample data in test JIRA instance
- [ ] Write comprehensive Apex test classes (80%+ coverage)
- [ ] Test error scenarios (API down, bad credentials, etc.)
- [ ] User acceptance testing
- [ ] Performance testing with large datasets
- [ ] Document component usage and configuration

**Deliverable:** Production-ready component

---

## Technical Specifications

### JIRA REST API Endpoints

```
Base URL: https://{instance}.atlassian.net/rest/api/3/

GET  /search?jql={query}              # Search tickets
GET  /issue/{issueKey}                # Get ticket details
GET  /issue/{issueKey}/comment        # Get comments
GET  /issue/{issueKey}/changelog      # Get history
GET  /myself                          # Test authentication
GET  /project                         # List projects
GET  /priority                        # List priorities
GET  /status                          # List statuses
```

### Sample JQL Queries

```jql
# All open tickets in project
project = PROJ AND status IN ("In Progress", "Open")

# Current user's tickets
assignee = currentUser() ORDER BY updated DESC

# Recently updated (last hour)
updated >= -1h ORDER BY updated DESC

# High priority bugs
priority = High AND type = Bug AND status != Done

# Specific project and sprint
project = PROJ AND sprint = "Sprint 1"
```

### LWC Polling Implementation

```javascript
// Polling approach for real-time updates
export default class JiraTicketDashboard extends LightningElement {
    pollInterval;
    refreshIntervalSeconds = 30;
    
    connectedCallback() {
        this.startPolling();
    }
    
    startPolling() {
        this.pollInterval = setInterval(() => {
            this.refreshTickets();
        }, this.refreshIntervalSeconds * 1000);
    }
    
    disconnectedCallback() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
        }
    }
    
    async refreshTickets() {
        try {
            const result = await getJiraTickets({ jql: this.currentJql });
            this.processTickets(result);
        } catch (error) {
            console.error('Refresh failed:', error);
        }
    }
}
```

### Apex Callout Pattern

```apex
public class JiraApiService {
    
    @TestVisible
    private static final String NAMED_CREDENTIAL = 'callout:JIRA_API';
    
    public static String getTickets(String jql) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(NAMED_CREDENTIAL + '/rest/api/3/search?jql=' + EncodingUtil.urlEncode(jql, 'UTF-8'));
        req.setMethod('GET');
        req.setHeader('Content-Type', 'application/json');
        req.setHeader('Accept', 'application/json');
        
        Http http = new Http();
        HttpResponse res = http.send(req);
        
        if (res.getStatusCode() == 200) {
            return res.getBody();
        } else {
            throw new JiraApiException('API Error: ' + res.getStatus() + ' - ' + res.getBody());
        }
    }
    
    public class JiraApiException extends Exception {}
}
```

---

## Security Considerations

### Authentication
- ✅ Use Named Credentials (not hardcoded credentials)
- ✅ Store API tokens in Protected Custom Settings or Named Credentials
- ✅ Consider per-user authentication for personalized access

### Data Access
- ✅ Implement sharing rules for JIRA_Ticket__c object
- ✅ Validate user permissions before API calls
- ✅ Use `with sharing` on Apex controllers

### Input Validation
- ✅ Sanitize JQL input to prevent injection attacks
- ✅ Validate and escape user-provided filter values
- ✅ Limit query results to prevent excessive data retrieval

### Rate Limiting
- ✅ Implement rate limiting to avoid JIRA API throttling
- ✅ Cache frequently accessed data
- ✅ Use exponential backoff for retry logic

### Error Handling
- ✅ Never expose API credentials in error messages
- ✅ Log errors securely without sensitive data
- ✅ Provide user-friendly error messages

---

## Key Decisions ✅ DECIDED

### 1. Authentication Method ✅
**DECISION: Named Credential (Existing Pattern)**
- Reuse existing `JIRA_API` Named Credential from TickerTape implementation
- Already configured and working in the org
- Pattern: `callout:JIRA_API/rest/api/3/...`
- See: `Batch_UpdateTickerTape.cls` lines 54, 167-172

### 2. Data Storage Strategy ✅
**DECISION: Pure API Calls (No local storage)**
- No custom objects or external objects
- All data fetched directly from JIRA on demand
- Reduces storage footprint (org already low on storage)
- Cache results in LWC component state for session
- **Note:** External Objects considered but require Salesforce Connect + OData adapter setup

### 3. Update Mechanism ✅
**DECISION: JavaScript Polling for POC**
- Client-side polling with configurable interval (30-60 seconds)
- Simple implementation for proof of concept
- Can migrate to Platform Events later if needed for scale

### 4. Scope Definition ⏳
**DECISION: TBD Tomorrow**
- Which JIRA fields to display?
- Which ticket types to include?
- Project-specific or cross-project?
- User-specific or team-wide view?
- **Focus today:** Build base structure to support any scope

### 5. Filtering Options ✅
**DECISION: Default Filters First, Custom JQL Later**
- **Phase 1 (POC):** Default filters (status, priority, assignee)
- **Phase 2 (Future):** Custom JQL support for advanced users
- **Phase 3 (Future):** Saved filter presets

---

## Timeline Estimates

### POC (Minimal Viable Product)
**Duration:** 3-4 days
- Basic authentication
- Simple ticket list
- Manual refresh
- Minimal filtering

### Full Featured
**Duration:** 6-8 days
- All authentication methods
- Advanced filtering and search
- Auto-refresh with polling
- Ticket detail views
- Status indicators

### Production Ready
**Duration:** 10-12 days
- Complete feature set
- Comprehensive testing (80%+ coverage)
- Error handling and logging
- Performance optimization
- Documentation
- Deployment package

---

## Success Criteria

### Functional Requirements
- [ ] Successfully authenticate with JIRA API
- [ ] Retrieve and display JIRA tickets
- [ ] Filter tickets by status, assignee, priority
- [ ] Search tickets by keyword
- [ ] Refresh data (manual and/or automatic)
- [ ] View ticket details
- [ ] Navigate to JIRA ticket from Salesforce

### Non-Functional Requirements
- [ ] Page load time < 3 seconds
- [ ] API response handling < 1 second
- [ ] Support 100+ tickets without performance issues
- [ ] Proper error handling for all failure scenarios
- [ ] Mobile responsive design
- [ ] WCAG 2.0 accessibility compliance

### Testing Requirements
- [ ] 80%+ Apex code coverage
- [ ] Unit tests for all API methods
- [ ] Integration tests with mock callouts
- [ ] UI testing for all user interactions
- [ ] Error scenario testing

---

## Development Notes

### Branch Information
- **Branch Name:** _(Add your branch name here)_
- **Base Branch:** _(e.g., main, develop)_
- **Started:** _(Date)_

### Dependencies
- Salesforce API Version: 60.0+
- JIRA API Version: 3 (Cloud)
- Required Packages: None

### Environment Setup
- **Dev Org:** _(Org alias/name)_
- **JIRA Instance:** _(Instance URL)_
- **Test Account:** _(JIRA test user)_

---

## Resources & References

### JIRA API Documentation
- [JIRA Cloud REST API v3](https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/)
- [JQL (JIRA Query Language)](https://support.atlassian.com/jira-service-management-cloud/docs/use-advanced-search-with-jira-query-language-jql/)
- [JIRA Authentication](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/)

### Salesforce LWC Documentation
- [Lightning Web Components Developer Guide](https://developer.salesforce.com/docs/component-library/documentation/en/lwc)
- [Named Credentials](https://help.salesforce.com/s/articleView?id=sf.named_credentials_about.htm)
- [Platform Events](https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/)

### Code Examples
- [LWC Recipes](https://github.com/trailheadapps/lwc-recipes)
- [Apex REST Callout Examples](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_classes_restful_http_httprequest.htm)

---

## Questions & Blockers

### Open Questions
1. What JIRA instance URL will we use?
2. Do we have API credentials available?
3. Which JIRA projects should be included?
4. Who are the primary users of this component?
5. Where will the component be deployed? (Home page, App page, Record page?)

### Potential Blockers
- [ ] JIRA API access and credentials
- [ ] Salesforce org permissions for Named Credentials
- [ ] CORS/security restrictions
- [ ] API rate limits
- [ ] Network connectivity from Salesforce to JIRA

---

## Change Log

| Date | Change | Author |
|------|--------|--------|
| _(Date)_ | Initial plan created | _(Your Name)_ |
|  |  |  |
|  |  |  |

---

## Next Steps

1. **Review this plan** and fill in the "Desired Features" section
2. **Make key decisions** on authentication, storage, and update mechanisms
3. **Set up JIRA test instance** and obtain API credentials
4. **Begin Phase 1** - Setup & Authentication
5. **Regular check-ins** to track progress and adjust plan as needed

