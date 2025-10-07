#!/bin/bash

# CGEAA - Interactive Mode Functionality

# Capitalize first letter (bash 3.2 compatible)
capitalize() {
    local str="$1"
    echo "$(tr '[:lower:]' '[:upper:]' <<< "${str:0:1}")${str:1}"
}

run_interactive_mode() {
    local command_to_run=$1
    local command_display=$(capitalize "$command_to_run")
    log_step "Starting Interactive $command_display"

    # 1. Select Target Org
    log_info "Fetching available Salesforce orgs..."
    # Bash 3.2 compatible array loading
    local org_list=()
    while IFS= read -r line; do
        org_list+=("$line")
    done < <(sf org list --json | jq -r '.result.nonScratchOrgs[] | .alias')
    
    if [ ${#org_list[@]} -eq 0 ]; then
        log_error "No authenticated orgs found. Please log in using 'sf auth web login'."
        exit 1
    fi

    echo "Please select a target org:"
    select org_choice in "${org_list[@]}"; do
        if [ -n "$org_choice" ]; then
            TARGET_ORG=$org_choice
            break
        else
            echo "Invalid selection. Please try again."
        fi
    done
    log_info "Target org set to: $TARGET_ORG"

    # 2. Select Test Level
    test_levels=("NoTestRun" "RunSpecifiedTests" "RunLocalTests" "RunAllTestsInOrg")
    echo
    echo "Please select a test level:"
    select test_level_choice in "${test_levels[@]}"; do
        if [ -n "$test_level_choice" ]; then
            TEST_LEVEL=$test_level_choice
            break
        else
            echo "Invalid selection. Please try again."
        fi
    done
    log_info "Test level set to: $TEST_LEVEL"

    # 3. Confirmation
    echo
    log_warning "Deployment Configuration:"
    log_info "  Target Org: $TARGET_ORG"
    log_info "  Test Level: $TEST_LEVEL"
    log_info "  Base Branch: $BASE_BRANCH"

    read -p "Proceed with ${command_to_run}? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "$command_display cancelled by user."
        exit 0
    fi

    # 4. Execute Command
    log_step "Executing $command_display"
    if [ "$command_to_run" = "deploy" ]; then
        source "${CGEAA_LIB_DIR}/deploy.sh"
        execute_deployment
    elif [ "$command_to_run" = "validate" ]; then
        source "${CGEAA_LIB_DIR}/validate.sh"
        execute_validation
    fi
}
