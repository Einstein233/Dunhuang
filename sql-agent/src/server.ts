import express from 'express';
import cors from 'cors';
import path from 'path';
import { runAgent } from './agent';
import { getGlobalContext, resetGlobalContext } from './memory';
import { logger } from './logger';
import { SSEMessageType, type AnySSEMessage } from './types';

const app = express();
const PORT = Number(process.env.PORT) || 3001;

// 使用绝对路径
const PUBLIC_PATH = path.resolve(__dirname, '../public');
console.log('Static files path:', PUBLIC_PATH);

// 创建 API router
const apiRouter = express.Router();

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
    let sqlData: Record<string, any>[] | null = null;
    let chartConfig: string | null = null;
    let executedSQLs: string[] = [];

    // 调用我们的 Agent 核心逻辑（传入回调来捕获 SQL 结果、图表配置和 SQL 语句）
    const agentReply = await runAgent(
      userMessage,
      (data: Record<string, any>[]) => {
        sqlData = data;
      },
      (config: string) => {
        chartConfig = config;
      },
      (sql: string) => {
        executedSQLs.push(sql);
      },
      true // 使用上下文（多轮对话）
    );

    // 如果有 SQL 查询结果，生成表格数据
    let tableData = null;
    if (sqlData && (sqlData as any[]).length > 0) {
      const columns = Object.keys((sqlData as any[])[0]);
      const rows = (sqlData as any[]).map((row: Record<string, any>) => columns.map((col) => row[col]));
      tableData = { columns, rows };
    }

    // 解析图表配置
    let chartData = null;
    if (chartConfig) {
      try {
        chartData = JSON.parse(chartConfig);
      } catch (e) {
        console.error('解析图表配置失败:', e);
      }
    }

    // 获取上下文统计信息
    const context = getGlobalContext();
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

  } catch (error: any) {
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
    const sendSSEMessage = (message: AnySSEMessage) => {
      const data = JSON.stringify(message);
      res.write(`data: ${data}\n\n`);
    };

    // 用于累积数据
    let sqlData: Record<string, any>[] | null = null;
    let chartConfig: string | null = null;
    let executedSQLs: string[] = [];
    let accumulatedText = '';

    // 发送思考过程消息
    const onThinking = (content: string) => {
      sendSSEMessage({
        type: SSEMessageType.THINKING,
        content,
        timestamp: Date.now()
      });
    };

    // 发送工具调用开始消息
    const onToolStart = (name: string, args: any) => {
      sendSSEMessage({
        type: SSEMessageType.TOOL_START,
        name,
        args,
        timestamp: Date.now()
      });
    };

    // 发送工具调用结果消息
    const onToolResult = (name: string, result: any) => {
      sendSSEMessage({
        type: SSEMessageType.TOOL_RESULT,
        name,
        result,
        timestamp: Date.now()
      });
    };

    // 发送流式文本
    const onTextStream = (text: string) => {
      accumulatedText += text;
      sendSSEMessage({
        type: SSEMessageType.TEXT,
        content: text,
        isStreaming: true,
        timestamp: Date.now()
      });
    };

    // 调用 Agent（传入流式回调）
    await runAgent(
      userMessage,
      // SQL 结果回调 - 发送表格数据
      (data: Record<string, any>[]) => {
        sqlData = data;
        if (data && data.length > 0) {
          const columns = Object.keys(data[0]);
          const rows = data.map((row: Record<string, any>) => columns.map((col) => row[col]));
          sendSSEMessage({
            type: SSEMessageType.TABLE,
            columns,
            rows,
            timestamp: Date.now()
          });
        }
      },
      // 图表配置回调 - 发送图表数据
      (config: string) => {
        chartConfig = config;
        try {
          const chartData = JSON.parse(config);
          sendSSEMessage({
            type: SSEMessageType.CHART,
            config: chartData,
            timestamp: Date.now()
          });
        } catch (e) {
          console.error('解析图表配置失败:', e);
        }
      },
      // SQL 执行回调 - 发送 SQL 语句
      (sql: string) => {
        executedSQLs.push(sql);
        sendSSEMessage({
          type: SSEMessageType.SQL,
          sql,
          timestamp: Date.now()
        });
      },
      true, // 使用上下文
      onThinking,
      onToolStart,
      onToolResult,
      onTextStream
    );

    // 发送完成信号
    const context = getGlobalContext();
    const stats = context.getStats();
    sendSSEMessage({
      type: SSEMessageType.DONE,
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

  } catch (error: any) {
    console.error("[SSE 服务器异常]", error);

    // 发送错误消息
    const sendSSEMessage = (message: AnySSEMessage) => {
      const data = JSON.stringify(message);
      res.write(`data: ${data}\n\n`);
    };

    sendSSEMessage({
      type: SSEMessageType.ERROR,
      message: error.message || '服务器内部错误',
      timestamp: Date.now()
    });

    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// 定义一个 POST 接口：/api/reset - 重置对话上下文（同时清空日志）
apiRouter.post('/reset', (_req, res) => {
  resetGlobalContext();
  logger.clear();
  console.log('[上下文] 对话历史已重置，日志已清空');
  res.json({ success: true, message: '对话和日志已重置' });
});

// 定义一个 GET 接口：/api/context - 获取当前上下文状态
apiRouter.get('/context', (_req, res) => {
  const context = getGlobalContext();
  const stats = context.getStats();
  res.json({
    success: true,
    data: stats
  });
});

// 定义一个 POST 接口：/api/clear-log - 清空日志文件
apiRouter.post('/clear-log', (_req, res) => {
  logger.clear();
  console.log('[日志] 日志文件已清空');
  res.json({ success: true, message: '日志已清空' });
});

// 开启跨域允许，并让服务器能读懂 JSON 格式的数据
app.use(cors());
app.use(express.json());

// 挂载 API 路由
app.use('/api', apiRouter);

// 提供静态文件服务（前端页面）
app.use(express.static(PUBLIC_PATH));

// 根路径直接返回前端页面
app.get('/', (_req, res) => {
  console.log('Root path accessed, sending file:', path.join(PUBLIC_PATH, 'index.html'));
  res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`🚀 敦煌 Agent 服务器已启动！`);
  console.log(`👉 请让若依前端向 http://localhost:${PORT}/api/chat 发送 POST 请求`);
});
