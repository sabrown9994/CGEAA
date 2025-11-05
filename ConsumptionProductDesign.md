# NetSuite Consumption Model Integration - Development Plan

## Executive Summary
POC integration: Salesforce ↔ NetSuite for consumption-based products.

**Flow 1:** Subscription Activated → Create Allocation Pool → Store Credits on Account  
**Flow 2:** Work Recognition Case Closed → Consume Credits → Update Account Balance

---

## Architecture

```
SALESFORCE                           NETSUITE
Subscription → Trigger → Queueable → RESTlet (Create Pool)
Case Closed → Trigger → Queueable → RESTlet (Consume Credits)
```

**Authentication:** OAuth 1.0 (Consumer Key/Secret, Token ID/Secret)  
**Processing:** Asynchronous via Queueable  
**Logging:** All transactions logged to custom object

---

## Data Model

### Custom Metadata Types

**1. Consumption_Product__mdt**
- Product_Code__c (Text)
- Credits_Per_Unit__c (Number)
- Active__c (Checkbox)
- NetSuite_Product_ID__c (Text)

**2. NetSuite_API_Config__mdt**
- Account_ID__c, Consumer_Key__c, Consumer_Secret__c, Token_ID__c, Token_Secret__c
- Base_URL__c, Allocation_Script_ID__c, Allocation_Deploy_ID__c
- Consume_Script_ID__c, Consume_Deploy_ID__c, Timeout__c, Active__c

### Account Fields
- Total_Credits_Allocated__c (Number)
- Total_Credits_Used__c (Number)
- Remaining_Credits__c (Formula: Allocated - Used)
- NetSuite_Allocation_Pool_ID__c (Text)
- Last_Credit_Sync__c (DateTime)
- Credit_Status__c (Formula: Green/Yellow/Red based on remaining)

### Custom Object: NetSuite_Transaction_Log__c
- Account__c, Transaction_Type__c, HTTP_Status_Code__c
- Request_Body__c, Response_Body__c, Credits_Amount__c
- Status__c, Error_Message__c, Related_Record_ID__c

---

## Phase 1: Core Integration (50 hours)

### Components to Build

| Component | Type | Purpose | Effort |
|-----------|------|---------|--------|
| NetSuiteAuthUtil | Apex | OAuth 1.0 signature generation | 4h |
| NetSuiteAllocationResponse | Apex | Response wrapper | 1.5h |
| NetSuiteConsumeResponse | Apex | Response wrapper | 1.5h |
| NetSuiteService | Apex | API call orchestration | 8h |
| NetSuiteCalloutQueueable | Apex | Async processing | 4h |
| SubscriptionTrigger | Trigger | Detect activation | 1h |
| SubscriptionTriggerHandler | Apex | Process subscription | 6h |
| CaseTrigger | Trigger | Detect closure | 1h |
| CaseTriggerHandler | Apex | Process case closure | 6h |
| Test Classes | Apex | Unit tests (90% coverage) | 16h |
| Setup & Config | Metadata | All custom metadata/fields/objects | 6h |

**Total Phase 1:** 55 hours

### Key Method Signatures

```apex
// NetSuiteAuthUtil
public static String generateAuthHeader(String method, String endpoint)

// NetSuiteService
public static NetSuiteAllocationResponse createAllocationPool(Id accountId, Decimal credits, String productCode)
public static NetSuiteConsumeResponse consumeCredits(Id accountId, Decimal credits, String caseId)
private static HttpResponse makeCallout(String endpoint, String method, String body)
private static void logTransaction(String type, HttpRequest req, HttpResponse res, Id accountId)

// NetSuiteCalloutQueueable
public void execute(QueueableContext context)
private void handleAllocationResponse(NetSuiteAllocationResponse response, Id accountId)
private void handleConsumeResponse(NetSuiteConsumeResponse response, Id accountId)

// SubscriptionTriggerHandler
public static void handleAfterUpdate(List<SBQQ__Subscription__c> newList, Map<Id, SBQQ__Subscription__c> oldMap)

// CaseTriggerHandler
public static void handleAfterUpdate(List<Case> newList, Map<Id, Case> oldMap)
```

---

## Phase 2: Validation & Error Handling (20 hours)

### Features

**1. Credit Validation (3h)**
- Prevent Work Recognition case creation when credits = 0
- Prevent case closure if insufficient credits

**2. Error Handling & Retry (8h)**
- Exponential backoff retry (max 3 attempts)
- Platform event for failures
- Email notifications

**3. Admin Dashboard (6h)**
- LWC to display failed transactions
- Manual retry button
- Filter by type/date

**4. Multiple Allocation Pool Strategy (3h + TBD)**
- Research with Finance team
- Implement chosen approach

**Total Phase 2:** 20 hours

---

## TODO Items (Phase 2+)

### In Code

**SubscriptionTriggerHandler.cls**
```apex
// TODO: Confirm with Finance Tech Engineer:
// Should we create separate pools or add to existing?
```

**CaseTriggerHandler.cls**
```apex
// TODO Phase 2: Validate sufficient credits before case closure
// TODO Phase 2: Handle accounts with no allocation pool
// TODO Phase 2: Notify case owner if credit consumption fails
// TODO Future: Implement account hierarchy traversal for pool lookup
```

**NetSuiteCalloutQueueable.cls**
```apex
// TODO Phase 2: Implement retry logic for transient failures
// TODO Phase 2: Send notification to admin on persistent failures
// TODO Phase 2: Create platform event for integration monitoring
```

### Future Enhancements
- LWC dashboard for credit balance visualization
- Scheduled daily sync job with NetSuite
- Credit alerts when below threshold
- Credit reservation system (reserve on case create, consume on close)
- Multi-currency support
- Advanced reporting & analytics

---

## Testing Strategy

### Unit Tests (90% coverage minimum)
- Mock HTTP callouts using HttpCalloutMock
- Test bulk scenarios (200 records)
- Test error handling and edge cases

### Integration Tests
- Test against NetSuite sandbox
- E2E: Subscription activation → Verify in NetSuite → Check Account
- E2E: Case closure → Verify consumption → Check Account

### UAT Scenarios
1. Order consumption product → Verify allocation
2. Close Work Recognition case → Verify credits decrease
3. Test transaction log accuracy

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests passing (90%+ coverage)
- [ ] Integration tests complete in sandbox
- [ ] Custom Metadata configured with prod credentials
- [ ] Remote Site Settings created
- [ ] UAT sign-off received

### Deployment Order
1. Custom Metadata Types
2. Custom Object (Transaction Log)
3. Account Fields
4. Apex Classes (response wrappers first, then utils, services, handlers)
5. Test Classes
6. Triggers
7. Remote Site Settings
8. Custom Metadata Records

### Post-Deployment
- Run all tests in production
- Monitor logs for 24 hours
- Test with pilot account

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| NetSuite API changes | Version endpoints, monitor release notes |
| Governor limits (queueable) | Implement batch processing if needed |
| OAuth token expiration | Token refresh logic |
| Network timeouts | Retry logic, increase timeout |
| Concurrent API call limits | Implement queuing/throttling |
| Incorrect credit calculations | Thorough testing, validation rules |

---

## NetSuite Team Requirements

### RESTlets to Create (3 endpoints needed)

**1. Create Allocation Pool**
- **Endpoint:** `/allocation`
- **Method:** POST
- **Request:**
```json
{
  "salesforceAccountId": "001...",
  "productId": "NS-ITEM-12345",
  "creditsAllocated": 1000
}
```
- **Response:**
```json
{
  "success": true,
  "allocationPoolId": "12345",
  "creditsAllocated": 1000,
  "remainingCredits": 1000
}
```

**2. Consume Credits**
- **Endpoint:** `/consume`
- **Method:** POST
- **Request:**
```json
{
  "allocationPoolId": "12345",
  "creditsToConsume": 10,
  "salesforceCaseId": "500..."
}
```
- **Response:**
```json
{
  "success": true,
  "creditsConsumed": 10,
  "remainingCredits": 990
}
```

**3. Query Balance** (Phase 2)
- **Endpoint:** `/balance`
- **Method:** GET
- **URL Params:** `?allocationPoolId=12345`
- **Response:**
```json
{
  "success": true,
  "allocationPoolId": "12345",
  "remainingCredits": 990
}
```

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| **Phase 1 - Core** | **3 weeks** | NetSuite RESTlets must be ready |
| Setup & Config | 1 day | None |
| API Layer | 1 week | NetSuite endpoints defined |
| Triggers & Handlers | 1 week | API layer complete |
| Testing | 1 week | All code complete |
| **Phase 2 - Enhanced** | **1 week** | Phase 1 deployed |
| Validation | 1 day | Phase 1 complete |
| Error Handling | 2 days | Phase 1 complete |
| Dashboard | 2 days | Transaction log populated |
| **TOTAL** | **4 weeks** | |

---

## Success Criteria

### Phase 1 POC Success
- ✅ Subscription activation creates allocation pool in NetSuite
- ✅ Account fields update with credit balance
- ✅ Work Recognition case closure consumes credits
- ✅ All transactions logged
- ✅ 90%+ test coverage
- ✅ Integration works end-to-end in sandbox

### Phase 2 Success
- ✅ Credit validation prevents case creation when depleted
- ✅ Failed transactions can be retried
- ✅ Admins notified of failures
- ✅ Dashboard shows transaction history

---

## Contact & Support

**Salesforce Team Lead:** [Your Name]  
**NetSuite Team Lead:** [Finance Tech Engineer Name - TBD]  
**Documentation:** This file + inline code comments  
**Support:** Create Jira ticket in [PROJECT] for issues
