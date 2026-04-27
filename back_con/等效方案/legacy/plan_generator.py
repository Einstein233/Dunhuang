"""
实验方案生成器 - 核心主模块

整合所有模块，实现从原始天气数据到实验室实验方案的完整流程：
1. 读取 CSV 天气数据
2. 提取降雨事件
3. 能量耦合计算
4. 事件合并优化
5. 生成实验方案 JSON

基于需求文档中的"能量守恒"与"应力槽位分配"原则
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any, Tuple
import json

# 兼容模块导入和直接运行
try:
    from .weather_data import WeatherData, WeatherDataLoader, WeatherRecord
    from .event_extractor import RainEvent, RainEventExtractor
    from .energy_coupler import EnergyCoupler, CoupledEvent
    from .event_merger import EventMerger, MergeResult
    from .utils import (
        calculate_median,
        calculate_percentile,
        safe_divide,
        round_to_precision,
        clamp
    )
except ImportError:
    from weather_data import WeatherData, WeatherDataLoader, WeatherRecord
    from event_extractor import RainEvent, RainEventExtractor
    from energy_coupler import EnergyCoupler, CoupledEvent
    from event_merger import EventMerger, MergeResult
    from utils import (
        calculate_median,
        calculate_percentile,
        safe_divide,
        round_to_precision,
        clamp
    )


# =============================================================================
# 实验工况常量定义
# =============================================================================

# 固定降雨强度档位 (mm/h)
RAIN_INTENSITY_GEARS = [20, 40, 60]

# 标准循环时长 (小时)
STANDARD_SOLAR_DURATION = 12.0  # 日照时长
STANDARD_DRY_DURATION = 12.0    # 干燥时长

# 脉冲降雨配置（超参数）
PULSE_RAIN_MAX_DURATION_MIN = 30.0  # 单次降雨最大时长（分钟），超过此值将触发脉冲切割


@dataclass
class ExperimentStep:
    """
    实验步骤数据类

    表示实验序列中的单一步骤

    Attributes:
        step: 步骤序号
        mode: 模式 (Rain/Solar/Dry_Baseline/Rain_Pause)
        intensity: 强度 (降雨强度 mm/h 或 日照强度 W/m²)
        duration_min: 持续时间 (分钟)
        target_temp: 目标温度 (°C)
        is_pulse: 是否为脉冲降雨的一部分
        pulse_info: 脉冲信息 {"current": 当前第几段，"total": 总段数}
        wind_speed: 风速 (m/s)
    """
    step: int
    mode: str
    duration_min: float
    target_temp: float = 20.0
    intensity: Optional[float] = None
    duration_hour: Optional[float] = None  # 用于日照/干燥阶段的备选字段
    is_pulse: bool = False
    pulse_info: Optional[Dict[str, int]] = None
    wind_speed: float = 0.0  # 风速

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
            if self.mode == 'Rain':
                result['intensity'] = round_to_precision(self.intensity)
            else:
                result['intensity_watt'] = round_to_precision(self.intensity)

        if self.duration_hour is not None:
            result['duration_hour'] = round_to_precision(self.duration_hour)

        # 脉冲信息
        if self.is_pulse and self.pulse_info:
            result['is_pulse'] = True
            result['pulse_current'] = self.pulse_info['current']
            result['pulse_total'] = self.pulse_info['total']

        return result


@dataclass
class ExperimentPlan:
    """
    实验方案数据类

    完整的实验方案，包含元数据和步骤序列

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
        """
        保存为 JSON 文件

        Args:
            filepath: 文件路径
        """
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(self.to_json())


# =============================================================================
# 脉冲降雨工具函数
# =============================================================================

def generate_pulse_rain_steps(
    total_rain_mm: float,
    rain_intensity: float,
    max_duration_min: float = PULSE_RAIN_MAX_DURATION_MIN,
    target_temp: float = 20.0
) -> List[Tuple[str, float, Optional[float], bool, Optional[Dict[str, int]]]]:
    """
    生成脉冲降雨步骤

    当降雨时间超过 max_duration_min 时，将降雨切割为多段，
    每段之间添加等长的暂停间隙，利于降雨入渗。

    Args:
        total_rain_mm: 总降雨量 (mm)
        rain_intensity: 降雨强度 (mm/h)
        max_duration_min: 单次降雨最大时长（分钟），超参数
        target_temp: 目标温度 (°C)

    Returns:
        步骤列表，每个元素为 (mode, duration_min, intensity, is_pulse, pulse_info)

    Example:
        35min 降雨 -> [(Rain, 17.5, ...), (Pause, 17.5, ...), (Rain, 17.5, ...)]
        96min 降雨 -> [(Rain, 24, ...), (Pause, 24), (Rain, 24, ...), (Pause, 24), (Rain, 24, ...), (Pause, 24), (Rain, 24, ...)]
        注意：最后一段降雨后不添加 pause，直接进入日照阶段
    """
    # 计算总降雨时长（分钟）
    total_duration_min = (total_rain_mm / rain_intensity) * 60 if rain_intensity > 0 else 0

    # 如果不超过阈值，返回单个降雨步骤
    if total_duration_min <= max_duration_min:
        return [('Rain', total_duration_min, rain_intensity, False, None)]

    # 计算需要切割的段数
    # 向上取整，确保每段不超过 max_duration_min
    import math
    num_segments = math.ceil(total_duration_min / max_duration_min)

    # 计算每段的时长
    segment_duration = total_duration_min / num_segments

    steps = []
    for i in range(num_segments):
        pulse_info = {'current': i + 1, 'total': num_segments}

        # 降雨段
        steps.append((
            'Rain',
            segment_duration,
            rain_intensity,
            True,
            pulse_info
        ))

        # 暂停间隙（与降雨时间相同）
        # 注意：最后一段降雨后不需要 pause，直接进入日照阶段
        if i < num_segments - 1:
            steps.append((
                'Rain_Pause',
                segment_duration,
                None,
                True,
                pulse_info
            ))

    return steps


def calculate_pulse_rain_info(
    total_rain_mm: float,
    rain_intensity: float,
    max_duration_min: float = PULSE_RAIN_MAX_DURATION_MIN
) -> Dict[str, Any]:
    """
    计算脉冲降雨信息

    Args:
        total_rain_mm: 总降雨量 (mm)
        rain_intensity: 降雨强度 (mm/h)
        max_duration_min: 单次降雨最大时长（分钟）

    Returns:
        脉冲降雨信息字典
    """
    total_duration_min = (total_rain_mm / rain_intensity) * 60 if rain_intensity > 0 else 0
    is_pulse = total_duration_min > max_duration_min

    if is_pulse:
        import math
        num_segments = math.ceil(total_duration_min / max_duration_min)
        segment_duration = total_duration_min / num_segments
        total_pause_duration = segment_duration * (num_segments - 1)
    else:
        num_segments = 1
        segment_duration = total_duration_min
        total_pause_duration = 0

    return {
        'is_pulse': is_pulse,
        'total_duration_min': total_duration_min,
        'num_segments': num_segments,
        'segment_duration_min': segment_duration,
        'total_pause_duration_min': total_pause_duration,
        'effective_rain_duration_min': total_duration_min  # 实际降雨时长不变
    }


# =============================================================================
# 实验方案生成器主类
# =============================================================================

class ExperimentPlanGenerator:
    """
    实验方案生成器

    气候应力等效实验方案自动生成系统 (CSEE-Gen) 的核心类
    """

    def __init__(
        self,
        csv_path: str,
        target_days: float = 10.0,
        rain_intensity_gears: List[float] = None
    ):
        """
        初始化生成器

        Args:
            csv_path: 天气数据 CSV 文件路径
            target_days: 目标实验天数，默认 10 天
            rain_intensity_gears: 降雨强度档位列表
        """
        self.csv_path = csv_path
        self.target_days = target_days
        self.target_hours = target_days * 24
        self.rain_intensity_gears = rain_intensity_gears or RAIN_INTENSITY_GEARS

        # 内部组件
        self.data_loader: Optional[WeatherDataLoader] = None
        self.event_extractor: Optional[RainEventExtractor] = None
        self.energy_coupler: Optional[EnergyCoupler] = None
        self.event_merger: Optional[EventMerger] = None

        # 处理结果
        self.weather_data: Optional[WeatherData] = None
        self.raw_events: List[RainEvent] = []
        self.merged_events: List[RainEvent] = []
        self.coupled_events: List[CoupledEvent] = []
        self.baseline_temp: float = 20.0

    def generate(self) -> ExperimentPlan:
        """
        生成实验方案

        执行完整流程：
        1. 加载天气数据
        2. 提取降雨事件
        3. 计算基准温度 (P50)
        4. 事件合并优化
        5. 能量耦合
        6. 生成实验步骤

        Returns:
            ExperimentPlan 实验方案
        """
        # 步骤 1: 加载数据
        self._load_data()

        # 步骤 2: 提取降雨事件
        self._extract_events()

        # 步骤 3: 计算基准温度
        self._calculate_baseline_temp()

        # 步骤 4: 事件合并
        self._merge_events()

        # 步骤 5: 能量耦合
        self._couple_energy()

        # 步骤 6: 生成实验步骤
        plan = self._generate_steps()

        return plan

    def _load_data(self) -> None:
        """加载天气数据"""
        self.data_loader = WeatherDataLoader(self.csv_path)
        self.weather_data = self.data_loader.load()

    def _extract_events(self) -> None:
        """提取降雨事件"""
        self.event_extractor = RainEventExtractor()
        self.raw_events = self.event_extractor.extract(self.weather_data)

    def _calculate_baseline_temp(self) -> None:
        """
        计算基准温度 (P50 - 全时段中位数)

        作为无任务时的常驻温度
        """
        if not self.weather_data:
            return

        temps = [r.temperature_2m for r in self.weather_data.get_all()]
        if temps:
            self.baseline_temp = calculate_median(temps)

    def _merge_events(self) -> None:
        """
        执行事件合并

        基于槽位预算，将事件数量压缩到可执行范围内
        """
        # 计算标准循环时长
        base_cycle_duration = 1.0 + STANDARD_SOLAR_DURATION + STANDARD_DRY_DURATION

        self.event_merger = EventMerger(
            cycle_rain_duration=1.0,
            cycle_solar_duration=STANDARD_SOLAR_DURATION,
            cycle_dry_duration=STANDARD_DRY_DURATION
        )

        # 计算最大允许场次
        max_cycles = self.event_merger.calculate_max_cycles(self.target_hours)

        # 执行合并
        merge_result = self.event_merger.merge(
            self.raw_events,
            max_cycles=max_cycles
        )

        self.merged_events = merge_result.events

    def _couple_energy(self) -> None:
        """
        执行能量耦合

        将合并后的事件映射为实验室可执行的等效事件
        并按加权时间戳排序（由早到晚）
        """
        self.energy_coupler = EnergyCoupler(
            solar_duration=STANDARD_SOLAR_DURATION,
            dry_duration=STANDARD_DRY_DURATION
        )

        self.coupled_events = self.energy_coupler.couple(
            self.merged_events,
            baseline_temp=self.baseline_temp
        )

        # 按加权时间戳排序（由早到晚）
        self.coupled_events.sort(
            key=lambda e: e.event.weighted_timestamp_float
        )

    def _select_rain_intensity(self, total_rain: float) -> float:
        """
        根据总降雨量选择合适的降雨强度档位

        基于该地区 P99 雨强自动选择最接近的档位

        Args:
            total_rain: 总降雨量 (mm)

        Returns:
            选择的降雨强度 (mm/h)
        """
        # 计算实际雨强需求
        # 优先选择能保证合理降雨时长的档位
        for intensity in sorted(self.rain_intensity_gears, reverse=True):
            duration = safe_divide(total_rain, intensity)
            # 希望降雨时长在 10 分钟到 2 小时之间
            if 10/60 <= duration <= 2.0:
                return intensity

        # 默认返回中间档位
        return self.rain_intensity_gears[len(self.rain_intensity_gears) // 2]

    def _generate_steps(self) -> ExperimentPlan:
        """
        生成实验步骤序列

        每个循环包含：
        1. Rain: 降雨阶段（可能包含脉冲切割）
        2. Rain_Pause: 降雨暂停间隙（脉冲模式才有）
        3. Solar: 日照阶段 (12 小时)
        4. Dry_Baseline: 干燥/基准温度阶段 (12 小时)

        脉冲降雨逻辑：
        - 当降雨时长超过 PULSE_RAIN_MAX_DURATION_MIN 时，将降雨切割为多段
        - 每段之间添加等长的暂停间隙，利于降雨入渗
        - 例如：35min -> 17.5min Rain + 17.5min Pause + 17.5min Rain
        - 例如：96min -> 24min*4 段，每段之间 24min Pause

        Returns:
            ExperimentPlan 实验方案
        """
        sequence = []
        step_number = 0
        total_rain_volume = 0.0
        pulse_rain_count = 0  # 脉冲降雨事件计数

        for event in self.coupled_events:
            # 选择降雨强度
            selected_intensity = self._select_rain_intensity(event.total_rain)

            # 计算降雨时长 ti = Vi / I_selected (小时)
            rain_duration_hours = safe_divide(event.total_rain, selected_intensity)
            rain_duration_min = rain_duration_hours * 60

            # 生成脉冲降雨步骤（如果需要）
            pulse_steps = generate_pulse_rain_steps(
                total_rain_mm=event.total_rain,
                rain_intensity=selected_intensity,
                max_duration_min=PULSE_RAIN_MAX_DURATION_MIN,
                target_temp=event.rain_temp
            )

            # 添加脉冲降雨步骤
            for mode, duration, intensity, is_pulse, pulse_info in pulse_steps:
                step_number += 1

                if mode == 'Rain':
                    sequence.append(ExperimentStep(
                        step=step_number,
                        mode='Rain',
                        intensity=intensity,
                        duration_min=duration,
                        target_temp=event.rain_temp,  # 降雨阶段温度
                        is_pulse=is_pulse,
                        pulse_info=pulse_info,
                        wind_speed=event.wind_speed  # 风速
                    ))
                    total_rain_volume += event.total_rain / len([s for s in pulse_steps if s[0] == 'Rain'])
                    if is_pulse:
                        pulse_rain_count += 1
                elif mode == 'Rain_Pause':
                    sequence.append(ExperimentStep(
                        step=step_number,
                        mode='Rain_Pause',
                        duration_min=duration,
                        target_temp=event.rain_temp,  # 暂停阶段保持降雨温度
                        is_pulse=is_pulse,
                        pulse_info=pulse_info,
                        wind_speed=event.wind_speed
                    ))

            # === 日照阶段 ===
            step_number += 1
            solar_duration_min = self.energy_coupler.solar_duration * 60
            sequence.append(ExperimentStep(
                step=step_number,
                mode='Solar',
                intensity=self.energy_coupler.max_solar_intensity,
                duration_min=solar_duration_min,
                duration_hour=self.energy_coupler.solar_duration,
                target_temp=event.solar_temp,  # 日照阶段温度（白天 8-20 点温度中位数）
                wind_speed=event.wind_speed
            ))

            # === 干燥/基准阶段 ===
            step_number += 1
            dry_duration_min = self.energy_coupler.dry_duration * 60
            sequence.append(ExperimentStep(
                step=step_number,
                mode='Dry_Baseline',
                duration_min=dry_duration_min,
                duration_hour=self.energy_coupler.dry_duration,
                target_temp=event.dry_temp,  # 干燥阶段温度（全时段温度中位数）
                wind_speed=event.wind_speed
            ))

        # 构建元数据
        meta = {
            'target_days': self.target_days,
            'actual_cycles': len(self.coupled_events),
            'total_rain_volume': round_to_precision(total_rain_volume),
            'baseline_temp': round_to_precision(self.baseline_temp),
            'original_events': len(self.raw_events),
            'merged_events': len(self.merged_events),
            'pulse_rain_events': pulse_rain_count,
            'pulse_max_duration_min': PULSE_RAIN_MAX_DURATION_MIN
        }

        # 源数据信息
        source_info = {
            'csv_path': self.csv_path,
            'data_range': {
                'start': self.weather_data.start_time.isoformat() if self.weather_data and self.weather_data.start_time else None,
                'end': self.weather_data.end_time.isoformat() if self.weather_data and self.weather_data.end_time else None
            },
            'event_stats': self.event_extractor.get_event_statistics(self.raw_events) if self.event_extractor else {},
            'merged_events': [e.to_dict() for e in self.merged_events]  # 保存合并后事件及加权时间戳
        }

        # 合并信息
        if self.event_merger:
            merge_result = self.event_merger.merge(self.raw_events, max_cycles=len(self.merged_events))
            source_info['merge_info'] = merge_result.to_dict()

        return ExperimentPlan(
            meta=meta,
            sequence=sequence,
            source_info=source_info
        )

    def get_intermediate_results(self) -> dict:
        """
        获取中间处理结果

        Returns:
            包含各阶段结果的字典
        """
        return {
            'weather_data': {
                'record_count': len(self.weather_data) if self.weather_data else 0,
                'time_range': {
                    'start': self.weather_data.start_time.isoformat() if self.weather_data and self.weather_data.start_time else None,
                    'end': self.weather_data.end_time.isoformat() if self.weather_data and self.weather_data.end_time else None
                }
            },
            'raw_events': [e.to_dict() for e in self.raw_events],
            'merged_events': [e.to_dict() for e in self.merged_events],
            'coupled_events': [e.to_dict() for e in self.coupled_events],
            'baseline_temp': self.baseline_temp
        }


# =============================================================================
# 便捷函数
# =============================================================================

def generate_experiment_plan(
    csv_path: str,
    target_days: float = 10.0,
    output_path: Optional[str] = None
) -> ExperimentPlan:
    """
    便捷函数 - 生成实验方案

    Args:
        csv_path: 天气数据 CSV 文件路径
        target_days: 目标实验天数
        output_path: 可选的输出 JSON 文件路径

    Returns:
        ExperimentPlan 实验方案
    """
    generator = ExperimentPlanGenerator(csv_path, target_days)
    plan = generator.generate()

    if output_path:
        plan.save(output_path)

    return plan


def quick_preview(csv_path: str) -> dict:
    """
    快速预览数据基本信息

    Args:
        csv_path: 天气数据 CSV 文件路径

    Returns:
        数据预览信息
    """
    loader = WeatherDataLoader(csv_path)
    data = loader.load()

    extractor = RainEventExtractor()
    events = extractor.extract(data)
    stats = extractor.get_event_statistics(events)

    return {
        'data_range': {
            'start': data.start_time.isoformat() if data.start_time else None,
            'end': data.end_time.isoformat() if data.end_time else None
        },
        'record_count': len(data),
        'event_stats': stats
    }
