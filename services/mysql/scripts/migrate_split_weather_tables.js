const path = require("path");
require("dotenv").config({
  path: path.resolve(__dirname, "..", "..", "sql-agent", ".env"),
});
const mysql = require("mysql2/promise");
function safeTableName(name) {
  return String(name).replace(/`/g, "``");
}

function parseNullableNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateToHour(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  const datePart = s.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return null;
  return `${datePart} 00:00:00`;
}

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  const conn = await mysql.createConnection({
    host: url.hostname === "localhost" ? "127.0.0.1" : url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });

  const summary = {
    source_tables: [],
    stations_created: 0,
    rows_scanned: 0,
    rows_inserted_or_updated: 0,
    rows_skipped_invalid: 0,
  };

  const [tables] = await conn.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
    ORDER BY table_name
  `);

  const candidateTables = [];
  for (const t of tables) {
    const table = t.TABLE_NAME;
    const [cols] = await conn.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position
    `,
      [table]
    );
    const names = cols.map((c) => c.COLUMN_NAME);
    const required = [
      "year_month_day",
      "station_code",
      "avg_temperature",
      "precipitation",
      "max_continuous_wind_speed",
      "shortwave_radiation_sum",
    ];
    if (required.every((x) => names.includes(x))) {
      candidateTables.push(table);
    }
  }

  summary.source_tables = candidateTables;

  // One region corresponds to exactly one station in the current schema.
  const stationMap = new Map();

  async function getStationByRegion(regionName) {
    const [rows] = await conn.query(
      "SELECT id, station_code, region_name FROM station WHERE region_name = ? LIMIT 1",
      [regionName]
    );
    return rows[0] || null;
  }

  async function ensureStation(regionName) {
    if (stationMap.has(regionName)) return stationMap.get(regionName);

    const existing = await getStationByRegion(regionName);
    if (existing) {
      stationMap.set(regionName, existing.id);
      return existing.id;
    }

    const stationCode = `STN_${String(regionName).toUpperCase()}`.slice(0, 50);

    const [insertRes] = await conn.query(
      `
      INSERT INTO station (station_code, region_name)
      VALUES (?, ?)
    `,
      [stationCode, regionName]
    );

    let stationId = insertRes.insertId;
    if (!stationId) {
      const row = await getStationByRegion(regionName);
      stationId = row ? row.id : null;
    } else {
      summary.stations_created += 1;
    }

    if (stationId) {
      stationMap.set(regionName, stationId);
    }
    return stationId;
  }

  async function flushBatch(values) {
    if (!values.length) return;
    const placeholders = values.map(() => "(?,?,?,?,?,?,?)").join(",");
    const flat = values.flat();
    const sql = `
      INSERT INTO weather_observation
      (station_id, record_time, temperature_2m, relativehumidity_2m, rain, windspeed_10m, shortwave_radiation)
      VALUES ${placeholders}
      ON DUPLICATE KEY UPDATE
        temperature_2m = VALUES(temperature_2m),
        relativehumidity_2m = VALUES(relativehumidity_2m),
        rain = VALUES(rain),
        windspeed_10m = VALUES(windspeed_10m),
        shortwave_radiation = VALUES(shortwave_radiation)
    `;
    const [res] = await conn.query(sql, flat);
    summary.rows_inserted_or_updated += res.affectedRows;
  }

  for (const table of candidateTables) {
    const safe = safeTableName(table);
    const regionName = table;

    const [rows] = await conn.query(`
      SELECT
        year_month_day,
        station_code,
        avg_temperature,
        precipitation,
        max_continuous_wind_speed,
        shortwave_radiation_sum
      FROM \`${safe}\`
    `);

    const batch = [];
    for (const row of rows) {
      summary.rows_scanned += 1;
      const stationCode = String(row.station_code || "").trim();
      const recordTime = normalizeDateToHour(row.year_month_day);
      if (!recordTime) {
        summary.rows_skipped_invalid += 1;
        continue;
      }

      const stationId = await ensureStation(regionName);
      if (!stationId) {
        summary.rows_skipped_invalid += 1;
        continue;
      }

      const temperature2m = parseNullableNumber(row.avg_temperature);
      const rain = parseNullableNumber(row.precipitation);
      const windspeed10m = parseNullableNumber(row.max_continuous_wind_speed);
      const shortwaveRadiation = parseNullableNumber(row.shortwave_radiation_sum);

      batch.push([
        stationId,
        recordTime,
        temperature2m,
        null, // relativehumidity_2m in old split tables is unavailable
        rain,
        windspeed10m,
        shortwaveRadiation,
      ]);

      if (batch.length >= 1000) {
        await flushBatch(batch);
        batch.length = 0;
      }
    }

    if (batch.length > 0) {
      await flushBatch(batch);
      batch.length = 0;
    }
  }

  const [stationCountRows] = await conn.query("SELECT COUNT(*) AS cnt FROM station");
  const [factCountRows] = await conn.query("SELECT COUNT(*) AS cnt FROM weather_observation");

  const [regionTopRows] = await conn.query(`
    SELECT s.region_name, COUNT(*) AS cnt
    FROM weather_observation w
    JOIN station s ON w.station_id = s.id
    GROUP BY s.region_name
    ORDER BY cnt DESC
    LIMIT 10
  `);

  console.log(
    JSON.stringify(
      {
        summary,
        station_total: stationCountRows[0].cnt,
        fact_total: factCountRows[0].cnt,
        top_regions: regionTopRows,
      },
      null,
      2
    )
  );

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
