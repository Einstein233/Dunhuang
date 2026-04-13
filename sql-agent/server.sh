#!/bin/bash

# 敦煌智能体 - 服务管理脚本
# 用法：./server.sh [start|stop|restart|status]

PORT=3000
PID_FILE=".server.pid"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 获取进程 PID
get_pid() {
    if [ -f "$PID_FILE" ]; then
        cat "$PID_FILE"
    fi
}

# 检查服务状态
check_status() {
    local pid=$(get_pid)
    if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
        echo -e "${GREEN}● 服务器正在运行 (PID: $pid)${NC}"
        return 0
    else
        echo -e "${YELLOW}○ 服务器未运行${NC}"
        return 1
    fi
}

# 启动服务
start() {
    check_status
    if [ $? -eq 0 ]; then
        echo -e "${YELLOW}服务器已在运行中，无需重复启动${NC}"
        return 0
    fi

    echo -e "${GREEN}正在启动服务器...${NC}"
    nohup npx ts-node src/server.ts > server.log 2>&1 &
    local pid=$!
    echo $pid > "$PID_FILE"

    sleep 2

    if ps -p "$pid" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ 服务器启动成功 (PID: $pid)${NC}"
        echo -e "${GREEN}✓ 访问地址：http://localhost:$PORT${NC}"
        echo -e "${YELLOW}提示：日志文件 server.log${NC}"
    else
        echo -e "${RED}✗ 服务器启动失败${NC}"
        echo -e "${YELLOW}查看日志：cat server.log${NC}"
        rm -f "$PID_FILE"
        return 1
    fi
}

# 停止服务
stop() {
    local pid=$(get_pid)

    if [ -z "$pid" ]; then
        # 尝试从端口查找进程
        pid=$(netstat -tulpn 2>/dev/null | grep ":$PORT " | awk '{print $7}' | cut -d'/' -f1 | head -1)
    fi

    if [ -n "$pid" ]; then
        echo -e "${YELLOW}正在停止服务器 (PID: $pid)...${NC}"
        kill "$pid" 2>/dev/null
        sleep 1

        # 强制停止（如果还在运行）
        if ps -p "$pid" > /dev/null 2>&1; then
            echo -e "${YELLOW}进程未响应，强制终止...${NC}"
            kill -9 "$pid" 2>/dev/null
        fi

        rm -f "$PID_FILE"
        echo -e "${GREEN}✓ 服务器已停止${NC}"
    else
        echo -e "${YELLOW}服务器未在运行${NC}"
    fi
}

# 重启服务
restart() {
    echo -e "${GREEN}正在重启服务器...${NC}"
    stop
    sleep 1
    start
}

# 查看日志
logs() {
    if [ -f "server.log" ]; then
        tail -f server.log
    else
        echo -e "${YELLOW}日志文件不存在${NC}"
    fi
}

# 主程序
case "$1" in
    start)
        start
        ;;
    stop)
        stop
        ;;
    restart)
        restart
        ;;
    status)
        check_status
        ;;
    logs)
        logs
        ;;
    *)
        echo -e "${GREEN}敦煌智能体 - 服务管理脚本${NC}"
        echo ""
        echo "用法：$0 {start|stop|restart|status|logs}"
        echo ""
        echo "  start   - 启动服务器"
        echo "  stop    - 停止服务器"
        echo "  restart - 重启服务器"
        echo "  status  - 查看运行状态"
        echo "  logs    - 查看实时日志"
        echo ""
        echo "示例:"
        echo "  $0 start    # 启动服务"
        echo "  $0 restart  # 重启服务"
        echo "  $0 logs     # 查看日志"
        ;;
esac
