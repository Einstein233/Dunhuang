const fs = require("fs");
const path = require("path");
const https = require("https");
const mysql = require("mysql2/promise");

const DEFAULT_GRANULARITY = 2;
const REGION_SQL_URL =
  "https://raw.githubusercontent.com/pfinal/city/refs/heads/master/region.sql";
const CACHE_DIR = path.resolve(__dirname, ".cache");
const CACHE_FILE = path.join(CACHE_DIR, "region.sql");
const MANUAL_COORDINATE_OVERRIDES = new Map([
  ["台湾|||台北", { sourceName: "台北", latitude: 25.05306, longitude: 121.52639 }],
  ["台湾|||台中", { sourceName: "台中", latitude: 24.1469, longitude: 120.6839 }],
  ["台湾|||台南", { sourceName: "台南", latitude: 22.99083, longitude: 120.21333 }],
  ["台湾|||高雄", { sourceName: "高雄", latitude: 22.61626, longitude: 120.31333 }],
  ["台湾|||基隆", { sourceName: "基隆", latitude: 25.13089, longitude: 121.74094 }],
  ["台湾|||新竹", { sourceName: "新竹", latitude: 24.80361, longitude: 120.96861 }],
  ["台湾|||嘉义", { sourceName: "嘉义", latitude: 23.47917, longitude: 120.44889 }],
]);

function readDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const fallbackEnvPath = path.resolve(
    __dirname,
    "..",
    "..",
    "services",
    "sql-agent",
    ".env"
  );
  if (!fs.existsSync(fallbackEnvPath)) {
    throw new Error("DATABASE_URL 未设置，且未找到 services/sql-agent/.env");
  }

  const text = fs.readFileSync(fallbackEnvPath, "utf8");
  const match = text.match(/^\s*DATABASE_URL\s*=\s*["']?(.+?)["']?\s*$/m);
  if (!match) {
    throw new Error("未能从 services/sql-agent/.env 解析 DATABASE_URL");
  }
  return match[1];
}

function parseArgs(argv) {
  const args = {
    dryRun: false,
    limit: null,
    granularity: DEFAULT_GRANULARITY,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    if (current === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (current === "--limit" && argv[i + 1]) {
      args.limit = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (current === "--granularity" && argv[i + 1]) {
      args.granularity = Number(argv[i + 1]);
      i += 1;
    }
  }

  return args;
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        {
          headers: {
            "User-Agent": "dh-web-station-coordinate-sync/1.0",
          },
        },
        (response) => {
          if (response.statusCode && response.statusCode >= 400) {
            reject(new Error(`请求失败: HTTP ${response.statusCode}`));
            response.resume();
            return;
          }

          let text = "";
          response.setEncoding("utf8");
          response.on("data", (chunk) => {
            text += chunk;
          });
          response.on("end", () => resolve(text));
        }
      )
      .on("error", reject);
  });
}

async function loadRegionSql() {
  ensureDirectory(CACHE_DIR);

  try {
    const remoteSql = await requestText(REGION_SQL_URL);
    fs.writeFileSync(CACHE_FILE, remoteSql, "utf8");
    return { sql: remoteSql, source: "remote" };
  } catch (error) {
    if (fs.existsSync(CACHE_FILE)) {
      return {
        sql: fs.readFileSync(CACHE_FILE, "utf8"),
        source: "cache",
        fallbackError: error.message,
      };
    }
    throw error;
  }
}

function parseRegionSql(sqlText) {
  const rows = [];
  const tuplePattern =
    /\('([^']*)','([^']*)','([^']*)','([^']*)','([^']*)','([^']*)',(NULL|'[^']*')\)/g;

  let match = tuplePattern.exec(sqlText);
  while (match) {
    rows.push({
      id: match[1],
      name: match[2],
      parentId: match[3],
      lng: Number(match[4]),
      lat: Number(match[5]),
    });
    match = tuplePattern.exec(sqlText);
  }

  return rows;
}

function stripSuffixes(input, suffixes) {
  let value = String(input || "").trim();
  let changed = true;

  while (value && changed) {
    changed = false;
    for (const suffix of suffixes) {
      if (value.endsWith(suffix)) {
        value = value.slice(0, -suffix.length).trim();
        changed = true;
        break;
      }
    }
  }

  return value;
}

function removeEthnicMarkers(input) {
  const markers = [
    "蒙古族",
    "土家族",
    "苗族",
    "朝鲜族",
    "藏族",
    "羌族",
    "傣族",
    "景颇族",
    "傈僳族",
    "白族",
    "彝族",
    "哈尼族",
    "壮族",
    "布依族",
    "侗族",
    "哈萨克",
    "柯尔克孜",
    "维吾尔",
    "回族",
    "撒拉族",
    "蒙古",
    "土家",
    "苗",
    "朝鲜",
    "藏",
    "羌",
    "傣",
    "景颇",
    "傈僳",
    "白",
    "彝",
    "哈尼",
    "壮",
    "布依",
    "侗",
    "回",
  ];

  let value = String(input || "");
  for (const marker of markers) {
    value = value.replace(new RegExp(marker, "g"), "");
  }
  return value.trim();
}

function normalizeProvince(name) {
  return stripSuffixes(String(name || "").replace(/臺/g, "台"), [
    "特别行政区",
    "维吾尔自治区",
    "壮族自治区",
    "回族自治区",
    "自治区",
    "省",
    "市",
  ]);
}

function normalizeCity(name) {
  const stripped = stripSuffixes(String(name || "").replace(/臺/g, "台"), [
    "特别行政区",
    "自治州",
    "自治县",
    "自治旗",
    "矿区",
    "林区",
    "地区",
    "盟",
    "州",
    "市",
    "区",
    "县",
    "旗",
  ]);

  return removeEthnicMarkers(stripped);
}

function getProvinceRow(row, rowById) {
  let current = row;
  while (current && current.parentId) {
    const parent = rowById.get(current.parentId);
    if (!parent) {
      break;
    }
    current = parent;
  }
  return current;
}

function bd09ToGcj02(longitude, latitude) {
  const xPi = (Math.PI * 3000.0) / 180.0;
  const x = longitude - 0.0065;
  const y = latitude - 0.006;
  const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * xPi);
  const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * xPi);
  return {
    longitude: z * Math.cos(theta),
    latitude: z * Math.sin(theta),
  };
}

function outOfChina(longitude, latitude) {
  return longitude < 72.004 || longitude > 137.8347 || latitude < 0.8293 || latitude > 55.8271;
}

function transformLatitude(longitude, latitude) {
  let result =
    -100.0 +
    2.0 * longitude +
    3.0 * latitude +
    0.2 * latitude * latitude +
    0.1 * longitude * latitude +
    0.2 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20.0 * Math.sin(6.0 * longitude * Math.PI) +
      20.0 * Math.sin(2.0 * longitude * Math.PI)) *
      2.0) /
    3.0;
  result +=
    ((20.0 * Math.sin(latitude * Math.PI) +
      40.0 * Math.sin((latitude / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  result +=
    ((160.0 * Math.sin((latitude / 12.0) * Math.PI) +
      320.0 * Math.sin((latitude * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return result;
}

function transformLongitude(longitude, latitude) {
  let result =
    300.0 +
    longitude +
    2.0 * latitude +
    0.1 * longitude * longitude +
    0.1 * longitude * latitude +
    0.1 * Math.sqrt(Math.abs(longitude));
  result +=
    ((20.0 * Math.sin(6.0 * longitude * Math.PI) +
      20.0 * Math.sin(2.0 * longitude * Math.PI)) *
      2.0) /
    3.0;
  result +=
    ((20.0 * Math.sin(longitude * Math.PI) +
      40.0 * Math.sin((longitude / 3.0) * Math.PI)) *
      2.0) /
    3.0;
  result +=
    ((150.0 * Math.sin((longitude / 12.0) * Math.PI) +
      300.0 * Math.sin((longitude * Math.PI) / 30.0)) *
      2.0) /
    3.0;
  return result;
}

function gcj02ToWgs84(longitude, latitude) {
  if (outOfChina(longitude, latitude)) {
    return { longitude, latitude };
  }

  const semiMajorAxis = 6378245.0;
  const eccentricity = 0.00669342162296594323;

  let deltaLatitude = transformLatitude(longitude - 105.0, latitude - 35.0);
  let deltaLongitude = transformLongitude(longitude - 105.0, latitude - 35.0);
  const radLatitude = (latitude / 180.0) * Math.PI;

  let magic = Math.sin(radLatitude);
  magic = 1 - eccentricity * magic * magic;
  const sqrtMagic = Math.sqrt(magic);

  deltaLatitude =
    (deltaLatitude * 180.0) /
    (((semiMajorAxis * (1 - eccentricity)) / (magic * sqrtMagic)) * Math.PI);
  deltaLongitude =
    (deltaLongitude * 180.0) /
    ((semiMajorAxis / sqrtMagic) * Math.cos(radLatitude) * Math.PI);

  const gcjLatitude = latitude + deltaLatitude;
  const gcjLongitude = longitude + deltaLongitude;

  return {
    longitude: longitude * 2 - gcjLongitude,
    latitude: latitude * 2 - gcjLatitude,
  };
}

function bd09ToWgs84(longitude, latitude) {
  const gcj02 = bd09ToGcj02(longitude, latitude);
  return gcj02ToWgs84(gcj02.longitude, gcj02.latitude);
}

function buildRegionLookup(rows) {
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const exactMap = new Map();
  const provinceBuckets = new Map();

  function addCandidate(provinceNorm, cityNorm, row, level) {
    if (!provinceNorm || !cityNorm || !Number.isFinite(row.lng) || !Number.isFinite(row.lat)) {
      return;
    }

    const key = `${provinceNorm}|||${cityNorm}`;
    const candidate = {
      id: row.id,
      name: row.name,
      provinceNorm,
      cityNorm,
      level,
      bdLongitude: row.lng,
      bdLatitude: row.lat,
    };

    const existing = exactMap.get(key);
    if (!existing || level < existing.level) {
      exactMap.set(key, candidate);
    }

    const bucket = provinceBuckets.get(provinceNorm) || [];
    bucket.push(candidate);
    provinceBuckets.set(provinceNorm, bucket);
  }

  for (const row of rows) {
    const provinceRow = getProvinceRow(row, rowById);
    if (!provinceRow) {
      continue;
    }

    const provinceNorm = normalizeProvince(provinceRow.name);

    if (row.id.length === 2) {
      addCandidate(provinceNorm, provinceNorm, row, 0);
      continue;
    }

    if (row.id.length !== 4 && row.id.length !== 6) {
      continue;
    }

    const cityNorm = row.name === "市辖区" ? provinceNorm : normalizeCity(row.name);
    addCandidate(provinceNorm, cityNorm, row, row.id.length === 4 ? 1 : 2);
  }

  return { exactMap, provinceBuckets };
}

function pickBestCandidate(candidates, cityNorm) {
  if (!candidates || candidates.length === 0) {
    return null;
  }

  const exact = candidates.find((candidate) => candidate.cityNorm === cityNorm);
  if (exact) {
    return exact;
  }

  const prefixMatches = candidates.filter(
    (candidate) =>
      candidate.cityNorm.startsWith(cityNorm) || cityNorm.startsWith(candidate.cityNorm)
  );
  if (prefixMatches.length > 0) {
    prefixMatches.sort((left, right) => left.level - right.level || left.cityNorm.length - right.cityNorm.length);
    return prefixMatches[0];
  }

  const containsMatches = candidates.filter(
    (candidate) =>
      candidate.cityNorm.includes(cityNorm) || cityNorm.includes(candidate.cityNorm)
  );
  if (containsMatches.length > 0) {
    containsMatches.sort((left, right) => left.level - right.level || left.cityNorm.length - right.cityNorm.length);
    return containsMatches[0];
  }

  return null;
}

function matchStationRow(row, lookup) {
  const provinceNorm = normalizeProvince(row.province);
  const cityNorm = normalizeCity(row.city);
  const exactKey = `${provinceNorm}|||${cityNorm}`;
  const manualOverride = MANUAL_COORDINATE_OVERRIDES.get(exactKey);

  if (manualOverride) {
    return {
      matchType: "manual",
      provinceNorm,
      cityNorm,
      candidate: {
        sourceName: manualOverride.sourceName,
        latitude: manualOverride.latitude,
        longitude: manualOverride.longitude,
      },
    };
  }

  const exact = lookup.exactMap.get(exactKey);
  if (exact) {
    return {
      matchType: "exact",
      provinceNorm,
      cityNorm,
      candidate: exact,
    };
  }

  const bucket = lookup.provinceBuckets.get(provinceNorm) || [];
  const candidate = pickBestCandidate(bucket, cityNorm);
  if (!candidate) {
    return {
      matchType: "unmatched",
      provinceNorm,
      cityNorm,
      candidate: null,
    };
  }

  return {
    matchType: "fuzzy",
    provinceNorm,
    cityNorm,
    candidate,
  };
}

async function createConnection() {
  const databaseUrl = readDatabaseUrl();
  const parsedUrl = new URL(databaseUrl);

  return mysql.createConnection({
    host: parsedUrl.hostname === "localhost" ? "127.0.0.1" : parsedUrl.hostname,
    port: Number(parsedUrl.port || 3306),
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.slice(1),
  });
}

async function loadTargetRows(connection, granularity, limit) {
  let sql = `
    SELECT station_code, province, city, latitude, longitude, granularity
    FROM station_info
    WHERE granularity = ?
      AND (latitude IS NULL OR longitude IS NULL)
    ORDER BY station_code
  `;
  const params = [granularity];

  if (Number.isFinite(limit) && limit > 0) {
    sql += " LIMIT ?";
    params.push(limit);
  }

  const [rows] = await connection.query(sql, params);
  return rows;
}

async function updateRowCoordinates(connection, row, longitude, latitude) {
  await connection.query(
    `
      UPDATE station_info
      SET latitude = ?, longitude = ?
      WHERE station_code = ?
        AND granularity = ?
        AND (latitude IS NULL OR longitude IS NULL)
    `,
    [latitude, longitude, row.station_code, row.granularity]
  );
}

async function fillStationCoordinates(options = {}) {
  const args = {
    dryRun: Boolean(options.dryRun),
    limit: Number.isFinite(options.limit) ? options.limit : null,
    granularity: Number.isFinite(options.granularity)
      ? options.granularity
      : DEFAULT_GRANULARITY,
  };

  const regionSqlResult = await loadRegionSql();
  const regionRows = parseRegionSql(regionSqlResult.sql);
  const lookup = buildRegionLookup(regionRows);

  const connection = await createConnection();
  try {
    const targetRows = await loadTargetRows(connection, args.granularity, args.limit);

    const matchedRows = [];
    const unmatchedRows = [];
    let exactCount = 0;
    let fuzzyCount = 0;

    for (const row of targetRows) {
      const match = matchStationRow(row, lookup);
      if (!match.candidate) {
        unmatchedRows.push({
          stationCode: row.station_code,
          province: row.province,
          city: row.city,
          provinceNorm: match.provinceNorm,
          cityNorm: match.cityNorm,
        });
        continue;
      }

      if (match.matchType === "exact") {
        exactCount += 1;
      } else if (match.matchType === "manual") {
        fuzzyCount += 1;
      } else {
        fuzzyCount += 1;
      }

      const converted =
        match.matchType === "manual"
          ? {
              latitude: match.candidate.latitude,
              longitude: match.candidate.longitude,
            }
          : bd09ToWgs84(match.candidate.bdLongitude, match.candidate.bdLatitude);
      matchedRows.push({
        row,
        matchType: match.matchType,
        sourceName: match.candidate.name || match.candidate.sourceName,
        latitude: Number(converted.latitude.toFixed(8)),
        longitude: Number(converted.longitude.toFixed(8)),
      });
    }

    let updatedCount = 0;
    if (!args.dryRun) {
      for (const item of matchedRows) {
        await updateRowCoordinates(connection, item.row, item.longitude, item.latitude);
        updatedCount += 1;
      }
    }

    const [remainingRows] = await connection.query(
      `
        SELECT COUNT(*) AS count
        FROM station_info
        WHERE granularity = ?
          AND (latitude IS NULL OR longitude IS NULL)
      `,
      [args.granularity]
    );

    return {
      dryRun: args.dryRun,
      granularity: args.granularity,
      source: regionSqlResult.source,
      cacheFallbackError: regionSqlResult.fallbackError || null,
      scannedCount: targetRows.length,
      matchedCount: matchedRows.length,
      exactCount,
      fuzzyCount,
      unmatchedCount: unmatchedRows.length,
      updatedCount,
      remainingNullCoordinateCount: remainingRows[0].count,
      sampleUpdatedRows: matchedRows.slice(0, 20).map((item) => ({
        stationCode: item.row.station_code,
        province: item.row.province,
        city: item.row.city,
        matchType: item.matchType,
        sourceName: item.sourceName,
        latitude: item.latitude,
        longitude: item.longitude,
      })),
      sampleUnmatchedRows: unmatchedRows.slice(0, 50),
    };
  } finally {
    await connection.end();
  }
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  fillStationCoordinates(args)
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = {
  bd09ToWgs84,
  fillStationCoordinates,
  normalizeCity,
  normalizeProvince,
  parseRegionSql,
};
