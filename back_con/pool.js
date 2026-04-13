// MySQL 连接池的配置

const mysql = require("mysql2/promise");  // 使用 mysql2/promise 进行数据库交互

// 创建 MySQL 连接池
const pool = mysql.createPool({
	host:"127.0.0.1",
	port:3308,
	user:"root",
	password:"root",
	database:"dunhuang_agent",
	connectionLimit:15,
	dateStrings:true,
	charset:'utf8mb4',
	timezone: '+08:00'
});

// 测试数据库连接是否成功
(async () => {
	try {
		const connection = await pool.getConnection();
		console.log("数据库连接成功！");
		connection.release();
	} catch (err) {
		console.error("数据库连接失败：", err.message);
	}
})();

// 导出连接池：使得其他文件可以使用这个连接池进行数据库查询
module.exports = pool;
