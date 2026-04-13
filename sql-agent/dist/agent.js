"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgent = runAgent;
const openai_1 = __importDefault(require("openai"));
const dotenv = __importStar(require("dotenv"));
// 引入我们刚刚打造的工具箱
const tools_1 = require("./tools");
// 引入上下文管理器（短期记忆）
const memory_1 = require("./memory");
// 引入日志记录器
const logger_1 = require("./logger");
dotenv.config();
const client = new openai_1.default({
    apiKey: process.env.QWEN_API_KEY,
    baseURL: process.env.QWEN_BASE_URL,
});
// ==========================================
// 1. 定义发给大模型的"工具说明书"
// ==========================================
const tools = [
    {
        type: "function",
        function: {
            name: "getDatabaseSchema",
            description: "获取当前系统的所有数据库表结构、字段名和类型。在编写 SQL 语句之前，必须先调用此工具了解表结构。",
            parameters: { type: "object", properties: {} } // 无需参数
        }
    },
    {
        type: "function",
        function: {
            name: "executeSQL",
            description: "在 MySQL 数据库中执行 SQL 查询语句，并返回查询结果的 JSON 数据。",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "需要执行的纯正 SQL 语句。例如：SELECT * FROM sys_menu LIMIT 5;"
                    }
                },
                required: ["query"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "generateChartConfig",
            description: "根据数据生成图表配置。当用户要求绘制图表、可视化数据、显示趋势、对比、分布时调用此工具。",
            parameters: {
                type: "object",
                properties: {
                    chartType: {
                        type: "string",
                        enum: ["bar", "line", "pie", "area", "scatter", "radar"],
                        description: "图表类型：bar=柱状图（类别对比），line=折线图（时间趋势），pie=饼图（占比分布），area=面积图（累积趋势），scatter=散点图（关系分布），radar=雷达图（多维度对比）"
                    },
                    xAxisField: {
                        type: "string",
                        description: "X 轴字段名（如日期、类别名称）。饼图中为名称字段。"
                    },
                    yAxisField: {
                        type: "string",
                        description: "Y 轴字段名（如数值、数量）。饼图中为数值字段。"
                    }
                },
                required: ["chartType"]
            }
        }
    }
];
// ==========================================
// 2. 核心：Agent 思考与行动循环 (ReAct Loop)
// ==========================================
let lastSQLData = null;
let executedSQLs = []; // 记录执行过的 SQL 语句
// 当前对话的工具调用历史（不保存到上下文，只用于当前循环）
let currentToolCalls = [];
/**
 * 发送 SSE 消息的辅助函数
 */
function sendSSEMessage(res, message) {
    const data = JSON.stringify(message);
    res.write(`data: ${data}\n\n`);
}
/**
 * 运行 Agent（支持多轮对话）
 * @param userQuestion 用户问题
 * @param onSQLResult SQL 查询结果回调
 * @param onChartResult 图表配置回调
 * @param onSQLExecuted SQL 执行回调
 * @param useContext 是否使用上下文（多轮对话）
 * @param onThinking 思考过程回调（流式）
 * @param onToolStart 工具调用开始回调（流式）
 * @param onToolResult 工具调用结果回调（流式）
 * @param onTextStream 文本流式回调（逐字输出）
 */
async function runAgent(userQuestion, onSQLResult, onChartResult, onSQLExecuted, useContext = true, onThinking, onToolStart, onToolResult, onTextStream) {
    logger_1.logger.info('👨‍💻 用户提问', { question: userQuestion, useContext });
    console.log(`\n👨‍💻 用户提问：${userQuestion}`);
    console.log("----------------------------------------");
    // 获取全局上下文管理器
    const context = (0, memory_1.getGlobalContext)();
    // 如果不需要上下文，先重置
    if (!useContext) {
        logger_1.logger.info('重置上下文');
        (0, memory_1.resetGlobalContext)();
    }
    // 重置 SQL 数据和执行记录
    lastSQLData = null;
    executedSQLs = [];
    currentToolCalls = [];
    // 将用户问题添加到上下文（只保存文字）
    context.addUserMessage(userQuestion);
    // 开启无限循环，直到大模型认为任务完成
    while (true) {
        console.log("🧠 大脑正在思考中...");
        // 从上下文获取完整消息历史
        const messages = context.getMessages();
        // 添加当前工具调用的历史（临时，不保存到上下文）
        const messagesWithTools = [...messages, ...currentToolCalls];
        logger_1.logger.debug('呼叫大模型 API', {
            model: 'qwen3.6-plus',
            messageCount: messagesWithTools.length,
            toolCount: tools.length
        });
        // 呼叫大模型，并把工具说明书带上
        const response = await client.chat.completions.create({
            model: "qwen3.6-plus",
            messages: messagesWithTools,
            tools: tools,
            temperature: 0.1, // 温度调低，让它的逻辑更严谨
        });
        const responseMessage = response.choices[0].message;
        // 情况 A：大模型觉得不需要用工具了，直接给出了最终答案
        if (!responseMessage.tool_calls || responseMessage.tool_calls.length === 0) {
            logger_1.logger.info('💡 大模型返回最终答案', {
                contentLength: responseMessage.content?.length || 0,
                content: responseMessage.content?.substring(0, 500)
            });
            console.log("\n💡 敦煌智能体最终回复：");
            console.log(responseMessage.content);
            // 只将最终的文字回复添加到上下文（不保存工具调用和结果）
            context.addAssistantMessage(responseMessage.content || '');
            // 流式发送最终文本（逐字输出效果）
            if (onTextStream && responseMessage.content) {
                // 模拟逐字输出效果，每个字符延迟发送
                const content = responseMessage.content;
                for (let i = 0; i < content.length; i++) {
                    await new Promise(resolve => setTimeout(resolve, 20)); // 20ms 延迟
                    onTextStream(content[i]);
                }
            }
            return responseMessage.content; // 任务完成，返回答案
        }
        // 情况 B：大模型决定要使用工具
        logger_1.logger.info('🔧 大模型调用工具', {
            toolCalls: responseMessage.tool_calls.map(tc => {
                const fn = tc;
                return {
                    name: fn.function?.name || fn.name,
                    arguments: fn.function?.arguments?.substring(0, 200) || fn.arguments || ''
                };
            })
        });
        // 发送工具调用开始消息（流式）
        for (const toolCall of responseMessage.tool_calls) {
            if (toolCall.type !== 'function')
                continue;
            const tcAny = toolCall;
            const functionName = tcAny.function?.name || tcAny.name;
            const functionArgs = JSON.parse(tcAny.function?.arguments || tcAny.arguments || '{}');
            // 发送工具调用开始消息
            if (onToolStart) {
                onToolStart(functionName, functionArgs);
            }
        }
        // 将工具调用添加到临时历史（用于当前循环，不保存到上下文）
        currentToolCalls.push(responseMessage);
        // 遍历大模型想要调用的所有工具
        for (const toolCall of responseMessage.tool_calls) {
            // 类型断言：我们只处理 function 类型的 tool call
            if (toolCall.type !== 'function')
                continue;
            const tcAny = toolCall;
            const functionName = tcAny.function?.name || tcAny.name;
            const functionArgs = JSON.parse(tcAny.function?.arguments || tcAny.arguments || '{}');
            let functionResult = "";
            // 我们的本地代码拦截调用，并执行真实的 TS 函数
            if (functionName === 'getDatabaseSchema') {
                logger_1.logger.tool('调用工具：getDatabaseSchema');
                functionResult = (0, tools_1.getDatabaseSchema)();
                // 发送思考过程：获取表结构
                if (onThinking) {
                    onThinking(`正在获取数据库表结构...`);
                }
                // 发送工具结果消息
                if (onToolResult) {
                    onToolResult(functionName, { success: true, rowCount: functionResult.length });
                }
            }
            else if (functionName === 'executeSQL') {
                const sqlQuery = functionArgs.query;
                logger_1.logger.tool('调用工具：executeSQL', { sql: sqlQuery });
                // 记录执行的 SQL
                executedSQLs.push(sqlQuery);
                // 回调通知 server
                if (onSQLExecuted) {
                    onSQLExecuted(sqlQuery);
                }
                // 发送思考过程：执行 SQL
                if (onThinking) {
                    onThinking(`正在执行 SQL 查询...`);
                }
                const result = await (0, tools_1.executeSQLWithCallback)(sqlQuery);
                functionResult = result.text;
                // 通过回调传递原始数据给 server
                lastSQLData = result.data;
                if (onSQLResult && result.data) {
                    onSQLResult(result.data);
                }
                // 发送工具结果消息
                if (onToolResult) {
                    onToolResult(functionName, { success: true, rowCount: result.data?.length || 0 });
                }
                logger_1.logger.tool('SQL 执行结果', {
                    resultLength: result.text.length,
                    rowCount: result.data?.length || 0
                });
            }
            else if (functionName === 'generateChartConfig') {
                // 使用上一次的 SQL 查询结果生成图表
                const chartType = functionArgs.chartType;
                const xAxisField = functionArgs.xAxisField;
                const yAxisField = functionArgs.yAxisField;
                logger_1.logger.tool('调用工具：generateChartConfig', {
                    chartType,
                    xAxisField,
                    yAxisField,
                    dataCount: lastSQLData?.length || 0
                });
                // 发送思考过程：生成图表
                if (onThinking) {
                    onThinking(`正在生成 ${chartType} 图表配置...`);
                }
                // 优先使用上次查询的数据
                const dataToUse = lastSQLData || [];
                functionResult = (0, tools_1.generateChartConfig)(dataToUse, chartType, xAxisField, yAxisField);
                // 通过回调传递图表配置给 server
                if (onChartResult) {
                    onChartResult(functionResult);
                }
                // 发送工具结果消息
                if (onToolResult) {
                    onToolResult(functionName, { success: true, chartType });
                }
                logger_1.logger.tool('图表配置生成完成', { configLength: functionResult.length });
            }
            // 将工具执行结果添加到临时历史（不保存到上下文）
            currentToolCalls.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: functionResult,
            });
            logger_1.logger.debug('添加临时工具结果', {
                toolCallId: toolCall.id,
                resultLength: functionResult.length
            });
        }
        // 循环继续，带着工具的结果再去问大模型："接下来呢？"
        logger_1.logger.debug('继续循环，等待大模型下一步指令');
    }
}
