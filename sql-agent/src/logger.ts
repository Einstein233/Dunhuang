import * as fs from 'fs';
import * as path from 'path';
import { clearTraceLogs } from './trace-logger';
import { ensureParentDirectory, safeJSONStringify } from './safe-json';

const LOG_ROOT_DIR = path.resolve(__dirname, '../logs');
const LOG_FILE = path.join(LOG_ROOT_DIR, 'server.log');
const MESSAGE_LOG_FILE = path.join(LOG_ROOT_DIR, 'message.log');

export enum LogLevel {
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  CONTEXT = 'CONTEXT',
  TOOL = 'TOOL',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  data?: unknown;
}

class Logger {
  private logBuffer: LogEntry[] = [];
  private readonly maxBufferSize = 100;
  private initialized = false;

  init(): void {
    if (this.initialized) {
      return;
    }

    ensureParentDirectory(LOG_FILE);
    ensureParentDirectory(MESSAGE_LOG_FILE);

    if (!fs.existsSync(LOG_FILE)) {
      fs.writeFileSync(LOG_FILE, '', 'utf8');
    }

    if (!fs.existsSync(MESSAGE_LOG_FILE)) {
      fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf8');
    }

    this.initialized = true;
  }

  log(level: LogLevel, message: string, data?: unknown): void {
    this.init();

    const entry: LogEntry = {
      timestamp: new Date().toLocaleString('zh-CN'),
      level,
      message,
      data,
    };

    this.logBuffer.push(entry);
    if (this.logBuffer.length > this.maxBufferSize) {
      this.logBuffer.shift();
    }

    this.writeToFile(entry);
  }

  private writeToFile(entry: LogEntry): void {
    try {
      fs.appendFileSync(LOG_FILE, `${this.formatLogLine(entry)}\n`, 'utf8');
    } catch (error) {
      console.error('写入 server.log 失败:', error);
    }
  }

  private formatLogLine(entry: LogEntry): string {
    const header = `[${entry.timestamp}] [${entry.level}] ${entry.message}`;
    if (typeof entry.data === 'undefined') {
      return header;
    }

    const dataText =
      typeof entry.data === 'string' ? entry.data : safeJSONStringify(entry.data, 2);
    return `${header}\n${dataText}`;
  }

  clear(): void {
    this.init();
    this.logBuffer = [];

    try {
      fs.writeFileSync(LOG_FILE, '', 'utf8');
      fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf8');
      clearTraceLogs();
      this.initialized = false;
      this.init();
    } catch (error) {
      console.error('清空日志失败:', error);
      throw error;
    }
  }

  saveContext(messages: { role: string; content: string | null; contentLength?: number }[]): void {
    this.init();

    const timestamp = new Date().toLocaleString('zh-CN');
    let content = `=== 当前上下文快照（更新时间：${timestamp}） ===\n\n`;
    content += `总消息数：${messages.length}\n`;
    content += `${'='.repeat(60)}\n\n`;

    messages.forEach((message, index) => {
      const role = message.role?.toUpperCase() || 'UNKNOWN';
      const contentLength = message.content?.length || 0;
      const preview = message.content
        ? String(message.content).substring(0, 4000) +
          (contentLength > 4000 ? '\n...(截断)' : '')
        : '[空内容]';

      content += `[${index}] ${role} (长度：${contentLength} 字符)\n`;
      content += `${'-'.repeat(40)}\n`;
      content += `${preview}\n\n`;
    });

    try {
      fs.writeFileSync(MESSAGE_LOG_FILE, content, 'utf8');
    } catch (error) {
      console.error('写入 message.log 失败:', error);
    }
  }

  getRecent(count: number = 50): LogEntry[] {
    return this.logBuffer.slice(-count);
  }

  getPaths(): { serverLogFile: string; messageLogFile: string } {
    return {
      serverLogFile: LOG_FILE,
      messageLogFile: MESSAGE_LOG_FILE,
    };
  }
}

const globalLogger = new Logger();

export const logger = {
  init: () => globalLogger.init(),
  info: (message: string, data?: unknown) => globalLogger.log(LogLevel.INFO, message, data),
  debug: (message: string, data?: unknown) => globalLogger.log(LogLevel.DEBUG, message, data),
  context: (message: string, data?: unknown) => globalLogger.log(LogLevel.CONTEXT, message, data),
  tool: (message: string, data?: unknown) => globalLogger.log(LogLevel.TOOL, message, data),
  error: (message: string, data?: unknown) => globalLogger.log(LogLevel.ERROR, message, data),
  clear: () => globalLogger.clear(),
  getRecent: (count?: number) => globalLogger.getRecent(count),
  saveContext: (messages: { role: string; content: string | null; contentLength?: number }[]) =>
    globalLogger.saveContext(messages),
  getPaths: () => globalLogger.getPaths(),
};
