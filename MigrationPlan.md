# Migration Plan: Gist to Repository for JSON Test Coverage Mappings

## Overview

This document outlines the plan to migrate JSON test coverage mappings from a GitHub Gist to a dedicated repository. The current Delta Deployment workflow downloads these mappings from a Gist using the `TEST_COVERAGE_GIST_URL` secret. This migration will provide better version control, organization ownership, and team collaboration capabilities.

---

## Phase 1: Repository Setup

### 1.1 Create New Repository

**Repository Name:** `salesforce-test-mappings` (or `sfdc-deployment-config`)

**Rationale:** 
- Platform-agnostic name (not tied to Bedrock/SFDC implementation)
- Can store other deployment configurations in the future
- Clear purpose from the name

**Repository Structure:**
```
salesforce-test-mappings/
├── README.md                          # Documentation
├── coverage-maps/
│   ├── bedrock-coverage-map.json     # Your current Gist content
│   └── schema.json                    # JSON schema for validation
├── .github/
│   └── workflows/
│       └── validate-json.yml          # CI to validate JSON structure
└── CHANGELOG.md                       # Track changes to mappings
```

**Access Control:**
- **Owner:** `cargurus-ea` organization
- **Team Access:** Grant your Bedrock team write access
- **Visibility:** Private repository (contains internal deployment logic)

### 1.2 Initialize Repository

```bash
# Create repository via GitHub CLI or web UI
gh repo create cargurus-ea/salesforce-test-mappings --private --description "Test coverage mappings for Salesforce delta deployments"

# Clone and set up structure
git clone git@github.com:cargurus-ea/salesforce-test-mappings.git
cd salesforce-test-mappings

# Create directory structure
mkdir -p coverage-maps .github/workflows

# Add README
cat > README.md << 'EOF'
# Salesforce Test Mappings

This repository contains test coverage mappings used by CI/CD pipelines for intelligent test selection during delta deployments.

## Structure

- `coverage-maps/` - JSON files mapping Apex classes to their test classes
- `coverage-maps/bedrock-coverage-map.json` - Coverage map for Bedrock repository

## Usage

The coverage maps are consumed by GitHub Actions workflows to determine which test classes to run based on changed Apex classes.

## Updating Mappings

1. Edit the appropriate JSON file in `coverage-maps/`
2. Validate JSON structure (CI will run automatically)
3. Commit and push changes
4. Update workflows will automatically use the latest version

## JSON Schema

Coverage maps follow this structure:
```json
{
  "coverage": {
    "ApexClassName": ["TestClass1", "TestClass2"],
    "AnotherClass": ["TestClass3"]
  }
}
```
EOF

# Commit initial structure
git add .
git commit -m "Initial repository structure"
git push origin main
```

---

## Phase 2: Migrate Gist Content

### 2.1 Export from Gist

```bash
# Download current Gist content
GIST_URL="<your-gist-raw-url>"
curl -H "Authorization: token $GITHUB_TOKEN" \
  "$GIST_URL" \
  -o coverage-maps/bedrock-coverage-map.json

# Verify JSON is valid
jq empty coverage-maps/bedrock-coverage-map.json && echo "Valid JSON" || echo "Invalid JSON"
```

### 2.2 Add JSON Schema (Optional but Recommended)

Create `coverage-maps/schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "coverage": {
      "type": "object",
      "patternProperties": {
        "^[A-Za-z0-9_]+$": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      }
    }
  },
  "required": ["coverage"]
}
```

### 2.3 Add Validation Workflow

Create `.github/workflows/validate-json.yml`:

```yaml
name: Validate JSON Mappings

on:
  pull_request:
    paths:
      - 'coverage-maps/**/*.json'
  push:
    branches:
      - main
    paths:
      - 'coverage-maps/**/*.json'

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3
      
      - name: Validate JSON syntax
        run: |
          for file in coverage-maps/*.json; do
            if [ "$file" != "coverage-maps/schema.json" ]; then
              echo "Validating $file..."
              jq empty "$file" || exit 1
            fi
          done
      
      - name: Check coverage map structure
        run: |
          for file in coverage-maps/*-coverage-map.json; do
            echo "Checking structure of $file..."
            if ! jq -e '.coverage' "$file" > /dev/null; then
              echo "Error: $file missing 'coverage' key"
              exit 1
            fi
          done
```

### 2.4 Commit and Push

```bash
git add coverage-maps/ .github/
git commit -m "Migrate coverage map from Gist and add validation"
git push origin main
```

---

## Phase 3: Update Delta Deployment Workflow

### 3.1 Update Workflow File

Modify `.github/workflows/INTQA_Delta_Deployment.yml` (lines 116-151).

**Replace the "Download Coverage Map from Gist" step:**

```yaml
      # Download coverage map from GitHub repository
      - name: Download Coverage Map from Repository
        if: ${{ steps.build_manifest.outputs.changesFound == 'true' }}
        id: download_coverage_map
        run: |
          echo "Downloading test coverage map from repository..."
          
          # Repository details
          REPO_OWNER="cargurus-ea"
          REPO_NAME="salesforce-test-mappings"
          FILE_PATH="coverage-maps/bedrock-coverage-map.json"
          BRANCH="main"
          
          # Construct raw GitHub URL
          RAW_URL="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${FILE_PATH}"
          
          echo "Downloading from: $RAW_URL"
          
          # Download the coverage map to Bedrock/Bedrock directory
          if curl -H "Authorization: token ${{ secrets.GITHUB_TOKEN }}" \
            "$RAW_URL" \
            -o Bedrock/Bedrock/coverage-map.json -f 2>/dev/null; then
            
            if [ -f "Bedrock/Bedrock/coverage-map.json" ] && [ -s "Bedrock/Bedrock/coverage-map.json" ]; then
              echo "Coverage map downloaded successfully"
              echo "coverage_map_downloaded=true" >> $GITHUB_OUTPUT
              echo "File size: $(wc -c < Bedrock/Bedrock/coverage-map.json) bytes"
              
              # Validate JSON structure
              if jq -e '.coverage' Bedrock/Bedrock/coverage-map.json > /dev/null; then
                echo "Coverage map structure validated"
              else
                echo "Warning: Coverage map missing 'coverage' key"
              fi
            else
              echo "Failed to download coverage map - file is empty or missing"
              echo "coverage_map_downloaded=false" >> $GITHUB_OUTPUT
            fi
          else
            echo "Error downloading from repository - HTTP request failed"
            echo "coverage_map_downloaded=false" >> $GITHUB_OUTPUT
          fi
```

### 3.2 Update Test Finder Step

Modify `.github/workflows/INTQA_Delta_Deployment.yml` (lines 154-221).

**Update line 167 to use new output variable:**

```yaml
            if [ "${{ steps.download_coverage_map.outputs.coverage_map_downloaded }}" = "true" ] && [ -f "coverage-map.json" ]; then
```

**Change from:**
```yaml
            if [ "${{ steps.download_gist.outputs.gist_downloaded }}" = "true" ] && [ -f "coverage-map.json" ]; then
```

---

## Phase 4: Update GitHub Secrets

### 4.1 Remove Old Secrets

```bash
# Via GitHub CLI
gh secret remove TEST_COVERAGE_GIST_URL --repo cargurus-ea/bedrock
gh secret remove GIST_TOKEN --repo cargurus-ea/bedrock
```

Or via GitHub Web UI:
1. Navigate to `https://github.com/cargurus-ea/bedrock/settings/secrets/actions`
2. Delete `TEST_COVERAGE_GIST_URL`
3. Delete `GIST_TOKEN`

### 4.2 Verify GITHUB_TOKEN Permissions

The workflow already uses `${{ secrets.GITHUB_TOKEN }}` which should have read access to private repositories in the same organization. Verify the workflow has proper permissions.

Add to the top of your workflow file if not already present:

```yaml
permissions:
  contents: read
  packages: read
```

---

## Phase 5: Testing & Validation

### 5.1 Test in Non-Production First

1. Create a test branch in Bedrock:
   ```bash
   cd /path/to/bedrock
   git checkout -b test/coverage-map-migration
   ```

2. Update the workflow file with the new download step

3. Commit and push:
   ```bash
   git add .github/workflows/INTQA_Delta_Deployment.yml
   git commit -m "Update workflow to use coverage map from repository"
   git push origin test/coverage-map-migration
   ```

4. Trigger a manual workflow run:
   ```bash
   gh workflow run "INTQA Delta Deployment" --ref test/coverage-map-migration
   ```

5. Monitor the "Download Coverage Map from Repository" step

6. Verify coverage map downloads successfully

7. Verify test class selection works correctly

### 5.2 Validation Checklist

- [ ] Coverage map downloads successfully
- [ ] JSON structure is valid
- [ ] Test classes are correctly identified from coverage map
- [ ] Fallback to name-based detection works if map fails
- [ ] Deployment completes successfully
- [ ] No references to old Gist URL remain

### 5.3 Rollback Plan

If issues occur:

1. Revert workflow changes:
   ```bash
   git revert <commit-hash>
   git push origin main
   ```

2. Re-add secrets via GitHub CLI:
   ```bash
   gh secret set TEST_COVERAGE_GIST_URL --repo cargurus-ea/bedrock
   gh secret set GIST_TOKEN --repo cargurus-ea/bedrock
   ```

3. Monitor next deployment to ensure it works with old Gist approach

---

## Phase 6: Documentation & Cleanup

### 6.1 Update Bedrock Documentation

Add to `README.md` or create `scripts/shell/README-Delta-Deployment.md`:

```markdown
## Delta Deployment Test Coverage

The INTQA Delta Deployment workflow uses test coverage mappings stored in the 
[salesforce-test-mappings](https://github.com/cargurus-ea/salesforce-test-mappings) repository.

### Updating Coverage Mappings

1. Clone the repository: `git clone git@github.com:cargurus-ea/salesforce-test-mappings.git`
2. Edit `coverage-maps/bedrock-coverage-map.json`
3. Validate JSON: `jq empty coverage-maps/bedrock-coverage-map.json`
4. Commit and push changes
5. Next deployment will automatically use updated mappings

### Coverage Map Structure

```json
{
  "coverage": {
    "ApexClassName": ["TestClass1", "TestClass2"]
  }
}
```

### How It Works

The Delta Deployment workflow:
1. Detects changed Apex classes since last deployment tag
2. Downloads coverage map from `salesforce-test-mappings` repository
3. Looks up each changed class in the coverage map
4. Runs only the test classes that cover the changed code
5. Falls back to name-based detection if coverage map unavailable
```

### 6.2 Archive or Delete Gist

Once migration is confirmed successful (after 1-2 weeks):

1. Add a deprecation notice to the Gist:
   ```
   DEPRECATED: This Gist has been migrated to:
   https://github.com/cargurus-ea/salesforce-test-mappings
   
   Please update any references to use the new repository.
   ```

2. Consider making the Gist private or deleting it after a grace period

---

## Benefits of This Approach

✅ **Organization Ownership** - Repository owned by `cargurus-ea`, not individual user  
✅ **Version Control** - Full Git history of coverage map changes  
✅ **Access Control** - Fine-grained team permissions  
✅ **Validation** - Automated JSON validation via CI  
✅ **Discoverability** - Easier for team members to find and update  
✅ **Scalability** - Can add more coverage maps for other projects  
✅ **No Token Management** - Uses built-in `GITHUB_TOKEN`  
✅ **Audit Trail** - Track who changed what and when  
✅ **Pull Request Reviews** - Changes can be reviewed before merging  
✅ **Issue Tracking** - Can track problems with mappings  
✅ **Team Collaboration** - Multiple team members can contribute  

---

## Timeline Estimate

| Phase | Description | Estimated Time |
|-------|-------------|----------------|
| Phase 1-2 | Setup & Migration | 30 minutes |
| Phase 3 | Update Workflow | 15 minutes |
| Phase 4 | Secrets Management | 5 minutes |
| Phase 5 | Testing & Validation | 1-2 hours |
| Phase 6 | Documentation & Cleanup | 15 minutes |
| **Total** | | **2.5-3 hours** |

---

## Key Files Modified

- `.github/workflows/INTQA_Delta_Deployment.yml` - Update download step and references
- New repository: `cargurus-ea/salesforce-test-mappings`
- Documentation: `scripts/shell/README-Delta-Deployment.md` (new)

---

## Success Criteria

✅ Coverage map successfully downloads from new repository  
✅ Test class selection works correctly  
✅ Deployment completes without errors  
✅ Team can update mappings via pull requests  
✅ Old Gist is deprecated/archived  
✅ Documentation is updated  

---

## Support & Questions

For questions or issues during migration:
- Review GitHub Actions logs for the workflow run
- Check the `salesforce-test-mappings` repository for validation errors
- Verify `GITHUB_TOKEN` has proper permissions
- Consult this migration plan for rollback procedures

---

**Migration Date:** _To be scheduled_  
**Migration Owner:** _To be assigned_  
**Status:** Planning Phase
