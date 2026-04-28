import {
  executeSQL as unsafeExecuteSQL,
  executeSQLWithCallback as unsafeExecuteSQLWithCallback,
  generateChartConfig,
  getDatabaseSchema,
  type ChartType,
} from './tool-runtime';
import { validateReadOnlySQL } from './sql-guard';

type QueryResultRow = Record<string, unknown>;

export { generateChartConfig, getDatabaseSchema };
export type { ChartType };

export async function executeSQL(query: string): Promise<string> {
  const result = await executeSQLWithCallback(query);
  return result.text;
}

export async function executeSQLWithCallback(query: string): Promise<{
  text: string;
  data: QueryResultRow[] | null;
  error: string | null;
  rowCount: number;
}> {
  const validation = validateReadOnlySQL(query);

  if (!validation.allowed) {
    return {
      text: validation.message,
      data: null,
      error: validation.message,
      rowCount: 0,
    };
  }

  return unsafeExecuteSQLWithCallback(validation.normalizedSql);
}

export async function executeValidatedSQL(query: string): Promise<string> {
  const validation = validateReadOnlySQL(query);

  if (!validation.allowed) {
    return validation.message;
  }

  return unsafeExecuteSQL(validation.normalizedSql);
}
