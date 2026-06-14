import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL 未配置，无法连接数据库。');
}

const parsedDatabaseUrl = new URL(databaseUrl);

export const pool = mysql.createPool({
  host: parsedDatabaseUrl.hostname === 'localhost' ? '127.0.0.1' : parsedDatabaseUrl.hostname,
  port: parsedDatabaseUrl.port ? Number(parsedDatabaseUrl.port) : 3306,
  user: decodeURIComponent(parsedDatabaseUrl.username),
  password: decodeURIComponent(parsedDatabaseUrl.password),
  database: parsedDatabaseUrl.pathname.replace(/^\//, ''),
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0,
});

export const sqlTimeoutMs = Number(process.env.SQL_TIMEOUT_MS) || 30000;
export const maxResultRows = Number(process.env.MAX_RESULT_ROWS) || 1000;

export function normalizeValue(value: unknown): unknown {
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

export function serializeForTransport(value: unknown): string {
  return JSON.stringify(value, (_key, currentValue) => normalizeValue(currentValue));
}
