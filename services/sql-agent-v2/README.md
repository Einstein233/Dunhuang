# SQL Agent V2 - 气象数据智能助手

> 基于 LangGraph + MCP 的智能对话服务

## 架构

```
┌─────────────────────────────────────┐
│   FastAPI + SSE                     │
│   /api/v2/query (同步)              │
│   /api/v2/query/stream (流式)       │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│   LangGraph Agent                   │
│   ├── LLM (Qwen) 决策               │
│   ├── 工具调用 (MCP)                │
│   └── 流式输出                      │
└──────────────┬──────────────────────┘
               │ MCP Protocol (SSE)
               ▼
┌─────────────────────────────────────┐
│   MCP Tools Server (Node.js)        │
│   ├── query_schema                  │
│   ├── execute_sql                   │
│   ├── build_and_execute_sql         │
│   ├── generate_chart                │
│   └── health_check                  │
└─────────────────────────────────────┘
```

## 快速开始

### 1. 配置环境变量

```bash
cd services/sql-agent-v2
cp .env.example .env
# 编辑 .env，填入 LLM_API_KEY
```

### 2. 本地开发

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python -m app.main
# 或
uvicorn app.main:app --reload --port 8000
```

### 3. Docker 部署

在 `services/docker-compose.yml` 中添加：

```yaml
sql-agent-v2:
  build: ./sql-agent-v2
  ports:
    - "3002:8000"
  environment:
    - MCP_TOOLS_URL=http://mcp-tools:3100/sse
    - LLM_API_KEY=${LLM_API_KEY}
    - LLM_BASE_URL=${LLM_BASE_URL}
    - LLM_MODEL=${LLM_MODEL}
  depends_on:
    - mcp-tools
  restart: unless-stopped
```

## API 接口

### 同步查询

```bash
POST /api/v2/query
Content-Type: application/json

{
  "query": "敦煌近三个月的平均温度变化趋势",
  "history": []
}
```

**响应**:
```json
{
  "success": true,
  "answer": "敦煌近三个月平均温度呈上升趋势...",
  "messages_count": 5
}
```

### 流式查询 (SSE)

```bash
POST /api/v2/query/stream
Content-Type: application/json

{
  "query": "敦煌近三个月的平均温度变化趋势",
  "history": []
}
```

**SSE 事件流**:
```
event: tool_start
data: {"tool": "query_schema"}

event: tool_end
data: {"tool": "query_schema", "output": "..."}

event: tool_start
data: {"tool": "build_and_execute_sql"}

event: text
data: {"chunk": "敦煌近三个月"}

event: text
data: {"chunk": "平均温度呈上升趋势"}

event: done
data: {}
```

### 健康检查

```bash
GET /health
```

## 源码结构

```
app/
├── __init__.py
├── config.py       # 配置管理
├── mcp_tools.py    # MCP 客户端（连接工具服务）
├── agent.py        # LangGraph Agent（主逻辑）
└── main.py         # FastAPI 入口
```

## 工作原理

1. **用户提问** → FastAPI 接收请求
2. **Agent 决策** → LLM 判断是否需要查询数据
3. **工具调用** → 通过 MCP 调用 Node.js 工具服务
4. **数据查询** → 工具服务执行 SQL 并返回结果
5. **生成回答** → LLM 总结数据并用自然语言回复
6. **流式输出** → 通过 SSE 实时推送给前端

## 依赖

- **LangGraph**: Agent 编排
- **LangChain**: LLM 抽象
- **FastAPI**: Web 框架
- **MCP SDK**: 工具协议
- **Qwen**: LLM 模型
