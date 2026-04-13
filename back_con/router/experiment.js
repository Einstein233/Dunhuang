// router/experiment.js
const express = require("express");
const router = express.Router();
const pools = require("../utils/pools");
const xlsx = require('node-xlsx');
const { spawn } = require('child_process');

// 只查数据库并返回
router.post("/run", async (req, res) => {
  
  console.log('========== /experiment/run 接收到请求 ==========');
  console.log('请求参数:', JSON.stringify(req.body, null, 2));
  console.log('===============================================');
  
  const { regions, dataRange, simulateYear, simulateMonth, expMonth,
          expDay, envFactors } = req.body;
  
  console.log(`[日志1] 收到请求 - 地区: ${regions?.join(', ')}, 时间范围: ${dataRange?.join(' 到 ')}, 环境因子: ${envFactors?.join(', ')}`);
  
  if (!regions || !Array.isArray(regions) || !dataRange || !envFactors) {
    console.log('[日志2] 参数不完整，返回错误');
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
    console.log('[日志3] 开始查询数据库...');
    console.log('[日志4] SQL语句:', sql);
    console.log('[日志5] 查询参数:', [dataRange[0], dataRange[1]]);
    
    const { result } = await pools({ sql, val: [dataRange[0], dataRange[1]] });

    console.log(`[日志6] 数据库查询完成，查询到 ${result?.length || 0} 条记录`);
    
    if (result && result.length > 0) {
      console.log('[日志7] 前3条数据示例:');
      result.slice(0, 3).forEach((item, index) => {
        console.log(`  示例${index + 1}:`, JSON.stringify(item, null, 2));
      });
    } else {
      console.log('[日志7] 警告：未查询到任何数据！');
    }

    console.log('[日志8] 开始调用Python脚本 (ageingExp.py)...');
    
    // 调用Python脚本，处理数据
    const { spawn } = require('child_process');
    const inputData = JSON.stringify(result);
    
    // 设置环境变量确保Python使用UTF-8输出
    const pyEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    
    const py = spawn('python', ['ageingExp.py'], {
      env: pyEnv
    });
    py.stdin.write(inputData);
    py.stdin.end();

    let pyOutput = '';
    let pyStderr = '';
    
    // 使用UTF-8解码输出
    const iconv = require('iconv-lite');
    py.stdout.on('data', data => { 
      try {
        // 尝试UTF-8解码
        const decoded = iconv.decode(data, 'utf8');
        pyOutput += decoded;
        console.log('[日志9] Python标准输出片段:', decoded.substring(0, 100));
      } catch (e) {
        // 如果UTF-8失败，尝试GBK解码
        const decoded = iconv.decode(data, 'gbk');
        pyOutput += decoded;
        console.log('[日志9] Python标准输出片段 (GBK):', decoded.substring(0, 100));
      }
    });
    
    py.stderr.on('data', data => { 
      try {
        const decoded = iconv.decode(data, 'utf8');
        pyStderr += decoded;
        console.error('[日志10] Python错误输出:', decoded);
      } catch (e) {
        const decoded = iconv.decode(data, 'gbk');
        pyStderr += decoded;
        console.error('[日志10] Python错误输出 (GBK):', decoded);
      }
    });

    py.on('close', code => {
      console.log(`[日志11] Python脚本执行完成，退出码: ${code}`);
      console.log(`[日志12] Python输出总长度: ${pyOutput.length} 字符`);
      
      if (code === 0) {
        console.log('[日志13] 开始解析Python返回的JSON...');
        let resultObj;
        try {
          resultObj = JSON.parse(pyOutput);
          console.log('[日志14] JSON解析成功');
          console.log('[日志15] 返回给前端的数据示例:', JSON.stringify(resultObj, null, 2).substring(0, 500));
        } catch (e) {
          console.error('[日志16] JSON解析失败:', e.message);
          console.error('[日志17] Python原始输出:', pyOutput);
          return res.status(500).json({ code: -1, msg: "Python输出不是合法JSON", pyOutput });
        }
        console.log('[日志18] 成功返回结果给前端');
        res.json({ code: 0, data: resultObj });
      } else {
        console.error('[日志19] Python执行失败，退出码:', code);
        console.error('[日志20] Python错误输出:', pyStderr);
        res.status(500).json({ code: -1, msg: "Python运行失败", pyOutput });
      }
    });

  } catch (err) {
    console.error('[日志21] 数据库查询出错:', err);
    console.error('[日志22] 错误堆栈:', err.stack);
    res.status(500).json({ code: -1, msg: "下载出错", err });
  }
});

module.exports = router;
