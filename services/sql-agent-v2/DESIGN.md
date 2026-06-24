# SQL Agent V2 - Text2SQL 设计文档

> 基于 LangChain / LangGraph 的 Text2SQL 智能体服务
> 独立 Docker 部署，通过 REST API 与前端对接

---

## 1. 设计目标

| 目标 | 说明 |
|------|------|
| 自然语言查询 | 用户用中文提问，系统自动生成并执行 SQL |
| 结构化输出 | 返回表格数据 + ECharts 图表配置 + 自然语言解读 |
| 自我纠错 | SQL 执行失败时自动修复，最多重试 N 次 |
| Schema 感知 | 按需召回相关表结构，避免全量塞入 Prompt |
| 安全约束 | 仅允许 SELECT，禁止任何写操作 |

---

## 2. 技术选型

| 层 | 技术 | 理由 |
|----|------|------|
| 图编排 | **LangGraph** | 状态图 + 条件路由 + 循环重试，比手写 agent loop 更可靠 |
| LLM 抽象 | **LangChain** | ChatModel / PromptTemplate / OutputParser 生态完善 |
| Web 框架 | **FastAPI** | 异步 + SSE 流式 + 自动 OpenAPI 文档 |
| 数据库 | **MySQL 8.0** (已有) | 复用现有 dunhuang_agent 数据库 |
| 容器化 | **Docker** | 独立服务，docker-compose 一键启动 |

---

## 3. LangGraph 图结构

```
                    ┌─────────────┐
                    │   START     │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ query_analyzer│   分析用户意图、提取实体
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ schema_retriever│  按需召回相关表结构
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ sql_generator │   生成 SQL
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ sql_validator │   校验 SQL 安全性 + 语法
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
              ┌────▶│ sql_executor  │   执行 SQL
              │     └──────┬──────┘
              │            │
              │     ┌──────▼──────┐
              │     │ error_checker │  检查执行结果
              │     └──┬────────┬──┘
              │        │        │
              │   成功  │        │ 失败且重试 < 3
              │        │        │
              │        │  ┌─────▼──────┐
              │        │  │ sql_fixer   │  基于错误信息修复 SQL
              │        │  └─────┬──────┘
              │        │        │
              │        │        └──── 回到 sql_executor
              │        │
              │   ┌────▼─────────┐
              │   │ result_analyzer│  分析结果、决定图表类型
              │   └────┬─────────┘
              │        │
              │   ┌────▼─────────┐
              │   │ chart_generator│  生成 ECharts 配置
              │   └────┬─────────┘
              │        │
              │   ┌────▼─────────┐
              │   │ answer_composer│  组合最终回答
              │   └────┬─────────┘
              │        │
              │   ┌────▼─────────┐
              │   │    END       │
              │   └──────────────┘
              │
              └── 重试次数 >= 3 时直接到 answer_composer（返回错误说明）
```

---

## 4. State 状态定义

```python
from typing import TypedDict, Optional, Any
from langgraph.graph import MessagesState

class AgentState(TypedDict):
    # === 输入 ===
    session_id: str                        # 会话 ID
    user_query: str                        # 用户原始问题
    history: list[dict]                    # 对话历史 [{role, content}]

    # === 查询分析 ===
    query_intent: str                      # 意图类型: "data_query" | "meta_query" | "chitchat"
    extracted_entities: dict               # 提取的实体 {region, metric, time_range, ...}

    # === Schema ===
    schema_text: str                       # 召回的表结构描述文本
    relevant_tables: list[str]             # 相关表名列表

    # === SQL ===
    generated_sql: str                     # 生成的 SQL
    sql_validation: dict                   # 校验结果 {is_valid, issues}
    execution_result: Optional[dict]       # 执行结果 {columns, rows, row_count}
    sql_error: Optional[str]               # SQL 执行错误信息
    retry_count: int                       # 当前重试次数

    # === 输出 ===
    chart_type: Optional[str]              # 图表类型: "bar" | "line" | "pie" | "table" | null
    chart_config: Optional[dict]           # ECharts option 配置
    answer: str                            # 自然语言回答
    diagnostics: list[dict]                # 诊断信息（调试用）
```

---

## 5. 各节点详细设计

### 5.1 QueryAnalyzerNode — 查询分析

**职责**: 理解用户意图，提取关键实体

**输入**: `user_query`, `history`

**输出**: `query_intent`, `extracted_entities`

**Prompt 设计**:

```
你是一个气象数据查询意图分析专家。分析用户的问题，提取关键信息。

## 可用数据范围
- 气象指标: 温度(avg_temperature)、湿度(relativehumidity_2m)、降雨量(rain_sum)、
  降雪量(snow_sum)、风速(max_continuous_wind_speed)、阵风(gusts_max)、
  风向(winddirection_dominant)、短波辐射(shortwave_radiation_sum)
- 地区维度: 省(province)、市(city)
- 时间维度: 小时级记录(record_time)

## 输出要求 (严格 JSON)
{
  "intent": "data_query" | "meta_query" | "chitchat",
  "entities": {
    "region": {"province": "省名或null", "city": "市名或null"},
    "metrics": ["需要查询的气象指标字段名列表"],
    "time_range": {"start": "YYYY-MM-DD或null", "end": "YYYY-MM-DD或null"},
    "aggregation": "AVG|SUM|MAX|MIN|COUNT或null",
    "group_by": "month|day|hour|city|province或null",
    "comparison": "是否有对比需求(yoy|mom|cross_region|null)"
  },
  "rewritten_query": "改写后的规范化查询（消除指代、补全省略）"
}

intent 判断规则:
- data_query: 用户想查询具体气象数据
- meta_query: 用户询问系统有什么数据、覆盖哪些地区
- chitchat: 与气象数据无关的闲聊
```

### 5.2 SchemaRetrieverNode — Schema 召回

**职责**: 根据分析结果，从数据库中召回相关的表结构信息

**输入**: `query_intent`, `extracted_entities`

**输出**: `schema_text`, `relevant_tables`

**策略**:
- 不再全量注入所有表结构，而是根据意图动态构建
- 对 `data_query`: 注入 `weather_data` + `station_info` 的完整结构 + 字段含义
- 对 `meta_query`: 注入 `weather_directory` 的结构
- 附带数据样本（每个字段取 3 个示例值）

**Prompt 设计**:

```
根据用户意图和相关实体，生成精简的数据库结构描述。

## 表结构
{动态注入的 CREATE TABLE 语句}

## 字段含义映射
| 字段名 | 中文名 | 单位 | 示例值 |
|--------|--------|------|--------|
{动态生成}

## 关联关系
- weather_data.station_code = station_info.station_code
- weather_data.granularity = station_info.granularity
- 过滤地区时使用 station_info.city 或 station_info.province

## 注意事项
- granularity = 2 表示小时级数据
- record_time 格式为 DATETIME
```

### 5.3 SqlGeneratorNode — SQL 生成

**职责**: 根据用户意图和 Schema 生成 SQL

**输入**: `extracted_entities`, `schema_text`, `rewritten_query`

**输出**: `generated_sql`

**Prompt 设计**:

```
你是一位精通 MySQL 的高级数据工程师。根据以下信息生成一条准确的 SELECT 查询。

## 规范化查询
{rewritten_query}

## 数据库结构
{schema_text}

## 约束规则
1. 只能生成 SELECT 语句，禁止任何写操作
2. 所有表名和字段名必须存在于上述 Schema 中
3. 地区过滤使用 station_info.city 或 station_info.province
4. 小时级数据需加 WHERE granularity = 2
5. 时间过滤使用 record_time BETWEEN 'start' AND 'end'
6. 聚合查询必须 GROUP BY，排序查询必须 ORDER BY
7. 表别名: weather_data → wd, station_info → si, weather_directory → wdir
8. 所有标识符使用反引号转义

## 输出
仅输出 SQL 语句，不要任何其他内容。
```

### 5.4 SqlValidatorNode — SQL 校验

**职责**: 安全性 + 语法检查（不依赖 LLM，纯代码逻辑）

**输入**: `generated_sql`

**输出**: `sql_validation`

**校验规则**:
```python
def validate_sql(sql: str) -> dict:
    issues = []

    # 1. 只允许 SELECT
    forbidden = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER',
                 'CREATE', 'TRUNCATE', 'REPLACE', 'GRANT', 'REVOKE']
    sql_upper = sql.upper()
    for keyword in forbidden:
        if keyword in sql_upper:
            issues.append(f"禁止使用 {keyword} 语句")

    # 2. 禁止子查询中的写操作
    if 'EXEC' in sql_upper or 'EXECUTE' in sql_upper:
        issues.append("禁止 EXEC/EXECUTE")

    # 3. 禁止 INTO OUTFILE / LOAD_FILE
    if 'INTO OUTFILE' in sql_upper or 'LOAD_FILE' in sql_upper:
        issues.append("禁止文件操作")

    # 4. 表名白名单
    allowed_tables = {'weather_data', 'station_info', 'weather_directory'}
    # 用正则提取 FROM/JOIN 后的表名，检查是否在白名单中

    # 5. 基础语法检查（括号匹配、分号处理）

    return {
        "is_valid": len(issues) == 0,
        "issues": issues
    }
```

### 5.5 SqlExecutorNode — SQL 执行

**职责**: 在 MySQL 上执行 SQL，返回结果

**输入**: `generated_sql`

**输出**: `execution_result` 或 `sql_error`

**安全措施**:
- 使用只读数据库用户（仅 SELECT 权限）
- 设置查询超时（30 秒）
- 限制返回行数（最多 1000 行）
- 连接池复用

### 5.6 SqlFixerNode — SQL 自动修复

**职责**: 根据错误信息修复 SQL

**输入**: `generated_sql`, `sql_error`, `schema_text`, `retry_count`

**输出**: `generated_sql`（修复后）

**触发条件**: `sql_error is not None AND retry_count < 3`

**Prompt 设计**:

```
你是一位 MySQL 调试专家。以下 SQL 执行出错，请修复它。

## 原始 SQL
{generated_sql}

## 错误信息
{sql_error}

## 数据库结构
{schema_text}

## 修复规则
1. 仔细分析错误原因
2. 确保所有字段名、表名存在于 Schema 中
3. 检查 JOIN 条件、GROUP BY、聚合函数
4. 仍然只能生成 SELECT

仅输出修复后的 SQL。
```

### 5.7 ResultAnalyzerNode — 结果分析

**职责**: 分析查询结果，决定最佳可视化方式

**输入**: `execution_result`, `extracted_entities`, `user_query`

**输出**: `chart_type`, `answer`（初步）

**Prompt 设计**:

```
你是气象数据分析专家。根据查询结果，分析数据特征并决定最佳可视化方式。

## 查询结果
- 列: {columns}
- 行数: {row_count}
- 数据样本: {sample_rows}

## 图表选择规则
| 数据特征 | 推荐图表 | chart_type |
|----------|---------|------------|
| 时间序列 + 1个指标 | 折线图 | "line" |
| 分类对比 (<=10 类) | 柱状图 | "bar" |
| 占比分布 | 饼图 | "pie" |
| 多指标对比 | 分组柱状图 | "bar" |
| 大量明细数据 | 表格 | "table" |
| 单值结果 | 文字描述 | null |

## 输出 (严格 JSON)
{
  "chart_type": "line|bar|pie|table|null",
  "chart_title": "图表标题",
  "x_axis_field": "X轴对应的列名",
  "y_axis_fields": ["Y轴对应的列名列表"],
  "data_summary": "一句话数据摘要",
  "key_insights": ["关键发现1", "关键发现2"]
}
```

### 5.8 ChartGeneratorNode — 图表配置生成

**职责**: 基于分析结果，生成完整的 ECharts option JSON

**输入**: `execution_result`, `chart_type`, `extracted_entities`

**输出**: `chart_config`

**策略**: 这个节点**不依赖 LLM**，用纯代码逻辑生成 ECharts 配置：

```python
def generate_chart_config(result, chart_type, analysis):
    columns = result["columns"]
    rows = result["rows"]

    if chart_type == "line":
        return {
            "title": {"text": analysis["chart_title"]},
            "tooltip": {"trigger": "axis"},
            "xAxis": {
                "type": "category",
                "data": [row[analysis["x_axis_field"]] for row in rows]
            },
            "yAxis": {"type": "value", "name": columns[1]},
            "series": [{
                "type": "line",
                "name": analysis["y_axis_fields"][0],
                "data": [row[f] for f in analysis["y_axis_fields"] for row in rows],
                "smooth": True
            }]
        }
    elif chart_type == "bar":
        # ... 类似结构
    elif chart_type == "pie":
        # ... 类似结构
    # table 类型不需要 chart_config
```

### 5.9 AnswerComposerNode — 回答组合

**职责**: 组合最终 API 响应

**输入**: 所有 state 字段

**输出**: 最终结构化响应

---

## 6. API 接口设计

### 6.1 同步查询

```
POST /api/v2/query
Content-Type: application/json

{
  "query": "敦煌近三个月的平均温度变化趋势",
  "session_id": "abc-123",
  "history": []
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "answer": "敦煌近三个月（2026年1月-3月）平均温度呈上升趋势，从1月的-8.2°C升至3月的5.6°C...",
    "sql": "SELECT DATE_FORMAT(wd.record_time, '%Y-%m') AS month, ROUND(AVG(wd.avg_temperature), 1) AS avg_temp FROM weather_data wd JOIN station_info si ON ...",
    "table": {
      "columns": ["month", "avg_temp"],
      "rows": [
        {"month": "2026-01", "avg_temp": -8.2},
        {"month": "2026-02", "avg_temp": -2.1},
        {"month": "2026-03", "avg_temp": 5.6}
      ],
      "row_count": 3
    },
    "chart": {
      "type": "line",
      "config": {
        "title": {"text": "敦煌近三个月平均温度趋势"},
        "tooltip": {"trigger": "axis"},
        "xAxis": {"type": "category", "data": ["2026-01", "2026-02", "2026-03"]},
        "yAxis": {"type": "value", "name": "平均温度 (°C)"},
        "series": [{"type": "line", "name": "平均温度", "data": [-8.2, -2.1, 5.6], "smooth": true}]
      }
    },
    "diagnostics": [
      {"node": "query_analyzer", "intent": "data_query", "entities": {"city": "敦煌", "metric": "avg_temperature"}},
      {"node": "sql_generator", "retry_count": 0}
    ]
  }
}
```

### 6.2 流式查询（SSE）

```
POST /api/v2/query/stream
Content-Type: application/json

{
  "query": "敦煌近三个月的平均温度变化趋势",
  "session_id": "abc-123"
}
```

**SSE 事件流**:
```
event: thinking
data: {"node": "query_analyzer", "message": "正在分析问题意图..."}

event: thinking
data: {"node": "schema_retriever", "message": "正在获取相关表结构..."}

event: sql
data: {"sql": "SELECT DATE_FORMAT(...)..."}

event: thinking
data: {"node": "sql_executor", "message": "正在执行查询..."}

event: table
data: {"columns": ["month", "avg_temp"], "rows": [...]}

event: chart
data: {"type": "line", "config": {...}}

event: text
data: {"chunk": "敦煌近三个月"}

event: text
data: {"chunk": "平均温度呈上升趋势"}

event: text
data: {"chunk": "，从1月的-8.2°C..."}

event: done
data: {"session_id": "abc-123"}
```

### 6.3 获取可用 Schema（给前端/调试用）

```
GET /api/v2/schema
```

**响应**:
```json
{
  "tables": [
    {
      "name": "weather_data",
      "description": "统一气象事实表（小时级）",
      "columns": [
        {"name": "station_code", "type": "VARCHAR(50)", "description": "站点编码"},
        {"name": "avg_temperature", "type": "DECIMAL(7,2)", "description": "平均温度(°C)"},
        ...
      ]
    },
    ...
  ]
}
```

### 6.4 健康检查

```
GET /api/v2/health
```

---

## 7. 与前端对接协议

前端 WeatherVisualization 已有 `<v-chart>` 组件（vue-echarts），因此后端返回的 `chart.config` 可以直接传给 `<v-chart :option="chart.config">`。

**前端对接示例（伪代码）**:

```vue
<template>
  <div>
    <!-- 回答文本 -->
    <p>{{ response.answer }}</p>

    <!-- 图表 -->
    <v-chart
      v-if="response.chart?.config"
      :option="response.chart.config"
      autoresize
    />

    <!-- 数据表格 -->
    <el-table
      v-if="response.table"
      :data="response.table.rows"
      :columns="response.table.columns"
    />
  </div>
</template>
```

**后端保证**:
- `chart.config` 是合法的 ECharts option 对象
- `table.rows` 是对象数组，key 对应 `table.columns`
- `chart.type` 与 `chart.config` 中的 series.type 一致

---

## 8. 错误处理策略

| 场景 | 处理 |
|------|------|
| 意图为 chitchat | 直接返回友好提示，不生成 SQL |
| 意图为 meta_query | 查询 weather_directory 返回数据概览 |
| SQL 执行错误 | 进入 sql_fixer 修复，最多重试 3 次 |
| 3 次修复仍失败 | 返回错误说明 + 最后一次 SQL + 错误详情 |
| 查询超时 (>30s) | 终止查询，建议缩小时间范围 |
| LLM 返回非法 JSON | 解析容错，使用 fallback prompt 重试 1 次 |
| 结果为空 | 返回空状态提示 + 可能的原因分析 |

---

## 9. 项目目录结构

```
services/sql-agent-v2/
├── data-agent-tutorial/          # 参考项目（已存在）
├── app/
│   ├── __init__.py
│   ├── main.py                   # FastAPI 入口
│   ├── config.py                 # 配置（env 读取）
│   ├── graph/
│   │   ├── __init__.py
│   │   ├── state.py              # AgentState 定义
│   │   ├── builder.py            # 构建 LangGraph 图
│   │   └── nodes/
│   │       ├── __init__.py
│   │       ├── query_analyzer.py
│   │       ├── schema_retriever.py
│   │       ├── sql_generator.py
│   │       ├── sql_validator.py
│   │       ├── sql_executor.py
│   │       ├── sql_fixer.py
│   │       ├── result_analyzer.py
│   │       ├── chart_generator.py
│   │       └── answer_composer.py
│   ├── prompts/
│   │   ├── query_analyzer.py     # Prompt 模板
│   │   ├── schema_retriever.py
│   │   ├── sql_generator.py
│   │   ├── sql_fixer.py
│   │   └── result_analyzer.py
│   ├── models/
│   │   ├── __init__.py
│   │   └── schemas.py            # Pydantic 请求/响应模型
│   ├── services/
│   │   ├── __init__.py
│   │   ├── llm.py                # ChatModel 初始化
│   │   ├── database.py           # MySQL 连接池
│   │   └── schema_service.py     # Schema 元数据管理
│   └── utils/
│       ├── __init__.py
│       ├── sql_safety.py         # SQL 安全检查
│       └── chart_builder.py      # ECharts 配置生成器
├── tests/
│   ├── test_graph.py
│   ├── test_sql_safety.py
│   └── test_api.py
├── .env.example
├── requirements.txt
├── Dockerfile
└── docker-compose.yml
```

---

## 10. 依赖清单

```
# requirements.txt
fastapi>=0.110
uvicorn[standard]>=0.29
langchain>=0.3
langchain-openai>=0.3
langgraph>=0.3
pymysql>=1.1
cryptography>=42.0
pydantic>=2.0
python-dotenv>=1.0
sqlalchemy>=2.0
sse-starlette>=2.0
```

---

## 11. 环境变量

```env
# .env.example

# LLM 配置（兼容 OpenAI API 的模型）
LLM_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
LLM_API_KEY=sk-xxx
LLM_MODEL=qwen-plus
LLM_TEMPERATURE=0.1

# MySQL 配置
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=root
MYSQL_DATABASE=dunhuang_agent

# 服务配置
SERVER_PORT=3001
SQL_TIMEOUT_SECONDS=30
MAX_RESULT_ROWS=1000
MAX_SQL_RETRIES=3
```

---

## 12. Docker 部署

```dockerfile
# Dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 3001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3001"]
```

在 `services/docker-compose.yml` 中新增:

```yaml
sql-agent-v2:
  build: ./sql-agent-v2
  ports:
    - "3002:3001"
  environment:
    - MYSQL_HOST=mysql
    - MYSQL_PORT=3306
    - MYSQL_USER=root
    - MYSQL_PASSWORD=root
    - MYSQL_DATABASE=dunhuang_agent
    - LLM_BASE_URL=${LLM_BASE_URL}
    - LLM_API_KEY=${LLM_API_KEY}
    - LLM_MODEL=${LLM_MODEL}
  depends_on:
    mysql:
      condition: service_healthy
  restart: unless-stopped
```
