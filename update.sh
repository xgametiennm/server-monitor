#!/bin/bash

# Game Server Monitor - Hot Update Script
# This will compile and redeploy ONLY the Frontend and Backend containers.
# The Database container and its volumes will not be affected.

set -e

# Load environment variables from .env file
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

PORT=${FRONTEND_PORT:-5179}

echo -e "\033[0;34m====================================================\033[0m"
echo -e "\033[0;34m    UPDATING FRONTEND AND BACKEND SERVICES          \033[0m"
echo -e "\033[0;34m====================================================\033[0m"

# Build and recreate only frontend and backend
echo -e "\033[0;32m[1/2] Đang cập nhật và biên dịch lại container backend và frontend...\033[0m"
docker-compose up --build -d backend frontend

# Show current status
echo -e "\033[0;32m[2/2] Trạng thái các container hiện tại:\033[0m"
echo -e "\033[0;34m----------------------------------------------------\033[0m"
docker-compose ps
echo -e "\033[0;34m----------------------------------------------------\033[0m"

echo -e "\033[0;32m🎉 Đã cập nhật thành công code mới!\033[0m"
echo -e "Truy cập giao diện tại: \033[0;36mhttp://localhost:$PORT/\033[0m"
echo -e "\033[0;34m====================================================\033[0m"
