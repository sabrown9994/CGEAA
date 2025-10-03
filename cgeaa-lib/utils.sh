#!/bin/bash

# CGEAA Utility Functions
# Common functions used across CGEAA modules

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    if [ "${CGEAA_QUIET:-false}" != "true" ]; then
        echo -e "${BLUE}[INFO]${NC} $1" >&2
    fi
}

log_success() {
    if [ "${CGEAA_QUIET:-false}" != "true" ]; then
        echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
    fi
}

log_warning() {
    if [ "${CGEAA_QUIET:-false}" != "true" ]; then
        echo -e "${YELLOW}[WARNING]${NC} $1" >&2
    fi
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_debug() {
    if [ "${CGEAA_VERBOSE:-false}" = "true" ]; then
        echo -e "${PURPLE}[DEBUG]${NC} $1" >&2
    fi
}

log_step() {
    if [ "${CGEAA_QUIET:-false}" != "true" ]; then
        echo -e "${CYAN}[STEP]${NC} $1" >&2
    fi
}

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check required dependencies
check_dependencies() {
    log_step "Checking dependencies..."
    
    local missing_deps=()
    
    if ! command_exists git; then
        missing_deps+=("git")
    fi
    
    if ! command_exists sf; then
        missing_deps+=("sf (Salesforce CLI)")
    fi
    
    if [ ${#missing_deps[@]} -ne 0 ]; then
        log_error "Missing required dependencies:"
        for dep in "${missing_deps[@]}"; do
            log_error "  - $dep"
        done
        exit 1
    fi
    
    log_debug "All dependencies found"
}

# Check if we're in a git repository
check_git_repo() {
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not in a git repository"
        exit 1
    fi
    log_debug "Git repository confirmed"
}

# Check if SF CLI is authenticated
check_sf_auth() {
    local org="$1"
    log_step "Checking Salesforce authentication for org: $org"
    
    if ! validate_org_alias "$org"; then
        log_error "Org '$org' is not available"
        echo
        log_info "Available authenticated orgs:"
        list_orgs
        echo
        log_info "To authenticate a new org, run:"
        log_info "  sf auth web login --alias $org"
        exit 1
    fi
    
    log_debug "Authenticated to org: $org"
    
    # Show org details in verbose mode
    if [ "$VERBOSE" = "true" ]; then
        show_org_summary "$org"
    fi
}

# Get the latest tag with specified prefix
get_latest_tag() {
    local prefix="$1"
    local latest_tag=""
    local current_ref=0
    
    log_debug "Finding latest tag with prefix: $prefix"
    
    # Fetch tags to ensure we have the latest
    git fetch --tags > /dev/null 2>&1 || true
    
    # Get all tags with the specified prefix and sort them
    local tags=$(git tag -l "${prefix}-[0-9]*" | sort -V)
    
    if [ -n "$tags" ]; then
        for tag in $tags; do
            # Extract number after the last dash, handling both padded and unpadded formats
            local ref_num=$(echo "$tag" | sed -E "s/^${prefix}-0*([0-9]+)$/\1/")
            # Convert to integer for comparison
            if [ "$ref_num" -gt "$current_ref" ] 2>/dev/null; then
                current_ref="$ref_num"
                latest_tag="$tag"
            fi
        done
    fi
    
    if [ -n "$latest_tag" ]; then
        log_debug "Latest tag found: $latest_tag"
        echo "$latest_tag"
    else
        log_debug "No tags found with prefix: $prefix"
        echo ""
    fi
}

# Get next tag number
get_next_tag() {
    local prefix="$1"
    local latest_tag=$(get_latest_tag "$prefix")
    
    if [ -n "$latest_tag" ]; then
        local current_ref=$(echo "$latest_tag" | cut -d '-' -f 2)
        local next_ref=$((current_ref + 1))
        echo "${prefix}-${next_ref}"
    else
        echo "${prefix}-1"
    fi
}

# Get changed files since a reference point
get_changed_files() {
    local base_ref="$1"
    local filter="${2:-ACMR}"  # Added, Copied, Modified, Renamed by default
    
    log_debug "Getting changed files since: $base_ref"
    
    if [ -n "$base_ref" ]; then
        git diff --diff-filter="$filter" --name-only "$base_ref" HEAD
    else
        # If no base ref, get all force-app files
        find force-app -type f -name "*.cls" -o -name "*.trigger" -o -name "*.page" -o -name "*.component" -o -name "*-meta.xml" | head -100
    fi
}

# Filter files for Salesforce force-app directory
# Supports both 'force-app/' and 'Bedrock/force-app/' (or any parent directory)
filter_force_app_files() {
    grep -E '(^|/)force-app/' || true
}

# Generate package manifest
generate_manifest() {
    local files_list="$1"
    local manifest_file="${2:-package.xml}"
    
    log_step "Generating package manifest: $manifest_file"
    
    if [ -z "$files_list" ]; then
        log_error "No files provided for manifest generation"
        return 1
    fi
    
    log_debug "Files for manifest:"
    echo "$files_list" | while read -r file; do
        log_debug "  - $file"
    done
    
    # Generate manifest using SF CLI
    echo "$files_list" | sf project generate manifest --from-source-format > /dev/null 2>&1
    
    if [ -f "$manifest_file" ]; then
        log_success "Manifest generated: $manifest_file"
        return 0
    else
        log_error "Failed to generate manifest"
        return 1
    fi
}

# Clean up temporary files
cleanup_temp_files() {
    local files=("files.txt" "changed_classes.txt" "test_classes.txt" "query_error.txt" "query_result.json")
    
    for file in "${files[@]}"; do
        if [ -f "$file" ]; then
            rm -f "$file"
            log_debug "Cleaned up: $file"
        fi
    done
}

# Validate test level parameter
validate_test_level() {
    local test_level="$1"
    local valid_levels=("NoTestRun" "RunSpecifiedTests" "RunLocalTests" "RunAllTestsInOrg")
    
    for level in "${valid_levels[@]}"; do
        if [ "$test_level" = "$level" ]; then
            return 0
        fi
    done
    
    log_error "Invalid test level: $test_level"
    log_error "Valid options: ${valid_levels[*]}"
    return 1
}

# Format duration
format_duration() {
    local seconds="$1"
    local minutes=$((seconds / 60))
    local remaining_seconds=$((seconds % 60))
    
    if [ "$minutes" -gt 0 ]; then
        echo "${minutes}m ${remaining_seconds}s"
    else
        echo "${seconds}s"
    fi
}

# Show deployment summary
show_deployment_summary() {
    local operation="$1"
    local org="$2"
    local test_level="$3"
    local files_count="$4"
    local duration="$5"
    
    echo
    log_success "=== CGEAA ${operation} Summary ==="
    log_info "Operation: $operation"
    log_info "Target Org: $org"
    log_info "Test Level: $test_level"
    log_info "Files Processed: $files_count"
    log_info "Duration: $(format_duration "$duration")"
    echo
}
