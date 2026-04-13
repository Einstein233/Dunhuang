// router/experiment.js
const express = require("express");
const router = express.Router();
const pools = require("../utils/pools");
const xlsx = require('node-xlsx');
const { spawn } = require('child_process');

// 只查数据库并返回
router.post("/run", async (req, res) => {
  
  const { regions, dataRange, simulateYear, simulateMonth, expMonth,
          expDay, envFactors, antiqueType } = req.body;
  if (!regions || !Array.isArray(regions) || !dataRange || !envFactors || !antiqueType) {
    return res.status(400).json({ code: -1, msg: "参数不完整" });
  }
  
  const allowedRegions = [
    "anhui", "aomen", "beijing", "chongqing", "fujian", "gansu", "guangdong", 
    "guangxi", "guizhou", "hainan", "hebei", "heilongjiang", "henan", "hubei",
    "hunan", "jiangsu", "jiangxi", "jilin", "liaoning", "neimenggu", "ningxia",
    "qinghai", "shan1xi", "shan3xi", "shandong", "sichuan", "taiwan", "tianjin",
    "xianggang", "xinjiang", "xizang", "yunnan", "zhejiang"
  ];

  const isValid = regions.every(r => allowedRegions.includes(r));
  if (!isValid) {
    return res.status(400).json({ code: -1, msg: "地区无效" });
  }

  const allowedFactors = [
      "year_month_day", "station_code", "max_temperature", "min_temperature", "avg_temperature",
      "precipitation", "rain_sum", "snow_sum", "max_continuous_wind_speed", "windgusts_max",
      "winddirection_dominant", "shortwave_radiation_sum"
  ];

  const validFactors = envFactors.every(f => allowedFactors.includes(f));
  if (!validFactors) {
    return res.status(400).json({ code: -1, msg: "字段无效" });
  }

  const additionalFactors = ["year_month_day"]

  const newFactors = Array.from(new Set([...envFactors, ...additionalFactors]));

  const selectFactors = newFactors.map(f => "`" + f + "`").join(",");
  const sql = `SELECT ${selectFactors} FROM \`${regions[0]}\` WHERE year_month_day >= ? AND year_month_day <= ? ORDER BY year_month_day ASC`;
  // console.log("sql = ", sql);

  try {
    const { result } = await pools({ sql, val: [dataRange[0], dataRange[1]] });

    // 调用Python脚本，处理数据
    const { spawn } = require('child_process');
    const inputData = JSON.stringify(result);

    const py = spawn('python', ['ageingExp.py']);
    py.stdin.write(inputData);
    py.stdin.end();

    let pyOutput = '';
    py.stdout.on('data', data => { pyOutput += data.toString(); });
    py.stderr.on('data', data => { console.error('Python错误输出：', data.toString()); });

    py.on('close', code => {
      if (code === 0) {
        let resultObj;
        try {
          resultObj = JSON.parse(pyOutput);
        } catch (e) {
          return res.status(500).json({ code: -1, msg: "Python输出不是合法JSON", pyOutput });
        }
        res.json({ code: 0, data: resultObj });
      } else {
        res.status(500).json({ code: -1, msg: "Python运行失败", pyOutput });
      }
    });

  } catch (err) {
    console.error('出错了:', err);  // 打印详细错误
    res.status(500).json({ code: -1, msg: "下载出错", err });
  }
});

module.exports = router;
