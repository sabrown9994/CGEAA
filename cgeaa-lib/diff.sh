#!/bin/bash

# CGEAA Diff Module
# Compare metadata between local source and a target org, or between two orgs

execute_diff() {
    check_dependencies
    check_sf_auth "$TARGET_ORG"

    case "$DIFF_DIRECTION" in
        local-to-org) diff_local_to_org ;;
        org-to-local) diff_org_to_local ;;
        org-to-org)   diff_org_to_org ;;
        *)            diff_local_to_org ;;  # sensible default
    esac
}

# Compare local source against what is deployed in the org.
# Reports components that differ (added, modified, deleted locally vs org).
diff_local_to_org() {
    log_step "Diffing local source → org: $TARGET_ORG"

    local manifest="${MANIFEST_FILE}"

    # If no manifest provided, generate one from changed files vs base branch
    if [ -z "$manifest" ] || [ ! -f "$manifest" ]; then
        log_info "No manifest specified — generating one from changes since $BASE_BRANCH"

        local changed_files=$(get_changed_files "$BASE_BRANCH")
        local force_app_files=$(echo "$changed_files" | filter_force_app_files)

        if [ -z "$force_app_files" ]; then
            log_warning "No Salesforce changes detected since $BASE_BRANCH — nothing to diff"
            return 0
        fi

        local files_count=$(echo "$force_app_files" | wc -l | xargs)
        log_info "Found $files_count changed file(s)"

        if [ "$DRY_RUN" = "true" ]; then
            log_info "[DRY RUN] Would generate manifest then run: sf project retrieve preview -o $TARGET_ORG"
            return 0
        fi

        if ! generate_manifest "$force_app_files" "diff-package.xml"; then
            log_error "Failed to generate manifest for diff"
            exit 1
        fi
        manifest="diff-package.xml"
    fi

    log_info "Using manifest: $manifest"
    log_debug "Executing: sf project retrieve preview -x $manifest -o $TARGET_ORG"

    if sf project retrieve preview -x "$manifest" -o "$TARGET_ORG"; then
        log_success "Diff complete — review the preview above to see what differs from the org"
    else
        log_error "Diff failed"
        [ "$manifest" = "diff-package.xml" ] && rm -f diff-package.xml
        return 1
    fi

    [ "$manifest" = "diff-package.xml" ] && rm -f diff-package.xml
}

# Show what the org has that differs from local source (retrieve preview, full component set).
diff_org_to_local() {
    log_step "Diffing org: $TARGET_ORG → local source"

    local manifest="${MANIFEST_FILE}"

    if [ -z "$manifest" ] || [ ! -f "$manifest" ]; then
        log_error "A manifest (-m) is required for org-to-local diff so the component scope is known"
        log_info "Example: cgeaa diff --direction org-to-local -m package.xml -o MyOrg"
        exit 1
    fi

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: sf project retrieve preview -x $manifest -o $TARGET_ORG"
        return 0
    fi

    log_debug "Executing: sf project retrieve preview -x $manifest -o $TARGET_ORG"

    if sf project retrieve preview -x "$manifest" -o "$TARGET_ORG"; then
        log_success "Diff complete"
    else
        log_error "Diff failed"
        return 1
    fi
}

# Deploy-preview between two orgs: show what would land in TARGET_ORG
# if you deployed from SOURCE_ORG's local retrieved source.
diff_org_to_org() {
    if [ -z "$DIFF_SOURCE_ORG" ]; then
        log_error "--source-org is required for org-to-org diff"
        log_info "Example: cgeaa diff --direction org-to-org --source-org BRInt -o BRStaging -m package.xml"
        exit 1
    fi

    local manifest="${MANIFEST_FILE}"
    if [ -z "$manifest" ] || [ ! -f "$manifest" ]; then
        log_error "A manifest (-m) is required for org-to-org diff"
        exit 1
    fi

    log_step "Diffing org: $DIFF_SOURCE_ORG → org: $TARGET_ORG"
    log_info "Retrieving from source org: $DIFF_SOURCE_ORG"

    local retrieve_dir="diff-retrieve-tmp"
    mkdir -p "$retrieve_dir"

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would retrieve from $DIFF_SOURCE_ORG then preview deploy to $TARGET_ORG"
        rm -rf "$retrieve_dir"
        return 0
    fi

    # Step 1: retrieve the components from the source org
    if ! sf project retrieve start -x "$manifest" -o "$DIFF_SOURCE_ORG" --output-dir "$retrieve_dir"; then
        log_error "Retrieve from source org failed"
        rm -rf "$retrieve_dir"
        return 1
    fi

    # Step 2: preview what deploying that retrieved source into the target org would change
    log_info "Previewing deploy into target org: $TARGET_ORG"
    if sf project deploy preview -x "$manifest" -o "$TARGET_ORG"; then
        log_success "Org-to-org diff complete"
    else
        log_error "Deploy preview failed"
        rm -rf "$retrieve_dir"
        return 1
    fi

    rm -rf "$retrieve_dir"
}
