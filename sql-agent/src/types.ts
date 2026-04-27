export enum SSEMessageType {
  THINKING = 'thinking',
  DIAGNOSTIC = 'diagnostic',
  MODEL_IO = 'model_io',
  TOOL_START = 'tool_start',
  TOOL_RESULT = 'tool_result',
  TABLE = 'table',
  CHART = 'chart',
  SQL = 'sql',
  TEXT = 'text',
  DONE = 'done',
  ERROR = 'error'
}

export type DiagnosticKind =
  | 'plan'
  | 'schema'
  | 'strategy'
  | 'sql_error'
  | 'retry'
  | 'result';

export type AgentToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AgentToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentMessage =
  | {
      role: 'system' | 'user' | 'assistant';
      content: string;
      tool_calls?: AgentToolCall[];
    }
  | {
      role: 'tool';
      content: string;
      tool_call_id: string;
    };

export interface AgentHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentIntentState {
  region?: string;
  regionDisplay?: string;
  timeRange?: string;
  metric?: string;
  aggregation?: string;
  needChart?: boolean;
  chartType?: string;
}

export interface AgentSchemaState {
  raw?: string;
  loaded: boolean;
  isFresh: boolean;
}

export interface AgentSQLState {
  draft?: string;
  reason?: Record<string, unknown>;
  executed: string[];
  resultRows?: Record<string, unknown>[];
  rowCount: number;
  lastError?: string;
}

export interface AgentChartState {
  config?: string;
  chartType?: string;
  xAxisField?: string;
  yAxisField?: string;
  lastError?: string;
}

export interface AgentControlState {
  retryCount: number;
  maxRetry: number;
  done: boolean;
  failed: boolean;
  currentStep: string;
}

export type ReasonNodeAction = 'tool_call' | 'final_answer' | 'invalid';

export interface ReasonNodeParsedOutput {
  action: ReasonNodeAction;
  toolName?: string;
  arguments?: Record<string, unknown>;
  answer?: string;
  rawContent?: string;
  rawToolCalls?: AgentToolCall[];
  error?: string;
}

export interface AgentState {
  sessionId: string;
  round: number;
  userQuery: string;
  history: AgentHistoryItem[];
  intent: AgentIntentState;
  schema: AgentSchemaState;
  sql: AgentSQLState;
  chart: AgentChartState;
  answer?: string;
  runtime?: {
    traceId?: string;
    traceFilePath?: string;
    modelRound?: number;
    pendingTool?: {
      name: string;
      args?: Record<string, unknown>;
      toolCallId?: string;
    } | null;
    lastToolResult?: {
      name: string;
      summary: string;
      error?: string;
      data?: Record<string, unknown>;
    } | null;
    lastModelMessage?: string;
    lastModelOutput?: ReasonNodeParsedOutput;
  };
  control: AgentControlState;
}

export interface SSEMessage {
  type: SSEMessageType;
  timestamp: number;
}

export interface ThinkingMessage extends SSEMessage {
  type: SSEMessageType.THINKING;
  content: string;
}

export interface DiagnosticMessage extends SSEMessage {
  type: SSEMessageType.DIAGNOSTIC;
  kind: DiagnosticKind;
  title: string;
  content: string;
  detail?: string;
}

export interface ModelIOMessage extends SSEMessage {
  type: SSEMessageType.MODEL_IO;
  round: number;
  direction: 'input' | 'output';
  label: string;
  summary: string;
  payload: unknown;
}

export interface ToolStartMessage extends SSEMessage {
  type: SSEMessageType.TOOL_START;
  name: string;
  args: unknown;
}

export interface ToolResultMessage extends SSEMessage {
  type: SSEMessageType.TOOL_RESULT;
  name: string;
  result: unknown;
}

export interface TableMessage extends SSEMessage {
  type: SSEMessageType.TABLE;
  columns: string[];
  rows: unknown[][];
}

export interface ChartMessage extends SSEMessage {
  type: SSEMessageType.CHART;
  config: unknown;
}

export interface SQLMessage extends SSEMessage {
  type: SSEMessageType.SQL;
  sql: string;
}

export interface TextMessage extends SSEMessage {
  type: SSEMessageType.TEXT;
  content: string;
  isStreaming: boolean;
}

export interface DoneMessage extends SSEMessage {
  type: SSEMessageType.DONE;
  context: {
    conversationRounds: number;
    estimatedTokens: number;
  };
  sessionId: string;
  history: AgentHistoryItem[];
}

export interface ErrorMessage extends SSEMessage {
  type: SSEMessageType.ERROR;
  message: string;
}

export type AnySSEMessage =
  | ThinkingMessage
  | DiagnosticMessage
  | ModelIOMessage
  | ToolStartMessage
  | ToolResultMessage
  | TableMessage
  | ChartMessage
  | SQLMessage
  | TextMessage
  | DoneMessage
  | ErrorMessage;

export interface SSEResponseAggregate {
  thinking: string[];
  diagnostics: DiagnosticMessage[];
  modelIO: ModelIOMessage[];
  toolCalls: Array<{
    name: string;
    args: unknown;
    result: unknown;
  }>;
  table: { columns: string[]; rows: unknown[][] } | null;
  chart: unknown | null;
  sql: string[];
  text: string;
  done: boolean;
  error: string | null;
}
