const express = require('express');
const router = express.Router();
const utils = require("../utils/index.js");
const pools = require("../utils/pools.js");
const xlsx = require('node-xlsx');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const csv = require('csv-parser');
const iconvlite = require('iconv-lite');

// ── Open-Meteo 列名 → weather_data 字段名映射 ─────────────────
// 只映射 weather_data 中实际存在的字段，其余列自动忽略
const OPENMETEO_FIELD_MAP = {
  'time':                        'record_time',
  'temperature_2m (°c)':         'avg_temperature',
  'precipitation (mm)':          'precipitation',
  'rain (mm)':                   'rain_sum',
  'snowfall (cm)':               'snow_sum',          // cm → mm (×10)
  'windspeed_10m (m/s)':         'max_continuous_wind_speed',
  'winddirection_10m (°)':       'winddirection_dominant',
  'windgusts_10m (m/s)':         'windgusts_max',
  'shortwave_radiation (w/m²)':  'shortwave_radiation_sum',
  // latitude, longitude, elevation, utc_offset_seconds,
  // timezone, timezone_abbreviation は全て無視（weather_dataに存在しない）
};

// 需要单位转换的字段
const UNIT_CONVERT = {
  snow_sum: v => v !== null && v !== '' ? String(Math.round(parseFloat(v) * 10 * 100) / 100) : null,
  record_time: v => v ? v.replace('T', ' ') + ':00' : null,  // 2025-01-01T00:00 → 2025-01-01 00:00:00
};

// ── 通用 CSV 解析：指定表头行号，返回表头+数据行 ─────────────
// headerRowIndex: 1-based，对应文件原始行号（含空行）
// Open-Meteo 格式：表头在原始第4行
// 若 headerRowIndex=-1，自动检测（找含最多气象关键词的行）
function parseCSVWithHeaderRow(filePath, headerRowIndex = 1) {
  return new Promise((resolve, reject) => {
    let text;
    try {
      const buf = fs.readFileSync(filePath);
      text = iconvlite.decode(buf, 'utf-8');
    } catch {
      const buf = fs.readFileSync(filePath);
      text = iconvlite.decode(buf, 'gbk');
    }
    text = text.replace(/^\uFEFF/, ''); // 去 BOM

    // 保留所有原始行（含空行），保证行号与文件一致
    const allLines = text.split(/\r?\n/);

    // 解析 CSV 行（处理带引号的情况）
    function parseLine(line) {
      const result = [];
      let cur = '', inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') { inQuote = !inQuote; }
        else if (c === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      result.push(cur.trim());
      return result;
    }

    // 自动检测：找包含最多气象关键词的非空行
    function autoDetectHeaderRow() {
      const keywords = ['time','date','temp','precip','rain','snow','wind','radiation'];
      let bestIdx = 0, bestScore = -1;
      for (let i = 0; i < Math.min(allLines.length, 15); i++) {
        if (!allLines[i].trim()) continue;
        const lower = allLines[i].toLowerCase();
        const score = keywords.filter(k => lower.includes(k)).length;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      return bestIdx; // 0-based
    }

    // 确定表头行（0-based index into allLines）
    let hi;
    if (headerRowIndex === -1) {
      hi = autoDetectHeaderRow();
    } else {
      hi = headerRowIndex - 1; // 转为 0-based，直接对应原始行号
    }

    if (hi < 0 || hi >= allLines.length || !allLines[hi].trim()) {
      return reject(new Error(`表头行 ${headerRowIndex} 无效或为空行`));
    }

    console.log(`[parseCSV] 使用第 ${hi + 1} 行作为表头: ${allLines[hi].substring(0, 60)}`);

    const dataHeaders = parseLine(allLines[hi]).map(h => h.toLowerCase());

    // 提取元数据（表头行之前的前两行）
    const meta = {};
    if (hi >= 2) {
      const metaHeaders = parseLine(allLines[0]).map(h => h.toLowerCase());
      const metaValues  = parseLine(allLines[1]);
      metaHeaders.forEach((h, i) => { meta[h] = metaValues[i] || ''; });
    }

    // 数据行（表头行之后，跳过空行）
    const dataRows = [];
    for (let i = hi + 1; i < allLines.length; i++) {
      if (!allLines[i].trim()) continue;
      const vals = parseLine(allLines[i]);
      if (vals.length < dataHeaders.length) continue;
      const row = {};
      dataHeaders.forEach((h, j) => { row[h] = vals[j]; });
      dataRows.push(row);
    }

    resolve({ meta, dataHeaders, dataRows });
  });
}

// parseRegularCSV 已由 parseCSVWithHeaderRow 替代

// ── 解析 Excel：按列位置读取，不依赖列名匹配 ─────────────────
// colCount: 需要读取的列数
// headerRowIndex: 表头行（1-based），默认1
function parseExcel(filePath, colCount, headerRowIndex = 1) {
  return new Promise((resolve, reject) => {
    try {
      const sheets = xlsx.parse(filePath, { cellDates: true });
      if (!sheets.length) return resolve([]);
      const allData = sheets[0].data || [];
      if (!allData.length) return resolve([]);

      const hi = headerRowIndex - 1; // 0-based
      const dataRows = allData.slice(hi + 1);

      const rows = dataRows.map(row =>
        Array.from({ length: colCount }, (_, i) => {
          const v = row[i];
          if (v === undefined || v === null || v === '') return null;
          // Excel Date 对象 → 'YYYY-MM-DD HH:mm:ss'（保留小时）
          if (v instanceof Date) {
            const pad = n => String(n).padStart(2, '0');
            return v.getFullYear() + '-' + pad(v.getMonth()+1) + '-' + pad(v.getDate()) +
                   ' ' + pad(v.getHours()) + ':' + pad(v.getMinutes()) + ':' + pad(v.getSeconds());
          }
          return v;
        })
      );
      resolve(rows);
    } catch (e) { reject(e); }
  });
}

// ── 根据相邻两行时间间隔自动判断 granularity ──────────────────
// 1 = 15分钟，2 = 小时，3 = 天
function detectGranularity(rows, timeColIndex) {
  try {
    if (rows.length < 2) return 2; // 默认小时
    const t0 = new Date(rows[0][timeColIndex]);
    const t1 = new Date(rows[1][timeColIndex]);
    if (isNaN(t0) || isNaN(t1)) return 2;
    const diffMin = Math.abs(t1 - t0) / 60000; // 差值（分钟）
    if (diffMin <= 20)   return 1;  // ≤20分钟 → 15分钟级
    if (diffMin <= 90)   return 2;  // ≤90分钟 → 小时级
    return 3;                        // 否则 → 天级
  } catch { return 2; }
}

// ── 批量插入 weather_data ─────────────────────────────────────
async function batchInsertWeatherData(fields, rows, res, req) {
  const colList = fields.map(f => `\`${f}\``).join(',');
  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const valStr = batch
      .map(row => `(${row.map(v => v !== null && v !== undefined && v !== '' ? `'${String(v).replace(/'/g, "''")}'` : 'NULL').join(',')})`)
      .join(',');
    const sql = `INSERT IGNORE INTO \`weather_data\` (${colList}) VALUES ${valStr}`;
    await pools({ sql, run: true });
    inserted += batch.length;
  }
  return inserted;
}

// ══ addFile ═══════════════════════════════════════════════════
router.post("/addFile", async (req, res) => {
  const sql = "INSERT INTO files(val,type) VALUES (?,?)";
  const obj = req.body;
  await pools({ sql, val: [obj.val, obj.type], run: false, res, req });
});

// ══ addFiledata ═══════════════════════════════════════════════
router.post("/addFiledata", async (req, res) => {
  const obj = req.body;
  if (obj.type != 2) return res.send({ code: -1, msg: '不支持的类型' });

  try {
    const valObj    = JSON.parse(obj.val);
    const filename  = valObj[0].filename;
    const inputValues  = valObj[0].inputValues  || [];
    const unitValues   = valObj[0].unitValues   || [];
    const stationProvince = (valObj[0].stationProvince || '').trim();
    const stationCity     = (valObj[0].stationCity     || '').trim();

    const filePath = path.join(__dirname, '../public', filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send({ code: -1, msg: '文件不存在' });
    }

    const ext = path.extname(filename).toLowerCase();

    // ── Open-Meteo CSV ────────────────────────────────────────
    if (ext === '.csv') {
      // 读首行判断格式
      const firstLine = fs.readFileSync(filePath)
        .toString('utf-8').replace(/^\uFEFF/, '').split('\n')[0].toLowerCase();
      const isOpenMeteo = firstLine.includes('latitude') && firstLine.includes('longitude');

      if (isOpenMeteo) {
        if (!stationProvince || !stationCity) {
          return res.status(400).send({
            code: -1,
            msg: '请填写省份和城市'
          });
        }

        // Open-Meteo 格式：后端自动检测表头行，不依赖前端行号
        const { meta, dataHeaders, dataRows } = await parseCSVWithHeaderRow(filePath, -1);
        console.log(`[addFiledata] Open-Meteo CSV: ${dataRows.length} 行，${stationProvince} ${stationCity}`);
        console.log(`[addFiledata] 元数据:`, meta);

        // ── 自动查找或创建 station_code ───────────────────────
        const { result: existing } = await pools({
          sql: 'SELECT station_code FROM station_info WHERE province=? AND city=? AND granularity=2 LIMIT 1',
          val: [stationProvince, stationCity],
          run: true
        });

        let stationCode;
        if (existing && existing.length > 0) {
          // 城市已存在，复用编码
          stationCode = existing[0].station_code;
          console.log(`[addFiledata] 复用现有站点编码: ${stationCode}`);
        } else {
          // 新城市，自动生成下一个编码
          const { result: maxRow } = await pools({
            sql: "SELECT station_code FROM station_info ORDER BY station_code DESC LIMIT 1",
            run: true
          });
          let nextNum = 1;
          if (maxRow && maxRow.length > 0) {
            const lastCode = maxRow[0].station_code; // e.g. "ST000003"
            const num = parseInt(lastCode.replace(/\D/g, ''), 10);
            if (!isNaN(num)) nextNum = num + 1;
          }
          stationCode = 'ST' + String(nextNum).padStart(6, '0');

          // 写入 station_info
          await pools({
            sql: 'INSERT INTO station_info (station_code, province, city, granularity) VALUES (?,?,?,2)',
            val: [stationCode, stationProvince, stationCity],
            run: true
          });
          console.log(`[addFiledata] 新站点已注册: ${stationCode} ${stationProvince} ${stationCity}`);
        }

        // 确定要插入的字段
        const fields = ['station_code', 'granularity'];
        const mappedHeaders = []; // dataHeaders 中实际匹配到的列

        dataHeaders.forEach(h => {
          const dbField = OPENMETEO_FIELD_MAP[h];
          if (dbField) {
            fields.push(dbField);
            mappedHeaders.push(h);
          }
        });

        console.log(`[addFiledata] 映射字段:`, fields);

        // 构造数据行
        const rows = dataRows.map(row => {
          const r = [stationCode, 2]; // station_code, granularity=2(小时)
          mappedHeaders.forEach(h => {
            const dbField = OPENMETEO_FIELD_MAP[h];
            let val = row[h];
            // 单位转换
            if (UNIT_CONVERT[dbField]) val = UNIT_CONVERT[dbField](val);
            r.push(val === '' ? null : val);
          });
          return r;
        });

        const inserted = await batchInsertWeatherData(fields, rows, res, req);
        console.log(`[addFiledata] 插入完成，处理 ${inserted} 行`);
        return res.send({ code: 0, msg: `上传成功，处理 ${rows.length} 行数据` });

      } else {
        // ── 普通 CSV（按用户映射插入）──────────────────────────
        // 前端 rawPreviewRows 是从文件第2行开始（upFile 把第1行当CSV表头跳过）
        // 所以前端传来的 headerRowIndex 需要 +1 才是文件真实行号
        // 若前端没传则用自动检测（-1）
        const frontendIdx = valObj[0].headerRowIndex;
        const headerRowIndex = frontendIdx ? frontendIdx + 1 : -1;
        const { dataHeaders, dataRows: rawRows } = await parseCSVWithHeaderRow(filePath, headerRowIndex);
        // 转为 csv-parser 风格的对象数组
        const csvRows = rawRows.map(r => {
          const obj = {};
          dataHeaders.forEach(h => { obj[h] = r[h]; });
          return obj;
        });
        if (!csvRows.length) return res.send({ code: -1, msg: 'CSV 文件为空' });

        // weather_data 中实际存在的字段（用于校验）
        const VALID_DB_FIELDS = new Set([
          'record_time', 'avg_temperature', 'precipitation', 'rain_sum', 'snow_sum',
          'max_continuous_wind_speed', 'windgusts_max', 'winddirection_dominant',
          'shortwave_radiation_sum', 'station_code', 'granularity',
          'year_month_day' // 兼容旧映射，后续转为 record_time
        ]);

        // 解析用户字段映射，只保留 weather_data 存在的字段
        const fields = [];
        const colIndices = [];
        const colUnits = [];
        const csvHeaders = Object.keys(csvRows[0]);

        inputValues.forEach((iv, i) => {
          if (!iv || !iv.length) return;
          let dbField = iv[iv.length - 1];
          if (dbField === 'indicator') return;           // 忽略
          if (dbField === 'year_month_day') dbField = 'record_time'; // 兼容旧名
          if (!VALID_DB_FIELDS.has(dbField)) return;    // 过滤不存在的字段
          fields.push(dbField);
          colIndices.push(csvHeaders[i]);
          colUnits.push(unitValues[i]);
        });

        const rows = csvRows.map(row => {
          return colIndices.map((col, i) => {
            let val = row[col];
            const dbField = fields[i];
            // 单位转换
            if (dbField === 'snow_sum' && colUnits[i] === 'cm') {
              val = val !== null && val !== '' ? String(Math.round(parseFloat(val) * 10 * 100) / 100) : null;
            }
            if (dbField === 'shortwave_radiation_sum' && colUnits[i] === 'MJ/m²') {
              val = val !== null && val !== '' ? String(Math.round(parseFloat(val) / 0.0036 * 100) / 100) : null;
            }
            if (dbField === 'record_time' && val) {
              val = val.replace('T', ' ').trim();
              if (val.length === 16) val += ':00'; // 2025-01-01 00:00 → 2025-01-01 00:00:00
            }
            if (dbField === 'avg_temperature' && colUnits[i] === 'F') {
              val = val !== null && val !== '' ? String(Math.round((parseFloat(val) - 32) / 1.8 * 100) / 100) : null;
            }
            return val === '' ? null : val;
          });
        });

        const inserted = await batchInsertWeatherData(fields, rows, res, req);
        return res.send({ code: 0, msg: `上传成功，处理 ${rows.length} 行数据` });
      }

    } else if (ext === '.xls' || ext === '.xlsx') {
      // ── Excel ────────────────────────────────────────────────
      // weather_data 实际存在的字段白名单（与 CSV 分支保持一致）
      const VALID_DB_FIELDS_XLS = new Set([
        'record_time', 'avg_temperature', 'precipitation', 'rain_sum', 'snow_sum',
        'max_continuous_wind_speed', 'windgusts_max', 'winddirection_dominant',
        'shortwave_radiation_sum', 'station_code', 'granularity',
        'year_month_day'  // 兼容旧映射，下方转为 record_time
      ]);

      // 字段名映射 + 白名单过滤（记录原始列位置）
      const xlsFields = [];
      const xlsColUnits = [];
      const xlsColPositions = [];   // 对应 rawData 每行的列索引
      inputValues.forEach((iv, i) => {
        if (!iv || !iv.length) return;
        let dbField = iv[iv.length - 1];
        if (dbField === 'indicator') return;
        if (dbField === 'year_month_day') dbField = 'record_time';
        if (!VALID_DB_FIELDS_XLS.has(dbField)) return;
        xlsFields.push(dbField);
        xlsColUnits.push((unitValues || [])[i] || null);
        xlsColPositions.push(i);   // 记录原始列位置
      });

      // parseExcel 按位置读取：传列数 + 表头行号
      const xlsHeaderRow = valObj[0].headerRowIndex || 1;
      const rawData = await parseExcel(filePath, inputValues.length, xlsHeaderRow);

      // 单位转换，按位置取对应列的值
      const convertedData = rawData.map(row => {
        return xlsFields.map((dbField, i) => {
          let val = row[xlsColPositions[i]];  // 按原始列位置取值
          if (dbField === 'snow_sum' && xlsColUnits[i] === 'cm') {
            val = val !== null && val !== '' ? String(Math.round(parseFloat(val) * 10 * 100) / 100) : null;
          }
          if (dbField === 'shortwave_radiation_sum' && xlsColUnits[i] === 'MJ/m²') {
            val = val !== null && val !== '' ? String(Math.round(parseFloat(val) / 0.0036 * 100) / 100) : null;
          }
          if (dbField === 'record_time' && val) {
            val = String(val).replace('T', ' ').trim();
            if (val.length === 16) val += ':00';
          }
          if (dbField === 'avg_temperature' && xlsColUnits[i] === 'F') {
            val = val !== null && val !== '' ? String(Math.round((parseFloat(val) - 32) / 1.8 * 100) / 100) : null;
          }
          return val === '' ? null : val;
        });
      });

      // 若有省市信息，注册站点
      if (stationProvince && stationCity) {
        const { result: existing } = await pools({
          sql: 'SELECT station_code FROM station_info WHERE province=? AND city=? AND granularity=2 LIMIT 1',
          val: [stationProvince, stationCity], run: true
        });
        if (!existing || existing.length === 0) {
          const { result: maxRow } = await pools({
            sql: 'SELECT station_code FROM station_info ORDER BY station_code DESC LIMIT 1',
            run: true
          });
          let nextNum = 1;
          if (maxRow && maxRow.length > 0) {
            const num = parseInt(maxRow[0].station_code.replace(/\D/g, ''), 10);
            if (!isNaN(num)) nextNum = num + 1;
          }
          const newCode = 'ST' + String(nextNum).padStart(6, '0');
          await pools({
            sql: 'INSERT INTO station_info (station_code, province, city, granularity) VALUES (?,?,?,2)',
            val: [newCode, stationProvince, stationCity], run: true
          });
          // 如果字段里有 station_code，用新编码替换占位
          xlsFields.forEach((f, i) => {
            if (f === 'station_code') {
              convertedData.forEach(row => { row[i] = newCode; });
            }
          });
          console.log(`[addFiledata] Excel 新站点已注册: ${newCode} ${stationProvince} ${stationCity}`);
        }
      }

      // ── 自动补 granularity（根据时间间隔检测：15分钟=1，小时=2，天=3）
      if (!xlsFields.includes('granularity')) {
        const timeIdx = xlsFields.indexOf('record_time');
        const gran = detectGranularity(convertedData, timeIdx);
        xlsFields.push('granularity');
        convertedData.forEach(row => row.push(gran));
        console.log(`[addFiledata] Excel 自动补充 granularity=${gran}`);
      }

      await batchInsertWeatherData(xlsFields, convertedData, res, req);
      return res.send({ code: 0, msg: `上传成功，处理 ${convertedData.length} 行数据` });

    } else {
      return res.status(400).send({ code: -1, msg: '不支持的文件类型' });
    }

  } catch (err) {
    console.error('[addFiledata] 错误:', err.message);
    console.error(err.stack);
    return res.status(500).send({ code: -1, msg: '上传失败', error: err.message });
  }
});

// ── 其他路由（不变）──────────────────────────────────────────

// 获取已有站点列表（省市下拉用）
router.get("/stationOptions", async (req, res) => {
  try {
    const { result } = await pools({
      sql: `SELECT DISTINCT province, city FROM station_info
            WHERE province IS NOT NULL AND city IS NOT NULL
            ORDER BY province ASC, city ASC`,
      run: true
    });
    res.json({ code: 0, data: result });
  } catch (err) {
    res.status(500).json({ code: -1, msg: '获取站点列表失败', error: err.message });
  }
});

router.post("/getImg", async (req, res) => {
  let sql = `SELECT id,val,update_time AS updateTime,create_time AS createTime FROM files WHERE type=1`, obj = req.body;
  let { total } = await utils.getSum({ sql, name: "files", res, req });
  sql += ` ORDER BY id DESC`;
  sql = utils.pageSize(sql, obj.page, obj.size);
  let { result } = await pools({ sql, res, req });
  res.send(utils.returnData({ data: result, total }));
});

router.post("/getFile", async (req, res) => {
  let sql = `SELECT id,val,update_time AS updateTime,create_time AS createTime FROM files WHERE type=2`, obj = req.body;
  let { total } = await utils.getSum({ sql, name: "files", res, req });
  sql += ` ORDER BY id DESC`;
  sql = utils.pageSize(sql, obj.page, obj.size);
  let { result } = await pools({ sql, res, req });
  res.send(utils.returnData({ data: result, total }));
});

router.post("/upFile", async (req, res) => {
  let sql = "UPDATE files SET val=? WHERE id=?", obj = req.body;
  await pools({ sql, val: [obj.val, obj.id], run: false, res, req });
});

router.post("/delFile", async (req, res) => {
  let sql = "DELETE FROM files WHERE id=?", obj = req.body;
  await pools({ sql, val: [obj.id], run: false, res, req });
});

router.post("/addDitor", async (req, res) => {
  let sql = "INSERT INTO ditor(val) VALUES (?)", obj = req.body;
  await pools({ sql, val: [obj.val], run: false, res, req });
});

router.post("/getDitor", async (req, res) => {
  let sql = `SELECT id,val,update_time AS updateTime,create_time AS createTime FROM ditor WHERE 1=1`, obj = req.body;
  let { total } = await utils.getSum({ sql, name: "ditor", res, req });
  sql += ` ORDER BY id DESC`;
  sql = utils.pageSize(sql, obj.page, obj.size);
  let { result } = await pools({ sql, res, req });
  res.send(utils.returnData({ data: result, total }));
});

router.post("/upDitor", async (req, res) => {
  let sql = "UPDATE ditor SET val=? WHERE id=?", obj = req.body;
  await pools({ sql, val: [obj.val, obj.id], run: false, res, req });
});

router.post("/delDitor", async (req, res) => {
  let sql = "DELETE FROM ditor WHERE id=?", obj = req.body;
  await pools({ sql, val: [obj.id], run: false, res, req });
});

router.post("/addCondition", async (req, res) => {
  let sql = "INSERT INTO conditions(val,type) VALUES (?,?)", obj = req.body;
  let valObj = JSON.parse(obj.val);
  await pools({ sql, val: [obj.val, valObj[0].type], run: false, res, req });
});

router.post("/getCondition", async (req, res) => {
  let sql = `SELECT * FROM conditions WHERE type=?`, obj = req.body;
  sql += ` ORDER BY id DESC`;
  sql = utils.pageSize(sql, obj.page, obj.size);
  let { result } = await pools({ sql, val: [obj.type], res, req });
  let total = result.length;
  res.send(utils.returnData({ data: result, total }));
});

router.post("/delCondition", async (req, res) => {
  let sql = "DELETE FROM conditions WHERE id=?", obj = req.body;
  await pools({ sql, val: [obj.id], run: false, res, req });
});

router.post("/weatherInfo", async (req, res) => {
  try {
    const { lat, lng, date } = req.body.data;
    if (!lat || !lng || !date) {
      return res.send(utils.returnData({ code: -1, msg: "缺少必要的参数！", req }));
    }
    let sql = "SELECT * FROM qixiang_data WHERE year_month_day=? AND latitude=? AND longitude=?";
    let { result } = await pools({ sql, val: [date, lat, lng], res, req });
    res.send(utils.returnData({ data: result }));
  } catch (error) {
    res.send({ code: -1, msg: "获取天气信息失败", req });
  }
});

module.exports = router;