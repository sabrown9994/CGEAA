#!/bin/bash

# CGEAA Test Module
# Handles asynchronous Apex test execution

# Execute test run
execute_test() {
    local start_time=$(date +%s)
    
    log_step "Starting test execution"
    
    # Check dependencies and authentication
    check_dependencies
    check_git_repo
    check_sf_auth "$TARGET_ORG"
    
    # Auto-detect test classes if TEST_LEVEL is not specified
    if [ -z "$TEST_LEVEL" ] || [ "$TEST_LEVEL" = "$DEFAULT_TEST_LEVEL" ]; then
        log_info "No test level specified, automatically detecting test classes..."
        auto_detect_test_classes
    fi
    
    # Initialize test run parameters
    local test_run_async=true
    local output_dir="test-results"
    local result_format="human"
    local code_coverage=false
    local detailed_coverage=false
    
    # Parse additional test-specific flags
    if [ "$VERBOSE" = "true" ]; then
        result_format="human"
        detailed_coverage=true
    fi
    
    # Create output directory if it doesn't exist
    if [ ! -d "$output_dir" ]; then
        mkdir -p "$output_dir"
        log_debug "Created test results directory: $output_dir"
    fi
    
    log_info "Target Org: ${TARGET_ORG}"
    log_info "Test Level: ${TEST_LEVEL}"
    log_info "Async Mode: ${test_run_async}"
    
    # Execute test based on test level
    case "$TEST_LEVEL" in
        "RunSpecifiedTests")
            if [ -z "$TEST_CLASSES" ]; then
                log_error "Test classes must be specified with --tests option for RunSpecifiedTests"
                exit 1
            fi
            run_specified_tests "$TEST_CLASSES" "$output_dir" "$result_format" "$detailed_coverage"
            ;;
        "RunLocalTests")
            run_local_tests "$output_dir" "$result_format" "$detailed_coverage"
            ;;
        "RunAllTestsInOrg")
            run_all_tests "$output_dir" "$result_format" "$detailed_coverage"
            ;;
        "NoTestRun")
            log_warning "NoTestRun specified - no tests will be executed"
            return 0
            ;;
        *)
            log_error "Invalid test level: $TEST_LEVEL"
            log_error "Valid options: RunSpecifiedTests, RunLocalTests, RunAllTestsInOrg, NoTestRun"
            exit 1
            ;;
    esac
    
    # Calculate duration and show summary
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    show_test_summary "$duration" "$output_dir"
}

# Run specified test classes
run_specified_tests() {
    local test_classes="$1"
    local output_dir="$2"
    local result_format="$3"
    local detailed_coverage="$4"
    
    log_step "Running specified test classes"
    log_info "Test classes: $test_classes"
    
    # Build the command
    local sf_command="sf apex run test"
    sf_command="$sf_command --class-names $test_classes"
    sf_command="$sf_command --target-org $TARGET_ORG"
    sf_command="$sf_command --result-format $result_format"
    sf_command="$sf_command --output-dir $output_dir"
    sf_command="$sf_command --wait $TIMEOUT"
    sf_command="$sf_command --code-coverage"
    
    if [ "$detailed_coverage" = "true" ]; then
        sf_command="$sf_command --detailed-coverage"
    fi
    
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: $sf_command"
        return 0
    fi
    
    log_debug "Executing: $sf_command"
    
    # Execute the test run
    if eval "$sf_command"; then
        log_success "Test execution completed successfully!"
        process_test_results "$output_dir"
        return 0
    else
        log_error "Test execution failed!"
        process_test_results "$output_dir"
        return 1
    fi
}

# Run all local tests
run_local_tests() {
    local output_dir="$1"
    local result_format="$2"
    local detailed_coverage="$3"
    
    log_step "Running all local tests"
    log_info "This will run all tests in your local namespace"
    
    # Build the command
    local sf_command="sf apex run test"
    sf_command="$sf_command --test-level RunLocalTests"
    sf_command="$sf_command --target-org $TARGET_ORG"
    sf_command="$sf_command --result-format $result_format"
    sf_command="$sf_command --output-dir $output_dir"
    sf_command="$sf_command --wait $TIMEOUT"
    sf_command="$sf_command --code-coverage"
    
    if [ "$detailed_coverage" = "true" ]; then
        sf_command="$sf_command --detailed-coverage"
    fi
    
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: $sf_command"
        return 0
    fi
    
    log_debug "Executing: $sf_command"
    
    # Execute the test run
    if eval "$sf_command"; then
        log_success "Test execution completed successfully!"
        process_test_results "$output_dir"
        return 0
    else
        log_error "Test execution failed!"
        process_test_results "$output_dir"
        return 1
    fi
}

# Run all tests in org
run_all_tests() {
    local output_dir="$1"
    local result_format="$2"
    local detailed_coverage="$3"
    
    log_step "Running all tests in org"
    log_warning "This will run ALL tests including managed packages - this may take a long time!"
    
    # Confirmation for running all tests
    if [ "$DRY_RUN" = "false" ] && [ "$FORCE_DEPLOY" != "true" ]; then
        read -p "Are you sure you want to run all tests in the org? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Test execution cancelled by user."
            return 0
        fi
    fi
    
    # Build the command
    local sf_command="sf apex run test"
    sf_command="$sf_command --test-level RunAllTestsInOrg"
    sf_command="$sf_command --target-org $TARGET_ORG"
    sf_command="$sf_command --result-format $result_format"
    sf_command="$sf_command --output-dir $output_dir"
    sf_command="$sf_command --wait $TIMEOUT"
    sf_command="$sf_command --code-coverage"
    
    if [ "$detailed_coverage" = "true" ]; then
        sf_command="$sf_command --detailed-coverage"
    fi
    
    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: $sf_command"
        return 0
    fi
    
    log_debug "Executing: $sf_command"
    
    # Execute the test run
    if eval "$sf_command"; then
        log_success "Test execution completed successfully!"
        process_test_results "$output_dir"
        return 0
    else
        log_error "Test execution failed!"
        process_test_results "$output_dir"
        return 1
    fi
}

# Process and display test results
process_test_results() {
    local output_dir="$1"
    
    if [ ! -d "$output_dir" ]; then
        log_warning "Test results directory not found: $output_dir"
        return
    fi
    
    # Look for test result files
    local test_result_file="$output_dir/test-result-*.json"
    
    if compgen -G "$test_result_file" > /dev/null; then
        log_info "Test results saved to: $output_dir"
        
        if [ "$VERBOSE" = "true" ]; then
            log_info "Detailed test results:"
            for file in $test_result_file; do
                if [ -f "$file" ]; then
                    log_debug "Processing: $file"
                    # Display summary info from JSON if jq is available
                    if command_exists jq; then
                        local summary=$(jq -r '.summary // empty' "$file" 2>/dev/null)
                        if [ -n "$summary" ]; then
                            echo "$summary" | jq . 2>/dev/null || cat "$file"
                        fi
                    fi
                fi
            done
        fi
    else
        log_debug "No test result files found in $output_dir"
    fi
}

# Show test execution summary
show_test_summary() {
    local duration="$1"
    local output_dir="$2"
    
    echo
    log_info "=== TEST EXECUTION SUMMARY ==="
    log_info "Target Org: $TARGET_ORG"
    log_info "Test Level: $TEST_LEVEL"
    if [ -n "$TEST_CLASSES" ]; then
        log_info "Test Classes: $TEST_CLASSES"
    fi
    log_info "Duration: ${duration}s"
    log_info "Results Location: $output_dir"
    echo
    
    # Display coverage information if available
    local coverage_file="$output_dir/test-result-codecoverage.json"
    if [ -f "$coverage_file" ] && command_exists jq; then
        log_info "Code Coverage Summary:"
        local org_coverage=$(jq -r '.summary.orgWideCoverage // "N/A"' "$coverage_file" 2>/dev/null)
        if [ -n "$org_coverage" ] && [ "$org_coverage" != "N/A" ]; then
            log_info "  Org-wide Coverage: ${org_coverage}%"
        fi
    fi
}

# Auto-detect test classes based on changed files and coverage
auto_detect_test_classes() {
    log_step "Auto-detecting test classes"
    
    # Determine base reference for comparison
    local base_ref=""
    if [ -n "$BASE_BRANCH" ]; then
        if git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
            base_ref="$BASE_BRANCH"
            log_debug "Using base branch: $BASE_BRANCH"
        else
            log_warning "Base branch '$BASE_BRANCH' not found"
        fi
    fi
    
    # If no base branch, try to find latest tag or use HEAD~1
    if [ -z "$base_ref" ]; then
        local tag_prefix=$(get_branch_based_tag_prefix)
        local latest_tag=$(get_latest_tag "$tag_prefix")
        if [ -n "$latest_tag" ]; then
            base_ref="$latest_tag"
            log_debug "Using latest tag: $latest_tag"
        elif git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
            base_ref="HEAD~1"
            log_debug "Using HEAD~1 as base reference"
        else
            base_ref=$(git rev-list --max-parents=0 HEAD)
            log_debug "Using initial commit as base reference"
        fi
    fi
    
    log_info "Comparing against: $base_ref"
    
    # Get changed files
    local changed_files=$(get_changed_files "$base_ref")
    local apex_files=$(echo "$changed_files" | grep '\.cls$' | filter_force_app_files)
    
    if [ -z "$apex_files" ]; then
        log_info "No Apex classes changed, defaulting to RunLocalTests"
        TEST_LEVEL="RunLocalTests"
        return 0
    fi
    
    # Extract class names from file paths
    local class_names=""
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            local class_name=$(basename "$file" .cls)
            class_names="$class_names $class_name"
        fi
    done < <(echo "$apex_files")
    
    class_names=$(echo "$class_names" | xargs)  # Trim whitespace
    
    if [ -z "$class_names" ]; then
        log_info "No class names extracted, defaulting to RunLocalTests"
        TEST_LEVEL="RunLocalTests"
        return 0
    fi
    
    log_debug "Changed classes: $class_names"
    
    # Query ApexCodeCoverage to find tests that cover the changed classes
    local coverage_tests=""
    local quoted_names=$(echo "$class_names" | sed "s/ /','/g")
    local coverage_query="SELECT ApexTestClass.Name FROM ApexCodeCoverage WHERE ApexClassOrTrigger.Name IN ('$quoted_names')"
    
    log_debug "Querying ApexCodeCoverage for test classes..."
    
    if sf data query --query "$coverage_query" --target-org "$TARGET_ORG" --json > query_result.json 2>query_error.txt; then
        if command_exists jq; then
            coverage_tests=$(jq -r '.result.records[]?.ApexTestClass.Name // empty' query_result.json 2>/dev/null | sort -u | tr '\n' ' ')
        else
            # Fallback parsing without jq
            coverage_tests=$(grep -o '"Name":"[^"]*"' query_result.json 2>/dev/null | cut -d'"' -f4 | sort -u | tr '\n' ' ')
        fi
        log_debug "Coverage-based tests: $coverage_tests"
    else
        log_debug "Coverage query failed or returned no results"
        if [ -f query_error.txt ]; then
            log_debug "Query error: $(cat query_error.txt)"
        fi
    fi
    
    # Also include any test classes that were modified
    local name_based_tests=""
    for class_name in $class_names; do
        if echo "$class_name" | grep -qi test; then
            name_based_tests="$name_based_tests $class_name"
        fi
    done
    name_based_tests=$(echo "$name_based_tests" | xargs)  # Trim whitespace
    
    log_debug "Modified test classes: $name_based_tests"
    
    # Combine and deduplicate test classes
    local all_tests="$coverage_tests $name_based_tests"
    if [ -n "$all_tests" ]; then
        TEST_CLASSES=$(echo "$all_tests" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ',' | sed 's/,$//')
        log_info "Auto-detected test classes: $TEST_CLASSES"
        TEST_LEVEL="RunSpecifiedTests"
    else
        log_info "No specific test classes found, defaulting to RunLocalTests"
        TEST_LEVEL="RunLocalTests"
    fi
    
    # Cleanup temp files
    rm -f query_result.json query_error.txt
}
