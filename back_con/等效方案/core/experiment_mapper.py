"""
降雨 - 日照实验方案等效映射模块

核心功能：将长周期的自然气候数据映射为实验室可执行的等效实验方案。
包含以下子模块：
- 降雨事件提取
- 事件合并优化
- 能量耦合计算
- 实验方案生成
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any, Tuple
import math
import json

# 兼容模块导入和直接运行
try:
    from .config import ExperimentConfig
    from .data_loader import WeatherDataset, WeatherRecord, ClimateStatistics, WeatherDataLoader
    from .utils import (
        calculate_mean, calculate_median, calculate_sum,
        safe_divide, round_to_precision, sqrt_ratio,
        find_adjacent_pair_min_sum, hours_between
    )
except ImportError:
    from config import ExperimentConfig
    from data_loader import WeatherDataset, WeatherRecord, ClimateStatistics, WeatherDataLoader
    from utils import (
        calculate_mean, calculate_median, calculate_sum,
        safe_divide, round_to_precision, sqrt_ratio,
        find_adjacent_pair_min_sum, hours_between
    )


# =============================================================================
# 数据类定义
# =============================================================================

@dataclass
class RainEvent:
    """
    降雨事件数据类

    表示一次独立的降雨事件

    Attributes:
        event_id: 事件唯一标识
        total_rain: 总降雨量 (mm)
        start_time: 事件开始时间
        end_time: 事件结束时间
        esolar_48: 降雨结束后 48 小时内的累计日照辐射能 (MJ/m²)
        records: 包含的原始数据记录
        hourly_rain: 每小时的降雨量列表 (mm/h)
        merged_events: 记录由哪些子事件合并而成
        weighted_timestamp: 加权时间戳
        rain_temp_median: 降雨阶段温度（降雨小时内温度中位数）(°C)
        daytime_temp_median: 日照阶段温度（白天 8-20 点温度中位数）(°C)
        dry_temp_median: 干燥阶段温度（全时段温度中位数）(°C)
        wind_speed_avg: 平均风速 (m/s)
    """
    event_id: int
    total_rain: float
    start_time: datetime
    end_time: datetime
    esolar_48: float = 0.0
    records: List[WeatherRecord] = field(default_factory=list)
    hourly_rain: List[float] = field(default_factory=list)
    merged_events: List['RainEvent'] = field(default_factory=list)
    weighted_timestamp: Optional[datetime] = None
    rain_temp_median: float = 20.0
    daytime_temp_median: float = 20.0
    dry_temp_median: float = 20.0
    wind_speed_avg: float = 0.0

    def __post_init__(self):
        if self.weighted_timestamp is None and self.records:
            self.weighted_timestamp = self._calculate_weighted_timestamp()

    def _calculate_weighted_timestamp(self) -> datetime:
        """计算加权时间戳"""
        if not self.records:
            return self.start_time

        total_rain = sum(r.rain for r in self.records)
        if total_rain == 0:
            return self.start_time

        weighted_sum = sum(r.rain * r.time.timestamp() for r in self.records)
        avg_timestamp = weighted_sum / total_rain
        return datetime.fromtimestamp(avg_timestamp)

    @property
    def weighted_timestamp_float(self) -> float:
        """获取加权时间戳的浮点数表示（用于排序）"""
        if self.weighted_timestamp:
            return self.weighted_timestamp.timestamp()
        return self.start_time.timestamp()

    @property
    def duration_hours(self) -> float:
        """事件持续时间（小时）"""
        return hours_between(self.start_time, self.end_time)

    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            'event_id': self.event_id,
            'total_rain': round_to_precision(self.total_rain),
            'start_time': self.start_time.isoformat(),
            'end_time': self.end_time.isoformat(),
            'duration_hours': round(self.duration_hours, 2),
            'esolar_48': round(self.esolar_48, 2),
            'weighted_timestamp': self.weighted_timestamp.isoformat() if self.weighted_timestamp else None,
            'rain_temp_median': round(self.rain_temp_median, 2),
            'daytime_temp_median': round(self.daytime_temp_median, 2),
            'dry_temp_median': round(self.dry_temp_median, 2),
            'wind_speed_avg': round(self.wind_speed_avg, 2)
        }


@dataclass
class CoupledEvent:
    """
    耦合后的事件数据类

    在 RainEvent 基础上增加了实验室映射参数

    Attributes:
        event: 原始降雨事件
        lab_solar_duration: 实验室日照时长 (小时)
        lab_solar_intensity: 实验室日照强度 (W/m²)
        rain_temp: 降雨阶段目标温度 (°C)
        solar_temp: 日照阶段目标温度 (°C)
        dry_temp: 干燥阶段目标温度 (°C)
        wind_speed: 平均风速 (m/s)
    """
    event: RainEvent
    lab_solar_duration: float
    lab_solar_intensity: float
    rain_temp: float
    solar_temp: float
    dry_temp: float
    wind_speed: float

    @property
    def total_rain(self) -> float:
        return self.event.total_rain

    @property
    def start_time(self) -> datetime:
        return self.event.start_time

    @property
    def end_time(self) -> datetime:
        return self.event.end_time

    @property
    def event_id(self) -> int:
        return self.event.event_id

    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            'event_id': self.event_id,
            'total_rain': round_to_precision(self.total_rain),
            'original_start_time': self.start_time.isoformat() if self.start_time else None,
            'original_end_time': self.end_time.isoformat() if self.end_time else None,
            'lab_solar_duration_hours': self.lab_solar_duration,
            'lab_solar_intensity_w_m2': round_to_precision(self.lab_solar_intensity),
            'rain_temp': round_to_precision(self.rain_temp),
            'solar_temp': round_to_precision(self.solar_temp),
            'dry_temp': round_to_precision(self.dry_temp),
            'wind_speed': round_to_precision(self.wind_speed),
            'original_esolar_48': round_to_precision(self.event.esolar_48)
        }


@dataclass
class ExperimentStep:
    """
    实验步骤数据类

    Attributes:
        step: 步骤序号
        mode: 模式 (Rain/Solar/Dry_Baseline/Rain_Pause)
        duration_min: 持续时间 (分钟)
        target_temp: 目标温度 (°C)
        intensity: 强度 (降雨强度 mm/h 或 日照强度 W/m²)
        duration_hour: 用于日照/干燥阶段的备选字段 (小时)
        is_pulse: 是否为脉冲降雨的一部分
        pulse_info: 脉冲信息
        wind_speed: 风速 (m/s)
    """
    step: int
    mode: str
    duration_min: float
    target_temp: float = 20.0
    intensity: Optional[float] = None
    duration_hour: Optional[float] = None
    is_pulse: bool = False
    pulse_info: Optional[Dict[str, int]] = None
    wind_speed: float = 0.0

    def to_dict(self) -> dict:
        """转换为字典格式"""
        result = {
            'step': self.step,
            'mode': self.mode,
            'duration_min': round_to_precision(self.duration_min),
            'target_temp': round_to_precision(self.target_temp),
            'wind_speed': round_to_precision(self.wind_speed)
        }

        if self.intensity is not None:
            key = 'intensity' if self.mode == 'Rain' else 'intensity_watt'
            result[key] = round_to_precision(self.intensity)

        if self.duration_hour is not None:
            result['duration_hour'] = round_to_precision(self.duration_hour)

        if self.is_pulse and self.pulse_info:
            result['is_pulse'] = True
            result['pulse_current'] = self.pulse_info['current']
            result['pulse_total'] = self.pulse_info['total']

        return result


@dataclass
class ExperimentPlan:
    """
    实验方案数据类

    Attributes:
        meta: 元数据
        sequence: 实验步骤序列
        source_info: 源数据信息
    """
    meta: Dict[str, Any]
    sequence: List[ExperimentStep]
    source_info: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            'experiment_meta': self.meta,
            'sequence': [step.to_dict() for step in self.sequence],
            'source_info': self.source_info
        }

    def to_json(self, indent: int = 2) -> str:
        """转换为 JSON 字符串"""
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def save(self, filepath: str) -> None:
        """保存为 JSON 文件"""
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(self.to_json())


# =============================================================================
# 降雨事件提取器
# =============================================================================

class RainEventExtractor:
    """
    降雨事件提取器

    从天气数据中提取独立的降雨事件（以 3 小时无雨为界限）
    """

    def __init__(self, config: Optional[ExperimentConfig] = None):
        self.config = config or ExperimentConfig()

    def extract(
        self,
        dataset: WeatherDataset,
        climate_stats: ClimateStatistics
    ) -> List[RainEvent]:
        """
        从天气数据中提取降雨事件

        Args:
            dataset: 天气数据集
            climate_stats: 气候统计数据

        Returns:
            RainEvent 列表
        """
        records = dataset.get_all()
        if not records:
            return []

        events = self._identify_rain_events(records)
        self._calculate_solar_energy(events, records)
        self._apply_climate_stats(events, climate_stats)

        return events

    def _identify_rain_events(self, records: List[WeatherRecord]) -> List[RainEvent]:
        """识别降雨事件"""
        events = []
        current_event_records = []
        event_id = 0
        last_rain_time: Optional[datetime] = None

        for record in records:
            if record.rain > 0:
                if last_rain_time is None:
                    event_id += 1
                current_event_records.append(record)
                last_rain_time = record.time
            else:
                if last_rain_time is not None:
                    hours_since_rain = hours_between(last_rain_time, record.time)
                    if hours_since_rain >= self.config.no_rain_threshold_hours:
                        if current_event_records:
                            event = self._create_event(event_id, current_event_records, records)
                            events.append(event)
                            event_id += 1
                            current_event_records = []
                            last_rain_time = None

        if current_event_records:
            event = self._create_event(event_id, current_event_records, records)
            events.append(event)

        return events

    def _create_event(
        self,
        event_id: int,
        records: List[WeatherRecord],
        all_records: List[WeatherRecord]
    ) -> RainEvent:
        """创建降雨事件对象"""
        total_rain = sum(r.rain for r in records)
        start_time = records[0].time
        end_time = records[-1].time
        hourly_rain = [r.rain for r in records]

        # 计算降雨小时内温度的中位数
        rain_temps = [r.temperature_2m for r in records if r.rain > 0]
        rain_temp_median = calculate_median(rain_temps) if rain_temps else 20.0

        # 白天（8-20 点）温度中位数
        daytime_temps = [
            r.temperature_2m for r in records
            if self.config.daytime_start_hour <= r.time.hour < self.config.daytime_end_hour
        ]
        daytime_temp_median = calculate_median(daytime_temps) if daytime_temps else 20.0

        # 全时段温度中位数和平均风速
        all_temps = [r.temperature_2m for r in all_records]
        dry_temp_median = calculate_median(all_temps) if all_temps else 20.0
        all_winds = [r.wind_speed for r in all_records]
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

    def _calculate_solar_energy(self, events: List[RainEvent], all_records: List[WeatherRecord]):
        """计算每个事件结束后 48 小时内的日照能量"""
        for event in events:
            end_48h = event.end_time + timedelta(hours=self.config.solar_accumulation_hours)
            total_solar_energy = 0.0

            for record in all_records:
                if event.end_time < record.time <= end_48h:
                    solar_energy_mj = record.shortwave_radiation * 3600 / 1e6
                    total_solar_energy += solar_energy_mj

            event.esolar_48 = total_solar_energy

    def _apply_climate_stats(self, events: List[RainEvent], stats: ClimateStatistics):
        """应用气候统计数据到所有事件"""
        for event in events:
            # 如果事件级别的温度计算失败，使用全局统计
            if not event.records:
                event.rain_temp_median = stats.rain_temp_median
                event.daytime_temp_median = stats.daytime_temp_median
            event.dry_temp_median = stats.overall_temp_median
            event.wind_speed_avg = stats.overall_wind_avg

    def get_event_statistics(self, events: List[RainEvent]) -> dict:
        """计算事件统计信息"""
        if not events:
            return {'total_events': 0, 'avg_rain': 0.0, 'min_rain': 0.0, 'max_rain': 0.0}

        rain_values = [e.total_rain for e in events]
        return {
            'total_events': len(events),
            'avg_rain': calculate_mean(rain_values),
            'min_rain': min(rain_values),
            'max_rain': max(rain_values)
        }


# =============================================================================
# 事件合并器
# =============================================================================

@dataclass
class MergeResult:
    """合并结果数据类"""
    events: List[RainEvent]
    original_count: int
    merged_count: int
    total_rain_before: float
    total_rain_after: float
    merge_operations: List[str] = field(default_factory=list)

    @property
    def rain_conserved(self) -> bool:
        return abs(self.total_rain_before - self.total_rain_after) < 0.01

    def to_dict(self) -> dict:
        return {
            'original_count': self.original_count,
            'merged_count': self.merged_count,
            'reduction_rate': round_to_precision(1 - self.merged_count / max(self.original_count, 1)),
            'total_rain_before': round_to_precision(self.total_rain_before),
            'total_rain_after': round_to_precision(self.total_rain_after),
            'rain_conserved': self.rain_conserved
        }


class EventMerger:
    """
    事件合并器

    基于槽位预算对降雨事件进行合并
    """

    def __init__(self, config: Optional[ExperimentConfig] = None):
        self.config = config or ExperimentConfig()

    def calculate_max_cycles(self, total_hours: float) -> int:
        """计算最大允许场次（槽位预算）"""
        cycle_duration = self.config.standard_cycle_duration
        if cycle_duration <= 0:
            return 0
        return int(total_hours / cycle_duration)

    def merge(
        self,
        events: List[RainEvent],
        max_cycles: Optional[int] = None,
        total_hours: Optional[float] = None
    ) -> MergeResult:
        """执行事件合并"""
        if not events:
            return MergeResult(events=[], original_count=0, merged_count=0,
                               total_rain_before=0.0, total_rain_after=0.0)

        original_count = len(events)
        total_rain_before = sum(e.total_rain for e in events)

        if max_cycles is None and total_hours is not None:
            max_cycles = self.calculate_max_cycles(total_hours)

        if max_cycles is None or max_cycles >= original_count:
            return MergeResult(
                events=events.copy(), original_count=original_count, merged_count=original_count,
                total_rain_before=total_rain_before, total_rain_after=total_rain_before
            )

        merged_events = events.copy()
        merge_operations = []
        iteration = 0

        while len(merged_events) > max_cycles and len(merged_events) > 1:
            iteration += 1
            merge_idx = self._find_best_merge_index(merged_events)
            if merge_idx < 0 or merge_idx >= len(merged_events) - 1:
                break

            event_a = merged_events[merge_idx]
            event_b = merged_events[merge_idx + 1]
            merged_event = self._merge_two_events(event_a, event_b)

            merge_operations.append(
                f"[迭代{iteration}] 合并事件 #{event_a.event_id} (V={round_to_precision(event_a.total_rain)}mm) "
                f"和 #{event_b.event_id} (V={round_to_precision(event_b.total_rain)}mm) "
                f"-> 新事件 V={round_to_precision(merged_event.total_rain)}mm"
            )

            merged_events = merged_events[:merge_idx] + [merged_event] + merged_events[merge_idx + 2:]

        total_rain_after = sum(e.total_rain for e in merged_events)

        return MergeResult(
            events=merged_events, original_count=original_count, merged_count=len(merged_events),
            total_rain_before=total_rain_before, total_rain_after=total_rain_after,
            merge_operations=merge_operations
        )

    def _find_best_merge_index(self, events: List[RainEvent]) -> int:
        """找到最佳合并位置的索引"""
        if len(events) < 2:
            return -1
        rain_values = [e.total_rain for e in events]
        idx_a, _ = find_adjacent_pair_min_sum(rain_values)
        return idx_a

    def _merge_two_events(self, event_a: RainEvent, event_b: RainEvent) -> RainEvent:
        """合并两个事件"""
        new_event_id = min(event_a.event_id, event_b.event_id)
        new_total_rain = event_a.total_rain + event_b.total_rain
        new_start_time = min(event_a.start_time, event_b.start_time)
        new_end_time = max(event_a.end_time, event_b.end_time)

        # 日照能量按权重重新计算
        total_rain_sum = event_a.total_rain + event_b.total_rain
        if total_rain_sum > 0:
            weight_a = event_a.total_rain / total_rain_sum
            weight_b = event_b.total_rain / total_rain_sum
            new_esolar_48 = event_a.esolar_48 * weight_a + event_b.esolar_48 * weight_b
        else:
            new_esolar_48 = (event_a.esolar_48 + event_b.esolar_48) / 2

        new_records = event_a.records + event_b.records
        new_records.sort(key=lambda r: r.time)

        sub_events = []
        for e in [event_a, event_b]:
            if e.merged_events:
                sub_events.extend(e.merged_events)
            else:
                sub_events.append(e)

        # 合并温度字段
        return RainEvent(
            event_id=new_event_id,
            total_rain=new_total_rain,
            start_time=new_start_time,
            end_time=new_end_time,
            esolar_48=new_esolar_48,
            records=new_records,
            hourly_rain=event_a.hourly_rain + event_b.hourly_rain,
            merged_events=sub_events,
            rain_temp_median=(event_a.rain_temp_median + event_b.rain_temp_median) / 2,
            daytime_temp_median=(event_a.daytime_temp_median + event_b.daytime_temp_median) / 2,
            dry_temp_median=event_a.dry_temp_median,
            wind_speed_avg=event_a.wind_speed_avg
        )


# =============================================================================
# 能量耦合器
# =============================================================================

class EnergyCoupler:
    """
    能量耦合器

    将自然降雨事件映射为实验室可执行的等效事件
    """

    def __init__(self, config: Optional[ExperimentConfig] = None):
        self.config = config or ExperimentConfig()
        self.avg_rain: Optional[float] = None
        self.avg_esolar_48: Optional[float] = None

    def couple(self, events: List[RainEvent]) -> List[CoupledEvent]:
        """对降雨事件进行能量耦合"""
        if not events:
            return []

        self._calculate_baselines(events)
        return [self._create_coupled_event(event) for event in events]

    def _calculate_baselines(self, events: List[RainEvent]):
        """计算基准值"""
        self.avg_rain = calculate_mean([e.total_rain for e in events])
        self.avg_esolar_48 = calculate_mean([e.esolar_48 for e in events])

    def _create_coupled_event(self, event: RainEvent) -> CoupledEvent:
        """创建单个耦合事件"""
        lab_solar_intensity = self._calculate_solar_intensity(event.total_rain)

        return CoupledEvent(
            event=event,
            lab_solar_duration=self.config.solar_duration_hours,
            lab_solar_intensity=lab_solar_intensity,
            rain_temp=event.rain_temp_median,
            solar_temp=event.daytime_temp_median,
            dry_temp=event.dry_temp_median,
            wind_speed=event.wind_speed_avg
        )

    def _calculate_solar_intensity(self, rain_volume: float) -> float:
        """根据降雨量计算实验室日照强度"""
        if self.avg_rain is None or self.avg_rain <= 0:
            return self.config.max_solar_intensity

        if rain_volume >= self.avg_rain:
            return self.config.max_solar_intensity
        else:
            ratio = sqrt_ratio(rain_volume, self.avg_rain)
            return self.config.max_solar_intensity * ratio


# =============================================================================
# 脉冲降雨工具
# =============================================================================

def generate_pulse_rain_steps(
    total_rain_mm: float,
    rain_intensity: float,
    config: Optional[ExperimentConfig] = None
) -> List[Tuple[str, float, Optional[float], bool, Optional[Dict[str, int]]]]:
    """
    生成脉冲降雨步骤

    当降雨时间超过阈值时，将降雨切割为多段，每段之间添加等长的暂停间隙
    """
    cfg = config or ExperimentConfig()
    total_duration_min = (total_rain_mm / rain_intensity) * 60 if rain_intensity > 0 else 0

    if total_duration_min <= cfg.pulse_rain_max_duration_min:
        return [('Rain', total_duration_min, rain_intensity, False, None)]

    num_segments = math.ceil(total_duration_min / cfg.pulse_rain_max_duration_min)
    segment_duration = total_duration_min / num_segments

    steps = []
    for i in range(num_segments):
        pulse_info = {'current': i + 1, 'total': num_segments}
        steps.append(('Rain', segment_duration, rain_intensity, True, pulse_info))
        if i < num_segments - 1:
            steps.append(('Rain_Pause', segment_duration, None, True, pulse_info))

    return steps


# =============================================================================
# 实验方案生成器
# =============================================================================

class ExperimentPlanGenerator:
    """
    实验方案生成器

    整合所有模块，生成完整的实验方案
    """

    def __init__(
        self,
        csv_path: str,
        target_days: float = 10.0,
        config: Optional[ExperimentConfig] = None
    ):
        self.csv_path = csv_path
        self.target_days = target_days
        self.target_hours = target_days * 24
        self.config = config or ExperimentConfig()

        # 内部组件
        self.data_loader: Optional[WeatherDataLoader] = None
        self.event_extractor: Optional[RainEventExtractor] = None
        self.event_merger: Optional[EventMerger] = None
        self.energy_coupler: Optional[EnergyCoupler] = None

        # 处理结果
        self.weather_data: Optional[WeatherDataset] = None
        self.climate_stats: Optional[ClimateStatistics] = None
        self.raw_events: List[RainEvent] = []
        self.merged_events: List[RainEvent] = []
        self.coupled_events: List[CoupledEvent] = []

    def generate(self) -> ExperimentPlan:
        """生成实验方案"""
        self._load_data()
        self._extract_events()
        self._merge_events()
        self._couple_energy()
        return self._generate_steps()

    def _load_data(self):
        """加载天气数据"""
        self.data_loader = WeatherDataLoader(self.csv_path, self.config)
        self.weather_data, self.climate_stats = self.data_loader.load_with_statistics()

    def _extract_events(self):
        """提取降雨事件"""
        self.event_extractor = RainEventExtractor(self.config)
        self.raw_events = self.event_extractor.extract(self.weather_data, self.climate_stats)

    def _merge_events(self):
        """执行事件合并"""
        self.event_merger = EventMerger(self.config)
        max_cycles = self.event_merger.calculate_max_cycles(self.target_hours)
        merge_result = self.event_merger.merge(self.raw_events, max_cycles=max_cycles)
        self.merged_events = merge_result.events

    def _couple_energy(self):
        """执行能量耦合"""
        self.energy_coupler = EnergyCoupler(self.config)
        self.coupled_events = self.energy_coupler.couple(self.merged_events)
        self.coupled_events.sort(key=lambda e: e.event.weighted_timestamp_float)

    def _select_rain_intensity(self, total_rain: float) -> float:
        """选择合适的降雨强度档位"""
        for intensity in sorted(self.config.rain_intensity_gears, reverse=True):
            duration = safe_divide(total_rain, intensity)
            if 10/60 <= duration <= 2.0:
                return intensity
        return self.config.rain_intensity_gears[len(self.config.rain_intensity_gears) // 2]

    def _generate_steps(self) -> ExperimentPlan:
        """生成实验步骤序列"""
        sequence = []
        step_number = 0
        total_rain_volume = 0.0
        pulse_rain_count = 0

        for event in self.coupled_events:
            selected_intensity = self._select_rain_intensity(event.total_rain)
            rain_duration_min = (event.total_rain / selected_intensity) * 60

            pulse_steps = generate_pulse_rain_steps(
                event.total_rain, selected_intensity, self.config
            )

            for mode, duration, intensity, is_pulse, pulse_info in pulse_steps:
                step_number += 1

                if mode == 'Rain':
                    sequence.append(ExperimentStep(
                        step=step_number, mode='Rain', intensity=intensity,
                        duration_min=duration, target_temp=event.rain_temp,
                        is_pulse=is_pulse, pulse_info=pulse_info, wind_speed=event.wind_speed
                    ))
                    total_rain_volume += event.total_rain / len([s for s in pulse_steps if s[0] == 'Rain'])
                    if is_pulse:
                        pulse_rain_count += 1
                elif mode == 'Rain_Pause':
                    sequence.append(ExperimentStep(
                        step=step_number, mode='Rain_Pause',
                        duration_min=duration, target_temp=event.rain_temp,
                        is_pulse=is_pulse, pulse_info=pulse_info, wind_speed=event.wind_speed
                    ))

            # 日照阶段
            step_number += 1
            sequence.append(ExperimentStep(
                step=step_number, mode='Solar',
                intensity=self.config.max_solar_intensity,
                duration_min=self.config.solar_duration_hours * 60,
                duration_hour=self.config.solar_duration_hours,
                target_temp=event.solar_temp, wind_speed=event.wind_speed
            ))

            # 干燥阶段
            step_number += 1
            sequence.append(ExperimentStep(
                step=step_number, mode='Dry_Baseline',
                duration_min=self.config.dry_duration_hours * 60,
                duration_hour=self.config.dry_duration_hours,
                target_temp=event.dry_temp, wind_speed=event.wind_speed
            ))

        meta = {
            'target_days': self.target_days,
            'actual_cycles': len(self.coupled_events),
            'total_rain_volume': round_to_precision(total_rain_volume),
            'baseline_temp': round_to_precision(self.climate_stats.overall_temp_median if self.climate_stats else 20.0),
            'original_events': len(self.raw_events),
            'merged_events': len(self.merged_events),
            'pulse_rain_events': pulse_rain_count,
            'pulse_max_duration_min': self.config.pulse_rain_max_duration_min
        }

        source_info = {
            'csv_path': self.csv_path,
            'data_range': {
                'start': self.weather_data.start_time.isoformat() if self.weather_data and self.weather_data.start_time else None,
                'end': self.weather_data.end_time.isoformat() if self.weather_data and self.weather_data.end_time else None
            },
            'event_stats': self.event_extractor.get_event_statistics(self.raw_events) if self.event_extractor else {},
            'merged_events': [e.to_dict() for e in self.merged_events],
            'climate_statistics': {
                'rain_temp_median': round_to_precision(self.climate_stats.rain_temp_median) if self.climate_stats else None,
                'daytime_temp_median': round_to_precision(self.climate_stats.daytime_temp_median) if self.climate_stats else None,
                'overall_temp_median': round_to_precision(self.climate_stats.overall_temp_median) if self.climate_stats else None,
                'overall_wind_avg': round_to_precision(self.climate_stats.overall_wind_avg) if self.climate_stats else None
            } if self.climate_stats else {}
        }

        return ExperimentPlan(meta=meta, sequence=sequence, source_info=source_info)


# =============================================================================
# 便捷函数
# =============================================================================

def generate_experiment_plan(
    csv_path: str,
    target_days: float = 10.0,
    config: Optional[ExperimentConfig] = None,
    output_path: Optional[str] = None
) -> ExperimentPlan:
    """便捷函数：生成实验方案"""
    generator = ExperimentPlanGenerator(csv_path, target_days, config)
    plan = generator.generate()
    if output_path:
        plan.save(output_path)
    return plan
