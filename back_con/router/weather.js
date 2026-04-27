// router/weather.js
const express = require('express');
const router  = express.Router();
const pools   = require('../utils/pools');
const xlsx      = require('node-xlsx');
const ExcelJS   = require('exceljs');

// weather_data 实际字段白名单
const ALLOWED_FIELDS = new Set([
  'record_time', 'station_code',
  'avg_temperature', 'relativehumidity_2m', 'rain_sum', 'snow_sum',
  'max_continuous_wind_speed', 'shortwave_radiation_sum',
]);

// 字段中文名（Excel 表头）
const FIELD_LABEL = {
  record_time:               '采集时间',
  station_code:              '站点编码',
  avg_temperature:           '平均气温 (°C)',
  relativehumidity_2m:       '相对湿度 (%)',
  rain_sum:                  '降雨量 (mm)',
  snow_sum:                  '降雪量 (mm)',
  max_continuous_wind_speed: '风速 (m/s)',
  shortwave_radiation_sum:   '短波辐射 (W/m²)',
};

// ── GET /weather/generalDownload/regions ─────────────────────
// 从 weather_directory 动态返回可用城市列表
router.get('/generalDownload/regions', async (req, res) => {
  try {
    const { result } = await pools({
      sql: `SELECT province, city, station_code,
                   start_time, end_time, total_count
            FROM weather_directory
            WHERE granularity = 2
            ORDER BY province ASC, city ASC`,
      run: true
    });
    res.json({ code: 0, data: result });
  } catch (err) {
    res.status(500).json({ code: -1, msg: '获取地区列表失败', error: err.message });
  }
});

// ── POST /weather/generalDownload ─────────────────────────────
// 按城市 + 字段 + 时间范围下载 Excel
router.post('/generalDownload', async (req, res) => {
  const { city, fields, start, end } = req.body;

  // 校验
  if (!city || !fields || !Array.isArray(fields) || !start || !end) {
    return res.status(400).json({ code: -1, msg: '参数不完整：需要 city, fields, start, end' });
  }

  const validFields = fields.filter(f => ALLOWED_FIELDS.has(f));
  if (validFields.length === 0) {
    return res.status(400).json({ code: -1, msg: '无有效字段' });
  }

  // 始终包含 record_time 和 station_code
  const finalFields   = Array.from(new Set(['record_time', 'station_code', ...validFields]));
  const selectFactors = finalFields.map(f => `\`${f}\``).join(',');

  try {
    // ── STEP 1: 查 weather_directory 拿 station_code ─────────
    const { result: dirResult } = await pools({
      sql: `SELECT station_code FROM weather_directory
            WHERE city = ? AND granularity = 2 LIMIT 1`,
      val: [city],
      run: true
    });

    if (!dirResult || dirResult.length === 0) {
      return res.status(404).json({ code: -1, msg: `找不到城市: ${city}` });
    }

    const stationCode = dirResult[0].station_code;

    // ── STEP 2: 查 weather_data ───────────────────────────────
    const { result } = await pools({
      sql: `SELECT ${selectFactors}
            FROM \`weather_data\`
            WHERE station_code = ?
              AND granularity = 2
              AND record_time >= ?
              AND record_time <= ?
            ORDER BY record_time ASC`,
      val: [stationCode, start + ' 00:00:00', end + ' 23:59:59'],
      run: true
    });

    if (!result || result.length === 0) {
      return res.status(404).json({
        code: -1,
        msg: `${city} 在 ${start} ~ ${end} 无数据`
      });
    }

    // ── STEP 3: 生成 Excel（ExcelJS，支持靠左对齐）────────────
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(city);

    // 表头
    ws.columns = finalFields.map(f => ({
      header: FIELD_LABEL[f] || f,
      key:    f,
      width:  f === 'record_time' ? 22 : 16,
    }));

    // 表头样式
    ws.getRow(1).eachCell(cell => {
      cell.font      = { bold: true };
      cell.alignment = { horizontal: 'left', vertical: 'middle' };
      cell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: 'FFFBE4BE' }
      };
    });

    // record_time 列设为纯文本格式（@），防止 ExcelJS 把
    // "2025-01-01 00:00:00" 自动解析成 Date 序列号从而丢失小时
    const timeColIdx = finalFields.indexOf('record_time') + 1; // 1-based
    if (timeColIdx > 0) {
      ws.getColumn(timeColIdx).numFmt = '@';
    }

    // 数据行，全部靠左；record_time 强制写字符串保留时分秒
    result.forEach(row => {
      const newRow = ws.addRow(
        finalFields.map(f =>
          f === 'record_time' ? String(row[f] ?? '') : (row[f] ?? '')
        )
      );
      newRow.eachCell((cell, colNum) => {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        if (colNum === timeColIdx) cell.numFmt = '@'; // 再次锁定，双重保险
      });
    });

    const filename = encodeURIComponent(`${city}_${start}_${end}.xlsx`);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition',
      `attachment; filename*=UTF-8''${filename}`);

    const buffer = await wb.xlsx.writeBuffer();
    res.send(buffer);

  } catch (err) {
    console.error('[generalDownload] 错误:', err.message);
    res.status(500).json({ code: -1, msg: '下载失败', error: err.message });
  }
});

module.exports = router;
