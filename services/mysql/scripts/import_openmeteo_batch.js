/**
 * Open-Meteo 气象数据一键批量导入脚本
 *
 * 从 Open-Meteo 下载的 CSV 文件中读取气象数据，自动完成：
 *   1. 省份/城市名标准化（去掉"省""市"后缀，对齐数据库命名）
 *   2. 列名映射（去掉单位后缀，对齐数据库字段）
 *   3. 自动匹配或创建 station_code（站点编码）
 *   4. 更新 station_info（含经纬度）
 *   5. 批量写入 weather_data（含降雪 cm→mm 转换）
 *   6. 同步 weather_directory（数据目录索引）
 *
 * 一键使用：
 *   node services/mysql/scripts/import_openmeteo_batch.js
 *
 * 自定义路径：
 *   node services/mysql/scripts/import_openmeteo_batch.js <folderPath>
 *
 * 仅预览不导入：
 *   node services/mysql/scripts/import_openmeteo_batch.js --dry-run
 *
 * 限制导入文件数（测试用）：
 *   node services/mysql/scripts/import_openmeteo_batch.js --limit 5
 *
 * 前置条件：
 *   - Docker MySQL 容器已运行 (docker compose up -d)
 *   - DATABASE_URL 已配置在 services/sql-agent/.env 中
 *   - 已安装 mysql2: cd services/sql-agent && npm install
 */

const path = require("path");
const fs = require("fs");
const readline = require("readline");

// ---------------------------------------------------------------------------
// 模块解析 & 环境配置
// 复用 services/sql-agent 下的 node_modules（mysql2、dotenv 等都安装在那里）
// ---------------------------------------------------------------------------
const SQL_AGENT_DIR = path.resolve(__dirname, "..", "..", "sql-agent");
const SQL_AGENT_NODE_MODULES = path.join(SQL_AGENT_DIR, "node_modules");
if (fs.existsSync(SQL_AGENT_NODE_MODULES)) {
  module.paths.unshift(SQL_AGENT_NODE_MODULES);
}

try {
  require("dotenv").config({
    path: path.join(SQL_AGENT_DIR, ".env"),
  });
} catch (_) {
  // 允许 DATABASE_URL 通过环境变量注入
}

const mysql = require("mysql2/promise");

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------
const DEFAULT_CSV_FOLDER = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "weather_data",
  "output_weather",
  "output_weather"
);

const DEFAULT_GRANULARITY = 2; // 2 = 小时
const BATCH_SIZE = 1000;
const COMBINED_FILE = "china_all_cities_weather.csv";

/**
 * CSV 列名 → 标准字段名映射
 * 左侧是 Open-Meteo CSV 中带单位后缀的列名，右侧是内部标准名
 */
const COLUMN_MAP = {
  time: "time",
  "temperature_2m (°C)": "temperature_2m",
  temperature_2m: "temperature_2m",
  "relative_humidity_2m (%)": "relativehumidity_2m",
  relativehumidity_2m: "relativehumidity_2m",
  "rain (mm)": "rain",
  rain: "rain",
  "snowfall (cm)": "snowfall",
  snowfall: "snowfall",
  "wind_speed_10m (m/s)": "windspeed_10m",
  windspeed_10m: "windspeed_10m",
  "shortwave_radiation (W/m²)": "shortwave_radiation",
  shortwave_radiation: "shortwave_radiation",
  province: "province",
  city: "city",
  latitude: "latitude",
  longitude: "longitude",
};

// ---------------------------------------------------------------------------
// 地区名称标准化
// ---------------------------------------------------------------------------

/** 省份后缀：CSV 中 "甘肃省" → 数据库 "甘肃" */
const PROVINCE_SUFFIXES = ["壮族自治区", "回族自治区", "维吾尔自治区", "自治区", "特别行政区", "省", "市"];

/** 城市后缀：CSV 中 "上海市" → 数据库 "上海"（直辖市特殊处理） */
const CITY_SUFFIXES = ["地区", "自治州", "盟", "市", "区", "县"];

/**
 * 标准化省份名：去掉行政后缀，与数据库 station_info 表对齐
 */
function normalizeProvince(name) {
  if (!name) return "";
  let result = String(name).trim();
  for (const suffix of PROVINCE_SUFFIXES) {
    if (result.endsWith(suffix) && result.length > suffix.length) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result;
}

/**
 * 标准化城市名：去掉行政后缀
 */
function normalizeCity(name) {
  if (!name) return "";
  let result = String(name).trim();
  for (const suffix of CITY_SUFFIXES) {
    if (result.endsWith(suffix) && result.length > suffix.length) {
      result = result.slice(0, -suffix.length);
      break;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 数据库连接
// ---------------------------------------------------------------------------
async function createConnection() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL 未配置。\n" +
        "请确保 services/sql-agent/.env 文件存在且包含：\n" +
        '  DATABASE_URL="mysql://root:root@localhost:3308/dunhuang_agent"'
    );
  }

  const url = new URL(dbUrl);
  return mysql.createConnection({
    host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
}

// ---------------------------------------------------------------------------
// 表结构（确保存在）
// ---------------------------------------------------------------------------
async function ensureTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS station_info (
      station_code VARCHAR(50) NOT NULL COMMENT '站点编码',
      province VARCHAR(50) NOT NULL COMMENT '省份',
      city VARCHAR(50) NOT NULL COMMENT '城市',
      latitude DECIMAL(10,8) NULL,
      longitude DECIMAL(11,8) NULL,
      granularity TINYINT NOT NULL DEFAULT 2 COMMENT '颗粒度',
      create_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (station_code, granularity)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS weather_data (
      station_code VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN' COMMENT '气象站点编码',
      granularity TINYINT NOT NULL COMMENT '采集颗粒度: 1=15分钟 2=小时 3=天',
      record_time DATETIME NOT NULL COMMENT '气象数据记录时间',
      avg_temperature DECIMAL(7,2) NULL COMMENT '平均温度(°C)',
      relativehumidity_2m INT NULL COMMENT '相对湿度(%)',
      rain_sum DECIMAL(8,2) NULL COMMENT '总降雨量(mm)',
      snow_sum DECIMAL(8,2) NULL COMMENT '总降雪量(mm)',
      max_continuous_wind_speed DECIMAL(6,2) NULL COMMENT '最大持续风速(m/s)',
      shortwave_radiation_sum DECIMAL(8,2) NULL COMMENT '短波辐射总量(W/m²)',
      create_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      update_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
      PRIMARY KEY (station_code, granularity, record_time),
      KEY idx_weather_data_time_station (record_time, station_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS weather_directory (
      id INT NOT NULL AUTO_INCREMENT COMMENT '主键',
      province VARCHAR(50) NOT NULL COMMENT '省份',
      city VARCHAR(50) NOT NULL COMMENT '城市',
      station_code VARCHAR(50) NOT NULL DEFAULT 'UNKNOWN' COMMENT '气象站点编码',
      granularity TINYINT NOT NULL COMMENT '采集颗粒度: 1=15分钟 2=小时 3=天',
      start_time DATETIME NOT NULL COMMENT '采集起始时间',
      end_time DATETIME NOT NULL COMMENT '采集结束时间',
      total_count INT NOT NULL DEFAULT 0 COMMENT '数据总条数',
      update_time TIMESTAMP NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
      create_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
      PRIMARY KEY (id),
      UNIQUE KEY uk_prov_city_station_gran (province, city, station_code, granularity),
      KEY idx_province_city (province, city)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

// ---------------------------------------------------------------------------
// 站点编码管理
// ---------------------------------------------------------------------------

/**
 * 确保 station_code 存在。优先复用已有编码，找不到则自动创建新编码。
 * 与现有 import_weather_observation_hourly.js 的编码分配策略一致：
 *   1. 先按 province + city + granularity 在 station_info 中查找
 *   2. 找到则复用并更新经纬度
 *   3. 找不到则自动分配 ST + 6位序号 的新编码
 */
async function ensureStationCode(conn, { province, city, latitude, longitude, granularity }) {
  // 1) 查找已有站点
  const [existingRows] = await conn.query(
    `SELECT station_code FROM station_info
     WHERE province = ? AND city = ? AND granularity = ? LIMIT 1`,
    [province, city, granularity]
  );

  if (existingRows.length > 0) {
    const code = String(existingRows[0].station_code);
    // 更新经纬度（如果 CSV 提供了更精确的值）
    await conn.query(
      `INSERT INTO station_info (station_code, province, city, latitude, longitude, granularity)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         province = VALUES(province), city = VALUES(city),
         latitude = COALESCE(VALUES(latitude), latitude),
         longitude = COALESCE(VALUES(longitude), longitude)`,
      [code, province, city, latitude, longitude, granularity]
    );
    return code;
  }

  // 2) 自动分配新编码
  const [maxRows] = await conn.query(
    `SELECT station_code FROM station_info ORDER BY station_code DESC LIMIT 1`
  );
  let nextNum = 1;
  if (maxRows.length > 0) {
    const num = parseInt(String(maxRows[0].station_code || "").replace(/\D/g, ""), 10);
    if (!Number.isNaN(num)) nextNum = num + 1;
  }
  const newCode = `ST${String(nextNum).padStart(6, "0")}`;

  await conn.query(
    `INSERT INTO station_info (station_code, province, city, latitude, longitude, granularity)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       province = VALUES(province), city = VALUES(city),
       latitude = COALESCE(VALUES(latitude), latitude),
       longitude = COALESCE(VALUES(longitude), longitude)`,
    [newCode, province, city, latitude, longitude, granularity]
  );

  return newCode;
}

// ---------------------------------------------------------------------------
// CSV 解析工具
// ---------------------------------------------------------------------------

/**
 * 简单 CSV 行解析，处理引号包裹的字段
 */
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * 读取 CSV 文件的第一行，提取省市和坐标元数据
 */
async function readCsvMetadata(csvPath) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = null;
  let firstDataRow = null;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^﻿/, "").trim();
    if (!line) continue;

    if (!headers) {
      headers = parseCsvLine(line);
      continue;
    }

    firstDataRow = parseCsvLine(line);
    break;
  }

  rl.close();
  stream.destroy();

  if (!headers || !firstDataRow) return null;

  // 建立 列名→索引 映射
  const indexMap = {};
  headers.forEach((h, i) => {
    const clean = h.trim();
    indexMap[clean] = i;
    const mapped = COLUMN_MAP[clean];
    if (mapped) indexMap[mapped] = i;
  });

  const get = (key) => {
    const idx = indexMap[key];
    return idx !== undefined ? (firstDataRow[idx] || "").trim() : null;
  };

  return {
    province: get("province"),
    city: get("city"),
    latitude: get("latitude"),
    longitude: get("longitude"),
  };
}

/**
 * 流式读取 CSV 并逐行处理（内存友好，适合大文件）
 * rowHandler 可以是同步或异步函数
 */
async function processCsvStream(csvPath, rowHandler) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  let headers = null;
  let mappedHeaders = null;
  let rowsProcessed = 0;

  for await (const rawLine of rl) {
    const line = rawLine.replace(/^﻿/, "").trim();
    if (!line) continue;

    if (!headers) {
      headers = parseCsvLine(line).map((h) => h.trim());
      // 建立映射后的标准列名
      mappedHeaders = headers.map((h) => COLUMN_MAP[h] || h);
      continue;
    }

    const values = parseCsvLine(line);
    if (values.length < headers.length) continue;

    const row = {};
    for (let i = 0; i < mappedHeaders.length; i++) {
      row[mappedHeaders[i]] = (values[i] || "").trim();
    }

    const result = await rowHandler(row);
    if (result !== false) rowsProcessed++;
  }

  rl.close();
  stream.destroy();
  return rowsProcessed;
}

// ---------------------------------------------------------------------------
// 值解析
// ---------------------------------------------------------------------------
function parseDecimal(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function parseInt_(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function normalizeRecordTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) return `${normalized}:00`;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) return normalized;
  return null;
}

// ---------------------------------------------------------------------------
// 批量写入
// ---------------------------------------------------------------------------
async function flushBatch(conn, batch, summary) {
  if (!batch.length) return;

  const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?)").join(",");
  const flat = batch.flat();
  const sql = `
    INSERT INTO weather_data
      (station_code, granularity, record_time,
       avg_temperature, relativehumidity_2m,
       rain_sum, snow_sum,
       max_continuous_wind_speed, shortwave_radiation_sum)
    VALUES ${placeholders}
    ON DUPLICATE KEY UPDATE
      avg_temperature = VALUES(avg_temperature),
      relativehumidity_2m = VALUES(relativehumidity_2m),
      rain_sum = VALUES(rain_sum),
      snow_sum = VALUES(snow_sum),
      max_continuous_wind_speed = VALUES(max_continuous_wind_speed),
      shortwave_radiation_sum = VALUES(shortwave_radiation_sum)
  `;

  const [result] = await conn.query(sql, flat);
  summary.rowsInsertedOrUpdated += result.affectedRows;
  batch.length = 0;
}

// ---------------------------------------------------------------------------
// 目录索引同步
// ---------------------------------------------------------------------------
async function syncWeatherDirectory(conn, { stationCode, granularity, province, city }) {
  const [rows] = await conn.query(
    `SELECT ? AS province, ? AS city, wd.station_code, wd.granularity,
            MIN(wd.record_time) AS start_time,
            MAX(wd.record_time) AS end_time,
            COUNT(*) AS total_count
     FROM weather_data wd
     WHERE wd.station_code = ? AND wd.granularity = ?
     GROUP BY wd.station_code, wd.granularity`,
    [province, city, stationCode, granularity]
  );

  if (!rows.length) return;

  const row = rows[0];
  await conn.query(
    `INSERT INTO weather_directory
       (province, city, station_code, granularity, start_time, end_time, total_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       start_time = VALUES(start_time),
       end_time = VALUES(end_time),
       total_count = VALUES(total_count),
       update_time = CURRENT_TIMESTAMP`,
    [row.province, row.city, row.station_code, row.granularity, row.start_time, row.end_time, row.total_count]
  );
}

// ---------------------------------------------------------------------------
// 单文件导入
// ---------------------------------------------------------------------------
async function importSingleFile(conn, csvPath, options = {}) {
  const fileName = path.basename(csvPath);
  const summary = {
    file: fileName,
    status: "pending",
    province: null,
    city: null,
    latitude: null,
    longitude: null,
    stationCode: null,
    granularity: DEFAULT_GRANULARITY,
    rowsRead: 0,
    rowsInsertedOrUpdated: 0,
    rowsSkipped: 0,
    directorySynced: false,
    error: null,
    startTime: Date.now(),
    duration: null,
  };

  try {
    // 1) 读取元数据
    const meta = await readCsvMetadata(csvPath);
    if (!meta || !meta.province || !meta.city) {
      summary.status = "failed";
      summary.error = "无法从 CSV 中读取 province/city 元数据";
      return summary;
    }

    // 2) 标准化省市名
    const province = normalizeProvince(meta.province);
    const city = normalizeCity(meta.city);
    const latitude = parseDecimal(meta.latitude);
    const longitude = parseDecimal(meta.longitude);

    summary.province = province;
    summary.city = city;
    summary.latitude = latitude;
    summary.longitude = longitude;

    // 3) 获取或创建站点编码（含 station_info 写入）
    const stationCode = await ensureStationCode(conn, {
      province,
      city,
      latitude,
      longitude,
      granularity: DEFAULT_GRANULARITY,
    });
    summary.stationCode = stationCode;

    // 4) 流式读取 CSV，逐行转换并分批写入数据库
    const batch = [];

    await processCsvStream(csvPath, async (row) => {
      summary.rowsRead++;

      const recordTime = normalizeRecordTime(row.time);
      if (!recordTime) {
        summary.rowsSkipped++;
        return false;
      }

      // 降雪量 cm → mm（×10）
      const snowfallCm = parseDecimal(row.snowfall);
      const snowSumMm = snowfallCm === null ? null : Math.round(snowfallCm * 10 * 100) / 100;

      batch.push([
        stationCode,
        DEFAULT_GRANULARITY,
        recordTime,
        parseDecimal(row.temperature_2m),
        parseInt_(row.relativehumidity_2m),
        parseDecimal(row.rain),
        snowSumMm,
        parseDecimal(row.windspeed_10m),
        parseDecimal(row.shortwave_radiation),
      ]);

      // 达到批次阈值时立即写入数据库，释放内存
      if (batch.length >= BATCH_SIZE) {
        await flushBatch(conn, batch, summary);
      }
    });

    // flush 最后一批剩余数据
    if (batch.length > 0) {
      await flushBatch(conn, batch, summary);
    }

    // 5) 同步数据目录索引
    await syncWeatherDirectory(conn, { stationCode, granularity: DEFAULT_GRANULARITY, province, city });
    summary.directorySynced = true;
    summary.status = "success";
  } catch (err) {
    summary.status = "failed";
    summary.error = err instanceof Error ? err.message : String(err);
  }

  summary.duration = ((Date.now() - summary.startTime) / 1000).toFixed(1);
  return summary;
}

// ---------------------------------------------------------------------------
// 文件夹扫描
// ---------------------------------------------------------------------------
function findCsvFiles(dirPath) {
  const results = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
        results.push(full);
      }
    }
  }

  walk(dirPath);

  // 排除合并文件
  return results
    .filter((f) => path.basename(f) !== COMBINED_FILE)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
}

// ---------------------------------------------------------------------------
// 进度条
// ---------------------------------------------------------------------------
function progressBar(current, total, width = 30) {
  const ratio = current / total;
  const filled = Math.round(width * ratio);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  return `[${bar}] ${current}/${total} (${(ratio * 100).toFixed(1)}%)`;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  // 解析参数：--flag 后面的值属于该 flag，不作为文件夹路径
  const FLAGS_WITH_VALUE = new Set(["--limit"]);
  const nonFlagArgs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (FLAGS_WITH_VALUE.has(args[i])) i++; // 跳过 flag 的值
      continue;
    }
    if (args[i] === "dry-run") continue;
    nonFlagArgs.push(args[i]);
  }
  const folderPath = nonFlagArgs[0] || DEFAULT_CSV_FOLDER;
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) : 0;

  // 检查文件夹
  if (!fs.existsSync(folderPath)) {
    console.error(`错误: 文件夹不存在: ${folderPath}`);
    console.error(`提示: 请将 Open-Meteo 下载的 CSV 文件放到该目录下`);
    process.exit(1);
  }

  const csvFiles = findCsvFiles(folderPath);
  if (!csvFiles.length) {
    console.error(`错误: 文件夹下没有找到 CSV 文件: ${folderPath}`);
    process.exit(1);
  }

  const filesToProcess = limit > 0 ? csvFiles.slice(0, limit) : csvFiles;

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║          Open-Meteo 气象数据批量导入工具                 ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`  数据目录: ${folderPath}`);
  console.log(`  发现文件: ${csvFiles.length} 个 CSV`);
  console.log(`  待导入:   ${filesToProcess.length} 个${limit ? ` (限制 ${limit})` : ""}`);
  console.log(`  模式:     ${dryRun ? "预览模式 (不写入数据库)" : "正式导入"}`);
  console.log();

  // 连接数据库
  let conn;
  try {
    conn = await createConnection();
    await ensureTables(conn);

    // 查询当前站点数量
    const [stationCount] = await conn.query(`SELECT COUNT(*) AS cnt FROM station_info`);
    const [dataCount] = await conn.query(`SELECT COUNT(*) AS cnt FROM weather_data`);
    const [dirCount] = await conn.query(`SELECT COUNT(*) AS cnt FROM weather_directory`);
    console.log(`  数据库已连接 ✓`);
    console.log(`  当前站点: ${stationCount[0].cnt} 个`);
    console.log(`  当前气象数据: ${dataCount[0].cnt} 条`);
    console.log(`  当前目录索引: ${dirCount[0].cnt} 条`);
    console.log();
  } catch (err) {
    console.error(`数据库连接失败: ${err.message}`);
    console.error(`请确认 Docker MySQL 容器已运行: docker compose up -d`);
    process.exit(1);
  }

  const results = [];
  const startAll = Date.now();

  for (let i = 0; i < filesToProcess.length; i++) {
    const csvPath = filesToProcess[i];
    const fileName = path.basename(csvPath);
    const progress = progressBar(i + 1, filesToProcess.length);

    if (dryRun) {
      const meta = await readCsvMetadata(csvPath);
      const prov = meta ? normalizeProvince(meta.province) : "?";
      const ct = meta ? normalizeCity(meta.city) : "?";
      const lat = meta ? meta.latitude : "?";
      const lon = meta ? meta.longitude : "?";
      console.log(`  ${progress}  ${fileName}  →  ${prov}/${ct} (${lat}, ${lon})`);
      continue;
    }

    const summary = await importSingleFile(conn, csvPath);
    results.push(summary);

    const icon = summary.status === "success" ? "✓" : "✗";
    const detail =
      summary.status === "success"
        ? `${summary.stationCode} ${summary.province}/${summary.city}  ${summary.rowsInsertedOrUpdated} rows  ${summary.duration}s`
        : `${summary.province || "?"}/${summary.city || "?"}  ${summary.error}`;
    console.log(`  ${progress}  ${icon} ${fileName}  →  ${detail}`);
  }

  await conn.end();

  const elapsed = ((Date.now() - startAll) / 1000).toFixed(1);

  // 汇总报告
  if (!dryRun) {
    const successCount = results.filter((r) => r.status === "success").length;
    const failedCount = results.filter((r) => r.status === "failed").length;
    const totalRows = results.reduce((sum, r) => sum + (r.rowsInsertedOrUpdated || 0), 0);
    const totalRead = results.reduce((sum, r) => sum + (r.rowsRead || 0), 0);
    const totalSkipped = results.reduce((sum, r) => sum + (r.rowsSkipped || 0), 0);

    console.log();
    console.log("══════════════════════════════════════════════════════════");
    console.log(`  导入完成  耗时 ${elapsed}s`);
    console.log(`  成功: ${successCount} 个文件`);
    console.log(`  失败: ${failedCount} 个文件`);
    console.log(`  读取: ${totalRead} 行  |  写入: ${totalRows} 行  |  跳过: ${totalSkipped} 行`);

    if (failedCount > 0) {
      console.log();
      console.log("  失败详情:");
      results
        .filter((r) => r.status === "failed")
        .forEach((r) => {
          console.log(`    ✗ ${r.file}: ${r.error}`);
        });
    }

    // 新增站点列表
    const newStations = results.filter(
      (r) => r.status === "success" && r.stationCode && !["ST000002", "ST000003", "ST000004"].includes(r.stationCode)
    );
    if (newStations.length > 0) {
      console.log();
      console.log(`  新增/关联站点 ${newStations.length} 个:`);
      // 去重（同一 station_code 只打印一次）
      const seen = new Set();
      newStations.forEach((r) => {
        if (!seen.has(r.stationCode)) {
          seen.add(r.stationCode);
          console.log(`    ${r.stationCode}  ${r.province}/${r.city}  (${r.latitude}, ${r.longitude})`);
        }
      });
    }

    console.log("══════════════════════════════════════════════════════════");
  }
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------
main().catch((err) => {
  console.error("致命错误:", err);
  process.exit(1);
});
