import { pool } from './db-pool';

interface SchemaColumnRow {
  databaseName: string;
  tableName: string;
  tableType: 'BASE TABLE' | 'VIEW';
  tableComment: string | null;
  columnName: string;
  columnType: string;
  isNullable: 'YES' | 'NO';
  columnKey: string;
  columnDefault: string | null;
  extra: string;
  ordinalPosition: number;
}

interface SchemaIndexRow {
  tableName: string;
  indexName: string;
  nonUnique: number;
  columnName: string;
  seqInIndex: number;
}

function formatColumn(column: SchemaColumnRow): string {
  const nullableText = column.isNullable === 'NO' ? 'NOT NULL' : 'NULL';
  const keyParts: string[] = [];

  if (column.columnKey === 'PRI') {
    keyParts.push('PRIMARY KEY');
  } else if (column.columnKey === 'UNI') {
    keyParts.push('UNIQUE');
  } else if (column.columnKey === 'MUL') {
    keyParts.push('INDEXED');
  }

  if (column.extra) {
    keyParts.push(column.extra);
  }

  const defaultText =
    column.columnDefault === null ? '' : ` DEFAULT ${JSON.stringify(column.columnDefault)}`;

  return `- \`${column.columnName}\` ${column.columnType} ${nullableText}${defaultText}${
    keyParts.length ? ` [${keyParts.join(', ')}]` : ''
  }`;
}

function formatIndex(indexRows: SchemaIndexRow[]): string {
  const orderedColumns = [...indexRows]
    .sort((left, right) => left.seqInIndex - right.seqInIndex)
    .map((row) => `\`${row.columnName}\``);

  const firstRow = indexRows[0];
  const uniqueness = firstRow.nonUnique === 0 ? 'UNIQUE' : 'INDEX';
  return `- ${firstRow.indexName} (${uniqueness}): ${orderedColumns.join(', ')}`;
}

function buildCurrentSchemaText(
  databaseName: string,
  tableMap: Map<string, SchemaColumnRow[]>,
  indexMap: Map<string, SchemaIndexRow[]>
): string {
  const sections: string[] = [];
  sections.push(`# Live schema for database \`${databaseName}\``);
  sections.push('');
  sections.push('## Query guidance');
  sections.push('- 当前气象业务已经迁移到统一结构，不再使用"每个地区一张表"的旧模式。');
  sections.push('- 当前统一气象事实表是 `weather_data`。');
  sections.push('- 当前地区映射表主要是 `station_info` 和 `weather_directory`。');
  sections.push('- 查询具体气象指标时，优先使用 `weather_data`。');
  sections.push('- 需要按城市、省份过滤时，优先使用 `station_info` 或 `weather_directory` 与 `weather_data` 关联。');
  sections.push('- 需要查看可用地区、时间覆盖范围、记录条数时，优先使用 `weather_directory`。');
  sections.push('- 小时级数据通常使用 `granularity = 2`。');
  sections.push('- 地区过滤优先使用 `city`、`province`，`station_code` 是更稳定的关联键。');
  sections.push('');
  sections.push('## Key relationships');
  sections.push('- `weather_data.(station_code, granularity)` -> `station_info.(station_code, granularity)`');
  sections.push('- `weather_data.(station_code, granularity)` -> `weather_directory.(station_code, granularity)`');
  sections.push('');
  sections.push('## Current weather schema override');
  sections.push('- 以实时 information_schema 读取结果为准。');
  sections.push('- 如果实时 schema 与历史提示冲突，优先相信实时 schema。');
  sections.push('- 如需查气象值，先确认字段是否真实存在于 `weather_data`。');
  sections.push('- 如需按地区查值，优先写成 `weather_data wd JOIN station_info si ON si.station_code = wd.station_code AND si.granularity = wd.granularity`。');
  sections.push('');
  sections.push('## Example SQL');
  sections.push('```sql');
  sections.push('SELECT wd.record_time, wd.avg_temperature, wd.rain_sum');
  sections.push('FROM weather_data wd');
  sections.push('JOIN station_info si');
  sections.push('  ON si.station_code = wd.station_code');
  sections.push(' AND si.granularity = wd.granularity');
  sections.push("WHERE si.city = '敦煌'");
  sections.push('  AND wd.granularity = 2');
  sections.push("  AND wd.record_time >= '2024-01-01 00:00:00'");
  sections.push("  AND wd.record_time < '2025-01-01 00:00:00'");
  sections.push('ORDER BY wd.record_time;');
  sections.push('```');
  sections.push('');
  sections.push('## Tables and views');

  for (const [tableName, tableColumns] of [...tableMap.entries()].sort((left, right) =>
    left[0].localeCompare(right[0])
  )) {
    const firstColumn = tableColumns[0];
    sections.push('');
    sections.push(`### \`${tableName}\` (${firstColumn.tableType})`);

    if (firstColumn.tableComment) {
      sections.push(`Comment: ${firstColumn.tableComment}`);
    }

    sections.push('Columns:');
    for (const column of tableColumns) {
      sections.push(formatColumn(column));
    }

    const tableIndexes = indexMap.get(tableName) ?? [];
    if (tableIndexes.length) {
      const groupedIndexes = new Map<string, SchemaIndexRow[]>();
      for (const indexRow of tableIndexes) {
        const rows = groupedIndexes.get(indexRow.indexName) ?? [];
        rows.push(indexRow);
        groupedIndexes.set(indexRow.indexName, rows);
      }

      sections.push('Indexes:');
      for (const indexRows of [...groupedIndexes.values()]) {
        sections.push(formatIndex(indexRows));
      }
    }
  }

  return sections.join('\n');
}

export async function getDatabaseSchema(): Promise<string> {
  console.log('[tool] getDatabaseSchema: reading live schema from information_schema');

  try {
    const [rawColumns] = await pool.query(`
      SELECT
        DATABASE() AS databaseName,
        t.TABLE_NAME AS tableName,
        t.TABLE_TYPE AS tableType,
        t.TABLE_COMMENT AS tableComment,
        c.COLUMN_NAME AS columnName,
        c.COLUMN_TYPE AS columnType,
        c.IS_NULLABLE AS isNullable,
        c.COLUMN_KEY AS columnKey,
        CAST(c.COLUMN_DEFAULT AS CHAR) AS columnDefault,
        c.EXTRA AS extra,
        c.ORDINAL_POSITION AS ordinalPosition
      FROM information_schema.TABLES t
      JOIN information_schema.COLUMNS c
        ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
       AND t.TABLE_NAME = c.TABLE_NAME
      WHERE t.TABLE_SCHEMA = DATABASE()
      ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION
    `);
    const columns = rawColumns as SchemaColumnRow[];

    const [rawIndexes] = await pool.query(`
      SELECT
        TABLE_NAME AS tableName,
        INDEX_NAME AS indexName,
        NON_UNIQUE AS nonUnique,
        COLUMN_NAME AS columnName,
        SEQ_IN_INDEX AS seqInIndex
      FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    `);
    const indexes = rawIndexes as SchemaIndexRow[];

    if (!columns.length) {
      return '数据库中没有可读取的表结构信息。';
    }

    const databaseName = columns[0].databaseName;
    const tableMap = new Map<string, SchemaColumnRow[]>();
    const indexMap = new Map<string, SchemaIndexRow[]>();

    for (const column of columns) {
      const rows = tableMap.get(column.tableName) ?? [];
      rows.push(column);
      tableMap.set(column.tableName, rows);
    }

    for (const indexRow of indexes) {
      const rows = indexMap.get(indexRow.tableName) ?? [];
      rows.push(indexRow);
      indexMap.set(indexRow.tableName, rows);
    }

    return buildCurrentSchemaText(databaseName, tableMap, indexMap);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown schema error';
    return `获取数据库结构失败：${message}`;
  }
}
