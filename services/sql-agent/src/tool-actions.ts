import { logger } from './logger';
import { buildSQLDraft } from './sql-builder';
import {
  executeSQLWithCallback,
  generateChartConfig,
  getDatabaseSchema,
  type ChartType,
} from './tool-runtime';
import type { AgentState } from './types';

export type AgentNode = (state: AgentState) => Promise<AgentState>;

function safePreview(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, currentValue) => (typeof currentValue === 'bigint' ? currentValue.toString() : currentValue),
    2
  );
}

function summarizeState(state: AgentState): Record<string, unknown> {
  return {
    sessionId: state.sessionId,
    round: state.round,
    currentStep: state.control.currentStep,
    schemaLoaded: state.schema.loaded,
    schemaFresh: state.schema.isFresh,
    sqlDraft: state.sql.draft,
    hasReason: Boolean(state.sql.reason),
    sqlReason: state.sql.reason,
    executedSqlCount: state.sql.executed.length,
    rowCount: state.sql.rowCount,
    chartType: state.chart.chartType,
    hasChartConfig: Boolean(state.chart.config),
    hasChartError: Boolean(state.chart.lastError),
    hasAnswer: Boolean(state.answer),
    hasSqlError: Boolean(state.sql.lastError),
    retryCount: state.control.retryCount,
  };
}

async function runLoggedNode(
  nodeName: string,
  state: AgentState,
  handler: (state: AgentState) => Promise<AgentState>
): Promise<AgentState> {
  logger.debug('[Node Start]', {
    nodeName,
    currentStep: state.control.currentStep,
    summary: summarizeState(state),
  });

  try {
    const nextState = await handler(state);
    logger.debug('[Node End]', {
      nodeName,
      ...summarizeState(nextState),
    });
    return nextState;
  } catch (error) {
    logger.error('[Node Error]', {
      nodeName,
      currentStep: state.control.currentStep,
      error: error instanceof Error ? error.message : String(error),
      summary: summarizeState(state),
    });
    throw error;
  }
}

export const ensureSchemaNode: AgentNode = async (state) =>
  runLoggedNode('ensureSchemaNode', state, async (currentState) => {
    if (!currentState.schema.loaded || !currentState.schema.isFresh) {
      const schemaText = await getDatabaseSchema();
      currentState.schema.raw = schemaText;
      currentState.schema.loaded = true;
      currentState.schema.isFresh = true;
    }

    currentState.control.currentStep = 'schema_ready';
    return currentState;
  });

export const buildSQLNode: AgentNode = async (state) =>
  runLoggedNode('buildSQLNode', state, async (currentState) => {
    currentState.control.currentStep = 'building_sql';

    if (!currentState.schema.raw) {
      currentState.sql.lastError = 'Schema is empty. Please load schema before generating SQL.';
      currentState.control.retryCount += 1;
      currentState.control.currentStep = 'sql_build_failed';
      return currentState;
    }

    try {
      const buildResult = await buildSQLDraft({
        userQuery: currentState.userQuery,
        schemaText: currentState.schema.raw,
        history: currentState.history,
        previousReason: currentState.sql.reason,
      });

      currentState.sql.draft = buildResult.sql;
      currentState.sql.reason = buildResult.reason;
      currentState.sql.lastError = undefined;
      currentState.control.currentStep = 'sql_ready';
      return currentState;
    } catch (error) {
      currentState.sql.lastError = error instanceof Error ? error.message : String(error);
      currentState.control.retryCount += 1;
      currentState.control.currentStep = 'sql_build_failed';
      return currentState;
    }
  });

export const executeSqlNode: AgentNode = async (state) =>
  runLoggedNode('executeSqlNode', state, async (currentState) => {
    if (!currentState.sql.draft) {
      return currentState;
    }

    currentState.control.currentStep = 'executing_sql';

    try {
      const result = await executeSQLWithCallback(currentState.sql.draft);

      currentState.sql.executed.push(currentState.sql.draft);
      currentState.sql.resultRows = result.data ?? [];
      currentState.sql.rowCount = result.rowCount;
      currentState.sql.lastError = result.error ?? undefined;

      if (result.error) {
        currentState.control.retryCount += 1;
        currentState.control.currentStep = 'sql_failed';
        return currentState;
      }

      currentState.control.currentStep = 'sql_executed';
      return currentState;
    } catch (error) {
      currentState.sql.lastError = error instanceof Error ? error.message : String(error);
      currentState.control.retryCount += 1;
      currentState.control.currentStep = 'sql_failed';
      return currentState;
    }
  });

export const composeAnswerNode: AgentNode = async (state) =>
  runLoggedNode('composeAnswerNode', state, async (currentState) => {
    const rows = currentState.sql.resultRows ?? [];

    if (currentState.sql.lastError) {
      currentState.answer = `查询执行失败：${currentState.sql.lastError}`;
      currentState.control.done = true;
      currentState.control.failed = true;
      currentState.control.currentStep = 'answer_composed';
      return currentState;
    }

    if (rows.length === 0) {
      currentState.answer = currentState.sql.executed.length
        ? '查询已执行，但没有返回符合条件的数据。'
        : '当前还没有可用于生成回答的查询结果。';
      currentState.control.done = true;
      currentState.control.failed = false;
      currentState.control.currentStep = 'answer_composed';
      return currentState;
    }

    const previewRows = rows.slice(0, 3);
    const columns = Object.keys(rows[0] ?? {});

    currentState.answer = [
      `查询成功，共返回 ${currentState.sql.rowCount} 行数据。`,
      columns.length ? `结果字段：${columns.join('、')}。` : '结果字段暂不可识别。',
      `前 ${previewRows.length} 行示例：`,
      safePreview(previewRows),
    ].join('\n');

    currentState.control.done = true;
    currentState.control.failed = false;
    currentState.control.currentStep = 'answer_composed';
    return currentState;
  });

export const generateChartNode: AgentNode = async (state) =>
  runLoggedNode('generateChartNode', state, async (currentState) => {
    const rows = currentState.sql.resultRows ?? [];
    const chartType = (currentState.chart.chartType ??
      currentState.intent.chartType ??
      'line') as ChartType;

    currentState.control.currentStep = 'generating_chart';

    if (rows.length === 0) {
      currentState.chart.lastError = 'No SQL result rows are available for chart generation.';
      currentState.control.currentStep = 'chart_failed';
      return currentState;
    }

    try {
      const chartConfig = generateChartConfig(
        rows,
        chartType,
        currentState.chart.xAxisField,
        currentState.chart.yAxisField
      );

      currentState.chart.chartType = chartType;
      currentState.chart.config = chartConfig;
      currentState.chart.lastError = undefined;
      currentState.control.currentStep = 'chart_ready';
      return currentState;
    } catch (error) {
      currentState.chart.lastError = error instanceof Error ? error.message : String(error);
      currentState.control.currentStep = 'chart_failed';
      return currentState;
    }
  });
