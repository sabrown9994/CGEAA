#!/bin/bash

# CGEAA - Update Functionality

execute_update() {
    log_step "Starting CGEAA Update"

    load_config
    local source_repo_path
    source_repo_path=$(get_config_value "source_repo_path")

    if [[ -z "$source_repo_path" || ! -d "$source_repo_path/.git" ]]; then
        log_error "CGEAA source repository path not found or is not a git repository."
        log_error "Please run the setup script from the git repository to configure it: ./cgeaa-setup"
        exit 1
    fi

    log_info "Navigating to source repository: $source_repo_path"
    cd "$source_repo_path"

    # Use the specified branch from -b flag, or default to main
    local target_branch="${BASE_BRANCH:-main}"
    
    # Ensure we're on the target branch
    local current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [ "$current_branch" != "$target_branch" ]; then
        log_warning "Currently on branch '$current_branch', switching to '$target_branch' for update..."
        if ! git checkout "$target_branch"; then
            log_error "Failed to switch to '$target_branch' branch. Please resolve any conflicts and try again."
            exit 1
        fi
    fi

    log_info "Pulling latest changes from '$target_branch' branch..."
    if ! git pull origin "$target_branch"; then
        log_error "Failed to pull latest changes from git. Please resolve any conflicts and try again."
        exit 1
    fi

    log_info "Latest changes pulled successfully. Re-running global installation..."

    # Source the setup script to get access to the installation function
    # This requires the setup script to be in the same directory
    if [ ! -f "cgeaa-setup" ]; then
        log_error "cgeaa-setup script not found. Cannot proceed with re-installation."
        exit 1
    fi

    # Make the setup script's functions available
    source ./cgeaa-setup

    # Now, call the installation function
    perform_global_install

    log_success "CGEAA has been updated to the latest version."
}
