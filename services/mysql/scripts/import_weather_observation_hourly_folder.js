const path = require("path");
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "..", "..", "sql-agent", ".env"),
  });
} catch (error) {
  // Allow the script to run when DATABASE_URL is injected by the parent process.
}
const fs = require("fs");
const { importHourlyCsv } = require("./import_weather_observation_hourly");

const DEFAULT_REGION_ALIASES = {
  天津: "tianjin",
  敦煌: "dunhuang",
  北京: "beijing",
  重庆: "chongqing",
};

function walkCsvFiles(dirPath) {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const results = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkCsvFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      results.push(fullPath);
    }
  }

  return results;
}

function inferRegionNameFromFilename(filePath, aliases) {
  const baseName = path.basename(filePath, path.extname(filePath));
  const normalized = baseName.replace(/\s+/g, "_");
  const firstToken = normalized.split(/[_-]/)[0];

  if (aliases[firstToken]) {
    return aliases[firstToken];
  }

  const lowerName = normalized.toLowerCase();
  for (const [alias, regionName] of Object.entries(aliases)) {
    if (lowerName.includes(String(alias).toLowerCase())) {
      return regionName;
    }
  }

  if (/^[a-z0-9]+$/i.test(firstToken)) {
    return firstToken.toLowerCase();
  }

  return null;
}

async function main() {
  const folderPath = process.argv[2];
  const province = process.argv.includes("--province")
    ? process.argv[process.argv.indexOf("--province") + 1]
    : null;
  const city = process.argv.includes("--city")
    ? process.argv[process.argv.indexOf("--city") + 1]
    : null;
  const stationCode = process.argv.includes("--station-code")
    ? process.argv[process.argv.indexOf("--station-code") + 1]
    : null;
  const granularity = process.argv.includes("--granularity")
    ? Number(process.argv[process.argv.indexOf("--granularity") + 1])
    : 2;

  if (!folderPath) {
    throw new Error(
      "用法: node SQL/import_weather_observation_hourly_folder.js <folderPath> [--province <province>] [--city <city>] [--station-code <code>] [--granularity <number>]"
    );
  }

  if (!fs.existsSync(folderPath)) {
    throw new Error(`文件夹不存在: ${folderPath}`);
  }

  const csvFiles = walkCsvFiles(folderPath).sort((left, right) =>
    left.localeCompare(right, "zh-CN")
  );

  if (!csvFiles.length) {
    throw new Error(`文件夹下没有找到 CSV 文件: ${folderPath}`);
  }

  const results = [];
  for (const csvPath of csvFiles) {
    const regionName = inferRegionNameFromFilename(csvPath, DEFAULT_REGION_ALIASES);
    if (!regionName && !(province && city)) {
      const skipped = {
        csvPath,
        status: "skipped",
        reason: "无法从文件名推断 regionName，且未显式提供 --province/--city",
      };
      results.push(skipped);
      console.log(`[skipped] ${path.basename(csvPath)}: ${skipped.reason}`);
      continue;
    }

    try {
      const summary = await importHourlyCsv({
        csvPath,
        regionName,
        province,
        city,
        stationCode,
        granularity,
      });
      results.push({
        status: "imported",
        ...summary,
      });
      console.log(
        `[imported] ${path.basename(csvPath)} -> ${summary.stationCode} (${summary.rowsInsertedOrUpdated} rows)`
      );
    } catch (error) {
      const failed = {
        csvPath,
        regionName,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      results.push(failed);
      console.error(
        `[failed] ${path.basename(csvPath)} -> ${regionName || `${province}/${city}`}: ${failed.error}`
      );
    }
  }

  console.log(JSON.stringify({ folderPath, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
