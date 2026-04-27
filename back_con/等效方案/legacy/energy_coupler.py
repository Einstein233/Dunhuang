"""
降雨 - 日照能量耦合模块 - 第二阶段

核心逻辑：
- 计算所有事件的平均降雨量和平均 48h 日照能量
- 根据降雨量动态缩放实验室日照强度
- 日照时长固定为 12 小时
"""

from dataclasses import dataclass
from typing import List, Optional

# 兼容模块导入和直接运行
try:
    from .event_extractor import RainEvent
    from .utils import calculate_mean, sqrt_ratio, safe_divide, round_to_precision
except ImportError:
    from event_extractor import RainEvent
    from utils import calculate_mean, sqrt_ratio, safe_divide, round_to_precision


# 常量定义
DEFAULT_SOLAR_DURATION_HOURS = 12  # 实验室日照时长固定为 12 小时
DEFAULT_MAX_SOLAR_INTENSITY = 1000  # 最大日照强度 (W/m²)
DEFAULT_DRY_DURATION_HOURS = 12    # 干燥阶段时长


@dataclass
class CoupledEvent:
    """
    耦合后的事件数据类

    在 RainEvent 基础上增加了实验室映射参数

    Attributes:
        event: 原始降雨事件
        lab_solar_duration: 实验室日照时长 (小时)，固定 12 小时
        lab_solar_intensity: 实验室日照强度 (W/m²)，动态计算
        rain_temp: 降雨阶段目标温度 (°C)，降雨小时内温度中位数
        solar_temp: 日照阶段目标温度 (°C)，白天 8-20 点温度中位数
        dry_temp: 干燥阶段目标温度 (°C)，全时段温度中位数
        wind_speed: 平均风速 (m/s)，全时段平均风速
    """
    event: RainEvent
    lab_solar_duration: float = DEFAULT_SOLAR_DURATION_HOURS
    lab_solar_intensity: float = 0.0
    rain_temp: float = 20.0  # 降雨阶段温度
    solar_temp: float = 35.0  # 日照阶段温度
    dry_temp: float = 20.0  # 干燥阶段温度
    wind_speed: float = 0.0  # 平均风速

    @property
    def total_rain(self) -> float:
        """总降雨量 (mm)"""
        return self.event.total_rain

    @property
    def start_time(self) -> None:
        """原始事件开始时间"""
        return self.event.start_time

    @property
    def end_time(self) -> None:
        """原始事件结束时间"""
        return self.event.end_time

    @property
    def event_id(self) -> int:
        """事件 ID"""
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
            'rain_temp': round_to_precision(self.rain_temp),  # 降雨阶段温度
            'solar_temp': round_to_precision(self.solar_temp),  # 日照阶段温度
            'dry_temp': round_to_precision(self.dry_temp),  # 干燥阶段温度
            'wind_speed': round_to_precision(self.wind_speed),  # 平均风速
            'original_esolar_48': round_to_precision(self.event.esolar_48)
        }


class EnergyCoupler:
    """
    能量耦合器

    将自然降雨事件映射为实验室可执行的等效事件
    """

    def __init__(
        self,
        solar_duration: float = DEFAULT_SOLAR_DURATION_HOURS,
        max_solar_intensity: float = DEFAULT_MAX_SOLAR_INTENSITY,
        dry_duration: float = DEFAULT_DRY_DURATION_HOURS
    ):
        """
        初始化耦合器

        Args:
            solar_duration: 实验室日照时长 (小时)，默认 12 小时
            max_solar_intensity: 最大日照强度 (W/m²)，默认 1000
            dry_duration: 干燥阶段时长 (小时)，默认 12 小时
        """
        self.solar_duration = solar_duration
        self.max_solar_intensity = max_solar_intensity
        self.dry_duration = dry_duration

        # 基准值（在 couple 方法中计算）
        self.avg_rain: Optional[float] = None
        self.avg_esolar_48: Optional[float] = None

    def couple(
        self,
        events: List[RainEvent],
        baseline_temp: Optional[float] = None
    ) -> List[CoupledEvent]:
        """
        对降雨事件进行能量耦合

        Args:
            events: 降雨事件列表
            baseline_temp: 基准温度，如果不传则使用事件中的温度中位数

        Returns:
            CoupledEvent 列表
        """
        if not events:
            return []

        # 计算基准值
        self._calculate_baselines(events)

        # 创建耦合事件
        coupled_events = []
        for event in events:
            coupled = self._create_coupled_event(event, baseline_temp)
            coupled_events.append(coupled)

        return coupled_events

    def _calculate_baselines(self, events: List[RainEvent]) -> None:
        """
        计算基准值：平均降雨量和平均 48h 日照能量

        Args:
            events: 降雨事件列表
        """
        rain_values = [e.total_rain for e in events]
        esolar_values = [e.esolar_48 for e in events]

        self.avg_rain = calculate_mean(rain_values)
        self.avg_esolar_48 = calculate_mean(esolar_values)

    def _create_coupled_event(
        self,
        event: RainEvent,
        baseline_temp: Optional[float]
    ) -> CoupledEvent:
        """
        创建单个耦合事件

        Args:
            event: 降雨事件
            baseline_temp: 基准温度

        Returns:
            CoupledEvent 对象
        """
        coupled = CoupledEvent(
            event=event,
            lab_solar_duration=self.solar_duration,
            rain_temp=event.rain_temp_median,  # 降雨阶段温度：降雨小时内温度中位数
            solar_temp=event.daytime_temp_median,  # 日照阶段温度：白天 8-20 点温度中位数
            dry_temp=event.dry_temp_median,  # 干燥阶段温度：全时段温度中位数
            wind_speed=event.wind_speed_avg  # 平均风速：全时段平均风速
        )

        # 计算实验室日照强度
        coupled.lab_solar_intensity = self._calculate_solar_intensity(
            event.total_rain
        )

        return coupled

    def _calculate_solar_intensity(self, rain_volume: float) -> float:
        """
        根据降雨量计算实验室日照强度

        算法：
        - 若 Vi < Vavg，采用开平方比例递减：I_lab = I_max * sqrt(Vi / Vavg)
        - 若 Vi >= Vavg，使用最大强度

        Args:
            rain_volume: 降雨量 (mm)

        Returns:
            日照强度 (W/m²)
        """
        if self.avg_rain is None or self.avg_rain <= 0:
            return self.max_solar_intensity

        if rain_volume >= self.avg_rain:
            # 降雨量大于等于平均值，使用最大强度
            return self.max_solar_intensity
        else:
            # 降雨量小于平均值，使用开平方比例递减
            ratio = sqrt_ratio(rain_volume, self.avg_rain)
            return self.max_solar_intensity * ratio

    def get_cycle_duration(self) -> float:
        """
        计算单次循环的标准时长

        单次循环 = 降雨执行时长 + 12h 日照 + 12h 干燥
        注意：降雨执行时长取决于具体事件的降雨量和选择的强度

        Returns:
            基础循环时长（不含降雨执行时间）
        """
        return self.solar_duration + self.dry_duration

    def estimate_total_duration(
        self,
        events: List[CoupledEvent],
        rain_intensity: float
    ) -> float:
        """
        估算总实验时长

        Args:
            events: 耦合事件列表
            rain_intensity: 降雨强度 (mm/h)

        Returns:
            总时长 (小时)
        """
        if rain_intensity <= 0:
            return 0.0

        total_hours = 0.0

        for event in events:
            # 降雨执行时长 ti = Vi / I_selected
            rain_duration = safe_divide(event.total_rain, rain_intensity)
            total_hours += rain_duration + self.solar_duration + self.dry_duration

        return total_hours

    def get_baselines(self) -> dict:
        """
        获取基准值信息

        Returns:
            包含基准值的字典
        """
        return {
            'avg_rain': round_to_precision(self.avg_rain or 0.0),
            'avg_esolar_48': round_to_precision(self.avg_esolar_48 or 0.0)
        }
