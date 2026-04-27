// router/autoscrap.js
const express = require('express');
const router  = express.Router();
const pools   = require('../utils/pools');
const { spawn } = require('child_process');
const iconv   = require('iconv-lite');

// 旧省份名 → weather_directory 城市名映射（与 experiment.js 保持一致）
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

// 旧字段名 → 新字段名
const FACTOR_ALIAS = {
  year_month_day:  'record_time',
  max_temperature: 'avg_temperature',
  min_temperature: 'avg_temperature',
};

// weather_data 实际存在的字段白名单
const ALLOWED_FACTORS = new Set([
  'station_code', 'granularity', 'record_time',
  'avg_temperature', 'relativehumidity_2m', 'rain_sum', 'snow_sum',
  'max_continuous_wind_speed', 'shortwave_radiation_sum',
]);

router.post('/run', async (req, res) => {

  const { regions, dataRange, simulateYear, simulateMonth,
          expMonth, expDay, envFactors, antiqueType } = req.body;

  // ── 参数校验 ─────────────────────────────────────────────
  if (!regions || !Array.isArray(regions) || !dataRange || !envFactors || !antiqueType) {
    return res.status(400).json({ code: -1, msg: '参数不完整' });
  }

  const invalidRegions = regions.filter(r => !REGION_TO_CITY[r]);
  if (invalidRegions.length > 0) {
    return res.status(400).json({ code: -1, msg: `地区无效: ${invalidRegions.join(', ')}` });
  }

  // 字段名映射 + 去重 + 白名单过滤
  const mappedFactors = Array.from(new Set(
    envFactors.map(f => FACTOR_ALIAS[f] || f).filter(f => ALLOWED_FACTORS.has(f))
  ));

  if (mappedFactors.length === 0) {
    return res.status(400).json({ code: -1, msg: '无有效字段' });
  }

  // 始终包含 record_time
  const finalFactors  = Array.from(new Set([...mappedFactors, 'record_time']));
  const selectFactors = finalFactors.map(f => `\`${f}\``).join(',');

  try {
    // ── STEP 1: 查 weather_directory 拿 station_code ────────
    const cityList     = regions.map(r => REGION_TO_CITY[r]);
    const placeholders = cityList.map(() => '?').join(',');

    const { result: dirResult } = await pools({
      sql: `SELECT station_code, city FROM weather_directory
            WHERE city IN (${placeholders}) AND granularity = 2`,
      val: cityList,
      run: true
    });

    if (!dirResult || dirResult.length === 0) {
      return res.status(404).json({
        code: -1,
        msg: `找不到对应气象站点: ${cityList.join(', ')}`
      });
    }

    const stationCodes  = dirResult.map(r => r.station_code);
    const stPlaceholders = stationCodes.map(() => '?').join(',');

    // ── STEP 2: 查 weather_data ──────────────────────────────
    const { result } = await pools({
      sql: `SELECT ${selectFactors}
            FROM \`weather_data\`
            WHERE station_code IN (${stPlaceholders})
              AND granularity = 2
              AND record_time >= ?
              AND record_time <= ?
            ORDER BY station_code ASC, record_time ASC`,
      val: [...stationCodes,
            dataRange[0] + ' 00:00:00',
            dataRange[1] + ' 23:59:59'],
      run: true
    });

    if (!result || result.length === 0) {
      return res.status(404).json({
        code: -1,
        msg: '该时间范围内无数据',
        stations: stationCodes,
        range: dataRange
      });
    }

    // ── STEP 3: 调用 Python 脚本 ─────────────────────────────
    const pyEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    const py    = spawn('python', ['ageingExp.py'], { env: pyEnv });

    py.stdin.write(JSON.stringify(result));
    py.stdin.end();

    let pyOutput = '', pyStderr = '';

    py.stdout.on('data', d => { pyOutput += iconv.decode(d, 'utf-8'); });
    py.stderr.on('data', d => {
      pyStderr += iconv.decode(d, 'utf-8');
      console.error('[autoscrap] Python错误:', pyStderr);
    });

    py.on('close', code => {
      if (code !== 0) {
        return res.status(500).json({ code: -1, msg: 'Python运行失败', error: pyStderr });
      }
      try {
        const resultObj = JSON.parse(pyOutput);
        if (resultObj.error) {
          return res.status(500).json({ code: -1, msg: resultObj.error });
        }
        res.json({ code: 0, data: resultObj });
      } catch (e) {
        res.status(500).json({ code: -1, msg: 'Python输出不是合法JSON', raw: pyOutput });
      }
    });

  } catch (err) {
    console.error('[autoscrap] 数据库错误:', err.message);
    res.status(500).json({ code: -1, msg: '查询出错', error: err.message });
  }
});

module.exports = router;
