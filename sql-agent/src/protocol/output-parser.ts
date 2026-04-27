import type { ReasonNodeParsedOutput } from '../types';
import type { ReasonNodeRawResponse } from './model-invoker';

function parseToolArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function outputParser(rawResponse: ReasonNodeRawResponse): ReasonNodeParsedOutput {
  if (rawResponse.error?.message) {
    return {
      action: 'invalid',
      error: rawResponse.error.message,
    };
  }

  const message = rawResponse.choices?.[0]?.message;
  if (!message) {
    return {
      action: 'invalid',
      error: 'Reason node received an empty model message.',
    };
  }

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCall = message.tool_calls[0];

    return {
      action: 'tool_call',
      toolName: toolCall.function.name,
      arguments: parseToolArgs(toolCall.function.arguments),
      rawContent: message.content ?? '',
      rawToolCalls: message.tool_calls,
    };
  }

  if (message.content) {
    return {
      action: 'final_answer',
      answer: message.content,
      rawContent: message.content,
      rawToolCalls: message.tool_calls,
    };
  }

  return {
    action: 'invalid',
    error: 'Model returned neither a tool call nor a final answer.',
    rawContent: message.content ?? '',
    rawToolCalls: message.tool_calls,
  };
}
