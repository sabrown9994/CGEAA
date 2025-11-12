# Git Best Practices Guide

This guide outlines essential Git practices for maintaining code quality, collaboration efficiency, and deployment safety in the Bedrock repository.

---

## Table of Contents
1. [Branches](#branches)
2. [Commits](#commits)
3. [Pull Requests](#pull-requests)

---

## Branches

### Why We Use Branches

Branches allow developers to:
- **Isolate work**: Develop features independently without affecting the main codebase
- **Collaborate safely**: Multiple developers can work simultaneously without conflicts
- **Enable code review**: Changes can be reviewed before merging into protected branches
- **Maintain stability**: Keep production-ready code stable while development continues
- **Track features**: Each branch represents a specific unit of work tied to a JIRA ticket

### Naming Convention

**Standard Format**: `Feature/PGTM-XXX`

Where:
- `Feature/` - Prefix indicating this is a feature branch
- `PGTM-XXX` - JIRA ticket number (e.g., PGTM-1234)

#### ✅ Good Examples
```
Feature/PGTM-1234
Feature/PGTM-5678
Feature/PGTM-999
```

#### ❌ Bad Examples
```
feature/pgtm-1234           # Wrong capitalization
PGTM-1234                   # Missing Feature/ prefix
Feature/fix-bug             # No JIRA ticket number
john-working-branch         # No ticket reference
Feature/PGTM-1234-v2        # Versioning in branch name
Feature/PGTM-1234-final     # Ambiguous suffixes
```

### Why Maintain ONE Feature Branch

**The Rule**: One JIRA ticket = One feature branch

#### Benefits of Single Feature Branches

1. **Clear Traceability**: Easy to track what changes belong to which ticket
2. **Simplified Code Review**: All related changes are in one place
3. **Easier Rollback**: If needed, remove all changes for a feature at once
4. **Prevents Confusion**: Team members know exactly where work is happening
5. **Cleaner Git History**: Linear progression of changes per feature

#### ✅ Good Practice
```
Scenario: Working on PGTM-1234 to add user authentication

1. Create branch: Feature/PGTM-1234
2. Make all authentication-related changes in this branch
3. Commit multiple times as you progress
4. Create ONE pull request when ready
5. Merge and delete the branch when complete
```

#### ❌ Bad Practice
```
Scenario: Working on PGTM-1234 to add user authentication

1. Create branch: Feature/PGTM-1234
2. Make some changes, get stuck
3. Create branch: Feature/PGTM-1234-take2
4. Make more changes, try different approach
5. Create branch: Feature/PGTM-1234-final
6. Now have 3 branches for one ticket - confusing!
```

#### What If You Need a Fresh Start?

**Don't create a new branch!** Instead:

```bash
# Option 1: Reset your existing branch (if not pushed)
git reset --hard origin/BRInt

# Option 2: Revert specific commits
git revert <commit-hash>

# Option 3: Merge latest changes from target branch
git merge BRInt
```

#### What If You Already Created Multiple Branches?

**Consolidate into one:**

```bash
# 1. Checkout your main feature branch
git checkout Feature/PGTM-1234

# 2. Merge changes from other branches
git merge Feature/PGTM-1234-take2
git merge Feature/PGTM-1234-final

# 3. Delete extra branches
git branch -D Feature/PGTM-1234-take2
git branch -D Feature/PGTM-1234-final

# 4. Push consolidated branch
git push origin Feature/PGTM-1234
```

---

## Commits

### Commit Often with Small, Distinct Changes

**The Rule**: Each commit should represent ONE logical change

#### Why Commit Often?

1. **Easier to Review**: Small commits are easier for reviewers to understand
2. **Safer Rollback**: Can revert specific changes without losing other work
3. **Better History**: Clear progression of how feature was built
4. **Easier Debugging**: Use `git bisect` to find when bugs were introduced
5. **Saves Work**: Commits are saved points you can return to

#### ✅ Good Practice - Small, Focused Commits
```bash
# Working on authentication feature (PGTM-1234)

git commit -m "Add LoginController Apex class"
git commit -m "Add login method with OAuth support"
git commit -m "Add unit tests for LoginController"
git commit -m "Add LoginForm LWC component"
git commit -m "Add error handling to login flow"
```

Each commit is:
- **Atomic**: One specific change
- **Compilable**: Code still works after this commit
- **Testable**: Can verify this specific change

#### ❌ Bad Practice - Large, Monolithic Commits
```bash
# One giant commit with everything
git commit -m "Added login feature"

# This commit includes:
# - 5 new Apex classes
# - 3 new LWC components
# - Test classes
# - Configuration changes
# - Bug fixes for unrelated issues
```

Problems:
- Impossible to review thoroughly
- Can't revert parts of it
- Unclear what changed and why
- Mixing unrelated changes

### Descriptive Commit Messages

**The Rule**: Commit messages should clearly explain WHAT changed and WHY

#### Anatomy of a Good Commit Message

```
[Verb] [What] - [Optional: Why/Context]

Examples:
Add LoginController with OAuth authentication
Fix null pointer exception in LoginController.authenticate()
Update LoginForm to handle session timeout
Refactor authentication logic for better testability
Remove deprecated login method
```

#### ✅ Good Examples
```bash
git commit -m "Add validation rule for Canadian provinces"
git commit -m "Fix discount calculation for multi-year subscriptions"
git commit -m "Update QuoteLine trigger to handle bundle pricing"
git commit -m "Remove unused fields from Account object"
git commit -m "Refactor CG_FeatureHelper to improve performance"
git commit -m "Add unit tests for NetSuiteAuthUtil OAuth signature"
```

Each message:
- **Starts with action verb**: Add, Fix, Update, Remove, Refactor
- **Describes what changed**: Specific component or functionality
- **Uses present tense**: "Add" not "Added"
- **Is concise but complete**: No need to guess what changed

#### ❌ Bad Examples
```bash
git commit -m "changes"
git commit -m "fix"
git commit -m "updates"
git commit -m "stuff"
git commit -m "WIP"
git commit -m "fixed the bug"                    # Which bug?
git commit -m "updated code"                     # What code?
git commit -m "PGTM-1234"                        # Only ticket number
git commit -m "Made some changes to the file"    # Which file? What changes?
```

Problems:
- No context about what changed
- Future you won't remember what this was
- Reviewers can't understand changes from message
- Hard to find specific changes later

### Merging Changes, Not Copying

**The Rule**: Never copy commits between branches - use merge or cherry-pick

#### Why This Matters

Git tracks the **history** of changes, not just the code. When you copy changes:
- ❌ Lose commit history and authorship
- ❌ Create duplicate commits with different hashes
- ❌ Make it impossible to track where changes originated
- ❌ Cause confusion during code review
- ❌ Break `git blame` and history tracking

#### ✅ Good Practice - Merge Changes

**Scenario**: You made changes in `Feature/PGTM-1234` but need them in `Feature/PGTM-5678`

```bash
# Don't copy files! Instead, merge the commits:

# 1. Checkout target branch
git checkout Feature/PGTM-5678

# 2. Merge source branch
git merge Feature/PGTM-1234

# Now Feature/PGTM-5678 has the commits from PGTM-1234
# History is preserved, attribution is maintained
```

#### ✅ Good Practice - Cherry-Pick Specific Commits

**Scenario**: You only need ONE specific commit from another branch

```bash
# 1. Find the commit hash you need
git log Feature/PGTM-1234
# Example: abc123def456 "Add LoginController with OAuth"

# 2. Checkout target branch
git checkout Feature/PGTM-5678

# 3. Cherry-pick that specific commit
git cherry-pick abc123def456

# Now Feature/PGTM-5678 has that one commit
# Original commit hash and author preserved
```

#### ❌ Bad Practice - Copying Changes Manually

```bash
# ❌ DON'T DO THIS:

# 1. See changes in Feature/PGTM-1234
git diff Feature/PGTM-1234

# 2. Copy the code changes manually into files in Feature/PGTM-5678
# 3. Commit as new changes
git add .
git commit -m "Added login code"

# Problems:
# - Lost original commit message
# - Lost original author
# - Lost commit history
# - Created duplicate commit with different hash
# - Impossible to track this was from PGTM-1234
```

#### ❌ Bad Practice - Copying Files Between Branches

```bash
# ❌ DON'T DO THIS:

# 1. In Feature/PGTM-1234, copy files
cp force-app/main/default/classes/LoginController.cls ~/temp/

# 2. Switch branches
git checkout Feature/PGTM-5678

# 3. Paste files
cp ~/temp/LoginController.cls force-app/main/default/classes/

# 4. Commit
git add .
git commit -m "Added LoginController"

# This completely loses the commit history!
```

#### When You Need Changes From Main Branch

**Keep your feature branch up-to-date with target branch:**

```bash
# You're working in Feature/PGTM-1234
# Other people merged changes to BRInt
# You need those latest changes

# ✅ Good: Merge target branch into feature branch
git checkout Feature/PGTM-1234
git merge BRInt

# This brings in all new commits from BRInt
# Your commits stay intact
# History shows where changes came from
```

---

## Pull Requests

### Naming Convention

**Standard Format**: `(target-env) Feature/PGTM-XXX`

Where:
- `(target-env)` - The environment/branch you're merging TO
- `Feature/PGTM-XXX` - Your feature branch name

#### Common Target Environments
- `BRInt` - Integration environment (development)
- `BRStaging` - Staging environment (pre-production)
- `main` - Production environment

#### ✅ Good Examples
```
(BRInt) Feature/PGTM-1234
(BRStaging) Feature/PGTM-5678
(main) Feature/PGTM-999
```

**Why this format?**
- Immediately clear what environment this affects
- Easy to filter PRs by target branch
- Prevents accidentally merging to wrong branch
- Helps reviewers understand the context

#### ❌ Bad Examples
```
Feature/PGTM-1234                    # Missing target env
Add authentication feature           # Missing branch and ticket reference
PGTM-1234 authentication             # Missing target env and branch prefix
(main) Fix login bug                 # Missing branch name and ticket
Feature/PGTM-1234 -> BRInt          # Using arrow instead of parentheses
```

### Why Approval Requirements Matter

**Branch Protection Rules** enforce code quality and prevent unauthorized deployments.

#### Approval Requirements by Branch

Based on the repository's audit configuration:

| Target Branch | Required Approvals | Rationale |
|--------------|-------------------|-----------|
| **BRInt** | 2 approvals | Integration environment - higher risk, affects all developers |
| **BRStaging** | 1 approval | Pre-production - needs validation before production |
| **main** | 1 approval | Production - critical but staging should catch issues |

#### Important Rules

1. **Self-approvals don't count**: You cannot approve your own PR
2. **Latest review wins**: If a reviewer changes their mind, only their most recent review status counts
3. **All required approvals must be present**: Before merging, ensure you have the correct number of approvals
4. **Violations are tracked**: PRs merged without proper approvals are flagged in audit reports

#### ✅ Good Practice - BRInt PR Example

```
PR: (BRInt) Feature/PGTM-1234
Author: developer1

Reviewers:
✅ developer2 - APPROVED
✅ developer3 - APPROVED

Status: ✅ Ready to merge (2 approvals)
```

#### ❌ Bad Practice - BRInt PR Example

```
PR: (BRInt) Feature/PGTM-1234
Author: developer1

Reviewers:
✅ developer1 - APPROVED (self-approval)
✅ developer2 - APPROVED

Status: ❌ NOT ready to merge
Reason: Self-approvals don't count, only 1 real approval
Needs: 1 more approval from different developer
```

#### ✅ Good Practice - Handling Review Changes

```
PR: (BRInt) Feature/PGTM-1234
Author: developer1

Review Timeline:
1. developer2 - APPROVED
2. developer3 - REQUESTED_CHANGES (found issue)
3. developer1 - Fixed the issue, requested re-review
4. developer3 - APPROVED (latest review)
5. developer4 - APPROVED

Status: ✅ Ready to merge
- developer3's latest review is APPROVED (previous REQUESTED_CHANGES is superseded)
- Total: 3 approvals (meets 2 approval requirement for BRInt)
```

#### ❌ Bad Practice - Merging Too Early

```
PR: (BRInt) Feature/PGTM-1234
Author: developer1

Reviewers:
✅ developer2 - APPROVED
⏳ developer3 - Review pending

Status: ❌ Merged anyway
Result: ⚠️ VIOLATION - Merged with only 1 approval (needs 2)

This will show up in audit reports:
"PR #456 merged by developer1 with 1 approval(s), required 2"
```

#### Why These Rules Exist

1. **Prevent Bad Code**: Multiple reviewers catch more issues
2. **Knowledge Sharing**: More people understand the changes
3. **Accountability**: Changes are reviewed and approved by team
4. **Risk Management**: Higher-risk environments need more oversight
5. **Compliance**: Audit trail shows changes were properly reviewed

#### Audit Script

The repository includes an audit script that checks compliance:

```bash
# Located at: scripts/shell/audit_pr_approvals.sh
# Run to check for approval violations:

./audit_pr_approvals.sh -o cargurus-ea -r bedrock -t YOUR_TOKEN -d 30

# This checks:
# ✓ All merged PRs in last 30 days
# ✓ Correct number of approvals per branch
# ✓ Self-approvals are excluded
# ✓ Only latest review status counts
# ✓ Shows who merged violating PRs
```

**What happens if violations are found?**
- Audit report shows violating PRs
- Exit code 1 (failure) to flag in CI/CD
- Team is notified to review process
- May require additional review of merged code

### Pull Request Best Practices Summary

#### Before Creating PR

- [ ] Ensure branch follows naming convention: `Feature/PGTM-XXX`
- [ ] All commits are pushed to remote
- [ ] Code compiles and passes local tests
- [ ] No merge conflicts with target branch

#### Creating PR

- [ ] Use correct naming format: `(target-env) Feature/PGTM-XXX`
- [ ] Write clear description of changes
- [ ] Link to JIRA ticket
- [ ] Request reviews from appropriate team members
- [ ] Add labels if applicable (bug, enhancement, etc.)

#### During Review

- [ ] Respond to review comments promptly
- [ ] Make requested changes in new commits (don't force push)
- [ ] Re-request review after making changes
- [ ] Be open to feedback and suggestions

#### Before Merging

- [ ] Verify required number of approvals:
  - BRInt: 2 approvals
  - BRStaging: 1 approval
  - main: 1 approval
- [ ] Ensure no self-approvals counted
- [ ] All review comments resolved
- [ ] CI/CD checks passing
- [ ] No merge conflicts

#### After Merging

- [ ] Delete feature branch (keep repo clean)
- [ ] Verify deployment successful
- [ ] Update JIRA ticket status
- [ ] Notify team if changes affect their work

---

## Quick Reference

### Branch Workflow
```bash
# 1. Create feature branch from target branch
git checkout BRInt
git pull
git checkout -b Feature/PGTM-1234

# 2. Make changes and commit often
git add <files>
git commit -m "Add specific feature"

# 3. Push to remote
git push origin Feature/PGTM-1234

# 4. Create PR with format: (BRInt) Feature/PGTM-1234

# 5. After merge, delete branch
git checkout BRInt
git pull
git branch -D Feature/PGTM-1234
```

### Commit Message Templates
```bash
# Feature additions
git commit -m "Add [component] with [functionality]"

# Bug fixes
git commit -m "Fix [issue] in [component]"

# Updates
git commit -m "Update [component] to [new behavior]"

# Refactoring
git commit -m "Refactor [component] for [reason]"

# Removal
git commit -m "Remove [component/feature] - [reason]"
```

### Getting Help

- **Git Documentation**: https://git-scm.com/doc
- **GitHub Flow Guide**: https://guides.github.com/introduction/flow/
- **Ask the Team**: When in doubt, ask before merging!

---

## Remember

> "Good Git practices aren't just about following rules - they're about making our team more effective, our code more maintainable, and our deployments more reliable."

### The Core Principles

1. **One feature = One branch = One PR**
2. **Commit small and often with clear messages**
3. **Never copy commits - always merge or cherry-pick**
4. **Get proper approvals before merging**
5. **Keep branches short-lived and focused**

Following these practices protects everyone on the team and makes our codebase better!
