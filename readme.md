# 敦煌项目 DH_web

这是一个包含多个子服务的项目，仓库根目录提供了一键启动脚本。  
同学从 GitHub 下载后，建议优先按照下面的步骤运行。

## 1. 项目包含哪些服务

- `WeatherVisualization`：可视化前端，默认开发地址为 `http://127.0.0.1:5173`
- `front_con`：后台管理前端，默认开发地址为 `http://127.0.0.1:8080`
- `back_con`：后端 API，默认地址为 `http://127.0.0.1:3000`
- `sql-agent`：基于 Docker 启动的 MySQL + Agent 服务
  - Agent UI / API: `http://127.0.0.1:3001`
  - MySQL: `127.0.0.1:3308`

## 2. 运行前需要准备的环境

请先安装下面这些软件：

1. `Node.js`
建议使用 `18.x` 或更高版本。

2. `npm`
安装 Node.js 后通常会自带。

3. `Docker Desktop`
这个项目的一键启动依赖 Docker 来启动 `sql-agent` 和 MySQL。

4. 可选：`conda`
如果你后续还要运行仓库中的 Python 脚本，可以准备 `conda` 环境；  
但仅启动当前 Web 系统时，不是必须项。

## 3. 第一次下载后的安装步骤

在项目根目录 `DH_web` 下，按顺序执行：

```bash
npm install
cd WeatherVisualization && npm install
cd ../front_con && npm install
cd ../back_con && npm install
cd ../sql-agent && npm install
cd ..
```

如果你已经看到了仓库里有 `package-lock.json`，就直接使用 `npm install` 即可，不需要换成 yarn 或 pnpm。

## 4. 一键启动方式

确保 Docker Desktop 已经打开，然后在项目根目录执行：

```bash
npm start
```

或者：

```bash
node start-all.js
```

这条命令会自动做两件事：

1. 先进入 `sql-agent`，执行 Docker Compose，启动 MySQL 和 agent 服务
2. 再分别启动：
   - `WeatherVisualization`
   - `front_con`
   - `back_con`

## 5. 启动成功后可访问的地址

- 可视化前端：`http://127.0.0.1:5173`
- 后台管理前端：`http://127.0.0.1:8080`
- 后端接口：`http://127.0.0.1:3000`
- Agent 服务：`http://127.0.0.1:3001`
- MySQL：`127.0.0.1:3308`

说明：

- `front_con/.env.development` 当前配置的后端地址是 `http://127.0.0.1:3000`
- `back_con/pool.js` 当前配置的数据库是：
  - host: `127.0.0.1`
  - port: `3308`
  - user: `root`
  - password: `root`
  - database: `dunhuang_agent`

## 6. 停止系统

如果你是通过一键启动命令运行的，直接在当前终端按：

```bash
Ctrl + C
```

脚本会尝试同时关闭 Node 服务，并执行 Docker Compose down。

## 7. 如果一键启动失败，可以手动分别启动

### 7.1 启动 sql-agent

先确保 Docker Desktop 已打开，再执行：

```bash
cd sql-agent
docker compose up -d --build
cd ..
```

### 7.2 启动后端

```bash
cd back_con
npm run dev
```

### 7.3 启动后台前端

```bash
cd front_con
npm run dev
```

### 7.4 启动可视化前端

```bash
cd WeatherVisualization
npm run dev
```

## 8. 常见问题

### 1）报错 `docker` 命令不存在

说明电脑没有安装 Docker Desktop，或者 Docker 没有启动。  
先安装并打开 Docker Desktop，再重新执行 `npm start`。

### 2）报错端口被占用

当前项目会用到这些端口：

- `3000`
- `3001`
- `3308`
- `5173`
- `8080`

如果端口被其他程序占用，请先关闭对应程序。

### 3）前端能打开，但接口请求失败

优先检查两件事：

1. `back_con` 是否已经成功启动
2. `sql-agent` 的 Docker 容器是否正常运行

### 4）数据库连接失败

当前后端写死连接：

- host: `127.0.0.1`
- port: `3308`
- user: `root`
- password: `root`
- database: `dunhuang_agent`

如果同学本机环境和这里不一致，就需要修改 [back_con/pool.js](/C:/Users/wangxiaozheng/Documents/敦煌项目/DH_web/back_con/pool.js:1)。

## 9. 推荐给同学的最简操作流程

如果只是想把项目跑起来，直接照下面做：

```bash
git clone <你的仓库地址>
cd DH_web
npm install
cd WeatherVisualization && npm install
cd ../front_con && npm install
cd ../back_con && npm install
cd ../sql-agent && npm install
cd ..
npm start
```

## 10. 仓库说明

为了避免把本地依赖、日志、运行产物和备份文件上传到 GitHub，根目录已经补充了适合当前项目结构的 `.gitignore`。
