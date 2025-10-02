#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$SCRIPT_DIR/logs"
LOG_MANAGER_PID_FILE="$SCRIPT_DIR/.log_manager.pid"
LOCK_FILE="$SCRIPT_DIR/.log_manager.lock"

# Log configuration
LOG_ROTATION_INTERVAL=10800  # 3 hours in seconds
LOG_RETENTION_HOURS=24       # 24 hours retention

# Logging function for the log manager itself
log_message() {
    local message="$1"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] LOG_MANAGER: $message" >> "$LOGS_DIR/log_manager.log"
    echo "[$timestamp] $message"
}

acquire_lock() {
    local timeout=30
    local counter=0

    while [ $counter -lt $timeout ]; do
        if (set -C; echo $$ > "$LOCK_FILE") 2>/dev/null; then
            return 0
        fi

        if [ -f "$LOCK_FILE" ]; then
            local lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
            if [ ! -z "$lock_pid" ] && ! ps -p "$lock_pid" > /dev/null 2>&1; then
                # Stale lock file, remove it
                rm -f "$LOCK_FILE"
                log_message "Removed stale lock file (PID: $lock_pid)"
                continue
            fi
        fi

        sleep 1
        counter=$((counter + 1))
    done

    log_message "Failed to acquire lock after $timeout seconds"
    return 1
}

release_lock() {
    rm -f "$LOCK_FILE"
}

setup_log_directory() {
    log_message "Setting up log directory structure..."

    # Create directories with proper permissions
    mkdir -p "$LOGS_DIR" 2>/dev/null || {
        echo "Error: Cannot create logs directory at $LOGS_DIR"
        return 1
    }

    mkdir -p "$LOGS_DIR/archived" 2>/dev/null || {
        echo "Error: Cannot create archived logs directory"
        return 1
    }

    # Test write permissions
    if ! touch "$LOGS_DIR/.test_write" 2>/dev/null; then
        echo "Error: No write permission in logs directory"
        return 1
    fi
    rm -f "$LOGS_DIR/.test_write"

    # Create initial log files if they don't exist
    for log_file in "qdrant.log" "app.log" "log_manager.log"; do
        if [ ! -f "$LOGS_DIR/$log_file" ]; then
            touch "$LOGS_DIR/$log_file" || {
                log_message "Warning: Cannot create $log_file"
            }
        fi
    done

    log_message "Log directory setup completed: $LOGS_DIR"
    return 0
}

generate_unique_timestamp() {
    # Generate timestamp with microseconds to avoid conflicts
    local base_timestamp=$(date '+%Y%m%d_%H%M%S')
    local microseconds=$(date '+%N' | cut -c1-6)
    local counter=0

    while [ $counter -lt 1000 ]; do
        local timestamp="${base_timestamp}_${microseconds}_$(printf "%03d" $counter)"

        # Check if any file with this timestamp exists
        if ! ls "$LOGS_DIR/archived/"*"$timestamp"* > /dev/null 2>&1; then
            echo "$timestamp"
            return 0
        fi

        counter=$((counter + 1))
        microseconds=$(printf "%06d" $((microseconds + 1)))
    done

    # Fallback: use PID if all else fails
    echo "${base_timestamp}_$$"
}

rotate_single_log() {
    local log_name="$1"
    local log_file="$LOGS_DIR/$log_name.log"
    local timestamp=$(generate_unique_timestamp)

    if [ ! -f "$log_file" ]; then
        log_message "Log file $log_file does not exist, skipping rotation"
        return 0
    fi

    # Check if log file has content
    if [ ! -s "$log_file" ]; then
        log_message "Log file $log_file is empty, skipping rotation"
        return 0
    fi

    log_message "Rotating $log_name.log"

    # Create a copy instead of moving to avoid disrupting active logging
    if cp "$log_file" "$LOGS_DIR/archived/${log_name}_${timestamp}.log"; then
        # Compress the archived file
        if gzip "$LOGS_DIR/archived/${log_name}_${timestamp}.log"; then
            # Truncate the original log file (safer than deleting)
            if > "$log_file"; then
                log_message "Successfully rotated and compressed $log_name.log to ${log_name}_${timestamp}.log.gz"
                return 0
            else
                log_message "Error: Failed to truncate $log_file after rotation"
                return 1
            fi
        else
            log_message "Error: Failed to compress archived log ${log_name}_${timestamp}.log"
            # Clean up uncompressed file
            rm -f "$LOGS_DIR/archived/${log_name}_${timestamp}.log"
            return 1
        fi
    else
        log_message "Error: Failed to copy $log_file for rotation"
        return 1
    fi
}

rotate_logs() {
    log_message "Starting log rotation cycle..."

    if ! acquire_lock; then
        log_message "Cannot acquire lock for log rotation, skipping this cycle"
        return 1
    fi

    # Rotate each log file
    for log_name in "app" "qdrant"; do
        rotate_single_log "$log_name"
    done

    release_lock
    log_message "Log rotation cycle completed"
}

cleanup_old_logs() {
    log_message "Starting log cleanup..."

    if ! acquire_lock; then
        log_message "Cannot acquire lock for log cleanup, skipping"
        return 1
    fi

    local deleted_count=0

    # Find and delete compressed log files older than retention period
    while IFS= read -r -d '' file; do
        if rm "$file" 2>/dev/null; then
            deleted_count=$((deleted_count + 1))
            log_message "Deleted old log: $(basename "$file")"
        fi
    done < <(find "$LOGS_DIR/archived" -name "*.log.gz" -type f -mtime +1 -print0 2>/dev/null)

    # Clean up log_manager.log itself if it gets too large (keep last 2000 lines)
    local manager_log="$LOGS_DIR/log_manager.log"
    if [ -f "$manager_log" ] && [ $(wc -l < "$manager_log" 2>/dev/null || echo 0) -gt 2000 ]; then
        if tail -n 2000 "$manager_log" > "$manager_log.tmp" 2>/dev/null; then
            mv "$manager_log.tmp" "$manager_log"
            log_message "Trimmed log_manager.log to last 2000 lines"
        else
            rm -f "$manager_log.tmp"
        fi
    fi

    release_lock
    log_message "Log cleanup completed. Deleted $deleted_count old files"
}

daemon_loop() {
    log_message "Log management daemon started (PID: $$)"
    log_message "Configuration: Rotation every $(($LOG_ROTATION_INTERVAL / 3600))h, Retention ${LOG_RETENTION_HOURS}h"

    # Perform initial cleanup
    cleanup_old_logs

    local next_rotation=$(($(date +%s) + LOG_ROTATION_INTERVAL))
    local next_cleanup=$(($(date +%s) + 3600))  # Cleanup every hour

    while true; do
        local current_time=$(date +%s)

        # Check for rotation time
        if [ $current_time -ge $next_rotation ]; then
            rotate_logs
            next_rotation=$((current_time + LOG_ROTATION_INTERVAL))
        fi

        # Check for cleanup time
        if [ $current_time -ge $next_cleanup ]; then
            cleanup_old_logs
            next_cleanup=$((current_time + 3600))
        fi

        # Sleep for a minute before next check
        sleep 60
    done
}

start_daemon() {
    echo "Starting log management daemon..."

    # Check if already running
    if [ -f "$LOG_MANAGER_PID_FILE" ]; then
        local pid=$(cat "$LOG_MANAGER_PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            echo "Log management daemon is already running (PID: $pid)"
            return 0
        else
            echo "Removing stale PID file"
            rm -f "$LOG_MANAGER_PID_FILE"
        fi
    fi

    # Setup log directory
    if ! setup_log_directory; then
        echo "Failed to setup log directory"
        return 1
    fi

    # Start daemon in background
    nohup bash "$0" --daemon > /dev/null 2>&1 &
    local daemon_pid=$!

    # Save PID
    echo $daemon_pid > "$LOG_MANAGER_PID_FILE"

    # Wait a moment and verify it's still running
    sleep 2
    if ps -p $daemon_pid > /dev/null 2>&1; then
        echo "Log management daemon started successfully (PID: $daemon_pid)"
        echo "Logs directory: $LOGS_DIR"
        echo "Daemon logs: $LOGS_DIR/log_manager.log"
        return 0
    else
        echo "Failed to start log management daemon"
        rm -f "$LOG_MANAGER_PID_FILE"
        return 1
    fi
}

stop_daemon() {
    echo "Stopping log management daemon..."

    if [ -f "$LOG_MANAGER_PID_FILE" ]; then
        local pid=$(cat "$LOG_MANAGER_PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            # Perform final rotation before stopping
            echo "Performing final log rotation..."
            rotate_logs
            cleanup_old_logs

            kill $pid
            sleep 3

            if ps -p $pid > /dev/null 2>&1; then
                echo "Daemon didn't stop gracefully, forcing termination..."
                kill -9 $pid
                sleep 1
            fi

            if ! ps -p $pid > /dev/null 2>&1; then
                echo "Log management daemon stopped"
            else
                echo "Failed to stop log management daemon"
                return 1
            fi
        else
            echo "Log management daemon was not running"
        fi
        rm -f "$LOG_MANAGER_PID_FILE"
    else
        echo "No PID file found, checking for running processes..."
        pkill -f "log-manager.sh --daemon" > /dev/null 2>&1 || true
    fi

    # Clean up lock file
    release_lock
}

status() {
    echo "Log Management Daemon Status"
    echo "==========================="

    if [ -f "$LOG_MANAGER_PID_FILE" ]; then
        local pid=$(cat "$LOG_MANAGER_PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            echo "🟢 Status: Running (PID: $pid)"
        else
            echo "🔴 Status: Not running (stale PID file)"
        fi
    else
        echo "🔴 Status: Not running"
    fi

    echo ""
    echo "Configuration:"
    echo "  Rotation interval: $(($LOG_ROTATION_INTERVAL / 3600)) hours"
    echo "  Retention period: $LOG_RETENTION_HOURS hours"
    echo "  Logs directory: $LOGS_DIR"

    if [ -d "$LOGS_DIR" ]; then
        echo ""
        echo "Current logs:"
        for log_file in app.log qdrant.log log_manager.log; do
            if [ -f "$LOGS_DIR/$log_file" ]; then
                local size=$(stat -c%s "$LOGS_DIR/$log_file" 2>/dev/null || echo "0")
                echo "  $log_file: $size bytes"
            fi
        done

        local archived_count=$(find "$LOGS_DIR/archived" -name "*.log.gz" 2>/dev/null | wc -l)
        echo "  Archived files: $archived_count"
    fi
}

manual_rotate() {
    echo "Performing manual log rotation..."

    if ! setup_log_directory; then
        echo "Failed to setup log directory"
        return 1
    fi

    rotate_logs
    cleanup_old_logs
    echo "Manual log rotation completed"
}

show_help() {
    echo "Log Management Daemon"
    echo "===================="
    echo ""
    echo "Usage: $0 [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  start     Start the log management daemon"
    echo "  stop      Stop the log management daemon"
    echo "  restart   Restart the log management daemon"
    echo "  status    Show daemon status and log information"
    echo "  rotate    Manually rotate and cleanup logs"
    echo "  help      Show this help message"
    echo ""
    echo "Internal commands (do not use directly):"
    echo "  --daemon  Run in daemon mode"
    echo ""
    echo "Configuration:"
    echo "  Logs directory: $LOGS_DIR"
    echo "  Rotation: Every $(($LOG_ROTATION_INTERVAL / 3600)) hours"
    echo "  Retention: $LOG_RETENTION_HOURS hours"
    echo "  Archive format: Compressed (.gz)"
}

# Trap signals for graceful shutdown in daemon mode
trap 'log_message "Received shutdown signal, stopping daemon..."; exit 0' TERM INT

# Main script logic
case "${1:-}" in
    "start")
        start_daemon
        ;;
    "stop")
        stop_daemon
        ;;
    "restart")
        stop_daemon
        sleep 2
        start_daemon
        ;;
    "status")
        status
        ;;
    "rotate")
        manual_rotate
        ;;
    "--daemon")
        # Internal daemon mode
        daemon_loop
        ;;
    "help"|"-h"|"--help"|"")
        show_help
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac