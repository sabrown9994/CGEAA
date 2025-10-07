#!/bin/bash

# CGEAA Branch Management Module
# Handles branch-based tag prefix extraction and branch operations

# Get current branch name
get_current_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null
}

# Extract story name from Feature branch
# Supports patterns like: Feature/PGTM-2270, feature/PGTM-2270, Feature/ABC-123, etc.
extract_story_from_branch() {
    local branch_name="$1"
    
    if [ -z "$branch_name" ]; then
        branch_name=$(get_current_branch)
    fi
    
    log_debug "Extracting story from branch: $branch_name"
    
    # Check if it's a Feature branch (case insensitive)
    if echo "$branch_name" | grep -qi "^feature/"; then
        # Extract the story name after "Feature/"
        local story_name=$(echo "$branch_name" | sed -E 's|^[Ff]eature/([^/]+).*|\1|')
        
        # Validate that it looks like a story name (contains letters, numbers, and hyphens)
        if echo "$story_name" | grep -qE '^[A-Za-z]+-[0-9]+'; then
            log_debug "Extracted story name: $story_name"
            echo "$story_name"
            return 0
        else
            log_debug "Story name doesn't match expected pattern: $story_name"
        fi
    else
        log_debug "Not a Feature branch: $branch_name"
    fi
    
    # Return empty if no valid story name found
    return 1
}

# Get tag prefix based on current branch
get_branch_based_tag_prefix() {
    local story_name=$(extract_story_from_branch)
    
    if [ -n "$story_name" ]; then
        log_debug "Using story-based tag prefix: $story_name"
        echo "$story_name"
    else
        # Fallback to configured tag prefix
        local fallback_prefix=$(get_config "tag_prefix" "CGEAA")
        log_debug "Using fallback tag prefix: $fallback_prefix"
        echo "$fallback_prefix"
    fi
}

# Get the latest tag with branch-based prefix
get_latest_branch_tag() {
    local prefix=$(get_branch_based_tag_prefix)
    get_latest_tag "$prefix"
}

# Get next tag number with branch-based prefix
get_next_branch_tag() {
    local prefix=$(get_branch_based_tag_prefix)
    local latest_tag=$(get_latest_tag "$prefix")
    
    if [ -n "$latest_tag" ]; then
        # Extract the current number, handling both padded and unpadded formats
        local current_ref=$(echo "$latest_tag" | sed -E "s/^${prefix}-0*([0-9]+)$/\1/")
        local next_ref=$((current_ref + 1))
        
        # Determine format based on existing tag pattern
        local existing_suffix=$(echo "$latest_tag" | sed -E "s/^${prefix}-([0-9]+)$/\1/")
        if [ ${#existing_suffix} -ge 4 ]; then
            # Use 4-digit padding if existing tag has 4+ digits
            printf "%s-%04d" "$prefix" "$next_ref"
        else
            # Use simple format if existing tag is shorter
            printf "%s-%d" "$prefix" "$next_ref"
        fi
    else
        # No existing tags - check if there are any tags with this prefix pattern to determine format
        local sample_tags=$(git tag -l "${prefix}-[0-9]*" | head -3)
        if echo "$sample_tags" | grep -q "${prefix}-[0-9]\{4,\}"; then
            # Found 4+ digit tags, use padded format
            printf "%s-%04d" "$prefix" 1
        else
            # Use simple format for first tag
            printf "%s-%d" "$prefix" 1
        fi
    fi
}

# Validate branch for deployment
validate_branch_for_deployment() {
    local current_branch=$(get_current_branch)
    
    if [ -z "$current_branch" ]; then
        log_error "Could not determine current branch"
        return 1
    fi
    
    log_info "Current branch: $current_branch"
    
    # Check if it's a Feature branch
    if echo "$current_branch" | grep -qi "^feature/"; then
        local story_name=$(extract_story_from_branch "$current_branch")
        if [ -n "$story_name" ]; then
            log_info "Detected story: $story_name"
            log_info "Tags will use prefix: $story_name-XXXX"
        else
            log_warning "Feature branch doesn't follow expected naming pattern"
            log_warning "Expected: Feature/STORY-NUMBER (e.g., Feature/PGTM-2270)"
            log_warning "Current: $current_branch"
        fi
    else
        log_info "Not a Feature branch - using default tag prefix"
    fi
    
    return 0
}

# Show branch information
show_branch_info() {
    local current_branch=$(get_current_branch)
    local story_name=$(extract_story_from_branch "$current_branch")
    local tag_prefix=$(get_branch_based_tag_prefix)
    local next_tag=$(get_next_branch_tag)
    
    echo
    log_info "=== Branch Information ==="
    log_info "Current Branch: $current_branch"
    
    if [ -n "$story_name" ]; then
        log_info "Story Name: $story_name"
        log_info "Tag Prefix: $tag_prefix"
    else
        log_info "Tag Prefix: $tag_prefix (fallback)"
    fi
    
    log_info "Next Tag: $next_tag"
    
    # Show recent tags with this prefix
    local recent_tags=$(git tag -l "${tag_prefix}-*" | sort -V | tail -5)
    if [ -n "$recent_tags" ]; then
        echo
        log_info "Recent tags with this prefix:"
        echo "$recent_tags" | while read -r tag; do
            log_info "  - $tag"
        done
    fi
    echo
}

# Check if current branch has uncommitted changes
check_branch_clean() {
    if ! git diff-index --quiet HEAD --; then
        log_warning "Branch has uncommitted changes"
        log_info "Consider committing or stashing changes before deployment"
        return 1
    fi
    
    log_debug "Branch is clean (no uncommitted changes)"
    return 0
}
