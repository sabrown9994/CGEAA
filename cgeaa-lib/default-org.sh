#!/bin/bash

# CGEAA Default Org Detection Module
# Handles detection of Salesforce CLI default org

# Get the current default org from Salesforce CLI
get_sf_default_org() {
    local default_org=""
    
    # Try to get default org from SF CLI
    if command_exists sf; then
        # Method 1: Check for default org using sf config
        default_org=$(sf config get target-org --json 2>/dev/null | jq -r '.result[0].value // empty' 2>/dev/null)
        
        # Method 2: If jq not available or no result, try alternative parsing
        if [ -z "$default_org" ] || [ "$default_org" = "null" ]; then
            default_org=$(sf config get target-org 2>/dev/null | grep -E "^target-org" | awk '{print $2}' | head -1)
        fi
        
        # Method 3: Check org list for default marker
        if [ -z "$default_org" ] || [ "$default_org" = "null" ]; then
            if command_exists jq; then
                default_org=$(sf org list --json 2>/dev/null | jq -r '.result.nonScratchOrgs[]? | select(.isDefaultUsername == true) | .alias // .username' 2>/dev/null | head -1)
            else
                # Fallback parsing without jq - look for default marker in org list
                default_org=$(sf org list 2>/dev/null | grep -E "🍁|Default" | awk '{print $3}' | head -1)
            fi
        fi
    fi
    
    # Clean up the result
    if [ -n "$default_org" ] && [ "$default_org" != "null" ] && [ "$default_org" != "" ]; then
        echo "$default_org"
        return 0
    else
        return 1
    fi
}

# Get a sensible default org (tries SF CLI default, then first available)
get_sensible_default_org() {
    local default_org=""
    
    # First try to get SF CLI default
    default_org=$(get_sf_default_org)
    
    if [ -n "$default_org" ]; then
        log_debug "Using SF CLI default org: $default_org"
        echo "$default_org"
        return 0
    fi
    
    # If no default set, try to get first available connected org
    local first_org=$(get_org_aliases | head -1)
    if [ -n "$first_org" ]; then
        log_debug "No SF CLI default found, using first available org: $first_org"
        echo "$first_org"
        return 0
    fi
    
    # Fallback to hardcoded default
    log_debug "No orgs found, using fallback default: targetOrg"
    echo "targetOrg"
    return 1
}
