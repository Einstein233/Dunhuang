export type SQLStatementType = 'select' | 'with-select';

export type SQLGuardReasonCode =
  | 'EMPTY_SQL'
  | 'MULTI_STATEMENT'
  | 'UNSUPPORTED_STATEMENT'
  | 'DANGEROUS_KEYWORD'
  | 'DANGEROUS_PATTERN'
  | 'SYSTEM_SCHEMA'
  | 'DISALLOWED_TABLE';

export interface SQLGuardResult {
  allowed: boolean;
  normalizedSql: string;
  statementType?: SQLStatementType;
  reasonCode?: SQLGuardReasonCode;
  message: string;
  referencedTables: string[];
  referencedSchemas: string[];
  warnings: string[];
}

export interface SQLGuardOptions {
  allowedTables?: string[];
  allowedSchemas?: string[];
}

type TableReference = {
  schema?: string;
  table: string;
};

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
  'rollback_20260413_sys_menu',
  'rollback_20260413_sys_role',
  'rollback_20260413_sys_role_menu',
  'rollback_20260413_sys_user',
  'rollback_20260413_sys_user_role',
] as const;

const SYSTEM_SCHEMAS = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

const WRITE_KEYWORDS =
  /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE|CALL|PREPARE|EXECUTE|HANDLER|DO|SET|USE|LOCK|UNLOCK|ANALYZE|OPTIMIZE|REPAIR|INSTALL|UNINSTALL)\b/i;

const DANGEROUS_PATTERNS: Array<{ regex: RegExp; code: SQLGuardReasonCode; message: string }> = [
  {
    regex: /\bINTO\b/i,
    code: 'DANGEROUS_PATTERN',
    message: 'Security block: INTO clauses are not allowed in read-only mode.',
  },
  {
    regex: /\b(LOAD_FILE|SLEEP|BENCHMARK|GET_LOCK|RELEASE_LOCK)\s*\(/i,
    code: 'DANGEROUS_PATTERN',
    message: 'Security block: dangerous SQL functions are not allowed.',
  },
  {
    regex: /\bOUTFILE\b|\bDUMPFILE\b/i,
    code: 'DANGEROUS_PATTERN',
    message: 'Security block: writing query output to files is not allowed.',
  },
  {
    regex: /@\w+/,
    code: 'DANGEROUS_PATTERN',
    message: 'Security block: user variables are not allowed.',
  },
];

function normalizeIdentifier(value: string): string {
  return value.replace(/`/g, '').trim().toLowerCase();
}

function normalizeSQLInput(query: string): string {
  const trimmed = query.trim();
  const fencedMatch = trimmed.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return candidate.replace(/^\s*sql\s*/i, '').trim();
}

function stripCommentsAndLiterals(sql: string): string {
  let result = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const currentChar = sql[index];
    const nextChar = sql[index + 1] ?? '';

    if (inLineComment) {
      if (currentChar === '\n') {
        inLineComment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (currentChar === '*' && nextChar === '/') {
        inBlockComment = false;
        result += '  ';
        index += 1;
      } else {
        result += currentChar === '\n' ? '\n' : ' ';
      }
      continue;
    }

    if (inSingleQuote) {
      if (currentChar === "'" && nextChar === "'") {
        result += '  ';
        index += 1;
        continue;
      }

      result += currentChar === '\n' ? '\n' : ' ';
      if (currentChar === "'" && sql[index - 1] !== '\\') {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (currentChar === '"' && nextChar === '"') {
        result += '  ';
        index += 1;
        continue;
      }

      result += currentChar === '\n' ? '\n' : ' ';
      if (currentChar === '"' && sql[index - 1] !== '\\') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktick) {
      result += currentChar === '\n' ? '\n' : ' ';
      if (currentChar === '`') {
        inBacktick = false;
      }
      continue;
    }

    if (currentChar === '-' && nextChar === '-' && /\s/.test(sql[index + 2] ?? ' ')) {
      inLineComment = true;
      result += '  ';
      index += 1;
      continue;
    }

    if (currentChar === '#') {
      inLineComment = true;
      result += ' ';
      continue;
    }

    if (currentChar === '/' && nextChar === '*') {
      inBlockComment = true;
      result += '  ';
      index += 1;
      continue;
    }

    if (currentChar === "'") {
      inSingleQuote = true;
      result += ' ';
      continue;
    }

    if (currentChar === '"') {
      inDoubleQuote = true;
      result += ' ';
      continue;
    }

    if (currentChar === '`') {
      inBacktick = true;
      result += ' ';
      continue;
    }

    result += currentChar;
  }

  return result;
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < sql.length; index += 1) {
    const currentChar = sql[index];
    const nextChar = sql[index + 1] ?? '';

    if (inLineComment) {
      current += currentChar;
      if (currentChar === '\n') {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      current += currentChar;
      if (currentChar === '*' && nextChar === '/') {
        current += '/';
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      current += currentChar;
      if (currentChar === "'" && nextChar === "'") {
        current += "'";
        index += 1;
        continue;
      }
      if (currentChar === "'" && sql[index - 1] !== '\\') {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += currentChar;
      if (currentChar === '"' && nextChar === '"') {
        current += '"';
        index += 1;
        continue;
      }
      if (currentChar === '"' && sql[index - 1] !== '\\') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inBacktick) {
      current += currentChar;
      if (currentChar === '`') {
        inBacktick = false;
      }
      continue;
    }

    if (currentChar === '-' && nextChar === '-' && /\s/.test(sql[index + 2] ?? ' ')) {
      inLineComment = true;
      current += '--';
      index += 1;
      continue;
    }

    if (currentChar === '#') {
      inLineComment = true;
      current += currentChar;
      continue;
    }

    if (currentChar === '/' && nextChar === '*') {
      inBlockComment = true;
      current += '/*';
      index += 1;
      continue;
    }

    if (currentChar === "'") {
      inSingleQuote = true;
      current += currentChar;
      continue;
    }

    if (currentChar === '"') {
      inDoubleQuote = true;
      current += currentChar;
      continue;
    }

    if (currentChar === '`') {
      inBacktick = true;
      current += currentChar;
      continue;
    }

    if (currentChar === ';') {
      const statement = current.trim();
      if (statement) {
        statements.push(statement);
      }
      current = '';
      continue;
    }

    current += currentChar;
  }

  const finalStatement = current.trim();
  if (finalStatement) {
    statements.push(finalStatement);
  }

  return statements;
}

function extractLeadingKeyword(inspectableSql: string): string {
  const match = inspectableSql.trim().match(/^([A-Za-z]+)/);
  return normalizeIdentifier(match?.[1] ?? '');
}

function collectCTENames(inspectableSql: string): Set<string> {
  const cteNames = new Set<string>();
  const cteRegex = /\b(?:WITH|,)\s*(?:RECURSIVE\s+)?([A-Za-z_][\w$]*)\s+AS\s*\(/gi;
  let match: RegExpExecArray | null = cteRegex.exec(inspectableSql);

  while (match) {
    cteNames.add(normalizeIdentifier(match[1]));
    match = cteRegex.exec(inspectableSql);
  }

  return cteNames;
}

function extractTableReferences(inspectableSql: string, cteNames: Set<string>): TableReference[] {
  const references: TableReference[] = [];
  const relationRegex =
    /\b(?:FROM|JOIN)\s+((?:`?[A-Za-z_][\w$]*`?\.)?`?[A-Za-z_][\w$]*`?)/gi;

  let match: RegExpExecArray | null = relationRegex.exec(inspectableSql);
  while (match) {
    const rawIdentifier = match[1].trim();
    const parts = rawIdentifier.split('.').map((part) => normalizeIdentifier(part));
    const reference =
      parts.length === 2
        ? { schema: parts[0], table: parts[1] }
        : { schema: undefined, table: parts[0] };

    if (reference.table && !cteNames.has(reference.table)) {
      references.push(reference);
    }

    match = relationRegex.exec(inspectableSql);
  }

  return references;
}

function normalizeIdentifierList(rawValue?: string): string[] {
  if (!rawValue) {
    return [];
  }

  return rawValue
    .split(',')
    .map((item) => normalizeIdentifier(item))
    .filter(Boolean);
}

function getDatabaseNameFromUrl(databaseUrl?: string): string | null {
  if (!databaseUrl) {
    return null;
  }

  try {
    const url = new URL(databaseUrl);
    return normalizeIdentifier(url.pathname.replace(/^\//, ''));
  } catch (_error) {
    return null;
  }
}

function getConfiguredAllowedTables(options?: SQLGuardOptions): Set<string> {
  const envTables = normalizeIdentifierList(process.env.SQL_AGENT_ALLOWED_TABLES);
  const preferredTables =
    options?.allowedTables && options.allowedTables.length > 0
      ? options.allowedTables
      : envTables.length > 0
        ? envTables
        : [...DEFAULT_ALLOWED_TABLES];

  return new Set(preferredTables.map((table) => normalizeIdentifier(table)));
}

function getConfiguredAllowedSchemas(options?: SQLGuardOptions): Set<string> {
  const envSchemas = normalizeIdentifierList(process.env.SQL_AGENT_ALLOWED_SCHEMAS);
  const databaseName = getDatabaseNameFromUrl(process.env.DATABASE_URL);
  const preferredSchemas =
    options?.allowedSchemas && options.allowedSchemas.length > 0
      ? options.allowedSchemas
      : envSchemas.length > 0
        ? envSchemas
        : databaseName
          ? [databaseName]
          : [];

  return new Set(preferredSchemas.map((schema) => normalizeIdentifier(schema)));
}

function buildRejectedResult(
  normalizedSql: string,
  reasonCode: SQLGuardReasonCode,
  message: string,
  referencedTables: string[] = [],
  referencedSchemas: string[] = []
): SQLGuardResult {
  return {
    allowed: false,
    normalizedSql,
    reasonCode,
    message: `[SQL Security Block] ${message}`,
    referencedTables,
    referencedSchemas,
    warnings: [],
  };
}

export function validateReadOnlySQL(query: string, options?: SQLGuardOptions): SQLGuardResult {
  const normalizedSql = normalizeSQLInput(query);

  if (!normalizedSql) {
    return buildRejectedResult(normalizedSql, 'EMPTY_SQL', 'SQL is empty.');
  }

  const statements = splitStatements(normalizedSql);
  if (statements.length !== 1) {
    return buildRejectedResult(
      normalizedSql,
      'MULTI_STATEMENT',
      'Only one SQL statement is allowed per execution.'
    );
  }

  const primaryStatement = statements[0];
  const inspectableSql = stripCommentsAndLiterals(primaryStatement);
  const leadingKeyword = extractLeadingKeyword(inspectableSql);

  let statementType: SQLStatementType | undefined;
  if (leadingKeyword === 'select') {
    statementType = 'select';
  } else if (leadingKeyword === 'with') {
    statementType = 'with-select';
  } else {
    return buildRejectedResult(
      normalizedSql,
      'UNSUPPORTED_STATEMENT',
      'Only SELECT or WITH ... SELECT statements are allowed.'
    );
  }

  if (WRITE_KEYWORDS.test(inspectableSql)) {
    return buildRejectedResult(
      normalizedSql,
      'DANGEROUS_KEYWORD',
      'Write keywords or state-changing commands were detected.'
    );
  }

  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.regex.test(inspectableSql)) {
      return buildRejectedResult(normalizedSql, pattern.code, pattern.message);
    }
  }

  const cteNames = collectCTENames(inspectableSql);
  const references = extractTableReferences(inspectableSql, cteNames);
  const referencedTables = [...new Set(references.map((item) => item.table))];
  const referencedSchemas = [
    ...new Set(references.map((item) => item.schema).filter((value): value is string => Boolean(value))),
  ];
  const allowedTables = getConfiguredAllowedTables(options);
  const allowedSchemas = getConfiguredAllowedSchemas(options);

  for (const schemaName of referencedSchemas) {
    if (SYSTEM_SCHEMAS.has(schemaName)) {
      return buildRejectedResult(
        normalizedSql,
        'SYSTEM_SCHEMA',
        `System schema "${schemaName}" is not allowed.`,
        referencedTables,
        referencedSchemas
      );
    }

    if (allowedSchemas.size > 0 && !allowedSchemas.has(schemaName)) {
      return buildRejectedResult(
        normalizedSql,
        'SYSTEM_SCHEMA',
        `Schema "${schemaName}" is outside the allowed business schema list.`,
        referencedTables,
        referencedSchemas
      );
    }
  }

  for (const tableName of referencedTables) {
    if (!allowedTables.has(tableName)) {
      return buildRejectedResult(
        normalizedSql,
        'DISALLOWED_TABLE',
        `Table "${tableName}" is not in the allowed table whitelist.`,
        referencedTables,
        referencedSchemas
      );
    }
  }

  const warnings: string[] = [];
  if (!/\bLIMIT\b/i.test(inspectableSql) && !/\b(COUNT|AVG|SUM|MIN|MAX)\s*\(/i.test(inspectableSql)) {
    warnings.push(
      'No LIMIT clause was detected. Consider adding LIMIT for non-aggregate detail queries.'
    );
  }

  return {
    allowed: true,
    normalizedSql: primaryStatement.trim(),
    statementType,
    message: 'SQL validation passed.',
    referencedTables,
    referencedSchemas,
    warnings,
  };
}
