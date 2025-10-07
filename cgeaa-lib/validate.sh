#!/bin/bash

# CGEAA Validation Module
# Handles validation operations without deployment

# Execute validation
execute_validation() {
    local start_time=$(date +%s)
    
    log_step "Starting validation process"
    
    # Check dependencies and authentication
    check_dependencies
    check_git_repo
    check_sf_auth "$TARGET_ORG"
    
    # Show branch information
    validate_branch_for_deployment
    
    # Determine base reference for comparison
    local base_ref=""
    if [ -n "$MANIFEST_FILE" ] && [ -f "$MANIFEST_FILE" ]; then
        log_info "Using provided manifest file: $MANIFEST_FILE"
    else
        base_ref=$(determine_base_reference)
        log_info "Comparing against: $base_ref"
    fi
    
    # Get changed files or use manifest
    local changed_files=""
    local files_count=0
    
    if [ -n "$MANIFEST_FILE" ] && [ -f "$MANIFEST_FILE" ]; then
        files_count=$(grep -c "<name>" "$MANIFEST_FILE" 2>/dev/null || echo "unknown")
        log_info "Using manifest with $files_count components"
    else
        changed_files=$(get_changed_files "$base_ref")
        local force_app_files=$(echo "$changed_files" | filter_force_app_files)
        
        if [ -z "$force_app_files" ] && [ "$FORCE_DEPLOY" != "true" ]; then
            log_warning "No Salesforce changes detected since $base_ref"
            if [ "$DRY_RUN" = "true" ]; then
                log_info "Dry run: Would exit with no changes"
            else
                log_info "Nothing to validate"
            fi
            return 0
        fi
        
        # Count files
        files_count=$(echo "$force_app_files" | wc -l | xargs)
        if [ "$files_count" -eq 0 ] && [ "$FORCE_DEPLOY" = "true" ]; then
            log_warning "Force validation requested but no changes found"
        fi
        
        log_info "Found $files_count changed files"
        
        # Generate manifest if we have files
        if [ -n "$force_app_files" ]; then
            echo "$force_app_files" > files.txt
            if ! generate_manifest "$force_app_files" "package.xml"; then
                log_error "Failed to generate package manifest"
                cleanup_temp_files
                exit 1
            fi
            MANIFEST_FILE="package.xml"
        fi
    fi
    
    # Show what would be validated in dry run mode
    if [ "$DRY_RUN" = "true" ]; then
        show_dry_run_validation "$MANIFEST_FILE" "$files_count"
        cleanup_temp_files
        return 0
    fi
    
    # Perform validation
    if [ -f "$MANIFEST_FILE" ]; then
        perform_validation "$MANIFEST_FILE"
    else
        log_error "No manifest file available for validation"
        cleanup_temp_files
        exit 1
    fi
    
    # Calculate duration and show summary
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    show_deployment_summary "VALIDATION" "$TARGET_ORG" "$TEST_LEVEL" "$files_count" "$duration"
    
    # Cleanup
    if [ "$(get_config 'auto_cleanup')" = "true" ]; then
        cleanup_temp_files
    fi
}

# Determine base reference for comparison
determine_base_reference() {
    local base_ref=""
    
    if [ -n "$BASE_BRANCH" ]; then
        # Check if base branch exists
        if git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
            base_ref="$BASE_BRANCH"
            log_debug "Using specified base branch: $BASE_BRANCH"
        else
            log_warning "Base branch '$BASE_BRANCH' not found, trying to find latest tag"
        fi
    fi
    
    # If no base branch or branch not found, try to find latest tag
    if [ -z "$base_ref" ]; then
        local tag_prefix=$(get_branch_based_tag_prefix)
        local latest_tag=$(get_latest_tag "$tag_prefix")
        if [ -n "$latest_tag" ]; then
            base_ref="$latest_tag"
            log_debug "Using latest tag: $latest_tag"
        else
            # Fallback to HEAD~1 or initial commit
            if git rev-parse --verify HEAD~1 >/dev/null 2>&1; then
                base_ref="HEAD~1"
                log_debug "Using HEAD~1 as base reference"
            else
                base_ref=$(git rev-list --max-parents=0 HEAD)
                log_debug "Using initial commit as base reference"
            fi
        fi
    fi
    
    echo "$base_ref"
}

# Show dry run validation details
show_dry_run_validation() {
    local manifest_file="$1"
    local files_count="$2"
    
    echo
    log_info "=== DRY RUN - Validation Preview ==="
    log_info "Target Org: $TARGET_ORG"
    log_info "Test Level: $TEST_LEVEL"
    log_info "Timeout: ${TIMEOUT}s"
    log_info "Files to validate: $files_count"
    
    if [ -f "$manifest_file" ]; then
        echo
        log_info "Components in manifest:"
        # Extract component names from package.xml
        grep -o '<name>[^<]*</name>' "$manifest_file" | sed 's/<name>\(.*\)<\/name>/  - \1/' | head -20
        
        local total_components=$(grep -c '<name>' "$manifest_file")
        if [ "$total_components" -gt 20 ]; then
            log_info "  ... and $((total_components - 20)) more components"
        fi
    fi
    
    echo
    log_info "Command that would be executed:"
    log_info "sf project deploy validate -x $manifest_file -l $TEST_LEVEL -w $TIMEOUT -o $TARGET_ORG"
    echo
}

# Perform the actual validation
perform_validation() {
    local manifest_file="$1"
    
    log_step "Validating deployment package"
    log_info "Manifest: $manifest_file"
    log_info "Test Level: $TEST_LEVEL"
    log_info "Timeout: ${TIMEOUT}s"
    
    # Build SF CLI command based on test level
    local sf_command=""
    
    if [ "$TEST_LEVEL" = "NoTestRun" ]; then
        # Use deploy start --dry-run for NoTestRun (validate doesn't support NoTestRun)
        log_info "Using 'deploy start --dry-run' for NoTestRun test level"
        sf_command="sf project deploy start --dry-run"
        sf_command="$sf_command -x $manifest_file"
        sf_command="$sf_command -w $TIMEOUT"
        sf_command="$sf_command -o $TARGET_ORG"
    else
        # Use deploy validate for all other test levels
        sf_command="sf project deploy validate"
        sf_command="$sf_command -x $manifest_file"
        sf_command="$sf_command -l $TEST_LEVEL"
        sf_command="$sf_command -w $TIMEOUT"
        sf_command="$sf_command -o $TARGET_ORG"
        
        # Add test classes if specified for RunSpecifiedTests
        if [ "$TEST_LEVEL" = "RunSpecifiedTests" ] && [ -n "$TEST_CLASSES" ]; then
            log_info "Test Classes: $TEST_CLASSES"
            sf_command="$sf_command --tests $TEST_CLASSES"
        elif [ "$TEST_LEVEL" = "RunSpecifiedTests" ] && [ -z "$TEST_CLASSES" ]; then
            log_warning "RunSpecifiedTests requires test classes. Use --tests option or the script will attempt to find them automatically."
        fi
    fi
    
    if [ "$VERBOSE" = "true" ]; then
        sf_command="$sf_command --verbose"
    fi
    
    log_debug "Executing: $sf_command"
    
    # Execute validation
    if eval "$sf_command"; then
        log_success "Validation completed successfully!"
        
        # Show validation details if verbose
        if [ "$VERBOSE" = "true" ]; then
            log_info "Getting validation details..."
            sf project deploy report --use-most-recent -o "$TARGET_ORG" || true
        fi
        
        return 0
    else
        log_error "Validation failed!"
        
        # Try to get more details about the failure
        log_info "Getting failure details..."
        sf project deploy report --use-most-recent -o "$TARGET_ORG" || true
        
        return 1
    fi
}

# Find and run specific test classes
find_and_run_tests() {
    local base_ref="$1"
    
    if [ "$TEST_LEVEL" != "RunSpecifiedTests" ]; then
        return 0
    fi
    
    log_step "Finding relevant test classes"
    
    # Get changed Apex classes
    local changed_files=$(get_changed_files "$base_ref")
    local apex_files=$(echo "$changed_files" | grep '\.cls$' | filter_force_app_files)
    
    if [ -z "$apex_files" ]; then
        log_warning "No Apex classes changed, using RunLocalTests instead"
        TEST_LEVEL="RunLocalTests"
        return 0
    fi
    
    # Extract class names
    echo "$apex_files" > changed_classes.txt
    local class_names=$(sed 's|.*/\([^/]*\)\.cls|\1|' changed_classes.txt | tr '\n' ' ')
    
    log_debug "Changed classes: $class_names"
    
    # Find test classes using Tooling API (similar to existing workflow)
    local test_classes=""
    
    # Coverage-based detection
    local coverage_query="SELECT ApexTestClass.Name FROM ApexCodeCoverage WHERE ApexClassOrTrigger.Name IN ('$(echo "$class_names" | sed "s/ /','/g")')"
    
    if sf data query --query "$coverage_query" --target-org "$TARGET_ORG" --json > query_result.json 2>query_error.txt; then
        test_classes=$(jq -r '.result.records[].ApexTestClass.Name' query_result.json 2>/dev/null | sort -u | tr '\n' ' ')
    fi
    
    # Name-based detection (classes with 'test' in name)
    local name_based_tests=$(echo "$class_names" | tr ' ' '\n' | grep -i test | tr '\n' ' ')
    
    # Combine and deduplicate
    local all_tests="$test_classes $name_based_tests"
    test_classes=$(echo "$all_tests" | tr ' ' '\n' | sort -u | tr '\n' ' ' | sed 's/^ *//;s/ *$//')
    
    if [ -n "$test_classes" ]; then
        log_info "Found test classes: $test_classes"
        # Note: For validation, we'll stick with the configured test level
        # The specific test classes would be used in actual deployment
    else
        log_warning "No specific test classes found, using RunLocalTests"
        TEST_LEVEL="RunLocalTests"
    fi
    
    return 0
}
