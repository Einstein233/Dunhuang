import type { AgentHistoryItem, AgentState } from './types';

export interface CreateInitialStateParams {
  sessionId: string;
  userQuery: string;
  history?: AgentHistoryItem[];
}

export function createInitialState(params: CreateInitialStateParams): AgentState {
  return {
    sessionId: params.sessionId,
    round: 1,
    userQuery: params.userQuery,
    history: params.history ?? [],
    intent: {},
    schema: {
      loaded: false,
      isFresh: false,
    },
    sql: {
      executed: [],
      rowCount: 0,
      reason: undefined,
    },
    chart: {
      chartType: undefined,
      xAxisField: undefined,
      yAxisField: undefined,
      config: undefined,
      lastError: undefined,
    },
    answer: undefined,
    runtime: {
      traceId: undefined,
      traceFilePath: undefined,
      modelRound: 0,
      pendingTool: null,
      lastToolResult: null,
      lastModelMessage: undefined,
    },
    control: {
      retryCount: 0,
      maxRetry: 2,
      done: false,
      failed: false,
      currentStep: 'init',
    },
  };
}
