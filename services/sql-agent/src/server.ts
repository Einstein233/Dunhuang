import { randomUUID } from 'crypto';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { runAgentRequest } from './agent';
import { getGlobalContext, resetGlobalContext } from './memory';
import { logger } from './logger';
import {
  SSEMessageType,
  type AgentState,
  type AgentHistoryItem,
  type AnySSEMessage,
  type DiagnosticMessage,
} from './types';

const app = express();
const PORT = Number(process.env.PORT) || 3001;
const PUBLIC_PATH = path.resolve(__dirname, '../public');

logger.init();

function safeJSONStringify(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) =>
    typeof currentValue === 'bigint' ? currentValue.toString() : currentValue
  );
}

function buildTablePayload(data: Record<string, unknown>[] | null) {
  if (!data || data.length === 0) {
    return null;
  }

  const columns = Object.keys(data[0]);
  const rows = data.map((row) => columns.map((column) => row[column]));

  return { columns, rows };
}

function createSessionId(rawSessionId: unknown): string {
  if (typeof rawSessionId === 'string' && rawSessionId.trim()) {
    return rawSessionId.trim();
  }

  return randomUUID();
}

function normalizeHistory(rawHistory: unknown): AgentHistoryItem[] {
  if (!Array.isArray(rawHistory)) {
    return [];
  }

  return rawHistory.flatMap((item) => {
    if (
      item &&
      typeof item === 'object' &&
      'role' in item &&
      'content' in item &&
      (item.role === 'user' || item.role === 'assistant') &&
      typeof item.content === 'string'
    ) {
      return [
        {
          role: item.role,
          content: item.content,
        },
      ];
    }

    return [];
  });
}

function buildStateContext(state: AgentState): { conversationRounds: number; estimatedTokens: number } {
  const conversationRounds = state.history.filter((item) => item.role === 'user').length;
  const estimatedTokens = Math.floor(
    state.history.reduce((sum, item) => sum + item.content.length, 0) * 0.8
  );

  return {
    conversationRounds,
    estimatedTokens,
  };
}

const apiRouter = express.Router();

apiRouter.get('/health', (_req, res) => {
  res.json({
    success: true,
    service: 'sql-agent',
    timestamp: Date.now(),
  });
});

apiRouter.get('/log/status', (_req, res) => {
  const paths = logger.getPaths();
  res.json({
    success: true,
    paths,
    files: {
      serverLogExists: fs.existsSync(paths.serverLogFile),
      messageLogExists: fs.existsSync(paths.messageLogFile),
    },
  });
});

apiRouter.post('/chat', async (req, res) => {
  try {
    const userMessage = req.body.message;
    const sessionId = createSessionId(req.body.sessionId);
    const history = normalizeHistory(req.body.history);

    if (!userMessage) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }

    let sqlData: Record<string, unknown>[] | null = null;
    let chartConfig: string | null = null;
    const executedSQLs: string[] = [];
    const diagnostics: DiagnosticMessage[] = [];
    const modelIO: Array<{
      round: number;
      direction: 'input' | 'output';
      label: string;
      summary: string;
      payload: unknown;
    }> = [];

    const finalState = await runAgentRequest(
      {
        sessionId,
        userQuery: userMessage,
        history,
      },
      {
      onSQLResult: (data) => {
        sqlData = data;
      },
      onChartResult: (config) => {
        chartConfig = config;
      },
      onSQLExecuted: (sql) => {
        executedSQLs.push(sql);
      },
      onDiagnostic: (payload) => {
        diagnostics.push({
          type: SSEMessageType.DIAGNOSTIC,
          timestamp: Date.now(),
          ...payload,
        });
      },
      onModelIO: (payload) => {
        modelIO.push(payload);
      },
      }
    );

    let chartData = null;
    if (chartConfig) {
      try {
        chartData = JSON.parse(chartConfig);
      } catch (error) {
        console.error('Failed to parse chart config:', error);
      }
    }

    res.json({
      success: true,
      sessionId,
      history: finalState.history,
      text: finalState.answer ?? '',
      table: buildTablePayload(sqlData),
      chart: chartData,
      sql: executedSQLs,
      diagnostics,
      modelIO,
      traceId: finalState.runtime?.traceId,
      traceFilePath: finalState.runtime?.traceFilePath,
      context: buildStateContext(finalState),
    });
  } catch (error) {
    console.error('[server error]', error);
    res.status(500).json({ success: false, error: 'Agent service error.' });
  }
});

apiRouter.post('/chat/stream', async (req, res) => {
  try {
    const userMessage = req.body.message;
    const sessionId = createSessionId(req.body.sessionId);
    const history = normalizeHistory(req.body.history);

    if (!userMessage) {
      res.status(400).json({ error: 'message is required.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const sendSSEMessage = (message: AnySSEMessage) => {
      res.write(`data: ${safeJSONStringify(message)}\n\n`);
    };

    const finalState = await runAgentRequest(
      {
        sessionId,
        userQuery: userMessage,
        history,
      },
      {
      onSQLResult: (data) => {
        const table = buildTablePayload(data);
        if (!table) {
          return;
        }

        sendSSEMessage({
          type: SSEMessageType.TABLE,
          columns: table.columns,
          rows: table.rows,
          timestamp: Date.now(),
        });
      },
      onChartResult: (config) => {
        try {
          sendSSEMessage({
            type: SSEMessageType.CHART,
            config: JSON.parse(config),
            timestamp: Date.now(),
          });
        } catch (error) {
          console.error('Failed to parse chart config:', error);
        }
      },
      onSQLExecuted: (sql) => {
        sendSSEMessage({
          type: SSEMessageType.SQL,
          sql,
          timestamp: Date.now(),
        });
      },
      onThinking: (content) => {
        sendSSEMessage({
          type: SSEMessageType.THINKING,
          content,
          timestamp: Date.now(),
        });
      },
      onToolStart: (name, args) => {
        sendSSEMessage({
          type: SSEMessageType.TOOL_START,
          name,
          args,
          timestamp: Date.now(),
        });
      },
      onToolResult: (name, result) => {
        sendSSEMessage({
          type: SSEMessageType.TOOL_RESULT,
          name,
          result,
          timestamp: Date.now(),
        });
      },
      onTextStream: (text) => {
        sendSSEMessage({
          type: SSEMessageType.TEXT,
          content: text,
          isStreaming: true,
          timestamp: Date.now(),
        });
      },
      onDiagnostic: (payload) => {
        sendSSEMessage({
          type: SSEMessageType.DIAGNOSTIC,
          timestamp: Date.now(),
          ...payload,
        });
      },
      onModelIO: (payload) => {
        sendSSEMessage({
          type: SSEMessageType.MODEL_IO,
          timestamp: Date.now(),
          ...payload,
        });
      },
      }
    );

    sendSSEMessage({
      type: SSEMessageType.DIAGNOSTIC,
      timestamp: Date.now(),
      kind: 'result',
      title: 'Trace saved',
      content: `Trace ID: ${finalState.runtime?.traceId ?? ''}`,
      detail: finalState.runtime?.traceFilePath,
    });

    sendSSEMessage({
      type: SSEMessageType.DONE,
      context: buildStateContext(finalState),
      sessionId,
      history: finalState.history,
      timestamp: Date.now(),
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    console.error('[sse error]', error);

    res.write(
      `data: ${safeJSONStringify({
        type: SSEMessageType.ERROR,
        message: error instanceof Error ? error.message : 'Server error.',
        timestamp: Date.now(),
      })}\n\n`
    );
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

apiRouter.post('/reset', (_req, res) => {
  resetGlobalContext();
  logger.clear();
  res.json({ success: true, message: 'Conversation and logs have been reset.' });
});

apiRouter.get('/context', (_req, res) => {
  const context = getGlobalContext();
  res.json({
    success: true,
    data: context.getStats(),
  });
});

apiRouter.post('/clear-log', (_req, res) => {
  logger.clear();
  res.json({ success: true, message: 'Logs cleared.' });
});

app.use(cors());
app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(PUBLIC_PATH));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_PATH, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`SQL Agent server started on http://localhost:${PORT}`);
});
