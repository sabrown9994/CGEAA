# Best Practices for Developing with AI Coding Tools
**Training Guide | November 2024**

## Table of Contents
1. [How AI Coding Works](#1-how-ai-coding-works)
2. [Working with Prompts](#21-crafting-effective-prompts)
3. [Leveraging Memories](#22-leveraging-memories)
4. [Code Scanning Strategies](#23-code-scanning-strategies)
5. [Accessing Documentation](#24-accessing-technical-documentation)
6. [Test Class Generation](#31-test-class-generation)
7. [Pre-Refinement Analysis](#32-pre-refinement-analysis)
8. [Keeping Within Scope](#33-keeping-ai-within-ticket-scope)

---

## 1. How AI Coding Works

### Foundation
AI coding assistants are built on Large Language Models trained on billions of lines of code, technical documentation, and programming patterns.

### Processing Flow
```
Your Prompt → Context Gathering → AI Processing → Tool Execution → Code Changes
```

### Key Capabilities

**✅ What AI Does Well:**
- Reading and understanding large codebases quickly
- Pattern recognition across files
- Generating boilerplate code
- Creating test scenarios
- Explaining complex logic
- Finding related code

**❌ What AI Struggles With:**
- Understanding business logic without context
- Making architectural decisions without guidance
- Knowing organization-specific conventions
- Accessing private documentation
- Real-time debugging

### The Token Window
AI has a limited context window (~75K-150K words):
- Includes conversation history, files, outputs
- **Key Limitation**: Older context is forgotten
- **Solution**: Use memories to preserve important context!

---

## 2.1 Crafting Effective Prompts

### Prompt Anatomy
```
[Context] + [Task] + [Constraints] + [Expected Output]
```

### Examples

#### ❌ Poor Prompts
```
"Fix the bug"
"Make it better"  
"Add a feature for accounts"
```

#### ✅ Excellent Prompts

**Bug Fix:**
```
I'm seeing a NullPointerException in OpportunityTriggerFunctions.cls at line 245 
when processing Closed Won opportunities with null Quote__c.

Can you:
1. Read OpportunityTriggerFunctions.cls
2. Add null checking before accessing Quote__c
3. Ensure bulk-safe fix (200 records)
4. Add test case for the scenario
```

**Feature Development:**
```
Add BillingCountry validation to Account trigger.

Requirements:
- Allowed countries: US, CA, GB, AU
- Error message: "Country {X} not supported. Allowed: US, CA, GB, AU"
- Only for National_Account__c = true
- Must handle bulk (200 records)

Files: AccountTriggerFunctions.cls, AccountTriggerFunctionsTest.cls
Pattern: Follow existing validation methods in the class
```

### Prompt Framework

| Component | Purpose | Example |
|-----------|---------|---------|
| **Context** | Current situation | "Working on JIRA-123, bulk update feature..." |
| **Task** | What you need | "Create batch class to update Account features..." |
| **Constraints** | Limitations | "Handle 10K+ records, include error handling..." |
| **Files** | Where to work | "Modify AccountHelper.cls, add tests..." |
| **Success** | Done criteria | "95% coverage, <30min runtime, error logging" |

---

## 2.2 Leveraging Memories

### What Are Memories?
Persistent knowledge stored across conversations that survive beyond the context window.

### Types of Memories

| Type | Purpose | Example |
|------|---------|---------|
| **Architecture** | System patterns | "Feature override uses CG_AccountFeatureMap with metadata inheritance" |
| **Conventions** | Coding standards | "All triggers use TriggerFunctions pattern with bulk-safe methods" |
| **Business Rules** | Domain logic | "Downgrades only apply to non-National accounts" |
| **Dependencies** | Integrations | "JIRA API uses Named Credential 'Jira' endpoint /rest/api/3/search/jql" |
| **Blockers** | Known issues | "Service account lacks JIRA project permissions" |

### When to Create Memories

✅ **DO Create For:**
- Complex business logic you'll reference again
- Architectural decisions and patterns
- Integration details (endpoints, auth, structures)
- Org-specific coding conventions
- Important object/class relationships
- Known blockers

❌ **DON'T Create For:**
- One-time bug fixes
- Temporary file paths
- Standard Salesforce concepts
- Trivial details

### How to Request

**Explicit:**
```
"Save to memory: CPQ quote calculation runs in this order:
1. QCP_Bedrock.js onBeforeCalculate
2. Standard CPQ calculation  
3. QCP_Bedrock.js onAfterCalculate (downgrade checks)
Tags: cpq, quote_calculation, process_flow"
```

**Implicit (AI decides):**
```
"I discovered feature override checks must run in Contract trigger AFTER 
subscriptions are created, not in Opportunity trigger."
```

### Best Practices

**Be Specific:**
```
❌ "Feature thing uses metadata"
✅ "CG_Feature_Metadata__c stores config by country. 
   Fields: Source_Object__c, Source_Field__c, Overrideable__c, Type__c"
```

**Include Context:**
```
✅ "For INTQA deployments, Tooling API query:
   SELECT ApexTestClass.Name FROM ApexCodeCoverage 
   WHERE ApexClassOrTrigger.Name IN (changed_classes)"
```

---

## 2.3 Code Scanning Strategies

### AI's Code Analysis Tools

| Tool | Purpose | When to Use |
|------|---------|-------------|
| **grep_search** | Find text patterns | Method calls, field references |
| **find_by_name** | Find files by name | Locate classes, config files |
| **read_file** | Read file contents | Understand implementation |
| **list_dir** | Browse directories | Explore project layout |

### Effective Patterns

**Targeted Search:**
```
"Search for all references to CG_Feature__c in force-app directory"
```

**Discovery:**
```
"Find all Apex classes related to feature management"
```

**Deep Dive:**
```
"Read CG_AccountFeatureMap.cls and explain the constructor logic"
```

### Best Practices

**1. Provide Scope:**
```
❌ "Find references to 'Feature'"
✅ "Search for 'CG_Feature__c' in force-app/main/default/classes"
```

**2. Be Specific:**
```
❌ "Look at account stuff"
✅ "Read AccountTriggerFunctions.cls, focus on beforeUpdate method"
```

**3. Guide Strategy:**
```
"First grep for classes importing CG_AccountFeatureMap.
Then read top 3 results to understand usage pattern."
```

### Common Scenarios

**Understanding Dependencies:**
```
"I need to modify CG_AccountFeatureMap. What depends on it?"

Approach:
1. grep_search "CG_AccountFeatureMap" in *.cls
2. Review results
3. Read key dependent classes
```

**Finding Examples:**
```
"How do we structure batch Apex classes?"

Approach:
1. find_by_name "*Batch*.cls"
2. Read 2-3 examples
3. Extract common patterns
```

**Impact Analysis:**
```
"If I change calculateFeatures() signature, what breaks?"

Approach:
1. grep_search "calculateFeatures("
2. Identify all call sites
3. Assess impact
```

---

## 2.4 Accessing Technical Documentation

### When to Use
- Unfamiliar APIs
- Latest framework updates
- Third-party integration specs
- Salesforce metadata API changes

### How to Request

**Explicit URL:**
```
"Read https://developer.salesforce.com/docs/... 
and explain Database.update() method options"
```

**Search-Based:**
```
"Search Salesforce docs on LWC wire adapters 
and show how to use getPicklistValues"
```

**Verification:**
```
"Check Zuora REST API docs for subscription endpoint.
Verify required fields for updates."
```

### Best Practices

**Be Specific About Version:**
```
✅ "Salesforce API v59.0 docs for Custom Metadata Types"
❌ "How do Custom Metadata Types work?"
```

**Combine with Local Code:**
```
"Read our ZuoraIntegrationHelper.cls, then check Zuora API docs 
to verify we use latest authentication (OAuth 2.0)."
```

**Validate Against Docs:**
```
"We get 400 error from JIRA API. Check JIRA Cloud REST API docs 
for /rest/api/3/search and verify our request format."
```

---

## 3.1 Test Class Generation

### Why AI Excels
- Pattern recognition in test frameworks
- Coverage analysis
- Automated data setup
- Bulk scenario generation

### Effective Prompts

**New Test Class:**
```
"Create test class for AccountFeatureHelper.cls

Methods to test:
1. calculateFeatures(Set<Id> accountIds)
2. updateFeatureOverrides(List<CG_Account_Feature__c>)
3. generateIntegrationMessages(Set<Id> accountIds)

Requirements:
- 95%+ coverage
- Test bulk (200 records)
- Test negative cases
- Follow pattern from OpportunityTriggerFunctionsTest.cls
- Use Test.startTest()/stopTest()
- Mock callouts

Name: AccountFeatureHelperTest.cls"
```

**Improving Coverage:**
```
"AccountFeatureHelperTest.cls has 78% coverage.

Can you:
1. Identify uncovered lines
2. Read AccountFeatureHelper.cls specific lines
3. Add test methods for missing branches

Uncovered:
- Line 145: when Source_Object__c null
- Lines 201-208: exception handling
- Line 267: empty metadata override string"
```

**Bulk Testing:**
```
"Enhance test to include bulk scenarios:

Add testBulkDowngradeDetection():
- Create 200 Opportunities
- Create 400 Quote Lines (2 each)
- Simulate 100 downgrades
- Verify bulk efficiency (no SOQL in loops)
- Assert Downgrade__c correctly set
- Verify no governor limits hit"
```

### Best Practices

**Start with Implementation:**
```
"Read AccountFeatureHelper.cls to understand logic, then create tests"
```

**Request Specific Patterns:**
```
"Use @isTest(SeeAllData=false). Create all test data.
Follow Arrange-Act-Assert pattern."
```

**Include Data Factories:**
```
"Create TestDataFactory with:
- createAccount(String name, Boolean isNational)
- createFeature(String name, Boolean active)
- createSubscription(Id accountId, Id productId)"
```

---

## 3.2 Pre-Refinement Analysis

### Purpose
Before refinement, use AI to:
- Understand requirements
- Identify affected components
- Estimate complexity
- Surface blockers
- Suggest implementation

### Analysis Framework

**Step 1: Understand Ticket:**
```
"JIRA DSS-789: 'Add multi-currency support in feature metadata'

Requirements:
- Store currency-specific values
- Support USD, CAD, GBP, EUR, AUD
- Default to USD
- Update UI with currency selector
- Migrate existing data

Can you:
1. Search for existing currency handling
2. Identify objects/classes needing changes
3. List potential blockers"
```

**Step 2: Impact Analysis:**
```
"For currency feature:

1. grep_search current currency references
2. Read CG_Feature_Metadata__c definition
3. Identify classes querying/updating this object
4. Check UI components displaying metadata
5. Look for similar multi-value implementations

Provide:
- Files requiring changes
- Complexity estimate (S/M/L/XL)
- Potential risks"
```

**Step 3: Implementation Strategy:**
```
"Suggest implementation for currency support:

Consider:
- New field vs. part of existing structure?
- Data migration approach?
- Impact on feature calculation?
- UI changes (LWC)?
- Test coverage needs?

Provide:
- Recommended approach with pros/cons
- Subtask list
- Dependencies and ordering"
```

### Pre-Refinement Template

```markdown
# Pre-Refinement: [TICKET-ID]

## Analysis Requests

### 1. Current State
- Search related functionality
- Identify existing patterns
- Find similar implementations

### 2. Impact
- Classes/objects requiring changes
- UI components affected
- Integration points
- Data migration needs

### 3. Blockers
- Missing dependencies?
- Required access/permissions?
- Conflicting features?
- API limitations?

### 4. Effort
- Complexity (S/M/L/XL)
- Subtask breakdown
- Unknown requiring spikes

### 5. Approach
- Recommended strategy
- Alternatives with trade-offs
- Testing strategy
- Rollout considerations
```

### Real Example

**Ticket: "Allow dealers to override feature activation dates"**

AI Analysis Output:
```
Current State:
- Found CG_Account_Feature__c (stores features)
- CG_AccountFeatureMap.cls (calculation logic)
- AccountManageFeatures.page (override UI)
- No existing date override capability
- Similar pattern in CPQ_Subscriptions_Fulfillment__c dates

Impact: MEDIUM
- Add: Activation_Date__c, Activation_Date_Override__c
- Modify: CG_AccountFeatureMap.cls calculation
- Update: LWC component with date picker
- Add: Validation rules
- Update: Test classes

Blockers: None

Recommendation:
- Follow Status_Override__c pattern
- Add date fields to CG_Account_Feature__c
- Update map class to check override first
- Estimate: 5-8 story points
```

---

## 3.3 Keeping AI Within Ticket Scope

### The Challenge
AI may suggest enhancements beyond the ticket:
- "While we're here, we could also..."
- "Should I also refactor..."

**This causes scope creep!**

### Setting Boundaries

**Opening Prompt Pattern:**
```
"Working on JIRA-456: [title]

SCOPE: [clear definition]

DO:
- [requirement 1]
- [requirement 2]

DO NOT:
- Refactor unrelated code
- Add features not in requirements
- Modify other classes unless necessary
- Change tests beyond needed coverage

If you find issues outside scope, note them for separate tickets 
but do NOT implement."
```

### Example: Scoped Bug Fix

```
"JIRA-892: Fix NullPointerException in OpportunityTriggerFunctions.cls line 245

SCOPE: Fix ONLY the NPE. No refactoring.

Requirements:
1. Add null check for Quote__c
2. Add test reproducing NPE
3. Verify test passes
4. Deploy fix

OUT OF SCOPE:
- Do NOT refactor downgrade logic
- Do NOT optimize SOQL
- Do NOT add validation rules
- Do NOT modify trigger framework

Read OpportunityTriggerFunctions.cls lines 240-250 only."
```

### Handling Out-of-Scope Suggestions

**AI Says:**
```
"I've added the null check. I also noticed Opportunity.Amount__c 
should be validated. Should I add that?"
```

**You Say:**
```
"No, outside scope of JIRA-892. Create a note about Amount__c 
validation for a separate ticket, but do NOT implement now.

Proceed with just Quote__c fix and test."
```

### "Done Means Done" Pattern

```
"JIRA-892 complete. Before closing:

1. Confirm scope complete:
   ✓ Added null check
   ✓ Added test testUpdateWithNullQuote()
   ✓ Test passes
   ✓ Ready for deployment

2. Out-of-scope items for separate tickets:
   - Amount__c lacks validation (NPE risk line 312)
   - Downgrade logic has inefficient SOQL

3. Do NOT implement out-of-scope items

Stop. JIRA-892 complete."
```

### Scope Management

| Principle | Bad | Good |
|-----------|-----|------|
| **Single Responsibility** | "Fix bugs and improve performance" | "Fix NPE on line 245 only" |
| **Clear Boundaries** | "Update account trigger" | "Update validateCountry() only" |
| **Explicit Out** | [Not mentioned] | "Do NOT refactor other methods" |
| **Verification** | "Make it work" | "Verify test passes, then stop" |

### When to Expand Scope

✅ **Expand When:**
- Related code breaks without changes
- Test coverage impossible without companions
- Security vulnerabilities discovered
- Data corruption risk identified

❌ **Don't Expand For:**
- "Nice to have" improvements
- Code style preferences
- Performance optimizations
- Additional features "while here"

**If expanding, document:**
```
"JIRA-892 scope expansion required:

Original: Fix NPE on Quote__c access

Expansion: Must also update QuoteTriggerFunctions.cls 
because it calls same method and will fail.

Changes:
1. OpportunityTriggerFunctions.cls (original)
2. QuoteTriggerFunctions.cls (required dependency)
3. Both test classes

Reason: True dependency, not scope creep."
```

---

## Quick Reference Guide

### The 5 Commandments
1. **Be Specific**: Vague prompts = vague results
2. **Provide Context**: AI needs the full picture
3. **Use Memories**: Don't repeat across sessions
4. **Stay Scoped**: Resist feature creep
5. **Verify Results**: AI can make mistakes

### Prompt Templates

**Bug Fix:**
```
Bug: [description]
Location: [file:line]
Steps to reproduce: [steps]
Expected: [behavior]
Actual: [behavior]
Scope: [what to change]
```

**Feature:**
```
Feature: [description]
Requirements: [list]
Files: [specific files]
Pattern: [reference]
Out of scope: [what NOT to do]
```

**Analysis:**
```
Question: [what you need]
Context: [background]
Scope: [where to look]
Output: [format]
```

### Common Pitfalls

| Pitfall | Impact | Prevention |
|---------|--------|------------|
| Assuming AI knows business logic | Wrong implementation | Provide context |
| Not using memories | Repeat explanations | Create proactively |
| Reading entire codebase | Context overflow | Guide specific files |
| First solution only | Suboptimal code | Ask alternatives |
| Scope creep | Over-engineering | Set boundaries |

### When to Use AI

**✅ Great For:**
- Test class generation
- Boilerplate code
- Code exploration
- Refactoring patterns
- Documentation
- Pre-refinement analysis
- Finding examples

**❌ Poor For:**
- Business logic decisions
- Architecture from scratch
- Security-sensitive code
- Production debugging
- Deployment strategies

---

## Training Exercises

### Exercise 1: Rewrite Poor Prompts
1. "Fix the account trigger"
2. "Make the dashboard better"
3. "Add some tests"

### Exercise 2: Create Memory
Scenario: Feature calculations check both Account.Product_Activation_Status__c 
and Service_Provider__r.reviewStatus__c for eligibility.

What memory should be created?

### Exercise 3: Scope Management
You're implementing "Add email validation to Contact trigger."

AI suggests: "I can also add phone format validation, standardize 
addresses, and add duplicate detection."

How do you respond?

---

**End of Training Guide**
