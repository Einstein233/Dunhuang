# CSEE-Gen 使用文档

## 目录结构

```
等效方案/
├── main.py              # 主程序入口（运行这个）
├── core/                # 核心模块目录
│   ├── __init__.py      # 包初始化
│   ├── config.py        # 配置模块（所有超参数）
│   ├── data_loader.py   # 数据读取模块
│   ├── experiment_mapper.py  # 实验方案映射模块
│   ├── output_formatter.py   # 硬件 CSV 输出格式器
│   └── utils.py         # 工具函数
├── data/                # 数据目录
│   └── processed_weather_data.csv
├── output/              # 输出目录
├── service/             # FastAPI 接口服务
│   └── app.py
├── Dockerfile           # Docker 镜像构建文件
├── docker-compose.yml   # Docker 编排
└── legacy/              # 旧版本代码（可删除）
```

## 快速开始

### 运行程序

```bash
cd 等效方案
python main.py
```

运行后会生成两种输出：
- `experiment_plan.json`: JSON 格式实验方案
- `hardware_plan.csv`: 硬件可执行的 CSV 文件

### 命令行参数

```bash
# 默认运行
python main.py

# 指定天数和文件
python main.py --days 20 --input data/data.csv --output plan.json
```

### Python 代码调用

```python
from core import ExperimentPlanGenerator, ExperimentPlanFormatter

# 1. 生成实验方案
generator = ExperimentPlanGenerator("data/data.csv", target_days=10)
plan = generator.generate()

# 2. 转换为硬件可执行的 CSV
formatter = ExperimentPlanFormatter()
formatter.to_csv(formatter.format(plan), "hardware_plan.csv")
```

## Docker 接口服务

### 启动服务

```bash
cd 等效方案
docker compose up --build -d
```

服务地址：`http://localhost:8000`

### 健康检查

```bash
curl http://localhost:8000/health
```

### 核心接口

`POST /api/v1/equivalence/run`

- `experiment_type` 可选值：
1. `降雨-日照耦合实验`（或 `rain_solar`）
2. `降雪-冻融耦合实验`（或 `snow_freeze_thaw`）
- 输入支持：
1. `weather_data`（数组，推荐前端直接传）
2. `csv_path`（服务端本地 CSV 路径）

请求示例（`weather_data` 模式）：

```json
{
  "experiment_type": "降雨-日照耦合实验",
  "target_days": 10,
  "return_hardware_steps": true,
  "weather_data": [
    {
      "year_month_day": "2024-01-01",
      "avg_temperature": -5.6,
      "rain_sum": 0.0,
      "snow_sum": 0.0,
      "max_continuous_wind_speed": 2.05,
      "shortwave_radiation_sum": 0.0
    }
  ]
}
```

返回结构：

```json
{
  "code": 0,
  "msg": "ok",
  "experiment_type": "rain_solar",
  "experiment_type_label": "降雨-日照耦合实验",
  "target_days": 10.0,
  "input_source": "weather_data",
  "result": {
    "plan": {},
    "hardware_steps": []
  }
}
```

## 配置参数

所有可配置参数在 `core/config.py` 中定义：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `NO_RAIN_THRESHOLD_HOURS` | 3.0 | 无雨界限时间（小时） |
| `SOLAR_DURATION_HOURS` | 12.0 | 日照阶段时长（小时） |
| `DRY_DURATION_HOURS` | 12.0 | 干燥阶段时长（小时） |
| `PULSE_RAIN_MAX_DURATION_MIN` | 30.0 | 单次降雨最大时长（分钟） |
| `RAIN_INTENSITY_GEARS` | [20, 40, 60] | 降雨强度档位 (mm/h) |
| `MAX_SOLAR_INTENSITY` | 1000 | 最大日照强度 (W/m²) |
| `DAYTIME_START_HOUR` | 8 | 白天开始时间 |
| `DAYTIME_END_HOUR` | 20 | 白天结束时间 |

## 输出说明

系统生成两种输出文件：

### 1. JSON 格式实验方案 (`experiment_plan.json`)

包含：
1. **experiment_meta**: 元数据（目标天数、循环数、总降雨量等）
2. **sequence**: 实验步骤序列
3. **source_info**: 源数据信息（包含气候统计）

### 2. 硬件 CSV 格式 (`hardware_plan.csv`)

可直接导入硬件系统执行的 CSV 文件，包含所有舱体的控制参数。

#### CSV 字段说明

| 字段 | 说明 |
|------|------|
| 步骤编号 | 步骤序号 |
| 工作状态（ON/OFF） | 设备工作状态 |
| 运行时间（min） | 该步骤持续时间 |
| 起始温度/终点温度（℃） | 温度控制 |
| 日照控制标志/强度 | 夏季舱日照控制 |
| 降雨控制标志/强度 | 风雨舱降雨控制 |
| 风速控制标志/强度 | 风雨舱风速控制 |

#### 映射规则

| 实验模式 | 舱体 | 温度 | 降雨 | 风速 | 日照 |
|----------|------|------|------|------|------|
| Rain | 风雨舱 | target_temp | ON | ON | OFF |
| Rain_Pause | 风雨舱 | target_temp | OFF | ON | OFF |
| Solar | 夏季舱 | target_temp | OFF | OFF | ON |
| Dry_Baseline | 风雨舱 | target_temp | OFF | OFF | OFF |
