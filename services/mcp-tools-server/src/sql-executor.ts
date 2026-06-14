import { pool, normalizeValue, sqlTimeoutMs, maxResultRows } from './db-pool';

type QueryResultRow = Record<string, unknown>;

export interface ExecuteSQLResult {
  text: string;
  data: QueryResultRow[] | null;
  error: string | null;
  rowCount: number;
  columns: string[] | null;
  durationMs: number;
}

export async function executeSQL(query: string): Promise<ExecuteSQLResult> {
  console.log(`\n[tool] executeSQL:\n${query}\n`);

  const startedAt = Date.now();

  try {
    const [rawResult] = await pool.query({
      sql: query,
      timeout: sqlTimeoutMs,
    });

    const normalizedRows = normalizeValue(rawResult) as QueryResultRow[];
    const truncated = normalizedRows.length > maxResultRows;
    const resultRows = truncated ? normalizedRows.slice(0, maxResultRows) : normalizedRows;
    const columns = resultRows.length > 0 ? Object.keys(resultRows[0]) : [];

    const durationMs = Date.now() - startedAt;

    const message = truncated
      ? `查询成功，结果已截断（共 ${normalizedRows.length} 行，仅返回前 ${maxResultRows} 行）。`
      : `查询成功，共返回 ${resultRows.length} 行。`;

    console.log(`[tool] executeSQL completed in ${durationMs}ms, ${resultRows.length} rows`);

    return {
      text: message,
      data: resultRows,
      error: null,
      rowCount: resultRows.length,
      columns,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : 'Unknown SQL error';

    let errorText = `SQL 执行报错：${message}`;
    if (message.includes('timeout')) {
      errorText = `SQL 执行超时（${sqlTimeoutMs}ms），请缩小查询范围后重试。`;
    }

    console.error(`[tool] executeSQL failed in ${durationMs}ms: ${message}`);

    return {
      text: errorText,
      data: null,
      error: message,
      rowCount: 0,
      columns: null,
      durationMs,
    };
  }
}
