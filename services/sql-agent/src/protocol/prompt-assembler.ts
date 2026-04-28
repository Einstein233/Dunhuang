import { stateToolDefinitions } from '../state-tools';
import type { AgentHistoryItem, AgentMessage, AgentState } from '../types';

function summarizeHistory(history: AgentHistoryItem[]): string {
  if (history.length === 0) {
    return '暂无历史对话。';
  }

  return history
    .slice(-6)
    .map((item, index) => `${index + 1}. [${item.role === 'user' ? '用户' : '助手'}] ${item.content}`)
    .join('\n');
}

function summarizeRows(rows?: Record<string, unknown>[]): string {
  if (!rows || rows.length === 0) {
    return '当前没有查询结果。';
  }

  return JSON.stringify(
    rows.slice(0, 3),
    (_key, currentValue) => (typeof currentValue === 'bigint' ? currentValue.toString() : currentValue),
    2
  );
}

export function promptAssembler(state: AgentState): AgentMessage[] {
  const availableTools = stateToolDefinitions.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
  }));

  const systemPrompt = [
    '你是 SQL 数据智能体中的推理节点。',
    '你的任务是检查当前 AgentState，并决定下一步动作。',
    '当需要工具时再调用工具；如果本轮需要调用工具，只能请求一个工具调用。',
    '一次回复中不要调用多个工具。',
    '如果当前状态已经足够回答用户问题，请直接返回最终中文答案，不要再调用工具。',
    'State 是唯一可信的信息来源，不要编造 schema、SQL 或查询结果。',
    '当 schema 尚未加载或不新鲜时，优先调用 querySchema，再考虑 buildAndExecuteSQL。',
    '当state.intent.needChart 为 true或者判断需要图表的时候，且已经存在 SQL 结果时，才调用 generateChart。生成的图表必须符合SQL查询的结果',
    '请始终使用中文进行思考与表达；如果模型返回 reasoning_content，该字段也必须使用中文。',
    '不要脱离状态进行猜测。',
  ].join('\n');

  const userPrompt = [
    `用户问题：\n${state.userQuery}`,
    '',
    `对话历史：\n${summarizeHistory(state.history)}`,
    '',
    `可用工具：\n${JSON.stringify(availableTools, null, 2)}`,
    '',
    `当前状态快照：\n${JSON.stringify(
      {
        round: state.round,
        intent: state.intent,
        schema: {
          loaded: state.schema.loaded,
          isFresh: state.schema.isFresh,
        },
        sql: {
          draft: state.sql.draft,
          reason: state.sql.reason,
          executedCount: state.sql.executed.length,
          rowCount: state.sql.rowCount,
          lastError: state.sql.lastError,
          resultPreview: summarizeRows(state.sql.resultRows),
        },
        chart: {
          chartType: state.chart.chartType,
          hasConfig: Boolean(state.chart.config),
          lastError: state.chart.lastError,
        },
        runtime: {
          lastToolResult: state.runtime?.lastToolResult ?? null,
        },
        control: state.control,
      },
      null,
      2
    )}`,
    '',
    '请基于以上信息立即决定下一步。',
  ].join('\n');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
}
