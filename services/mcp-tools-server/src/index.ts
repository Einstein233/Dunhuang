import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { z } from 'zod';

import { getDatabaseSchema } from './schema-reader';
import { executeSQL } from './sql-executor';
import { validateReadOnlySQL } from './sql-guard';
import { buildSQLDraft } from './sql-builder';
import { generateChartConfig, ChartType } from './chart-engine';

dotenv.config();

const PORT = Number(process.env.MCP_SERVER_PORT) || 3100;

const server = new McpServer({
  name: 'dunhuang-weather-tools',
  version: '1.0.0',
});

server.tool(
  'query_schema',
  '读取数据库的完整表结构信息，包括所有表名、字段名、字段类型、索引、主键、表间关系等。返回 Markdown 格式的 Schema 描述文本，可作为生成 SQL 的上下文。',
  {},
  async () => {
    try {
      const schema = await getDatabaseSchema();
      return {
        content: [
          {
            type: 'text' as const,
            text: schema,
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text' as const,
            text: `获取数据库结构失败：${message}`,
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  'execute_sql',
  '执行一条 SQL 查询并返回结果。执行前会进行安全校验：仅允许 SELECT 语句，禁止任何写操作，表名必须在白名单中。返回 JSON 格式的查询结果（包含列名和数据行）。',
  {
    sql: z.string().describe('要执行的 SELECT SQL 语句'),
  },
  async ({ sql }) => {
    const validation = validateReadOnlySQL(sql);
    if (!validation.isSafe) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `SQL 安全校验未通过: ${validation.reason}`,
              sql,
            }),
          },
        ],
        isError: true,
      };
    }

    const result = await executeSQL(sql);

    if (result.error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: result.error,
              sql,
              durationMs: result.durationMs,
            }),
          },
        ],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            sql,
            columns: result.columns,
            rowCount: result.rowCount,
            data: result.data,
            durationMs: result.durationMs,
          }),
        },
      ],
    };
  }
);

server.tool(
  'build_and_execute_sql',
  '一站式工具：根据自然语言问题和数据库 Schema，自动调用 LLM 生成 SQL，然后执行查询并返回结果。如果 SQL 生成失败，会返回错误信息供 Agent 重试。',
  {
    query: z.string().describe('用户的自然语言查询问题（中文）'),
    schema: z.string().describe('当前数据库的 Schema 描述文本（从 query_schema 工具获取）'),
  },
  async ({ query, schema }) => {
    try {
      const draft = await buildSQLDraft({ query, schema });

      const validation = validateReadOnlySQL(draft.sql);
      if (!validation.isSafe) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                stage: 'validation',
                error: `生成的 SQL 未通过安全校验: ${validation.reason}`,
                generatedSQL: draft.sql,
                reason: draft.reason,
              }),
            },
          ],
          isError: true,
        };
      }

      const result = await executeSQL(draft.sql);

      if (result.error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                success: false,
                stage: 'execution',
                error: result.error,
                generatedSQL: draft.sql,
                reason: draft.reason,
                durationMs: result.durationMs,
              }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              sql: draft.sql,
              reason: draft.reason,
              columns: result.columns,
              rowCount: result.rowCount,
              data: result.data,
              durationMs: result.durationMs,
            }),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              stage: 'generation',
              error: `SQL 生成失败: ${message}`,
            }),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  'generate_chart',
  '根据查询结果数据生成 ECharts 图表配置。支持 6 种图表类型：bar(柱状图)、line(折线图)、pie(饼图)、area(面积图)、scatter(散点图)、radar(雷达图)。返回的 JSON 可直接作为 ECharts 的 option 使用。',
  {
    chartType: z
      .enum(['bar', 'line', 'pie', 'area', 'scatter', 'radar'])
      .describe('图表类型'),
    data: z
      .array(z.record(z.any()))
      .describe('查询结果数据行，每行是一个对象'),
    xAxisField: z
      .string()
      .optional()
      .describe('X 轴对应的字段名（默认取第一列）'),
    yAxisField: z
      .string()
      .optional()
      .describe('Y 轴对应的字段名（默认取第二列）'),
  },
  async ({ chartType, data, xAxisField, yAxisField }) => {
    try {
      const config = generateChartConfig(
        data as Record<string, unknown>[],
        chartType as ChartType,
        xAxisField,
        yAxisField
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              chartType,
              config,
            }),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              success: false,
              error: `图表生成失败: ${message}`,
            }),
          },
        ],
        isError: true,
      };
    }
  }
);

server.tool(
  'health_check',
  '检查 MCP 工具服务的健康状态，包括数据库连接是否正常、各工具是否可用。',
  {},
  async () => {
    const checks: Record<string, string> = {};

    try {
      const { pool } = await import('./db-pool');
      await pool.query('SELECT 1');
      checks.database = 'OK';
    } catch (error) {
      checks.database = `ERROR: ${error instanceof Error ? error.message : 'Unknown'}`;
    }

    checks.tools = 'query_schema, execute_sql, build_and_execute_sql, generate_chart, health_check';
    checks.version = '1.0.0';
    checks.timestamp = new Date().toISOString();

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(checks),
        },
      ],
    };
  }
);

const app = express();
app.use(cors());
app.use(express.json());

const transports: Record<string, SSEServerTransport> = {};

app.get('/sse', async (_req: Request, res: Response) => {
  console.log('[MCP] New SSE connection');
  const transport = new SSEServerTransport('/messages', res);
  transports[transport.sessionId] = transport;

  res.on('close', () => {
    console.log(`[MCP] SSE connection closed: ${transport.sessionId}`);
    delete transports[transport.sessionId];
  });

  await server.connect(transport);
});

app.post('/messages', async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports[sessionId];

  if (!transport) {
    res.status(400).json({ error: 'Invalid or missing sessionId' });
    return;
  }

  await transport.handlePostMessage(req, res, req.body);
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'dunhuang-mcp-tools-server',
    version: '1.0.0',
    activeSessions: Object.keys(transports).length,
    tools: ['query_schema', 'execute_sql', 'build_and_execute_sql', 'generate_chart', 'health_check'],
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════════════════════╗`);
  console.log(`║         Dunhuang Weather MCP Tools Server                ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝`);
  console.log();
  console.log(`  服务端口:   ${PORT}`);
  console.log(`  SSE 端点:   http://localhost:${PORT}/sse`);
  console.log(`  消息端点:   http://localhost:${PORT}/messages`);
  console.log(`  健康检查:   http://localhost:${PORT}/health`);
  console.log();
  console.log(`  注册工具:`);
  console.log(`    - query_schema          读取数据库表结构`);
  console.log(`    - execute_sql           执行 SQL 查询`);
  console.log(`    - build_and_execute_sql 自动生成并执行 SQL`);
  console.log(`    - generate_chart        生成 ECharts 图表配置`);
  console.log(`    - health_check          健康检查`);
  console.log();
});
