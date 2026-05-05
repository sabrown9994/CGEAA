#!/bin/bash

# CGEAA Logs Module
# Manage Apex debug logs: list, get, tail, and clean up

# Entry point — routes to the appropriate sub-command
execute_logs() {
    check_dependencies
    check_sf_auth "$TARGET_ORG"

    case "$LOGS_SUBCOMMAND" in
        list)   logs_list ;;
        get)    logs_get ;;
        tail)   logs_tail ;;
        clear)  logs_clear ;;
        *)
            log_error "Unknown logs sub-command: '$LOGS_SUBCOMMAND'"
            log_info "Usage: cgeaa logs <list|get|tail|clear> [options]"
            exit 1
            ;;
    esac
}

# List recent debug logs
logs_list() {
    log_step "Listing Apex debug logs for org: $TARGET_ORG"

    local sf_command="sf apex log list --target-org $TARGET_ORG"

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: $sf_command"
        return 0
    fi

    log_debug "Executing: $sf_command"
    eval "$sf_command"
}

# Fetch a specific log by ID, or the most recent log if no ID given
logs_get() {
    log_step "Fetching Apex debug log"

    local sf_command="sf apex log get --target-org $TARGET_ORG"

    if [ -n "$LOG_ID" ]; then
        sf_command="$sf_command --log-id $LOG_ID"
        log_info "Fetching log ID: $LOG_ID"
    else
        # --number 1 fetches the single most recent log
        sf_command="$sf_command --number 1"
        log_info "No log ID specified — fetching most recent log"
    fi

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: $sf_command"
        return 0
    fi

    log_debug "Executing: $sf_command"

    if [ -n "$LOG_OUTPUT_DIR" ]; then
        sf_command="$sf_command --output-dir $LOG_OUTPUT_DIR"
        mkdir -p "$LOG_OUTPUT_DIR"
        log_info "Saving log to: $LOG_OUTPUT_DIR"
    fi

    eval "$sf_command"
}

# Tail logs in real time (blocks until Ctrl-C)
logs_tail() {
    log_step "Tailing Apex debug logs for org: $TARGET_ORG"
    log_info "Press Ctrl-C to stop"

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would execute: sf apex log tail --target-org $TARGET_ORG${LOG_COLOR:+ --color}"
        return 0
    fi

    local sf_command="sf apex log tail --target-org $TARGET_ORG"

    if [ "${LOG_COLOR:-true}" = "true" ]; then
        sf_command="$sf_command --color"
    fi

    log_debug "Executing: $sf_command"
    eval "$sf_command"
}

# Delete all debug logs in the org
logs_clear() {
    log_step "Clearing all Apex debug logs from org: $TARGET_ORG"

    if [ "$DRY_RUN" = "true" ]; then
        log_info "[DRY RUN] Would delete all debug logs from $TARGET_ORG"
        return 0
    fi

    # Confirm unless --force was passed
    if [ "$FORCE_DEPLOY" != "true" ]; then
        read -p "Delete ALL debug logs from $TARGET_ORG? This cannot be undone. (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Cancelled."
            return 0
        fi
    fi

    log_debug "Executing: sf apex log delete --no-prompt --target-org $TARGET_ORG"
    if sf apex log delete --no-prompt --target-org "$TARGET_ORG"; then
        log_success "All debug logs cleared from $TARGET_ORG"
    else
        log_error "Failed to clear debug logs"
        return 1
    fi
}
