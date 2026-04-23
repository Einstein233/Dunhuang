require("dotenv").config();
const mysql = require("mysql2/promise");
const crypto = require("crypto");

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

function shortHash(input) {
  return crypto.createHash("md5").update(input).digest("hex").slice(0, 6);
}

async function main() {
  const url = new URL(process.env.DATABASE_URL);
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });

  const summary = {
    source_tables: [],
    stations_created: 0,
    station_conflicts_resolved: 0,
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

  // Cache station mapping: `${region}|${stationCode}` -> station_id
  const stationMap = new Map();

  async function getStationIdByCode(stationCode) {
    const [rows] = await conn.query(
      "SELECT id, region_name FROM sys_station WHERE station_code = ? LIMIT 1",
      [stationCode]
    );
    return rows[0] || null;
  }

  async function ensureStation(regionName, rawStationCode) {
    const trimmed = String(rawStationCode || "").trim();
    const mapKey = `${regionName}|${trimmed}`;
    if (stationMap.has(mapKey)) return stationMap.get(mapKey);

    let stationCode = trimmed.slice(0, 50);
    if (!stationCode) return null;

    const existing = await getStationIdByCode(stationCode);
    if (existing && existing.region_name === regionName) {
      stationMap.set(mapKey, existing.id);
      return existing.id;
    }

    if (existing && existing.region_name !== regionName) {
      // Resolve code collision by suffixing a short hash.
      const base = stationCode.slice(0, 40);
      stationCode = `${base}_${shortHash(`${regionName}|${trimmed}`)}`.slice(0, 50);
      summary.station_conflicts_resolved += 1;
    }

    const [insertRes] = await conn.query(
      `
      INSERT INTO sys_station (station_code, region_name)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE region_name = VALUES(region_name)
    `,
      [stationCode, regionName]
    );

    let stationId = insertRes.insertId;
    if (!stationId) {
      const row = await getStationIdByCode(stationCode);
      stationId = row ? row.id : null;
    } else {
      summary.stations_created += 1;
    }

    if (stationId) {
      stationMap.set(mapKey, stationId);
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
      if (!stationCode || !recordTime) {
        summary.rows_skipped_invalid += 1;
        continue;
      }

      const stationId = await ensureStation(regionName, stationCode);
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

  const [stationCountRows] = await conn.query("SELECT COUNT(*) AS cnt FROM sys_station");
  const [factCountRows] = await conn.query("SELECT COUNT(*) AS cnt FROM weather_observation");

  const [regionTopRows] = await conn.query(`
    SELECT s.region_name, COUNT(*) AS cnt
    FROM weather_observation w
    JOIN sys_station s ON w.station_id = s.id
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

