#!/bin/bash

# CGEAA Manifest Module
# Generates a Salesforce package manifest from changed files

execute_manifest() {
    local start_time=$(date +%s)

    log_step "Starting manifest generation"

    check_dependencies
    check_git_repo

    # Determine base reference
    local base_ref=""
    if [ -n "$BASE_BRANCH" ]; then
        if git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
            base_ref="$BASE_BRANCH"
            log_debug "Using base branch: $BASE_BRANCH"
        else
            log_warning "Base branch '$BASE_BRANCH' not found, trying latest tag"
        fi
    fi

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

    # Get changed files scoped to force-app/
    local changed_files=$(get_changed_files "$base_ref")
    local force_app_files=$(echo "$changed_files" | filter_force_app_files)

    if [ -z "$force_app_files" ]; then
        log_warning "No Salesforce changes detected since $base_ref — nothing to include in manifest"
        return 0
    fi

    local files_count=$(echo "$force_app_files" | wc -l | xargs)
    log_info "Found $files_count changed file(s)"

    if [ "$VERBOSE" = "true" ]; then
        log_info "Changed files:"
        echo "$force_app_files" | while IFS= read -r f; do
            log_info "  $f"
        done
    fi

    # Determine output path
    local output_file="${MANIFEST_FILE:-package.xml}"

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would generate manifest: $output_file"
        log_info "[DRY RUN] Command: sf project generate manifest -p <${files_count} files> --output-dir <dir> --name package"
        return 0
    fi

    echo "$force_app_files" > files.txt

    if generate_manifest "$force_app_files" "$output_file"; then
        local end_time=$(date +%s)
        local duration=$((end_time - start_time))
        echo
        log_success "=== Manifest Generation Summary ==="
        log_info "Output file:  $output_file"
        log_info "Files included: $files_count"
        log_info "Base reference: $base_ref"
        log_info "Duration: $(format_duration "$duration")"
        echo
    else
        log_error "Manifest generation failed"
        cleanup_temp_files
        exit 1
    fi

    if [ "$(get_config 'auto_cleanup')" = "true" ]; then
        cleanup_temp_files
    fi
}
