# CGEAA - CarGurus Enterprise Applications Automation

A comprehensive shell script suite for automating Salesforce deployment and validation operations.

## Overview

CGEAA (CarGurus Enterprise Applications Automation) is a powerful command-line tool designed to streamline Salesforce development workflows by automating validation, deployment, testing, and org management processes. Built with a modular architecture, it provides robust error handling, comprehensive logging, and flexible configuration options.

## Features

- **Branch-Based Tagging**: Automatically extracts story names from Feature branches (e.g., Feature/PGTM-2270 → PGTM-2270-XXXX tags)
- **Smart Org Management**: Lists and validates authenticated Salesforce CLI org aliases
- **Mixed Tag Format Support**: Handles both padded (0001) and unpadded (2) tag numbering for backward compatibility
- **Automated Change Detection**: Uses git diff to identify modified Salesforce components
- **Intelligent Test Selection**: Automatically finds relevant test classes using a local coverage mappings repository, with live `ApexCodeCoverage` query as a fallback
- **Asynchronous Test Execution**: Run Apex tests independently with auto-detection of relevant test classes
- **Flexible Deployment Options**: Support for validation-only or full deployment operations
- **Manifest Generation**: Generate a Salesforce `package.xml` from changed files without deploying
- **Apex Log Management**: List, fetch, stream, and clear Apex debug logs directly from the CLI
- **Metadata Diff**: Compare local source against an org, or compare two orgs, before committing to a deployment
- **Interactive Mode**: Guided prompts for `validate` and `deploy` commands
- **Branch-Based Rollback**: Safely revert changes from a feature branch
- **Org Management**: Quickly open Salesforce orgs in a browser
- **Self-Updating**: Keep the tool up-to-date with a simple `update` command
- **Comprehensive Logging**: Verbose, quiet, and debug logging modes
- **Configuration Management**: Global and project-specific configuration files
- **Dry Run Mode**: Preview operations without executing them
- **Multiple Test Levels**: Support for all Salesforce test execution levels

## Quick Start

### 1. Clone the Coverage Mappings Repository

CGEAA reads Apex class → test class mappings from a sibling repository. Clone it at the same level as the CGEAA directory before first use:

```bash
cd /path/to/your/code   # same parent folder that contains CGEAA/
git clone https://github.com/cargurus-ea/EA-Salesforce-Mappings
```

The expected layout is:

```
your-code/
├── CGEAA/                          ← this repo
└── EA-Salesforce-Mappings/         ← mappings repo (sibling)
    └── JSON/
        └── test-coverage-map.json
```

### 2. Setup

Run the setup script to initialize CGEAA:

```bash
./cgeaa-setup
```

This will:
- Create configuration directories and files
- Make scripts executable
- Verify dependencies
- Test the installation

### 3. Authentication

Authenticate to your Salesforce orgs (if not already done):

```bash
sf auth web login --alias BRInt
sf auth web login --alias BRStaging
sf auth web login --alias Playground
```

### 4. Basic Usage

```bash
# Check available orgs
./cgeaa orgs

# View current branch and tag information
./cgeaa branch

# Validate changes (dry run)
./cgeaa validate --dry-run

# Generate a package manifest from changed files
./cgeaa manifest

# Deploy to integration sandbox and create a git tag
./cgeaa deploy -o BRInt --git-tag

# Open an org in the browser
./cgeaa open -o BRInt

# Run a deployment interactively
./cgeaa deploy --interactive

# Deploy to staging with all tests
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg

# Force deploy with verbose output
./cgeaa deploy -o Playground --force --verbose

# Run tests (auto-detects relevant tests based on changes)
./cgeaa test -o BRInt

# Run specific tests
./cgeaa test -o BRStaging -t RunSpecifiedTests --tests "TestClass1,TestClass2"

# List recent Apex debug logs
./cgeaa logs list -o BRInt

# Stream debug logs in real time
./cgeaa logs tail -o BRInt

# See what differs between local source and an org
./cgeaa diff -o BRInt
```

## Zuora (ZDF) — Quick Start

CGEAA bundles the **Zuora Development Framework (ZDF)**, which syncs Zuora billing
objects to local JSON files and pushes changes back. All ZDF commands are available
through `cgeaa zuora`.

### Prerequisites

- Node.js ≥ 18 (the setup script offers to install it automatically)
- A Zuora OAuth client ID and secret (from your tenant admin or the Zuora UI under
  **Admin → Manage Users → OAuth Clients**)

### 1. Run `cgeaa-setup`

The setup script builds ZDF automatically when Node.js is present. At the end of
setup it prompts you to configure Zuora credentials. If you skipped that step, run
it manually now:

```bash
cgeaa zuora auth add \
  --name intQA \
  --url https://rest.test.zuora.com \
  --client-id <your-client-id> \
  --client-secret <your-client-secret>
cgeaa zuora auth use intQA
```

Replace `intQA` / the URL with the name and base URL for your environment:

| Environment | Base URL |
|---|---|
| intQA (US Developer & Central Sandbox) | `https://rest.test.zuora.com` |
| US API Sandbox | `https://rest.apisandbox.zuora.com` |
| US Production | `https://rest.zuora.com` |

Credentials are stored in `~/.zdf/config.json` on your machine. They are not
committed to the repository.

### 2. Verify auth

```bash
cgeaa zuora auth env       # prints the active environment name and URL
cgeaa zuora list billing-templates   # first read-only call to confirm connectivity
```

### 3. Common ZDF commands

```bash
# Pull a Zuora record to a local JSON file
cgeaa zuora pull account <account-id> --no-dependency

# Pull a product rate plan and all its charges
cgeaa zuora pull product-rate-plan <id>

# List available invoice templates
cgeaa zuora list billing-templates

# Pull an HTML billing template (base64-decoded to editable JSON)
cgeaa zuora pull billing-template <id>

# Push a local JSON change back to Zuora
cgeaa zuora push product-rate-plan <id>

# See all ZDF verbs and resources
cgeaa zuora --help
cgeaa zuora pull --help
cgeaa zuora push --help
cgeaa zuora create --help
```

All ZDF output files land in `./zdf-output/<resource-type>/` by default. Set
`ZDF_OUTPUT_DIR` to write to a different path:

```bash
ZDF_OUTPUT_DIR=/path/to/output cgeaa zuora pull account <id>
```

### 4. Supported operations by resource

For the full resource-by-resource reference, run `cgeaa zuora --help` or see
[`zdf/README.md`](zdf/README.md).

> **Note:** Some create/delete operations are not currently supported on the intQA
> tenant due to tenant configuration (e.g. `create product`, `create invoice`). The
> CLI exits immediately with a clear message if you attempt one. See
> [`zdf/TODO.md`](zdf/TODO.md) under "Tenant-config limitations" for details.

---

## Installation

### Prerequisites

- Git
- Salesforce CLI (`sf`)
- Bash shell
- `jq` (optional, for enhanced JSON parsing)

### Setup Steps

1. Clone or download the CGEAA scripts to your Salesforce project directory
2. Clone the `EA-Salesforce-Mappings` repository as a sibling directory (see Quick Start above):
   `git clone https://github.com/cargurus-ea/EA-Salesforce-Mappings`
3. Run the setup script: `./cgeaa-setup`
4. Authenticate to your Salesforce orgs
5. Customize configuration files as needed

## Configuration

CGEAA uses a hierarchical configuration system. The project-level config overrides the global config.

### Global Configuration
Location: `~/.cgeaa/config`

### Project Configuration
Location: `.cgeaa/config`

### Configuration Options

```bash
# Default target org alias
default_org=targetOrg

# Default test level for deployments
# Options: NoTestRun, RunSpecifiedTests, RunLocalTests, RunAllTestsInOrg
default_test_level=RunLocalTests

# Default deployment timeout in seconds
default_timeout=360

# Default base branch for comparisons
default_base_branch=main

# Tag prefix for deployment tracking
tag_prefix=CGEAA

# Deployment directory (relative to project root)
deployment_dir=Bedrock

# Automatically cleanup temporary files
auto_cleanup=true

# Enable desktop notifications
enable_notifications=false

# Maximum time to wait for deployment completion (seconds)
max_deploy_wait=3600

# Number of parallel jobs for operations that support it
parallel_jobs=1

# Name of the sibling repository containing Apex class -> test class JSON mappings.
# Must be cloned at the same level as the CGEAA root directory.
# Mapping file expected at: <repo>/JSON/test-coverage-map.json
coverage_mappings_repo=EA-Salesforce-Mappings

# Git clone URL for the mappings repository.
# When set, CGEAA will automatically clone the repo if it is not found on disk.
coverage_mappings_repo_url=https://github.com/cargurus-ea/EA-Salesforce-Mappings
```

## Command Reference

### Commands

| Command | Description |
|---------|-------------|
| `validate` | Validate changes without deploying |
| `deploy` | Deploy changes to a target org |
| `test` | Run Apex tests asynchronously with auto-detection |
| `manifest` | Generate a Salesforce `package.xml` from changed files |
| `logs` | Manage Apex debug logs (`list`, `get`, `tail`, `clear`) |
| `diff` | Compare local metadata against an org, or between two orgs |
| `orgs` | List available authenticated Salesforce org aliases |
| `branch` | Show current branch and tag information |
| `config` | Show current configuration |
| `help` | Show help message |
| `version` | Show version information |
| `open` | Open a Salesforce org in your browser |
| `rollback` | Revert changes from the current branch on an org |
| `update` | Update CGEAA to the latest version |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --org <org>` | Target org alias | Auto-detected |
| `-t, --test-level <level>` | Test level (auto-detects for `test` command if not provided) | `RunLocalTests` |
| `-w, --timeout <seconds>` | Deployment timeout | `360` |
| `-b, --base-branch <branch>` | Base branch for comparison | `main` |
| `-m, --manifest <file>` | Use a specific manifest file | Auto-generated |
| `-f, --force` | Force deployment even if no changes detected | `false` |
| `-d, --dry-run` | Preview operation without executing | `false` |
| `-v, --verbose` | Enable verbose output | `false` |
| `-q, --quiet` | Suppress non-essential output | `false` |
| `--tag-prefix <prefix>` | Tag prefix for deployment tracking | Auto from branch |
| `--deployment-dir <dir>` | Deployment directory | `Bedrock` |
| `-i, --interactive` | Enable interactive mode for `validate` and `deploy` | `false` |
| `-gt, --git-tag` | Create a git tag upon successful deployment | `false` |
| `--tests <classes>` | Comma-separated test class names (for `RunSpecifiedTests`) | Auto-detected |
| `--rollback-to <branch>` | Target branch for rollback | `main` |
| `--list` | List test classes mapped to changed Apex files, no test run (`test` command only) | — |
| `--log-id <id>` | Log ID to fetch (`logs get` — omit for most recent) | Most recent |
| `--log-output-dir <dir>` | Directory to save fetched log files | Prints to stdout |
| `--no-color` | Disable color output when tailing logs | Color on |
| `--direction <mode>` | Diff direction: `local-to-org`, `org-to-local`, `org-to-org` | `local-to-org` |
| `--source-org <org>` | Source org alias for `org-to-org` diff | — |

### Test Levels

| Level | Description |
|-------|-------------|
| `NoTestRun` | No tests run (not recommended for production) |
| `RunSpecifiedTests` | Run only the specified test classes |
| `RunLocalTests` | Run all local tests (default) |
| `RunAllTestsInOrg` | Run all tests in the org, including managed packages |

---

## Advanced Features

### Test Command Auto-Detection

When using `cgeaa test` without the `-t` flag, CGEAA automatically determines which tests to run:

1. **Compare Branches**: Compares the current branch against the base branch (default: `main`)
2. **Identify Changes**: Finds all changed Apex classes in your feature branch
3. **Lookup Coverage Map**: Pulls the latest from the local `coverage_mappings_repo` and reads `JSON/test-coverage-map.json`
   - If the repo directory is missing and `coverage_mappings_repo_url` is configured, CGEAA clones it automatically before reading
4. **Query Coverage (Fallback)**: If the repo is unavailable and no URL is configured, queries `ApexCodeCoverage` live against the target org
5. **Include Modified Tests**: Adds any test classes that were directly modified
6. **Execute**: Runs all detected tests with `RunSpecifiedTests`, or defaults to `RunLocalTests` if none found

This intelligent detection ensures you only run tests relevant to your changes, saving time while maintaining coverage.

```bash
# Auto-detect and run only relevant tests
./cgeaa test -o BRInt

# With a custom base branch
./cgeaa test -o BRInt -b develop

# See detailed detection process
./cgeaa test -o BRInt -v

# Preview which test classes would be run without executing anything
./cgeaa test --list

# Same, comparing against a specific base branch
./cgeaa test --list -b develop
```

#### Listing Mapped Test Classes

The `--list` flag performs steps 1–3 of the auto-detection process and prints the results without running any tests. It does not require a target org (`-o`) since no SF CLI calls are made — only git diff and the local coverage mappings repo are used.

Example output:
```
=== Test Class Mappings ===
Base reference:  main
Changed classes: QuoteService OpportunityTrigger

  QuoteService
    → QuoteServiceTest
    → QuoteIntegrationTest

  OpportunityTrigger
    → OpportunityTriggerTest

Combined (unique): OpportunityTriggerTest,QuoteIntegrationTest,QuoteServiceTest
```

Test results are saved to the `test-results/` directory with execution summaries, code coverage reports, and detailed test outcome information.

---

### Manifest Generation

The `manifest` command generates a Salesforce `package.xml` from your changed files without running a deployment or validation. Useful for inspecting what would be included in a deploy, or for feeding into other tools.

```bash
# Generate package.xml from files changed since main
./cgeaa manifest

# Compare against a specific base branch
./cgeaa manifest -b develop

# Write to a custom file name
./cgeaa manifest -m custom-package.xml

# Preview what the manifest would contain without writing it
./cgeaa manifest --dry-run

# See every file included
./cgeaa manifest -v
```

---

### Apex Log Management

The `logs` command provides four sub-commands for managing Apex debug logs without leaving the terminal.

#### `logs list` — View recent logs

```bash
# Show all recent debug logs with IDs, sizes, and timestamps
./cgeaa logs list -o BRInt
```

#### `logs get` — Fetch a log

```bash
# Fetch the most recent log (prints to stdout)
./cgeaa logs get -o BRInt

# Fetch a specific log by ID
./cgeaa logs get -o BRInt --log-id 07L5f000002xyzABC

# Save the log to a directory instead of printing it
./cgeaa logs get -o BRInt --log-output-dir ./apex-logs
```

#### `logs tail` — Stream logs in real time

Blocks the terminal and streams incoming logs until `Ctrl-C`.

```bash
# Tail with color output (default)
./cgeaa logs tail -o BRInt

# Tail without color (useful for piping to a file)
./cgeaa logs tail -o BRInt --no-color
```

#### `logs clear` — Delete all debug logs

```bash
# Delete all logs (prompts for confirmation)
./cgeaa logs clear -o BRInt

# Skip the confirmation prompt
./cgeaa logs clear -o BRInt -f
```

All `logs` sub-commands support `--dry-run` to preview the action without executing it.

---

### Metadata Diff

The `diff` command lets you compare metadata before committing to a deployment. It surfaces differences between your local source and a target org, or between two orgs, using Salesforce CLI's deploy/retrieve preview capabilities.

#### `local-to-org` (default) — Local source vs. org

Generates a manifest from your changed files and runs a retrieve preview to show what differs from the target org. Accepts `-m` to use an existing manifest instead.

```bash
# Compare local changes (since main) against BRInt
./cgeaa diff -o BRInt

# Compare against a specific base branch
./cgeaa diff -o BRInt -b develop

# Use an existing manifest
./cgeaa diff -o BRInt -m package.xml

# Preview the diff command without running it
./cgeaa diff -o BRInt --dry-run
```

#### `org-to-local` — What does the org have that differs from local source?

Requires a manifest (`-m`) to define the component scope.

```bash
./cgeaa diff -o BRInt --direction org-to-local -m package.xml
```

#### `org-to-org` — Compare two orgs

Retrieves components from the `--source-org`, then previews deploying them into the target org. Requires both a manifest and `--source-org`.

```bash
# Show what would change in BRStaging if you deployed BRInt's metadata
./cgeaa diff -o BRStaging --direction org-to-org --source-org BRInt -m package.xml
```

---

### Branch-Based Rollback

The `rollback` command provides a safe way to revert feature branch changes on an org. It:

1. Identifies all files changed in your current feature branch compared to `main`
2. Creates a temporary deployment package containing the `main` version of only those changed files
3. Deploys this package to the target org with `NoTestRun`

This surgically reverts the feature without affecting other components.

```bash
# From your feature branch, revert the changes on the Staging org
./cgeaa rollback -o BRStaging

# Roll back to a specific branch instead of main
./cgeaa rollback -o BRStaging --rollback-to develop
```

> **Note**: This command is disabled on primary branches (`main`, `master`, `develop`) to prevent accidental rollbacks.

---

### Branch-Based Tagging

CGEAA automatically extracts story names from Feature branches to create meaningful deployment tags when `--git-tag` is used.

```bash
# Supported branch patterns:
Feature/PGTM-2270    # → Tags: PGTM-2270-0001, PGTM-2270-0002, etc.
feature/ABC-123      # → Tags: ABC-123-0001, ABC-123-0002, etc.

# Non-Feature branches use the configured fallback prefix:
main                 # → Tags: CGEAA-0001, CGEAA-0002, etc.
develop              # → Tags: CGEAA-0001, CGEAA-0002, etc.
```

CGEAA handles mixed tag numbering formats seamlessly, inspecting existing tags to determine whether to produce zero-padded (`-0003`) or plain integer (`-3`) suffixes.

```bash
# View current branch and tagging info
./cgeaa branch
```

---

### Self-Updating

The `update` command pulls the latest changes from the CGEAA source repository and re-runs the global installation.

```bash
# Update from main branch
./cgeaa update

# Update from a specific branch (e.g. to test a beta feature)
./cgeaa update -b beta
```

> **Note**: Requires CGEAA to have been installed globally via `./cgeaa-setup`.

---

## Examples

### Basic Operations

```bash
# Check available authenticated orgs
./cgeaa orgs

# View current branch and tagging info
./cgeaa branch

# Validate changes (dry run)
./cgeaa validate --dry-run

# Generate a manifest to inspect what would be deployed
./cgeaa manifest

# Deploy to integration sandbox and create a git tag
./cgeaa deploy -o BRInt --git-tag

# Deploy to staging with comprehensive testing
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg -v

# Run tests with auto-detection
./cgeaa test -o BRInt

# Run all local tests
./cgeaa test -o BRInt -t RunLocalTests

# Run specific test classes
./cgeaa test -o BRStaging -t RunSpecifiedTests --tests "TestClass1,TestClass2,TestClass3"
```

### Log Management

```bash
# List recent debug logs
./cgeaa logs list -o BRInt

# Fetch the most recent log
./cgeaa logs get -o BRInt

# Fetch a specific log and save it
./cgeaa logs get -o BRInt --log-id 07L5f000002xyzABC --log-output-dir ./apex-logs

# Stream logs live while testing a change
./cgeaa logs tail -o BRInt

# Clear all logs before a debugging session
./cgeaa logs clear -o BRInt -f
```

### Metadata Diff

```bash
# Quick sanity check — what does BRInt have that differs from local?
./cgeaa diff -o BRInt

# Review org-to-org differences before promoting a build
./cgeaa diff -o BRStaging --direction org-to-org --source-org BRInt -m package.xml

# Check what the org has for a specific manifest
./cgeaa diff -o BRInt --direction org-to-local -m package.xml
```

### Full Feature Branch Workflow

```bash
# 1. Generate a manifest to review what will be deployed
./cgeaa manifest -v

# 2. See how the org currently differs from local source
./cgeaa diff -o BRInt

# 3. Validate before deploying
./cgeaa validate -o BRInt -t RunLocalTests

# 4. Tail logs while manually smoke-testing
./cgeaa logs tail -o BRInt

# 5. Deploy to integration with a tag
./cgeaa deploy -o BRInt --git-tag

# 6. Run auto-detected tests to confirm coverage
./cgeaa test -o BRInt -v

# 7. Promote to staging
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg --git-tag

# 8. Clear debug logs after the session
./cgeaa logs clear -o BRInt -f
```

### Advanced Usage

```bash
# Force deploy with a custom timeout
./cgeaa deploy --force -w 600 -o BRStaging

# Use a custom manifest file for validation
./cgeaa validate -m custom-package.xml -o BRInt

# Deploy changes since a specific base branch
./cgeaa deploy -b develop -o BRStaging

# Roll back the current feature branch from staging
./cgeaa rollback -o BRStaging
```

### CI/CD Integration

```yaml
# Example GitHub Actions workflow
- name: Generate Manifest
  run: ./cgeaa manifest -v

- name: Run Tests
  run: ./cgeaa test -o sandbox -v

- name: Deploy to Sandbox
  run: ./cgeaa deploy -o sandbox -q --git-tag
  if: success()
```

### Git Hooks

```bash
#!/bin/bash
# pre-push hook — validate and run tests before pushing
./cgeaa validate --dry-run -q || exit 1
./cgeaa test -o BRInt -q || exit 1
```

---

## Architecture

### Core Components

| File | Description |
|------|-------------|
| `cgeaa` | Main entry point and command dispatcher |
| `cgeaa-setup` | Interactive setup and global installer |
| `cgeaa-uninstall` | Uninstaller |
| `cgeaa-lib/` | Library modules directory |
| `.cgeaa/config` | Project-level configuration |

### Library Modules

| Module | Description |
|--------|-------------|
| `utils.sh` | Common utility functions, logging, manifest generation, git helpers |
| `config.sh` | Configuration loading, validation, and display |
| `validate.sh` | Validation-only deployments |
| `deploy.sh` | Full deployments with optional git tagging |
| `test.sh` | Asynchronous test execution with coverage-map-based auto-detection |
| `manifest.sh` | Standalone manifest generation from changed files |
| `logs.sh` | Apex debug log management (list, get, tail, clear) |
| `diff.sh` | Metadata diff between local source and orgs, or between two orgs |
| `orgs.sh` | Org listing, validation, and interactive selection |
| `branch.sh` | Branch inspection and tag prefix logic |
| `rollback.sh` | Branch-based rollback deployments |
| `interactive.sh` | Interactive guided mode for validate and deploy |
| `open.sh` | Browser launch for Salesforce orgs |
| `update.sh` | Self-update via git pull and re-install |
| `default-org.sh` | SF CLI default org auto-detection |

### Coverage Mappings Repository

Test class resolution uses a pre-built mapping file from the sibling `EA-Salesforce-Mappings` repository (`https://github.com/cargurus-ea/EA-Salesforce-Mappings`). On every test class lookup, CGEAA runs `git pull origin main` against that repo to ensure the mappings are current, then reads `JSON/test-coverage-map.json` directly. If the repo directory is missing, CGEAA will automatically clone it using the configured `coverage_mappings_repo_url`. If the repo is unavailable and cannot be cloned, CGEAA falls back to a live `ApexCodeCoverage` SOQL query against the target org.

Both the repo name and URL are configurable in `.cgeaa/config` via `coverage_mappings_repo` and `coverage_mappings_repo_url`.

### Execution Flow

1. **Initialization**: Load configuration, validate environment and dependencies
2. **Change Detection**: Compare current branch against base reference via `git diff`
3. **Manifest Generation**: Create `package.xml` from changed `force-app/` files
4. **Test Selection**: Resolve relevant test classes from the coverage map or live SOQL query
5. **Execution**: Perform the requested operation (validate, deploy, test, diff, etc.)
6. **Tagging**: Tag successful deployments (if `--git-tag` was provided)
7. **Cleanup**: Remove temporary files

---

## Error Handling

- **Dependency Checks**: Verifies `git` and `sf` are available before any operation
- **Authentication Validation**: Confirms org connectivity before deployment or test runs
- **Manifest Validation**: Ensures valid `package.xml` generation before deploying
- **Deployment Monitoring**: Tracks operation progress and fetches failure details automatically
- **Graceful Cleanup**: Removes temporary files on success or failure

---

## Logging

| Level | When it appears |
|-------|-----------------|
| `INFO` | General operation information |
| `SUCCESS` | Successful operation completion |
| `WARNING` | Non-critical issues (e.g. failed git pull on mappings repo) |
| `ERROR` | Critical errors requiring attention |
| `DEBUG` | Detailed tracing (verbose mode only) |
| `STEP` | Major operation milestones |

Enable verbose logging with `-v` / `--verbose`. Suppress non-essential output with `-q` / `--quiet`.

---

## Troubleshooting

### Common Issues

**Authentication Errors**
```bash
sf auth web login --alias targetOrg
```

**No Changes Detected**
```bash
# Force a deployment
./cgeaa deploy --force

# Verify base branch
./cgeaa deploy -b main
```

**Test Failures**
```bash
# Switch to a broader test level
./cgeaa deploy -t RunLocalTests

# Skip tests entirely (not recommended for production)
./cgeaa deploy -t NoTestRun
```

**Timeout Issues**
```bash
./cgeaa deploy -w 1200
```

**Coverage Mappings Repo Not Found**
```bash
# Clone the sibling repository
cd $(dirname $(which cgeaa))/..   # or navigate to the parent of CGEAA/
git clone https://github.com/cargurus-ea/EA-Salesforce-Mappings
```
Alternatively, if `coverage_mappings_repo_url` is set in your config, CGEAA will clone it automatically on next use. CGEAA will fall back to a live `ApexCodeCoverage` query until the repo is in place.

**Diff Shows Unexpected Components**
```bash
# Use a more specific manifest
./cgeaa manifest -v          # review what's included
./cgeaa diff -o BRInt -m package.xml
```

### Debug Mode

```bash
./cgeaa deploy --verbose
```

### Temporary Files

| File / Directory | Purpose |
|-----------------|---------|
| `files.txt` | List of changed files |
| `changed_classes.txt` | Changed Apex class names |
| `test_classes.txt` | Resolved test class names |
| `package.xml` | Generated deployment manifest |
| `diff-package.xml` | Temporary manifest used by `diff` (auto-deleted) |
| `test-results/` | Test execution results and code coverage reports |
| `query_result.json` | Temporary `ApexCodeCoverage` query output |

---

## Contributing

1. Follow the existing code style and module structure
2. Add comprehensive error handling and `--dry-run` support to all new commands
3. Include `log_step`, `log_info`, and `log_debug` calls for all major operations
4. Update this README for any new commands, options, or configuration keys
5. Test across both macOS and Linux environments

---

## License

This project is part of the CarGurus Enterprise Applications suite.

## Support

1. Check the troubleshooting section above
2. Run the failing command with `--verbose` to see detailed output
3. Use `./cgeaa config` to verify your configuration
4. Consult the [Salesforce CLI documentation](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_reference.meta/sfdx_cli_reference/) for underlying SF CLI issues

---

**CGEAA v1.0.0** - CarGurus Enterprise Applications Automation
