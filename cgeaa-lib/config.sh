#!/bin/bash

# CGEAA Configuration Management
# Handles configuration loading and validation

# Configuration file locations
GLOBAL_CONFIG_FILE="$HOME/.cgeaa/config"
PROJECT_CONFIG_FILE=".cgeaa/config"

# Default configuration values
DEFAULT_ORG="targetOrg"
DEFAULT_TEST_LEVEL="RunLocalTests"
DEFAULT_TIMEOUT="360"
DEFAULT_BASE_BRANCH="main"
DEFAULT_TAG_PREFIX="CGEAA"
DEFAULT_DEPLOYMENT_DIR="Bedrock"
DEFAULT_AUTO_CLEANUP="true"
DEFAULT_ENABLE_NOTIFICATIONS="false"
DEFAULT_MAX_DEPLOY_WAIT="3600"
DEFAULT_PARALLEL_JOBS="1"

# Current configuration variables
CONFIG_DEFAULT_ORG="$DEFAULT_ORG"
CONFIG_DEFAULT_TEST_LEVEL="$DEFAULT_TEST_LEVEL"
CONFIG_DEFAULT_TIMEOUT="$DEFAULT_TIMEOUT"
CONFIG_DEFAULT_BASE_BRANCH="$DEFAULT_BASE_BRANCH"
CONFIG_TAG_PREFIX="$DEFAULT_TAG_PREFIX"
CONFIG_DEPLOYMENT_DIR="$DEFAULT_DEPLOYMENT_DIR"
CONFIG_AUTO_CLEANUP="$DEFAULT_AUTO_CLEANUP"
CONFIG_ENABLE_NOTIFICATIONS="$DEFAULT_ENABLE_NOTIFICATIONS"
CONFIG_MAX_DEPLOY_WAIT="$DEFAULT_MAX_DEPLOY_WAIT"
CONFIG_PARALLEL_JOBS="$DEFAULT_PARALLEL_JOBS"

# Load configuration from file
load_config_file() {
    local config_file="$1"
    
    if [ -f "$config_file" ]; then
        log_debug "Loading config from: $config_file"
        
        while IFS='=' read -r key value; do
            # Skip comments and empty lines
            [[ $key =~ ^[[:space:]]*# ]] && continue
            [[ -z $key ]] && continue
            
            # Remove leading/trailing whitespace
            key=$(echo "$key" | xargs)
            value=$(echo "$value" | xargs)
            
            # Remove quotes from value if present
            value=$(echo "$value" | sed 's/^["'\'']\|["'\'']$//g')
            
            # Set configuration variables based on key
            case "$key" in
                "default_org") CONFIG_DEFAULT_ORG="$value" ;;
                "default_test_level") CONFIG_DEFAULT_TEST_LEVEL="$value" ;;
                "default_timeout") CONFIG_DEFAULT_TIMEOUT="$value" ;;
                "default_base_branch") CONFIG_DEFAULT_BASE_BRANCH="$value" ;;
                "tag_prefix") CONFIG_TAG_PREFIX="$value" ;;
                "deployment_dir") CONFIG_DEPLOYMENT_DIR="$value" ;;
                "auto_cleanup") CONFIG_AUTO_CLEANUP="$value" ;;
                "enable_notifications") CONFIG_ENABLE_NOTIFICATIONS="$value" ;;
                "max_deploy_wait") CONFIG_MAX_DEPLOY_WAIT="$value" ;;
                "parallel_jobs") CONFIG_PARALLEL_JOBS="$value" ;;
            esac
            log_debug "Config loaded: $key = $value"
        done < "$config_file"
    fi
}

# Initialize configuration
init_config() {
    log_debug "Initializing CGEAA configuration"
    
    # Load global config
    load_config_file "$GLOBAL_CONFIG_FILE"
    
    # Load project config (overrides global)
    load_config_file "$PROJECT_CONFIG_FILE"
    
    log_debug "Configuration initialized"
}

# Get configuration value
get_config() {
    local key="$1"
    local default="$2"
    
    case "$key" in
        "default_org") echo "${CONFIG_DEFAULT_ORG:-$default}" ;;
        "default_test_level") echo "${CONFIG_DEFAULT_TEST_LEVEL:-$default}" ;;
        "default_timeout") echo "${CONFIG_DEFAULT_TIMEOUT:-$default}" ;;
        "default_base_branch") echo "${CONFIG_DEFAULT_BASE_BRANCH:-$default}" ;;
        "tag_prefix") echo "${CONFIG_TAG_PREFIX:-$default}" ;;
        "deployment_dir") echo "${CONFIG_DEPLOYMENT_DIR:-$default}" ;;
        "auto_cleanup") echo "${CONFIG_AUTO_CLEANUP:-$default}" ;;
        "enable_notifications") echo "${CONFIG_ENABLE_NOTIFICATIONS:-$default}" ;;
        "max_deploy_wait") echo "${CONFIG_MAX_DEPLOY_WAIT:-$default}" ;;
        "parallel_jobs") echo "${CONFIG_PARALLEL_JOBS:-$default}" ;;
        *) echo "$default" ;;
    esac
}

# Set configuration value
set_config() {
    local key="$1"
    local value="$2"
    
    case "$key" in
        "default_org") CONFIG_DEFAULT_ORG="$value" ;;
        "default_test_level") CONFIG_DEFAULT_TEST_LEVEL="$value" ;;
        "default_timeout") CONFIG_DEFAULT_TIMEOUT="$value" ;;
        "default_base_branch") CONFIG_DEFAULT_BASE_BRANCH="$value" ;;
        "tag_prefix") CONFIG_TAG_PREFIX="$value" ;;
        "deployment_dir") CONFIG_DEPLOYMENT_DIR="$value" ;;
        "auto_cleanup") CONFIG_AUTO_CLEANUP="$value" ;;
        "enable_notifications") CONFIG_ENABLE_NOTIFICATIONS="$value" ;;
        "max_deploy_wait") CONFIG_MAX_DEPLOY_WAIT="$value" ;;
        "parallel_jobs") CONFIG_PARALLEL_JOBS="$value" ;;
    esac
    log_debug "Config set: $key = $value"
}

# Create sample configuration file
create_sample_config() {
    local config_file="$1"
    local config_dir=$(dirname "$config_file")
    
    # Create directory if it doesn't exist
    mkdir -p "$config_dir"
    
    cat > "$config_file" << 'EOF'
# CGEAA Configuration File
# This file contains default settings for CGEAA operations

# Default target org alias
default_org=targetOrg

# Default test level for deployments
# Options: NoTestRun, RunSpecifiedTests, RunLocalTests, RunAllTestsInOrg
default_test_level=RunLocalTests

# Default deployment timeout in seconds
default_timeout=360

# Default base branch for comparisons
default_base_branch=main

# Tag prefix for deployment tracking
tag_prefix=CGEAA

# Deployment directory (relative to project root)
deployment_dir=Bedrock

# Automatically cleanup temporary files
auto_cleanup=true

# Enable desktop notifications (requires terminal-notifier on macOS)
enable_notifications=false

# Maximum time to wait for deployment completion (seconds)
max_deploy_wait=3600

# Number of parallel jobs for operations that support it
parallel_jobs=1
EOF

    log_success "Sample configuration created: $config_file"
    log_info "Edit this file to customize your CGEAA settings"
}

# Validate configuration
validate_config() {
    log_debug "Validating configuration"
    
    # Validate test level
    local test_level=$(get_config "default_test_level")
    if ! validate_test_level "$test_level"; then
        log_error "Invalid default test level in configuration: $test_level"
        return 1
    fi
    
    # Validate timeout
    local timeout=$(get_config "default_timeout")
    if ! [[ "$timeout" =~ ^[0-9]+$ ]] || [ "$timeout" -lt 1 ]; then
        log_error "Invalid timeout in configuration: $timeout"
        return 1
    fi
    
    # Validate deployment directory
    local deploy_dir=$(get_config "deployment_dir")
    if [ ! -d "$deploy_dir" ]; then
        log_warning "Deployment directory not found: $deploy_dir"
    fi
    
    log_debug "Configuration validation passed"
    return 0
}

# Show current configuration
show_config() {
    echo
    log_info "=== CGEAA Configuration ==="
    
    echo "  default_org = $CONFIG_DEFAULT_ORG"
    echo "  default_test_level = $CONFIG_DEFAULT_TEST_LEVEL"
    echo "  default_timeout = $CONFIG_DEFAULT_TIMEOUT"
    echo "  default_base_branch = $CONFIG_DEFAULT_BASE_BRANCH"
    echo "  tag_prefix = $CONFIG_TAG_PREFIX"
    echo "  deployment_dir = $CONFIG_DEPLOYMENT_DIR"
    echo "  auto_cleanup = $CONFIG_AUTO_CLEANUP"
    echo "  enable_notifications = $CONFIG_ENABLE_NOTIFICATIONS"
    echo "  max_deploy_wait = $CONFIG_MAX_DEPLOY_WAIT"
    echo "  parallel_jobs = $CONFIG_PARALLEL_JOBS"
    
    echo
    log_info "Configuration files:"
    if [ -f "$GLOBAL_CONFIG_FILE" ]; then
        echo "  Global: $GLOBAL_CONFIG_FILE ✓"
    else
        echo "  Global: $GLOBAL_CONFIG_FILE (not found)"
    fi
    
    if [ -f "$PROJECT_CONFIG_FILE" ]; then
        echo "  Project: $PROJECT_CONFIG_FILE ✓"
    else
        echo "  Project: $PROJECT_CONFIG_FILE (not found)"
    fi
    echo
}

# Initialize configuration when this file is sourced
init_config
