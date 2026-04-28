"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContextManager = void 0;
exports.getGlobalContext = getGlobalContext;
exports.resetGlobalContext = resetGlobalContext;
const logger_1 = require("./logger");
// ==========================================
// 上下文管理器：负责组织和压缩对话历史
// ==========================================
class ContextManager {
    constructor(options) {
        // 对话历史队列（短期记忆）
        this.messageHistory = [];
        // Token 计数器（简单估算）
        this.maxTokens = 10000; // 留给上下文的 token 预算
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
    getDefaultSystemPrompt() {
        return `你是敦煌智能体，一个专业的数据库查询助手。

## 核心能力
1. 理解用户的自然语言问题，转化为 SQL 查询
2. 执行 SQL 并解释查询结果
3. 根据数据生成可视化图表

## 工作流程
1. **分析需求**：先说明你理解的问题和需要的数据
2. **查看表结构**：调用 getDatabaseSchema 了解可用的表和字段
3. **编写 SQL**：在内部生成 SQL 语句（不要展示给用户）
4. **执行查询**：调用 executeSQL 执行 SQL
5. **解释结果**：用通俗语言说明查询结果的含义
6. **可视化**：如果用户需要图表，调用 generateChartConfig

## 回答格式要求
- **不要**在回复中写 SQL 代码块（SQL 会由系统在后台执行）
- **不要**在回复中写 JSON 图表配置（图表会由系统自动生成）
- 数据结果用表格或结构化方式呈现
- 最终给出明确的结论或建议`;
    }
    /**
     * 构建完整的系统提示词（基础人设 + 动态状态）
     */
    buildSystemPrompt() {
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
    getDynamicState() {
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
    addUserMessage(content) {
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
    addAssistantMessage(content) {
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
    trimIfNeeded() {
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
            }
            else {
                this.messageHistory = recentMessages;
            }
            console.log(`[上下文] 修剪后保留 ${this.messageHistory.length} 条消息`);
        }
    }
    /**
     * 简单估算 token 数
     */
    estimateTokens() {
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
    getMessages() {
        // 更新系统提示词中的动态状态
        const messages = [...this.messageHistory];
        if (messages[0]?.role === 'system') {
            messages[0] = {
                role: 'system',
                content: this.buildSystemPrompt()
            };
        }
        const result = messages;
        // 记录日志 - 详细输出当前上下文的完整内容
        this.logContext(result);
        // 保存当前上下文到 message.log（只显示最新上下文）
        logger_1.logger.saveContext(result.map(msg => ({
            role: msg.role,
            content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
            contentLength: typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length
        })));
        return result;
    }
    /**
     * 记录上下文日志到文件
     */
    logContext(messages) {
        const stats = this.getStats();
        const contextSummary = messages.map((msg, index) => {
            const role = msg.role?.toUpperCase();
            const contentPreview = msg.content
                ? String(msg.content).substring(0, 200) + (String(msg.content).length > 200 ? '...' : '')
                : '[empty]';
            return `[${index}] ${role}: ${contentPreview}`;
        }).join('\n');
        logger_1.logger.context('=== 上下文快照 ===', {
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
    getConversationRound() {
        return this.messageHistory.filter(m => m.role === 'user').length;
    }
    /**
     * 清空对话历史（保留系统提示词）
     */
    clear() {
        this.messageHistory = [{
                role: 'system',
                content: this.buildSystemPrompt(),
                timestamp: Date.now()
            }];
    }
    /**
     * 获取历史统计信息
     */
    getStats() {
        return {
            totalMessages: this.messageHistory.length,
            conversationRounds: this.getConversationRound(),
            estimatedTokens: this.estimateTokens()
        };
    }
}
exports.ContextManager = ContextManager;
// ==========================================
// 全局单例：单用户会话模式
// ==========================================
let globalContextManager = null;
function getGlobalContext() {
    if (!globalContextManager) {
        globalContextManager = new ContextManager();
    }
    return globalContextManager;
}
function resetGlobalContext() {
    globalContextManager?.clear();
}
