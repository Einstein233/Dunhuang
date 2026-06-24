/**
 * 独立刷新 weather_station_summary 缓存表
 * 不依赖 back_con，直连 MySQL
 *
 * 用法: node refresh_cache.js
 */
const mysql = require("mysql2/promise");

const DB = {
  host: "127.0.0.1",
  port: 3308,
  user: "root",
  password: "root",
  database: "dunhuang_agent",
};

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, precision = 1) {
  return Math.round((toNumber(value) + Number.EPSILON) * 10 ** precision) / 10 ** precision;
}

async function main() {
  const conn = await mysql.createConnection(DB);
  console.log("已连接数据库");

  const [stations] = await conn.query(
    "SELECT station_code, granularity, province, city, start_time, end_time FROM weather_directory WHERE granularity = 2"
  );
  console.log(`站点数: ${stations.length}`);

  let updated = 0;
  const t0 = Date.now();

  for (let i = 0; i < stations.length; i++) {
    const st = stations[i];

    // 子查询先算 LAG（冻融），外层 GROUP BY 年度
    const sql = `
      SELECT data_year, COUNT(*) AS cnt,
        ROUND(AVG(avg_temperature), 2) AS year_avg_temp,
        ROUND(MIN(avg_temperature), 2) AS year_min_temp,
        ROUND(MAX(avg_temperature), 2) AS year_max_temp,
        SUM(rain_sum) AS year_rain, SUM(snow_sum) AS year_snow,
        ROUND(AVG(relativehumidity_2m), 1) AS year_avg_humid,
        MAX(max_continuous_wind_speed) AS year_max_wind,
        SUM(shortwave_radiation_sum) AS year_rad,
        SUM(freeze_change) AS year_freeze_thaw
      FROM (
        SELECT YEAR(record_time) AS data_year, avg_temperature, rain_sum,
          snow_sum, relativehumidity_2m, max_continuous_wind_speed,
          shortwave_radiation_sum,
          CASE WHEN avg_temperature < 0 AND LAG(avg_temperature) OVER (PARTITION BY station_code ORDER BY record_time) >= 0 THEN 1
               WHEN avg_temperature >= 0 AND LAG(avg_temperature) OVER (PARTITION BY station_code ORDER BY record_time) < 0 THEN 1 ELSE 0 END AS freeze_change
        FROM weather_data WHERE station_code = ? AND granularity = ?
      ) sub GROUP BY data_year ORDER BY data_year`;

    const [annualRows] = await conn.query(sql, [st.station_code, st.granularity]);
    if (!annualRows.length) continue;

    let totalRecords = 0, avgTempSum = 0, minTemp = Infinity, maxTemp = -Infinity;
    let rainSum = 0, snowSum = 0, avgHumidSum = 0, maxWind = -Infinity;
    let radSum = 0, freezeThawSum = 0, latestYear = 0;
    const years = annualRows.length;

    for (const r of annualRows) {
      totalRecords += toNumber(r.cnt);
      avgTempSum += toNumber(r.year_avg_temp);
      minTemp = Math.min(minTemp, toNumber(r.year_min_temp));
      maxTemp = Math.max(maxTemp, toNumber(r.year_max_temp));
      rainSum += toNumber(r.year_rain);
      snowSum += toNumber(r.year_snow);
      avgHumidSum += toNumber(r.year_avg_humid);
      maxWind = Math.max(maxWind, toNumber(r.year_max_wind));
      radSum += toNumber(r.year_rad);
      freezeThawSum += toNumber(r.year_freeze_thaw);
      latestYear = Math.max(latestYear, r.data_year);
    }

    let coverageYears = (new Date(st.end_time) - new Date(st.start_time)) / (365.25 * 86400000);
    if (coverageYears < 0.01) coverageYears = years;

    await conn.query(
      `INSERT INTO weather_station_summary
        (station_code, granularity, province, city, start_time, end_time,
         record_count, coverage_years, avg_temperature, min_temperature, max_temperature,
         temperature_range, annual_rain, annual_snow, annual_avg_humidity,
         annual_max_wind_speed, annual_radiation, annual_freeze_thaw, data_year)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         province=VALUES(province), city=VALUES(city),
         start_time=VALUES(start_time), end_time=VALUES(end_time),
         record_count=VALUES(record_count), coverage_years=VALUES(coverage_years),
         avg_temperature=VALUES(avg_temperature), min_temperature=VALUES(min_temperature),
         max_temperature=VALUES(max_temperature), temperature_range=VALUES(temperature_range),
         annual_rain=VALUES(annual_rain), annual_snow=VALUES(annual_snow),
         annual_avg_humidity=VALUES(annual_avg_humidity), annual_max_wind_speed=VALUES(annual_max_wind_speed),
         annual_radiation=VALUES(annual_radiation), annual_freeze_thaw=VALUES(annual_freeze_thaw),
         data_year=VALUES(data_year)`,
      [
        st.station_code, st.granularity, st.province, st.city,
        st.start_time, st.end_time, totalRecords, round(coverageYears, 2),
        round(avgTempSum / years), minTemp, maxTemp, round(maxTemp - minTemp),
        round(rainSum / Math.max(coverageYears, 1)),
        round(snowSum / Math.max(coverageYears, 1)),
        round(avgHumidSum / years),
        round(maxWind),
        round((radSum / Math.max(coverageYears, 1)) / 1000),
        round(freezeThawSum / Math.max(coverageYears, 1)),
        latestYear,
      ]
    );

    updated++;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const pct = ((updated / stations.length) * 100).toFixed(1);
    console.log(`[${elapsed}s] ${updated}/${stations.length} (${pct}%)  ${st.province}/${st.city}  ${totalRecords}条`);
  }

  const [countResult] = await conn.query("SELECT COUNT(*) AS cnt FROM weather_station_summary");
  const totalElapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== 完成 === ${totalElapsed}s | 缓存表行数: ${countResult[0].cnt} | 站点: ${updated}`);

  await conn.end();
}

main().catch((err) => {
  console.error("失败:", err.message);
  process.exit(1);
});
