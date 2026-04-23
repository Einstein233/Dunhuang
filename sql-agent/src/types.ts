// ==========================================
// SSE 流式消息协议类型定义
// ==========================================

/**
 * SSE 消息类型枚举
 */
export enum SSEMessageType {
  THINKING = 'thinking',      // 思考过程
  TOOL_START = 'tool_start',  // 工具调用开始
  TOOL_RESULT = 'tool_result',// 工具调用结果
  TABLE = 'table',            // 表格数据
  CHART = 'chart',            // 图表配置
  SQL = 'sql',                // SQL 执行记录
  TEXT = 'text',              // 文本回复（流式）
  DONE = 'done',              // 完成信号
  ERROR = 'error'             // 错误消息
}

/**
 * SSE 消息基类
 */
export interface SSEMessage {
  type: SSEMessageType;
  timestamp: number;
}

/**
 * 思考过程消息
 */
export interface ThinkingMessage extends SSEMessage {
  type: SSEMessageType.THINKING;
  content: string;
}

/**
 * 工具调用开始消息
 */
export interface ToolStartMessage extends SSEMessage {
  type: SSEMessageType.TOOL_START;
  name: string;
  args: any;
}

/**
 * 工具调用结果消息
 */
export interface ToolResultMessage extends SSEMessage {
  type: SSEMessageType.TOOL_RESULT;
  name: string;
  result: any;
}

/**
 * 表格数据消息
 */
export interface TableMessage extends SSEMessage {
  type: SSEMessageType.TABLE;
  columns: string[];
  rows: any[][];
}

/**
 * 图表配置消息
 */
export interface ChartMessage extends SSEMessage {
  type: SSEMessageType.CHART;
  config: any;
}

/**
 * SQL 执行记录消息
 */
export interface SQLMessage extends SSEMessage {
  type: SSEMessageType.SQL;
  sql: string;
}

/**
 * 文本回复消息（流式）
 */
export interface TextMessage extends SSEMessage {
  type: SSEMessageType.TEXT;
  content: string;
  isStreaming: boolean; // true 表示还有更多，false 表示这是最后一段
}

/**
 * 完成信号消息
 */
export interface DoneMessage extends SSEMessage {
  type: SSEMessageType.DONE;
  context: {
    conversationRounds: number;
    estimatedTokens: number;
  };
}

/**
 * 错误消息
 */
export interface ErrorMessage extends SSEMessage {
  type: SSEMessageType.ERROR;
  message: string;
}

/**
 * 所有 SSE 消息类型的联合类型
 */
export type AnySSEMessage =
  | ThinkingMessage
  | ToolStartMessage
  | ToolResultMessage
  | TableMessage
  | ChartMessage
  | SQLMessage
  | TextMessage
  | DoneMessage
  | ErrorMessage;

/**
 * SSE 响应聚合对象（前端用于累积数据）
 */
export interface SSEResponseAggregate {
  thinking: string[];        // 思考过程片段
  toolCalls: Array<{         // 工具调用历史
    name: string;
    args: any;
    result: any;
  }>;
  table: { columns: string[]; rows: any[][] } | null;
  chart: any | null;
  sql: string[];
  text: string;              // 最终文本回复
  done: boolean;
  error: string | null;
}
