# 敦煌智能体 - SQL 查询助手

一个基于大语言模型的数据库查询智能体，支持自然语言查询数据库。

## 功能特性

- 自然语言转 SQL 查询
- 自动获取数据库表结构
- 安全执行 SQL 并返回结果
- 前后端分离架构
- 简洁美观的 Web 聊天界面
- **思考过程展示** - 模型输出解题思路和推理过程
- **SQL 命令展示** - 完整展示执行的 SQL 语句，支持一键复制
- **Markdown 渲染** - 支持格式化输出、代码块、列表等
- **图表可视化** - 支持 6 种图表类型（柱状图、折线图、饼图、面积图、散点图、雷达图）

## 技术栈

### 后端
- TypeScript + Node.js
- Express 5.x 服务器
- OpenAI SDK (兼容 Qwen API)
- MySQL / MySQL2

### 前端
- 原生 HTML + CSS + JavaScript
- 渐变色 UI 设计
- 实时聊天交互

## 项目结构

```
sql-agent/
├── src/
│   ├── server.ts      # Express 服务器，提供 API 和静态文件
│   ├── agent.ts       # Agent 核心逻辑，ReAct 循环
│   └── tools.ts       # 工具箱（获取表结构、执行 SQL）
├── public/
│   └── index.html     # 前端聊天页面
├── tsconfig.json      # TypeScript 配置
└── package.json
```

## 快速开始

### 1. 配置环境变量

创建 `.env` 文件：

```env
QWEN_API_KEY=your_api_key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

### 2. 安装依赖

```bash
npm install
```

### 3. 启动服务器

**方法一：直接启动**
```bash
npx ts-node src/server.ts
```

**方法二：使用管理脚本（推荐）**

Windows (CMD):
```bash
server.bat start    # 启动服务
server.bat stop     # 停止服务
server.bat restart  # 重启服务
server.bat status   # 查看状态
```

或者运行交互式菜单：
```bash
server.bat
```

### 4. 访问前端

打开浏览器访问：**http://localhost:3001**

## API 接口

### POST /api/chat

发送消息给智能体。

**请求体：**
```json
{
  "message": "查询数据库中有哪些表"
}
```

**响应：**
```json
{
  "success": true,
  "text": "智能体的回复内容（支持 Markdown 格式）",
  "table": {
    "columns": ["列 1", "列 2", ...],
    "rows": [["值 1", "值 2", ...], ...]
  },
  "chart": { /* ECharts 图表配置 */ },
  "sql": ["SELECT * FROM table LIMIT 10;"] // 执行的 SQL 语句列表
}
```

## 服务管理

### Windows (CMD)

```bash
server.bat start    # 启动服务
server.bat stop     # 停止服务
server.bat restart  # 重启服务
server.bat status   # 查看状态
```

或者运行交互式菜单：
```bash
server.bat
```

### 使用 npm 脚本

```bash
npm run server:start    # 启动服务
npm run server:stop     # 停止服务
npm run server:restart  # 重启服务
npm run server:status   # 查看状态
```

### Linux / macOS

```bash
./server.sh start    # 启动服务
./server.sh stop     # 停止服务
./server.sh restart  # 重启服务
./server.sh status   # 查看状态
```

## 核心功能说明

### Agent 工作流程 (ReAct Loop)

1. 用户输入自然语言问题
2. Agent 分析问题，决定是否需要调用工具
3. 如需查询表结构 → 调用 `getDatabaseSchema()`
4. 如需执行 SQL → 调用 `executeSQLWithCallback(query)`，同时记录 SQL 语句
5. 如需绘制图表 → 调用 `generateChartConfig()`
6. 将工具执行结果返回给大模型
7. 大模型生成最终回复（包含思考过程、SQL 展示、结论）
8. 后端将结构化数据、图表配置和 SQL 语句列表附加到响应中

### 可用工具

| 工具名 | 描述 |
|--------|------|
| getDatabaseSchema | 获取所有数据库表结构、字段名和类型 |
| executeSQLWithCallback | 在 MySQL 数据库中执行 SQL 查询，并返回原始数据用于表格渲染 |
| generateChartConfig | 根据数据生成 ECharts 图表配置（JSON 格式） |

### 支持的图表类型

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| bar | 柱状图 | 类别数据对比 |
| line | 折线图 | 时间序列趋势 |
| pie | 饼图 | 占比分布 |
| area | 面积图 | 累积趋势 |
| scatter | 散点图 | 变量关系分布 |
| radar | 雷达图 | 多维度对比 |

### 示例用法

**表格查询：**
```
"查询 dunhuang 表前 10 条数据"
"查看最近的天气记录"
```

**图表展示：**
```
"绘制最近 10 天的气温变化折线图"
"显示各月份降水量的柱状图"
"展示不同风向的占比饼图"
```

### 思考过程与 SQL 展示

模型在回答时会按照以下结构输出：

1. **📋 思考过程** - 分析问题和解题思路
2. **🔍 执行的 SQL** - 展示完整 SQL 语句（支持一键复制）
3. **📊 查询结果** - 表格或图表展示
4. **💡 结论或建议** - 对结果的解读

**示例：**
```
"查询各部门的员工数量和平均工资"
```

**输出示例：**
```
📋 思考过程
- 需要查询 employees 表
- 按 department 字段分组
- 计算每组的 count 和 avg(salary)

🔍 执行的 SQL
┌─────────────────────────────────────┐
│ SELECT department, COUNT(*) as cnt, │
│        AVG(salary) as avg_sal       │
│ FROM employees GROUP BY department  │
└─────────────────────────────────────┘
[复制按钮]

📊 查询结果
[表格或图表]

💡 结论
技术部员工最多，平均工资也最高...
```

---

## 开发说明

- 服务器默认运行在 `http://localhost:3001`（可通过 `PORT` 环境变量覆盖）
- API 接口：`/api/chat`
- 静态文件服务：`/` 直接返回前端页面
