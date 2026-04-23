import OpenAI from 'openai';
import { logger } from './logger';

// ==========================================
// 记忆单元：单条对话消息
// ==========================================
export interface MessageUnit {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

// ==========================================
// 对话摘要：用于压缩长期记忆
// ==========================================
export interface ConversationSummary {
  keyPoints: string[]; // 关键信息点
  sqlExecuted: string[]; // 执行过的 SQL
  lastUpdateTime: number;
}

// ==========================================
// 上下文管理器：负责组织和压缩对话历史
// ==========================================
export class ContextManager {
  // 基础系统提示词（固定人设）
  private readonly baseSystemPrompt: string;

  // 对话历史队列（短期记忆）
  private messageHistory: MessageUnit[] = [];

  // 最大保留轮次（1 轮 = user + assistant 各 1 条）
  private readonly maxRounds: number;

  // Token 计数器（简单估算）
  private readonly maxTokens: number = 10000; // 留给上下文的 token 预算

  constructor(options?: {
    baseSystemPrompt?: string;
    maxRounds?: number;
    maxTokens?: number;
  }) {
    this.baseSystemPrompt = options?.baseSystemPrompt || this.getDefaultSystemPrompt();
    this.maxRounds = options?.maxRounds || 8; // 默认 8 轮
    this.maxTokens = options?.maxTokens || 4000;

    // 初始化时注入基础系统提示词
    this.messageHistory.push({
      role: 'system',
      content: this.buildSystemPrompt(),
      timestamp: Date.now()
    });
  }

  /**
   * 获取默认系统提示词
   */
  private getDefaultSystemPrompt(): string {
    return `你是敦煌数据分析智能体，一位严谨、专业的顶尖数据分析专家。

## 🎯 核心任务与职责
1. **精准查询**：理解用户的自然语言意图，将其转化为安全的 SQL SELECT 命令，从数据库中提取客观数据。
2. **智能可视化**：根据查询到的数据特征（如时间序列、分类占比等），自主选择最合适的图表进行可视化呈现。
3. **客观解读**：对查询出的数据进行通俗易懂的自然语言描述。必须严格贴合客观数据事实，直接给出数据洞察与结论，绝不主观发散或编造。

## ⚙️ 标准工作流 (SOP)
在处理复杂的数据查询需求时，请严格按照以下顺序思考和行动：
1. **需求诊断**：收到指令后，快速界定需要查询的核心指标。
2. **嗅探表结构**：【必须】优先调用 getDatabaseSchema 了解物理表名、字段名及类型。绝对禁止凭空捏造表名和字段！
3. **编写与执行查询**：调用 executeSQL 执行纯查询操作。如遇 SQL 执行报错，你必须仔细阅读错误信息，自我反思并修正 SQL 后重新尝试。
4. **可视化研判**：如果用户需求包含“展示、画图、对比、趋势、分布、占比”等词汇，或者你判断该数据十分适合图形化展现，请务必调用 generateChartConfig。
5. **数据洞察总结**：结合查询结果，直接给出结论。

## 🚫 输出格式与行为红线（极度重要）
- **后台自动渲染**：【绝对不要】在最终的自然语言回复中输出 SQL 代码块！【绝对不要】输出 JSON 图表配置代码！只需口语化总结即可，工件系统会在后台自动渲染。
- **结构化保底**：如果没有触发图表工具，且数据量较少，必须使用 Markdown 表格或清晰的列表来呈现数据。
- **闲聊防御**：如果用户只是打招呼（如“你好”、“在吗”）或提出与数据查询无关的通用问题，请直接用自然语言友好回复，**绝对禁止调用任何工具**！

## 🚨 核心安全守则（最高优先级）
你当前运行在极度严格的【只读沙箱模式】下，你的主要职责是“查数据”而不是“改数据”。
当你调用 executeSQL 时，如果返回结果中包含“【系统安全拦截】”或“权限不足”等字眼，你必须：
1. **立即停止**尝试任何修改数据库的操作逻辑。
2. 使用以下标准统一的专业话术回复用户：
“⚠️ 抱歉，为了保障系统数据安全，我当前运行在严格的【只读沙箱模式】下，无法为您执行删除、修改等破坏性操作（如 DROP/DELETE/UPDATE 等）。我可以帮您执行 SELECT 查询来分析数据，请问您需要查询什么内容？”`;
  }

  /**
   * 构建完整的系统提示词（基础人设 + 动态状态）
   */
  private buildSystemPrompt(): string {
    const dynamicState = this.getDynamicState();
    return `${this.baseSystemPrompt}

## 当前状态
- 当前时间：${dynamicState.currentTime}
- 对话轮次：${dynamicState.conversationRound}
`;
  }

  /**
   * 获取动态状态信息
   */
  private getDynamicState(): { currentTime: string; conversationRound: number } {
    const now = new Date();
    const currentTime = now.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // 计算对话轮次（user+assistant 为 1 轮）
    const userMessages = this.messageHistory.filter(m => m.role === 'user').length;

    return {
      currentTime,
      conversationRound: userMessages
    };
  }

  /**
   * 添加用户消息到上下文
   */
  addUserMessage(content: string): void {
    this.messageHistory.push({
      role: 'user',
      content,
      timestamp: Date.now()
    });

    // 检查是否需要压缩
    this.trimIfNeeded();
  }

  /**
   * 添加助手消息到上下文
   */
  addAssistantMessage(content: string): void {
    this.messageHistory.push({
      role: 'assistant',
      content,
      timestamp: Date.now()
    });

    // 检查是否需要压缩
    this.trimIfNeeded();
  }

  /**
   * 当 token 超限时，修剪消息历史
   * 策略：保留最近的 N 轮对话 + 系统提示词
   */
  private trimIfNeeded(): void {
    const currentTokens = this.estimateTokens();

    if (currentTokens > this.maxTokens) {
      console.log(`[上下文] Token 数 ${currentTokens} 超过限制 ${this.maxTokens}，开始修剪...`);

      // 保留系统提示词
      const systemMessage = this.messageHistory[0];

      // 计算需要保留的消息数（从后往前）
      const maxMessages = this.maxRounds * 2 + 1; // N 轮对话 + 1 条系统消息

      // 从末尾截取
      const recentMessages = this.messageHistory.slice(-maxMessages);

      // 确保系统提示词在开头
      if (recentMessages[0]?.role !== 'system') {
        this.messageHistory = [systemMessage, ...recentMessages];
      } else {
        this.messageHistory = recentMessages;
      }

      console.log(`[上下文] 修剪后保留 ${this.messageHistory.length} 条消息`);
    }
  }

  /**
   * 简单估算 token 数
   */
  private estimateTokens(): number {
    let totalChars = 0;

    for (const msg of this.messageHistory) {
      const content = msg.content || '';
      totalChars += content.length;
    }

    // 粗略估算：中英文混合，平均 1 字符 ≈ 0.8 token
    return Math.floor(totalChars * 0.8);
  }

  /**
   * 获取完整的消息历史（用于发送给大模型）
   */
  getMessages(): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    // 更新系统提示词中的动态状态
    const messages = [...this.messageHistory];
    if (messages[0]?.role === 'system') {
      messages[0] = {
        role: 'system',
        content: this.buildSystemPrompt()
      };
    }

    const result = messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[];

    // 记录日志 - 详细输出当前上下文的完整内容
    this.logContext(result);

    // 保存当前上下文到 message.log（只显示最新上下文）
    logger.saveContext(result.map(msg => ({
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
      contentLength: typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length
    })));

    return result;
  }

  /**
   * 记录上下文日志到文件
   */
  private logContext(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): void {
    const stats = this.getStats();
    const contextSummary = messages.map((msg, index) => {
      const role = msg.role?.toUpperCase();
      const contentPreview = msg.content
        ? String(msg.content).substring(0, 200) + (String(msg.content).length > 200 ? '...' : '')
        : '[empty]';
      return `[${index}] ${role}: ${contentPreview}`;
    }).join('\n');

    logger.context('=== 上下文快照 ===', {
      conversationRounds: stats.conversationRounds,
      totalMessages: stats.totalMessages,
      estimatedTokens: stats.estimatedTokens,
      messages: messages.map((msg, i) => ({
        index: i,
        role: msg.role,
        contentLength: msg.content?.length || 0
      })),
      fullContext: contextSummary
    });
  }

  /**
   * 获取当前对话轮次
   */
  getConversationRound(): number {
    return this.messageHistory.filter(m => m.role === 'user').length;
  }

  /**
   * 清空对话历史（保留系统提示词）
   */
  clear(): void {
    this.messageHistory = [{
      role: 'system',
      content: this.buildSystemPrompt(),
      timestamp: Date.now()
    }];
  }

  /**
   * 获取历史统计信息
   */
  getStats(): {
    totalMessages: number;
    conversationRounds: number;
    estimatedTokens: number;
  } {
    return {
      totalMessages: this.messageHistory.length,
      conversationRounds: this.getConversationRound(),
      estimatedTokens: this.estimateTokens()
    };
  }
}

// ==========================================
// 全局单例：单用户会话模式
// ==========================================
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
