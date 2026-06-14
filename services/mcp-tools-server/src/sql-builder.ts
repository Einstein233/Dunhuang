import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

interface SQLBuilderInput {
  query: string;
  schema: string;
}

interface SQLBuilderOutput {
  sql: string;
  reason: {
    table?: string;
    region?: string;
    metric?: string;
    aggregation?: string;
    time_range?: string;
    notes?: string;
  };
}

function buildSQLPrompt(input: SQLBuilderInput): string {
  return `你是一位精通 MySQL 的高级数据工程师。请根据用户的自然语言问题和数据库结构，生成一条准确的 SELECT 查询。

## 用户问题
${input.query}

## 数据库结构
${input.schema}

## 约束规则
1. 只能生成 SELECT 语句，禁止任何写操作（INSERT/UPDATE/DELETE/DROP/ALTER 等）
2. 所有表名和字段名必须存在于上述 Schema 中，不要编造字段名
3. 查询地区信息时，优先使用 \`station_info.city\` 或 \`station_info.province\`
4. 小时级数据需要加上 \`WHERE granularity = 2\`
5. 时间过滤使用 \`record_time BETWEEN 'start' AND 'end'\` 或 \`record_time >= '...' AND record_time < '...'\`
6. 如果需要聚合，必须 GROUP BY；如果需要排序，必须 ORDER BY
7. 表别名: weather_data → wd, station_info → si, weather_directory → wdir
8. 所有表名和字段名使用反引号转义（如 \`weather_data\`.\`record_time\`）
9. 查询结果默认最多 100 行（加 LIMIT 100），除非用户明确要求更多
10. 当前统一气象事实表是 \`weather_data\`，地区映射表是 \`station_info\`
11. 地区名称使用中文，如"敦煌"而不是"dunhuang"
12. 如果查询涉及按城市过滤，使用 JOIN:
    \`weather_data wd JOIN station_info si ON si.station_code = wd.station_code AND si.granularity = wd.granularity\`
13. 如果查询结果可能很大（例如全年逐小时数据），请考虑使用聚合函数（AVG/MAX/MIN/SUM/COUNT）和 GROUP BY 减少结果行数

## 输出格式（严格 JSON）
{
  "sql": "生成的 SQL 语句",
  "reason": {
    "table": "使用的表名",
    "region": "涉及的地区（如有）",
    "metric": "查询的指标（如有）",
    "aggregation": "聚合方式（如有）",
    "time_range": "时间范围（如有）",
    "notes": "其他说明"
  }
}

请直接输出 JSON，不要包含其他内容。`;
}

function callLLM(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.QWEN_API_KEY;
    const baseUrl = process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const model = process.env.QWEN_MODEL || 'qwen-plus';

    if (!apiKey) {
      reject(new Error('QWEN_API_KEY 未配置'));
      return;
    }

    const url = new URL(`${baseUrl}/chat/completions`);
    const payload = JSON.stringify({
      model,
      messages: [
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
    });

    const isHttps = url.protocol === 'https:';
    const requestModule = isHttps ? https : http;

    const req = requestModule.request(
      {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const json = JSON.parse(body);
            const content = json.choices?.[0]?.message?.content;
            if (!content) {
              reject(new Error(`LLM 返回为空: ${body.slice(0, 200)}`));
              return;
            }
            resolve(content);
          } catch (err) {
            reject(new Error(`解析 LLM 响应失败: ${err instanceof Error ? err.message : err}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractJSON(text: string): object {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }
  throw new Error('无法从 LLM 响应中提取 JSON');
}

export async function buildSQLDraft(input: SQLBuilderInput): Promise<SQLBuilderOutput> {
  const prompt = buildSQLPrompt(input);
  const response = await callLLM(prompt);
  const parsed = extractJSON(response) as SQLBuilderOutput;

  if (!parsed.sql || typeof parsed.sql !== 'string') {
    throw new Error('LLM 未返回有效的 SQL 语句');
  }

  return parsed;
}
