"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const agent_1 = require("./agent");
const memory_1 = require("./memory");
const logger_1 = require("./logger");
const types_1 = require("./types");
const app = (0, express_1.default)();
const PORT = 3000;
// 使用绝对路径
const PUBLIC_PATH = path_1.default.resolve(__dirname, '../public');
console.log('Static files path:', PUBLIC_PATH);
// 创建 API router
const apiRouter = express_1.default.Router();
// 定义一个 POST 接口：/api/chat - 传统非流式接口（保持兼容）
apiRouter.post('/chat', async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage) {
            res.status(400).json({ error: "提问不能为空！" });
            return;
        }
        console.log(`[HTTP 请求到达] 正在呼叫敦煌智能体...`);
        // 用于存储 SQL 查询结果、图表配置和执行的 SQL 语句
        let sqlData = null;
        let chartConfig = null;
        let executedSQLs = [];
        // 调用我们的 Agent 核心逻辑（传入回调来捕获 SQL 结果、图表配置和 SQL 语句）
        const agentReply = await (0, agent_1.runAgent)(userMessage, (data) => {
            sqlData = data;
        }, (config) => {
            chartConfig = config;
        }, (sql) => {
            executedSQLs.push(sql);
        }, true // 使用上下文（多轮对话）
        );
        // 如果有 SQL 查询结果，生成表格数据
        let tableData = null;
        if (sqlData && sqlData.length > 0) {
            const columns = Object.keys(sqlData[0]);
            const rows = sqlData.map((row) => columns.map((col) => row[col]));
            tableData = { columns, rows };
        }
        // 解析图表配置
        let chartData = null;
        if (chartConfig) {
            try {
                chartData = JSON.parse(chartConfig);
            }
            catch (e) {
                console.error('解析图表配置失败:', e);
            }
        }
        // 获取上下文统计信息
        const context = (0, memory_1.getGlobalContext)();
        const stats = context.getStats();
        // 把 Agent 的回答打包成 JSON，吐给前端
        res.json({
            success: true,
            text: agentReply,
            table: tableData,
            chart: chartData,
            sql: executedSQLs, // 添加执行的 SQL 语句列表
            context: {
                conversationRounds: stats.conversationRounds,
                estimatedTokens: stats.estimatedTokens
            }
        });
    }
    catch (error) {
        console.error("[服务器异常]", error);
        res.status(500).json({ success: false, error: "智能体大脑宕机了" });
    }
});
// ==========================================
// SSE 流式接口：/api/chat/stream
// ==========================================
apiRouter.post('/chat/stream', async (req, res) => {
    try {
        const userMessage = req.body.message;
        if (!userMessage) {
            res.status(400).json({ error: "提问不能为空！" });
            return;
        }
        console.log(`[SSE 流式请求] 用户提问：${userMessage}`);
        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲
        // 发送消息辅助函数
        const sendSSEMessage = (message) => {
            const data = JSON.stringify(message);
            res.write(`data: ${data}\n\n`);
        };
        // 用于累积数据
        let sqlData = null;
        let chartConfig = null;
        let executedSQLs = [];
        let accumulatedText = '';
        // 发送思考过程消息
        const onThinking = (content) => {
            sendSSEMessage({
                type: types_1.SSEMessageType.THINKING,
                content,
                timestamp: Date.now()
            });
        };
        // 发送工具调用开始消息
        const onToolStart = (name, args) => {
            sendSSEMessage({
                type: types_1.SSEMessageType.TOOL_START,
                name,
                args,
                timestamp: Date.now()
            });
        };
        // 发送工具调用结果消息
        const onToolResult = (name, result) => {
            sendSSEMessage({
                type: types_1.SSEMessageType.TOOL_RESULT,
                name,
                result,
                timestamp: Date.now()
            });
        };
        // 发送流式文本
        const onTextStream = (text) => {
            accumulatedText += text;
            sendSSEMessage({
                type: types_1.SSEMessageType.TEXT,
                content: text,
                isStreaming: true,
                timestamp: Date.now()
            });
        };
        // 调用 Agent（传入流式回调）
        await (0, agent_1.runAgent)(userMessage, 
        // SQL 结果回调 - 发送表格数据
        (data) => {
            sqlData = data;
            if (data && data.length > 0) {
                const columns = Object.keys(data[0]);
                const rows = data.map((row) => columns.map((col) => row[col]));
                sendSSEMessage({
                    type: types_1.SSEMessageType.TABLE,
                    columns,
                    rows,
                    timestamp: Date.now()
                });
            }
        }, 
        // 图表配置回调 - 发送图表数据
        (config) => {
            chartConfig = config;
            try {
                const chartData = JSON.parse(config);
                sendSSEMessage({
                    type: types_1.SSEMessageType.CHART,
                    config: chartData,
                    timestamp: Date.now()
                });
            }
            catch (e) {
                console.error('解析图表配置失败:', e);
            }
        }, 
        // SQL 执行回调 - 发送 SQL 语句
        (sql) => {
            executedSQLs.push(sql);
            sendSSEMessage({
                type: types_1.SSEMessageType.SQL,
                sql,
                timestamp: Date.now()
            });
        }, true, // 使用上下文
        onThinking, onToolStart, onToolResult, onTextStream);
        // 发送完成信号
        const context = (0, memory_1.getGlobalContext)();
        const stats = context.getStats();
        sendSSEMessage({
            type: types_1.SSEMessageType.DONE,
            context: {
                conversationRounds: stats.conversationRounds,
                estimatedTokens: stats.estimatedTokens
            },
            timestamp: Date.now()
        });
        // 结束 SSE 流
        res.write('data: [DONE]\n\n');
        res.end();
        console.log(`[SSE 流式完成] 累积文本长度：${accumulatedText.length}`);
    }
    catch (error) {
        console.error("[SSE 服务器异常]", error);
        // 发送错误消息
        const sendSSEMessage = (message) => {
            const data = JSON.stringify(message);
            res.write(`data: ${data}\n\n`);
        };
        sendSSEMessage({
            type: types_1.SSEMessageType.ERROR,
            message: error.message || '服务器内部错误',
            timestamp: Date.now()
        });
        res.write('data: [DONE]\n\n');
        res.end();
    }
});
// 定义一个 POST 接口：/api/reset - 重置对话上下文（同时清空日志）
apiRouter.post('/reset', (_req, res) => {
    (0, memory_1.resetGlobalContext)();
    logger_1.logger.clear();
    console.log('[上下文] 对话历史已重置，日志已清空');
    res.json({ success: true, message: '对话和日志已重置' });
});
// 定义一个 GET 接口：/api/context - 获取当前上下文状态
apiRouter.get('/context', (_req, res) => {
    const context = (0, memory_1.getGlobalContext)();
    const stats = context.getStats();
    res.json({
        success: true,
        data: stats
    });
});
// 定义一个 POST 接口：/api/clear-log - 清空日志文件
apiRouter.post('/clear-log', (_req, res) => {
    logger_1.logger.clear();
    console.log('[日志] 日志文件已清空');
    res.json({ success: true, message: '日志已清空' });
});
// 开启跨域允许，并让服务器能读懂 JSON 格式的数据
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// 挂载 API 路由
app.use('/api', apiRouter);
// 提供静态文件服务（前端页面）
app.use(express_1.default.static(PUBLIC_PATH));
// 根路径直接返回前端页面
app.get('/', (_req, res) => {
    console.log('Root path accessed, sending file:', path_1.default.join(PUBLIC_PATH, 'index.html'));
    res.sendFile(path_1.default.join(PUBLIC_PATH, 'index.html'));
});
// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 敦煌 Agent 服务器已启动！`);
    console.log(`👉 请让若依前端向 http://localhost:${PORT}/api/chat 发送 POST 请求`);
});
