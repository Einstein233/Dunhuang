// MySQL 连接池的配置

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host:"127.0.0.1",
    port:3306,
    user:"root",
    password:"root",
    database:"vue_admin",  // ← 改这里
    connectionLimit:15,
    dateStrings:true,
    charset:'utf8mb4',
    timezone: '+08:00'
});

(async () => {
    try {
        const connection = await pool.getConnection();
        console.log("数据库连接成功！");
        connection.release();
    } catch (err) {
        console.error("数据库连接失败：", err.message);
    }
})();

module.exports = pool;