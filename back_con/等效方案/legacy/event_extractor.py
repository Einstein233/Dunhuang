"""
降雨事件提取模块 - 第一阶段：基于事件的降雨提取

核心逻辑：
- 遍历降雨数据，以 3 小时无雨为界限切分独立降雨事件
- 计算每个事件的总降雨量、结束时间、以及结束后 48 小时内的日照能量
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional

# 兼容模块导入和直接运行
try:
    from .weather_data import WeatherData, WeatherRecord
    from .utils import hours_between, calculate_median, calculate_mean
except ImportError:
    from weather_data import WeatherData, WeatherRecord
    from utils import hours_between, calculate_median, calculate_mean


# 常量定义
NO_RAIN_THRESHOLD_HOURS = 3.0  # 无雨界限：3 小时
SOLAR_ACCUMULATION_HOURS = 48  # 日照能量累计时间：48 小时


@dataclass
class RainEvent:
    """
    降雨事件数据类

    Attributes:
        event_id: 事件唯一标识
        total_rain: 该场降雨的总降雨量 (mm)
        start_time: 事件开始时间
        end_time: 事件结束时间
        esolar_48: 降雨结束后 48 小时内的累计日照辐射能 (MJ/m²)
        records: 包含的原始数据记录
        hourly_rain: 每小时的降雨量列表 (mm/h)
        merged_events: 记录由哪些子事件合并而成（用于合并后的事件）
        weighted_timestamp: 加权时间戳，表示事件发生的代表性时间
                          计算公式：Σ(降雨量×时间) / Σ降雨量
        rain_temp_median: 降雨小时内温度的中位数 (°C)
        daytime_temp_median: 白天（8-20 点）温度的中位数 (°C)
        dry_temp_median: 全时间段温度的中位数 (°C)
        wind_speed_avg: 全时间段平均风速 (m/s)
    """
    event_id: int
    total_rain: float
    start_time: datetime
    end_time: datetime
    esolar_48: float = 0.0
    records: List[WeatherRecord] = field(default_factory=list)
    hourly_rain: List[float] = field(default_factory=list)
    merged_events: List['RainEvent'] = field(default_factory=list)
    weighted_timestamp: datetime = None  # 加权时间戳
    rain_temp_median: float = 20.0  # 降雨阶段温度（降雨小时内温度中位数）
    daytime_temp_median: float = 20.0  # 日照阶段温度（白天 8-20 点温度中位数）
    dry_temp_median: float = 20.0  # 干燥阶段温度（全时段温度中位数）
    wind_speed_avg: float = 0.0  # 平均风速

    def __post_init__(self):
        """初始化后计算加权时间戳"""
        if self.weighted_timestamp is None and self.records:
            self.weighted_timestamp = self._calculate_weighted_timestamp()

    def _calculate_weighted_timestamp(self) -> datetime:
        """
        计算加权时间戳

        公式：weighted_timestamp = Σ(rain_i × time_i) / Σrain_i

        对于单条记录，返回记录时间；对于多条记录，按降雨量加权平均。

        Returns:
            加权平均后的时间点
        """
        if not self.records:
            return self.start_time

        # 计算总降雨量
        total_rain = sum(r.rain for r in self.records)

        if total_rain == 0:
            # 如果总降雨量为 0，返回开始时间
            return self.start_time

        # 计算加权平均时间（将时间转换为时间戳进行计算）
        weighted_sum = 0.0
        for record in self.records:
            # 使用记录的 Unix 时间戳（秒）
            timestamp = record.time.timestamp()
            weighted_sum += record.rain * timestamp

        # 加权平均时间戳（秒）
        avg_timestamp = weighted_sum / total_rain

        # 转换回 datetime
        return datetime.fromtimestamp(avg_timestamp)

    @property
    def weighted_timestamp_float(self) -> float:
        """
        获取加权时间戳的浮点数表示（用于排序）

        Returns:
            Unix 时间戳（秒）
        """
        if self.weighted_timestamp:
            return self.weighted_timestamp.timestamp()
        return self.start_time.timestamp()

    @property
    def duration_hours(self) -> float:
        """事件持续时间（小时）"""
        return hours_between(self.start_time, self.end_time)

    @property
    def avg_rain_intensity(self) -> float:
        """平均降雨强度 (mm/h)"""
        if self.duration_hours <= 0:
            return 0.0
        return self.total_rain / self.duration_hours

    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            'event_id': self.event_id,
            'total_rain': self.total_rain,
            'start_time': self.start_time.isoformat(),
            'end_time': self.end_time.isoformat(),
            'duration_hours': round(self.duration_hours, 2),
            'avg_rain_intensity': round(self.avg_rain_intensity, 2),
            'esolar_48': round(self.esolar_48, 2),
            'weighted_timestamp': self.weighted_timestamp.isoformat() if self.weighted_timestamp else None,
            'rain_temp_median': round(self.rain_temp_median, 2),  # 降雨阶段温度
            'daytime_temp_median': round(self.daytime_temp_median, 2),  # 日照阶段温度
            'dry_temp_median': round(self.dry_temp_median, 2),  # 干燥阶段温度
            'wind_speed_avg': round(self.wind_speed_avg, 2)  # 平均风速
        }


class RainEventExtractor:
    """
    降雨事件提取器

    从天气数据中提取独立的降雨事件，并计算相关指标
    """

    def __init__(
        self,
        no_rain_threshold: float = NO_RAIN_THRESHOLD_HOURS,
        solar_accumulation_hours: int = SOLAR_ACCUMULATION_HOURS
    ):
        """
        初始化提取器

        Args:
            no_rain_threshold: 无雨界限时间（小时），默认 3 小时
            solar_accumulation_hours: 日照能量累计时间（小时），默认 48 小时
        """
        self.no_rain_threshold = no_rain_threshold
        self.solar_accumulation_hours = solar_accumulation_hours

    def extract(
        self,
        weather_data: WeatherData,
        rain_threshold: float = 0.0
    ) -> List[RainEvent]:
        """
        从天气数据中提取降雨事件

        Args:
            weather_data: 天气数据对象
            rain_threshold: 降雨判定阈值 (mm)，默认 0.0 表示有雨即记录

        Returns:
            RainEvent 列表
        """
        records = weather_data.get_all()
        if not records:
            return []

        # 第一步：识别降雨事件
        events = self._identify_rain_events(records, rain_threshold)

        # 第二步：计算每个事件的日照能量
        self._calculate_solar_energy(events, records)

        return events

    def _identify_rain_events(
        self,
        records: List[WeatherRecord],
        rain_threshold: float
    ) -> List[RainEvent]:
        """
        识别降雨事件

        以连续无雨时间超过阈值为界限，切分独立事件

        Args:
            records: 天气记录列表
            rain_threshold: 降雨判定阈值

        Returns:
            RainEvent 列表（未计算日照能量）
        """
        events = []
        current_event_records = []
        event_id = 0

        # 记录上一次降雨的时间
        last_rain_time: Optional[datetime] = None

        for record in records:
            if record.rain > rain_threshold:
                # 当前有降雨
                if last_rain_time is None:
                    # 新事件开始
                    event_id += 1

                current_event_records.append(record)
                last_rain_time = record.time
            else:
                # 当前无雨
                if last_rain_time is not None:
                    # 之前有雨，检查是否超过无雨阈值
                    hours_since_rain = hours_between(last_rain_time, record.time)

                    if hours_since_rain >= self.no_rain_threshold:
                        # 超过阈值，结束当前事件
                        if current_event_records:
                            event = self._create_event(
                                event_id, current_event_records, records
                            )
                            events.append(event)
                            event_id += 1
                            current_event_records = []
                            last_rain_time = None
                    # 未超过阈值，继续累积（不操作）

        # 处理最后一个事件
        if current_event_records:
            event = self._create_event(event_id, current_event_records, records)
            events.append(event)

        return events

    def _create_event(
        self,
        event_id: int,
        records: List[WeatherRecord],
        all_records: Optional[List[WeatherRecord]] = None
    ) -> RainEvent:
        """
        创建降雨事件对象

        Args:
            event_id: 事件 ID
            records: 事件包含的记录
            all_records: 所有天气记录（用于计算全时段统计）

        Returns:
            RainEvent 对象
        """
        total_rain = sum(r.rain for r in records)
        start_time = records[0].time
        end_time = records[-1].time

        # 计算每小时降雨量（用于后续强度分析）
        hourly_rain = [r.rain for r in records]

        # 计算降雨小时内温度的中位数
        rain_temps = [r.temperature_2m for r in records if r.rain > 0]
        rain_temp_median = calculate_median(rain_temps) if rain_temps else 20.0

        # 白天（8-20 点）温度中位数 - 从该事件时间段内的记录中提取
        daytime_temps = [
            r.temperature_2m for r in records
            if 8 <= r.time.hour < 20
        ]
        daytime_temp_median = calculate_median(daytime_temps) if daytime_temps else 20.0

        # 全时段温度中位数 - 需要从整个数据集计算（如果提供了 all_records）
        dry_temp_median = 20.0
        wind_speed_avg = 0.0

        if all_records:
            all_temps = [r.temperature_2m for r in all_records]
            dry_temp_median = calculate_median(all_temps) if all_temps else 20.0

            all_winds = [r.windspeed_10m for r in all_records]
            wind_speed_avg = calculate_mean(all_winds) if all_winds else 0.0

        return RainEvent(
            event_id=event_id,
            total_rain=total_rain,
            start_time=start_time,
            end_time=end_time,
            records=records.copy(),
            hourly_rain=hourly_rain,
            rain_temp_median=rain_temp_median,
            daytime_temp_median=daytime_temp_median,
            dry_temp_median=dry_temp_median,
            wind_speed_avg=wind_speed_avg
        )

    def _calculate_solar_energy(
        self,
        events: List[RainEvent],
        all_records: List[WeatherRecord]
    ):
        """
        计算每个事件结束后 48 小时内的日照能量

        Args:
            events: 降雨事件列表
            all_records: 所有天气记录
        """
        # 构建时间索引以加速查找
        time_to_record = {r.time: r for r in all_records}

        for event in events:
            # 计算结束时间后 48 小时
            end_48h = event.end_time + timedelta(hours=self.solar_accumulation_hours)

            # 累计日照能量（从短波辐射 W/m² 转换为 MJ/m²）
            # W/m² * 3600s = J/m²，再除以 1e6 得到 MJ/m²
            total_solar_energy = 0.0

            for record in all_records:
                if event.end_time < record.time <= end_48h:
                    # 每小时辐射能量 = 功率 * 时间
                    # 假设数据是小时级别的，每条记录代表 1 小时
                    solar_energy_mj = record.shortwave_radiation * 3600 / 1e6
                    total_solar_energy += solar_energy_mj

            event.esolar_48 = total_solar_energy

    def get_event_statistics(
        self,
        events: List[RainEvent]
    ) -> dict:
        """
        计算事件统计信息

        Args:
            events: 降雨事件列表

        Returns:
            统计信息字典
        """
        if not events:
            return {
                'total_events': 0,
                'avg_rain': 0.0,
                'avg_esolar_48': 0.0,
                'min_rain': 0.0,
                'max_rain': 0.0
            }

        rain_values = [e.total_rain for e in events]
        esolar_values = [e.esolar_48 for e in events]

        return {
            'total_events': len(events),
            'avg_rain': sum(rain_values) / len(rain_values),
            'avg_esolar_48': sum(esolar_values) / len(esolar_values),
            'min_rain': min(rain_values),
            'max_rain': max(rain_values),
            'median_rain': sorted(rain_values)[len(rain_values) // 2]
        }
