import { composeAnswerNode } from './tool-actions';
import { logger } from './logger';
import { stateToolDefinitions, stateToolHandlers } from './state-tools';
import { AgentTraceSession, createAgentTraceSession } from './trace-logger';
import { modelInvoker } from './protocol/model-invoker';
import { outputParser } from './protocol/output-parser';
import { promptAssembler } from './protocol/prompt-assembler';
import type { AgentState } from './types';

export type DiagnosticPayload = {
  kind: 'plan' | 'schema' | 'strategy' | 'sql_error' | 'retry' | 'result';
  title: string;
  content: string;
  detail?: string;
};

export type ModelIOPayload = {
  round: number;
  direction: 'input' | 'output';
  label: string;
  summary: string;
  payload: unknown;
};

export interface AgentLoopNodeContext {
  onSQLResult?: (data: Record<string, unknown>[]) => void;
  onChartResult?: (chartConfig: string) => void;
  onSQLExecuted?: (sql: string) => void;
  onThinking?: (content: string) => void;
  onToolStart?: (name: string, args: unknown) => void;
  onToolResult?: (name: string, result: unknown) => void;
  onTextStream?: (text: string) => void;
  onDiagnostic?: (payload: DiagnosticPayload) => void;
  onModelIO?: (payload: ModelIOPayload) => void;
}

const modelName = process.env.QWEN_MODEL || 'qwen3.6-plus';

function getTraceSession(state: AgentState): AgentTraceSession {
  if (state.runtime?.traceId) {
    return new AgentTraceSession(state.runtime.traceId);
  }

  return createAgentTraceSession();
}

async function streamText(text: string, onTextStream?: (text: string) => void): Promise<void> {
  if (!text || !onTextStream) {
    return;
  }

  for (const char of text) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    onTextStream(char);
  }
}

export async function initAgentNode(
  state: AgentState,
  context: AgentLoopNodeContext
): Promise<AgentState> {
  const trace = getTraceSession(state);

  state.runtime = {
    ...state.runtime,
    traceId: trace.traceId,
    traceFilePath: trace.filePath,
    modelRound: 0,
    pendingTool: null,
    lastToolResult: null,
  };
  state.control.currentStep = 'initialized';
  state.control.done = false;
  state.control.failed = false;

  logger.info('Agent loop initialized', {
    sessionId: state.sessionId,
    traceId: trace.traceId,
    userQuery: state.userQuery,
  });
  trace.log({
    type: 'run_started',
    summary: 'Agent loop initialized',
    failureCategory: 'none',
    data: {
      sessionId: state.sessionId,
      userQuery: state.userQuery,
    },
  });

  context.onDiagnostic?.({
    kind: 'plan',
    title: 'Agent Loop Started',
    content: '系统已进入 init -> reason -> execute_tools -> output 的循环模式。',
    detail: `Trace ID: ${trace.traceId}`,
  });

  return state;
}

export async function reasonNode(
  state: AgentState,
  context: AgentLoopNodeContext
): Promise<AgentState> {
  const trace = getTraceSession(state);
  const round = (state.runtime?.modelRound ?? 0) + 1;
  const messages = promptAssembler(state);

  state.runtime = {
    ...state.runtime,
    modelRound: round,
  };
  state.round = round;
  state.control.currentStep = 'reasoning';

  context.onThinking?.(`第 ${round} 轮推理中...`);
  logger.debug('Reason node input', {
    traceId: trace.traceId,
    round,
    messages,
  });
  trace.log({
    type: 'model_input',
    round,
    summary: 'Reason node model input',
    failureCategory: 'none',
    data: {
      model: modelName,
      tools: stateToolDefinitions,
      messages,
    },
  });
  context.onModelIO?.({
    round,
    direction: 'input',
    label: '模型输入',
    summary: `第 ${round} 轮发送给推理节点模型。`,
    payload: {
      model: modelName,
      tools: stateToolDefinitions.map((tool) => tool.function.name),
      messages,
    },
  });

  const rawResponse = await modelInvoker(messages, state);

  logger.debug('Reason node output', {
    traceId: trace.traceId,
    round,
    response: rawResponse,
  });
  trace.log({
    type: 'model_output',
    round,
    summary: 'Reason node model output',
    failureCategory: 'none',
    data: rawResponse,
  });
  context.onModelIO?.({
    round,
    direction: 'output',
    label: '模型输出',
    summary: `第 ${round} 轮收到推理节点输出。`,
    payload: rawResponse,
  });

  const parsed = outputParser(rawResponse);

  state.runtime = {
    ...state.runtime,
    lastModelMessage: parsed.rawContent ?? '',
    lastModelOutput: parsed,
  };

  if (parsed.action === 'tool_call' && parsed.toolName) {
    state.runtime = {
      ...state.runtime,
      pendingTool: {
        name: parsed.toolName,
        args: parsed.arguments,
      },
    };
    state.control.currentStep = 'tool_selected';
    state.control.done = false;

    trace.log({
      type: 'tool_start',
      round,
      summary: `Reason node selected tool ${parsed.toolName}`,
      failureCategory: 'none',
      data: {
        toolName: parsed.toolName,
        arguments: parsed.arguments,
      },
    });

    return state;
  }

  if (parsed.action === 'final_answer') {
    state.answer = parsed.answer || '未生成可展示的文本结果。';
    state.runtime = {
      ...state.runtime,
      pendingTool: null,
    };
    state.control.currentStep = 'reason_completed';
    state.control.done = true;

    trace.log({
      type: 'final_answer',
      round,
      summary: 'Reason node finished without tool call',
      failureCategory: 'none',
      data: {
        answer: state.answer,
      },
    });

    return state;
  }

  state.runtime = {
    ...state.runtime,
    pendingTool: null,
  };
  state.answer = parsed.error ?? '推理节点返回了无效输出。';
  state.control.failed = true;
  state.control.done = true;
  state.control.currentStep = 'reason_invalid_output';

  return state;
}

export async function executeToolsNode(
  state: AgentState,
  context: AgentLoopNodeContext
): Promise<AgentState> {
  const trace = getTraceSession(state);
  const pendingTool = state.runtime?.pendingTool;

  if (!pendingTool) {
    return state;
  }

  const handler = stateToolHandlers[pendingTool.name as keyof typeof stateToolHandlers];
  if (!handler) {
    state.control.failed = true;
    state.control.done = true;
    state.answer = `工具 ${pendingTool.name} 未注册。`;
    state.control.currentStep = 'tool_missing';
    return state;
  }

  state.control.currentStep = 'executing_tools';
  context.onToolStart?.(pendingTool.name, pendingTool.args ?? {});
  trace.log({
    type: 'tool_start',
    round: state.runtime?.modelRound,
    summary: `Executing tool ${pendingTool.name}`,
    failureCategory: 'none',
    data: pendingTool,
  });

  const toolResult = await handler.invoke(state, pendingTool.args);
  state = toolResult.state;

  state.runtime = {
    ...state.runtime,
    pendingTool: null,
    lastToolResult: {
      name: pendingTool.name,
      summary: toolResult.summary,
      error: toolResult.error,
      data: toolResult.data,
    },
  };
  state.control.currentStep = toolResult.error ? 'tool_executed_with_error' : 'tool_executed';

  if (pendingTool.name === 'buildAndExecuteSQL' && state.sql.draft) {
    context.onSQLExecuted?.(state.sql.draft);
  }
  if (
    pendingTool.name === 'buildAndExecuteSQL' &&
    state.sql.resultRows &&
    state.sql.resultRows.length > 0
  ) {
    context.onSQLResult?.(state.sql.resultRows);
  }
  if (pendingTool.name === 'generateChart' && state.chart.config) {
    context.onChartResult?.(state.chart.config);
  }

  context.onToolResult?.(pendingTool.name, {
    success: !toolResult.error,
    summary: toolResult.summary,
    error: toolResult.error,
    ...toolResult.data,
  });
  trace.log({
    type: 'tool_result',
    round: state.runtime?.modelRound,
    summary: `Tool ${pendingTool.name} finished`,
    failureCategory: toolResult.error ? 'tool_execution' : 'none',
    data: {
      name: pendingTool.name,
      summary: toolResult.summary,
      error: toolResult.error,
      data: toolResult.data,
    },
  });

  if (pendingTool.name === 'querySchema') {
    context.onDiagnostic?.({
      kind: 'schema',
      title: 'Schema Loaded',
      content: '数据库结构已写入 state.schema，可供下一轮推理继续使用。',
      detail: toolResult.summary,
    });
  } else if (pendingTool.name === 'buildAndExecuteSQL') {
    context.onDiagnostic?.({
      kind: toolResult.error ? 'sql_error' : 'result',
      title: toolResult.error ? 'SQL 执行失败' : 'SQL 执行完成',
      content: toolResult.error ?? toolResult.summary,
      detail: state.sql.draft,
    });
  } else if (pendingTool.name === 'generateChart') {
    context.onDiagnostic?.({
      kind: 'result',
      title: toolResult.error ? '图表生成失败' : '图表生成完成',
      content: toolResult.error ?? toolResult.summary,
    });
  }

  return state;
}

export async function outputNode(
  state: AgentState,
  context: AgentLoopNodeContext
): Promise<AgentState> {
  const trace = getTraceSession(state);

  if (!state.answer) {
    state = await composeAnswerNode(state);
  }

  state.history = [
    ...state.history,
    { role: 'user', content: state.userQuery },
    { role: 'assistant', content: state.answer ?? '' },
  ];
  state.control.done = true;
  state.control.currentStep = 'output_ready';

  if (state.answer) {
    await streamText(state.answer, context.onTextStream);
  }

  trace.log({
    type: 'run_completed',
    round: state.runtime?.modelRound,
    summary: 'Agent loop completed',
    failureCategory: state.control.failed ? 'system' : 'none',
    data: {
      answer: state.answer,
      sqlCount: state.sql.executed.length,
      rowCount: state.sql.rowCount,
      hasChart: Boolean(state.chart.config),
    },
  });

  return state;
}
