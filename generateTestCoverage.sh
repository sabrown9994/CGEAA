#!/bin/bash

# Salesforce Test Coverage Map Generator
# Queries ApexCodeCoverage and creates a JSON map of Apex Class -> Test Classes
# Standalone script - can be run from any directory

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1" >&2
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${CYAN}[DEBUG]${NC} $1" >&2
    fi
}

# Default values
TARGET_ORG=""
OUTPUT_FILE="test-coverage-map.json"
VERBOSE=false

# Usage function
show_usage() {
    cat << EOF
Usage: $(basename "$0") -o <org-alias> [-f <output-file>] [-v]

Generate a test coverage map by querying ApexCodeCoverage from a Salesforce org.

Options:
    -o, --org <alias>       Target org alias (required)
    -f, --file <path>       Output file path (default: test-coverage-map.json)
    -v, --verbose           Enable verbose output
    -h, --help              Show this help message

Example:
    $(basename "$0") -o BRInt -f coverage-map.json

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -o|--org)
            TARGET_ORG="$2"
            shift 2
            ;;
        -f|--file)
            OUTPUT_FILE="$2"
            shift 2
            ;;
        -v|--verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            show_usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Validate required parameters
if [ -z "$TARGET_ORG" ]; then
    log_error "Target org is required"
    show_usage
    exit 1
fi

# Check if sf CLI is available
if ! command -v sf &> /dev/null; then
    log_error "Salesforce CLI (sf) is not installed or not in PATH"
    exit 1
fi

# Check if jq is available
if ! command -v jq &> /dev/null; then
    log_error "jq is not installed. Please install it: brew install jq"
    exit 1
fi

# Verify org authentication
log_step "Verifying authentication to org: $TARGET_ORG"
if ! sf org display --target-org "$TARGET_ORG" &> /dev/null; then
    log_error "Not authenticated to org: $TARGET_ORG"
    log_error "Please authenticate first: sf org login web --alias $TARGET_ORG"
    exit 1
fi
log_success "Authenticated to $TARGET_ORG"

# Query ApexCodeCoverage
log_step "Querying ApexCodeCoverage object..."
log_info "This may take a few minutes depending on the size of your org"

QUERY="SELECT ApexClassOrTrigger.Name, ApexTestClass.Name FROM ApexCodeCoverage WHERE ApexClassOrTrigger.Name != null AND ApexTestClass.Name != null ORDER BY ApexClassOrTrigger.Name"

TEMP_RESULT="/tmp/cgeaa-coverage-query-$$.json"

if ! sf data query --query "$QUERY" --target-org "$TARGET_ORG" --use-tooling-api --json > "$TEMP_RESULT" 2>&1; then
    log_error "Failed to query ApexCodeCoverage"
    cat "$TEMP_RESULT"
    rm -f "$TEMP_RESULT"
    exit 1
fi

# Check if query returned results
RECORD_COUNT=$(jq -r '.result.records | length' "$TEMP_RESULT" 2>/dev/null || echo "0")

if [ "$RECORD_COUNT" -eq 0 ]; then
    log_warning "No coverage data found in org: $TARGET_ORG"
    log_warning "You may need to run tests first to generate coverage data"
    log_info "Run: sf apex run test --test-level RunLocalTests --target-org $TARGET_ORG --wait 60"
    rm -f "$TEMP_RESULT"
    exit 1
fi

log_success "Found $RECORD_COUNT coverage records"

# Process the results and build the map
log_step "Building coverage map..."

# Use jq to transform the data into the desired format
jq -r '
{
  "version": "1.0",
  "lastUpdated": (now | strftime("%Y-%m-%dT%H:%M:%SZ")),
  "description": "Salesforce Test Coverage Map - Maps Apex classes to their test classes",
  "recordCount": (.result.records | length),
  "coverage": (
    .result.records
    | group_by(.ApexClassOrTrigger.Name)
    | map({
        key: .[0].ApexClassOrTrigger.Name,
        value: (map(.ApexTestClass.Name) | unique | sort)
      })
    | from_entries
  )
}' "$TEMP_RESULT" > "$OUTPUT_FILE"

if [ $? -eq 0 ]; then
    CLASS_COUNT=$(jq -r '.coverage | length' "$OUTPUT_FILE")
    log_success "Coverage map generated successfully!"
    log_info "Output file: $OUTPUT_FILE"
    log_info "Apex classes mapped: $CLASS_COUNT"
    log_info "Total coverage records: $RECORD_COUNT"
    
    if [ "$VERBOSE" = true ]; then
        echo
        log_info "Sample of coverage map:"
        jq -r '.coverage | to_entries | .[0:5] | .[] | "  \(.key) -> \(.value | join(", "))"' "$OUTPUT_FILE"
        if [ "$CLASS_COUNT" -gt 5 ]; then
            echo "  ..."
        fi
    fi
    
    echo
    log_info "Next steps:"
    log_info "1. Review the generated file: cat $OUTPUT_FILE | jq ."
    log_info "2. Upload to GitHub Gist: gh gist create $OUTPUT_FILE --desc 'Salesforce Test Coverage Map'"
    log_info "3. Or update existing gist: See documentation for update commands"
else
    log_error "Failed to generate coverage map"
    rm -f "$TEMP_RESULT"
    exit 1
fi

# Cleanup
rm -f "$TEMP_RESULT"

log_success "Done!"