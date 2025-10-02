#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS_DIR="$SCRIPT_DIR/logs"
QDRANT_PID_FILE="$SCRIPT_DIR/.qdrant.pid"
APP_PID_FILE="$SCRIPT_DIR/.app.pid"
LOG_MANAGER_SCRIPT="$SCRIPT_DIR/log-manager.sh"
QDRANT_PORT=6333
APP_PORT=3000

check_port() {
    local port=$1
    # Try multiple methods to check if port is accessible
    lsof -ti:$port > /dev/null 2>&1 || \
    netstat -tln 2>/dev/null | grep -q ":$port " || \
    ss -tln 2>/dev/null | grep -q ":$port "
}

check_service_health() {
    local port=$1
    local service=$2

    case $service in
        "qdrant")
            curl -s http://localhost:$port/ > /dev/null 2>&1
            ;;
        "app")
            curl -s http://localhost:$port/api/health > /dev/null 2>&1
            ;;
        *)
            return 1
            ;;
    esac
}

wait_for_port() {
    local port=$1
    local service=${2:-""}
    local timeout=45
    local counter=0

    echo "Waiting for $service on port $port to be available..."
    while [ $counter -lt $timeout ]; do
        # First check if port is bound
        if check_port $port; then
            # If we know the service type, also check health
            if [ ! -z "$service" ]; then
                if check_service_health $port $service; then
                    echo "$service on port $port is now available and healthy"
                    return 0
                fi
            else
                echo "Port $port is now available"
                return 0
            fi
        fi
        sleep 1
        counter=$((counter + 1))
    done

    echo "Timeout waiting for $service on port $port"
    return 1
}

ensure_log_manager() {
    echo "Checking log management daemon..."

    # Check if log manager script exists
    if [ ! -f "$LOG_MANAGER_SCRIPT" ]; then
        echo "Error: Log manager script not found at $LOG_MANAGER_SCRIPT"
        return 1
    fi

    # Make sure it's executable
    chmod +x "$LOG_MANAGER_SCRIPT"

    # Check if log manager is running
    if "$LOG_MANAGER_SCRIPT" status | grep -q "🟢 Status: Running"; then
        echo "Log management daemon is already running"
        return 0
    else
        echo "Starting log management daemon..."
        if "$LOG_MANAGER_SCRIPT" start; then
            echo "Log management daemon started successfully"
            return 0
        else
            echo "Failed to start log management daemon"
            return 1
        fi
    fi
}

start_qdrant() {
    echo "Starting Qdrant..."

    if [ -f "$QDRANT_PID_FILE" ]; then
        local pid=$(cat "$QDRANT_PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            echo "Qdrant is already running (PID: $pid)"
            return 0
        else
            echo "Removing stale Qdrant PID file"
            rm -f "$QDRANT_PID_FILE"
        fi
    fi

    # Check if port is already in use
    if check_port $QDRANT_PORT; then
        echo "Port $QDRANT_PORT is already in use. Please check if Qdrant is running elsewhere."
        return 1
    fi

    # Ensure logs directory exists
    mkdir -p "$LOGS_DIR"

    # Check if Qdrant is available in PATH or Docker
    if command -v qdrant > /dev/null 2>&1; then
        # Native Qdrant installation
        echo "Starting Qdrant using native binary..."
        nohup qdrant >> "$LOGS_DIR/qdrant.log" 2>&1 &
        echo $! > "$QDRANT_PID_FILE"
    elif command -v docker > /dev/null 2>&1; then
        # Docker installation
        echo "Starting Qdrant using Docker..."

        # Create persistent volume for Qdrant data
        docker volume create qdrant-storage > /dev/null 2>&1 || true

        # Check if container already exists
        if docker ps -a --filter "name=qdrant-chatbot" --format "{{.Names}}" | grep -q "qdrant-chatbot"; then
            echo "Removing existing Qdrant container (keeping data volume)..."
            docker rm -f qdrant-chatbot > /dev/null 2>&1
        fi

        # Start new container with persistent storage
        local container_id=$(docker run -d --name qdrant-chatbot \
            -p 6333:6333 -p 6334:6334 \
            -v qdrant-storage:/qdrant/storage \
            qdrant/qdrant)
        if [ $? -eq 0 ]; then
            echo "$container_id" > "$QDRANT_PID_FILE"

            # Start a background process to capture Docker logs
            nohup docker logs -f qdrant-chatbot >> "$LOGS_DIR/qdrant.log" 2>&1 &
        else
            echo "Failed to start Qdrant Docker container"
            return 1
        fi
    else
        echo "Error: Neither Qdrant binary nor Docker found."
        echo "Please install Qdrant or Docker to continue."
        return 1
    fi

    if wait_for_port $QDRANT_PORT "qdrant"; then
        echo "Qdrant started successfully"
        return 0
    else
        echo "Failed to start Qdrant - service not available"
        stop_qdrant
        return 1
    fi
}

stop_qdrant() {
    echo "Stopping Qdrant..."

    if [ -f "$QDRANT_PID_FILE" ]; then
        local pid=$(cat "$QDRANT_PID_FILE")

        # Check if this is a Docker container ID (longer than typical PID)
        if [ ${#pid} -gt 8 ]; then
            # Docker container
            echo "Stopping Qdrant Docker container..."
            docker stop qdrant-chatbot > /dev/null 2>&1
            docker rm qdrant-chatbot > /dev/null 2>&1
            echo "Qdrant Docker container stopped"
        else
            # Native process
            if ps -p $pid > /dev/null 2>&1; then
                echo "Stopping Qdrant process (PID: $pid)..."
                kill $pid
                sleep 3
                if ps -p $pid > /dev/null 2>&1; then
                    echo "Qdrant didn't stop gracefully, forcing termination..."
                    kill -9 $pid
                fi
                echo "Qdrant process stopped"
            else
                echo "Qdrant process was not running"
            fi
        fi

        rm -f "$QDRANT_PID_FILE"
    else
        echo "No Qdrant PID file found, checking for running processes..."
        # Fallback cleanup
        pkill -f qdrant > /dev/null 2>&1 || true
        docker stop qdrant-chatbot > /dev/null 2>&1 || true
        docker rm qdrant-chatbot > /dev/null 2>&1 || true
        echo "Cleanup completed"
    fi
}

start_app() {
    echo "Starting application..."

    if [ -f "$APP_PID_FILE" ]; then
        local pid=$(cat "$APP_PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            echo "Application is already running (PID: $pid)"
            return 0
        else
            echo "Removing stale application PID file"
            rm -f "$APP_PID_FILE"
        fi
    fi

    # Check if port is already in use
    if check_port $APP_PORT; then
        echo "Port $APP_PORT is already in use. Please check if the application is running elsewhere."
        return 1
    fi

    # Ensure logs directory exists
    mkdir -p "$LOGS_DIR"

    # Check if package.json exists
    if [ ! -f "$SCRIPT_DIR/package.json" ]; then
        echo "Error: package.json not found. Please run this script from the project root."
        return 1
    fi

    cd "$SCRIPT_DIR"
    echo "Starting Node.js application..."
    nohup npm start >> "$LOGS_DIR/app.log" 2>&1 &
    local app_pid=$!
    echo $app_pid > "$APP_PID_FILE"

    if wait_for_port $APP_PORT "app"; then
        echo "Application started successfully (PID: $app_pid)"
        return 0
    else
        echo "Failed to start application - service not available"
        stop_app
        return 1
    fi
}

stop_app() {
    echo "Stopping application..."

    if [ -f "$APP_PID_FILE" ]; then
        local pid=$(cat "$APP_PID_FILE")
        if ps -p $pid > /dev/null 2>&1; then
            echo "Stopping application process (PID: $pid)..."
            kill $pid
            sleep 3
            if ps -p $pid > /dev/null 2>&1; then
                echo "Application didn't stop gracefully, forcing termination..."
                kill -9 $pid
            fi
            echo "Application process stopped"
        else
            echo "Application process was not running"
        fi
        rm -f "$APP_PID_FILE"
    else
        echo "No application PID file found, checking for running processes..."
        # Fallback: kill any node processes running on the app port
        local app_pid=$(lsof -ti:$APP_PORT 2>/dev/null)
        if [ ! -z "$app_pid" ]; then
            echo "Found process on port $APP_PORT (PID: $app_pid), terminating..."
            kill $app_pid > /dev/null 2>&1 || true
        fi
        echo "Cleanup completed"
    fi
}

start_all() {
    echo "Starting AI Chatbot RAG System"
    echo "=============================="

    # Step 1: Ensure log management daemon is running
    if ! ensure_log_manager; then
        echo "❌ Failed to start log management daemon"
        return 1
    fi

    # Step 2: Start Qdrant
    echo ""
    if start_qdrant; then
        echo "✅ Qdrant started successfully"
    else
        echo "❌ Failed to start Qdrant"
        return 1
    fi

    # Step 3: Start Application
    echo ""
    if start_app; then
        echo "✅ Application started successfully"
    else
        echo "❌ Failed to start application, cleaning up..."
        stop_qdrant
        return 1
    fi

    echo ""
    echo "🎉 System Started Successfully!"
    echo "==============================="
    echo "🔗 Application: http://localhost:$APP_PORT"
    echo "🗄️  Qdrant API: http://localhost:$QDRANT_PORT"
    echo "📁 Logs: $LOGS_DIR/"
    echo ""
    echo "Available logs:"
    echo "  • Application: $LOGS_DIR/app.log"
    echo "  • Qdrant: $LOGS_DIR/qdrant.log"
    echo "  • Log Manager: $LOGS_DIR/log_manager.log"
    echo ""
    echo "To stop the system: $0 stop"
    echo "To check status: $0 status"
}

stop_all() {
    echo "Stopping AI Chatbot RAG System"
    echo "==============================="

    # Step 1: Stop Application
    stop_app
    echo ""

    # Step 2: Stop Qdrant
    stop_qdrant
    echo ""

    # Step 3: Optionally stop log manager (it can keep running)
    read -p "Stop log management daemon? [y/N]: " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [ -f "$LOG_MANAGER_SCRIPT" ]; then
            "$LOG_MANAGER_SCRIPT" stop
        fi
    else
        echo "Log management daemon will continue running"
    fi

    echo "✅ System stopped successfully"
}

status() {
    echo "AI Chatbot RAG System Status"
    echo "============================"

    # Check Log Manager
    if [ -f "$LOG_MANAGER_SCRIPT" ]; then
        echo "📊 Log Manager:"
        "$LOG_MANAGER_SCRIPT" status | grep "Status:" | sed 's/^/   /'
    else
        echo "🔴 Log Manager: Script not found"
    fi

    echo ""

    # Check Qdrant
    echo "🗄️  Qdrant:"
    if check_port $QDRANT_PORT; then
        echo "   🟢 Running on port $QDRANT_PORT"
        if [ -f "$QDRANT_PID_FILE" ]; then
            local pid=$(cat "$QDRANT_PID_FILE")
            if [ ${#pid} -gt 8 ]; then
                echo "   📦 Docker container: $pid"
            else
                echo "   🔧 Process PID: $pid"
            fi
        fi
    else
        echo "   🔴 Not running"
    fi

    echo ""

    # Check Application
    echo "🚀 Application:"
    if check_port $APP_PORT; then
        echo "   🟢 Running on port $APP_PORT"
        if [ -f "$APP_PID_FILE" ]; then
            echo "   🔧 Process PID: $(cat $APP_PID_FILE)"
        fi
    else
        echo "   🔴 Not running"
    fi

    echo ""

    # Log Information
    if [ -d "$LOGS_DIR" ]; then
        echo "📁 Log Files:"
        for log_file in app.log qdrant.log log_manager.log; do
            if [ -f "$LOGS_DIR/$log_file" ]; then
                local size=$(stat -c%s "$LOGS_DIR/$log_file" 2>/dev/null || echo "0")
                local human_size=$(numfmt --to=iec --suffix=B $size 2>/dev/null || echo "${size}B")
                echo "   📝 $log_file: $human_size"
            fi
        done

        if [ -d "$LOGS_DIR/archived" ]; then
            local archived_count=$(find "$LOGS_DIR/archived" -name "*.log.gz" 2>/dev/null | wc -l)
            echo "   🗄️  Archived logs: $archived_count files"
        fi
    else
        echo "📁 Log Files: Directory not created"
    fi
}

logs() {
    local service=$1
    local follow=${2:-false}

    if [ ! -d "$LOGS_DIR" ]; then
        echo "Logs directory not found. Please start the system first."
        return 1
    fi

    case $service in
        "app"|"application")
            local log_file="$LOGS_DIR/app.log"
            ;;
        "qdrant")
            local log_file="$LOGS_DIR/qdrant.log"
            ;;
        "manager"|"log-manager")
            local log_file="$LOGS_DIR/log_manager.log"
            ;;
        *)
            echo "Available log commands:"
            echo "  $0 logs app [follow]      - Application logs"
            echo "  $0 logs qdrant [follow]   - Qdrant logs"
            echo "  $0 logs manager [follow]  - Log manager logs"
            echo ""
            echo "Add 'follow' or '-f' to follow logs in real-time"
            return 0
            ;;
    esac

    if [ -f "$log_file" ]; then
        if [ "$follow" = "follow" ] || [ "$follow" = "-f" ]; then
            echo "Following $log_file (Ctrl+C to stop):"
            tail -f "$log_file"
        else
            echo "Contents of $log_file:"
            cat "$log_file"
        fi
    else
        echo "Log file not found: $log_file"
        return 1
    fi
}

show_help() {
    echo "AI Chatbot RAG Startup Script"
    echo "============================="
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  start      Start the complete system (log manager, Qdrant, application)"
    echo "  stop       Stop the application and Qdrant (optionally log manager)"
    echo "  restart    Stop and start the entire system"
    echo "  status     Show status of all services"
    echo "  logs       Show or follow service logs"
    echo "  help       Show this help message"
    echo ""
    echo "Log Commands:"
    echo "  logs app [follow]      - Show application logs"
    echo "  logs qdrant [follow]   - Show Qdrant logs"
    echo "  logs manager [follow]  - Show log manager logs"
    echo ""
    echo "System Architecture:"
    echo "  1. Log Manager Daemon - Handles log rotation and cleanup independently"
    echo "  2. Qdrant Vector Database - Provides vector storage and search"
    echo "  3. Node.js Application - Main chat application with RAG capabilities"
    echo ""
    echo "Startup Order:"
    echo "  1. Log Manager (if not already running)"
    echo "  2. Qdrant Vector Database"
    echo "  3. Node.js Application"
    echo ""
    echo "Shutdown Order:"
    echo "  1. Node.js Application"
    echo "  2. Qdrant Vector Database"
    echo "  3. Log Manager (optional - can keep running)"
    echo ""
    echo "Examples:"
    echo "  $0 start              # Start the complete system"
    echo "  $0 status             # Check all services"
    echo "  $0 logs app follow    # Follow application logs"
    echo "  $0 stop               # Stop app and Qdrant"
}

# Make sure log manager script is executable
if [ -f "$LOG_MANAGER_SCRIPT" ]; then
    chmod +x "$LOG_MANAGER_SCRIPT"
fi

# Main script logic
case "${1:-}" in
    "start")
        start_all
        ;;
    "stop")
        stop_all
        ;;
    "restart")
        stop_all
        sleep 3
        start_all
        ;;
    "status")
        status
        ;;
    "logs")
        logs "$2" "$3"
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    "")
        echo "AI Chatbot RAG Startup Script"
        echo "Use '$0 help' for usage information"
        echo ""
        status
        ;;
    *)
        echo "Unknown command: $1"
        echo "Use '$0 help' for usage information"
        exit 1
        ;;
esac