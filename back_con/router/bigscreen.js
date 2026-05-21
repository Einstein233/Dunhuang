const express = require("express");
const pools = require("../utils/pools");
const utils = require("../utils/index.js");

const router = express.Router();

const METRIC_DEFINITIONS = [
  { key: "annualAvgTemperature", label: "年均气温", unit: "℃", order: "desc" },
  { key: "annualRain", label: "年均降雨", unit: "mm/年", order: "desc" },
  { key: "annualSnow", label: "年均降雪", unit: "mm/年", order: "desc" },
  { key: "annualAvgHumidity", label: "年均湿度", unit: "%", order: "desc" },
  { key: "annualMaxWindSpeed", label: "年均最大风速", unit: "m/s", order: "desc" },
  { key: "annualRadiation", label: "年均辐照", unit: "kMJ/年", order: "desc" },
];

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function round(value, precision = 1) {
  const numeric = toNumber(value);
  const factor = 10 ** precision;
  return Math.round((numeric + Number.EPSILON) * factor) / factor;
}

function getCoverageYears(startTime, endTime) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    return 1;
  }

  const millisecondsPerYear = 365.25 * 24 * 60 * 60 * 1000;
  return Math.max((end.getTime() - start.getTime()) / millisecondsPerYear, 1 / 12);
}

function buildRankings(cities) {
  return METRIC_DEFINITIONS.reduce((rankings, metric) => {
    rankings[metric.key] = [...cities]
      .sort((left, right) => {
        const leftValue = toNumber(left[metric.key]);
        const rightValue = toNumber(right[metric.key]);
        return metric.order === "asc" ? leftValue - rightValue : rightValue - leftValue;
      })
      .map((city, index) => ({
        rank: index + 1,
        province: city.province,
        city: city.city,
        stationCode: city.stationCode,
        value: city[metric.key],
        unit: metric.unit,
      }));

    return rankings;
  }, {});
}

router.get("/weatherDashboard", async (req, res) => {
  try {
    const { result } = await pools({
      sql: `
        SELECT
          wd.province,
          wd.city,
          wd.station_code AS stationCode,
          wd.start_time AS startTime,
          wd.end_time AS endTime,
          wd.total_count AS recordCount,
          ROUND(AVG(w.avg_temperature), 1) AS avgTemperature,
          ROUND(MAX(w.avg_temperature), 1) AS maxTemperature,
          ROUND(MIN(w.avg_temperature), 1) AS minTemperature,
          ROUND(SUM(COALESCE(w.rain_sum, 0)), 1) AS totalRain,
          ROUND(SUM(COALESCE(w.snow_sum, 0)), 1) AS totalSnow,
          ROUND(AVG(w.relativehumidity_2m), 1) AS avgHumidity,
          ROUND(MAX(w.max_continuous_wind_speed), 1) AS maxWindSpeed,
          ROUND(AVG(w.max_continuous_wind_speed), 1) AS avgWindSpeed,
          ROUND(MAX(wind_stats.annual_max_wind_speed), 1) AS annualMaxWindSpeed,
          ROUND(SUM(COALESCE(w.shortwave_radiation_sum, 0)), 1) AS totalRadiation,
          SUM(
            CASE
              WHEN w.avg_temperature < 0
                AND prev.previous_temperature IS NOT NULL
                AND prev.previous_temperature >= 0
              THEN 1
              WHEN w.avg_temperature >= 0
                AND prev.previous_temperature IS NOT NULL
                AND prev.previous_temperature < 0
              THEN 1
              ELSE 0
            END
          ) AS freezeThawCount
        FROM weather_directory wd
        JOIN weather_data w
          ON w.station_code = wd.station_code
          AND w.granularity = wd.granularity
        LEFT JOIN (
          SELECT
            station_code,
            granularity,
            record_time,
            LAG(avg_temperature) OVER (
              PARTITION BY station_code, granularity
              ORDER BY record_time
            ) AS previous_temperature
          FROM weather_data
          WHERE granularity = 2
        ) prev
          ON prev.station_code = w.station_code
          AND prev.granularity = w.granularity
          AND prev.record_time = w.record_time
        LEFT JOIN (
          SELECT
            station_code,
            granularity,
            AVG(year_max_wind_speed) AS annual_max_wind_speed
          FROM (
            SELECT
              station_code,
              granularity,
              YEAR(record_time) AS record_year,
              MAX(max_continuous_wind_speed) AS year_max_wind_speed
            FROM weather_data
            WHERE granularity = 2
            GROUP BY station_code, granularity, YEAR(record_time)
          ) yearly_wind
          GROUP BY station_code, granularity
        ) wind_stats
          ON wind_stats.station_code = wd.station_code
          AND wind_stats.granularity = wd.granularity
        WHERE wd.granularity = 2
        GROUP BY
          wd.province,
          wd.city,
          wd.station_code,
          wd.start_time,
          wd.end_time,
          wd.total_count
        ORDER BY wd.province ASC, wd.city ASC
      `,
      run: true,
    });

    const cities = result.map((row) => {
      const coverageYears = getCoverageYears(row.startTime, row.endTime);
      const totalRain = toNumber(row.totalRain);
      const totalSnow = toNumber(row.totalSnow);
      const totalRadiation = toNumber(row.totalRadiation);
      const freezeThawCount = toNumber(row.freezeThawCount);

      return {
        province: row.province,
        city: row.city,
        stationCode: row.stationCode,
        startTime: row.startTime,
        endTime: row.endTime,
        coverageYears: round(coverageYears, 2),
        recordCount: toNumber(row.recordCount),
        annualAvgTemperature: round(row.avgTemperature),
        maxTemperature: round(row.maxTemperature),
        minTemperature: round(row.minTemperature),
        temperatureRange: round(toNumber(row.maxTemperature) - toNumber(row.minTemperature)),
        annualRain: round(totalRain / coverageYears),
        annualSnow: round(totalSnow / coverageYears),
        annualAvgHumidity: round(row.avgHumidity),
        maxWindSpeed: round(row.maxWindSpeed),
        avgWindSpeed: round(row.avgWindSpeed),
        annualMaxWindSpeed: round(row.annualMaxWindSpeed),
        annualRadiation: round(totalRadiation / coverageYears / 1000),
        annualFreezeThawCount: round(freezeThawCount / coverageYears),
      };
    });

    res.send(
      utils.returnData({
        data: {
          generatedAt: new Date().toISOString(),
          metrics: METRIC_DEFINITIONS,
          cities,
          rankings: buildRankings(cities),
        },
      })
    );
  } catch (error) {
    res.send(
      utils.returnData({
        code: -1,
        msg: "获取气候数据看板失败",
        err: error,
        req,
      })
    );
  }
});

module.exports = router;
