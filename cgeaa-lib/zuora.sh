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

# Always run the bundled zdf build shipped with this cgeaa install. We
# intentionally do NOT use any 'zdf' binary that happens to be on PATH — that
# would let a stale or divergent global install run under 'cgeaa zuora',
# hiding drift from what a fresh 'cgeaa-setup' produces.
_find_zdf() {
    local bundled_bin="${ZDF_SOURCE_DIR}/dist/zdf.js"
    if [ -f "$bundled_bin" ]; then
        echo "node ${bundled_bin}"
        return
    fi
    echo ""
}

# Build zdf from the bundled source when no binary is available.
_build_zdf() {
    if [ ! -d "$ZDF_SOURCE_DIR" ]; then
        log_error "ZDF source not found at ${ZDF_SOURCE_DIR}"
        log_error "Re-run cgeaa-setup from the CGEAA repository checkout to install ZDF."
        exit 1
    fi
    # Only auto-build from a writable source tree — a globally-installed copy
    # under /usr/local/share/cgeaa/zdf is not writable, and running npm there
    # without sudo would fail confusingly.
    if [ ! -w "$ZDF_SOURCE_DIR" ]; then
        log_error "ZDF is not built and its source at ${ZDF_SOURCE_DIR} is not writable."
        log_error "Re-run cgeaa-setup from the CGEAA repository checkout to (re)install ZDF."
        exit 1
    fi
    if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
        log_error "node and npm are required to build ZDF (Node.js >=18)."
        log_error "Install them and re-run cgeaa-setup, or run 'cgeaa zuora ...' again."
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
    # Honor a configured Zuora output directory so output lands in a fixed location regardless of
    # the current working directory (ZDF otherwise writes ./zdf-output relative to CWD). Precedence:
    #   explicit ZDF_OUTPUT_DIR in the environment  >  config `zuora_output_dir`  >  ZDF's own default.
    if [ -z "${ZDF_OUTPUT_DIR:-}" ] && [ -n "${CONFIG_ZUORA_OUTPUT_DIR:-}" ]; then
        local out_dir="$CONFIG_ZUORA_OUTPUT_DIR"
        # Expand a leading ~ (config files store literal strings — the shell won't expand it for us).
        case "$out_dir" in
            "~") out_dir="$HOME" ;;
            "~/"*) out_dir="$HOME/${out_dir#\~/}" ;;
        esac
        export ZDF_OUTPUT_DIR="$out_dir"
    fi

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
