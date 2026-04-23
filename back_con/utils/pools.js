const pool = require('../pool.js');
const utils = require("./index.js");
 
/**
 * @param sql    SQL 语句
 * @param val    参数值数组
 * @param msg    错误提示语
 * @param run    true=直接返回结果对象，false=通过 res.send 返回给前端
 * @param res    响应主体（run=false 时必传）
 * @param req    请求主体（用于错误日志）
 */
module.exports = async function pools({ sql, val = [], msg, run = true, res, req } = {}) {
    try {
        const [result] = await pool.query(sql, val);
        if (run) return { result };
        return res.send(utils.returnData({ data: result }));
    } catch (err) {
        // run=true 时 res 未传入，直接抛出让调用方处理
        if (run) throw err;
        return res.send(utils.returnData({ code: -1, msg, err, req }));
    }
}
 