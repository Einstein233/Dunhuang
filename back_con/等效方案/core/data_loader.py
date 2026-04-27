"""
数据读取与准备模块

负责从 CSV 文件加载天气数据，并提供标准化的数据访问接口。
包含以下功能：
- 天气数据记录定义
- 天气数据集合管理
- 数据加载器
- 温度/风速统计计算
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict
from pathlib import Path
import csv

# 兼容模块导入和直接运行
try:
    from .utils import calculate_mean, calculate_median
    from .config import ExperimentConfig
except ImportError:
    from utils import calculate_mean, calculate_median
    from config import ExperimentConfig


# =============================================================================
# 数据类定义
# =============================================================================

@dataclass
class WeatherRecord:
    """
    单条天气数据记录

    Attributes:
        time: 时间戳
        temperature_2m: 2 米气温 (°C)
        relative_humidity: 2 米相对湿度 (%)
        rain: 降雨量 (mm)
        snowfall: 降雪量 (mm)
        shortwave_radiation: 短波辐射 (W/m²)
        wind_speed: 10 米风速 (m/s)
    """
    time: datetime
    temperature_2m: float
    relative_humidity: float
    rain: float
    snowfall: float
    shortwave_radiation: float
    wind_speed: float

    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            'time': self.time.isoformat(),
            'temperature_2m': self.temperature_2m,
            'relative_humidity': self.relative_humidity,
            'rain': self.rain,
            'snowfall': self.snowfall,
            'shortwave_radiation': self.shortwave_radiation,
            'wind_speed': self.wind_speed
        }


@dataclass
class WeatherDataset:
    """
    天气数据集合

    包含一段时间内的所有天气记录，并提供查询接口

    Attributes:
        records: 天气记录列表
        time_index: 时间索引字典
        start_time: 数据开始时间
        end_time: 数据结束时间
    """
    records: List[WeatherRecord] = field(default_factory=list)
    time_index: Dict[datetime, WeatherRecord] = field(default_factory=dict)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    def __post_init__(self):
        """初始化后构建索引"""
        self._build_index()

    def _build_index(self):
        """构建时间索引"""
        if self.records:
            self.time_index = {r.time: r for r in self.records}
            self.start_time = min(r.time for r in self.records)
            self.end_time = max(r.time for r in self.records)

    def get_by_time(self, time: datetime) -> Optional[WeatherRecord]:
        """根据精确时间点获取数据"""
        return self.time_index.get(time)

    def get_by_time_range(
        self,
        start: datetime,
        end: Optional[datetime] = None
    ) -> List[WeatherRecord]:
        """根据时间范围获取数据"""
        if end is None:
            end = self.end_time
        return [r for r in self.records if start <= r.time <= end]

    def get_all(self) -> List[WeatherRecord]:
        """获取所有数据"""
        return self.records

    def __len__(self) -> int:
        return len(self.records)

    def __iter__(self):
        return iter(self.records)


@dataclass
class ClimateStatistics:
    """
    气候统计数据

    从原始天气数据中提取的统计信息，用于实验参数设置

    Attributes:
        rain_temp_median: 降雨小时内温度中位数 (°C)
        daytime_temp_median: 白天 (8-20 点) 温度中位数 (°C)
        overall_temp_median: 全时段温度中位数 (°C)
        overall_wind_avg: 全时段平均风速 (m/s)
    """
    rain_temp_median: float = 20.0
    daytime_temp_median: float = 20.0
    overall_temp_median: float = 20.0
    overall_wind_avg: float = 0.0


# =============================================================================
# 数据加载器
# =============================================================================

class WeatherDataLoader:
    """
    天气数据加载器

    从 CSV 文件加载天气数据

    Args:
        csv_path: CSV 文件路径
        config: 实验配置（可选）
    """

    def __init__(self, csv_path: str, config: Optional[ExperimentConfig] = None):
        self.csv_path = Path(csv_path)
        self.config = config or ExperimentConfig()

        if not self.csv_path.exists():
            raise FileNotFoundError(f"CSV 文件不存在：{csv_path}")

    def load(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> WeatherDataset:
        """
        从 CSV 文件加载天气数据

        Args:
            start_time: 可选的起始时间过滤
            end_time: 可选的结束时间过滤

        Returns:
            WeatherDataset 对象
        """
        records = []

        with open(self.csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                time = datetime.fromisoformat(row['time'])

                # 时间范围过滤
                if start_time and time < start_time:
                    continue
                if end_time and time > end_time:
                    continue

                record = WeatherRecord(
                    time=time,
                    temperature_2m=float(row['temperature_2m']),
                    relative_humidity=float(row['relativehumidity_2m']),
                    rain=float(row['rain']),
                    snowfall=float(row['snowfall']),
                    shortwave_radiation=float(row['shortwave_radiation']),
                    wind_speed=float(row['windspeed_10m'])
                )
                records.append(record)

        return WeatherDataset(records=records)

    def load_with_statistics(self) -> tuple[WeatherDataset, ClimateStatistics]:
        """
        加载天气数据并计算气候统计

        Returns:
            (WeatherDataset, ClimateStatistics) 元组
        """
        dataset = self.load()
        stats = self._calculate_statistics(dataset)
        return dataset, stats

    def _calculate_statistics(self, dataset: WeatherDataset) -> ClimateStatistics:
        """
        计算气候统计数据

        Args:
            dataset: 天气数据集

        Returns:
            ClimateStatistics 对象
        """
        records = dataset.get_all()

        # 全时段温度中位数
        all_temps = [r.temperature_2m for r in records]
        overall_temp_median = calculate_median(all_temps) if all_temps else 20.0

        # 全时段平均风速
        all_winds = [r.wind_speed for r in records]
        overall_wind_avg = calculate_mean(all_winds) if all_winds else 0.0

        # 白天 (8-20 点) 温度中位数
        daytime_temps = [
            r.temperature_2m for r in records
            if self.config.daytime_start_hour <= r.time.hour < self.config.daytime_end_hour
        ]
        daytime_temp_median = calculate_median(daytime_temps) if daytime_temps else overall_temp_median

        # 降雨小时内温度中位数（有降雨的记录）
        rain_temps = [r.temperature_2m for r in records if r.rain > 0]
        rain_temp_median = calculate_median(rain_temps) if rain_temps else overall_temp_median

        return ClimateStatistics(
            rain_temp_median=rain_temp_median,
            daytime_temp_median=daytime_temp_median,
            overall_temp_median=overall_temp_median,
            overall_wind_avg=overall_wind_avg
        )


# =============================================================================
# 便捷函数
# =============================================================================

def load_weather_data(csv_path: str) -> WeatherDataset:
    """便捷函数：加载所有天气数据"""
    loader = WeatherDataLoader(csv_path)
    return loader.load()


def load_weather_with_stats(csv_path: str) -> tuple[WeatherDataset, ClimateStatistics]:
    """便捷函数：加载天气数据并计算统计"""
    loader = WeatherDataLoader(csv_path)
    return loader.load_with_statistics()
