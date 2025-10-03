#!/bin/bash

# CGEAA - Rollback Functionality (Branch-Based)

execute_rollback() {
    log_step "Initiating Branch-Based Rollback"

    if [ -z "$TARGET_ORG" ]; then
        log_error "No target org specified for rollback. Use -o or --org <alias>."
        exit 1
    fi

    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" == "main" || "$current_branch" == "master" || "$current_branch" == "develop" ]]; then
        log_error "Rollback from a primary branch ($current_branch) is not permitted."
        exit 1
    fi

    log_info "Finding files changed in branch '$current_branch' compared to 'main'..."
    mapfile -t changed_files < <(git diff --name-only main...HEAD)

    if [ ${#changed_files[@]} -eq 0 ]; then
        log_warning "No file changes detected between '$current_branch' and 'main'. Nothing to roll back."
        exit 0
    fi

    log_warning "This will revert all changes made in this branch on the org '$TARGET_ORG'."
    log_info "The following files will be reverted to their version in 'main':"
    for file in "${changed_files[@]}"; do
        echo "  - $file"
    done

    if [ "$DRY_RUN" = false ]; then
        read -p "Are you sure you want to proceed? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Rollback cancelled."
            exit 0
        fi
    fi

    local temp_dir
    temp_dir=$(mktemp -d)
    trap 'rm -rf -- "$temp_dir"' EXIT

    log_info "Staging reverted files in a temporary directory: $temp_dir"
    local manifest_content=""
    for file in "${changed_files[@]}"; do
        # Ensure the directory structure exists in the temp folder
        mkdir -p "$temp_dir/$(dirname "$file")"
        # Copy the version from main into the temp folder
        git show "main:$file" > "$temp_dir/$file"
        manifest_content+="$temp_dir/$file\n"
    done

    echo -e "$manifest_content" > "$temp_dir/manifest.txt"

    log_info "Generating package.xml for rollback..."
    sf project generate manifest --source-dir "$temp_dir" --name "RollbackPackage" --output-dir "$temp_dir"

    local package_xml_path="$temp_dir/RollbackPackage/package.xml"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would deploy the following package to '$TARGET_ORG':"
        cat "$package_xml_path"
        log_info "[DRY RUN] End of package."
        log_success "[DRY RUN] Rollback simulation complete."
        exit 0
    fi

    log_step "Executing Rollback Deployment"
    if ! sf project deploy start --manifest "$package_xml_path" --target-org "$TARGET_ORG" --test-level NoTestRun; then
        log_error "Rollback deployment failed. Check the output above for details."
        exit 1
    fi

    log_success "Branch changes have been successfully rolled back on org '$TARGET_ORG'."
}
