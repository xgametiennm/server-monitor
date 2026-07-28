#!/bin/bash

# Game Server Agent - Automated Deployment Script
# This script will install Rust (if missing), compile the agent, and set it up as a background systemd service.

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0;3b' # No Color
NC='\033[0m'

echo -e "${BLUE}====================================================${NC}"
echo -e "${BLUE}      GAME SERVER MONITORING AGENT DEPLOYMENT       ${NC}"
echo -e "${BLUE}====================================================${NC}"

# 1. Ask for configuration parameters
default_port="9100"
default_token=$(openssl rand -hex 12 2>/dev/null || echo "agent-secret-$(date +%s)")

read -p "Nhập Cổng (Port) chạy Agent [Mặc định: $default_port]: " PORT
PORT=${PORT:-$default_port}

read -p "Nhập Mã Token bảo mật [Mặc định: $default_token]: " TOKEN
TOKEN=${TOKEN:-$default_token}

# 2. Check and Install Rust/Cargo if missing
if ! command -v cargo &> /dev/null; then
    echo -e "${BLUE}[1/4] Cài đặt Rust Compiler...${NC}"
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
else
    echo -e "${GREEN}[1/4] Rust/Cargo đã được cài đặt sẵn.${NC}"
fi

# 3. Build the Agent
echo -e "${BLUE}[2/4] Đang biên dịch Agent (Release mode)...${NC}"
cargo build --release

# Get absolute path of the compiled binary
BINARY_PATH="$(pwd)/target/release/game-server-agent"

# 4. Create systemd Service file
echo -e "${BLUE}[3/4] Cấu hình tự động chạy ngầm (Systemd Service)...${NC}"

# Detect if Docker is installed on this system
DOCKER_DEPS=""
if command -v docker &> /dev/null; then
    DOCKER_DEPS="After=network.target docker.service
Wants=docker.service"
    echo -e "${GREEN}    ✓ Phát hiện Docker → Agent sẽ theo dõi Docker Containers.${NC}"
else
    DOCKER_DEPS="After=network.target"
    echo -e "${BLUE}    ℹ Không có Docker → Agent chỉ thu thập thông số hệ thống (CPU/RAM/Disk/Network/TCP).${NC}"
fi

SERVICE_FILE="/etc/systemd/system/game-agent.service"

sudo bash -c "cat > $SERVICE_FILE" <<EOL
[Unit]
Description=Game Server Monitoring Agent
$DOCKER_DEPS

[Service]
Type=simple
User=root
WorkingDirectory=$(pwd)
Environment=PORT=$PORT
Environment=AGENT_SECRET_TOKEN=$TOKEN
ExecStart=$BINARY_PATH
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOL

# Reload systemd and start the service
echo -e "${BLUE}[4/4] Khởi động dịch vụ systemd...${NC}"
sudo systemctl daemon-reload
sudo systemctl enable game-agent.service
sudo systemctl restart game-agent.service

# 5. Output local IP and registration guide
LOCAL_IP=$(hostname -I | awk '{print $1}' 2>/dev/null || echo "IP_CỦA_SERVER")

echo -e "${GREEN}====================================================${NC}"
echo -e "${GREEN}🎉 Đã triển khai Agent thành công và đang chạy ngầm!${NC}"
echo -e "${GREEN}====================================================${NC}"
echo -e "Thông tin để bạn nhập vào giao diện Dashboard Admin:"
echo -e "  - ${BLUE}Tên Server:${NC} Đặt tên bất kỳ (Ví dụ: Game Server 1)"
echo -e "  - ${BLUE}Agent URL:${NC}  http://$LOCAL_IP:$PORT"
echo -e "  - ${BLUE}Mã Token:${NC}   $TOKEN"
echo -e "----------------------------------------------------"
echo -e "Xem trạng thái dịch vụ:  ${BLUE}sudo systemctl status game-agent${NC}"
echo -e "Xem nhật ký logs:        ${BLUE}sudo journalctl -u game-agent -f${NC}"
echo -e "===================================================="
