import https from 'https';
import * as dotenv from 'dotenv';
import type { AgentHistoryItem, AgentMessage } from './types';

dotenv.config();

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: 'assistant';
      content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

export interface SQLBuildResult {
  sql: string;
  reason: Record<string, unknown>;
  rawContent: string;
}

const modelName = process.env.QWEN_MODEL || 'qwen3.6-plus';
const apiKey = process.env.QWEN_API_KEY;
const baseUrl = process.env.QWEN_BASE_URL;

function buildChatCompletionUrl(): URL {
  if (!baseUrl) {
    throw new Error('QWEN_BASE_URL is not configured.');
  }

  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL('chat/completions', normalizedBase);
}

function buildHistoryText(history: AgentHistoryItem[]): string {
  if (history.length === 0) {
    return '暂无历史对话。';
  }

  return history
    .slice(-6)
    .map((item, index) => `${index + 1}. [${item.role === 'user' ? '用户' : '助手'}] ${item.content}`)
    .join('\n');
}

function sanitizeSQLDraft(content: string): string {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return candidate.replace(/^\s*sql\s*/i, '').trim();
}

function extractJSONObject(text: string): string {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('LLM output does not contain a valid JSON object.');
  }

  return candidate.slice(firstBrace, lastBrace + 1);
}

function parseStructuredResult(content: string): SQLBuildResult {
  const jsonText = extractJSONObject(content);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    throw new Error(
      `Failed to parse SQL builder JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('SQL builder output must be a JSON object.');
  }

  const typed = parsed as {
    sql?: unknown;
    reason?: unknown;
    reasoning?: unknown;
  };

  if (typeof typed.sql !== 'string' || !typed.sql.trim()) {
    throw new Error('SQL builder output is missing a non-empty "sql" field.');
  }

  const reasonSource = typed.reason ?? typed.reasoning;
  const reason =
    reasonSource && typeof reasonSource === 'object' && !Array.isArray(reasonSource)
      ? (reasonSource as Record<string, unknown>)
      : {};

  return {
    sql: sanitizeSQLDraft(typed.sql),
    reason,
    rawContent: content,
  };
}

function callModel(messages: AgentMessage[]): Promise<ChatCompletionResponse> {
  if (!apiKey) {
    return Promise.reject(new Error('QWEN_API_KEY is not configured.'));
  }

  const requestBody = JSON.stringify({
    model: modelName,
    messages,
    temperature: 0.1,
  });
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
            resolve(JSON.parse(raw) as ChatCompletionResponse);
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

export async function buildSQLDraft(params: {
  userQuery: string;
  schemaText: string;
  history?: AgentHistoryItem[];
  previousReason?: Record<string, unknown>;
}): Promise<SQLBuildResult> {
  const systemPrompt = `
你是一个严格受约束的 MySQL SQL 生成器。
你的任务是根据以下信息生成一条正确的 SELECT 查询：
1. 用户问题
2. 最近的对话历史
3. 实时数据库 schema

规则：
1. 只能生成 SELECT SQL。
2. 绝对不要生成 INSERT、UPDATE、DELETE、DROP、ALTER、CREATE、REPLACE、TRUNCATE 或任何写操作。
3. 只能使用 schema 中真实存在的表名、视图名和字段名。
4. 当前统一气象事实表是 weather_data。
5. 当前地区映射表主要是 station_info 和 weather_directory。
6. 查询气象指标时，优先使用 weather_data；需要地区名称时，再与 station_info 或 weather_directory 关联。
7. 查询可用地区、时间覆盖范围、记录条数时，优先使用 weather_directory。
8. 小时级数据通常使用 granularity = 2。
9. 当前地区过滤优先使用 city、province，不要再使用历史上的 region_name。
10. 历史上的 station、weather_observation、weather_observation_hourly、vw_weather_query，以及“每个地区一张表”的旧结构，不应作为当前主查询结构。
11. 如果用户提到的字段不在实时 schema 中，必须改用 schema 里实际存在的字段。
12. 必须只输出合法 JSON，不要输出 Markdown，不要输出 JSON 之外的说明。
13. reason.notes 必须使用中文。

输出格式必须严格如下：
{
  "sql": "最终 SQL 语句",
  "reason": {
    "table": "选中的表或关联结构",
    "region": "解析后的地区值",
    "metric": "选中的指标字段",
    "aggregation": "选中的聚合方式或 null",
    "time_range": {
      "start": "起始时间，如适用",
      "end": "结束时间，如适用"
    },
    "notes": ["关键推理说明，必须为中文"]
  }
}

示例 1：
{
  "sql": "SELECT AVG(wd.avg_temperature) AS avg_temperature FROM weather_data wd JOIN station_info si ON si.station_code = wd.station_code AND si.granularity = wd.granularity WHERE si.city = '敦煌' AND wd.granularity = 2 AND wd.record_time >= '2024-01-01 00:00:00' AND wd.record_time < '2024-02-01 00:00:00';",
  "reason": {
    "table": "weather_data JOIN station_info",
    "region": "敦煌",
    "metric": "avg_temperature",
    "aggregation": "AVG",
    "time_range": {
      "start": "2024-01-01",
      "end": "2024-02-01"
    },
    "notes": [
      "当前结构中气象指标来自 weather_data",
      "地区名称通过 station_info 与 weather_data 关联",
      "小时级数据显式限制 granularity = 2"
    ]
  }
}

示例 2：
{
  "sql": "SELECT DATE_FORMAT(wd.record_time, '%Y-%m') AS month, AVG(wd.avg_temperature) AS avg_temperature FROM weather_data wd JOIN station_info si ON si.station_code = wd.station_code AND si.granularity = wd.granularity WHERE si.city = '北京' AND wd.granularity = 2 AND wd.record_time >= '2024-01-01 00:00:00' AND wd.record_time < '2024-07-01 00:00:00' GROUP BY month ORDER BY month;",
  "reason": {
    "table": "weather_data JOIN station_info",
    "region": "北京",
    "metric": "avg_temperature",
    "aggregation": "AVG",
    "time_range": {
      "start": "2024-01-01",
      "end": "2024-07-01"
    },
    "notes": [
      "按月聚合时可以使用 DATE_FORMAT(record_time, '%Y-%m')",
      "地区过滤通过 station_info 与 weather_data 的关联完成"
    ]
  }
}`;

  const userPrompt = [
    `用户问题：\n${params.userQuery}`,
    '',
    `最近对话历史：\n${buildHistoryText(params.history ?? [])}`,
    '',
    `实时数据库结构：\n${params.schemaText}`,
    '',
    params.previousReason
      ? `上一次失败的推理信息（供参考）：\n${JSON.stringify(params.previousReason, null, 2)}`
      : '上一次失败的推理信息（供参考）：\n无。',
    '',
    '请只返回合法 JSON。',
  ].join('\n');

  const messages: AgentMessage[] = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userPrompt,
    },
  ];

  const response = await callModel(messages);

  if (response.error?.message) {
    throw new Error(response.error.message);
  }

  const content = response.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM did not return SQL builder content.');
  }

  return parseStructuredResult(content);
}
