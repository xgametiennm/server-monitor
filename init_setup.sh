#!/bin/bash

# Game Server Monitor - Automated Initialization Script
# This will build and run all services (DB, Backend, Frontend) from scratch.

set -e

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PORT=${FRONTEND_PORT:-5179}

echo -e "\033[0;34m====================================================\033[0m"
echo -e "\033[0;34m    INITIALIZING GAME SERVER MONITOR DOCKER STACK   \033[0m"
echo -e "\033[0;34m====================================================\033[0m"

# Stop existing containers if running
echo -e "\033[0;32m[1/3] Dừng các container cũ nếu đang chạy...\033[0m"
docker-compose down

# Build and start all services
echo -e "\033[0;32m[2/3] Biên dịch và chạy toàn bộ dịch vụ (DB, Backend, Frontend)...\033[0m"
docker-compose up --build -d

# Show current status
echo -e "\033[0;32m[3/3] Trạng thái các container hiện tại:\033[0m"
echo -e "\033[0;34m----------------------------------------------------\033[0m"
docker-compose ps
echo -e "\033[0;34m----------------------------------------------------\033[0m"

echo -e "\033[0;32m🎉 Đã khởi chạy thành công hệ thống!\033[0m"
echo -e "Truy cập giao diện tại: \033[0;36mhttp://localhost:$PORT/\033[0m"
echo -e "\033[0;34m====================================================\033[0m"
