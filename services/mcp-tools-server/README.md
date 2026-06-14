# Dunhuang Weather MCP Tools Server

> 基于 Model Context Protocol (MCP) 的气象数据工具服务
> 从 `sql-agent` 中提取核心工具，供 Python LangGraph Agent 调用

## 架构定位

```
┌─────────────────────────────────────┐
│   Python Agent (LangGraph)          │
│   ├── 主 Agent: 对话管理 + 路由      │
│   └── 从 Agent: SQL Worker          │
└──────────────┬──────────────────────┘
               │ MCP Protocol (SSE)
               ▼
┌─────────────────────────────────────┐
│   MCP Tools Server (本服务)          │
│   ├── query_schema                  │
│   ├── execute_sql                   │
│   ├── build_and_execute_sql         │
│   ├── generate_chart                │
│   └── health_check                  │
└──────────────┬──────────────────────┘
               │ MySQL
               ▼
┌─────────────────────────────────────┐
│   MySQL 8.0 (dunhuang_agent)        │
└─────────────────────────────────────┘
```

## 工具清单

| 工具名 | 用途 | 输入 | 输出 |
|---|---|---|---|
| `query_schema` | 读取数据库完整表结构 | 无 | Markdown 格式的 Schema |
| `execute_sql` | 执行 SQL 查询（带安全校验） | `sql: string` | JSON 结果（列名 + 数据行） |
| `build_and_execute_sql` | 一站式：LLM 生成 SQL → 校验 → 执行 | `query: string`, `schema: string` | JSON 结果 + SQL + 推理过程 |
| `generate_chart` | 生成 ECharts 图表配置 | `chartType`, `data`, `xAxisField?`, `yAxisField?` | ECharts option JSON |
| `health_check` | 健康检查 | 无 | 服务状态 |

## 安全机制

所有 SQL 执行前都会经过 `sql-guard.ts` 校验：

- **只读约束**：仅允许 SELECT，禁止 INSERT/UPDATE/DELETE/DROP 等
- **表名白名单**：只允许查询预定义的表（weather_data, station_info, weather_directory 等）
- **危险模式检测**：禁止 SLEEP/BENCHMARK/LOAD_FILE 等
- **系统库保护**：禁止访问 information_schema/mysql/performance_schema/sys

## 快速开始

### 1. 安装依赖

```bash
cd services/mcp-tools-server
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入实际的 QWEN_API_KEY
```

### 3. 本地开发运行

```bash
# 确保 MySQL 容器已运行
cd services && docker compose up -d mysql

# 启动 MCP 服务（开发模式）
npm run dev

# 或编译后运行
npm run build && npm start
```

### 4. Docker 部署

在 `services/docker-compose.yml` 中添加：

```yaml
mcp-tools:
  build: ./mcp-tools-server
  ports:
    - "3100:3100"
  environment:
    - DATABASE_URL=mysql://root:root@mysql:3306/dunhuang_agent
    - QWEN_API_KEY=${QWEN_API_KEY}
    - QWEN_BASE_URL=${QWEN_BASE_URL}
    - QWEN_MODEL=${QWEN_MODEL}
    - MCP_SERVER_PORT=3100
  depends_on:
    mysql:
      condition: service_healthy
  restart: unless-stopped
```

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/sse` | GET | SSE 连接端点，Python Agent 通过此端点连接 |
| `/messages` | POST | MCP 消息端点，处理工具调用请求 |
| `/health` | GET | 健康检查 |

## Python Agent 连接示例

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

client = MultiServerMCPClient({
    "weather_tools": {
        "url": "http://localhost:3100/sse",
        "transport": "sse",
    }
})

# 获取工具
tools = client.get_tools()

# 在 LangGraph Agent 中使用
agent = create_react_agent(llm, tools)
```

## 源码结构

```
src/
├── index.ts          # MCP Server 入口 + 工具注册
├── db-pool.ts        # MySQL 连接池（从 sql-agent 提取）
├── schema-reader.ts  # Schema 读取（从 sql-agent 提取）
├── sql-executor.ts   # SQL 执行器（从 sql-agent 提取）
├── sql-guard.ts      # SQL 安全校验（从 sql-agent 提取）
├── chart-engine.ts   # ECharts 配置生成（从 sql-agent 提取）
└── sql-builder.ts    # LLM SQL 生成（从 sql-agent 提取）
```

## 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `DATABASE_URL` | ✅ | - | MySQL 连接 URL |
| `QWEN_API_KEY` | ✅ | - | 通义千问 API Key |
| `QWEN_BASE_URL` | ❌ | DashScope | LLM API 地址 |
| `QWEN_MODEL` | ❌ | qwen-plus | LLM 模型名 |
| `MCP_SERVER_PORT` | ❌ | 3100 | 服务端口 |
| `SQL_TIMEOUT_MS` | ❌ | 30000 | SQL 执行超时（毫秒） |
| `MAX_RESULT_ROWS` | ❌ | 1000 | 最大返回行数 |
| `SQL_AGENT_ALLOWED_TABLES` | ❌ | 内置列表 | 允许的表名（逗号分隔） |
| `SQL_AGENT_ALLOWED_SCHEMAS` | ❌ | dunhuang_agent | 允许的数据库名（逗号分隔） |
