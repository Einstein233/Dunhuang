import * as dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL 未配置，无法连接数据库。');
}

const parsedDatabaseUrl = new URL(databaseUrl);
const pool = mysql.createPool({
  host: parsedDatabaseUrl.hostname === 'localhost' ? '127.0.0.1' : parsedDatabaseUrl.hostname,
  port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 3306,
  user: decodeURIComponent(parsedDatabaseUrl.username),
  password: decodeURIComponent(parsedDatabaseUrl.password),
  database: parsedDatabaseUrl.pathname.replace(/^\//, ''),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

type SchemaColumnRow = {
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
};

type SchemaIndexRow = {
  tableName: string;
  indexName: string;
  nonUnique: number;
  columnName: string;
  seqInIndex: number;
};

type QueryResultRow = Record<string, unknown>;

function serializeForTransport(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) => normalizeValue(currentValue));
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (value && typeof value === 'object') {
    if (
      'toJSON' in value &&
      typeof (value as { toJSON: () => unknown }).toJSON === 'function'
    ) {
      return normalizeValue((value as { toJSON: () => unknown }).toJSON());
    }

    if (
      'toString' in value &&
      typeof (value as { toString: () => string }).toString === 'function' &&
      value.constructor?.name === 'Decimal'
    ) {
      return (value as { toString: () => string }).toString();
    }

    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, currentValue]) => [
        key,
        normalizeValue(currentValue),
      ])
    );
  }

  return value;
}

function validateSQL(query: string): string | null {
  const dangerousKeywords =
    /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE)\b/i;

  if (dangerousKeywords.test(query)) {
    return '【系统安全拦截】当前 SQL Agent 只允许执行 SELECT 查询，禁止执行修改、删除、建表或其他写操作。请改写为只读查询。';
  }

  return null;
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
  sections.push('- 当前气象业务已经迁移到统一结构，不再使用“每个地区一张表”的旧模式。');
  sections.push('- 当前统一气象事实表是 `weather_data`。');
  sections.push('- 当前地区映射表主要是 `station_info` 和 `weather_directory`。');
  sections.push('- 查询具体气象指标时，优先使用 `weather_data`。');
  sections.push('- 需要按城市、省份过滤时，优先使用 `station_info` 或 `weather_directory` 与 `weather_data` 关联。');
  sections.push('- 需要查看可用地区、时间覆盖范围、记录条数时，优先使用 `weather_directory`。');
  sections.push('- 小时级数据通常使用 `granularity = 2`。');
  sections.push('- 地区过滤优先使用 `city`、`province`，`station_code` 是更稳定的关联键。');
  sections.push('- 历史上的 `station`、`weather_observation`、`weather_observation_hourly`、`vw_weather_query` 不应作为当前主查询结构。');
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

    const sections: string[] = [];
    sections.push(`# Live schema for database \`${databaseName}\``);
    sections.push('');
    sections.push('## Query guidance');
    sections.push('- 当前气象业务已经迁移到规范化结构，不再使用旧的“每个地区一张表”的模式。');
    sections.push('- 简单的地区 + 时间范围查询，优先使用视图 `vw_weather_query`。');
    sections.push('- 需要更多指标时，使用 `station s JOIN weather_observation w ON s.id = w.station_id`。');
    sections.push('- 地区过滤字段是 `station.region_name` 或 `vw_weather_query.region_name`，现有值使用小写拼音，例如 `dunhuang`。');
    sections.push('- 不要引用已经删除的旧地区表。');
    sections.push('');
    sections.push('## Key relationships');
    sections.push('- `weather_observation.station_id` -> `station.id`');
    sections.push('- `vw_weather_query` 是 `station` 与 `weather_observation` 的联查视图。');
    sections.push('');
    sections.push('## Latest weather schema override');
    sections.push('- 当前小时级事实表是 `weather_observation_hourly`。');
    sections.push('- `weather_observation` 已停用并删除，不要再引用。');
    sections.push('- `vw_weather_query` 现在基于 `station` 与 `weather_observation_hourly`。');
    sections.push('- 当视图字段不足时，使用 `station s JOIN weather_observation_hourly w ON s.id = w.station_id`。');
    sections.push('- `weather_observation_hourly.station_id` -> `station.id`。');
    sections.push('');
    sections.push('## Example SQL');
    sections.push('```sql');
    sections.push('SELECT record_time, temperature_2m, rain');
    sections.push('FROM vw_weather_query');
    sections.push("WHERE region_name = 'dunhuang'");
    sections.push("  AND record_time >= '2024-01-01'");
    sections.push("  AND record_time < '2025-01-01'");
    sections.push('ORDER BY record_time;');
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
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown schema error';
    return `获取数据库结构失败：${message}`;
  }
}

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
  console.log(`\n[tool] executeSQL:\n${query}\n`);

  const validationError = validateSQL(query);
  if (validationError) {
    return {
      text: validationError,
      data: null,
      error: validationError,
      rowCount: 0,
    };
  }

  try {
    const [rawResult] = await pool.query(query);
    const normalizedRows = normalizeValue(rawResult) as QueryResultRow[];

    return {
      text: serializeForTransport(normalizedRows),
      data: normalizedRows,
      error: null,
      rowCount: normalizedRows.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown SQL error';
    return {
      text: `SQL 执行报错：${message}`,
      data: null,
      error: message,
      rowCount: 0,
    };
  }
}

export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'radar';

export function generateChartConfig(
  data: QueryResultRow[],
  chartType: ChartType,
  xAxisField?: string,
  yAxisField?: string
): string {
  console.log(`[tool] generateChartConfig: ${chartType}`);

  if (!data || data.length === 0) {
    return JSON.stringify({ error: '没有可用于绘图的数据。' });
  }

  const columns = Object.keys(data[0]);
  const xField = xAxisField || columns[0];
  const yField = yAxisField || columns[1];

  switch (chartType) {
    case 'bar':
    case 'line':
    case 'area':
      return generateCartesianChart(data, chartType, xField, yField);
    case 'pie':
      return generatePieChart(data, xField, yField);
    case 'scatter':
      return generateScatterChart(data, xField, yField);
    case 'radar':
      return generateRadarChart(data, xField, yField);
    default:
      return generateCartesianChart(data, 'bar', xField, yField);
  }
}

function generateCartesianChart(
  data: QueryResultRow[],
  chartType: string,
  xField: string,
  yField: string
): string {
  const config = {
    title: {
      text: `${yField} - ${chartType === 'bar' ? '柱状图' : chartType === 'line' ? '折线图' : '面积图'}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    xAxis: {
      type: 'category',
      data: data.map((item) => item[xField]),
      name: xField,
      axisLabel: { rotate: 45 },
    },
    yAxis: {
      type: 'value',
      name: yField,
    },
    series: [
      {
        name: yField,
        data: data.map((item) => item[yField]),
        type: chartType === 'area' ? 'line' : chartType,
        areaStyle: chartType === 'area' ? {} : undefined,
        smooth: chartType === 'line' || chartType === 'area',
      },
    ],
  };

  return JSON.stringify(config);
}

function generatePieChart(
  data: QueryResultRow[],
  nameField: string,
  valueField: string
): string {
  const config = {
    title: {
      text: `${nameField} 分布`,
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      left: 'left',
    },
    series: [
      {
        name: nameField,
        type: 'pie',
        radius: '60%',
        data: data.map((item) => ({
          name: String(item[nameField]),
          value: item[valueField],
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };

  return JSON.stringify(config);
}

function generateScatterChart(
  data: QueryResultRow[],
  xField: string,
  yField: string
): string {
  const config = {
    title: {
      text: `${xField} vs ${yField}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter(params: { data: [unknown, unknown] }) {
        return `${xField}: ${params.data[0]}<br/>${yField}: ${params.data[1]}`;
      },
    },
    xAxis: {
      type: 'value',
      name: xField,
      scale: true,
    },
    yAxis: {
      type: 'value',
      name: yField,
      scale: true,
    },
    series: [
      {
        type: 'scatter',
        data: data.map((item) => [item[xField], item[yField]]),
        symbolSize: 10,
      },
    ],
  };

  return JSON.stringify(config);
}

function generateRadarChart(
  data: QueryResultRow[],
  indicatorField: string,
  valueField: string
): string {
  const numericValues = data
    .map((item) => Number(item[valueField] ?? 0))
    .filter((value) => Number.isFinite(value));

  const maxValue = numericValues.length ? Math.max(...numericValues) * 1.2 : 100;

  const indicator = data.map((item) => ({
    name: String(item[indicatorField]),
    max: maxValue,
  }));

  const config = {
    title: {
      text: '雷达图',
      left: 'center',
    },
    tooltip: {},
    radar: {
      indicator,
      radius: '65%',
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: data.map((item) => item[valueField]),
            name: valueField,
          },
        ],
      },
    ],
  };

  return JSON.stringify(config);
}
