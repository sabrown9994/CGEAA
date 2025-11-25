# Test Coverage Map Sync Workflow

## Overview

This GitHub Action workflow automatically maintains a JSON map of Apex test class coverage in a GitHub Gist. It runs all local tests in your Salesforce org, queries the `ApexCodeCoverage` object for detailed coverage data, and updates a Gist with the results.

## Features

- ✅ Runs all local tests with code coverage enabled
- ✅ Queries Salesforce `ApexCodeCoverage` for detailed class-to-test mappings
- ✅ Generates a JSON map: `{ "ApexClass": ["TestClass1", "TestClass2"] }`
- ✅ Updates a GitHub Gist automatically
- ✅ Sends Slack notifications on success/failure
- ✅ Archives test results as workflow artifacts
- ✅ Runs weekly on schedule or manually via workflow_dispatch

## Setup Instructions

### 1. Create a GitHub Gist

1. Go to https://gist.github.com/
2. Create a new **public** or **secret** gist
3. Name the file: `test-coverage-map.json`
4. Add initial content (can be empty JSON object):
   ```json
   {
     "version": "1.0",
     "lastUpdated": "2025-11-24T12:46:34Z",
     "description": "Salesforce Test Coverage Map - Maps Apex classes to their test classes",
     "recordCount": 0,
     "coverage": {}
   }
   ```
5. Save the gist and copy the **Gist ID** from the URL
   - Example URL: `https://gist.github.com/username/abc123def456`
   - Gist ID: `abc123def456`

### 2. Create a GitHub Personal Access Token

1. Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Give it a descriptive name: "Test Coverage Gist Update"
4. Select scopes:
   - ✅ `gist` - Create and update gists
5. Generate token and **copy it immediately** (you won't see it again)

### 3. Add GitHub Secrets

Add the following secrets to your repository (Settings → Secrets and variables → Actions):

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `GIST_TOKEN` | GitHub Personal Access Token with `gist` scope | `ghp_xxxxxxxxxxxx` |
| `TEST_COVERAGE_GIST_ID` | The ID of your gist from step 1 | `abc123def456` |
| `SFDX_INTQA_AUTH_URL` | Salesforce auth URL (already exists) | `force://...` |
| `SLACK_WEBHOOK` | Slack webhook URL (already exists) | `https://hooks.slack.com/...` |

### 4. Verify Existing Secrets

The workflow also uses these existing secrets:
- ✅ `SFDX_INTQA_AUTH_URL` - Already configured in your other workflows
- ✅ `SLACK_WEBHOOK` - Already configured for Slack notifications

## Usage

### Manual Trigger

1. Go to Actions tab in your GitHub repository
2. Select "Test Coverage Map Sync" workflow
3. Click "Run workflow"
4. Select branch (default: BRInt)
5. Click "Run workflow" button

### Scheduled Runs

The workflow automatically runs:
- **Every Sunday at 2 AM UTC**
- Modify the cron schedule in the workflow file if needed

### View Results

After the workflow completes:

1. **Gist**: View your updated coverage map at your gist URL
2. **Slack**: Check your configured Slack channel for notifications
3. **Artifacts**: Download test results from the workflow run page

## Output Format

The generated JSON map has this structure:

```json
{
  "version": "1.0",
  "lastUpdated": "2025-11-24T13:28:00.000Z",
  "description": "Salesforce Test Coverage Map - Maps Apex classes to their test classes",
  "recordCount": 43222,
  "coverage": {
    "AccountTriggerFunctions": [
      "AccountTriggerFunctions_Test",
      "TestDataFactory_Test"
    ],
    "OpportunityTriggerFunctions": [
      "OpportunityTriggerFunctions_Test"
    ],
    "CPQQuoteTriggerFunctions": [
      "CPQQuoteTriggerFunctions_Test",
      "QuoteCalculatorOperation_Test"
    ]
  }
}
```

### Field Descriptions

- **`version`**: Format version (currently "1.0")
- **`lastUpdated`**: ISO 8601 timestamp of when the map was generated
- **`description`**: Human-readable description of the map's purpose
- **`recordCount`**: Total number of `ApexCodeCoverage` records queried from Salesforce
- **`coverage`**: Object mapping Apex class names to arrays of test class names that cover them

## Workflow Steps

1. **Checkout Code** - Checks out BRInt branch
2. **Setup Environment** - Installs Node.js and Salesforce CLI
3. **Authenticate** - Connects to Salesforce org using stored auth URL
4. **Run Tests** - Executes all local tests with code coverage
5. **Query Coverage** - Queries `ApexCodeCoverage` object for detailed mappings
6. **Build Map** - Parses results into JSON coverage map
7. **Update Gist** - Uploads map to GitHub Gist via API
8. **Notify Slack** - Sends success/failure notification
9. **Archive Results** - Saves test results as workflow artifacts

## Troubleshooting

### Workflow Fails at "Run All Local Tests"

**Cause**: Test execution timeout or test failures

**Solution**:
- Check the workflow logs for specific test failures
- Increase the `--wait` timeout (currently 60 minutes)
- Fix failing tests before re-running

### Workflow Fails at "Update GitHub Gist"

**Cause**: Missing or invalid secrets

**Solution**:
1. Verify `GIST_TOKEN` secret is set correctly
2. Verify `TEST_COVERAGE_GIST_ID` secret matches your gist ID
3. Ensure the token has `gist` scope
4. Check that the gist still exists and is accessible

### Slack Notification Not Received

**Cause**: Missing or invalid webhook URL

**Solution**:
1. Verify `SLACK_WEBHOOK` secret is set
2. Test the webhook URL manually
3. Check Slack app permissions

### Coverage Map is Empty or Incomplete

**Cause**: No test coverage data or query issues

**Solution**:
1. Verify tests actually ran successfully
2. Check that tests have code coverage (not all tests may cover all classes)
3. Review the `coverage-query.json` artifact for raw data
4. Ensure the org has `ApexCodeCoverage` records

## Customization

### Change Schedule

Edit the cron expression in the workflow file:

```yaml
schedule:
  # Run every Sunday at 2 AM UTC
  - cron: '0 2 * * 0'
```

Common cron patterns:
- Daily at midnight: `0 0 * * *`
- Every Monday at 9 AM: `0 9 * * 1`
- First day of month: `0 0 1 * *`

### Change Target Org

Replace `targetOrg` with your org alias throughout the workflow.

### Change Branch

Update the `ref` parameter in the checkout step:

```yaml
- name: "Checkout source code"
  uses: actions/checkout@v2
  with:
    ref: main  # Change to your desired branch
    path: Bedrock
```

## Integration with Other Workflows

You can use the coverage map in other workflows by:

1. **Downloading the Gist**:
   ```bash
   curl -H "Authorization: token ${{ secrets.GIST_TOKEN }}" \
     https://gist.githubusercontent.com/username/${{ secrets.TEST_COVERAGE_GIST_ID }}/raw/test-coverage-map.json \
     -o coverage-map.json
   ```

2. **Parsing in JavaScript**:
   ```javascript
   const coverageMap = require('./coverage-map.json');
   const testClasses = coverageMap.coverage['AccountTriggerFunctions'];
   console.log('Test classes:', testClasses);
   console.log('Total coverage records:', coverageMap.recordCount);
   ```

3. **Using in Shell Scripts**:
   ```bash
   # Get test classes for a specific Apex class
   TEST_CLASSES=$(jq -r '.coverage.AccountTriggerFunctions[]' coverage-map.json)
   
   # Get metadata
   RECORD_COUNT=$(jq -r '.recordCount' coverage-map.json)
   LAST_UPDATED=$(jq -r '.lastUpdated' coverage-map.json)
   ```

## Related Workflows

This workflow complements your existing workflows:
- `INTQA_Delta_Deployment.yml` - Uses dynamic test selection
- `find_test_classes.sh` - Shell script for finding test classes

Consider using the coverage map to enhance these workflows with more accurate test selection.

## Support

For issues or questions:
1. Check workflow run logs in GitHub Actions
2. Review artifacts for detailed test results
3. Verify all secrets are configured correctly
4. Contact the DevOps team for assistance

## Maintenance

- **Weekly**: Review Slack notifications for failures
- **Monthly**: Verify gist is updating correctly
- **Quarterly**: Review and update test coverage goals
- **As Needed**: Update workflow when adding new test patterns
