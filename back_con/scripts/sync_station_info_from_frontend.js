const fs = require("fs");
const path = require("path");
const vm = require("vm");
const mysql = require("mysql2/promise");

const DEFAULT_GRANULARITY = 2;

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const fallbackEnvPath = path.resolve(__dirname, "..", "..", "sql-agent", ".env");
  if (!fs.existsSync(fallbackEnvPath)) {
    throw new Error("DATABASE_URL 未设置，且未找到 sql-agent/.env");
  }

  const text = fs.readFileSync(fallbackEnvPath, "utf8");
  const match = text.match(/^\s*DATABASE_URL\s*=\s*["']?(.+?)["']?\s*$/m);
  if (!match) {
    throw new Error("未能从 sql-agent/.env 解析出 DATABASE_URL");
  }
  return match[1];
}

function extractProvinceCityMap(frontendFilePath) {
  const text = fs.readFileSync(frontendFilePath, "utf8");
  const match = text.match(/PROVINCE_CITY_MAP\s*:\s*(\{[\s\S]*?\})\s*,\s*headerRowIndex/);
  if (!match) {
    throw new Error(`未在 ${frontendFilePath} 中找到 PROVINCE_CITY_MAP`);
  }

  const map = vm.runInNewContext(`(${match[1]})`);
  if (!map || typeof map !== "object") {
    throw new Error("PROVINCE_CITY_MAP 解析失败");
  }
  return map;
}

async function ensureStationInfoTable(conn) {
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

  const [columns] = await conn.query("SHOW COLUMNS FROM station_info");
  const fieldSet = new Set(columns.map((column) => column.Field));

  if (!fieldSet.has("latitude")) {
    await conn.query("ALTER TABLE station_info ADD COLUMN latitude DECIMAL(10,8) NULL AFTER city");
  }
  if (!fieldSet.has("longitude")) {
    await conn.query("ALTER TABLE station_info ADD COLUMN longitude DECIMAL(11,8) NULL AFTER latitude");
  }
}

function buildStationCode(nextNumber) {
  return `ST${String(nextNumber).padStart(6, "0")}`;
}

async function syncStationInfoFromFrontend() {
  const frontendFilePath = path.resolve(
    __dirname,
    "..",
    "..",
    "front_con",
    "src",
    "views",
    "components",
    "aiUpload.vue"
  );
  const provinceCityMap = extractProvinceCityMap(frontendFilePath);
  const databaseUrl = readDatabaseUrl();
  const parsedUrl = new URL(databaseUrl);

  const conn = await mysql.createConnection({
    host: parsedUrl.hostname === "localhost" ? "127.0.0.1" : parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.slice(1),
  });

  try {
    await ensureStationInfoTable(conn);

    const [existingRows] = await conn.query(`
      SELECT station_code, province, city, granularity
      FROM station_info
      WHERE granularity = ?
    `, [DEFAULT_GRANULARITY]);

    const existingMap = new Map();
    let maxNumericCode = 0;

    for (const row of existingRows) {
      const key = `${row.province}|||${row.city}|||${row.granularity}`;
      existingMap.set(key, row.station_code);

      const numeric = parseInt(String(row.station_code || "").replace(/\D/g, ""), 10);
      if (!Number.isNaN(numeric) && numeric > maxNumericCode) {
        maxNumericCode = numeric;
      }
    }

    let nextCodeNumber = maxNumericCode + 1;
    const inserts = [];
    let existingCount = 0;

    for (const [province, cities] of Object.entries(provinceCityMap)) {
      for (const city of cities) {
        const key = `${province}|||${city}|||${DEFAULT_GRANULARITY}`;
        if (existingMap.has(key)) {
          existingCount += 1;
          continue;
        }

        inserts.push([
          buildStationCode(nextCodeNumber),
          province,
          city,
          null,
          null,
          DEFAULT_GRANULARITY,
        ]);
        nextCodeNumber += 1;
      }
    }

    if (inserts.length > 0) {
      const placeholders = inserts.map(() => "(?,?,?,?,?,?)").join(",");
      const flatValues = inserts.flat();
      await conn.query(
        `
          INSERT INTO station_info
            (station_code, province, city, latitude, longitude, granularity)
          VALUES ${placeholders}
        `,
        flatValues
      );
    }

    const [summaryRows] = await conn.query(`
      SELECT COUNT(*) AS station_count
      FROM station_info
      WHERE granularity = ?
    `, [DEFAULT_GRANULARITY]);

    return {
      frontendFilePath,
      provinceCount: Object.keys(provinceCityMap).length,
      cityCount: Object.values(provinceCityMap).reduce((sum, cities) => sum + cities.length, 0),
      insertedCount: inserts.length,
      existingCount,
      stationCount: summaryRows[0].station_count,
      firstInserted: inserts.slice(0, 5).map(([stationCode, province, city]) => ({
        stationCode,
        province,
        city,
      })),
    };
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  syncStationInfoFromFrontend()
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  extractProvinceCityMap,
  syncStationInfoFromFrontend,
};
