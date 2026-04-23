
const express = require("express");
const router = express.Router();
const path = require("path");
const utils = require("../../utils/index.js");
const { fileEvent, getFileList, downloadFile } = require('../../utils/file');

router.post('/file',async(req,res,next)=>{
    await utils.getUserInfo({req,res});
    let result=await fileEvent(req,res);
    res.send(utils.returnData({data:result}))
});

// 不要求认证的文件列表接口
router.get('/files/public/list', async (req, res) => {
    try {
        const dirPath = 'E:/app/mysql/Uploads/';
        console.log("dirPath", dirPath);
        const files = await getFileList(dirPath);
        res.send(utils.returnData({data: files}));
    } catch (err) {
        res.send(utils.returnData({code: -1, msg: '获取文件列表失败', error: err.message}));
    }
});

// 不要求认证的文件下载接口
router.get('/files/public/download', async (req, res) => {
    try {
        const { filepath } = req.query;
        if (!filepath) {
            return res.send(utils.returnData({code: -1, msg: '缺少文件路径参数'}));
        }
        await downloadFile(filepath, res);
    } catch (err) {
        res.send(utils.returnData({code: -1, msg: '文件下载失败', error: err.message}));
    }
});

module.exports = router;
