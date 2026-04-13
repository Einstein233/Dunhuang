"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = exports.LogLevel = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 日志文件路径 - 使用 __dirname 确保路径正确
const LOG_FILE = path.resolve(__dirname, '../server.log');
const MESSAGE_LOG_FILE = path.resolve(__dirname, '../message.log');
/**
 * 日志级别
 */
var LogLevel;
(function (LogLevel) {
    LogLevel["INFO"] = "INFO";
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["CONTEXT"] = "CONTEXT";
    LogLevel["TOOL"] = "TOOL";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/**
 * 日志记录器
 */
class Logger {
    constructor() {
        this.logBuffer = [];
        this.maxBufferSize = 100; // 内存中最多保留 100 条
        this.initialized = false;
    }
    /**
     * 初始化日志文件
     */
    init() {
        if (!this.initialized) {
            console.log(`[Logger] 日志文件路径：${LOG_FILE}`);
            // 确保文件存在
            try {
                if (!fs.existsSync(LOG_FILE)) {
                    fs.writeFileSync(LOG_FILE, '', 'utf-8');
                }
                this.initialized = true;
            }
            catch (error) {
                console.error('初始化日志文件失败:', error);
            }
        }
    }
    /**
     * 初始化 message.log 文件
     */
    initMessageLog() {
        try {
            if (!fs.existsSync(MESSAGE_LOG_FILE)) {
                fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf-8');
            }
        }
        catch (error) {
            console.error('初始化 message.log 失败:', error);
        }
    }
    /**
     * 写入日志
     */
    log(level, message, data) {
        this.init();
        const entry = {
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
    writeToFile(entry) {
        const logLine = this.formatLogLine(entry);
        try {
            fs.appendFileSync(LOG_FILE, logLine + '\n', 'utf-8');
        }
        catch (error) {
            console.error('写入日志失败:', error, '文件路径:', LOG_FILE);
        }
    }
    /**
     * 格式化日志行
     */
    formatLogLine(entry) {
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
    clear() {
        this.logBuffer = [];
        try {
            fs.writeFileSync(LOG_FILE, '', 'utf-8');
            fs.writeFileSync(MESSAGE_LOG_FILE, '', 'utf-8');
            console.log('日志文件已清空（server.log + message.log）');
        }
        catch (error) {
            console.error('清空日志失败:', error);
        }
    }
    /**
     * 保存当前上下文消息到 message.log（覆盖模式，只显示最新上下文）
     */
    saveContext(messages) {
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
        }
        catch (error) {
            console.error('写入 message.log 失败:', error);
        }
    }
    /**
     * 获取最近的日志
     */
    getRecent(count = 50) {
        return this.logBuffer.slice(-count);
    }
}
// 全局单例
const globalLogger = new Logger();
exports.logger = {
    info: (message, data) => globalLogger.log(LogLevel.INFO, message, data),
    debug: (message, data) => globalLogger.log(LogLevel.DEBUG, message, data),
    context: (message, data) => globalLogger.log(LogLevel.CONTEXT, message, data),
    tool: (message, data) => globalLogger.log(LogLevel.TOOL, message, data),
    error: (message, data) => globalLogger.log(LogLevel.ERROR, message, data),
    clear: () => globalLogger.clear(),
    getRecent: (count) => globalLogger.getRecent(count),
    saveContext: (messages) => globalLogger.saveContext(messages)
};
