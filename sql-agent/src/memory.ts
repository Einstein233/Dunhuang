import { logger } from './logger';
import type { AgentMessage } from './types';

export interface MessageUnit {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface ConversationSummary {
  keyPoints: string[];
  sqlExecuted: string[];
  lastUpdateTime: number;
}

export class ContextManager {
  private readonly baseSystemPrompt: string;
  private messageHistory: MessageUnit[] = [];
  private readonly maxRounds: number;
  private readonly maxTokens: number;

  constructor(options?: {
    baseSystemPrompt?: string;
    maxRounds?: number;
    maxTokens?: number;
  }) {
    this.baseSystemPrompt = options?.baseSystemPrompt || this.getDefaultSystemPrompt();
    this.maxRounds = options?.maxRounds || 8;
    this.maxTokens = options?.maxTokens || 4000;

    this.messageHistory.push({
      role: 'system',
      content: this.buildSystemPrompt(),
      timestamp: Date.now(),
    });
  }

  private getDefaultSystemPrompt(): string {
    return `你是敦煌项目的 SQL 数据分析助手。
你的任务是把用户的自然语言问题转换成安全、准确、只读的 MySQL 查询，并基于查询结果用简洁中文回答用户。

一、工作边界
1. 只处理数据库查询、统计分析和图表生成相关任务。
2. 只允许生成和执行 SELECT，不允许任何写操作。
3. 生成 SQL 之前，必须先参考实时 schema，不允许猜测表名或字段名。

二、当前气象数据结构
1. 当前统一气象事实表是 weather_data。
2. 当前地区映射表主要是 station_info 和 weather_directory。
3. station_code + granularity 是 weather_data 与地区表之间的核心关联键。
4. 小时级数据通常使用 granularity = 2。
5. 历史上的 station、weather_observation、weather_observation_hourly、vw_weather_query 不是当前主结构，除非实时 schema 明确要求，否则不要优先使用。

三、查询策略
1. 查询具体气象指标时，优先使用 weather_data。
2. 需要按城市、省份过滤时，优先使用 station_info 或 weather_directory 与 weather_data 关联。
3. 需要查看可用地区、时间覆盖范围、记录条数时，优先使用 weather_directory。
4. 地区过滤优先使用 station_info.city、station_info.province、weather_directory.city、weather_directory.province。
5. 当前地区值通常是中文地名；station_code 是更稳定的关联字段。
6. 不要使用任何历史上的“每个地区一张表”的旧结构。

四、执行与修正
1. 如果 SQL 执行失败，必须根据实时 schema 和报错修正后重试。
2. 如果结果为空，先检查地区字段、时间范围、granularity 和关联条件是否正确。
3. 如果用户要图表，先查出结构化结果，再生成图表配置。

五、输出要求
1. 最终回答必须使用中文。
2. 先给结果结论，再按需补充说明。
3. 说明本次使用了哪些表，以及是否发生过修正。`;
  }

  private buildSystemPrompt(): string {
    const dynamicState = this.getDynamicState();

    return `${this.baseSystemPrompt}

当前状态：
- 当前时间：${dynamicState.currentTime}
- 对话轮次：${dynamicState.conversationRound}`;
  }

  private getDynamicState(): { currentTime: string; conversationRound: number } {
    const now = new Date();
    const currentTime = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return {
      currentTime,
      conversationRound: this.getConversationRound(),
    };
  }

  addUserMessage(content: string): void {
    this.messageHistory.push({
      role: 'user',
      content,
      timestamp: Date.now(),
    });

    this.trimIfNeeded();
  }

  addAssistantMessage(content: string): void {
    this.messageHistory.push({
      role: 'assistant',
      content,
      timestamp: Date.now(),
    });

    this.trimIfNeeded();
  }

  private trimIfNeeded(): void {
    const currentTokens = this.estimateTokens();

    if (currentTokens <= this.maxTokens) {
      return;
    }

    const systemMessage = this.messageHistory[0];
    const maxMessages = this.maxRounds * 2 + 1;
    const recentMessages = this.messageHistory.slice(-maxMessages);

    this.messageHistory =
      recentMessages[0]?.role === 'system'
        ? recentMessages
        : [systemMessage, ...recentMessages];
  }

  private estimateTokens(): number {
    const totalChars = this.messageHistory.reduce(
      (sum, message) => sum + (message.content?.length || 0),
      0
    );

    return Math.floor(totalChars * 0.8);
  }

  getMessages(): AgentMessage[] {
    const messages = [...this.messageHistory];

    if (messages[0]?.role === 'system') {
      messages[0] = {
        role: 'system',
        content: this.buildSystemPrompt(),
      };
    }

    const result = messages as AgentMessage[];
    this.logContext(result);

    logger.saveContext(
      result.map((message) => {
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? '');

        return {
          role: message.role,
          content,
          contentLength: content.length,
        };
      })
    );

    return result;
  }

  private logContext(messages: AgentMessage[]): void {
    const stats = this.getStats();
    const preview = messages
      .map((message, index) => {
        const content =
          typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content ?? '');

        const shortContent = content.length > 200 ? `${content.slice(0, 200)}...` : content;
        return `[${index}] ${String(message.role).toUpperCase()}: ${shortContent}`;
      })
      .join('\n');

    logger.context('=== 当前上下文快照 ===', {
      conversationRounds: stats.conversationRounds,
      totalMessages: stats.totalMessages,
      estimatedTokens: stats.estimatedTokens,
      messages: messages.map((message, index) => ({
        index,
        role: message.role,
        contentLength:
          typeof message.content === 'string'
            ? message.content.length
            : JSON.stringify(message.content ?? '').length,
      })),
      fullContext: preview,
    });
  }

  getConversationRound(): number {
    return this.messageHistory.filter((message) => message.role === 'user').length;
  }

  clear(): void {
    this.messageHistory = [
      {
        role: 'system',
        content: this.buildSystemPrompt(),
        timestamp: Date.now(),
      },
    ];
  }

  getStats(): {
    totalMessages: number;
    conversationRounds: number;
    estimatedTokens: number;
  } {
    return {
      totalMessages: this.messageHistory.length,
      conversationRounds: this.getConversationRound(),
      estimatedTokens: this.estimateTokens(),
    };
  }
}

let globalContextManager: ContextManager | null = null;

export function getGlobalContext(): ContextManager {
  if (!globalContextManager) {
    globalContextManager = new ContextManager();
  }

  return globalContextManager;
}

export function resetGlobalContext(): void {
  globalContextManager?.clear();
}
