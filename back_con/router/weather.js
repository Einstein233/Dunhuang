// router/weatherRouter.js
const express = require("express");
const router = express.Router();
const pools = require("../utils/pools");
const xlsx = require('node-xlsx');

// 导出气象数据接口（Excel下载）
router.post("/generalDownload", async (req, res) => {

  const { fields, start, end, region } = req.body;
  if (!fields || !Array.isArray(fields) || !start || !end || !region) {
    return res.status(400).json({ code: -1, msg: "参数不完整" });
  }

  const allowedRegions = [
    "anhui", "aomen", "beijing", "chongqing", "fujian", "gansu", "guangdong", 
    "guangxi", "guizhou", "hainan", "hebei", "heilongjiang", "henan", "hubei",
    "hunan", "jiangsu", "jiangxi", "jilin", "liaoning", "neimenggu", "ningxia",
    "qinghai", "shan1xi", "shan3xi", "shandong", "sichuan", "taiwan", "tianjin",
    "xianggang", "xinjiang", "xizang", "yunnan", "zhejiang"
  ];
  if (!allowedRegions.includes(region)) {
    return res.status(400).json({ code: -1, msg: "地区无效" });
  }

  // 拼接字段列表，防SQL注入建议只允许白名单字段
  const allowedFields = [
      "year_month_day", "station_code", "max_temperature", "min_temperature", "avg_temperature",
      "precipitation", "rain_sum", "snow_sum", "max_continuous_wind_speed", "windgusts_max",
      "winddirection_dominant", "shortwave_radiation_sum"
  ];
  const validFields = fields.filter(f => allowedFields.includes(f));
  if (validFields.length === 0) {
    return res.status(400).json({ code: -1, msg: "字段无效" });
  }

  const selectFields = validFields.map(f => "`" + f + "`").join(",");
  const sql = `SELECT ${selectFields} FROM \`${region}\` WHERE year_month_day >= ? AND year_month_day <= ? ORDER BY year_month_day ASC`;

  try {
    const { result } = await pools({ sql, val: [start, end] });
    // Excel表头
    const data = [validFields];
    // 每一行数据
    result.forEach(row => {
      data.push(validFields.map(f => row[f]));
    });

    // 生成Excel
    const buffer = xlsx.build([{ name: '气象数据', data }]);
    const filename = `气象数据_${start}_to_${end}.xlsx`;
    const encodedFilename = encodeURI(filename);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;filename='+encodedFilename);
    res.setHeader("Content-Disposition", "attachment; filename=" + encodedFilename);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ code: -1, msg: "下载出错", err });
  }
});

module.exports = router;
