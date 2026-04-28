# Services 目录说明

`services/` 用来集中管理项目中独立运行的三类服务：

- `mysql`：数据库初始化 SQL、历史 SQL 归档、数据导入维护脚本
- `sql-agent`：SQL 智能体服务
- `equivalence-service`：等效计算服务

## 整体启动

在仓库根目录执行：

```bash
docker compose -f services/docker-compose.yml up -d --build
```

或者直接使用根目录的：

```bash
npm start
```

## 单独启动

只启动 MySQL：

```bash
docker compose -f services/mysql/docker-compose.yml up -d
```

只启动等效服务：

```bash
docker compose -f services/equivalence-service/docker-compose.yml up -d --build
```

只启动 SQL Agent：

```bash
docker compose -f services/sql-agent/docker-compose.yaml up -d --build
```

说明：`sql-agent` 依赖数据库，所以通常先启动 MySQL，再单独启动 `sql-agent`。
