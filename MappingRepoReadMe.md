# Best Practices for Salesforce Deployment Mappings Repository

## Overview

The `salesforce-test-mappings` repository is a centralized configuration store for JSON mapping files used across Salesforce CI/CD pipelines and automation workflows. This repository contains various types of mappings that define relationships between different entities in the Salesforce ecosystem.

**Current Mapping Types:**
- **Test Coverage Mappings:** Apex class → Test class relationships for intelligent test selection
- **Sandbox User Mappings:** GitHub username → Salesforce sandbox assignments
- **Future Mappings:** Additional configuration files as automation needs evolve

This repository serves as a single source of truth for deployment and automation configurations, separate from application code repositories.

---

## 1. When to Add New Mapping Files

### Add New Mapping Files When:

#### ✅ New Automation Workflow Requires Configuration
- **When:** Creating a new CI/CD workflow or automation that needs external configuration
- **Why:** Keeps configuration separate from code, enabling updates without code deployments
- **Example Use Cases:**
  - User-to-environment assignments
  - Feature flag configurations
  - Deployment routing rules
  - Integration endpoint mappings
  - Environment-specific settings

#### ✅ Configuration Needs to Be Shared Across Multiple Repositories
- **When:** Multiple projects need access to the same configuration data
- **Why:** Centralized management prevents duplication and inconsistencies
- **Example:**
  - GitHub username → Sandbox mappings used by multiple deployment workflows
  - Shared test coverage data used by different CI/CD pipelines

#### ✅ Configuration Changes Frequently and Needs Version Control
- **When:** Configuration data changes regularly and requires audit trail
- **Why:** Git history provides tracking, rollback capability, and change attribution
- **Example:**
  - User assignments that change as team members join/leave
  - Test coverage mappings that evolve with codebase

#### ✅ Configuration Requires Team Review Before Changes
- **When:** Changes to configuration could impact multiple teams or critical workflows
- **Why:** Pull request process enables review, discussion, and approval
- **Example:**
  - Sandbox assignment changes affecting developer workflows
  - Test coverage changes impacting deployment times

### Do NOT Add New Mapping Files When:

#### ❌ Configuration Is Application-Specific
- **When:** Configuration only applies to a single application or repository
- **Why:** Should live with the application code for better cohesion
- **Action:** Store in the application repository (e.g., Bedrock)
- **Example:** Salesforce custom metadata, application feature flags

#### ❌ Configuration Contains Secrets or Sensitive Data
- **When:** File would contain API keys, passwords, tokens, or PII
- **Why:** This repository is for non-sensitive configuration only
- **Action:** Use GitHub Secrets, AWS Secrets Manager, or other secure storage
- **Example:** API credentials, OAuth tokens, encryption keys

#### ❌ Configuration Is Environment-Specific Code
- **When:** "Configuration" is actually code that should be tested and deployed
- **Why:** Code belongs in application repositories with proper testing
- **Action:** Implement as code in the appropriate repository
- **Example:** Apex classes, Lightning components, validation rules

#### ❌ Data Is Static and Never Changes
- **When:** Configuration is set once and never updated
- **Why:** No benefit to version control for truly static data
- **Action:** Hardcode in workflow or use GitHub repository variables
- **Example:** Organization IDs, permanent API endpoints

#### ❌ Configuration Is Better Suited for a Database
- **When:** Data is large, complex, or requires querying capabilities
- **Why:** JSON files are not efficient for large datasets or complex queries
- **Action:** Use a proper database or data store
- **Example:** Large datasets (>1000 records), relational data, frequently queried data

---

## 1.1 When to Update Existing Mapping Files

### Update Mapping Files When:

#### ✅ Underlying Data Changes
- **Test Coverage:** New Apex classes created, test classes refactored
- **Sandbox Assignments:** Team members join/leave, sandbox allocations change
- **General:** Any change to the entities being mapped

#### ✅ Workflow Failures Due to Outdated Mappings
- **When:** CI/CD pipeline fails because mapping is incorrect or incomplete
- **Why:** Prevents recurring failures and maintains pipeline reliability
- **Action:** Update mapping as part of failure resolution

#### ✅ Optimization Opportunities Identified
- **When:** Analysis shows mappings could be improved for better performance
- **Why:** Continuous improvement of automation efficiency
- **Example:** Adding more specific test coverage to reduce deployment time

#### ✅ Periodic Audits Reveal Discrepancies
- **When:** Regular reviews show mappings are out of sync with reality
- **Why:** Maintains accuracy and prevents gradual drift
- **Action:** Schedule regular audits (monthly/quarterly)

---

## 2. When Does the Repository Get Updated?

### Update Frequency by Mapping Type

#### Test Coverage Mappings
- **Frequency:** Continuous (as code changes)
- **Trigger:** New Apex classes, test refactoring, deployment failures
- **Owner:** Salesforce developers
- **Process:** Update in same PR as code changes when possible

#### Sandbox User Mappings
- **Frequency:** As needed (team changes)
- **Trigger:** New hires, departures, sandbox reallocation
- **Owner:** DevOps team, Engineering managers
- **Process:** Update within 1 business day of team change

#### Future Mapping Types
- **Frequency:** Defined per mapping type
- **Trigger:** Specific to use case
- **Owner:** Team responsible for the automation using the mapping
- **Process:** Documented in mapping-specific README

### General Update Principles

#### Continuous Updates (Recommended)
- **Approach:** Update mappings as soon as the underlying data changes
- **Benefits:**
  - Mappings stay synchronized with reality
  - Easier to review (context is fresh)
  - Prevents workflow failures
  - Maintains audit trail
- **Best Practice:** Link mapping updates to related code/process changes

#### Periodic Audits (Supplemental)
- **Frequency:** Monthly or quarterly per mapping type
- **Purpose:** Catch discrepancies that were missed during continuous updates
- **Process:**
  1. Export current state from source system
  2. Compare with mapping file
  3. Identify and document discrepancies
  4. Create PR to reconcile differences
  5. Update audit log

### Update Triggers

#### Mandatory Updates:
1. **Workflow Failure** → Update mapping before next run
2. **Team Member Change** → Update user mappings within 1 business day
3. **Source Data Change** → Update mapping to reflect new reality
4. **Deprecated Entry** → Remove obsolete mappings in cleanup PR
5. **Security Issue** → Immediate update if mapping causes security concern

#### Optional Updates:
1. **Performance Optimization** → Refine mappings to improve efficiency
2. **Documentation Improvements** → Update README or add inline comments
3. **Schema Evolution** → Update validation rules or structure
4. **Proactive Maintenance** → Clean up during scheduled audits

### Standard Update Process

```bash
# 1. Clone the repository (first time only)
git clone git@github.com:cargurus-ea/salesforce-test-mappings.git
cd salesforce-test-mappings

# 2. Pull latest changes
git checkout main
git pull origin main

# 3. Create a feature branch with descriptive name
# Format: <type>/<mapping-file>/<brief-description>
git checkout -b update/coverage-map/add-new-service-classes
# OR
git checkout -b update/sandbox-users/add-new-developer
# OR
git checkout -b add/new-mapping-file/feature-flags

# 4. Edit the appropriate mapping file(s)
vim coverage-maps/bedrock-coverage-map.json
# OR
vim user-mappings/github-to-sandbox.json

# 5. Validate JSON locally (REQUIRED)
jq empty <path-to-modified-file>.json

# 6. Commit with descriptive message
git add <modified-files>
git commit -m "<type>: <brief description>

<detailed explanation>

Related: <link to related PR/issue/ticket>"

# Example commit messages:
# "update: Add test coverage for NewAccountService and NewOpportunityHelper
# 
# These new service classes were introduced in bedrock PR #1234.
# Added mappings to ensure proper test execution during delta deployments.
# 
# Related: cargurus-ea/bedrock#1234"

# 7. Push to remote
git push origin <branch-name>

# 8. Create pull request
gh pr create --title "<type>: <brief description>" \
  --body "## Summary
<What changed and why>

## Mapping Type
<Test Coverage / Sandbox Users / Other>

## Impact
<Which workflows/teams are affected>

## Testing
<How was this validated>

## Related Links
<Links to related PRs, issues, tickets>"

# 9. Request review from appropriate team member(s)
# - Test coverage changes: Salesforce developer + QA
# - Sandbox user changes: DevOps + Engineering manager
# - New mapping files: DevOps + stakeholders

# 10. Address review feedback if needed

# 11. Merge after approval (squash merge preferred)
```

---

## 3. Who Has Access to the Repository?

### Repository Ownership

- **Organization:** `cargurus-ea`
- **Visibility:** Private
- **Primary Purpose:** Centralized configuration store for CI/CD and automation
- **Governance:** Managed by DevOps team with input from stakeholders

### Access Levels

#### Admin Access
- **Who:** DevOps team leads, Platform engineering managers
- **Permissions:**
  - Manage repository settings
  - Manage team access and permissions
  - Delete repository (with approval)
  - Manage branch protection rules
  - Configure webhooks and integrations
  - Manage GitHub Actions workflows
- **Responsibilities:**
  - Configure and maintain branch protection
  - Review and approve access requests
  - Manage team permissions
  - Review security settings quarterly
  - Oversee repository governance
  - Approve new mapping file additions

#### Write Access
- **Who:** 
  - Salesforce developers (for test coverage mappings)
  - DevOps engineers (for all mapping types)
  - Engineering managers (for user mappings)
  - QA engineers (for test-related mappings)
- **Permissions:**
  - Create branches
  - Push commits to feature branches
  - Create pull requests
  - Merge approved PRs (with required reviews)
  - Comment on issues and PRs
- **Responsibilities:**
  - Update mappings relevant to their domain
  - Review PRs from team members
  - Maintain mapping accuracy and completeness
  - Validate JSON before committing
  - Follow update process and commit message conventions
  - Respond to review feedback promptly

#### Read Access
- **Who:** All engineering team members, Product managers, QA team
- **Permissions:**
  - View repository contents
  - Clone repository locally
  - View issues and pull requests
  - View commit history
  - Download mapping files
- **Use Cases:**
  - Understanding automation configurations
  - Debugging deployment or workflow issues
  - Learning about CI/CD processes
  - Auditing changes for compliance
  - Planning new automation initiatives

### GitHub Actions Access

- **Service Account:** GitHub Actions workflows use `GITHUB_TOKEN`
- **Permissions:** Read-only access to download mapping files
- **Scope:** Limited to workflows in `cargurus-ea` organization repositories
- **Security:** Token automatically scoped to workflow run, expires after job completion

### Access by Mapping Type

| Mapping Type | Primary Owners | Write Access | Read Access |
|--------------|----------------|--------------|-------------|
| Test Coverage | Salesforce Developers | Salesforce team, DevOps | All engineering |
| Sandbox Users | DevOps, Eng Managers | DevOps, Managers | All engineering |
| Future Mappings | TBD per mapping | TBD per mapping | All engineering |

### Requesting Access

#### For New Team Members:
1. **Automatic Access:** New engineering team members receive Read access automatically
2. **Write Access:** Requested during onboarding by manager
3. **Process:** DevOps team grants access within 1 business day

#### For Existing Team Members:
1. **Determine Required Level:**
   - **Read:** Viewing mappings, understanding automation (default for all engineers)
   - **Write:** Updating mappings as part of regular work (developers, DevOps)
   - **Admin:** Managing repository settings (DevOps leads only)

2. **Submit Request:**
   - **Method:** Create issue in this repository OR contact DevOps team via Slack
   - **Required Information:**
     - Your GitHub username
     - Requested access level (Write/Admin)
     - Business justification
     - Which mapping types you'll be updating
   - **Example:** "Need write access to update test coverage mappings as part of Salesforce development work on Bedrock project"

3. **Approval Process:**
   - Write access: Approved by team lead or engineering manager
   - Admin access: Approved by DevOps lead + engineering director
   - Typical turnaround: 1 business day

4. **Access Granted:**
   - Receive GitHub notification
   - Verify access by cloning repository
   - Review this best practices document
   - Complete any required training

### Access Revocation

- **Automatic:** When team member leaves organization
- **Manual:** When role changes and access no longer needed
- **Audit:** Quarterly review of all access levels
- **Process:** DevOps team manages revocation within 1 business day of notification

---

## Best Practices Summary

### ✅ DO:
- **Validate JSON** before committing (use `jq empty <file>.json`)
- **Use descriptive commit messages** with context and related links
- **Request appropriate reviews** based on mapping type (see access table)
- **Update mappings promptly** when underlying data changes
- **Link to related changes** (PRs, issues, tickets) in commit messages
- **Follow branch naming conventions** (`<type>/<mapping-file>/<description>`)
- **Remove obsolete entries** during cleanup or audits
- **Document complex decisions** in commit messages or inline comments
- **Test changes locally** before pushing when possible
- **Keep mappings synchronized** with source systems
- **Use squash merges** to keep history clean
- **Review existing mappings** before adding new ones
- **Propose new mapping types** through issue discussion first
- **Update documentation** when adding new mapping types

### ❌ DON'T:
- **Commit invalid JSON** (always validate first)
- **Push directly to `main`** (use feature branches and PRs)
- **Add secrets or sensitive data** (use proper secret management)
- **Skip PR reviews** (all changes require approval)
- **Leave obsolete mappings** (clean up deleted entries)
- **Add duplicate entries** (check existing mappings first)
- **Ignore CI validation failures** (fix before merging)
- **Use vague commit messages** (provide context and reasoning)
- **Add application-specific config** (belongs in app repos)
- **Bypass branch protection** (follow established process)
- **Add new mapping types** without proposal and approval
- **Store large datasets** (>1000 records, use database instead)

---

## Troubleshooting

### Problem: Workflow Failed - Mapping Not Found

**Symptoms:** CI/CD workflow fails with "mapping not found" or similar error

**Solution:**
1. Check workflow logs to identify which mapping file is missing
2. Verify the file exists in the repository at the expected path
3. Check if workflow is using correct branch (should be `main`)
4. Verify file name matches exactly what workflow expects
5. Check repository permissions for GitHub Actions

### Problem: JSON Validation Failed in CI

**Symptoms:** PR checks fail with JSON syntax error

**Solution:**
1. Run `jq empty <path-to-file>.json` locally to identify syntax error
2. Common issues:
   - Missing or extra commas
   - Unclosed brackets or braces
   - Unescaped quotes in strings
   - Trailing commas (not allowed in JSON)
3. Fix syntax errors and push update
4. Verify CI passes before requesting review

### Problem: Mapping Exists But Workflow Still Fails

**Symptoms:** Mapping is in repository but workflow doesn't use it correctly

**Solution:**
1. Verify mapping structure matches what workflow expects
2. Check for typos in keys or values
3. Review workflow logs for parsing errors
4. Validate against schema if one exists
5. Test mapping locally if possible
6. Check if workflow is caching old version

### Problem: Don't Know What to Map

**Symptoms:** Need to create mapping but unsure of source data

**Solution:**

**For Test Coverage Mappings:**
1. Run tests in Salesforce Developer Console
2. Check "Code Coverage" section
3. Use Tooling API query:
   ```sql
   SELECT ApexTestClass.Name 
   FROM ApexCodeCoverage 
   WHERE ApexClassOrTrigger.Name = 'YourClassName'
   ```
4. Add discovered relationships to mapping

**For Sandbox User Mappings:**
1. Check with DevOps team for current assignments
2. Review onboarding documentation
3. Query Salesforce org for user list
4. Verify GitHub usernames with team members

**For New Mapping Types:**
1. Consult with team that owns the automation
2. Review source system documentation
3. Export current state from source system
4. Document mapping logic in README

### Problem: Merge Conflicts

**Symptoms:** Cannot merge PR due to conflicts in mapping file

**Solution:**
1. Pull latest `main` branch: `git checkout main && git pull`
2. Checkout your feature branch: `git checkout <your-branch>`
3. Merge main into your branch: `git merge main`
4. Resolve conflicts in mapping file:
   - Keep both changes if they don't overlap
   - Maintain alphabetical order if applicable
   - Ensure JSON remains valid
5. Validate JSON: `jq empty <file>.json`
6. Commit resolution: `git commit -m "Resolve merge conflicts"`
7. Push: `git push origin <your-branch>`

### Problem: Need to Rollback a Change

**Symptoms:** Recent mapping change caused issues, need to revert

**Solution:**
1. Identify the problematic commit hash
2. Create revert PR:
   ```bash
   git checkout main
   git pull
   git checkout -b revert/problematic-change
   git revert <commit-hash>
   git push origin revert/problematic-change
   ```
3. Create PR with explanation of why revert is needed
4. Get expedited review and merge
5. Verify workflows work with reverted state
6. Investigate root cause and create fix PR

---

## Maintenance Guidelines

### Monthly Review Checklist

**Repository Health:**
- [ ] Review recent PRs for mapping accuracy
- [ ] Check for obsolete mappings (deleted entities)
- [ ] Verify JSON schema compliance for all mapping files
- [ ] Review CI validation workflow status
- [ ] Update documentation if needed
- [ ] Check for duplicate entries across mapping files
- [ ] Verify team access levels are current
- [ ] Review and close stale issues/PRs

**Per Mapping Type:**
- [ ] Test Coverage: Compare with Salesforce Tooling API data
- [ ] Sandbox Users: Verify against current team roster
- [ ] Other: Audit against source system

### Quarterly Audit Process

#### 1. Export Current State from Source Systems

**Test Coverage Mappings:**
```bash
sf data query --query "SELECT ApexClassOrTrigger.Name, ApexTestClass.Name FROM ApexCodeCoverage" \
  --target-org production --result-format json > actual-coverage.json
```

**Sandbox User Mappings:**
```bash
# Export from HR system or manually compile
# Format: GitHub username, Salesforce username, Sandbox name
```

**Other Mappings:**
- Follow mapping-specific audit procedures
- Document in mapping-specific README

#### 2. Compare with Repository Mappings

```bash
# Clone repository
git clone git@github.com:cargurus-ea/salesforce-test-mappings.git
cd salesforce-test-mappings

# For each mapping type:
# - Identify entities in source but not in mapping
# - Identify mappings for non-existent entities
# - Document discrepancies
```

#### 3. Create Reconciliation PR

```bash
git checkout -b audit/quarterly-reconciliation-YYYY-QN
# Update mapping files
git add .
git commit -m "audit: Quarterly reconciliation for YYYY QN

Reconciled mappings with source systems.

Changes:
- Added X new entries
- Removed Y obsolete entries
- Updated Z existing entries

Audit date: YYYY-MM-DD"
git push origin audit/quarterly-reconciliation-YYYY-QN
gh pr create --title "Quarterly Audit: Reconcile mappings for YYYY QN"
```

#### 4. Document Audit Results

- Update `CHANGELOG.md` with audit summary
- Create audit report with:
  - Date of audit
  - Mapping types audited
  - Number of changes per type
  - Issues discovered
  - Recommendations
- Share findings in team meeting or Slack
- File issues for any systemic problems discovered

### Annual Review

**Repository Structure:**
- [ ] Review directory organization
- [ ] Evaluate if new mapping types need separate directories
- [ ] Update validation workflows
- [ ] Review and update documentation
- [ ] Assess if repository is still meeting needs

**Access Control:**
- [ ] Full audit of all user access levels
- [ ] Remove access for departed team members
- [ ] Update team permissions based on role changes
- [ ] Review GitHub Actions permissions
- [ ] Document access control decisions

**Process Improvements:**
- [ ] Survey team on pain points
- [ ] Identify automation opportunities
- [ ] Review and update best practices
- [ ] Update training materials
- [ ] Plan improvements for next year

---

## Repository Structure

```
salesforce-test-mappings/
├── README.md                          # This document
├── CHANGELOG.md                       # History of significant changes
├── coverage-maps/
│   ├── README.md                      # Test coverage mapping documentation
│   ├── bedrock-coverage-map.json     # Bedrock test coverage mappings
│   └── schema.json                    # JSON schema for validation
├── user-mappings/
│   ├── README.md                      # User mapping documentation
│   └── github-to-sandbox.json        # GitHub → Sandbox assignments
├── .github/
│   └── workflows/
│       └── validate-json.yml          # CI validation workflow
└── [future-mapping-directories]/      # Additional mapping types as needed
```

---

## Adding New Mapping Types

When adding a new type of mapping to this repository:

1. **Create Proposal:**
   - Open an issue describing the new mapping type
   - Include: purpose, structure, update frequency, ownership
   - Tag relevant stakeholders for input

2. **Get Approval:**
   - DevOps team reviews proposal
   - Stakeholders provide feedback
   - Approval required before implementation

3. **Create Structure:**
   - Create new directory: `<mapping-type>/`
   - Add mapping file: `<mapping-type>/<descriptive-name>.json`
   - Add README: `<mapping-type>/README.md` with:
     - Purpose and use cases
     - Structure and schema
     - Update procedures
     - Ownership and contacts
   - Add schema if applicable: `<mapping-type>/schema.json`

4. **Update Validation:**
   - Update `.github/workflows/validate-json.yml` to include new mapping
   - Add structure validation if needed
   - Test validation workflow

5. **Update Documentation:**
   - Update this README with new mapping type
   - Add to "Current Mapping Types" section
   - Document in `CHANGELOG.md`
   - Update access control table

6. **Communicate:**
   - Announce new mapping type to team
   - Provide training if needed
   - Update onboarding materials

---

## Related Documentation

### Internal Documentation
- [Migration Plan: Gist to Repository](./MIGRATION_PLAN_Gist_to_Repository.md)
- [Test Coverage Mappings README](./coverage-maps/README.md)
- [Sandbox User Mappings README](./user-mappings/README.md)
- [Delta Deployment Workflow](https://github.com/cargurus-ea/bedrock/.github/workflows/INTQA_Delta_Deployment.yml)

### External Documentation
- [Salesforce Test Coverage Documentation](https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_testing_code_coverage.htm)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [JSON Schema Documentation](https://json-schema.org/)

---

## Support & Questions

For questions about the `salesforce-test-mappings` repository:

### Technical Issues
- **Method:** Open an issue in this repository
- **Include:** Mapping type, error messages, steps to reproduce
- **Response Time:** 1 business day

### Access Requests
- **Method:** Contact DevOps team via Slack or create issue
- **Include:** GitHub username, access level needed, justification
- **Response Time:** 1 business day

### Best Practices Questions
- **Method:** Refer to this document or ask in team Slack channel
- **Channel:** #devops or #salesforce-dev
- **Response Time:** Same day during business hours

### Urgent Issues
- **Method:** Contact on-call DevOps engineer
- **When:** Production workflow failures, security issues
- **Response Time:** Immediate

### Feedback & Improvements
- **Method:** Open an issue with "enhancement" label
- **Include:** Current pain point, proposed solution, impact
- **Review:** Monthly during maintenance review

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for detailed history of changes.

---

**Document Version:** 1.0  
**Last Updated:** January 2026  
**Owner:** DevOps Team  
**Next Review:** April 2026
