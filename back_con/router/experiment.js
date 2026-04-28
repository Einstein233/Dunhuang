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

function toUtcDate(dateText) {
  return new Date(`${dateText}T00:00:00Z`);
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function roundTo(value, precision = 6) {
  const factor = 10 ** precision;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function buildYearSegments(startDate, endDate) {
  const segments = [];
  const end = toUtcDate(endDate);
  let cursor = toUtcDate(startDate);

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    const segmentEnd = yearEnd < end ? yearEnd : end;

    segments.push({
      year,
      requestedStartDate: formatUtcDate(cursor),
      requestedEndDate: formatUtcDate(segmentEnd),
    });

    cursor = addUtcDays(segmentEnd, 1);
  }

  return segments;
}

function splitWeatherRowsByYear(weatherRows, requestedSegments) {
  const buckets = requestedSegments.map((segment) => ({
    ...segment,
    rows: [],
  }));
  const segmentMap = new Map(buckets.map((segment) => [String(segment.year), segment]));

  for (const row of weatherRows) {
    const yearKey = normalizeString(row.record_time).slice(0, 4);
    const targetSegment = segmentMap.get(yearKey);
    if (targetSegment) {
      targetSegment.rows.push(row);
    }
  }

  return buckets.map((segment) => ({
    ...segment,
    rowCount: segment.rows.length,
    actualStartDate: segment.rows[0]?.record_time?.slice(0, 10) || null,
    actualEndDate: segment.rows[segment.rows.length - 1]?.record_time?.slice(0, 10) || null,
  }));
}

function allocateTargetDaysByRowCount(segments, targetDays) {
  const totalRowCount = segments.reduce((sum, segment) => sum + segment.rowCount, 0);
  let allocated = 0;

  return segments.map((segment, index) => {
    let assignedTargetDays = targetDays;

    if (segments.length > 1) {
      if (index === segments.length - 1) {
        assignedTargetDays = roundTo(targetDays - allocated);
      } else {
        assignedTargetDays = roundTo((targetDays * segment.rowCount) / totalRowCount);
        allocated += assignedTargetDays;
      }
    }

    return {
      ...segment,
      assignedTargetDays,
    };
  });
}

function detectStepNumberKey(row) {
  if (!row || typeof row !== "object") {
    return "";
  }

  const preferredKeys = ["步骤编号", "step", "step_number", "stepNumber"];
  for (const key of preferredKeys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) {
      return key;
    }
  }

  return (
    Object.keys(row).find((key) => {
      return /step/i.test(key) || key.includes("编号");
    }) || ""
  );
}

function renumberHardwareSteps(hardwareSteps) {
  let nextStep = 1;

  return hardwareSteps.map((row) => {
    const clonedRow = { ...row };
    const stepKey = detectStepNumberKey(clonedRow);

    if (stepKey) {
      clonedRow[stepKey] = nextStep;
    }

    nextStep += 1;
    return clonedRow;
  });
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

async function runEquivalenceEngine({ experimentType, targetDays, weatherRows, segmentLabel }) {
  try {
    return await postJson(EQUIVALENCE_SERVICE_URL, {
      experimentType,
      targetDays,
      returnHardwareSteps: true,
      weatherData: weatherRows.map(toWeatherPayloadRow),
    });
  } catch (error) {
    throw new Error(`${segmentLabel} 等效计算失败: ${error.message}`);
  }
}

async function runSingleYearEquivalence({ experimentType, targetDays, weatherRows }) {
  return runEquivalenceEngine({
    experimentType,
    targetDays,
    weatherRows,
    segmentLabel: "当前时间窗口",
  });
}

async function runMultiYearEquivalence({ experimentType, targetDays, weatherRows, startDate, endDate }) {
  const requestedSegments = buildYearSegments(startDate, endDate);
  const segmentedRows = splitWeatherRowsByYear(weatherRows, requestedSegments);
  const validSegments = segmentedRows.filter((segment) => segment.rowCount > 0);
  const skippedSegments = segmentedRows
    .filter((segment) => segment.rowCount <= 0)
    .map((segment) => ({
      year: segment.year,
      requestedStartDate: segment.requestedStartDate,
      requestedEndDate: segment.requestedEndDate,
      rowCount: 0,
    }));

  if (!validSegments.length) {
    return {
      requestedSegments,
      segmentSummaries: [],
      skippedSegments,
      mergedPlan: null,
      mergedHardwareSteps: [],
    };
  }

  const allocatedSegments = allocateTargetDaysByRowCount(validSegments, targetDays);
  const segmentResults = [];

  for (const segment of allocatedSegments) {
    const engineResult = await runEquivalenceEngine({
      experimentType,
      targetDays: segment.assignedTargetDays,
      weatherRows: segment.rows,
      segmentLabel: `${segment.year} 年片段`,
    });

    segmentResults.push({
      year: segment.year,
      requestedStartDate: segment.requestedStartDate,
      requestedEndDate: segment.requestedEndDate,
      actualStartDate: segment.actualStartDate,
      actualEndDate: segment.actualEndDate,
      rowCount: segment.rowCount,
      targetDays: segment.assignedTargetDays,
      experimentType:
        engineResult.experiment_type_label || EXPERIMENT_TYPE_LABEL[experimentType] || experimentType,
      plan: engineResult.result?.plan || null,
      hardwareStepCount: engineResult.result?.hardware_steps?.length || 0,
      hardwareSteps: engineResult.result?.hardware_steps || [],
    });
  }

  const mergedHardwareSteps = renumberHardwareSteps(
    segmentResults.flatMap((segment) => segment.hardwareSteps)
  );

  return {
    requestedSegments,
    segmentSummaries: segmentResults.map((segment) => ({
      year: segment.year,
      requestedStartDate: segment.requestedStartDate,
      requestedEndDate: segment.requestedEndDate,
      actualStartDate: segment.actualStartDate,
      actualEndDate: segment.actualEndDate,
      rowCount: segment.rowCount,
      targetDays: segment.targetDays,
      experimentType: segment.experimentType,
      hardwareStepCount: segment.hardwareStepCount,
      plan: segment.plan,
    })),
    skippedSegments,
    mergedPlan: {
      mode: "segmented_by_calendar_year",
      distributionBasis: "row_count",
      targetDays,
      segmentCount: segmentResults.length,
      segments: segmentResults.map((segment) => ({
        year: segment.year,
        requestedStartDate: segment.requestedStartDate,
        requestedEndDate: segment.requestedEndDate,
        actualStartDate: segment.actualStartDate,
        actualEndDate: segment.actualEndDate,
        rowCount: segment.rowCount,
        targetDays: segment.targetDays,
        hardwareStepCount: segment.hardwareStepCount,
        plan: segment.plan,
      })),
      skippedSegments,
    },
    mergedHardwareSteps,
  };
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

  if (startDate > endDate) {
    return res.status(400).json({
      code: -1,
      msg: "开始日期不能晚于结束日期",
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

    const requestedSegments = buildYearSegments(startDate, endDate);
    const isMultiYearWindow = requestedSegments.length > 1;
    const computationResult = isMultiYearWindow
      ? await runMultiYearEquivalence({
          experimentType,
          targetDays,
          weatherRows,
          startDate,
          endDate,
        })
      : await runSingleYearEquivalence({
          experimentType,
          targetDays,
          weatherRows,
        });

    const experimentTypeLabel = isMultiYearWindow
      ? computationResult.segmentSummaries?.[0]?.experimentType ||
        EXPERIMENT_TYPE_LABEL[experimentType] ||
        experimentType
      : computationResult.experiment_type_label ||
        EXPERIMENT_TYPE_LABEL[experimentType] ||
        experimentType;

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
          segmentCount: requestedSegments.length,
          segmentedByYear: isMultiYearWindow,
        },
        request: {
          experimentType: experimentTypeLabel,
          targetDays,
          segmentedByYear: isMultiYearWindow,
          segmentationMode: isMultiYearWindow ? "calendar_year" : "single_window",
        },
        plan: isMultiYearWindow ? computationResult.mergedPlan : computationResult.result?.plan || null,
        hardwareSteps: isMultiYearWindow
          ? computationResult.mergedHardwareSteps
          : computationResult.result?.hardware_steps || [],
        segments: isMultiYearWindow ? computationResult.segmentSummaries : undefined,
        skippedSegments: isMultiYearWindow ? computationResult.skippedSegments : undefined,
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
