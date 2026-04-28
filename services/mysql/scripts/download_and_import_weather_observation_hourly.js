const path = require("path");
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", "..", "sql-agent", ".env"),
  });
} catch (error) {
  // Allow the script to run when DATABASE_URL is injected by the parent process.
}
const fs = require("fs");
const https = require("https");
const mysql = require("mysql2/promise");
const {
  importHourlyCsv,
  writeProcessedCsv,
  resolveLocation,
} = require("./import_weather_observation_hourly");

const DEFAULT_CHUNK_DAYS = 10;
const DEFAULT_GRANULARITY = 2;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

function requestJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => {
          const contentType = res.headers["content-type"] || "";
          const isJson =
            contentType.includes("application/json") ||
            body.trim().startsWith("{") ||
            body.trim().startsWith("[");

          if (!isJson) {
            reject(
              new Error(
                `接口未返回 JSON，状态码 ${res.statusCode ?? "unknown"}，响应头 ${contentType}`
              )
            );
            return;
          }

          let payload;
          try {
            payload = JSON.parse(body);
          } catch (error) {
            reject(new Error("接口返回的 JSON 解析失败"));
            return;
          }

          if ((res.statusCode || 200) >= 400) {
            reject(
              new Error(
                payload?.data?.reason ||
                  payload?.message ||
                  `接口请求失败，状态码 ${res.statusCode}`
              )
            );
            return;
          }

          resolve(payload);
        });
      })
      .on("error", reject);
  });
}

function normalizeRowsFromArchiveJson(payload) {
  const hourly = payload?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) {
    throw new Error("返回数据中缺少 hourly.time");
  }

  const rows = [];
  for (let index = 0; index < hourly.time.length; index += 1) {
    rows.push({
      time: hourly.time[index] ?? "",
      temperature_2m: hourly.temperature_2m?.[index] ?? "",
      relativehumidity_2m: hourly.relativehumidity_2m?.[index] ?? "",
      rain: hourly.rain?.[index] ?? "",
      snowfall: hourly.snowfall?.[index] ?? "",
      shortwave_radiation: hourly.shortwave_radiation?.[index] ?? "",
      windspeed_10m: hourly.windspeed_10m?.[index] ?? "",
    });
  }

  return rows;
}

function parseOption(args, name, defaultValue = null) {
  const index = args.indexOf(name);
  if (index === -1) return defaultValue;
  return args[index + 1] || defaultValue;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function parseDateOnly(value, fieldName) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) {
    throw new Error(`${fieldName} 不是合法日期，期望格式 YYYY-MM-DD: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  return new Date(date.getTime() + days * MILLIS_PER_DAY);
}

function minDate(left, right) {
  return left.getTime() <= right.getTime() ? left : right;
}

function maxDate(left, right) {
  return left.getTime() >= right.getTime() ? left : right;
}

function getBaseRange(urlText) {
  const parsed = new URL(urlText);
  const startDateText = parsed.searchParams.get("start_date");
  const endDateText = parsed.searchParams.get("end_date");

  if (!startDateText || !endDateText) {
    throw new Error("URL 中必须包含 start_date 和 end_date");
  }

  const startDate = parseDateOnly(startDateText, "start_date");
  const endDate = parseDateOnly(endDateText, "end_date");
  if (startDate.getTime() > endDate.getTime()) {
    throw new Error("start_date 不能晚于 end_date");
  }

  return {
    startDate,
    endDate,
  };
}

function buildChunkUrl(baseUrl, startDate, endDate) {
  const parsed = new URL(baseUrl);
  parsed.searchParams.set("format", "json");
  parsed.searchParams.set("start_date", formatDateOnly(startDate));
  parsed.searchParams.set("end_date", formatDateOnly(endDate));
  return parsed.toString();
}

function isDailyLimitError(error) {
  const text = String(error?.message || "");
  return /daily api request limit exceeded/i.test(text) || /日.*上限/.test(text);
}

function loadProgress(progressPath) {
  if (!fs.existsSync(progressPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(progressPath, "utf8"));
}

function saveProgress(progressPath, payload) {
  ensureParentDir(progressPath);
  fs.writeFileSync(progressPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function getDefaultPaths(regionName) {
  return {
    jsonDir: path.resolve(__dirname, "..", "downloads", regionName, "raw"),
    csvDir: path.resolve(__dirname, "..", "generated", regionName),
    progressPath: path.join(
      path.resolve(__dirname, "..", "downloads"),
      regionName,
      `${regionName}_hourly_import_progress.json`
    ),
  };
}

async function createDbConnection() {
  const url = new URL(process.env.DATABASE_URL);
  return mysql.createConnection({
    host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
}

function buildChunkFilePaths(jsonDir, csvDir, regionName, startDate, endDate) {
  const rangeText = `${formatDateOnly(startDate)}_${formatDateOnly(endDate)}`;
  return {
    rangeText,
    jsonPath: path.join(jsonDir, `weather_${regionName}_${rangeText}.json`),
    csvPath: path.join(csvDir, `processed_weather_data_${regionName}_${rangeText}.csv`),
  };
}

function buildProgressSnapshot({
  status,
  regionName,
  baseUrl,
  chunkDays,
  requestedStartDate,
  requestedEndDate,
  nextStartDate,
  lastCompletedEndDate,
  stoppedReason = null,
}) {
  return {
    status,
    regionName,
    baseUrl,
    chunkDays,
    requestedStartDate,
    requestedEndDate,
    nextStartDate,
    lastCompletedEndDate,
    stoppedReason,
    updatedAt: new Date().toISOString(),
  };
}

async function runChunkedImport({
  baseUrl,
  regionName,
  province = null,
  city = null,
  stationCode = null,
  granularity = DEFAULT_GRANULARITY,
  chunkDays,
  jsonDir,
  csvDir,
  progressPath,
  restart = false,
}) {
  const { startDate: requestedStartDate, endDate: requestedEndDate } = getBaseRange(baseUrl);
  const savedProgress = restart ? null : loadProgress(progressPath);
  const resumedStartDate =
    savedProgress?.nextStartDate
      ? parseDateOnly(savedProgress.nextStartDate, "progress.nextStartDate")
      : requestedStartDate;
  let currentStartDate = maxDate(requestedStartDate, resumedStartDate);
  const location = resolveLocation({ regionName, province, city });
  const normalizedGranularity = Number(granularity || DEFAULT_GRANULARITY);

  const summary = {
    regionName,
    province: location.province,
    city: location.city,
    stationCode,
    granularity: normalizedGranularity,
    chunkDays,
    baseUrl,
    jsonDir,
    csvDir,
    progressPath,
    requestedStartDate: formatDateOnly(requestedStartDate),
    requestedEndDate: formatDateOnly(requestedEndDate),
    resumedFromDate: formatDateOnly(currentStartDate),
    chunksSucceeded: 0,
    totalRowsRead: 0,
    totalRowsSkipped: 0,
    totalRowsInsertedOrUpdated: 0,
    stoppedByRateLimit: false,
    stoppedReason: null,
    lastCompletedEndDate: null,
    chunkResults: [],
  };

  if (currentStartDate.getTime() > requestedEndDate.getTime()) {
    summary.stoppedReason = "请求时间段已经全部处理完成";
    return summary;
  }

  const conn = await createDbConnection();
  try {
    while (currentStartDate.getTime() <= requestedEndDate.getTime()) {
      const currentEndDate = minDate(
        addDays(currentStartDate, chunkDays - 1),
        requestedEndDate
      );
      const chunkUrl = buildChunkUrl(baseUrl, currentStartDate, currentEndDate);
      const { rangeText, jsonPath, csvPath } = buildChunkFilePaths(
        jsonDir,
        csvDir,
        regionName,
        currentStartDate,
        currentEndDate
      );

      let payload;
      try {
        payload = await requestJson(chunkUrl);
      } catch (error) {
        if (!isDailyLimitError(error)) {
          throw error;
        }

        summary.stoppedByRateLimit = true;
        summary.stoppedReason = error.message;
        saveProgress(
          progressPath,
          buildProgressSnapshot({
            status: "paused_rate_limit",
            regionName,
            baseUrl,
            chunkDays,
            requestedStartDate: formatDateOnly(requestedStartDate),
            requestedEndDate: formatDateOnly(requestedEndDate),
            nextStartDate: formatDateOnly(currentStartDate),
            lastCompletedEndDate: summary.lastCompletedEndDate,
            stoppedReason: error.message,
          })
        );
        return summary;
      }

      const rows = normalizeRowsFromArchiveJson(payload);
      ensureParentDir(jsonPath);
      fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      writeProcessedCsv(csvPath, rows);

      const importSummary = await importHourlyCsv({
        csvPath,
        regionName,
        province: location.province,
        city: location.city,
        latitude: payload?.latitude,
        longitude: payload?.longitude,
        stationCode,
        granularity: normalizedGranularity,
        connection: conn,
      });

      if (!summary.stationCode && importSummary.stationCode) {
        summary.stationCode = importSummary.stationCode;
        stationCode = importSummary.stationCode;
      }

      summary.chunksSucceeded += 1;
      summary.totalRowsRead += importSummary.rowsRead;
      summary.totalRowsSkipped += importSummary.rowsSkipped;
      summary.totalRowsInsertedOrUpdated += importSummary.rowsInsertedOrUpdated;
      summary.lastCompletedEndDate = formatDateOnly(currentEndDate);
      summary.chunkResults.push({
        range: rangeText,
        jsonPath,
        csvPath,
        stationCode: importSummary.stationCode,
        province: importSummary.province,
        city: importSummary.city,
        rowsRead: importSummary.rowsRead,
        rowsSkipped: importSummary.rowsSkipped,
        rowsInsertedOrUpdated: importSummary.rowsInsertedOrUpdated,
        weatherDirectorySynced: importSummary.weatherDirectorySynced,
      });

      const nextStartDate = addDays(currentEndDate, 1);
      saveProgress(
        progressPath,
        buildProgressSnapshot({
          status:
            nextStartDate.getTime() > requestedEndDate.getTime()
              ? "completed"
              : "in_progress",
          regionName,
          baseUrl,
          chunkDays,
          requestedStartDate: formatDateOnly(requestedStartDate),
          requestedEndDate: formatDateOnly(requestedEndDate),
          nextStartDate:
            nextStartDate.getTime() > requestedEndDate.getTime()
              ? null
              : formatDateOnly(nextStartDate),
          lastCompletedEndDate: formatDateOnly(currentEndDate),
        })
      );

      currentStartDate = nextStartDate;
    }

    return summary;
  } finally {
    await conn.end();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const baseUrl = args[0];
  const regionName = args[1];
  const chunkDays = Number(parseOption(args, "--chunk-days", String(DEFAULT_CHUNK_DAYS)));
  const restart = hasFlag(args, "--restart");
  const province = parseOption(args, "--province", null);
  const city = parseOption(args, "--city", null);
  const stationCode = parseOption(args, "--station-code", null);
  const granularity = Number(parseOption(args, "--granularity", String(DEFAULT_GRANULARITY)));

  if (!baseUrl || !regionName) {
    throw new Error(
      "用法: node SQL/download_and_import_weather_observation_hourly.js <url> <regionName|province/city> [--chunk-days 10] [--json-dir <dir>] [--csv-dir <dir>] [--progress-file <file>] [--province <province>] [--city <city>] [--station-code <code>] [--granularity <number>] [--restart]"
    );
  }

  if (!Number.isInteger(chunkDays) || chunkDays <= 0) {
    throw new Error(`--chunk-days 必须是正整数，当前值: ${chunkDays}`);
  }

  if (!Number.isInteger(granularity) || granularity <= 0) {
    throw new Error(`--granularity 必须是正整数，当前值: ${granularity}`);
  }

  const defaults = getDefaultPaths(regionName);
  const summary = await runChunkedImport({
    baseUrl,
    regionName,
    province,
    city,
    stationCode,
    granularity,
    chunkDays,
    jsonDir: parseOption(args, "--json-dir", defaults.jsonDir),
    csvDir: parseOption(args, "--csv-dir", defaults.csvDir),
    progressPath: parseOption(args, "--progress-file", defaults.progressPath),
    restart,
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
  requestJson,
  normalizeRowsFromArchiveJson,
  getBaseRange,
  buildChunkUrl,
  runChunkedImport,
};
