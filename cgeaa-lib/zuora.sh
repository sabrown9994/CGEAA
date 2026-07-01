#!/bin/bash

# zuora.sh - Zuora Development Framework (ZDF) dispatch module
#
# Delegates all arguments after 'zuora' to the zdf CLI.
# If zdf is not installed, offers to build it from the bundled source.
#
# Usage via cgeaa:
#   cgeaa zuora <verb> <resource> <id> [options]
#
# Examples:
#   cgeaa zuora pull account 8a8aa1989eab56cd019eae0807eb55ee
#   cgeaa zuora push product-rate-plan prp-001
#   cgeaa zuora list orders
#   cgeaa zuora auth login --name sandbox --url https://rest.sandbox.na.zuora.com \
#                           --client-id <id> --client-secret <secret>

ZDF_SOURCE_DIR="${SCRIPT_DIR}/zdf"

# Locate the zdf binary: prefer a globally installed one, fall back to the
# locally built binary in the bundled source tree.
_find_zdf() {
    if command -v zdf &>/dev/null; then
        echo "zdf"
        return
    fi
    local local_bin="${ZDF_SOURCE_DIR}/dist/zdf.js"
    if [ -f "$local_bin" ]; then
        echo "node ${local_bin}"
        return
    fi
    echo ""
}

# Build zdf from the bundled source when no binary is available.
_build_zdf() {
    if [ ! -d "$ZDF_SOURCE_DIR" ]; then
        log_error "ZDF source not found at ${ZDF_SOURCE_DIR}"
        exit 1
    fi
    log_info "Building ZDF from source at ${ZDF_SOURCE_DIR}..."
    (cd "$ZDF_SOURCE_DIR" && npm install --silent && npm run build --silent) || {
        log_error "ZDF build failed. Check the output above."
        exit 1
    }
    log_success "ZDF built successfully."
}

execute_zuora() {
    local zdf_cmd
    zdf_cmd="$(_find_zdf)"

    if [ -z "$zdf_cmd" ]; then
        log_warn "zdf not found. Attempting to build from bundled source..."
        _build_zdf
        zdf_cmd="node ${ZDF_SOURCE_DIR}/dist/zdf.js"
    fi

    # Pass all remaining arguments directly to zdf.
    # shellcheck disable=SC2086
    $zdf_cmd "${ZUORA_ARGS[@]}"
}
