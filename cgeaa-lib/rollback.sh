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

    # Determine rollback target branch
    local rollback_branch="$ROLLBACK_BRANCH"
    
    if [ -z "$rollback_branch" ]; then
        # Prompt user for target branch to rollback to
        echo
        log_info "Current branch: $current_branch"
        echo
        
        read -p "Enter the branch to rollback to (default: main): " rollback_branch
        rollback_branch="${rollback_branch:-main}"
    else
        log_info "Rollback target branch: $rollback_branch (specified via --rollback-to)"
    fi
    
    # Verify the branch exists
    if ! git rev-parse --verify "$rollback_branch" >/dev/null 2>&1; then
        log_error "Branch '$rollback_branch' does not exist."
        exit 1
    fi
    
    # Get the base branch to compare against (typically main)
    local base_branch="${BASE_BRANCH:-main}"
    
    log_info "Finding files changed in '$current_branch' compared to '$base_branch' (including uncommitted changes)..."
    log_info "These files will be deployed from '$rollback_branch' version."
    
    # Get changed files from base branch to working directory (includes uncommitted changes)
    # Uses same logic as get_changed_files in utils.sh
    local changed_files=()
    while IFS= read -r line; do
        changed_files+=("$line")
    done < <(git diff --name-only ${base_branch} | grep -E '(^|/)force-app/')

    if [ ${#changed_files[@]} -eq 0 ]; then
        log_warning "No file changes detected between '$current_branch' and '$base_branch'. Nothing to roll back."
        exit 0
    fi

    log_warning "This will deploy the '$rollback_branch' version of your changed files to '$TARGET_ORG'."
    log_info "Files changed in '$current_branch' (will be reverted to '$rollback_branch' version):"
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

    log_info "Staging reverted files from '$rollback_branch' in a temporary directory: $temp_dir"
    for file in "${changed_files[@]}"; do
        # Strip any parent directory prefix (e.g., Bedrock/) to get relative path from force-app
        local target_path="$file"
        if [[ "$file" == *"/force-app/"* ]]; then
            target_path="${file##*/force-app/}"
            target_path="force-app/$target_path"
        fi
        
        # Ensure the directory structure exists in the temp folder
        mkdir -p "$temp_dir/$(dirname "$target_path")"
        # Copy the version from rollback_branch into the temp folder (using original path for git show)
        git show "${rollback_branch}:$file" > "$temp_dir/$target_path"
    done

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
