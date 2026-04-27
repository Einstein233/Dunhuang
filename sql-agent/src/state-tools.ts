import {
  buildSQLNode,
  ensureSchemaNode,
  executeSqlNode,
  generateChartNode,
} from './tool-actions';
import type { AgentToolDefinition, AgentState } from './types';

export type StateToolName = 'querySchema' | 'buildAndExecuteSQL' | 'generateChart';

export interface StateToolResult {
  state: AgentState;
  summary: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface StateToolHandler {
  name: StateToolName;
  invoke: (state: AgentState, args?: Record<string, unknown>) => Promise<StateToolResult>;
}

export const stateToolDefinitions: AgentToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'querySchema',
      description:
        '加载或刷新实时数据库结构到 AgentState.schema，供后续步骤生成正确 SQL。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'buildAndExecuteSQL',
      description:
        '根据 AgentState.userQuery 和 AgentState.schema 生成 SQL 并执行，再把 SQL、结果和错误写回 AgentState.sql。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateChart',
      description:
        '根据 AgentState.sql.resultRows 生成图表配置，并把图表配置写回 AgentState.chart。',
      parameters: {
        type: 'object',
        properties: {
          chartType: {
            type: 'string',
            enum: ['bar', 'line', 'pie', 'area', 'scatter', 'radar'],
            description: '要生成的图表类型。',
          },
          xAxisField: {
            type: 'string',
            description: '可选，指定 x 轴字段名。',
          },
          yAxisField: {
            type: 'string',
            description: '可选，指定 y 轴字段名。',
          },
        },
        required: ['chartType'],
      },
    },
  },
];

async function querySchemaTool(state: AgentState): Promise<StateToolResult> {
  const nextState = await ensureSchemaNode(state);
  return {
    state: nextState,
    summary: nextState.schema.loaded ? '数据库结构已加载到 state。' : '数据库结构未成功加载。',
    data: {
      loaded: nextState.schema.loaded,
      isFresh: nextState.schema.isFresh,
    },
  };
}

async function buildAndExecuteSQLTool(state: AgentState): Promise<StateToolResult> {
  let nextState = await buildSQLNode(state);
  nextState = await executeSqlNode(nextState);

  return {
    state: nextState,
    summary: nextState.sql.lastError
      ? 'SQL 生成或执行失败。'
      : `SQL 执行成功，共返回 ${nextState.sql.rowCount} 行。`,
    error: nextState.sql.lastError,
    data: {
      sql: nextState.sql.draft,
      reason: nextState.sql.reason,
      rowCount: nextState.sql.rowCount,
    },
  };
}

async function generateChartTool(
  state: AgentState,
  args?: Record<string, unknown>
): Promise<StateToolResult> {
  if (typeof args?.chartType === 'string') {
    state.chart.chartType = args.chartType;
  }
  if (typeof args?.xAxisField === 'string') {
    state.chart.xAxisField = args.xAxisField;
  }
  if (typeof args?.yAxisField === 'string') {
    state.chart.yAxisField = args.yAxisField;
  }

  const nextState = await generateChartNode(state);

  return {
    state: nextState,
    summary: nextState.chart.lastError
      ? '图表生成失败。'
      : '图表配置生成成功。',
    error: nextState.chart.lastError,
    data: {
      chartType: nextState.chart.chartType,
      xAxisField: nextState.chart.xAxisField,
      yAxisField: nextState.chart.yAxisField,
      hasConfig: Boolean(nextState.chart.config),
    },
  };
}

export const stateToolHandlers: Record<StateToolName, StateToolHandler> = {
  querySchema: {
    name: 'querySchema',
    invoke: (state) => querySchemaTool(state),
  },
  buildAndExecuteSQL: {
    name: 'buildAndExecuteSQL',
    invoke: (state) => buildAndExecuteSQLTool(state),
  },
  generateChart: {
    name: 'generateChart',
    invoke: (state, args) => generateChartTool(state, args),
  },
};
