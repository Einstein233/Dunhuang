const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

function parseDatabaseUrl(url) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
    };
  } catch (e) {
    return null;
  }
}

function getDbConfig() {
  const fromEnv = parseDatabaseUrl(process.env.DATABASE_URL || "");
  if (fromEnv) return fromEnv;
  return {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 3308),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "root",
    database: process.env.DB_NAME || "dunhuang_agent",
  };
}

function resolveBackupFile(inputArg) {
  if (inputArg) {
    const full = path.resolve(inputArg);
    if (!fs.existsSync(full)) {
      throw new Error(`Backup file not found: ${full}`);
    }
    return full;
  }
  const backupDir = path.resolve(__dirname, "backups");
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup directory not found: ${backupDir}`);
  }
  const files = fs
    .readdirSync(backupDir)
    .filter((f) => /^region_tables_backup_\d{14}\.sql$/i.test(f))
    .sort();
  if (!files.length) {
    throw new Error(`No region backup sql found in ${backupDir}`);
  }
  return path.join(backupDir, files[files.length - 1]);
}

async function main() {
  const backupFile = resolveBackupFile(process.argv[2]);
  const sql = fs.readFileSync(backupFile, "utf8");
  const cfg = getDbConfig();

  const conn = await mysql.createConnection({
    ...cfg,
    multipleStatements: true,
  });

  try {
    await conn.query(sql);
    console.log(`Restore succeeded from: ${backupFile}`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

