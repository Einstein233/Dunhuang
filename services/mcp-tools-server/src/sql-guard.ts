import dotenv from 'dotenv';

dotenv.config();

const WRITE_KEYWORDS = [
  'INSERT',
  'UPDATE',
  'DELETE',
  'DROP',
  'TRUNCATE',
  'ALTER',
  'CREATE',
  'REPLACE',
  'GRANT',
  'REVOKE',
  'CALL',
  'PREPARE',
  'EXECUTE',
  'HANDLER',
  'DO',
  'SET',
  'USE',
  'LOCK',
  'UNLOCK',
  'ANALYZE',
  'OPTIMIZE',
  'REPAIR',
  'INSTALL',
  'UNINSTALL',
];

const DANGEROUS_PATTERNS = [
  { pattern: /\bINTO\s+OUTFILE\b/i, description: 'INTO OUTFILE is forbidden' },
  { pattern: /\bINTO\s+DUMPFILE\b/i, description: 'INTO DUMPFILE is forbidden' },
  { pattern: /\bLOAD_FILE\s*\(/i, description: 'LOAD_FILE is forbidden' },
  { pattern: /\bSLEEP\s*\(/i, description: 'SLEEP is forbidden' },
  { pattern: /\bBENCHMARK\s*\(/i, description: 'BENCHMARK is forbidden' },
  { pattern: /\bGET_LOCK\s*\(/i, description: 'GET_LOCK is forbidden' },
  { pattern: /\bRELEASE_LOCK\s*\(/i, description: 'RELEASE_LOCK is forbidden' },
  { pattern: /@\w+/i, description: 'User variables are forbidden' },
];

const FORBIDDEN_SCHEMAS = ['information_schema', 'mysql', 'performance_schema', 'sys'];

const DEFAULT_ALLOWED_TABLES = [
  'conditions',
  'dict',
  'dict_item',
  'ditor',
  'files',
  'more',
  'roles',
  'router_menu',
  'tests',
  'theme',
  'user',
  'weather_data',
  'weather_directory',
  'station_info',
];

const DEFAULT_ALLOWED_SCHEMAS = ['dunhuang_agent'];

function parseAllowedTables(): Set<string> {
  const envValue = process.env.SQL_AGENT_ALLOWED_TABLES;
  if (!envValue) {
    return new Set(DEFAULT_ALLOWED_TABLES);
  }
  return new Set(envValue.split(',').map((table) => table.trim().toLowerCase()));
}

function parseAllowedSchemas(): Set<string> {
  const envValue = process.env.SQL_AGENT_ALLOWED_SCHEMAS;
  if (!envValue) {
    return new Set(DEFAULT_ALLOWED_SCHEMAS);
  }
  return new Set(envValue.split(',').map((schema) => schema.trim().toLowerCase()));
}

function stripComments(sql: string): string {
  let result = sql;
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  result = result.replace(/--[^\n]*/g, '');
  result = result.replace(/#[^\n]*/g, '');
  return result;
}

function extractTableName(sql: string, keyword: string): string[] {
  const pattern = "\\b" + keyword + "\\s+(`?\\w+`?(?:\\.`?\\w+`?)?)";
  const regex = new RegExp(pattern, 'gi');
  const matches: string[] = [];
  let match;

  while ((match = regex.exec(sql)) !== null) {
    matches.push(match[1].replace(/`/g, ''));
  }

  return matches;
}

function normalizeTableName(name: string): string {
  const parts = name.split('.');
  return parts[parts.length - 1].toLowerCase();
}

export function validateReadOnlySQL(sql: string): { isSafe: boolean; reason?: string } {
  if (!sql || !sql.trim()) {
    return { isSafe: false, reason: 'SQL 为空' };
  }

  const trimmedSql = sql.trim().replace(/;$/, '').trim();

  if (trimmedSql.split(';').length > 1) {
    return { isSafe: false, reason: '禁止多语句执行' };
  }

  const strippedSql = stripComments(trimmedSql);
  const upperSql = strippedSql.toUpperCase();

  if (!upperSql.startsWith('SELECT') && !upperSql.startsWith('WITH')) {
    return { isSafe: false, reason: '仅允许 SELECT 或 WITH ... SELECT 语句' };
  }

  for (const keyword of WRITE_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(strippedSql)) {
      if (keyword === 'SET' && /\bOFFSET\b/i.test(strippedSql)) {
        continue;
      }
      return { isSafe: false, reason: `禁止使用 ${keyword} 语句` };
    }
  }

  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (pattern.test(strippedSql)) {
      return { isSafe: false, reason: description };
    }
  }

  for (const schema of FORBIDDEN_SCHEMAS) {
    if (strippedSql.toLowerCase().includes(schema)) {
      return { isSafe: false, reason: `禁止访问系统数据库: ${schema}` };
    }
  }

  const allowedTables = parseAllowedTables();
  const fromTables = extractTableName(strippedSql, 'FROM');
  const joinTables = extractTableName(strippedSql, 'JOIN');
  const allTables = [...fromTables, ...joinTables];

  for (const table of allTables) {
    const normalized = normalizeTableName(table);
    if (!allowedTables.has(normalized)) {
      return { isSafe: false, reason: `表 ${table} 不在允许列表中` };
    }
  }

  const allowedSchemas = parseAllowedSchemas();
  for (const table of allTables) {
    if (table.includes('.')) {
      const schemaName = table.split('.')[0].toLowerCase();
      if (!allowedSchemas.has(schemaName)) {
        return { isSafe: false, reason: `数据库 ${schemaName} 不在允许列表中` };
      }
    }
  }

  return { isSafe: true };
}
