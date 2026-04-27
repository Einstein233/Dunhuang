const express = require("express");
const http = require("http");
const https = require("https");

const pools = require("../utils/pools");

const router = express.Router();

const HOURLY_GRANULARITY = 2;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EQUIVALENCE_SERVICE_URL =
  process.env.EQUIVALENCE_SERVICE_URL || "http://127.0.0.1:8000/api/v1/equivalence/run";

const EXPERIMENT_TYPE_MAP = new Map([
  ["降雨-日照耦合实验", "rain_solar"],
  ["rain_solar", "rain_solar"],
  ["rain-solar", "rain_solar"],
  ["降雪-冻融耦合实验", "snow_freeze_thaw"],
  ["snow_freeze_thaw", "snow_freeze_thaw"],
  ["snow-freeze-thaw", "snow_freeze_thaw"],
]);

const EXPERIMENT_TYPE_LABEL = {
  rain_solar: "降雨-日照耦合实验",
  snow_freeze_thaw: "降雪-冻融耦合实验",
};

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeDate(value) {
  const text = normalizeString(value);
  return DATE_RE.test(text) ? text : "";
}

function normalizeTargetDays(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric;
}

function normalizeExperimentType(value) {
  const text = normalizeString(value);
  if (!text) return "rain_solar";
  return EXPERIMENT_TYPE_MAP.get(text) || "";
}

function toWeatherPayloadRow(row) {
  return {
    time: row.record_time,
    temperature_2m: row.avg_temperature,
    relativehumidity_2m: row.relativehumidity_2m,
    rain: row.rain_sum,
    snowfall: row.snow_sum,
    shortwave_radiation: row.shortwave_radiation_sum,
    windspeed_10m: row.max_continuous_wind_speed,
  };
}

async function getRegionDirectory() {
  const { result } = await pools({
    sql: `
      SELECT province, city, station_code, start_time, end_time, total_count
      FROM weather_directory
      WHERE granularity = ?
      ORDER BY province ASC, city ASC
    `,
    val: [HOURLY_GRANULARITY],
    run: true,
  });
  return result;
}

async function getRegionRecord({ city, stationCode }) {
  let sql = `
    SELECT province, city, station_code, start_time, end_time, total_count
    FROM weather_directory
    WHERE granularity = ?
  `;
  const val = [HOURLY_GRANULARITY];

  if (stationCode) {
    sql += " AND station_code = ?";
    val.push(stationCode);
  } else {
    sql += " AND city = ?";
    val.push(city);
  }

  sql += " ORDER BY end_time DESC LIMIT 1";

  const { result } = await pools({ sql, val, run: true });
  return result[0] || null;
}

async function getWeatherRows({ stationCode, startDate, endDate }) {
  const { result } = await pools({
    sql: `
      SELECT station_code, record_time, avg_temperature, relativehumidity_2m,
             rain_sum, snow_sum, max_continuous_wind_speed, shortwave_radiation_sum
      FROM weather_data
      WHERE station_code = ?
        AND granularity = ?
        AND record_time >= ?
        AND record_time <= ?
      ORDER BY record_time ASC
    `,
    val: [
      stationCode,
      HOURLY_GRANULARITY,
      `${startDate} 00:00:00`,
      `${endDate} 23:59:59`,
    ],
    run: true,
  });
  return result;
}

function postJson(urlText, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlText);
    const transport = url.protocol === "https:" ? https : http;
    const body = JSON.stringify(payload);

    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(data || "{}");
            if (res.statusCode >= 400) {
              reject(new Error(parsed.detail || parsed.msg || `service status ${res.statusCode}`));
              return;
            }
            resolve(parsed);
          } catch (error) {
            reject(new Error(`等效方案服务返回了无法解析的响应: ${data}`));
          }
        });
      }
    );

    req.on("error", (error) => reject(error));
    req.write(body);
    req.end();
  });
}

router.get("/regions", async (req, res) => {
  try {
    const regions = await getRegionDirectory();
    res.json({ code: 0, data: regions });
  } catch (error) {
    res.status(500).json({
      code: -1,
      msg: "获取可用地区失败",
      error: error.message,
    });
  }
});

router.post("/run", async (req, res) => {
  const stationCode = normalizeString(req.body.stationCode || req.body.station_code);
  const city = normalizeString(req.body.city || req.body.region || req.body.regionName);
  const startDate = normalizeDate(req.body.startDate || req.body.start || req.body.dataRange?.[0]);
  const endDate = normalizeDate(req.body.endDate || req.body.end || req.body.dataRange?.[1]);
  const experimentType = normalizeExperimentType(
    req.body.experimentType || req.body.experiment_type
  );
  const targetDays = normalizeTargetDays(
    req.body.targetDays ?? req.body.target_days ?? req.body.targetDuration
  );

  if (!stationCode && !city) {
    return res.status(400).json({
      code: -1,
      msg: "缺少地区参数，请提供 city 或 stationCode",
    });
  }

  if (!startDate || !endDate) {
    return res.status(400).json({
      code: -1,
      msg: "时间窗口格式不正确，需要 YYYY-MM-DD",
    });
  }

  if (!experimentType) {
    return res.status(400).json({
      code: -1,
      msg: "实验类型无效，可选：降雨-日照耦合实验 / 降雪-冻融耦合实验",
    });
  }

  if (targetDays === null) {
    return res.status(400).json({
      code: -1,
      msg: "目标实验室时长必须大于 0",
    });
  }

  try {
    const region = await getRegionRecord({ city, stationCode });
    if (!region) {
      return res.status(404).json({
        code: -1,
        msg: "未找到对应地区的小时级气候目录记录",
      });
    }

    const weatherRows = await getWeatherRows({
      stationCode: region.station_code,
      startDate,
      endDate,
    });

    if (!weatherRows.length) {
      return res.status(404).json({
        code: -1,
        msg: "当前地区在所选时间窗口内没有可用于计算的气候数据",
        data: {
          province: region.province,
          city: region.city,
          stationCode: region.station_code,
          startDate,
          endDate,
        },
      });
    }

    const engineResult = await postJson(EQUIVALENCE_SERVICE_URL, {
      experimentType,
      targetDays,
      returnHardwareSteps: true,
      weatherData: weatherRows.map(toWeatherPayloadRow),
    });

    res.json({
      code: 0,
      data: {
        query: {
          province: region.province,
          city: region.city,
          stationCode: region.station_code,
          startDate,
          endDate,
          rowCount: weatherRows.length,
          dataCoverageStart: region.start_time,
          dataCoverageEnd: region.end_time,
        },
        request: {
          experimentType: engineResult.experiment_type_label || EXPERIMENT_TYPE_LABEL[experimentType] || experimentType,
          targetDays,
        },
        plan: engineResult.result?.plan || null,
        hardwareSteps: engineResult.result?.hardware_steps || [],
      },
    });
  } catch (error) {
    console.error("[experiment/run] error:", error);
    const message = /ECONNREFUSED|fetch failed|connect/i.test(error.message)
      ? "等效方案服务不可用，请先启动 Docker 容器"
      : "等效方案计算失败";

    res.status(500).json({
      code: -1,
      msg: message,
      error: error.message,
    });
  }
});

module.exports = router;
