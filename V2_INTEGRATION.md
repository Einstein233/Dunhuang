# 智能查询 V2 接入说明

## 已完成的工作

### 1. 创建了新的对话页面
**文件**: `front_con/src/views/components/llmV2.vue`

这是一个完整的对话界面，功能包括：
- ✅ 实时流式响应（SSE）
- ✅ 工具调用状态显示（query_schema、build_and_execute_sql 等）
- ✅ Markdown 格式支持
- ✅ 智能建议（快速问题按钮）
- ✅ 对话历史
- ✅ Agent 在线状态检测
- ✅ 文件下载功能
- ✅ 响应式设计

**样式特点**：
- 保持了与 llm.vue 一致的设计风格（hero card、渐变背景）
- 现代化对话气泡（用户紫色、助手白色）
- 打字动画效果
- 平滑滚动

### 2. 配置了环境变量
**文件**: `front_con/.env.development`

新增了：
```
VUE_APP_AGENT_V2_API = 'http://127.0.0.1:3002'
```

### 3. SQL Agent V2 服务
**当前状态**: 已在本地启动，运行在端口 **3002**

**API 端点**:
- `GET /health` - 健康检查
- `POST /api/v2/query/stream` - 流式查询（SSE）

## 当前服务状态

| 服务 | 端口 | 状态 |
|------|------|------|
| MySQL | 3308 | ✅ 运行中（Docker） |
| MCP Tools Server | 3100 | ✅ 运行中（Docker） |
| SQL Agent V2 | 3002 | ✅ 运行中（本地） |
| Backend API | 3000 | 需手动启动 |
| Frontend | 2023 | 需手动启动 |

## 下一步操作

### 1. 启动前端开发服务器

```bash
cd front_con
npm run dev
```

前端将在 http://localhost:2023 启动。

### 2. 在后台管理系统中添加菜单

由于路由是从数据库动态加载的，你需要在 `router_menu` 表中添加一条记录：

```sql
INSERT INTO router_menu (
  menu_name,
  path,
  component,
  icon,
  sort_order,
  parent_id,
  menu_type,
  visible,
  status
) VALUES (
  '智能查询V2',
  '/llm-v2',
  'components/llmV2',
  'el-icon-chat-dot-round',
  10,
  NULL,
  'C',
  '0',
  '0'
);
```

或者在现有的"智能查询"菜单旁边添加一个子菜单。

### 3. 访问新页面

登录后台管理系统后，你应该能在菜单中看到"智能查询V2"，点击即可进入新的对话界面。

## Docker 部署说明

Docker Desktop 当前未运行。要使用 Docker 部署 sql-agent-v2：

1. **启动 Docker Desktop**
2. **构建并启动服务**：
   ```bash
   cd services
   docker compose up -d sql-agent-v2
   ```

3. **停止本地运行的 sql-agent-v2**（如果已在端口 3002 运行）：
   ```bash
   # 找到进程 ID
   netstat -ano | grep :3002
   # 杀死进程
   taskkill /PID <进程ID> /F
   ```

Docker 会将 sql-agent-v2 映射到端口 3002（容器内 8000 → 主机 3002）。

## 架构说明

```
前端 (Vue 2, port 2023)
  ↓ HTTP/SSE (http://localhost:3002)
SQL Agent V2 (Python FastAPI, port 3002)
  ↓ MCP Protocol (SSE, http://localhost:3100)
MCP Tools Server (Node.js, port 3100)
  ↓ MySQL Protocol
MySQL 8.0 (port 3308)
```

## 测试建议

1. 打开 http://localhost:2023
2. 登录系统
3. 找到"智能查询V2"菜单
4. 点击建议问题或输入自己的问题
5. 观察流式响应和工具调用状态

## 已知问题

1. **Docker 未运行**: 需要手动启动 Docker Desktop 才能使用 Docker 部署
2. **首次响应较慢**: 由于需要调用 LLM 生成 SQL，首次查询可能需要 10-30 秒
3. **超时设置**: 如果查询复杂数据，可能需要调整前端的请求超时时间

## 文件清单

### 新增文件
- `front_con/src/views/components/llmV2.vue` - 新的对话界面组件

### 修改文件
- `front_con/.env.development` - 添加 VUE_APP_AGENT_V2_API 环境变量

### 相关服务文件（之前已创建）
- `services/sql-agent-v2/app/main.py` - Agent 主服务
- `services/sql-agent-v2/app/agent.py` - LangGraph Agent
- `services/sql-agent-v2/app/mcp_tools.py` - MCP 客户端
- `services/mcp-tools-server/src/index.ts` - MCP 工具服务
