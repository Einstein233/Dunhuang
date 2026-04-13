"use strict";
// ==========================================
// SSE 流式消息协议类型定义
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.SSEMessageType = void 0;
/**
 * SSE 消息类型枚举
 */
var SSEMessageType;
(function (SSEMessageType) {
    SSEMessageType["THINKING"] = "thinking";
    SSEMessageType["TOOL_START"] = "tool_start";
    SSEMessageType["TOOL_RESULT"] = "tool_result";
    SSEMessageType["TABLE"] = "table";
    SSEMessageType["CHART"] = "chart";
    SSEMessageType["SQL"] = "sql";
    SSEMessageType["TEXT"] = "text";
    SSEMessageType["DONE"] = "done";
    SSEMessageType["ERROR"] = "error"; // 错误消息
})(SSEMessageType || (exports.SSEMessageType = SSEMessageType = {}));
