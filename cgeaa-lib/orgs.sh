#!/bin/bash

# CGEAA Org Management Module
# Handles Salesforce org listing and validation

# List available Salesforce orgs
list_orgs() {
    log_step "Available Salesforce orgs:"
    
    if command_exists sf; then
        sf org list --json 2>/dev/null | jq -r '.result.nonScratchOrgs[]? | select(.connectedStatus == "Connected") | "  \(.alias // "N/A") - \(.username) (\(.orgId))"' 2>/dev/null || {
            # Fallback if jq is not available
            sf org list 2>/dev/null | grep -E "Connected|Sandbox|Production" | while read -r line; do
                echo "  $line"
            done
        }
    else
        log_error "Salesforce CLI not found"
        return 1
    fi
}

# Get list of connected org aliases
get_org_aliases() {
    if command_exists sf; then
        if command_exists jq; then
            sf org list --json 2>/dev/null | jq -r '.result.nonScratchOrgs[]? | select(.connectedStatus == "Connected" and .alias != null) | .alias' 2>/dev/null
        else
            # Fallback parsing without jq
            sf org list 2>/dev/null | awk '/Connected/ && $3 != "" && $3 != "Username" {print $3}' | grep -v "^$"
        fi
    fi
}

# Validate if org alias exists and is connected
validate_org_alias() {
    local org_alias="$1"
    
    if [ -z "$org_alias" ]; then
        log_error "No org alias provided"
        return 1
    fi
    
    log_debug "Validating org alias: $org_alias"
    
    # Check if org exists and is connected
    if sf org display --target-org "$org_alias" > /dev/null 2>&1; then
        log_debug "Org alias '$org_alias' is valid and connected"
        return 0
    else
        log_error "Org alias '$org_alias' is not valid or not connected"
        log_info "Available org aliases:"
        get_org_aliases | while read -r alias; do
            if [ -n "$alias" ]; then
                log_info "  - $alias"
            fi
        done
        return 1
    fi
}

# Interactive org selection
select_org_interactive() {
    local aliases=($(get_org_aliases))
    
    if [ ${#aliases[@]} -eq 0 ]; then
        log_error "No connected orgs found"
        log_info "Please authenticate to an org first:"
        log_info "  sf auth web login --alias myorg"
        return 1
    fi
    
    echo
    log_info "Available orgs:"
    for i in "${!aliases[@]}"; do
        echo "  $((i+1)). ${aliases[i]}"
    done
    
    echo
    read -p "Select org (1-${#aliases[@]}): " selection
    
    if [[ "$selection" =~ ^[0-9]+$ ]] && [ "$selection" -ge 1 ] && [ "$selection" -le "${#aliases[@]}" ]; then
        echo "${aliases[$((selection-1))]}"
        return 0
    else
        log_error "Invalid selection"
        return 1
    fi
}

# Get org info
get_org_info() {
    local org_alias="$1"
    
    if [ -z "$org_alias" ]; then
        log_error "No org alias provided"
        return 1
    fi
    
    log_debug "Getting org info for: $org_alias"
    
    if command_exists jq; then
        sf org display --target-org "$org_alias" --json 2>/dev/null | jq -r '
            .result | 
            "Org: " + (.alias // "N/A") + 
            "\nUsername: " + (.username // "N/A") + 
            "\nOrg ID: " + (.id // "N/A") + 
            "\nInstance: " + (.instanceUrl // "N/A") + 
            "\nType: " + (.orgType // "N/A")
        ' 2>/dev/null
    else
        # Fallback without jq
        sf org display --target-org "$org_alias" 2>/dev/null | grep -E "^(Alias|Username|Org Id|Instance Url|Org Type):"
    fi
}

# Show org summary
show_org_summary() {
    local org_alias="$1"
    
    if [ -n "$org_alias" ]; then
        log_info "Target org details:"
        get_org_info "$org_alias" | while read -r line; do
            log_info "  $line"
        done
    fi
}
