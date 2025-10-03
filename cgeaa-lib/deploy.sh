#!/bin/bash

# CGEAA Deployment Module
# Handles actual deployment operations

# Execute deployment
execute_deployment() {
    local start_time=$(date +%s)
    
    log_step "Starting deployment process"
    
    # Check dependencies and authentication
    check_dependencies
    check_git_repo
    check_sf_auth "$TARGET_ORG"
    
    # Show branch information and validate
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
    local test_classes=""
    
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
                log_info "Nothing to deploy"
            fi
            return 0
        fi
        
        # Count files
        files_count=$(echo "$force_app_files" | wc -l | xargs)
        if [ "$files_count" -eq 0 ] && [ "$FORCE_DEPLOY" = "true" ]; then
            log_warning "Force deployment requested but no changes found"
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
        
        # Find specific test classes if needed
        if [ "$TEST_LEVEL" = "RunSpecifiedTests" ]; then
            test_classes=$(find_test_classes "$base_ref")
            if [ -z "$test_classes" ]; then
                log_warning "No specific test classes found, switching to RunLocalTests"
                TEST_LEVEL="RunLocalTests"
            fi
        fi
    fi
    
    # Show what would be deployed in dry run mode
    if [ "$DRY_RUN" = "true" ]; then
        show_dry_run_deployment "$MANIFEST_FILE" "$files_count" "$test_classes"
        cleanup_temp_files
        return 0
    fi
    
    # Perform deployment
    if [ -f "$MANIFEST_FILE" ]; then
        if perform_deployment "$MANIFEST_FILE" "$test_classes"; then
            # Tag the deployment if successful
            tag_deployment
        else
            log_error "Deployment failed!"
            cleanup_temp_files
            exit 1
        fi
    else
        log_error "No manifest file available for deployment"
        cleanup_temp_files
        exit 1
    fi
    
    # Calculate duration and show summary
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    show_deployment_summary "DEPLOYMENT" "$TARGET_ORG" "$TEST_LEVEL" "$files_count" "$duration"
    
    # Cleanup
    if [ "$(get_config 'auto_cleanup')" = "true" ]; then
        cleanup_temp_files
    fi
}

# Show dry run deployment details
show_dry_run_deployment() {
    local manifest_file="$1"
    local files_count="$2"
    local test_classes="$3"
    
    echo
    log_info "=== DRY RUN - Deployment Preview ==="
    log_info "Target Org: $TARGET_ORG"
    log_info "Test Level: $TEST_LEVEL"
    log_info "Timeout: ${TIMEOUT}s"
    log_info "Files to deploy: $files_count"
    
    if [ -n "$test_classes" ]; then
        log_info "Test Classes: $test_classes"
    fi
    
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
    local cmd="sf project deploy start -x $manifest_file -l $TEST_LEVEL -w $TIMEOUT -o $TARGET_ORG"
    if [ -n "$test_classes" ]; then
        cmd="$cmd --tests $test_classes"
    fi
    log_info "$cmd"
    
    echo
    local next_tag=$(get_next_branch_tag)
    log_info "Tag that would be created: $next_tag"
    echo
}

# Perform the actual deployment
perform_deployment() {
    local manifest_file="$1"
    local test_classes="$2"
    
    log_step "Deploying package"
    log_info "Manifest: $manifest_file"
    log_info "Test Level: $TEST_LEVEL"
    log_info "Timeout: ${TIMEOUT}s"
    
    if [ -n "$test_classes" ]; then
        log_info "Test Classes: $test_classes"
    fi
    
    # Build SF CLI command
    local sf_command="sf project deploy start"
    sf_command="$sf_command -x $manifest_file"
    sf_command="$sf_command -l $TEST_LEVEL"
    sf_command="$sf_command -w $TIMEOUT"
    sf_command="$sf_command -o $TARGET_ORG"
    
    if [ -n "$test_classes" ] && [ "$TEST_LEVEL" = "RunSpecifiedTests" ]; then
        sf_command="$sf_command --tests \"$test_classes\""
    fi
    
    if [ "$VERBOSE" = "true" ]; then
        sf_command="$sf_command --verbose"
    fi
    
    log_debug "Executing: $sf_command"
    
    # Execute deployment
    if eval "$sf_command"; then
        log_success "Deployment completed successfully!"
        
        # Show deployment details if verbose
        if [ "$VERBOSE" = "true" ]; then
            log_info "Getting deployment details..."
            sf project deploy report --use-most-recent -o "$TARGET_ORG" || true
        fi
        
        return 0
    else
        log_error "Deployment failed!"
        
        # Try to get more details about the failure
        log_info "Getting failure details..."
        sf project deploy report --use-most-recent -o "$TARGET_ORG" || true
        
        return 1
    fi
}

# Find test classes for deployment
find_test_classes() {
    local base_ref="$1"
    local test_classes=""
    
    log_step "Finding relevant test classes"
    
    # Get changed Apex classes
    local changed_files=$(get_changed_files "$base_ref")
    local apex_files=$(echo "$changed_files" | grep '\.cls$' | filter_force_app_files)
    
    if [ -z "$apex_files" ]; then
        log_debug "No Apex classes changed"
        return 0
    fi
    
    # Extract class names from file paths
    echo "$apex_files" > changed_classes.txt
    local class_names=""
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            local class_name=$(basename "$file" .cls)
            class_names="$class_names $class_name"
        fi
    done < changed_classes.txt
    
    class_names=$(echo "$class_names" | xargs)  # Trim whitespace
    
    if [ -z "$class_names" ]; then
        log_debug "No class names extracted"
        return 0
    fi
    
    log_debug "Changed classes: $class_names"
    
    # Coverage-based detection using Tooling API
    local coverage_tests=""
    local quoted_names=$(echo "$class_names" | sed "s/ /','/g")
    local coverage_query="SELECT ApexTestClass.Name FROM ApexCodeCoverage WHERE ApexClassOrTrigger.Name IN ('$quoted_names')"
    
    log_debug "Coverage query: $coverage_query"
    
    if sf data query --query "$coverage_query" --target-org "$TARGET_ORG" --json > query_result.json 2>query_error.txt; then
        if command_exists jq; then
            coverage_tests=$(jq -r '.result.records[]?.ApexTestClass.Name // empty' query_result.json 2>/dev/null | sort -u | tr '\n' ' ')
        else
            # Fallback parsing without jq
            coverage_tests=$(grep -o '"Name":"[^"]*"' query_result.json 2>/dev/null | cut -d'"' -f4 | sort -u | tr '\n' ' ')
        fi
        log_debug "Coverage-based tests: $coverage_tests"
    else
        log_debug "Coverage query failed, checking error..."
        if [ -f query_error.txt ]; then
            log_debug "Query error: $(cat query_error.txt)"
        fi
    fi
    
    # Name-based detection (classes with 'test' in name)
    local name_based_tests=""
    for class_name in $class_names; do
        if echo "$class_name" | grep -qi test; then
            name_based_tests="$name_based_tests $class_name"
        fi
    done
    name_based_tests=$(echo "$name_based_tests" | xargs)  # Trim whitespace
    
    log_debug "Name-based tests: $name_based_tests"
    
    # Combine and deduplicate test classes
    local all_tests="$coverage_tests $name_based_tests"
    if [ -n "$all_tests" ]; then
        test_classes=$(echo "$all_tests" | tr ' ' '\n' | grep -v '^$' | sort -u | tr '\n' ' ' | sed 's/^ *//;s/ *$//')
        log_debug "Combined test classes: $test_classes"
    fi
    
    if [ -n "$test_classes" ]; then
        log_info "Found test classes: $test_classes"
        echo "$test_classes"
    else
        log_debug "No test classes found"
        echo ""
    fi
}

# Tag the deployment
tag_deployment() {
    local next_tag=$(get_next_branch_tag)
    
    log_step "Tagging deployment: $next_tag"
    
    if git tag "$next_tag"; then
        log_success "Created tag: $next_tag"
        
        # Push tag to remote
        if git push origin "$next_tag" 2>/dev/null; then
            log_success "Pushed tag to remote: $next_tag"
        else
            log_warning "Failed to push tag to remote (tag created locally)"
        fi
    else
        log_error "Failed to create tag: $next_tag"
        return 1
    fi
}

# Determine base reference for comparison (same as validation)
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
