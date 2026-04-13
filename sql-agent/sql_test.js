const mysql = require("mysql2/promise");

async function testConnection() {
  try {
    const connection = await mysql.createConnection({
      host: "127.0.0.1",
      port: 3308,
      user: "agent_user",
      password: "0000",
      database: "dunhuang_agent"
    });

    console.log("数据库连接成功！");

    const [rows] = await connection.execute("SELECT NOW() AS now_time");
    console.log(rows);

    await connection.end();
  } catch (err) {
    console.error("数据库连接失败：", err);
  }
}

testConnection();
