# Game Server Monitor

Hệ thống giám sát và quản lý cụm Game Server đa nền tảng thời gian thực.

## Tính năng chính
- 📊 **Giám sát thời gian thực**: Đo lường CPU, RAM, Network I/O, Disk I/O của Host & Docker Containers.
- 🔌 **Theo dõi kết nối**: Thống kê số lượng Unique Clients (IPs) và Total Active Connections, hỗ trợ gom nhóm theo từng đầu Port (Group by Port).
- 🖥️ **Multi-Tab SSH Terminal**: Quản lý nhiều phiên kết nối SSH đồng thời với giao diện Tab Bar linh hoạt, duy trì kết nối liên tục khi chuyển đổi giữa các tab.
- 🐳 **Quản lý Docker Containers**: Khởi động, tạm dừng, khởi động lại container và xem logs trực tiếp từ giao diện Web.

## Cấu trúc dự án
- `agent/`: Dịch vụ thu thập thông số (Rust).
- `backend/`: API Server chính & WebSocket SSH Proxy (Rust + Axum + SQLx).
- `frontend/`: Giao diện Dashboard quản trị (React + TypeScript + TailwindCSS + XTerm).
