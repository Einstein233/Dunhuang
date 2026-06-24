# MCP Tools Server 构建完成报告

## 已创建的文件

```
services/mcp-tools-server/
├── package.json          # 依赖配置
├── tsconfig.json         # TypeScript 配置
├── .env.example          # 环境变量模板
├── Dockerfile            # Docker 镜像配置
├── README.md             # 完整文档
└── src/
    ├── index.ts          # MCP Server 入口（5 个工具注册）
    ├── db-pool.ts        # MySQL 连接池（从 sql-agent 提取）
    ├── schema-reader.ts  # Schema 读取（从 sql-agent 提取）
    ├── sql-executor.ts   # SQL 执行器（从 sql-agent 提取）
    ├── sql-guard.ts      # SQL 安全校验（从 sql-agent 提取）
    ├── chart-engine.ts   # ECharts 配置生成（从 sql-agent 提取）
    └── sql-builder.ts    # LLM SQL 生成（从 sql-agent 提取）
```

## 注册的 5 个 MCP 工具

### 1. `query_schema`
读取数据库完整表结构，返回 Markdown 格式描述。

**输入**: 无  
**输出**: Schema 文本（包含表名、字段、类型、索引、关系、查询指导）

### 2. `execute_sql`
执行 SQL 查询，带安全校验。

**输入**: `sql: string`  
**输出**: `{ success, sql, columns, rowCount, data, durationMs }`

### 3. `build_and_execute_sql`
一站式工具：LLM 生成 SQL → 校验 → 执行。

**输入**: `query: string`, `schema: string`  
**输出**: `{ success, sql, reason, columns, rowCount, data, durationMs }`

### 4. `generate_chart`
生成 ECharts 图表配置。

**输入**: `chartType`, `data`, `xAxisField?`, `yAxisField?`  
**输出**: `{ success, chartType, config }`

### 5. `health_check`
健康检查。

**输入**: 无  
**输出**: `{ database, tools, version, timestamp }`

## 安全机制

所有 SQL 执行前经过 `sql-guard.ts` 校验：

- ✅ 只允许 SELECT 语句
- ✅ 表名白名单（weather_data, station_info, weather_directory 等）
- ✅ 禁止危险函数（SLEEP, BENCHMARK, LOAD_FILE）
- ✅ 禁止访问系统库（information_schema, mysql 等）
- ✅ 禁止用户变量（@var）
- ✅ 查询超时控制（默认 30 秒）
- ✅ 结果行数限制（默认 1000 行）

## 部署要求

- **Node.js**: >= 18（Docker 使用 Node 20）
- **MySQL**: 8.0（已有）
- **MCP SDK**: @modelcontextprotocol/sdk ^1.12.0

## 快速启动

### 方式 1: Docker（推荐）

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

然后：

```bash
cd services
docker compose up -d mcp-tools
```

### 方式 2: 本地开发

```bash
cd services/mcp-tools-server
cp .env.example .env
# 编辑 .env，填入 QWEN_API_KEY

# 需要 Node 18+
npm install
npm run build
npm start
```

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `GET /sse` | SSE 连接 | Python Agent 通过此端点连接 |
| `POST /messages` | MCP 消息 | 处理工具调用请求 |
| `GET /health` | 健康检查 | 返回服务状态 |

## Python Agent 连接示例

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

# 连接 MCP Tools Server
client = MultiServerMCPClient({
    "weather_tools": {
        "url": "http://localhost:3100/sse",
        "transport": "sse",
    }
})

# 获取所有工具
tools = client.get_tools()

# 在 LangGraph Agent 中使用
from langgraph.prebuilt import create_react_agent
agent = create_react_agent(llm, tools)
```

## 工具调用流程示例

```
用户: "敦煌近三个月的平均温度"
  │
  ▼
Python Agent (LangGraph)
  │
  ├─→ 调用 query_schema
  │     └─→ 返回 Schema Markdown
  │
  ├─→ 调用 build_and_execute_sql
  │     ├─→ LLM 生成 SQL
  │     ├─→ sql-guard 校验
  │     ├─→ 执行查询
  │     └─→ 返回结果
  │
  ├─→ 调用 generate_chart
  │     └─→ 返回 ECharts config
  │
  └─→ 组合最终回答
```

## 代码提取来源

| 模块 | 来源文件 | 说明 |
|---|---|---|
| db-pool.ts | sql-agent/src/tool-runtime.ts (1-22) | MySQL 连接池 |
| schema-reader.ts | sql-agent/src/tool-runtime.ts (212-343) | Schema 读取 |
| sql-executor.ts | sql-agent/src/tool-runtime.ts (345-387) | SQL 执行 |
| sql-guard.ts | sql-agent/src/sql-guard.ts | SQL 安全校验 |
| chart-engine.ts | sql-agent/src/tool-runtime.ts (389-581) | 图表生成 |
| sql-builder.ts | sql-agent/src/sql-builder.ts | LLM SQL 生成 |

所有工具逻辑原样提取，未修改业务逻辑。

## 下一步

MCP Tools Server 已构建完成。接下来需要：

1. **构建 Python Agent 服务**（LangGraph 编排）
   - 主 Agent：对话管理 + 意图路由
   - 从 Agent：SQL Worker（调用 MCP 工具）

2. **更新 DESIGN.md**
   - 记录 MCP 架构
   - 定义 Agent 状态图

3. **Docker Compose 集成**
   - 添加 mcp-tools 服务
   - 添加 agent-service 服务
