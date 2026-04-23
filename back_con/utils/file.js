const multer = require('multer');
const fs = require('fs');
const path = require('path');
const config = require("./config.js");
const utils = require("./index");
//上传的文件保存在 upload
const storage = multer.diskStorage({
    //存储的位置
    destination(req, file, cb){
        cb(null, config.fileSite);
    },
    //文件名字的确定 multer默认帮我们取一个没有扩展名的文件名，因此需要我们自己定义
    filename(req, file, cb){
        let math=Math.random();
        math=math.toString().replace(".","");//随机字符串
        cb(null, `${Date.now()}${math}-${file.originalname}`)
    }
});
//传入storage 除了这个参数我们还可以传入dest等参数
let upload = multer({
    storage
}).array(config.fileName);
//上传总函数
let fileEvent=(req,res)=>{
    return new Promise((resolve,reject)=>{
        upload(req, res, function (err) {
            if (err) return res.send(utils.returnData({code:-1,msg:"上传文件错误~",req,err}));
            try{
                //循环处理
                let imgPath=[];
                req.files.forEach(function (i) {
                    const regex = /^(.+)\.[^.]+$/;
                    const regexRes = i.originalname.match(regex);
                    let name="";
                    if (regexRes) name=regexRes[1];
                    //获取临时文件的存储路径
                    imgPath.push({url:`${config.fileHost}/${i.filename}`,name,originalname:i.originalname,filename:i.filename});
                    // console.log("i.path:",i.path)
                });
                resolve(imgPath)
            }catch(err){
                res.send(utils.returnData({code:-1,msg:"上传文件错误~",req,err}));
            }
        });
    });
};

// 获取文件列表
const getFileList = (dirPath) => {
    return new Promise((resolve, reject) => {
        fs.readdir(dirPath, (err, files) => {
            if(err) return reject(err);
            const fileList = files
                .filter(file => !file.startsWith('.') && file.toLowerCase() !== 'desktop.ini')
                .map(file => {
                    const filePath = path.join(dirPath, file);
                    const stats = fs.statSync(filePath);
                    return {
                        name: file,
                        path: filePath,
                        size: stats.size,
                        mtime: stats.mtime,
                        isDirectory: stats.isDirectory()
                    };
                });
            resolve(fileList);
        });
    });
};

// 下载文件
const downloadFile = (filePath, res) => {
    return new Promise((resolve, reject) => {
        // 处理可能包含相对路径的情况
        const absolutePath = path.isAbsolute(filePath) 
            ? filePath 
            : path.join(__dirname, '../../public/', filePath);
            
        if(!fs.existsSync(absolutePath)) {
            return reject(new Error(`文件不存在: ${absolutePath}`));
        }
        res.download(absolutePath, path.basename(absolutePath), (err) => {
            if(err) reject(err);
            else resolve();
        });
    });
};

module.exports = {
    fileEvent,
    getFileList,
    downloadFile
};
