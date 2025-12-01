# Design Plan: Quote Approval & Calculator Timing Solution

**JIRA Ticket:** PGTM-2397  
**Date:** December 1, 2025  
**Status:** Design Phase

---

## Problem Summary

Your system experiences a race condition when quotes are auto-approved:

1. **Current Flow:**
   - Quote submitted for Pre-Sale Approval via `QuoteApprovalView` LWC
   - `SBQQ__Status__c` → `'Pending Pre-Sale Approval'`
   - CPQ Trigger fires → calls Calculator API via `QuoteCalculatorOperation` queueable
   - Approval chain auto-approves the quote almost immediately
   - `SBQQ__Status__c` → `'Approved'`
   - Calculator API completes and tries to update quote
   - **QCP_Bedrock.js throws error** because quote is already approved

2. **Root Cause:** Calculator API rejects calculations on already-approved quotes, but the approval happens before calculation completes.

---

## Proposed Solution Architecture

### Phase 1: Add Calculation Tracking Field

**New Quote Field:**
- **Field Name:** `Calculated_Before_Approval__c`
- **Type:** Checkbox
- **Default:** `false`
- **Purpose:** Tracks whether the quote has been successfully calculated while in "Pending Pre-Sale Approval" status

### Phase 1.5: Set Status Before Approval Submission

**Update QuoteExtController.onSubmit():**
- Before calling `SBAA.ApprovalAPI.submit()`, set quote status to 'Pending Pre-Sale Approval'
- This triggers the CPQ calculator BEFORE the approval chain submission
- Ensures calculator completes and sets flag before approval can proceed

```apex
public PageReference onSubmit() {
    try {
        if (quoteId != null) {
            // PGTM-2397: Set status to trigger calculator before approval submission
            SBQQ__Quote__c quote = new SBQQ__Quote__c(Id = quoteId);
            quote.SBQQ__Status__c = 'Pending Pre-Sale Approval';
            update quote;
            
            // Now submit to approval chain
            SBAA.ApprovalAPI.submit(quoteId, SBAA__Approval__c.Quote__c);
        }
    } catch (Exception e) {
        ApexPages.addMessage(new ApexPages.Message(ApexPages.Severity.ERROR, 'There was an error saving your quote: '+e.getMessage()));
        SBAA.ApprovalAPI.recall(quoteId, SBAA__Approval__c.Quote__c);
        return null;
    }
    return new PageReference('/' + quoteId);
}
```

### Phase 2: Update QCP_Bedrock.js to Set Flag

**In `onAfterCalculate()` function:**
- After all calculations complete successfully
- Check if quote status is `'Pending Pre-Sale Approval'`
- Set `Calculated_Before_Approval__c = true` on the quote
- This signals that calculation is complete

**Error Handling:**
- If quote is already `'Approved'` or beyond, throw existing error (don't suppress it)
- Only set the flag if quote is in `'Pending Pre-Sale Approval'` status

### Phase 3: Auto-Submit Quote on Calculation Complete

**Create new Apex method: `submitQuoteForApprovalOnCalculationComplete()`**

This method will be called from a Quote trigger when `Calculated_Before_Approval__c` changes from false → true:

```apex
public static void submitQuoteForApprovalOnCalculationComplete(List<SBQQ__Quote__c> newList, Map<Id, SBQQ__Quote__c> oldMap) {
    List<SBQQ__Quote__c> quotesToSubmit = new List<SBQQ__Quote__c>();
    
    for (SBQQ__Quote__c quote : newList) {
        SBQQ__Quote__c oldQuote = oldMap.get(quote.Id);
        
        // Check if flag just changed from false to true
        if (!oldQuote.Calculated_Before_Approval__c && 
            quote.Calculated_Before_Approval__c &&
            quote.SBQQ__Status__c == 'Pending Pre-Sale Approval') {
            quotesToSubmit.add(quote);
        }
    }
    
    if (!quotesToSubmit.isEmpty()) {
        submitQuotesForApproval(quotesToSubmit);
    }
}

private static void submitQuotesForApproval(List<SBQQ__Quote__c> quotes) {
    for (SBQQ__Quote__c quote : quotes) {
        // Use Salesforce Advanced Approval API to submit
        sbaa.ApprovalProcessSubmitter.submitApprovalProcess(
            new sbaa.ApprovalProcessSubmitter.SubmitRequest(quote.Id, 'Pre_Sale_Approval')
        );
        System.debug('Quote ' + quote.Id + ' submitted for Pre-Sale Approval after calculation');
    }
}
```

**Add to `afterUpdate()` in CPQQuoteTriggerHandler:**
```apex
CPQQuoteTriggerFunctions.submitQuoteForApprovalOnCalculationComplete(newList, oldMap);
```

### Phase 4: Handle Rejection Workflow

**When Quote is Rejected:**
- Approval chain rejection sets quote status back to `'Draft'` or `'Pending Pre-Sale Approval'`
- Create trigger logic to reset `Calculated_Before_Approval__c = false` when:
  - Quote status changes from `'Approved'` → `'Draft'`
  - OR `ApprovalStatus__c` changes to `'Rejected'`
- This allows quote to be recalculated when resubmitted

---

## Implementation Details

### 1. Quote Field Addition

```
Field API Name: Calculated_Before_Approval__c
Type: Checkbox
Default Value: false
Description: Indicates quote has been calculated while pending pre-sale approval
```

### 2. QCP_Bedrock.js Changes

**Location:** `onAfterCalculate()` function (around line 451)

**Add at end of function (before resolve):**
```javascript
// After all calculations complete successfully
if (quoteModel.record.SBQQ__Status__c === 'Pending Pre-Sale Approval') {
    quoteModel.record.Calculated_Before_Approval__c = true;
    console.log('DEBUG - Marked quote as calculated before approval');
}
```

**Error Handling in QCP_Bedrock.js:**
- Current: Throws error if quote is already approved
- New: Only throw error if quote status is NOT 'Pending Pre-Sale Approval'
- This allows the calculation to complete and set the flag

### 3. CPQQuoteTriggerFunctions Changes

**New method: `resetCalculationFlagOnRejection()`**

```apex
public static void resetCalculationFlagOnRejection(List<SBQQ__Quote__c> newList, Map<Id, SBQQ__Quote__c> oldMap) {
    List<SBQQ__Quote__c> quotesToUpdate = new List<SBQQ__Quote__c>();
    
    for (SBQQ__Quote__c quote : newList) {
        SBQQ__Quote__c oldQuote = oldMap.get(quote.Id);
        
        // Reset flag when approval is rejected
        if (oldQuote.ApprovalStatus__c != 'Rejected' && 
            quote.ApprovalStatus__c == 'Rejected') {
            quote.Calculated_Before_Approval__c = false;
        }
        
        // Reset flag when quote goes back to draft
        if (oldQuote.SBQQ__Status__c == 'Approved' && 
            quote.SBQQ__Status__c == 'Draft') {
            quote.Calculated_Before_Approval__c = false;
        }
    }
    
    if (!quotesToUpdate.isEmpty()) {
        updateQuotesSafely(quotesToUpdate);
    }
}
```

**Add to `beforeUpdate()` in CPQQuoteTriggerHandler:**
```apex
CPQQuoteTriggerFunctions.resetCalculationFlagOnRejection(newList, oldMap);
```

### 4. No Changes to Approval Chain Entry Criteria

The approval chain entry criteria remain unchanged. The quote is now submitted programmatically via Apex after calculation completes, so the approval chain will receive the submission request at that time.

---

## Sequence Diagram

```
User clicks "Submit for Approval" button
    ↓
QuoteApprovalView navigates to /apex/SubmitQuote
    ↓
QuoteExtController.onSubmit() executes
    ↓
[STEP 1] Set Quote status → 'Pending Pre-Sale Approval'
    ↓
CPQ Trigger fires → QuoteCalculatorOperation enqueued
    ↓
[ASYNC - Calculator API runs in background]
Calculator API calls QCP_Bedrock.onAfterCalculate()
    ↓
QCP_Bedrock completes calculations
    ↓
QCP_Bedrock sets Calculated_Before_Approval__c = true
    ↓
Quote saved with flag = true
    ↓
Quote Trigger fires (afterUpdate)
    ↓
submitQuoteForApprovalOnCalculationComplete() detects flag change
    ↓
Apex calls sbaa.ApprovalProcessSubmitter.submitApprovalProcess()
    ↓
Quote submitted to Pre-Sale Approval chain
    ↓
Approval chain auto-approves (if applicable)
    ↓
Quote status → 'Approved'
```

---

## Key Benefits

1. **Eliminates Race Condition:** Approval can't proceed until calculation completes
2. **Maintains Auto-Approval:** If quote qualifies, it still auto-approves after calculation
3. **Handles Rejections:** Resubmitted quotes can be recalculated
4. **Minimal Code Changes:** Focused updates to specific areas
5. **Backward Compatible:** Existing quotes unaffected; flag defaults to false

---

## Testing Strategy

### Test Case 1: Normal Auto-Approve Flow
- Submit quote for approval
- Verify `Calculated_Before_Approval__c` = false initially
- Wait for calculator to complete
- Verify `Calculated_Before_Approval__c` = true
- Verify approval chain proceeds
- Verify quote auto-approves

### Test Case 2: Rejection & Resubmission
- Submit quote and let it auto-approve
- Reject the quote
- Verify `Calculated_Before_Approval__c` = false
- Resubmit for approval
- Verify calculation runs again
- Verify flag is set to true
- Verify approval proceeds

### Test Case 3: Manual Approval
- Submit quote for approval
- Verify flag is set to true after calculation
- Manually approve quote
- Verify quote status = 'Approved'

### Test Case 4: Error Handling
- Submit quote with calculation errors
- Verify error is thrown
- Verify quote remains in 'Pending Pre-Sale Approval'
- Verify flag remains false
- Fix issue and resubmit

---

## Considerations & Risks

| Consideration | Mitigation |
|---|---|
| **Approval Chain Timing** | Entry criteria must be checked AFTER quote update completes. Verify approval chain refresh timing. |
| **Multiple Submissions** | Flag reset logic ensures each submission gets fresh calculation. |
| **Batch Operations** | If quotes submitted in batch, ensure each gets calculated individually. |
| **Legacy Quotes** | Existing quotes have flag = false; won't affect them unless resubmitted. |
| **QCP Error Messages** | Ensure QCP script distinguishes between "already approved" and "pending approval" scenarios. |

---

## Implementation Checklist

### Code Changes (✅ Completed)
- [x] Update QCP_Bedrock.js `onAfterCalculate()` to set flag when status is 'Pending Pre-Sale Approval'
- [x] Add `submitQuoteForApprovalOnCalculationComplete()` method to CPQQuoteTriggerFunctions
- [x] Add `submitQuotesForApproval()` helper method to CPQQuoteTriggerFunctions
- [x] Add call to submit method in CPQQuoteTriggerHandler.afterUpdate()
- [x] Add `resetCalculationFlagOnRejection()` method to CPQQuoteTriggerFunctions
- [x] Add call to reset method in CPQQuoteTriggerHandler.beforeUpdate()
- [x] Update QuoteExtController.onSubmit() to set status before approval submission

### Configuration (⏳ Pending)
- [ ] Create `Calculated_Before_Approval__c` checkbox field on Quote object

### Testing (⏳ Pending)
- [ ] Test Case 1: Normal Auto-Approve Flow
- [ ] Test Case 2: Rejection & Resubmission
- [ ] Test Case 3: Manual Approval
- [ ] Test Case 4: Error Handling
- [ ] Test Case 5: Verify flag triggers approval submission
- [ ] Test Case 6: Verify status set before approval submission

### Deployment (⏳ Pending)
- [ ] Deploy to INTQA for validation
- [ ] Monitor approval logs for timing issues
- [ ] Deploy to Production

---

## Related Files

- `force-app/main/default/staticresources/QCP_Bedrock.js` - Calculator script
- `force-app/main/default/classes/CPQQuoteTriggerHandler.cls` - Quote trigger handler
- `force-app/main/default/classes/CPQQuoteTriggerFunctions.cls` - Quote trigger functions
- `force-app/main/default/lwc/quoteApprovalView/quoteApprovalView.js` - Approval submission LWC

---

## Notes

- This solution maintains backward compatibility with existing quotes
- The flag-based approach provides a clear signal between calculator and approval chain
- Rejection handling ensures quotes can be recalculated without manual intervention
- Consider adding logging/monitoring to track calculation completion times
