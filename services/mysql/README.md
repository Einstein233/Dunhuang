# MySQL 数据库服务

## 环境信息

| 项目 | 值 |
|------|-----|
| 镜像 | `mysql:8.0` |
| 容器名 | `dunhuang-mysql-prod` |
| 端口 | `3308:3306` |
| 用户 | `root` / `root` |
| 数据库 | `dunhuang_agent` |
| 字符集 | `utf8mb4` |
| 数据卷 | `dh_mysql_data` |

---

## 一、数据导入流程

### 数据文件

数据库初始化依赖 `init/` 目录下的两个 SQL 文件：

| 文件 | 大小 | 内容 |
|------|------|------|
| `vue_admin_custom.sql` | 55 KB | 11 张系统管理表（结构 + 数据） |
| `weather_data.sql` | 25 MB | 3 张气候业务表（结构 + 数据） |

### 自动导入（推荐）

MySQL 容器首次启动时，Docker 会自动执行 `/docker-entrypoint-initdb.d/` 下的 `.sql` 文件。`docker-compose.yml` 已将 `init/` 目录挂载到该路径：

```yaml
# services/docker-compose.yml 关键配置
volumes:
  - dh_mysql_data:/var/lib/mysql          # 持久化数据
  - ./mysql/init:/docker-entrypoint-initdb.d:ro  # 自动导入 SQL
```

### 部署命令

```bash
# 1. 进入 services 目录
cd services

# 2. 启动所有服务（首次启动会自动导入 SQL）
docker compose up -d

# 3. 查看 MySQL 是否就绪
docker logs -f dunhuang-mysql-prod
```

### 手动重新导入

如果数据库已有数据，需要强制重建：

```bash
# 停止并删除容器和卷（数据会丢失）
docker compose down -v

# 重新启动（自动导入 SQL）
docker compose up -d
```

### 仅重新导入管理表（保留气象数据）

```bash
# 将 SQL 文件复制到容器内执行
docker cp services/mysql/init/vue_admin_custom.sql dunhuang-mysql-prod:/tmp/
docker exec dunhuang-mysql-prod mysql -uroot -proot --default-character-set=utf8mb4 dunhuang_agent -e "SOURCE /tmp/vue_admin_custom.sql"
```

### 验证导入结果

```bash
# 查看所有表及行数
docker exec dunhuang-mysql-prod mysql -uroot -proot --default-character-set=utf8mb4 -e "
  USE dunhuang_agent;
  SELECT TABLE_NAME, TABLE_ROWS
  FROM information_schema.TABLES
  WHERE TABLE_SCHEMA='dunhuang_agent'
  ORDER BY TABLE_NAME;
"
```

预期结果：14 张表，`weather_data` ~15,004,296 行，`station_info` 395 行，`weather_directory` 339 行。

---

## 二、数据表介绍

### 系统管理表（11 张）

基于 Vue-Admin 框架，负责后台管理系统的用户、角色、菜单权限控制。

#### 用户与权限

| 表名 | 行数 | 说明 |
|------|------|------|
| `user` | 3 | 用户账号。admin（管理员）/ 用户1（初级管家）/ 用户2（中级管家） |
| `roles` | 3 | 角色定义。admin / 初级管家 / 中级管家，含权限标识集合 |
| `router_menu` | 37 | 菜单路由树。前后端共同使用，控制侧边栏菜单和接口权限 |
| `theme` | 3 | 用户侧边栏主题配色（背景色、文字色、hover 色） |

**默认账号**：admin / 666666

#### 菜单结构

```
系统设置
├── 菜单管理
├── 角色管理
├── 用户管理
├── 多账号管理
├── 字典管理（隐藏）
│   └── 字典项目
└── 我的信息
智能导入      → components/aiUpload
智能查询      → components/llm
数据导出      → components/generalDownload
```

#### 辅助管理表

| 表名 | 行数 | 说明 |
|------|------|------|
| `dict` | 2 | 字典类型（如"type1""type2"） |
| `dict_item` | 0 | 字典条目，通过 `dict_id` 关联字典类型 |
| `more` | 2 | 多账号/多店铺管理 |
| `ditor` | 1 | 富文本编辑内容 |
| `files` | 54 | 文件上传记录（图片/文件路径） |
| `tests` | 20 | 测试数据 |
| `conditions` | 0 | 实验舱工况参数，等待配置 |

---

### 气候业务表（3 张）

#### `station_info` — 气象站点信息

| 字段 | 类型 | 说明 |
|------|------|------|
| `station_code` | varchar(50) | 站点编码（主键），如 `ST000002` |
| `province` | varchar(50) | 省份 |
| `city` | varchar(50) | 城市 |
| `latitude` | decimal(10,8) | 纬度 |
| `longitude` | decimal(11,8) | 经度 |
| `granularity` | tinyint | 采集颗粒度（2=小时） |

**数据量**：395 行，覆盖全国所有省市 + 港澳台。其中 339 个站点有气象数据，56 个站点暂无数据（重庆区县、海南区县、台湾、香港、澳门）。

#### `weather_directory` — 数据目录索引

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | int | 主键 |
| `province` | varchar(50) | 省份 |
| `city` | varchar(50) | 城市 |
| `station_code` | varchar(50) | 站点编码 |
| `granularity` | tinyint | 颗粒度（2=小时） |
| `start_time` | datetime | 数据起始时间 |
| `end_time` | datetime | 数据结束时间 |
| `total_count` | int | 数据总条数 |

**数据量**：339 行 —— 天津(2014-2026, 107,976条)、北京(2020-2026, 55,416条)、敦煌(2014-2026, 107,976条) 以及全国 336 个城市（2020-2024, 每城 43,848条）。

作用：在查询数据前快速判断一个站点有哪些时间段的数据可用。

#### `weather_data` — 气象观测数据（核心表）

| 字段 | 类型 | 说明 |
|------|------|------|
| `station_code` | varchar(50) | 站点编码（联合主键） |
| `granularity` | tinyint | 颗粒度（联合主键，2=小时） |
| `record_time` | datetime | 观测时间（联合主键） |
| `avg_temperature` | decimal(7,2) | 平均气温（℃） |
| `relativehumidity_2m` | int | 2米相对湿度（%） |
| `rain_sum` | decimal(8,2) | 降雨量（mm） |
| `snow_sum` | decimal(8,2) | 降雪量（mm） |
| `max_continuous_wind_speed` | decimal(6,2) | 最大持续风速（m/s） |
| `shortwave_radiation_sum` | decimal(8,2) | 短波辐射累计（MJ/m²） |

**数据量**：15,004,296 行，覆盖 339 个城市的逐小时数据。

| 数据来源 | 站点数 | 时间范围 | 每站行数 | 说明 |
|----------|--------|----------|----------|------|
| Open-Meteo 历史 API | 336 个城市 | 2020-01-01 ~ 2024-12-31 | 43,848 | 全国城市级小时数据（通过 `import_openmeteo_batch.js` 导入） |
| Open-Meteo 历史 API | 天津(ST000002) | 2014-01-01 ~ 2026-04-26 | 107,976 | 原始历史数据 |
| Open-Meteo 历史 API | 敦煌(ST000004) | 2014-01-01 ~ 2026-04-26 | 107,976 | 原始历史数据 |
| Open-Meteo 历史 API | 北京(ST000003) | 2020-01-01 ~ 2026-04-27 | 55,416 | 历史 + 近期更新 |

**注意**：数据来源于 Open-Meteo 的 ERA5 再分析数据，非实际气象站观测值，适用于趋势分析。

---

### 表关系图

```
station_info (站点元数据)
    │ station_code
    ├──> weather_directory (数据目录)
    │       │ station_code + granularity
    │       └──> weather_data (逐小时观测)
    │
    └──> 系统管理表 (user / roles / router_menu ...)
          （通过 back_con 应用层关联，无外键约束）
```

---

## 三、数据导入工具

### 批量导入 Open-Meteo 数据

```bash
# 一键导入（自动定位 weather_data/output_weather/output_weather/ 目录）
node services/mysql/scripts/import_openmeteo_batch.js

# 预览模式（不写入数据库，仅检查文件映射）
node services/mysql/scripts/import_openmeteo_batch.js --dry-run

# 测试导入前 N 个文件
node services/mysql/scripts/import_openmeteo_batch.js --limit 5

# 自定义数据目录
node services/mysql/scripts/import_openmeteo_batch.js /path/to/csv/folder
```

**脚本功能**：
- 自动解析 CSV 中的省市名和经纬度
- 省市名标准化（"甘肃省"→"甘肃"、"上海市"→"上海"）
- 自动匹配或创建 station_code（站点编码）
- 降雪量单位转换（cm → mm）
- 批量写入 + 目录索引同步
- 幂等操作（重复运行自动覆盖，不会重复）

### 单文件导入

```bash
node services/mysql/scripts/import_weather_observation_hourly.js <csvPath> <regionName> \
  --province <province> --city <city> --latitude <lat> --longitude <lon>
```
