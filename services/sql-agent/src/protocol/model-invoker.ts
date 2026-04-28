import https from 'https';
import * as dotenv from 'dotenv';
import { stateToolDefinitions } from '../state-tools';
import type { AgentMessage, AgentState, AgentToolCall } from '../types';

dotenv.config();

export type ReasonNodeRawResponse = {
  choices?: Array<{
    message?: {
      role?: 'assistant';
      content?: string | null;
      tool_calls?: AgentToolCall[];
    };
  }>;
  error?: {
    message?: string;
  };
};

const modelName = process.env.QWEN_MODEL || 'qwen3.6-plus';
const apiKey = process.env.QWEN_API_KEY;
const baseUrl = process.env.QWEN_BASE_URL;

function buildChatCompletionUrl(): URL {
  if (!apiKey || !baseUrl) {
    throw new Error('QWEN_API_KEY or QWEN_BASE_URL is not configured.');
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalizedBase);
}

function buildModelPayload(messages: AgentMessage[]): string {
  return JSON.stringify({
    model: modelName,
    messages,
    tools: stateToolDefinitions,
    temperature: 0.1,
  });
}

export async function modelInvoker(
  messages: AgentMessage[],
  _state: AgentState
): Promise<ReasonNodeRawResponse> {
  const requestBody = buildModelPayload(messages);
  const endpoint = buildChatCompletionUrl();

  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: `${endpoint.pathname}${endpoint.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
          Authorization: `Bearer ${apiKey}`,
        },
      },
      (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          raw += chunk;
        });
        response.on('end', () => {
          const statusCode = response.statusCode || 500;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new Error(`LLM request failed (${statusCode}): ${raw}`));
            return;
          }

          try {
            resolve(JSON.parse(raw) as ReasonNodeRawResponse);
          } catch (error) {
            reject(
              new Error(
                `Failed to parse LLM response: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            );
          }
        });
      }
    );

    request.on('error', reject);
    request.write(requestBody);
    request.end();
  });
}
