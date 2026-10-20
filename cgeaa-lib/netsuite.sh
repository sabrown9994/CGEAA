#!/bin/bash

# netsuite.sh - NetSuite Development Framework (NDF) dispatch module
#
# Delegates all arguments after 'netsuite' to the ndf CLI.

NDF_SOURCE_DIR="${SCRIPT_DIR}/ndf"

_find_ndf() {
    local bundled_bin="${NDF_SOURCE_DIR}/dist/ndf.js"
    if [ -f "$bundled_bin" ]; then
        echo "node ${bundled_bin}"
        return
    fi
    echo ""
}

_build_ndf() {
    if [ ! -d "$NDF_SOURCE_DIR" ]; then
        log_error "NDF source not found at ${NDF_SOURCE_DIR}"
        log_error "Re-run cgeaa-setup from the CGEAA repository checkout to install NDF."
        exit 1
    fi
    if [ ! -w "$NDF_SOURCE_DIR" ]; then
        log_error "NDF is not built and its source at ${NDF_SOURCE_DIR} is not writable."
        log_error "Re-run cgeaa-setup from the CGEAA repository checkout to (re)install NDF."
        exit 1
    fi
    if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
        log_error "node and npm are required to build NDF (Node.js >=18)."
        exit 1
    fi
    log_info "Building NDF from source at ${NDF_SOURCE_DIR}..."
    (cd "$NDF_SOURCE_DIR" && npm install --silent && npm run build --silent) || {
        log_error "NDF build failed. Check the output above."
        exit 1
    }
    log_success "NDF built successfully."
}

execute_netsuite() {
    local ndf_cmd
    ndf_cmd="$(_find_ndf)"

    if [ -z "$ndf_cmd" ]; then
        log_warn "ndf not found. Attempting to build from bundled source..."
        _build_ndf
        ndf_cmd="node ${NDF_SOURCE_DIR}/dist/ndf.js"
    fi

    # shellcheck disable=SC2086
    $ndf_cmd "${NETSUITE_ARGS[@]}"
}
