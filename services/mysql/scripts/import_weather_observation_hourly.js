const path = require("path");
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", "..", "sql-agent", ".env"),
  });
} catch (error) {
  // Allow the script to run when DATABASE_URL is injected by the parent process.
}
const fs = require("fs");
const readline = require("readline");
const mysql = require("mysql2/promise");

const STANDARD_HEADERS = [
  "time",
  "temperature_2m",
  "relativehumidity_2m",
  "rain",
  "snowfall",
  "shortwave_radiation",
  "windspeed_10m",
];

const DEFAULT_GRANULARITY = 2;

function parseNullableDecimal(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function parseNullableInteger(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? Math.round(num) : null;
}

function parseNullableCoordinate(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function normalizeRecordTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace("T", " ");
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(normalized)) {
    return `${normalized}:00`;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }
  return null;
}

function normalizeRowShape(row) {
  return {
    time: row.time ?? "",
    temperature_2m: row.temperature_2m ?? "",
    relativehumidity_2m: row.relativehumidity_2m ?? "",
    rain: row.rain ?? "",
    snowfall: row.snowfall ?? "",
    shortwave_radiation: row.shortwave_radiation ?? "",
    windspeed_10m: row.windspeed_10m ?? "",
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? "" : String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function parseLocationSpec(regionName) {
  const text = String(regionName || "").trim();
  if (!text) {
    return { province: null, city: null };
  }

  for (const separator of ["/", "\\", ",", ":", "|"]) {
    if (!text.includes(separator)) continue;
    const [left, right] = text.split(separator).map((item) => item.trim());
    if (left && right) {
      return { province: left, city: right };
    }
  }

  return { province: text, city: text };
}

function resolveLocation({ regionName, province = null, city = null }) {
  if (province && city) {
    return { province: String(province).trim(), city: String(city).trim() };
  }

  const parsed = parseLocationSpec(regionName);
  return {
    province: province ? String(province).trim() : parsed.province,
    city: city ? String(city).trim() : parsed.city,
  };
}

async function ensureTables(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS weather_data (
      station_code VARCHAR(50) NOT NULL,
      granularity TINYINT NOT NULL,
      record_time DATETIME NOT NULL,
      avg_temperature DECIMAL(7,2) NULL,
      relativehumidity_2m DECIMAL(5,2) NULL,
      rain_sum DECIMAL(8,2) NULL,
      snow_sum DECIMAL(8,2) NULL,
      max_continuous_wind_speed DECIMAL(6,2) NULL,
      windgusts_max DECIMAL(6,2) NULL,
      winddirection_dominant SMALLINT NULL,
      shortwave_radiation_sum DECIMAL(8,2) NULL,
      create_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (station_code, granularity, record_time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS station_info (
      station_code VARCHAR(50) NOT NULL,
      province VARCHAR(50) NOT NULL,
      city VARCHAR(50) NOT NULL,
      latitude DECIMAL(10,8) NULL,
      longitude DECIMAL(11,8) NULL,
      granularity TINYINT NOT NULL DEFAULT 2,
      create_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (station_code, granularity)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS weather_directory (
      id INT NOT NULL AUTO_INCREMENT,
      province VARCHAR(50) NOT NULL,
      city VARCHAR(50) NOT NULL,
      station_code VARCHAR(50) NOT NULL,
      granularity TINYINT NOT NULL,
      start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,
      total_count INT NOT NULL DEFAULT 0,
      update_time TIMESTAMP NULL DEFAULT NULL,
      create_time TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_prov_city_station_gran (province, city, station_code, granularity),
      KEY idx_province_city (province, city)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function upsertStationInfo(conn, { stationCode, province, city, latitude = null, longitude = null, granularity }) {
  await conn.query(
    `
      INSERT INTO station_info
        (station_code, province, city, latitude, longitude, granularity)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        province = VALUES(province),
        city = VALUES(city),
        latitude = COALESCE(VALUES(latitude), latitude),
        longitude = COALESCE(VALUES(longitude), longitude)
    `,
    [stationCode, province, city, latitude, longitude, granularity]
  );
}

async function ensureStationCode(
  conn,
  { province, city, latitude = null, longitude = null, granularity, preferredStationCode = null }
) {
  const [existingRows] = await conn.query(
    `
      SELECT station_code
      FROM station_info
      WHERE province = ? AND city = ? AND granularity = ?
      LIMIT 1
    `,
    [province, city, granularity]
  );

  if (existingRows.length > 0) {
    const stationCode = String(existingRows[0].station_code);
    await upsertStationInfo(conn, {
      stationCode,
      province,
      city,
      latitude,
      longitude,
      granularity,
    });
    return stationCode;
  }

  let stationCode = preferredStationCode ? String(preferredStationCode).trim() : "";
  if (!stationCode) {
    const [maxRows] = await conn.query(
      `
        SELECT station_code
        FROM station_info
        ORDER BY station_code DESC
        LIMIT 1
      `
    );

    let nextNum = 1;
    if (maxRows.length > 0) {
      const num = parseInt(String(maxRows[0].station_code || "").replace(/\D/g, ""), 10);
      if (!Number.isNaN(num)) {
        nextNum = num + 1;
      }
    }
    stationCode = `ST${String(nextNum).padStart(6, "0")}`;
  }

  await upsertStationInfo(conn, {
    stationCode,
    province,
    city,
    latitude,
    longitude,
    granularity,
  });

  return stationCode;
}

async function syncWeatherDirectory(conn, { stationCode, granularity }) {
  const [rows] = await conn.query(
    `
      SELECT
        si.province,
        si.city,
        wd.station_code,
        wd.granularity,
        MIN(wd.record_time) AS start_time,
        MAX(wd.record_time) AS end_time,
        COUNT(*) AS total_count
      FROM weather_data wd
      JOIN station_info si
        ON si.station_code = wd.station_code
       AND si.granularity = wd.granularity
      WHERE wd.station_code = ?
        AND wd.granularity = ?
      GROUP BY si.province, si.city, wd.station_code, wd.granularity
    `,
    [stationCode, granularity]
  );

  if (!rows.length) return false;

  const row = rows[0];
  await conn.query(
    `
      INSERT INTO weather_directory
        (province, city, station_code, granularity, start_time, end_time, total_count)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        start_time = VALUES(start_time),
        end_time = VALUES(end_time),
        total_count = VALUES(total_count),
        update_time = CURRENT_TIMESTAMP
    `,
    [
      row.province,
      row.city,
      row.station_code,
      row.granularity,
      row.start_time,
      row.end_time,
      row.total_count,
    ]
  );

  return true;
}

async function flushBatch(conn, batch, summary) {
  if (!batch.length) return;

  const placeholders = batch.map(() => "(?,?,?,?,?,?,?,?,?)").join(",");
  const flat = batch.flat();
  const sql = `
    INSERT INTO weather_data
      (
        station_code,
        granularity,
        record_time,
        avg_temperature,
        relativehumidity_2m,
        rain_sum,
        snow_sum,
        max_continuous_wind_speed,
        shortwave_radiation_sum
      )
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

async function loadProcessedCsvRows(csvPath) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const rows = [];
  let headers = null;

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;

    if (!headers) {
      headers = line.split(",").map((item) => item.trim());
      continue;
    }

    const values = line.split(",").map((item) => item.trim());
    if (values.length !== headers.length) {
      continue;
    }

    const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]));
    rows.push(normalizeRowShape(row));
  }

  return rows;
}

function splitArchiveLine(line) {
  const separatorIndex = line.indexOf(",");
  if (separatorIndex === -1) {
    return [line.trim(), ""];
  }
  return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1)];
}

function decodeArchiveValue(rawValue) {
  const trimmed = String(rawValue ?? "").trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function loadArchiveCsvRows(csvPath) {
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  const keyValueMap = new Map();

  for (const line of lines) {
    const [key, value] = splitArchiveLine(line);
    keyValueMap.set(key, decodeArchiveValue(value));
  }

  const hourlyRaw = keyValueMap.get("hourly");
  if (!hourlyRaw) {
    throw new Error("原始 archive CSV 中没有找到 hourly 字段");
  }

  const hourly = JSON.parse(hourlyRaw);
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  const rows = [];

  for (let index = 0; index < times.length; index += 1) {
    rows.push(
      normalizeRowShape({
        time: times[index],
        temperature_2m: hourly.temperature_2m?.[index],
        relativehumidity_2m: hourly.relativehumidity_2m?.[index],
        rain: hourly.rain?.[index],
        snowfall: hourly.snowfall?.[index],
        shortwave_radiation: hourly.shortwave_radiation?.[index],
        windspeed_10m: hourly.windspeed_10m?.[index],
      })
    );
  }

  return rows;
}

async function detectInputFormat(csvPath) {
  const stream = fs.createReadStream(csvPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (value) => {
      if (!settled) {
        settled = true;
        rl.close();
        stream.destroy();
        resolve(value);
      }
    };

    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      finish(trimmed.startsWith("time,") ? "processed_csv" : "archive_csv");
    });

    rl.on("close", () => finish("archive_csv"));
    rl.on("error", reject);
    stream.on("error", reject);
  });
}

async function loadNormalizedRows(csvPath) {
  const format = await detectInputFormat(csvPath);
  const rows =
    format === "processed_csv"
      ? await loadProcessedCsvRows(csvPath)
      : loadArchiveCsvRows(csvPath);

  return { format, rows };
}

function writeProcessedCsv(outputPath, rows) {
  const lines = [STANDARD_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(STANDARD_HEADERS.map((header) => csvEscape(row[header])).join(","));
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function validateInput({ csvPath, regionName, province, city }) {
  if (!csvPath || !(regionName || (province && city))) {
    throw new Error(
      "用法: node SQL/import_weather_observation_hourly.js <csvPath> <regionName|province/city> [--output <outputCsvPath>] [--province <province>] [--city <city>] [--station-code <code>] [--granularity <number>]"
    );
  }

  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV 文件不存在: ${csvPath}`);
  }
}

async function importHourlyCsv({
  csvPath,
  regionName,
  province = null,
  city = null,
  latitude = null,
  longitude = null,
  stationCode = null,
  granularity = DEFAULT_GRANULARITY,
  outputPath = null,
  connection = null,
}) {
  validateInput({ csvPath, regionName, province, city });

  let conn = connection;
  let shouldCloseConnection = false;

  if (!conn) {
    const url = new URL(process.env.DATABASE_URL);
    conn = await mysql.createConnection({
      host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
    });
    shouldCloseConnection = true;
  }

  const location = resolveLocation({ regionName, province, city });
  const normalizedGranularity = Number(granularity || DEFAULT_GRANULARITY);

  const summary = {
    regionName,
    province: location.province,
    city: location.city,
    latitude: parseNullableCoordinate(latitude),
    longitude: parseNullableCoordinate(longitude),
    csvPath,
    inputFormat: null,
    outputPath,
    stationCode: null,
    granularity: normalizedGranularity,
    rowsRead: 0,
    rowsSkipped: 0,
    rowsInsertedOrUpdated: 0,
    weatherDirectorySynced: false,
  };

  try {
    await ensureTables(conn);

    if (!location.province || !location.city) {
      throw new Error("无法确定 province/city，请传入 regionName 或同时传入 --province 和 --city");
    }

    const resolvedStationCode = await ensureStationCode(conn, {
      province: location.province,
      city: location.city,
      latitude: summary.latitude,
      longitude: summary.longitude,
      granularity: normalizedGranularity,
      preferredStationCode: stationCode,
    });
    summary.stationCode = resolvedStationCode;

    const { format, rows } = await loadNormalizedRows(csvPath);
    summary.inputFormat = format;

    if (outputPath) {
      writeProcessedCsv(outputPath, rows);
    }

    const batch = [];
    for (const row of rows) {
      const recordTime = normalizeRecordTime(row.time);
      if (!recordTime) {
        summary.rowsSkipped += 1;
        continue;
      }

      summary.rowsRead += 1;
      const snowfallValue = parseNullableDecimal(row.snowfall);
      const snowSum = snowfallValue === null ? null : Math.round(snowfallValue * 10 * 100) / 100;

      batch.push([
        resolvedStationCode,
        normalizedGranularity,
        recordTime,
        parseNullableDecimal(row.temperature_2m),
        parseNullableDecimal(row.relativehumidity_2m),
        parseNullableDecimal(row.rain),
        snowSum,
        parseNullableDecimal(row.windspeed_10m),
        parseNullableDecimal(row.shortwave_radiation),
      ]);

      if (batch.length >= 1000) {
        await flushBatch(conn, batch, summary);
      }
    }

    await flushBatch(conn, batch, summary);
    summary.weatherDirectorySynced = await syncWeatherDirectory(conn, {
      stationCode: resolvedStationCode,
      granularity: normalizedGranularity,
    });

    return summary;
  } finally {
    if (shouldCloseConnection) {
      await conn.end();
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const csvPath = args[0];
  const regionName = args[1];
  const outputFlagIndex = args.indexOf("--output");
  const provinceFlagIndex = args.indexOf("--province");
  const cityFlagIndex = args.indexOf("--city");
  const stationCodeFlagIndex = args.indexOf("--station-code");
  const granularityFlagIndex = args.indexOf("--granularity");
  const latitudeFlagIndex = args.indexOf("--latitude");
  const longitudeFlagIndex = args.indexOf("--longitude");

  const outputPath =
    outputFlagIndex !== -1 && args[outputFlagIndex + 1]
      ? args[outputFlagIndex + 1]
      : null;
  const province =
    provinceFlagIndex !== -1 && args[provinceFlagIndex + 1]
      ? args[provinceFlagIndex + 1]
      : null;
  const city =
    cityFlagIndex !== -1 && args[cityFlagIndex + 1]
      ? args[cityFlagIndex + 1]
      : null;
  const stationCode =
    stationCodeFlagIndex !== -1 && args[stationCodeFlagIndex + 1]
      ? args[stationCodeFlagIndex + 1]
      : null;
  const latitude =
    latitudeFlagIndex !== -1 && args[latitudeFlagIndex + 1]
      ? args[latitudeFlagIndex + 1]
      : null;
  const longitude =
    longitudeFlagIndex !== -1 && args[longitudeFlagIndex + 1]
      ? args[longitudeFlagIndex + 1]
      : null;
  const granularity =
    granularityFlagIndex !== -1 && args[granularityFlagIndex + 1]
      ? Number(args[granularityFlagIndex + 1])
      : DEFAULT_GRANULARITY;

  const summary = await importHourlyCsv({
    csvPath,
    regionName,
    province,
    city,
    latitude,
    longitude,
    stationCode,
    granularity,
    outputPath,
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  STANDARD_HEADERS,
  detectInputFormat,
  loadNormalizedRows,
  writeProcessedCsv,
  parseLocationSpec,
  resolveLocation,
  importHourlyCsv,
};
