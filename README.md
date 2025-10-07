# CGEAA - CarGurus Enterprise Applications Automation

A comprehensive shell script suite for automating Salesforce deployment and validation operations.

## Overview

CGEAA (CarGurus Enterprise Applications Automation) is a powerful command-line tool designed to streamline Salesforce development workflows by automating validation and deployment processes. Built with a modular architecture, it provides robust error handling, comprehensive logging, and flexible configuration options.

## Features

- **Git Tagging**: Optionally create git tags for successful deployments (e.g., Feature/PGTM-2270 → PGTM-2270-0001 tags) using `-gt` flag
- **Smart Org Management**: Lists and validates authenticated Salesforce CLI org aliases
- **Mixed Tag Format Support**: Handles both padded (0001) and unpadded (2) tag numbering for backward compatibility
- **Automated Change Detection**: Uses git diff to identify modified Salesforce components
- **Intelligent Test Selection**: Automatically finds relevant test classes using coverage analysis
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

# Deploy to integration sandbox (auto-detects story from branch)
./cgeaa deploy -o BRInt

# Open an org in the browser
./cgeaa open -o BRInt

# Run a deployment interactively
./cgeaa deploy --interactive

# Deploy to staging with all tests
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg

# Deploy and create git tag on success
./cgeaa deploy -o BRInt -gt

# Force deploy with verbose output
./cgeaa deploy -o Playground --force --verbose
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
default_test_level=NoTestRun

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
| `-t, --test-level <level>` | Test level | `NoTestRun` |
| `--tests <classes>` | Comma-separated test class names (required for `RunSpecifiedTests`) | Auto-detected |
| `-w, --timeout <seconds>` | Deployment timeout | `360` |
| `-b, --base-branch <branch>` | Base branch for comparison | `main` |
| `--rollback-to <branch>` | Target branch for rollback | `main` (interactive prompt if not specified) |
| `-m, --manifest <file>` | Use specific manifest file | Auto-generated |
| `-f, --force` | Force deployment even if no changes | `false` |
| `-d, --dry-run` | Show what would be deployed | `false` |
| `-v, --verbose` | Enable verbose output | `false` |
| `-q, --quiet` | Suppress non-essential output | `false` |
| `-i, --interactive` | Enable interactive mode for `validate` and `deploy` | `false` |
| `-gt, --git-tag` | Create a git tag upon successful deployment | `false` |
| `--tag-prefix <prefix>` | Tag prefix for deployment tracking | `CGEAA` |
| `--deployment-dir <dir>` | Deployment directory | `Bedrock` |

### Test Levels

- `NoTestRun` - No tests run (default, useful for quick validations)
- `RunSpecifiedTests` - Run only specified test classes (use `--tests` to specify, or auto-detect based on changed files)
- `RunLocalTests` - Run all local tests
- `RunAllTestsInOrg` - Run all tests in the org

**Note:** When using `RunSpecifiedTests`, you can either:
- Manually specify test classes with `--tests "TestClass1,TestClass2"`
- Let CGEAA auto-detect test classes based on changed Apex files (if `--tests` is not provided)

## Branch-Based Tagging

CGEAA automatically extracts story names from Feature branches to create meaningful deployment tags.

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

# Deploy to integration sandbox (auto-detects story from Feature branch)
./cgeaa deploy -o BRInt

# Deploy to staging with comprehensive testing
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg -v

# Validate with specific test classes
./cgeaa validate -t RunSpecifiedTests --tests "MyTestClass,AnotherTestClass"
```

### Advanced Usage

```bash
# Deploy from Feature/PGTM-2270 branch to playground
./cgeaa deploy -o Playground -v

# Deploy and create git tag on success
./cgeaa deploy -o Playground -gt
# Creates tag: PGTM-2270-0001 (or next number)

# Force deploy with custom timeout
./cgeaa deploy --force -w 600 -o BRStaging

# Use custom manifest file
./cgeaa validate -m custom-package.xml -o BRInt

# Deploy changes since specific branch
./cgeaa deploy -b develop -o BRStaging

# Deploy with specific test classes
./cgeaa deploy -o BRInt -t RunSpecifiedTests --tests "TestClass1,TestClass2,TestClass3"

# Validate without running tests (using dry-run deployment)
./cgeaa validate -t NoTestRun -o BRInt

# Roll back changes from the current branch on the staging org (interactive prompt for target branch)
./cgeaa rollback -o BRStaging

# Roll back to a specific branch without prompting
./cgeaa rollback -o BRStaging --rollback-to develop

# Update the CGEAA tool itself
./cgeaa update
```

### Workflow Integration

```bash
# Pre-commit validation (from Feature branch)
./cgeaa validate --dry-run -q

# Feature branch deployment to integration sandbox
./cgeaa deploy -o BRInt -gt
# Creates tag: PGTM-2270-0001 (from Feature/PGTM-2270)

# Promote to staging after integration testing
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg -gt
# Creates tag: PGTM-2270-0002

# Final validation before production
./cgeaa validate -o BRStaging --dry-run -v
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

### Workflow Process

1. **Initialization**: Load configuration and validate environment
2. **Change Detection**: Compare current branch with base reference
3. **Manifest Generation**: Create package.xml from changed files
4. **Test Selection**: Find relevant test classes (if applicable)
5. **Execution**: Perform validation or deployment
6. **Tagging**: Tag successful deployments
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

### Branch-Based Rollback

The `rollback` command provides a safe way to revert changes on an org. It works by:
1. Identifying all files changed in your current feature branch compared to the base branch (default: `main`).
2. Prompting you to select which branch to rollback to (or use `--rollback-to` to specify).
3. Creating a temporary deployment package containing the rollback target's version of only those changed files.
4. Deploying this package to the target org.

This ensures only YOUR feature branch changes are reverted, leaving other work untouched. The file list is calculated from your changes vs `main`, but the file contents come from the rollback target branch.

```bash
# From your feature branch, revert the changes on the Staging org (interactive prompt)
./cgeaa rollback -o BRStaging

# Rollback to a specific branch without prompting
./cgeaa rollback -o BRStaging --rollback-to develop

# Rollback to main branch
./cgeaa rollback -o BRStaging --rollback-to main

# Use a different base branch for comparison (calculate changed files from develop instead of main)
./cgeaa rollback -o BRStaging --rollback-to main -b develop

# Dry run to see what would be rolled back
./cgeaa rollback -o BRStaging --rollback-to main --dry-run
```

**Example Scenario:**
- You're on `Feature/ABC-123` which branched from `main`
- You modified 5 files in your feature branch
- You want to rollback to `develop` (which has different changes than `main`)
- The tool will:
  1. Calculate which 5 files YOU changed (comparing to `main`)
  2. Get the `develop` version of those 5 files
  3. Deploy only those 5 files from `develop`

**Note**: This command is disabled on primary branches like `main`, `master`, or `develop` to prevent accidental rollbacks.

### Git Tagging

CGEAA can automatically create git tags for successful deployments using the `-gt` or `--git-tag` flag. This provides deployment tracking and versioning.

**Tag Naming Convention:**
- **Feature branches** (e.g., `Feature/PGTM-2270`): Tags are prefixed with the story number → `PGTM-2270-0001`, `PGTM-2270-0002`, etc.
- **Other branches**: Uses the configured tag prefix → `CGEAA-0001`, `CGEAA-0002`, etc.

**Usage:**
```bash
# Deploy without creating a tag (default)
./cgeaa deploy -o BRInt

# Deploy and create a git tag on success
./cgeaa deploy -o BRInt -gt

# Deploy to staging with tag and push to remote
./cgeaa deploy -o BRStaging -t RunAllTestsInOrg -gt
```

**Behavior:**
- Tags are **only created on successful deployments**
- Tags are automatically pushed to the remote repository
- Sequential numbering is maintained per story/prefix
- Failed deployments do not create tags

**Custom Tag Prefix:**
You can customize the tag prefix using `--tag-prefix` or by setting `tag_prefix` in your config file:
```bash
# Use custom prefix for this deployment
./cgeaa deploy -o BRInt -gt --tag-prefix "RELEASE"
# Creates: RELEASE-0001, RELEASE-0002, etc.
```

### Self-Updating
To ensure you and your team are always using the latest version of CGEAA, you can use the `update` command. This command will:
1. Navigate to the source git repository for CGEAA.
2. Switch to the specified branch (default: `main`).
3. Pull the latest changes from that branch.
4. Re-run the global installation process.

```bash
# Update CGEAA from main branch (stable)
cgeaa update

# Update from a beta/testing branch
cgeaa update -b beta

# Update from develop branch
cgeaa update -b develop
```

**Branch Selection:**
- Use `-b <branch>` to specify which branch to update from
- Default is `main` for stable releases
- Use `beta` or `develop` branches to test new features before they're released

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

## Integration

### CI/CD Integration

CGEAA can be integrated into CI/CD pipelines:

```yaml
# Example GitHub Actions step
- name: Deploy to Sandbox
  run: |
    ./cgeaa deploy -o sandbox -q
```

### Git Hooks

Use CGEAA in git hooks for automated validation:

```bash
#!/bin/bash
# pre-push hook
./cgeaa validate --dry-run -q
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
