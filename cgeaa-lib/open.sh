#!/bin/bash

# CGEAA - Open Org Functionality

execute_open() {
    log_step "Opening Salesforce Org"

    if [ -z "$TARGET_ORG" ]; then
        log_error "No target org could be determined. Please specify one with -o <alias> or set a default in the SF CLI."
        exit 1
    fi

    log_info "Attempting to open org: $TARGET_ORG"

    if [ "$DRY_RUN" = true ]; then
        log_info "[DRY RUN] Would execute: sf org open --target-org \"$TARGET_ORG\""
    else
        if ! sf org open --target-org "$TARGET_ORG"; then
            log_error "Failed to open org '$TARGET_ORG'. Is it authenticated?"
            exit 1
        fi
        log_success "Org '$TARGET_ORG' opened successfully in your browser."
    fi
}
