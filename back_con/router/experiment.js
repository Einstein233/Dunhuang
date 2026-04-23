// router/experiment.js
const express = require("express");
const router = express.Router();
const pools = require("../utils/pools");
const { spawn } = require('child_process');
const iconv = require('iconv-lite');
 
// 旧省份名 → weather_directory 城市名映射
const REGION_TO_CITY = {
  anhui:'安徽', aomen:'澳门', beijing:'北京', chongqing:'重庆',
  dunhuang:'敦煌', fujian:'福建', gansu:'甘肃', guangdong:'广东',
  guangxi:'广西', guizhou:'贵州', hainan:'海南', hebei:'河北',
  heilongjiang:'黑龙江', henan:'河南', hubei:'湖北', hunan:'湖南',
  jiangsu:'江苏', jiangxi:'江西', jilin:'吉林', liaoning:'辽宁',
  neimenggu:'内蒙古', ningxia:'宁夏', qinghai:'青海', shan1xi:'山西',
  shan3xi:'陕西', shandong:'山东', sichuan:'四川', taiwan:'台湾',
  tianjin:'天津', xianggang:'香港', xinjiang:'新疆', xizang:'西藏',
  yunnan:'云南', zhejiang:'浙江',
};
 
// 旧字段名 → 新字段名映射（兼容前端传旧名）
const FACTOR_ALIAS = {
  year_month_day:  'record_time',
  max_temperature: 'avg_temperature',
  min_temperature: 'avg_temperature',
};
 
// 新表中实际存在的字段
const ALLOWED_FACTORS = [
  'station_code', 'granularity', 'record_time',
  'avg_temperature', 'precipitation', 'rain_sum', 'snow_sum',
  'max_continuous_wind_speed', 'windgusts_max',
  'winddirection_dominant', 'shortwave_radiation_sum',
];
 
router.post("/run", async (req, res) => {
 
  console.log('\n========== /experiment/run 接收到请求 ==========');
  console.log('请求参数:', JSON.stringify(req.body, null, 2));
 
  const { regions, dataRange, simulateYear, simulateMonth,
          expMonth, expDay, envFactors } = req.body;
 
  console.log(`[日志1] 地区: ${regions?.join(', ')} | 时间: ${dataRange?.join(' 到 ')} | 字段: ${envFactors?.join(', ')}`);
 
  // ── 参数校验 ──────────────────────────────────────────────
  if (!regions || !Array.isArray(regions) || !dataRange || !envFactors) {
    console.log('[日志2] ❌ 参数不完整');
    return res.status(400).json({ code: -1, msg: '参数不完整' });
  }
 
  const invalidRegions = regions.filter(r => !REGION_TO_CITY[r]);
  if (invalidRegions.length > 0) {
    console.log(`[日志2] ❌ 无效地区: ${invalidRegions.join(', ')}`);
    return res.status(400).json({ code: -1, msg: `地区无效: ${invalidRegions.join(', ')}` });
  }
 
  // 字段映射 + 去重
  const mappedFactors = Array.from(new Set(
    envFactors.map(f => FACTOR_ALIAS[f] || f)
  ));
 
  const invalidFactors = mappedFactors.filter(f => !ALLOWED_FACTORS.includes(f));
  if (invalidFactors.length > 0) {
    console.log(`[日志2] ❌ 无效字段: ${invalidFactors.join(', ')}`);
    return res.status(400).json({ code: -1, msg: `字段无效: ${invalidFactors.join(', ')}` });
  }
 
  // 始终包含 record_time
  const finalFactors = Array.from(new Set([...mappedFactors, 'record_time']));
  const selectFactors = finalFactors.map(f => '`' + f + '`').join(',');
 
  console.log(`[日志2] ✅ 参数校验通过 | 映射后字段: ${finalFactors.join(', ')}`);
 
  try {
    // ── STEP 1: 查 weather_directory 拿 station_code ──────
    const cityList = regions.map(r => REGION_TO_CITY[r]);
    const placeholders = cityList.map(() => '?').join(',');
    const dirSql = `
      SELECT station_code, city, province
      FROM weather_directory
      WHERE city IN (${placeholders}) AND granularity = 2
    `;
 
    console.log(`[日志3] 查询目录 → 城市: ${cityList.join(', ')}`);
 
    const { result: dirResult } = await pools({ sql: dirSql, val: cityList });
 
    if (!dirResult || dirResult.length === 0) {
      console.log(`[日志3] ❌ weather_directory 中未找到城市: ${cityList.join(', ')}`);
      console.log('[日志3] 💡 提示: 请确认 weather_directory 表已导入，且城市名称与映射表一致');
      return res.status(404).json({
        code: -1,
        msg: `找不到对应气象站点，城市: ${cityList.join(', ')}`,
        hint: '请检查 weather_directory 表是否存在该城市数据'
      });
    }
 
    const stationCodes = dirResult.map(r => r.station_code);
    console.log(`[日志3] ✅ 找到站点: ${dirResult.map(r => `${r.city}(${r.station_code})`).join(', ')}`);
 
    // ── STEP 2: 查 weather_data ────────────────────────────
    const stPlaceholders = stationCodes.map(() => '?').join(',');
    const dataSql = `
      SELECT ${selectFactors}
      FROM \`weather_data\`
      WHERE station_code IN (${stPlaceholders})
        AND granularity = 2
        AND record_time >= ?
        AND record_time <= ?
      ORDER BY station_code ASC, record_time ASC
    `;
    const sqlParams = [
      ...stationCodes,
      dataRange[0] + ' 00:00:00',
      dataRange[1] + ' 23:59:59'
    ];
 
    console.log(`[日志4] SQL: ${dataSql.replace(/\s+/g, ' ').trim()}`);
    console.log(`[日志5] 参数: ${JSON.stringify(sqlParams)}`);
 
    const { result } = await pools({ sql: dataSql, val: sqlParams });
 
    if (!result || result.length === 0) {
      console.log(`[日志6] ❌ 未查到数据 | 站点: ${stationCodes.join(',')} | 时间: ${dataRange[0]} ~ ${dataRange[1]}`);
      console.log('[日志6] 💡 提示: 请检查该时间范围内是否有数据');
      return res.status(404).json({
        code: -1,
        msg: '该时间范围内无数据',
        stations: stationCodes,
        range: dataRange
      });
    }
 
    console.log(`[日志6] ✅ 查到 ${result.length} 条记录`);
    console.log('[日志7] 前3条示例:', JSON.stringify(result.slice(0, 3), null, 2));
 
    // ── STEP 3: 调用 Python 脚本 ───────────────────────────
    console.log('[日志8] 调用 Python (ageingExp.py)...');
 
    const pyEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const py = spawn('python', ['ageingExp.py'], { env: pyEnv });
 
    py.stdin.write(JSON.stringify(result));
    py.stdin.end();
 
    let pyOutput = '';
    let pyStderr = '';
 
    py.stdout.on('data', data => {
      const decoded = iconv.decode(data, 'utf8');
      pyOutput += decoded;
      console.log('[日志9] Python输出:', decoded.substring(0, 200));
    });
 
    py.stderr.on('data', data => {
      const decoded = iconv.decode(data, 'utf8');
      pyStderr += decoded;
      console.error('[日志10] Python错误:', decoded);
    });
 
    py.on('close', code => {
      console.log(`[日志11] Python退出码: ${code} | 输出长度: ${pyOutput.length} 字符`);
 
      if (code !== 0) {
        console.error(`[日志19] ❌ Python执行失败\n错误信息: ${pyStderr}`);
        return res.status(500).json({ code: -1, msg: 'Python运行失败', error: pyStderr });
      }
 
      try {
        const resultObj = JSON.parse(pyOutput);
 
        // Python 返回了 error 字段
        if (resultObj.error) {
          console.error(`[日志16] ❌ Python返回错误: ${resultObj.error}`);
          return res.status(500).json({ code: -1, msg: resultObj.error });
        }
 
        console.log('[日志14] ✅ JSON解析成功，返回前端');
        res.json({ code: 0, data: resultObj });
 
      } catch (e) {
        console.error('[日志16] ❌ JSON解析失败:', e.message);
        console.error('[日志17] Python原始输出:', pyOutput);
        res.status(500).json({ code: -1, msg: 'Python输出不是合法JSON', raw: pyOutput });
      }
    });
 
  } catch (err) {
    console.error('[日志21] ❌ 数据库查询出错:', err.message);
    console.error('[日志22] 错误堆栈:', err.stack);
    res.status(500).json({ code: -1, msg: '数据库查询出错', error: err.message });
  }
});
 
module.exports = router;