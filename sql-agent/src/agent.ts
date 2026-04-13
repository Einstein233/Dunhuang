import OpenAI from 'openai';
import * as dotenv from 'dotenv';
// 引入我们刚刚打造的工具箱
import { getDatabaseSchema, executeSQLWithCallback, generateChartConfig, type ChartType } from './tools';
// 引入上下文管理器（短期记忆）
import { getGlobalContext, resetGlobalContext } from './memory';
// 引入日志记录器
import { logger } from './logger';
// 引入 SSE 消息类型
import { SSEMessageType, type AnySSEMessage } from './types';

dotenv.config();

const client = new OpenAI({
  apiKey: process.env.QWEN_API_KEY,
  baseURL: process.env.QWEN_BASE_URL,
});

// ==========================================
// 1. 定义发给大模型的"工具说明书"
// ==========================================
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "getDatabaseSchema",
      description: "[核心探查技能] 获取当前系统的所有数据库物理表结构、字段名和数据类型。当用户提出新的数据查询需求时，【必须】第一时间调用此工具了解底层结构。绝对禁止在未调用此工具的情况下凭空捏造表名和字段！",
      parameters: { type: "object", properties: {} } // 无需参数
    }
  },
  {
    type: "function",
    function: {
      name: "executeSQL",
      description: "[核心执行技能] 在只读沙箱中执行 MySQL 查询语句，提取客观数据。\n 【安全约束】：生成的 SQL 必须极其严谨，且只允许使用 SELECT 语句。严禁生成任何修改或破坏性指令。\n【自愈机制】：如果返回结果提示 SQL 报错或【系统安全拦截】，你必须立即仔细阅读错误信息，自我反思错误原因，并修正 SQL 后重新执行。",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "需要执行的纯正 SQL 语句。例如：SELECT * FROM weather_data LIMIT 5;不可含有其他多余的信息；"
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
      description: "[核心可视化技能] 将查询到的数据转化为专业的 ECharts 图表配置。\n【触发前提】：当用户明确要求“可视化、画图、显示趋势、对比、分布、占比”时进行画图，且调用前必须已经通过 executeSQL 获得了实际数据！\n【专家图表选择决策树】：\n1. 表现时间趋势（如：每年、每月、每日的某项气候变化规律），选择 'line' (折线图)。\n2. 表现构成占比（如：雨天天数占比、降雨量占比等各项所占百分比），选择 'pie' (饼图)。\n3. 表现实体类别对比（如：不同城市的降水对比、不同年份的总量对比），选择 'bar' (柱状图)。\n4. 表现多维度综合评估，强制选择 'radar' (雷达图)。",
      parameters: {
        type: "object",
        properties: {
          chartType: {
            type: "string",
            enum: ["bar", "line", "pie", "area", "scatter", "radar"],
            description: "请严格按照上述【专家图表选择决策树】在这些枚举值中选择最合适的图表类型。"
          },
          xAxisField: {
            type: "string",
            description: "X 轴的字段名（通常是时间或类别名）。如果是饼图，此字段作为数据项名称。"
          },
          yAxisField: {
            type: "string",
            description: "Y 轴的字段名（必须是数值型字段）。如果是饼图，此字段作为数值。"
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
let lastSQLData: Record<string, any>[] | null = null;
let executedSQLs: string[] = []; // 记录执行过的 SQL 语句

// 当前对话的工具调用历史（不保存到上下文，只用于当前循环）
let currentToolCalls: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

/**
 * 发送 SSE 消息的辅助函数
 */
function sendSSEMessage(
  res: any,
  message: AnySSEMessage
) {
  const data = JSON.stringify(message);
  res.write(`data: ${data}\n\n`);
}

// 最大思考轮数限制（防止无限循环）
const MAX_THINKING_ROUNDS = 10;

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
export async function runAgent(
  userQuestion: string,
  onSQLResult?: (data: Record<string, any>[]) => void,
  onChartResult?: (chartConfig: string) => void,
  onSQLExecuted?: (sql: string) => void,
  useContext: boolean = true,
  onThinking?: (content: string) => void,
  onToolStart?: (name: string, args: any) => void,
  onToolResult?: (name: string, result: any) => void,
  onTextStream?: (text: string) => void
) {
  logger.info('👨‍💻 用户提问', { question: userQuestion, useContext });

  console.log(`\n👨‍💻 用户提问：${userQuestion}`);
  console.log("----------------------------------------");

  // 获取全局上下文管理器
  const context = getGlobalContext();

  // 如果不需要上下文，先重置
  if (!useContext) {
    logger.info('重置上下文');
    resetGlobalContext();
  }

  // 重置 SQL 数据和执行记录
  lastSQLData = null;
  executedSQLs = [];
  currentToolCalls = [];

  // 将用户问题添加到上下文（只保存文字）
  context.addUserMessage(userQuestion);

  // 思考轮数计数器
  let thinkingRounds = 0;

  // 开启循环，直到大模型认为任务完成或达到最大轮数限制
  while (true) {
    // 检查是否超过最大思考轮数
    thinkingRounds++;
    if (thinkingRounds > MAX_THINKING_ROUNDS) {
      logger.error('⚠️ 达到最大思考轮数限制', { maxRounds: MAX_THINKING_ROUNDS });
      console.log(`\n⚠️ 已达到最大思考轮数限制（${MAX_THINKING_ROUNDS}轮），强制结束对话`);

      const finalAnswer = `抱歉，我已经尝试了 ${MAX_THINKING_ROUNDS} 轮思考，但仍未完成您的问题。这可能是因为：
1. 数据库表结构复杂，需要更多步骤
2. 问题需要多次查询才能得出完整答案
3. 可能在某个环节遇到了困难

建议您：
- 重新描述您的问题，尝试更具体的提问
- 将复杂问题拆分成多个小问题
- 或者我可以基于目前已获取的信息，给出一个阶段性结论`;

      context.addAssistantMessage(finalAnswer);

      if (onTextStream) {
        const content = finalAnswer;
        for (let i = 0; i < content.length; i++) {
          await new Promise(resolve => setTimeout(resolve, 20));
          onTextStream(content[i]);
        }
      }

      return finalAnswer;
    }
    console.log("🧠 大脑正在思考中...");

    // 从上下文获取完整消息历史
    const messages = context.getMessages();

    // 添加当前工具调用的历史（临时，不保存到上下文）
    const messagesWithTools = [...messages, ...currentToolCalls];

    logger.debug('呼叫大模型 API', {
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
      logger.info('💡 大模型返回最终答案', {
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
    logger.info('🔧 大模型调用工具', {
      toolCalls: responseMessage.tool_calls.map(tc => {
        const fn = tc as any;
        return {
          name: fn.function?.name || fn.name,
          arguments: fn.function?.arguments?.substring(0, 200) || fn.arguments || ''
        };
      })
    });

    // 发送工具调用开始消息（流式）
    for (const toolCall of responseMessage.tool_calls) {
      if (toolCall.type !== 'function') continue;
      const tcAny = toolCall as any;
      const functionName = tcAny.function?.name || tcAny.name;
      const functionArgs = JSON.parse(tcAny.function?.arguments || tcAny.arguments || '{}');

      // 发送工具调用开始消息
      if (onToolStart) {
        onToolStart(functionName, functionArgs);
      }
    }

    // 将工具调用添加到临时历史（用于当前循环，不保存到上下文）
    currentToolCalls.push(responseMessage as any);

    // 遍历大模型想要调用的所有工具
    for (const toolCall of responseMessage.tool_calls) {
      // 类型断言：我们只处理 function 类型的 tool call
      if (toolCall.type !== 'function') continue;

      const tcAny = toolCall as any;
      const functionName = tcAny.function?.name || tcAny.name;
      const functionArgs = JSON.parse(tcAny.function?.arguments || tcAny.arguments || '{}');

      let functionResult = "";

      // 我们的本地代码拦截调用，并执行真实的 TS 函数
      if (functionName === 'getDatabaseSchema') {
        logger.tool('调用工具：getDatabaseSchema');
        functionResult = getDatabaseSchema();

        // 发送思考过程：获取表结构
        if (onThinking) {
          onThinking(`正在获取数据库表结构...`);
        }

        // 发送工具结果消息
        if (onToolResult) {
          onToolResult(functionName, { success: true, rowCount: functionResult.length });
        }
      } else if (functionName === 'executeSQL') {
        const sqlQuery = functionArgs.query as string;
        logger.tool('调用工具：executeSQL', { sql: sqlQuery });

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

        const result = await executeSQLWithCallback(sqlQuery);
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

        logger.tool('SQL 执行结果', {
          resultLength: result.text.length,
          rowCount: result.data?.length || 0
        });
      } else if (functionName === 'generateChartConfig') {
        // 使用上一次的 SQL 查询结果生成图表
        const chartType = functionArgs.chartType as ChartType;
        const xAxisField = functionArgs.xAxisField as string | undefined;
        const yAxisField = functionArgs.yAxisField as string | undefined;

        logger.tool('调用工具：generateChartConfig', {
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
        functionResult = generateChartConfig(dataToUse, chartType, xAxisField, yAxisField);

        // 通过回调传递图表配置给 server
        if (onChartResult) {
          onChartResult(functionResult);
        }

        // 发送工具结果消息
        if (onToolResult) {
          onToolResult(functionName, { success: true, chartType });
        }

        logger.tool('图表配置生成完成', { configLength: functionResult.length });
      }

      // 将工具执行结果添加到临时历史（不保存到上下文）
      currentToolCalls.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: functionResult,
      } as any);

      logger.debug('添加临时工具结果', {
        toolCallId: toolCall.id,
        resultLength: functionResult.length
      });
    }

    // 循环继续，带着工具的结果再去问大模型："接下来呢？"
    logger.debug('继续循环，等待大模型下一步指令');
  }
}
