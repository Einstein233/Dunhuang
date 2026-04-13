const express = require('express');
const router = express.Router();
const utils = require("../utils/index.js");
const pools = require("../utils/pools.js");
const xlsx = require('node-xlsx');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const csv = require('csv-parser');
const iconvlite = require('iconv-lite'); // 用于处理文件编码


//添加文件
router.post("/addFile", async (req, res) => {
    // console.log("req = ", req.body)
    let sql = "INSERT INTO files(val,type) VALUES (?,?)",
        obj = req.body;
    // console.log("see hereee",obj.val)
    
    await pools({ sql, val: [obj.val, obj.type], run: false, res, req });
    //执行完await后执行下面的代码
    
});


// 生成建表SQL的辅助函数
function makeCreateTableSql(tableName, fields) {
    const columns = fields.map(f => `\`${f}\` VARCHAR(255)`).join(",\n  ");
    // 可选加自增id主键：
    // const columns = ['`id` INT AUTO_INCREMENT PRIMARY KEY'].concat(fields.map(f => `\`${f}\` VARCHAR(255)`)).join(",\n  ");
    return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (
  ${columns}
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
}

// 解析 CSV 文件
function parseCSV(filePath, idxobj) {
    return new Promise((resolve, reject) => {
        const results = [];
        // 使用 iconv-lite 转换文件编码
        fs.createReadStream(filePath)
            .pipe(iconvlite.decodeStream('gbk')) // 如果文件是GBK编码，转换为UTF-8
            .pipe(csv())
            .on('data', (row) => {
                results.push(row);
            })
            .on('end', () => {
                // 提取表头
                const headers = Object.keys(results[0]);
                // 处理数据行
                const data = [];
                for (let i = 0; i < results.length; i++) {
                    const rowData = results[i];
                    const rowValues = Object.values(rowData);
                    data.push(rowValues);
                }
                resolve(data);
            })
            .on('error', (error) => {
                reject(error);
            });
    });
}

// 解析 Excel 文件（使用 node-xlsx 而不是 XLSX）
function parseExcel(filePath, idxobj) {
    return new Promise((resolve, reject) => {
        try {
            // node-xlsx 返回 [{ name, data: [ [col1,col2,...], [val1,val2,...], ... ] }]
            const sheets = xlsx.parse(filePath);  
            if (!sheets.length) return resolve([]);
            
            const sheet = sheets[0];
            const allData = sheet.data || [];

            if (allData.length === 0) return resolve([]);

            // 第一行是表头
            const headers = allData[0];
            const rows = allData.slice(1);

            // 根据 idxobj 的列顺序提取每行数据
            const data = rows.map(row => {
                return idxobj.map(col => {
                    const idx = headers.indexOf(col);
                    if (idx === -1) return null;
                    const value = row[idx];
                    return (value === undefined || value === '') ? null : value;
                });
            });

            resolve(data);
        } catch (error) {
            reject(error);
        }
    });
}

// 添加文件数据接口
router.post("/addFiledata", async (req, res) => {
    let sql = "INSERT INTO files(val,type) VALUES (?,?)",
        obj = req.body;
    
    // console.log("obj.type = ", obj.type)
    if (obj.type == 2) {
        //将文件中的数据按行上传到数据库table表
        let valObj = JSON.parse(obj.val);
        let filename = valObj[0].filename;
        let idx = valObj[0].inputValues;
        console.log("idx = ", idx);
        let idxobj = [];
        for(let i = 0; i < idx.length; i++) {
            if(idx[i][0] == "date")
                idxobj.push(idx[i][1]);
            else
                idxobj.push(idx[i][0]);
        }
        // console.log("idxobj = ", idxobj)
        // console.log("filename = ", filename)

        // 取文件名不带扩展名作为表名
        let tableName = require('path').parse(filename).name.split('-').pop();
        console.log("tableName = ", tableName)

        // 获取文件路径
        let filePath = path.join(__dirname, '../public', filename);
        console.log("show me =", filePath)
        if (!fs.existsSync(filePath)) {
            console.log('文件不存在');
            res.status(404).send('文件不存在');
            return;
        }

        // 判断文件类型
        const fileExtension = path.extname(filename).toLowerCase();
        let data;
        if (fileExtension === '.csv') {
            data = await parseCSV(filePath, idxobj);
            // console.log("idxobj = ", idxobj);
            // console.log("data = ", data);
        } else if (fileExtension === '.xls' || fileExtension === '.xlsx') {
            data = await parseExcel(filePath, idxobj);
        } else {
            console.log('不支持的文件类型');
            res.status(400).send('不支持的文件类型');
            return;
        }

        // 动态建表（之后需要处理是否可以同时创建表格然后导入数据，目前只能个别注释处理，或许跟utils/pool.js的设计有关）
        // const createSql = makeCreateTableSql(tableName, idxobj);
        // await pools({ sql: createSql, run: false, res, req });
        // console.log("hello");

        // 构造插入语句
        const insertSql = `INSERT INTO \`${tableName}\` (${idxobj.map(k => `\`${k}\``).join(',')}) VALUES `;
        let values = [];
        for (let i = 0; i < data.length; i++) {
            const rowValues = data[i];
            values.push(`(${rowValues.map(value => value !== null ? `'${value}'` : 'NULL').join(',')})`);
            // 每 1000 行执行一次插入操作
            if ((i + 1) % 1000 === 0) {
                const batchInsertSql = insertSql + values.join(',');
                await pools({ sql: batchInsertSql, run: false, res, req });
                values = [];
            }
        }
        // 插入剩余数据
        if (values.length > 0) {
            const finalInsertSql = insertSql + values.join(',');
            await pools({ sql: finalInsertSql, run: false, res, req });
        }
        res.send({ code: 0, msg: '上传并写入数据库成功' });
    }
});

//查询图片
router.post("/getImg", async (req, res) => {
    let sql = `SELECT id,val,update_time AS updateTime,create_time AS createTime FROM files WHERE type=1`, obj = req.body;
    let { total } = await utils.getSum({ sql, name: "files", res, req });
    sql += ` ORDER BY id DESC`;
    sql = utils.pageSize(sql, obj.page, obj.size);
    let { result } = await pools({ sql, res, req });
    res.send(utils.returnData({ data: result, total }));
});

//查询文件
router.post("/getFile", async (req, res) => {
    let sql = `SELECT id,val,update_time AS updateTime,create_time AS createTime FROM files WHERE type=2`, obj = req.body;
    let { total } = await utils.getSum({ sql, name: "files", res, req });
    sql += ` ORDER BY id DESC`;
    sql = utils.pageSize(sql, obj.page, obj.size);
    let { result } = await pools({ sql, res, req });
    res.send(utils.returnData({ data: result, total }));
});

//修改文件
router.post("/upFile", async (req, res) => {
    let sql = "UPDATE  files SET val=? WHERE id=?",
        obj = req.body;
    await pools({ sql, val: [obj.val, obj.id], run: false, res, req });
});

//删除文件
router.post("/delFile", async (req, res) => {
    let sql = "DELETE FROM files WHERE id=?",
        obj = req.body;
    await pools({ sql, val: [obj.id], run: false, res, req });
});

//添加富文本
router.post("/addDitor", async (req, res) => {
    let sql = "INSERT INTO ditor(val) VALUES (?)",
        obj = req.body;
    await pools({ sql, val: [obj.val], run: false, res, req });
});

//查询富文本
router.post("/getDitor", async (req, res) => {
    let sql = `SELECT id,val,update_time AS updateTime,create_time AS createTime FROM ditor WHERE 1=1`, obj = req.body;
    let { total } = await utils.getSum({ sql, name: "ditor", res, req });
    sql += ` ORDER BY id DESC`;
    sql = utils.pageSize(sql, obj.page, obj.size);
    let { result } = await pools({ sql, res, req });
    res.send(utils.returnData({ data: result, total }));
});

//修改富文本
router.post("/upDitor", async (req, res) => {
    let sql = "UPDATE  ditor SET val=? WHERE id=?",
        obj = req.body;
    await pools({ sql, val: [obj.val, obj.id], run: false, res, req });
});

//删除富文本
router.post("/delDitor", async (req, res) => {
    let sql = "DELETE FROM ditor WHERE id=?",
        obj = req.body;
    await pools({ sql, val: [obj.id], run: false, res, req });
});

//添加环境因子
router.post("/addCondition", async (req, res) => {
    let sql = "INSERT INTO conditions(val,type) VALUES (?,?)",
        obj = req.body;
        let valObj = JSON.parse(obj.val);
        
    await pools({ sql, val: [obj.val, valObj[0].type], run: false, res, req });
});

//查询环境因子
router.post("/getCondition", async (req, res) => {
    let sql = `SELECT * FROM conditions WHERE type=?`, obj = req.body;
    // let { total } = await utils.getSum({ sql,name: "conditions", res, req });
    sql += ` ORDER BY id DESC`;
    sql = utils.pageSize(sql, obj.page, obj.size);
    let { result } = await pools({ sql,val:[obj.type], res, req });
    total = result.length
    res.send(utils.returnData({ data: result, total }));
});

//删除环境因子
router.post("/delCondition", async (req, res) => {
    let sql = "DELETE FROM conditions WHERE id=?",
        obj = req.body;
    await pools({ sql, val: [obj.id], run: false, res, req });
});

// 获取天气信息
router.post("/weatherInfo", async (req, res) => {
    
    try {
        // console.log(req);
        const { lat, lng, date } = req.body.data; // 从查询参数获取经纬度和日期
        console.log(lat, lng, date);
        if (!lat || !lng || !date) {
            return res.send(utils.returnData({ code: -1, msg: "缺少必要的参数！", req }));
        }
        let sql = "SELECT * FROM qixiang_data WHERE year_month_day=? AND latitude=? AND longitude=?";
        let { result } = await pools({ sql, val: [date, lat, lng], res, req });
        console.log(result);
        res.send(utils.returnData({ data: result }));
    } catch (error) {
        res.send(({code: -1, msg: "获取天气信息失败", req}));
    }
});

module.exports = router;
