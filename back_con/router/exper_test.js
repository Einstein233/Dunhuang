
const path = require("path");
const { spawn } = require("child_process");
const iconv = require("iconv-lite");

const pools = require("../utils/pools");

async function main() {

  const region = "liaoning";
  const dataRange = ["2024-01-01", "2024-12-01"];


  const envFactors = [
    "year_month_day",
    "station_code",
    "max_temperature",
    "min_temperature",
    "avg_temperature",
    "precipitation",
    "rain_sum",
    "snow_sum",
    "max_continuous_wind_speed",
    "windgusts_max",
    "winddirection_dominant",
    "shortwave_radiation_sum",
  ];

 
  const antiqueType = "building";


  const selectFactors = envFactors.map((f) => "`" + f + "`").join(",");
  const sql = `
    SELECT ${selectFactors}
    FROM \`${region}\`
    WHERE year_month_day >= ?
      AND year_month_day <= ?
    ORDER BY year_month_day ASC
  `;

  console.log("[INFO] SQL:", sql.trim());
  console.log("[INFO] Params:", dataRange);

  let resultRows = [];
  try {
    const { result } = await pools({ sql, val: [dataRange[0], dataRange[1]] });
    resultRows = result || [];
  } catch (e) {
    console.error("[ERROR] DB query failed:", e);
    process.exit(1);
  }

  console.log(`[INFO] DB rows: ${resultRows.length}`);
  console.log(`[INFO] antiqueType: ${antiqueType}`);


  const scriptPath = path.normalize("back_con\\simu_exper_server.py"); // Windows 风格
  const py = spawn("python", [scriptPath], { stdio: ["pipe", "pipe", "pipe"] });

  // 把数据写入 stdin
  const inputData = JSON.stringify({
    region,
    dataRange,
    envFactors,
    antiqueType,
    data: resultRows,
  });
  py.stdin.write(inputData);
  py.stdin.end();

  // 4) 读取 Python 输出（可选：用于调试）
  let pyStdout = "";
  let pyStderr = "";

  py.stdout.on("data", (chunk) => {
    try {
      // 尝试UTF-8解码
      pyStdout += iconv.decode(chunk, 'utf8');
    } catch (e) {
      // 如果UTF-8失败，尝试GBK解码
      pyStdout += iconv.decode(chunk, 'gbk');
    }
  });

  py.stderr.on("data", (chunk) => {
    try {
      // 尝试UTF-8解码
      pyStderr += iconv.decode(chunk, 'utf8');
    } catch (e) {
      // 如果UTF-8失败，尝试GBK解码
      pyStderr += iconv.decode(chunk, 'gbk');
    }
  });

  py.on("close", (code) => {
    // 你说“输出先写死”，这里按要求固定输出
    const fixedOutput = {
      code: 0,
      msg: "TEST_OK (fixed output)",
      region,
      dataRange,
      envFactors_count: envFactors.length,
      antiqueType,
      db_rows: resultRows.length,
    };

    console.log("\n===== FIXED OUTPUT =====");
    console.log(JSON.stringify(fixedOutput, null, 2));

    // 如果你想同时看看 Python 真输出，打开下面这段
    console.log("\n===== PYTHON RESULT (raw) =====");
    console.log("exit code:", code);
    if (pyStderr) {
      console.log("\n[PY STDERR]\n" + pyStderr);
    }
    if (pyStdout) {
      console.log("\n[PY STDOUT]\n" + pyStdout);
    }
  });
}

main();
