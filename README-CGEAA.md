# CGEAA - CarGurus Enterprise Applications Automation

A comprehensive shell script suite for automating Salesforce deployment and validation operations.

## Overview

CGEAA (CarGurus Enterprise Applications Automation) is a powerful command-line tool designed to streamline Salesforce development workflows by automating validation and deployment processes. Built with a modular architecture, it provides robust error handling, comprehensive logging, and flexible configuration options.

## Features

- **Branch-Based Tagging**: Automatically extracts story names from Feature branches (e.g., Feature/PGTM-2270 → PGTM-2270-XXXX tags)
- **Smart Org Management**: Lists and validates authenticated Salesforce CLI org aliases
- **Mixed Tag Format Support**: Handles both padded (0001) and unpadded (2) tag numbering for backward compatibility
- **Automated Change Detection**: Uses git diff to identify modified Salesforce components
- **Intelligent Test Selection**: Automatically finds relevant test classes using coverage analysis
- **Asynchronous Test Execution**: Run Apex tests independently with auto-detection of relevant test classes
- **Flexible Deployment Options**: Support for validation-only or full deployment operations
- **Interactive Mode**: Guided prompts for `validate` and `deploy` commands.
- **Branch-Based Rollback**: Safely revert changes from a feature branch.
- **Org Management**: Quickly open Salesforce orgs in a browser.
- **Self-Updating**: Keep the tool up-to-date with a simple `update` command.
- **Comprehensive Logging**: Verbose, quiet, and debug logging modes
- **Configuration Management**: Global and project-specific configuration files
- **Dry Run Mode**: Preview operations without executing them
- **Multiple Test Levels**: Support for all Salesforce test execution levels

## Quick Start

### 1. Setup

Run the setup script to initialize CGEAA:

```bash
./cgeaa-setup
```

This will:
- Create configuration directories and files
- Make scripts executable
- Verify dependencies
- Test the installation

### 2. Authentication

Authenticate to your Salesforce orgs (if not already done):

```bash
sf auth web login --alias BRInt
sf auth web login --alias BRStaging
sf auth web login --alias Playground
```

### 3. Basic Usage

```bash
# Check available orgs
./cgeaa orgs

# View current branch and tag information
./cgeaa branch

# Validate changes (dry run)
./cgeaa validate --dry-run

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
```

## Installation

### Prerequisites

- Git
- Salesforce CLI (sf)
- Bash shell
- jq (optional, for enhanced JSON parsing)

### Setup Steps

1. Clone or download the CGEAA scripts to your Salesforce project directory
2. Run the setup script: `./cgeaa-setup`
3. Authenticate to your Salesforce orgs
4. Customize configuration files as needed

## Configuration

CGEAA uses a hierarchical configuration system:

### Global Configuration
Location: `~/.cgeaa/config`

### Project Configuration
Location: `.cgeaa/config`

### Configuration Options

```bash
# Default target org alias
default_org=targetOrg

# Default test level for deployments
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

# Maximum time to wait for deployment completion
max_deploy_wait=3600

# Number of parallel jobs for operations that support it
parallel_jobs=1
```

## Command Reference

### Commands

- `validate` - Validate changes without deploying
- `deploy` - Deploy changes to target org
- `test` - Run Apex tests asynchronously with auto-detection
- `orgs` - List available Salesforce org aliases
- `branch` - Show current branch and tag information
- `config` - Show current configuration
- `help` - Show help message
- `version` - Show version information
- `open` - Open a Salesforce org in your browser
- `rollback` - Revert changes from the current branch on an org
- `update` - Update CGEAA to the latest version

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `-o, --org <org>` | Target org alias | `targetOrg` |
| `-t, --test-level <level>` | Test level (auto-detects for `test` command if not provided) | `RunLocalTests` |
| `-w, --timeout <seconds>` | Deployment timeout | `360` |
| `-b, --base-branch <branch>` | Base branch for comparison | `main` |
| `-m, --manifest <file>` | Use specific manifest file | Auto-generated |
| `-f, --force` | Force deployment even if no changes | `false` |
| `-d, --dry-run` | Show what would be deployed | `false` |
| `-v, --verbose` | Enable verbose output | `false` |
| `-q, --quiet` | Suppress non-essential output | `false` |
| `--tag-prefix <prefix>` | Tag prefix for deployment tracking | `CGEAA` |
| `--deployment-dir <dir>` | Deployment directory | `Bedrock` |
| `-i, --interactive` | Enable interactive mode for `validate` and `deploy` | `false` |
| `-gt, --git-tag` | Create a git tag upon successful deployment | `false` |
| `--tests <classes>` | Comma-separated test class names (for `RunSpecifiedTests`) | Auto-detected |

### Test Levels

- `NoTestRun` - No tests run (not recommended for production)
- `RunSpecifiedTests` - Run only specified test classes
- `RunLocalTests` - Run all local tests (default)
- `RunAllTestsInOrg` - Run all tests in the org

### Test Command Auto-Detection

When using `cgeaa test` without the `-t` flag, CGEAA automatically determines which tests to run:

1. **Compare Branches**: Compares current branch against base branch (default: `main`)
2. **Identify Changes**: Finds all changed Apex classes in your feature branch
3. **Query Coverage**: Queries the `ApexCodeCoverage` object to find tests that cover changed classes
4. **Include Modified Tests**: Adds any test classes that were directly modified
5. **Execute**: Runs all detected tests with `RunSpecifiedTests`, or defaults to `RunLocalTests` if none found

This intelligent detection ensures you only run tests relevant to your changes, saving time while maintaining coverage.

**Example:**
```bash
# Auto-detect and run only relevant tests
./cgeaa test -o BRInt

# With custom base branch
./cgeaa test -o BRInt -b develop

# See detailed detection process
./cgeaa test -o BRInt -v
```

## Branch-Based Tagging

CGEAA automatically extracts story names from Feature branches to create meaningful deployment tags when the `--git-tag` flag is used.

### Branch Naming Convention

```bash
# Supported branch patterns:
Feature/PGTM-2270    # → Tags: PGTM-2270-0001, PGTM-2270-0002, etc.
feature/ABC-123      # → Tags: ABC-123-0001, ABC-123-0002, etc.
Feature/STORY-456    # → Tags: STORY-456-0001, STORY-456-0002, etc.

# Non-Feature branches use fallback:
main                 # → Tags: CGEAA-0001, CGEAA-0002, etc.
develop              # → Tags: CGEAA-0001, CGEAA-0002, etc.
```

### Tag Format Compatibility

CGEAA handles mixed tag numbering formats seamlessly:

```bash
# Existing unpadded tags:
PGTM-2270-1, PGTM-2270-2
# Next tag: PGTM-2270-3

# Existing padded tags:
PGTM-2270-0001, PGTM-2270-0002  
# Next tag: PGTM-2270-0003

# Mixed formats (finds highest number):
PGTM-2270-2, PGTM-2270-0010, PGTM-2270-0011
# Next tag: PGTM-2270-0012 (matches latest format)
```

### Branch Information

```bash
# View current branch and tag details
./cgeaa branch

# Output:
# === Branch Information ===
# Current Branch: Feature/PGTM-2270
# Story Name: PGTM-2270
# Tag Prefix: PGTM-2270
# Next Tag: PGTM-2270-0003
# Recent tags with this prefix:
#   - PGTM-2270-0001
#   - PGTM-2270-0002
```

## Examples

### Basic Operations

```bash
# Check available authenticated orgs
./cgeaa orgs

# View current branch and tagging info
./cgeaa branch

# Validate changes (dry run)
./cgeaa validate --dry-run

# Deploy to integration sandbox and create a git tag
./cgeaa deploy -o BRInt --git-tag

# Deploy to staging with comprehensive testing (no tag)
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg -v

# Run tests with auto-detection
./cgeaa test -o BRInt

# Run all local tests
./cgeaa test -o BRInt -t RunLocalTests

# Run specific test classes
./cgeaa test -o BRStaging -t RunSpecifiedTests --tests "TestClass1,TestClass2,TestClass3"
```

### Advanced Usage

```bash
# Deploy from Feature/PGTM-2270 branch to playground and create a tag
./cgeaa deploy -o Playground -v --git-tag
# Creates tag: PGTM-2270-0001 (or next number)

# Force deploy with custom timeout (no tag)
./cgeaa deploy --force -w 600 -o BRStaging

# Use custom manifest file
./cgeaa validate -m custom-package.xml -o BRInt

# Deploy changes since specific branch
./cgeaa deploy -b develop -o BRStaging

# Roll back changes from the current branch on the staging org
./cgeaa rollback -o BRStaging

# Update the CGEAA tool itself
./cgeaa update

# Run tests relevant to your changes
./cgeaa test -o BRInt -v
```

### Workflow Integration

```bash
# Pre-commit validation (from Feature branch)
./cgeaa validate --dry-run -q

# Feature branch deployment to integration sandbox with tagging
./cgeaa deploy -o BRInt --git-tag
# Auto-creates tag: PGTM-2270-0001 (from Feature/PGTM-2270)

# Promote to staging after integration testing
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg --git-tag
# Creates tag: PGTM-2270-0002

# Final validation before production
./cgeaa validate -o BRStaging --dry-run -v

# Run auto-detected tests before pushing
./cgeaa test -o BRInt
```

## Architecture

CGEAA follows a modular architecture with separate components:

### Core Components

- **`cgeaa`** - Main entry point script
- **`cgeaa-setup`** - Setup and configuration script
- **`cgeaa-lib/`** - Library modules directory

### Library Modules

- **`utils.sh`** - Common utility functions and logging
- **`config.sh`** - Configuration management
- **`validate.sh`** - Validation operations
- **`deploy.sh`** - Deployment operations
- **`test.sh`** - Asynchronous test execution with auto-detection
- **`orgs.sh`** - Org management and authentication
- **`branch.sh`** - Branch and tag information
- **`open.sh`** - Browser integration for orgs
- **`rollback.sh`** - Branch-based rollback operations
- **`update.sh`** - Self-update functionality

### Workflow Process

1. **Initialization**: Load configuration and validate environment
2. **Change Detection**: Compare current branch with base reference
3. **Manifest Generation**: Create package.xml from changed files
4. **Test Selection**: Find relevant test classes (if applicable)
5. **Execution**: Perform validation or deployment
6. **Tagging**: Tag successful deployments (if requested)
7. **Cleanup**: Remove temporary files

## Error Handling

CGEAA includes comprehensive error handling:

- **Dependency Checks**: Verifies required tools are available
- **Authentication Validation**: Confirms org connectivity
- **Manifest Validation**: Ensures valid package.xml generation
- **Deployment Monitoring**: Tracks operation progress and failures
- **Graceful Cleanup**: Removes temporary files on exit

## Logging

Multiple logging levels are supported:

- **INFO**: General operation information
- **SUCCESS**: Successful operation completion
- **WARNING**: Non-critical issues
- **ERROR**: Critical errors requiring attention
- **DEBUG**: Detailed debugging information (verbose mode)
- **STEP**: Major operation steps

## Advanced Features

### Asynchronous Test Execution

The `test` command provides a standalone way to run Apex tests without deployment. It features intelligent auto-detection of relevant tests based on your code changes.

#### How Auto-Detection Works

When you run `cgeaa test` without specifying `-t`, the system:
1. Compares your current branch to the base branch (default: `main`)
2. Identifies all changed Apex classes (`.cls` files)
3. Queries `ApexCodeCoverage` to find tests that provide coverage for those classes
4. Includes any test classes that were directly modified
5. Combines and deduplicates the results
6. Runs all detected tests asynchronously

#### Test Results

Test results are saved to the `test-results/` directory with:
- Test execution summaries in JSON format
- Code coverage reports
- Detailed test outcome information

#### Usage Examples

```bash
# Auto-detect and run relevant tests
./cgeaa test -o BRInt

# Run with verbose output to see the detection process
./cgeaa test -o BRInt -v

# Use a different base branch for comparison
./cgeaa test -o BRInt -b develop

# Preview what would be executed
./cgeaa test -o BRInt --dry-run

# Run all local tests (override auto-detection)
./cgeaa test -o BRInt -t RunLocalTests

# Run specific tests only
./cgeaa test -o BRInt -t RunSpecifiedTests --tests "Test1,Test2,Test3"

# Run all tests in the org (includes managed packages)
./cgeaa test -o BRInt -t RunAllTestsInOrg
```

#### Benefits

- **Time Savings**: Only runs tests relevant to your changes
- **Fast Feedback**: Asynchronous execution with configurable timeout
- **Coverage Tracking**: Automatically collects and reports code coverage
- **Flexible**: Can override auto-detection when needed

### Branch-Based Rollback

The `rollback` command provides a safe way to revert changes on an org. It works by:
1. Identifying all files changed in your current feature branch compared to `main`.
2. Creating a temporary deployment package containing the `main` version of only those changed files.
3. Deploying this package to the target org.

This surgically reverts the feature without affecting other components.

```bash
# From your feature branch, revert the changes on the Staging org
./cgeaa rollback -o BRStaging
```

**Note**: This command is disabled on primary branches like `main`, `master`, or `develop` to prevent accidental rollbacks.

### Self-Updating

To ensure you and your team are always using the latest version of CGEAA, you can use the `update` command. This command will:
1. Navigate to the source git repository for CGEAA.
2. Pull the latest changes.
3. Re-run the global installation process.

```bash
# Update CGEAA to the latest version
./cgeaa update
```

**Note**: This feature requires CGEAA to have been installed globally via the `./cgeaa-setup` script, as it needs the source repository path.

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   ```bash
   # Re-authenticate to org
   sf auth web login --alias targetOrg
   ```

2. **No Changes Detected**
   ```bash
   # Force deployment
   ./cgeaa deploy --force
   
   # Check base branch
   ./cgeaa deploy -b main
   ```

3. **Test Failures**
   ```bash
   # Use different test level
   ./cgeaa deploy -t RunLocalTests
   
   # Skip tests (not recommended for production)
   ./cgeaa deploy -t NoTestRun
   ```

4. **Timeout Issues**
   ```bash
   # Increase timeout
   ./cgeaa deploy -w 1200
   ```

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
./cgeaa deploy --verbose
```

### Log Files

Temporary files created during operations:
- `files.txt` - List of changed files
- `changed_classes.txt` - Changed Apex classes
- `test_classes.txt` - Selected test classes
- `package.xml` - Generated deployment manifest
- `test-results/` - Test execution results and code coverage reports
- `query_result.json` - ApexCodeCoverage query results (temporary)

## Integration

### CI/CD Integration

CGEAA can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: |
    ./cgeaa test -o sandbox -v

- name: Deploy to Sandbox
  run: |
    ./cgeaa deploy -o sandbox -q --git-tag
  if: success()
```

### Git Hooks

Use CGEAA in git hooks for automated validation and testing:

```bash
#!/bin/bash
# pre-push hook - run tests before pushing
./cgeaa test -o BRInt -q || exit 1
./cgeaa validate --dry-run -q || exit 1
```

## Contributing

To contribute to CGEAA:

1. Follow the existing code style and patterns
2. Add comprehensive error handling
3. Include logging for all operations
4. Update documentation for new features
5. Test thoroughly across different scenarios

## License

This project is part of the CarGurus Enterprise Applications suite.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review log files for detailed error information
3. Use verbose mode for debugging
4. Consult the Salesforce CLI documentation for underlying issues

---

**CGEAA v1.0.0** - CarGurus Enterprise Applications Automation
