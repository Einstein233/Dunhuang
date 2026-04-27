"""
配置模块 - 集中管理所有超参数和常量

将所有可配置参数集中定义，便于后续调整和实验
"""

from dataclasses import dataclass
from typing import List


# =============================================================================
# 事件提取配置
# =============================================================================

# 无雨界限时间（小时）：超过此时间无雨则认为是新事件
NO_RAIN_THRESHOLD_HOURS = 3.0

# 日照能量累计时间（小时）：计算降雨结束后多少小时内的日照能量
SOLAR_ACCUMULATION_HOURS = 48


# =============================================================================
# 实验循环配置
# =============================================================================

# 日照阶段时长（小时）
SOLAR_DURATION_HOURS = 12.0

# 干燥阶段时长（小时）
DRY_DURATION_HOURS = 12.0

# 单次循环降雨基础时长（小时）
CYCLE_RAIN_DURATION_HOURS = 1.0


# =============================================================================
# 脉冲降雨配置
# =============================================================================

# 单次降雨最大时长（分钟），超过此值将触发脉冲切割
PULSE_RAIN_MAX_DURATION_MIN = 30.0


# =============================================================================
# 降雨强度配置
# =============================================================================

# 固定降雨强度档位 (mm/h)
RAIN_INTENSITY_GEARS: List[float] = [20, 40, 60]


# =============================================================================
# 日照强度配置
# =============================================================================

# 最大日照强度 (W/m²)
MAX_SOLAR_INTENSITY = 1000


# =============================================================================
# 温度计算配置
# =============================================================================

# 白天时间段定义（小时）：8-20 点为白天
DAYTIME_START_HOUR = 8
DAYTIME_END_HOUR = 20


# =============================================================================
# 配置数据类
# =============================================================================

@dataclass
class ExperimentConfig:
    """
    实验配置数据类

    将所有配置参数封装在一个数据类中，便于传递和管理

    Attributes:
        # 事件提取
        no_rain_threshold_hours: 无雨界限时间（小时）
        solar_accumulation_hours: 日照能量累计时间（小时）

        # 实验循环
        solar_duration_hours: 日照阶段时长（小时）
        dry_duration_hours: 干燥阶段时长（小时）
        cycle_rain_duration_hours: 单次循环降雨基础时长（小时）

        # 脉冲降雨
        pulse_rain_max_duration_min: 单次降雨最大时长（分钟）

        # 降雨强度
        rain_intensity_gears: 降雨强度档位列表

        # 日照强度
        max_solar_intensity: 最大日照强度 (W/m²)

        # 温度计算
        daytime_start_hour: 白天开始小时
        daytime_end_hour: 白天结束小时
    """
    # 事件提取
    no_rain_threshold_hours: float = NO_RAIN_THRESHOLD_HOURS
    solar_accumulation_hours: int = SOLAR_ACCUMULATION_HOURS

    # 实验循环
    solar_duration_hours: float = SOLAR_DURATION_HOURS
    dry_duration_hours: float = DRY_DURATION_HOURS
    cycle_rain_duration_hours: float = CYCLE_RAIN_DURATION_HOURS

    # 脉冲降雨
    pulse_rain_max_duration_min: float = PULSE_RAIN_MAX_DURATION_MIN

    # 降雨强度
    rain_intensity_gears: List[float] = None

    # 日照强度
    max_solar_intensity: float = MAX_SOLAR_INTENSITY

    # 温度计算
    daytime_start_hour: int = DAYTIME_START_HOUR
    daytime_end_hour: int = DAYTIME_END_HOUR

    def __post_init__(self):
        """初始化后设置默认值"""
        if self.rain_intensity_gears is None:
            self.rain_intensity_gears = RAIN_INTENSITY_GEARS

    @property
    def standard_cycle_duration(self) -> float:
        """标准循环时长（小时）= 降雨 + 日照 + 干燥"""
        return (self.cycle_rain_duration_hours +
                self.solar_duration_hours +
                self.dry_duration_hours)


# 默认配置实例
DEFAULT_CONFIG = ExperimentConfig()
