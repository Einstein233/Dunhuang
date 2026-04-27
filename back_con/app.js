const express = require("express");
const bodyparser = require("body-parser");
const cors = require("cors");
const utils = require("./utils/index.js");
const { errLog } = require("./utils/err");

const adminRouter = require("./router/system/admin.js");
const fileRouter = require("./router/system/file.js");
const testsRouter = require("./router/tests.js");
const componentsRouter = require("./router/components.js");
const weatherRouter = require("./router/weather.js");
const experimentRouter = require("./router/experiment.js");
const autoscrapRouter = require("./router/autoscrap.js");

const server = express();
server.listen(3000);

server.use(cors({ origin: "*" }));
server.use(express.static("./public"));
server.use(bodyparser.json());
server.use(bodyparser.urlencoded({ extended: false, limit: "50mb", parameterLimit: 50000 }));

server.use(async function (req, res, next) {
  if (req.headers.token) {
    const user = await utils.getUserInfo({ req, res });
    if (user.status === 0) {
      return res.send(utils.returnData({ code: 203, msg: "你的账号已被禁用，请联系管理员！！", req }));
    }
  }
  next();
});

process
  .on("unhandledRejection", (err) => {
    errLog({ err, code: 500, msg: "后端系统错误！", funName: "fatal" });
  })
  .on("uncaughtException", (err) => {
    errLog({ err, code: 500, msg: "后端系统错误！！", funName: "fatal" });
  });

server.use("/admin", adminRouter);
server.use("/file", fileRouter);
server.use("/tests", testsRouter);
server.use("/components", componentsRouter);
server.use("/weather", weatherRouter);
server.use("/experiment", experimentRouter);
server.use("/autoscrap", autoscrapRouter);

console.log("后端接口启动成功");
