const express = require("express");
const pools = require("../utils/pools");
const utils = require("../utils/index.js");

const router = express.Router();

// ============================================================================
// 指标定义（前端展示用）
// ============================================================================
const METRIC_DEFINITIONS = [
  { key: "annualAvgTemperature", label: "年均气温", unit: "℃", order: "desc", dataKey: "annualAvgTemperature" },
  { key: "annualRain", label: "年均降雨", unit: "mm/年", order: "desc", dataKey: "annualRain" },
  { key: "annualSnow", label: "年均降雪", unit: "mm/年", order: "desc", dataKey: "annualSnow" },
  { key: "annualAvgHumidity", label: "年均湿度", unit: "%", order: "desc", dataKey: "annualAvgHumidity" },
  { key: "annualMaxWindSpeed", label: "年均最大风速", unit: "m/s", order: "desc", dataKey: "annualMaxWindSpeed" },
  { key: "annualRadiation", label: "年均辐照", unit: "kMJ/年", order: "desc", dataKey: "annualRadiation" },
];

function toNumber(value, fallback) {
  var fb = arguments.length > 1 ? fallback : 0;
  var n = Number(value);
  return Number.isFinite(n) ? n : fb;
}

function round(value, precision) {
  var prec = arguments.length > 1 ? precision : 1;
  return Math.round((toNumber(value) + Number.EPSILON) * Math.pow(10, prec)) / Math.pow(10, prec);
}

// ============================================================================
// POST /bigscreen/refreshCache
// 为每个站点计算年度汇总，存入 weather_station_summary
// ============================================================================
router.post("/refreshCache", async function (req, res) {
  try {
    // 1) 获取所有站点清单
    var stationsResult = await pools({
      sql: "SELECT station_code, granularity, province, city, start_time, end_time, total_count FROM weather_directory WHERE granularity = 2",
      run: true,
    });
    var stations = stationsResult.result;

    if (!stations.length) {
      return res.send(utils.returnData({ code: -1, msg: "weather_directory 中没有站点数据" }));
    }

    var updated = 0;
    var totalStations = stations.length;

    // 2) 逐站点计算
    for (var i = 0; i < stations.length; i++) {
      var st = stations[i];

      // 子查询处理 LAG 窗口函数（先放在子查询里，外层 GROUP BY）
      var annualResult = await pools({
        sql:
          "SELECT data_year, COUNT(*) AS cnt, " +
          "ROUND(AVG(avg_temperature), 2) AS year_avg_temp, " +
          "ROUND(MIN(avg_temperature), 2) AS year_min_temp, " +
          "ROUND(MAX(avg_temperature), 2) AS year_max_temp, " +
          "SUM(rain_sum) AS year_rain, SUM(snow_sum) AS year_snow, " +
          "ROUND(AVG(relativehumidity_2m), 1) AS year_avg_humid, " +
          "MAX(max_continuous_wind_speed) AS year_max_wind, " +
          "SUM(shortwave_radiation_sum) AS year_rad, " +
          "SUM(freeze_change) AS year_freeze_thaw " +
          "FROM ( " +
          "SELECT YEAR(record_time) AS data_year, avg_temperature, rain_sum, " +
          "snow_sum, relativehumidity_2m, max_continuous_wind_speed, " +
          "shortwave_radiation_sum, " +
          "CASE WHEN avg_temperature < 0 AND LAG(avg_temperature) OVER (PARTITION BY station_code ORDER BY record_time) >= 0 THEN 1 " +
          "WHEN avg_temperature >= 0 AND LAG(avg_temperature) OVER (PARTITION BY station_code ORDER BY record_time) < 0 THEN 1 ELSE 0 END AS freeze_change " +
          "FROM weather_data WHERE station_code = ? AND granularity = ? " +
          ") sub GROUP BY data_year ORDER BY data_year",
        val: [st.station_code, st.granularity],
        run: true,
      });
      var annualRows = annualResult.result;

      if (!annualRows.length) continue;

      // 3) 跨年汇总
      var years = annualRows.length;
      var totalRecords = 0;
      var avgTempSum = 0;
      var minTemp = Infinity;
      var maxTemp = -Infinity;
      var rainSum = 0;
      var snowSum = 0;
      var avgHumidSum = 0;
      var maxWind = -Infinity;
      var radSum = 0;
      var freezeThawSum = 0;
      var latestYear = 0;

      for (var j = 0; j < annualRows.length; j++) {
        var r = annualRows[j];
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

      var coverageYears = (new Date(st.end_time) - new Date(st.start_time)) / (365.25 * 86400000);
      if (coverageYears < 0.01) coverageYears = years;

      // 4) UPSERT
      await pools({
        sql:
          "INSERT INTO weather_station_summary " +
          "(station_code, granularity, province, city, start_time, end_time, " +
          "record_count, coverage_years, avg_temperature, min_temperature, max_temperature, " +
          "temperature_range, annual_rain, annual_snow, annual_avg_humidity, " +
          "annual_max_wind_speed, annual_radiation, annual_freeze_thaw, data_year) " +
          "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) " +
          "ON DUPLICATE KEY UPDATE " +
          "province=VALUES(province), city=VALUES(city), " +
          "start_time=VALUES(start_time), end_time=VALUES(end_time), " +
          "record_count=VALUES(record_count), coverage_years=VALUES(coverage_years), " +
          "avg_temperature=VALUES(avg_temperature), min_temperature=VALUES(min_temperature), " +
          "max_temperature=VALUES(max_temperature), temperature_range=VALUES(temperature_range), " +
          "annual_rain=VALUES(annual_rain), annual_snow=VALUES(annual_snow), " +
          "annual_avg_humidity=VALUES(annual_avg_humidity), annual_max_wind_speed=VALUES(annual_max_wind_speed), " +
          "annual_radiation=VALUES(annual_radiation), annual_freeze_thaw=VALUES(annual_freeze_thaw), " +
          "data_year=VALUES(data_year)",
        val: [
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
        ],
        run: true,
      });

      updated++;
    }

    var countResult = await pools({
      sql: "SELECT COUNT(*) AS cnt FROM weather_station_summary",
      run: true,
    });

    res.send(utils.returnData({
      data: {
        message: "缓存刷新完成",
        stationsTotal: totalStations,
        stationsUpdated: updated,
        cacheCount: countResult.result[0].cnt,
      },
    }));
  } catch (error) {
    res.send(utils.returnData({ code: -1, msg: "刷新缓存失败", err: error, req: req }));
  }
});

// ============================================================================
// GET /bigscreen/weatherDashboard
// 从缓存表读取，毫秒级响应
// ============================================================================
router.get("/weatherDashboard", async function (req, res) {
  try {
    var result = await pools({
      sql:
        "SELECT station_code AS stationCode, province, city, " +
        "start_time AS startTime, end_time AS endTime, " +
        "record_count AS recordCount, coverage_years AS coverageYears, " +
        "avg_temperature AS avgTemperature, " +
        "min_temperature AS minTemperature, " +
        "max_temperature AS maxTemperature, " +
        "temperature_range AS temperatureRange, " +
        "annual_rain AS annualRain, " +
        "annual_snow AS annualSnow, " +
        "annual_avg_humidity AS annualAvgHumidity, " +
        "annual_max_wind_speed AS annualMaxWindSpeed, " +
        "annual_radiation AS annualRadiation " +
        "FROM weather_station_summary WHERE granularity = 2 " +
        "ORDER BY province ASC, city ASC",
      run: true,
    });
    var rows = result.result;

    if (!rows.length) {
      return res.send(utils.returnData({
        code: -1,
        msg: "缓存表为空，请先调用 POST /bigscreen/refreshCache 刷新缓存",
        data: { metrics: METRIC_DEFINITIONS, cities: [], rankings: {} },
      }));
    }

    // 构建前端格式
    var cities = rows.map(function (row) {
      return {
        province: row.province,
        city: row.city,
        stationCode: row.stationCode,
        startTime: row.startTime,
        endTime: row.endTime,
        coverageYears: row.coverageYears,
        recordCount: row.recordCount,
        annualAvgTemperature: row.avgTemperature,
        temperatureRange: row.temperatureRange,
        annualRain: row.annualRain,
        annualSnow: row.annualSnow,
        annualAvgHumidity: row.annualAvgHumidity,
        annualMaxWindSpeed: row.annualMaxWindSpeed,
        annualRadiation: row.annualRadiation,
      };
    });

    // 排行榜：用 dataKey 从 cities 中取值排序
    var rankings = {};
    for (var m = 0; m < METRIC_DEFINITIONS.length; m++) {
      var metric = METRIC_DEFINITIONS[m];
      var dataKey = metric.dataKey || metric.key;
      var sorted = cities.slice().sort(function (a, b) {
        var av = toNumber(a[dataKey]);
        var bv = toNumber(b[dataKey]);
        return metric.order === "asc" ? av - bv : bv - av;
      });
      rankings[dataKey] = sorted.slice(0, 10).map(function (city, idx) {
        return {
          rank: idx + 1,
          province: city.province,
          city: city.city,
          stationCode: city.stationCode,
          value: city[dataKey],
          unit: metric.unit,
        };
      });
    }

    res.send(utils.returnData({
      data: {
        generatedAt: new Date().toISOString(),
        metrics: METRIC_DEFINITIONS,
        cities: cities,
        rankings: rankings,
      },
    }));
  } catch (error) {
    res.send(utils.returnData({ code: -1, msg: "获取气候数据看板失败", err: error, req: req }));
  }
});

module.exports = router;
