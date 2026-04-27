"""
CSEE-Gen 核心模块

包含所有内部实现模块，不直接使用。
请从根目录导入所需类。
"""

from .config import (
    ExperimentConfig,
    DEFAULT_CONFIG,
    NO_RAIN_THRESHOLD_HOURS,
    SOLAR_ACCUMULATION_HOURS,
    SOLAR_DURATION_HOURS,
    DRY_DURATION_HOURS,
    PULSE_RAIN_MAX_DURATION_MIN,
    RAIN_INTENSITY_GEARS,
    MAX_SOLAR_INTENSITY
)

from .data_loader import (
    WeatherRecord,
    WeatherDataset,
    WeatherDataLoader,
    ClimateStatistics,
    load_weather_data,
    load_weather_with_stats
)

from .experiment_mapper import (
    RainEvent,
    CoupledEvent,
    ExperimentStep,
    ExperimentPlan,
    MergeResult,
    RainEventExtractor,
    EventMerger,
    EnergyCoupler,
    ExperimentPlanGenerator,
    generate_experiment_plan
)

from .output_formatter import (
    HardwareStep,
    ExperimentPlanFormatter,
    generate_hardware_csv,
    convert_plan_to_hardware_steps,
    OUTPUT_COLUMNS
)

from . import utils

from .snow_ftc_mapper import (
    SnowEvent,
    FTCEvent,
    SnowFTCStep,
    SnowFTCPlan,
    LabFTCEvent,                # 新增：实验室标准冻融事件
    SnowEventExtractor,
    FTCEventIdentifier,
    FTCEquivalenceConverter,    # 新增：冻融等效转换器
    SnowDepthMapper,
    SnowFTCPlanGenerator,
    SnowFTCFormatter,
    generate_snow_ftc_plan,
    count_snow_events,
    # 配置常量
    DEFAULT_SNOW_FTC_CONFIG,
    FTC_DAMAGE_ALPHA,
    FTC_DAMAGE_BETA,
    FTC_FREEZE_THRESHOLD,
    FTC_THAW_THRESHOLD,
    SNOW_TEMP_THRESHOLD,
    LAB_FTC_TMIN,
    LAB_FTC_TMAX,
    LAB_FTC_FREEZE_HOURS,
    LAB_FTC_THAW_HOURS,
    SNOW_DURATION_MIN,
    SNOW_TEMP_MIN,
    SNOW_TEMP_MAX
)

__version__ = '2.0.0'
__all__ = [
    'ExperimentConfig', 'DEFAULT_CONFIG',
    'NO_RAIN_THRESHOLD_HOURS', 'SOLAR_ACCUMULATION_HOURS',
    'SOLAR_DURATION_HOURS', 'DRY_DURATION_HOURS',
    'PULSE_RAIN_MAX_DURATION_MIN', 'RAIN_INTENSITY_GEARS', 'MAX_SOLAR_INTENSITY',
    'WeatherRecord', 'WeatherDataset', 'WeatherDataLoader', 'ClimateStatistics',
    'load_weather_data', 'load_weather_with_stats',
    'RainEvent', 'CoupledEvent', 'ExperimentStep', 'ExperimentPlan', 'MergeResult',
    'RainEventExtractor', 'EventMerger', 'EnergyCoupler', 'ExperimentPlanGenerator',
    'generate_experiment_plan',
    # 降雪 - 冻融模块
    'SnowEvent', 'FTCEvent', 'SnowFTCStep', 'SnowFTCPlan',
    'SnowEventExtractor', 'FTCEventIdentifier', 'SnowDepthMapper',
    'SnowFTCPlanGenerator', 'SnowFTCFormatter', 'generate_snow_ftc_plan',
    'DEFAULT_SNOW_FTC_CONFIG',
    'utils'
]
