import * as fs from 'fs';
import * as path from 'path';

// 日志文件路径 - 使用 __dirname 确保路径正确
const LOG_FILE = path.resolve(__dirname, '../server.log');
const MESSAGE_LOG_FILE = path.resolve(__dirname, '../message.log');

/**
 * 日志级别
 */
export enum LogLevel {
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  CONTEXT = 'CONTEXT',
  TOOL = 'TOOL',
  ERROR = 'ERROR'
}

/**
 * 日志条目
 */
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: any;
}

/**
 * 日志记录器
 */
class Logger {
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize: number = 100; // 内存中最多保留 100 条
  private initialized: boolean = false;

  /**
   * 初始化日志文件
   */
  private init(): void {
    if (!this.initialized) {
      console.log(`[Logger] 日志文件路径：${LOG_FILE}`);
      // 确保文件存在
      try {
        if (!fs.existsSync(LOG_FILE)) {
          fs.writeFileSync(LOG_FILE, '', 'utf-8');
        }
        this.initialized = true;
      } catch (error) {
        console.error('初始化日志文件失败:', error);
      }
    }
  }

  /**
   * 初始化 message.log 文件
   */
  private initMessageLog(): void {
    try {
      if (!fs.existsSync(MESSAGE_LOG_FILE)) {
        fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf-8');
      }
    } catch (error) {
      console.error('初始化 message.log 失败:', error);
    }
  }

  /**
   * 写入日志
   */
  log(level: LogLevel, message: string, data?: any): void {
    this.init();

    const entry: LogEntry = {
      timestamp: new Date().toLocaleString('zh-CN'),
      level,
      message,
      data
    };

    this.logBuffer.push(entry);

    // 保持缓冲区大小
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    // 同步写入文件
    this.writeToFile(entry);
  }

  /**
   * 写入文件
   */
  private writeToFile(entry: LogEntry): void {
    const logLine = this.formatLogLine(entry);

    try {
      fs.appendFileSync(LOG_FILE, logLine + '\n', 'utf-8');
    } catch (error) {
      console.error('写入日志失败:', error, '文件路径:', LOG_FILE);
    }
  }

  /**
   * 格式化日志行
   */
  private formatLogLine(entry: LogEntry): string {
    const header = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;

    if (entry.data) {
      const dataStr = typeof entry.data === 'string'
        ? entry.data
        : JSON.stringify(entry.data, null, 2);
      return `${header}\n${dataStr}`;
    }

    return header;
  }

  /**
   * 清空日志文件（同时清空 server.log 和 message.log）
   */
  clear(): void {
    this.logBuffer = [];
    try {
      fs.writeFileSync(LOG_FILE, '', 'utf-8');
      fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf-8');
      console.log('日志文件已清空（server.log + message.log）');
    } catch (error) {
      console.error('清空日志失败:', error);
    }
  }

  /**
   * 保存当前上下文消息到 message.log（覆盖模式，只显示最新上下文）
   */
  saveContext(messages: { role: string; content: string | null; contentLength?: number }[]): void {
    console.log(`[saveContext] 被调用，消息数：${messages.length}`);
    this.initMessageLog();

    const timestamp = new Date().toLocaleString('zh-CN');
    let content = `=== 当前上下文快照 (更新时间：${timestamp}) ===\n\n`;
    content += `总消息数：${messages.length}\n`;
    content += `${'─'.repeat(60)}\n\n`;

    messages.forEach((msg, index) => {
      const role = msg.role?.toUpperCase() || 'UNKNOWN';
      const contentLength = msg.content?.length || 0;
      const preview = msg.content
        ? String(msg.content).substring(0, 500) + (contentLength > 500 ? '\n...(截断)' : '')
        : '[空内容]';

      content += `[${index}] ${role} (长度：${contentLength} 字符)\n`;
      content += `${'─'.repeat(40)}\n`;
      content += `${preview}\n\n`;
    });

    try {
      // 覆盖写入，只显示最新上下文
      fs.writeFileSync(MESSAGE_LOG_FILE, content, 'utf-8');
    } catch (error) {
      console.error('写入 message.log 失败:', error);
    }
  }

  /**
   * 获取最近的日志
   */
  getRecent(count: number = 50): LogEntry[] {
    return this.logBuffer.slice(-count);
  }
}

// 全局单例
const globalLogger = new Logger();

export const logger = {
  info: (message: string, data?: any) => globalLogger.log(LogLevel.INFO, message, data),
  debug: (message: string, data?: any) => globalLogger.log(LogLevel.DEBUG, message, data),
  context: (message: string, data?: any) => globalLogger.log(LogLevel.CONTEXT, message, data),
  tool: (message: string, data?: any) => globalLogger.log(LogLevel.TOOL, message, data),
  error: (message: string, data?: any) => globalLogger.log(LogLevel.ERROR, message, data),
  clear: () => globalLogger.clear(),
  getRecent: (count?: number) => globalLogger.getRecent(count),
  saveContext: (messages: { role: string; content: string | null; contentLength?: number }[]) => globalLogger.saveContext(messages)
};
