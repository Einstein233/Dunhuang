#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
降雪 - 冻融循环等效映射模块（物理厚度直投版）

核心功能：将自然降雪和冻融循环数据映射为实验室可执行的等效实验方案。

【等效原理 - 物理厚度直投映射】
1. 直接统计全年（或数据周期内）的降雪总深度 (mm)
2. 将总雪深均分到每次冻融循环的"降雪阶段"
3. 雪花机按计算的降雪强度 (mm/h) 直接输出对应厚度的积雪

【实验流程】
每次冻融循环包含三个阶段：
  阶段 1: 降雪阶段 (Snow)       - 风雪舱，雪花机工作，温度 -10℃~-2℃
  阶段 2: 冻结阶段 (Freeze)     - 风雪舱，温度降低至 Tmin，无降雪
  阶段 3: 融化阶段 (Thaw)       - 温度升高至 Tmax，完成一次循环

【数据流向】
天气数据 → 降雪深度统计 + 冻融事件识别 → 厚度映射计算 → 实验步骤生成
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any, Tuple
import math

# 兼容模块导入
try:
    from .config import ExperimentConfig
    from .data_loader import WeatherDataset, WeatherRecord, ClimateStatistics
    from .utils import calculate_mean, calculate_median, calculate_sum, hours_between
except ImportError:
    from config import ExperimentConfig
    from data_loader import WeatherDataset, WeatherRecord, ClimateStatistics
    from utils import calculate_mean, calculate_median, calculate_sum, hours_between


# =============================================================================
# 配置常量（可根据需要调整）
# =============================================================================

# -------------------- 冻融损伤计算参数 --------------------
# 冻融损伤值计算公式：D = α * |ΔT| * (T_max - T_thaw) * (T_freeze - T_min) * t^β
# 其中：
#   ΔT = T_max - T_min (温差)
#   T_max: 循环最高温，T_min: 循环最低温
#   T_thaw: 融化阈值，T_freeze: 冻结阈值
#   t: 持续时间 (小时)
#   α: 权重系数，β: 时间指数

FTC_DAMAGE_ALPHA = 1.0        # α: 冻融损伤权重系数
FTC_DAMAGE_BETA = 0.5         # β: 时间指数（sqrt 效应）

# 温度阈值
FTC_FREEZE_THRESHOLD = -2.2   # 冻结启动阈值 (°C)，低于此值认为开始冻结
FTC_THAW_THRESHOLD = 1.2      # 融化启动阈值 (°C)，高于此值认为开始融化
SNOW_TEMP_THRESHOLD = 0.0     # 降雪温度阈值 (°C)，低于此温度才降雪

# -------------------- 实验室标准冻融循环参数 --------------------
# 实验室标准冻融循环的定义（每次实验都按此标准执行）

LAB_FTC_TMIN = -18.0          # 实验室最低温 (°C)
LAB_FTC_TMAX = 5.0            # 实验室最高温 (°C)
LAB_FTC_FREEZE_HOURS = 6.0    # 冻结阶段时长 (小时) - 延长冻结时间保证冻融有效性
LAB_FTC_THAW_HOURS = 4.0      # 融化阶段时长 (小时) - 延长融化时间保证充分融化

# -------------------- 降雪阶段参数 --------------------

SNOW_DURATION_MIN = 60.0      # 单次降雪阶段时长 (分钟)
SNOW_TEMP_MIN = -10.0         # 降雪阶段最低温 (°C)，保证雪花形态
SNOW_TEMP_MAX = -2.0          # 降雪阶段最高温 (°C)，保证雪花形态

# -------------------- 其他参数 --------------------

MIN_FTC_DURATION_HOURS = 1.0  # 最小冻融循环时长 (小时)，小于此值的循环被视为无效


# =============================================================================
# 兼容性配置字典（保留向后兼容）
# =============================================================================

DEFAULT_SNOW_FTC_CONFIG = {
    # 温度阈值
    'freeze_start': FTC_FREEZE_THRESHOLD,
    'thaw_start': FTC_THAW_THRESHOLD,
    'snow_temp_threshold': SNOW_TEMP_THRESHOLD,

    # 实验室标准循环参数
    'lab_Tmin': LAB_FTC_TMIN,
    'lab_Tmax': LAB_FTC_TMAX,
    'lab_freeze_hours': LAB_FTC_FREEZE_HOURS,
    'lab_thaw_hours': LAB_FTC_THAW_HOURS,

    # 降雪阶段参数
    'snow_duration_min': SNOW_DURATION_MIN,
    'snow_temp_min': SNOW_TEMP_MIN,
    'snow_temp_max': SNOW_TEMP_MAX,

    # 冻融损伤计算参数
    'ftc_damage_alpha': FTC_DAMAGE_ALPHA,
    'ftc_damage_beta': FTC_DAMAGE_BETA,
}


# =============================================================================
# 数据结构定义
# =============================================================================

@dataclass
class SnowEvent:
    """
    降雪事件数据类（物理厚度直投版）

    Attributes:
        event_id: 事件 ID
        total_snow_depth: 总降雪深度 (mm) - 直接累加，不做水当量转换
        start_time: 事件开始时间
        end_time: 事件结束时间
        records: 包含的原始记录
        temp_median: 降雪阶段温度中位数
    """
    event_id: int
    total_snow_depth: float     # 直接记录雪深，不再记录 total_water
    start_time: datetime
    end_time: datetime
    records: List[WeatherRecord] = field(default_factory=list)
    temp_median: float = 0.0

    @property
    def duration_hours(self) -> float:
        """事件持续时间 (小时)"""
        return hours_between(self.start_time, self.end_time)

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'event_id': self.event_id,
            'total_snow_depth': round(self.total_snow_depth, 2),
            'start_time': self.start_time.isoformat(),
            'end_time': self.end_time.isoformat(),
            'duration_hours': round(self.duration_hours, 2),
            'temp_median': round(self.temp_median, 2)
        }


@dataclass
class FTCEvent:
    """
    冻融循环事件数据类

    基于温度循环定义的冻融事件

    Attributes:
        event_id: 事件 ID
        start_time: 事件开始时间
        end_time: 事件结束时间
        duration_hours: 持续时间
        tmin: 最低温 (°C)
        tmax: 最高温 (°C)
        freeze_intensity: 冻结幅值
        thaw_intensity: 融化幅值
        intensity_ftc: 最终冻融强度（旧版本兼容）
        ftc_damage: 冻融损伤值（新版本）
        lab_equivalence: 等效实验室次数（新版本）
    """
    event_id: int
    start_time: datetime
    end_time: datetime
    duration_hours: float
    tmin: float
    tmax: float
    freeze_intensity: float
    thaw_intensity: float
    intensity_ftc: float
    ftc_damage: float = 0.0        # 冻融损伤值
    lab_equivalence: float = 0.0   # 等效实验室次数

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'event_id': self.event_id,
            'start_time': self.start_time.isoformat(),
            'end_time': self.end_time.isoformat(),
            'duration_hours': round(self.duration_hours, 2),
            'tmin': round(self.tmin, 2),
            'tmax': round(self.tmax, 2),
            'freeze_intensity': round(self.freeze_intensity, 2),
            'thaw_intensity': round(self.thaw_intensity, 2),
            'intensity_ftc': round(self.intensity_ftc, 4),
            'ftc_damage': round(self.ftc_damage, 4) if self.ftc_damage else None,
            'lab_equivalence': round(self.lab_equivalence, 4) if self.lab_equivalence else None
        }


@dataclass
class SnowFTCStep:
    """
    降雪 - 冻融实验步骤数据类

    Attributes:
        step: 步骤序号
        mode: 模式 (Snow/Freeze/Thaw)
        duration_min: 持续时间 (分钟)
        target_temp: 目标温度 (°C)
        snow_depth_mm: 该步骤需完成的降雪深度 (mm) - 物理厚度
        snow_intensity_mmh: 硬件降雪强度 (mm/h) - 由厚度和时长计算
        is_snowing: 是否在降雪
    """
    step: int
    mode: str
    duration_min: float
    target_temp: float
    snow_depth_mm: float = 0.0      # 该步骤需完成的降雪深度 (mm)
    snow_intensity_mmh: float = 0.0 # 硬件降雪强度 (mm/h)
    is_snowing: bool = False

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'step': self.step,
            'mode': self.mode,
            'duration_min': round(self.duration_min, 1),
            'target_temp': round(self.target_temp, 1),
            'snow_depth_mm': round(self.snow_depth_mm, 2),
            'snow_intensity_mmh': round(self.snow_intensity_mmh, 2),
            'is_snowing': self.is_snowing
        }


@dataclass
class SnowFTCPlan:
    """
    降雪 - 冻融实验方案数据类

    Attributes:
        meta: 元数据
        sequence: 实验步骤序列
        snow_events: 降雪事件列表
        ftc_events: 冻融事件列表
        source_info: 源数据信息
    """
    meta: Dict[str, Any]
    sequence: List[SnowFTCStep]
    snow_events: List[SnowEvent] = field(default_factory=list)
    ftc_events: List[FTCEvent] = field(default_factory=list)
    source_info: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'experiment_meta': self.meta,
            'sequence': [step.to_dict() for step in self.sequence],
            'snow_events': [e.to_dict() for e in self.snow_events],
            'ftc_events': [e.to_dict() for e in self.ftc_events],
            'source_info': self.source_info
        }

    def to_json(self, indent: int = 2) -> str:
        """转换为 JSON 字符串"""
        import json
        return json.dumps(self.to_dict(), indent=indent, ensure_ascii=False)

    def save(self, filepath: str) -> None:
        """保存为 JSON 文件"""
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(self.to_json())


# =============================================================================
# 降雪事件提取器（物理厚度直投版）
# =============================================================================

class SnowEventExtractor:
    """
    降雪事件提取器（物理厚度直投版）

    从天气数据中提取降雪事件，直接统计雪深，不做水当量转换
    """

    def __init__(self, config: Optional[ExperimentConfig] = None,
                 snow_temp_threshold: float = 0.0):
        """
        Args:
            config: 实验配置
            snow_temp_threshold: 降雪温度阈值 (°C)
        """
        self.config = config or ExperimentConfig()
        self.snow_temp_threshold = snow_temp_threshold

    def extract(self, dataset: WeatherDataset) -> List[SnowEvent]:
        """
        提取降雪事件

        Args:
            dataset: 天气数据集

        Returns:
            SnowEvent 列表
        """
        records = dataset.get_all()
        if not records:
            return []

        events = self._identify_snow_events(records)
        self._calculate_temp_stats(events)

        return events

    def _identify_snow_events(self, records: List[WeatherRecord]) -> List[SnowEvent]:
        """识别降雪事件"""
        events = []
        current_event_records = []
        event_id = 0

        for record in records:
            # 判断是否降雪：温度低于阈值且有降雪
            is_snow = (record.temperature_2m <= self.snow_temp_threshold and
                       record.snowfall > 0)

            if is_snow:
                if not current_event_records:
                    event_id += 1
                current_event_records.append(record)
            else:
                if current_event_records:
                    # 一场降雪结束
                    event = self._create_event(event_id, current_event_records)
                    events.append(event)
                    current_event_records = []

        # 处理最后一场雪
        if current_event_records:
            event = self._create_event(event_id, current_event_records)
            events.append(event)

        return events

    def _create_event(self, event_id: int, records: List[WeatherRecord]) -> SnowEvent:
        """创建降雪事件对象 - 直接累加雪深"""
        total_snow_depth = sum(r.snowfall for r in records)
        start_time = records[0].time
        end_time = records[-1].time

        return SnowEvent(
            event_id=event_id,
            total_snow_depth=total_snow_depth,
            start_time=start_time,
            end_time=end_time,
            records=records.copy()
        )

    def _calculate_temp_stats(self, events: List[SnowEvent]):
        """计算温度统计"""
        for event in events:
            if event.records:
                temps = [r.temperature_2m for r in event.records]
                event.temp_median = calculate_median(temps)

    def get_statistics(self, events: List[SnowEvent]) -> Dict[str, Any]:
        """获取降雪统计信息

        注意：CSV 中 snowfall 列的单位是 cm，因此：
        - total_snow_depth_cm: 总降雪深度 (cm)
        - total_snow_depth_mm: 总降雪深度 (mm) = total_snow_depth_cm × 10
        """
        if not events:
            return {
                'total_snow_events': 0,
                'total_snow_depth_cm': 0.0,
                'total_snow_depth_mm': 0.0,
                'avg_snow_per_event_cm': 0.0,
                'avg_snow_per_event_mm': 0.0
            }

        # CSV 中 snowfall 的单位是 cm，直接累加得到总 cm 数
        total_snow_depth_cm = sum(e.total_snow_depth for e in events)

        return {
            'total_snow_events': len(events),
            'total_snow_depth_cm': round(total_snow_depth_cm, 2),
            'total_snow_depth_mm': round(total_snow_depth_cm * 10.0, 2),  # cm → mm 转换
            'avg_snow_per_event_cm': round(total_snow_depth_cm / len(events), 2) if events else 0.0,
            'avg_snow_per_event_mm': round((total_snow_depth_cm * 10.0) / len(events), 2) if events else 0.0,
            'max_snow_event_cm': round(max(e.total_snow_depth for e in events), 2) if events else 0.0,
            'min_snow_event_cm': round(min(e.total_snow_depth for e in events), 2) if events else 0.0
        }


# =============================================================================
# 冻融循环识别器
# =============================================================================

class FTCEventIdentifier:
    """
    冻融循环事件识别器

    基于温度循环识别冻融事件：冻结→融化→再冻结
    """

    def __init__(self,
                 freeze_start: float = -2.2,
                 thaw_start: float = 1.2,
                 min_freeze_hours: int = 1,
                 min_thaw_hours: int = 1):
        """
        Args:
            freeze_start: 冻结启动阈值 (°C)
            thaw_start: 融化启动阈值 (°C)
            min_freeze_hours: 最小冻结时长 (小时)
            min_thaw_hours: 最小融化时长 (小时)
        """
        self.freeze_start = freeze_start
        self.thaw_start = thaw_start
        self.min_freeze_hours = min_freeze_hours
        self.min_thaw_hours = min_thaw_hours

    def identify(self, dataset: WeatherDataset,
                 humidity_col: bool = True) -> List[FTCEvent]:
        """
        识别冻融循环事件

        Args:
            dataset: 天气数据集
            humidity_col: 是否考虑湿度列

        Returns:
            FTCEvent 列表
        """
        records = dataset.get_all()
        if not records:
            return []

        # 转换为便于处理的格式
        data = []
        for r in records:
            data.append({
                'time': r.time,
                'temp': r.temperature_2m,
                'humidity': r.relative_humidity if humidity_col else 50.0
            })

        events = self._identify_ftc_cycles(data)
        return events

    def _identify_ftc_cycles(self, data: List[Dict]) -> List[FTCEvent]:
        """识别冻融循环"""
        events = []
        event_id = 0

        # 状态机变量
        in_cycle = False
        has_thawed = False
        start_idx = None
        cycle_data = []

        for i, d in enumerate(data):
            temp = d['temp']

            if not in_cycle:
                # 检测冻结启动
                if temp < self.freeze_start:
                    in_cycle = True
                    has_thawed = False
                    start_idx = i
                    cycle_data = [d]
            else:
                cycle_data.append(d)

                if temp > self.thaw_start:
                    # 进入融化阶段
                    has_thawed = True
                elif temp < self.freeze_start:
                    if has_thawed:
                        # 冻结→融化→再冻结：完成一次循环
                        event_id += 1
                        event = self._create_ftc_event(event_id, cycle_data)
                        if event:
                            events.append(event)
                        in_cycle = False
                        has_thawed = False
                        start_idx = None
                        cycle_data = []

        # 处理未闭合事件
        if in_cycle and has_thawed and cycle_data:
            event_id += 1
            event = self._create_ftc_event(event_id, cycle_data)
            if event:
                events.append(event)

        return events

    def _create_ftc_event(self, event_id: int,
                          cycle_data: List[Dict]) -> Optional[FTCEvent]:
        """创建冻融事件"""
        if len(cycle_data) < 2:
            return None

        start_time = cycle_data[0]['time']
        end_time = cycle_data[-1]['time']
        duration = hours_between(start_time, end_time)

        temps = [d['temp'] for d in cycle_data]
        tmin = min(temps)
        tmax = max(temps)

        # 计算幅值
        freeze_intensity = max(0.0, self.freeze_start - tmin)
        thaw_intensity = max(0.0, tmax - self.thaw_start + 0.001)

        # 计算强度 (简化版本，不含湿度)
        intensity = freeze_intensity * thaw_intensity

        # 计算冻融损伤值（使用默认参数）
        mapper = SnowDepthMapper()
        ftc_damage = mapper.calc_ftc_damage(tmin, tmax, duration)

        return FTCEvent(
            event_id=event_id,
            start_time=start_time,
            end_time=end_time,
            duration_hours=duration,
            tmin=tmin,
            tmax=tmax,
            freeze_intensity=freeze_intensity,
            thaw_intensity=thaw_intensity,
            intensity_ftc=intensity,
            ftc_damage=ftc_damage,
            lab_equivalence=0.0  # 后续由等效转换器计算
        )


# =============================================================================
# 降雪厚度映射器与冻融损伤计算器
# =============================================================================

class SnowDepthMapper:
    """
    降雪厚度映射器

    负责：
    1. 将全年总雪深分配到每次降雪实验（保守原则：向上取整）
    2. 计算冻融损伤值
    3. 计算自然冻融事件与实验室标准事件的等效比
    """

    def __init__(self,
                 alpha: float = FTC_DAMAGE_ALPHA,
                 beta: float = FTC_DAMAGE_BETA,
                 freeze_threshold: float = FTC_FREEZE_THRESHOLD,
                 thaw_threshold: float = FTC_THAW_THRESHOLD):
        """
        Args:
            alpha: 冻融损伤权重系数
            beta: 时间指数
            freeze_threshold: 冻结启动阈值 (°C)
            thaw_threshold: 融化启动阈值 (°C)
        """
        self.alpha = alpha
        self.beta = beta
        self.freeze_threshold = freeze_threshold
        self.thaw_threshold = thaw_threshold

    def distribute_snow_depth(self, total_snow_depth_mm: float,
                               n_cycles: int) -> float:
        """
        将总雪深均分到每次循环

        Args:
            total_snow_depth_mm: 总降雪深度 (mm)
            n_cycles: 循环次数

        Returns:
            每次循环的降雪深度 (mm)
        """
        if n_cycles <= 0:
            return 0.0
        return total_snow_depth_mm / n_cycles

    def distribute_snow_depth_conservative(self, total_snow_depth_cm: float,
                                            n_cycles: int) -> Tuple[float, float]:
        """
        将总雪深分配到每次降雪实验（保守原则）

        核心逻辑：
        1. 将 cm 转换为 mm（×10）
        2. 计算每次降雪量，向上取整到 mm 精度
        3. 确保总降雪量之和不低于实际总降雪量

        Args:
            total_snow_depth_cm: 总降雪深度 (cm)
            n_cycles: 循环次数

        Returns:
            (snow_per_cycle_mm, total_snow_mm) 元组：
            - snow_per_cycle_mm: 每次循环的降雪深度 (mm)，向上取整
            - total_snow_mm: 实际分配的总降雪量 (mm)
        """
        if n_cycles <= 0:
            return (0.0, 0.0)

        # 1. cm → mm 转换
        total_snow_mm = total_snow_depth_cm * 10.0

        # 2. 计算每次降雪量（原始值）
        snow_per_cycle_raw = total_snow_mm / n_cycles

        # 3. 向上取整到 mm 精度（保守原则）
        snow_per_cycle_mm = math.ceil(snow_per_cycle_raw)

        # 4. 计算实际分配的总降雪量
        actual_total_snow_mm = snow_per_cycle_mm * n_cycles

        return (snow_per_cycle_mm, actual_total_snow_mm)

    def calc_snow_intensity(self, snow_depth_mm: float,
                            duration_min: float) -> float:
        """
        计算硬件降雪强度 (mm/h)

        公式：强度 = 降雪深度 ÷ (时长/60)

        Args:
            snow_depth_mm: 降雪深度 (mm)
            duration_min: 降雪时长 (分钟)

        Returns:
            降雪强度 (mm/h)
        """
        if duration_min <= 0:
            return 0.0
        duration_hours = duration_min / 60.0
        return snow_depth_mm / duration_hours

    def calc_ftc_damage(self, tmin: float, tmax: float,
                        duration_hours: float) -> float:
        """
        计算冻融损伤值

        公式：D = α * |ΔT| * (T_max - T_thaw) * (T_freeze - T_min) * t^β

        其中：
        - ΔT = T_max - T_min (温差)
        - T_thaw: 融化阈值
        - T_freeze: 冻结阈值
        - t: 持续时间 (小时)
        - α: 权重系数
        - β: 时间指数

        Args:
            tmin: 循环最低温 (°C)
            tmax: 循环最高温 (°C)
            duration_hours: 持续时间 (小时)

        Returns:
            冻融损伤值
        """
        # 温差
        delta_t = abs(tmax - tmin)

        # 融化幅值（高于融化阈值的部分）
        thaw_amplitude = max(0.0, tmax - self.thaw_threshold)

        # 冻结幅值（低于冻结阈值的部分）
        freeze_amplitude = max(0.0, self.freeze_threshold - tmin)

        # 时间因子
        time_factor = math.pow(duration_hours, self.beta)

        # 损伤值
        damage = self.alpha * delta_t * thaw_amplitude * freeze_amplitude * time_factor

        return damage

    def calc_lab_ftc_damage(self) -> float:
        """
        计算实验室标准冻融循环的损伤值

        Returns:
            实验室标准冻融损伤值
        """
        return self.calc_ftc_damage(
            tmin=LAB_FTC_TMIN,
            tmax=LAB_FTC_TMAX,
            duration_hours=LAB_FTC_FREEZE_HOURS + LAB_FTC_THAW_HOURS
        )

    def calc_ftc_equivalence_ratio(self, natural_damage: float,
                                    lab_damage: float) -> float:
        """
        计算冻融等效转换比

        公式：等效比 = 自然冻融损伤值 ÷ 实验室标准损伤值

        Args:
            natural_damage: 自然冻融事件损伤值
            lab_damage: 实验室标准冻融损伤值

        Returns:
            等效转换比（表示 1 次自然事件相当于多少次实验室事件）
        """
        if lab_damage <= 0:
            return 0.0
        return natural_damage / lab_damage


# =============================================================================
# 冻融等效转换器（新增）
# =============================================================================

@dataclass
class LabFTCEvent:
    """
    实验室标准冻融事件数据类

    Attributes:
        event_id: 事件 ID
        source_natural_events: 源自然事件 ID 列表
        source_damage_total: 源自然事件损伤总值
        lab_equivalence_count: 等效实验室次数（向上取整后的实际值）
        damage_ratio: 损伤比值（转换前）
    """
    event_id: int
    source_natural_events: List[int]
    source_damage_total: float
    lab_equivalence_count: float
    damage_ratio: float

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            'event_id': self.event_id,
            'source_natural_events': self.source_natural_events,
            'source_damage_total': round(self.source_damage_total, 4),
            'lab_equivalence_count': round(self.lab_equivalence_count, 2),
            'damage_ratio': round(self.damage_ratio, 4)
        }


class FTCEquivalenceConverter:
    """
    冻融等效转换器

    将自然冻融事件转换为实验室标准冻融事件：
    【核心原则：总损伤量等效】
    1. 计算所有自然事件的总损伤值
    2. 计算实验室标准事件的损伤值
    3. 相除得到等效次数（向上取整，保守原则）
    """

    def __init__(self,
                 damage_alpha: float = FTC_DAMAGE_ALPHA,
                 damage_beta: float = FTC_DAMAGE_BETA,
                 freeze_threshold: float = FTC_FREEZE_THRESHOLD,
                 thaw_threshold: float = FTC_THAW_THRESHOLD):
        """
        Args:
            damage_alpha: 冻融损伤权重系数
            damage_beta: 时间指数
            freeze_threshold: 冻结启动阈值 (°C)
            thaw_threshold: 融化启动阈值 (°C)
        """
        self.mapper = SnowDepthMapper(
            alpha=damage_alpha,
            beta=damage_beta,
            freeze_threshold=freeze_threshold,
            thaw_threshold=thaw_threshold
        )
        self.lab_damage = self.mapper.calc_lab_ftc_damage()

    def convert(self, natural_events: List[FTCEvent]) -> List[LabFTCEvent]:
        """
        将自然冻融事件转换为实验室标准事件（总损伤量等效）

        Args:
            natural_events: 自然冻融事件列表

        Returns:
            LabFTCEvent 列表
        """
        if not natural_events:
            return []

        # 计算总自然损伤
        total_natural_damage = sum(e.ftc_damage for e in natural_events)

        # 计算总等效比
        total_damage_ratio = total_natural_damage / self.lab_damage

        # 向上取整得到实验室次数（保守原则）
        lab_count = math.ceil(total_damage_ratio)

        # 更新原事件的等效次数（用于记录）
        for event in natural_events:
            # 按损伤比例分配等效次数
            event.lab_equivalence = event.ftc_damage / self.lab_damage

        # 创建单个实验室事件（代表所有自然事件的总等效）
        return [LabFTCEvent(
            event_id=1,
            source_natural_events=[e.event_id for e in natural_events],
            source_damage_total=total_natural_damage,
            lab_equivalence_count=lab_count,
            damage_ratio=total_damage_ratio
        )]

    def get_total_lab_events(self, lab_events: List[LabFTCEvent]) -> int:
        """
        获取总的实验室标准事件次数

        Args:
            lab_events: 实验室事件列表

        Returns:
            总的实验室事件次数
        """
        return sum(int(e.lab_equivalence_count) for e in lab_events)

    def get_summary(self, natural_events: List[FTCEvent],
                    lab_events: List[LabFTCEvent]) -> Dict[str, Any]:
        """
        获取转换摘要

        Args:
            natural_events: 自然事件列表
            lab_events: 实验室事件列表

        Returns:
            转换摘要字典
        """
        total_natural = len(natural_events)
        total_lab = self.get_total_lab_events(lab_events)
        total_natural_damage = sum(e.ftc_damage for e in natural_events) if natural_events else 0.0

        return {
            'total_natural_events': total_natural,
            'total_lab_events': total_lab,
            'equivalence_ratio': round(total_natural_damage / self.lab_damage, 2) if self.lab_damage > 0 else 0.0,
            'lab_standard_damage': round(self.lab_damage, 4),
            'total_natural_damage': round(total_natural_damage, 4)
        }


# =============================================================================
# 降雪 - 冻融实验方案生成器（重构版）
# =============================================================================

class SnowFTCPlanGenerator:
    """
    降雪 - 冻融实验方案生成器（物理厚度直投版 + 冻融损伤等效）

    核心逻辑：
    1. 统计降雪次数、总降雪量（cm→mm 转换，向上取整保守原则）
    2. 计算自然冻融事件损伤值，转换为实验室标准事件
    3. 将等效后的冻融事件均分到降雪事件之后

    整合降雪事件提取、冻融循环识别、厚度映射，生成完整实验方案
    """

    def __init__(self,
                 csv_path: str,
                 target_days: float = 10.0,
                 config: Optional[ExperimentConfig] = None,
                 ftc_config: Optional[Dict] = None):
        """
        Args:
            csv_path: 输入 CSV 文件路径
            target_days: 目标实验天数
            config: 实验配置
            ftc_config: 冻融配置参数（保留向后兼容）
        """
        self.csv_path = csv_path
        self.target_days = target_days
        self.target_hours = target_days * 24
        self.config = config or ExperimentConfig()

        # 内部组件
        self.snow_extractor: Optional[SnowEventExtractor] = None
        self.ftc_identifier: Optional[FTCEventIdentifier] = None
        self.ftc_converter: Optional[FTCEquivalenceConverter] = None
        self.depth_mapper: Optional[SnowDepthMapper] = None

        # 处理结果
        self.weather_data: Optional[WeatherDataset] = None
        self.climate_stats: Optional[ClimateStatistics] = None
        self.snow_events: List[SnowEvent] = []
        self.ftc_events: List[FTCEvent] = []
        self.lab_ftc_events: List[LabFTCEvent] = []
        self.snow_stats: Dict[str, Any] = {}
        self.ftc_summary: Dict[str, Any] = {}

        # 计算结果
        self.snow_depth_per_cycle_mm: float = 0.0
        self.snow_depth_per_cycle_mm_ceiled: float = 0.0
        self.total_lab_ftc_events: int = 0

    def generate(self) -> SnowFTCPlan:
        """生成实验方案"""
        self._load_data()
        self._extract_snow_events()
        self._identify_ftc_events()
        self._convert_ftc_equivalence()
        self._calculate_snow_distribution()
        return self._generate_steps()

    def _load_data(self):
        """加载天气数据"""
        from core.data_loader import WeatherDataLoader
        data_loader = WeatherDataLoader(self.csv_path, self.config)
        self.weather_data, self.climate_stats = data_loader.load_with_statistics()

    def _extract_snow_events(self):
        """提取降雪事件"""
        self.snow_extractor = SnowEventExtractor(
            self.config,
            snow_temp_threshold=SNOW_TEMP_THRESHOLD
        )
        self.snow_events = self.snow_extractor.extract(self.weather_data)
        self.snow_stats = self.snow_extractor.get_statistics(self.snow_events)

    def _identify_ftc_events(self):
        """识别冻融事件"""
        self.ftc_identifier = FTCEventIdentifier(
            freeze_start=FTC_FREEZE_THRESHOLD,
            thaw_start=FTC_THAW_THRESHOLD,
            min_freeze_hours=1,
            min_thaw_hours=1
        )
        self.ftc_events = self.ftc_identifier.identify(self.weather_data)

    def _convert_ftc_equivalence(self):
        """转换冻融等效实验室事件"""
        self.ftc_converter = FTCEquivalenceConverter(
            damage_alpha=FTC_DAMAGE_ALPHA,
            damage_beta=FTC_DAMAGE_BETA,
            freeze_threshold=FTC_FREEZE_THRESHOLD,
            thaw_threshold=FTC_THAW_THRESHOLD
        )
        self.lab_ftc_events = self.ftc_converter.convert(self.ftc_events)
        self.ftc_summary = self.ftc_converter.get_summary(self.ftc_events, self.lab_ftc_events)
        self.total_lab_ftc_events = self.ftc_converter.get_total_lab_events(self.lab_ftc_events)

    def _calculate_snow_distribution(self):
        """
        计算降雪分配（保守原则）

        核心逻辑：
        1. 从 snow_stats 获取总降雪量（单位：cm，直接累加原始数据）
        2. 转换为 mm（×10）
        3. 向上取整到 mm 精度，确保总降雪量之和不低于实际值
        4. 计算每次降雪的降雪强度

        注意：CSV 中 snowfall 列的单位是 cm
        """
        # 获取总降雪量（单位：cm）
        total_snow_cm = self.snow_stats.get('total_snow_depth_cm', 0.0)

        # 使用保守原则分配降雪
        mapper = SnowDepthMapper()
        snow_per_cycle, actual_total = mapper.distribute_snow_depth_conservative(
            total_snow_depth_cm=total_snow_cm,  # 直接传入 cm 值
            n_cycles=len(self.snow_events) if self.snow_events else 1
        )

        self.snow_depth_per_cycle_mm_ceiled = snow_per_cycle
        self.actual_total_snow_mm = actual_total

        # 同时也计算原始值（用于参考）
        n_snow_events = len(self.snow_events) if self.snow_events else 1
        self.snow_depth_per_cycle_mm_raw = (total_snow_cm * 10.0) / n_snow_events

    def _generate_steps(self) -> SnowFTCPlan:
        """
        生成实验步骤

        核心逻辑：
        1. 每次降雪事件后跟随等效次数的实验室标准冻融循环
        2. 降雪阶段：雪花机工作，温度 -10℃~-2℃
        3. 冻结阶段：温度降低至 LAB_FTC_TMIN
        4. 融化阶段：温度升高至 LAB_FTC_TMAX
        """
        sequence = []
        step_number = 0

        # 获取降雪阶段固定时长
        snow_duration_min = SNOW_DURATION_MIN

        # 创建厚度映射器
        self.depth_mapper = SnowDepthMapper()

        # 计算降雪强度
        snow_intensity = self.depth_mapper.calc_snow_intensity(
            self.snow_depth_per_cycle_mm_ceiled,
            snow_duration_min
        )

        # 确定降雪阶段目标温度
        snow_temp = max(SNOW_TEMP_MIN, min(SNOW_TEMP_MAX, -5.0))

        # 计算每次降雪后应跟随的冻融循环次数
        # 使用整数除法 + 余数分配，确保总次数精确等于 total_lab_ftc_events
        total_lab_cycles = self.total_lab_ftc_events
        n_snow = len(self.snow_events)
        base_cycles_per_snow = total_lab_cycles // n_snow  # 基础次数
        extra_cycles = total_lab_cycles % n_snow  # 余数，前 extra_cycles 次降雪各多 1 次

        # 遍历降雪事件，每次降雪后跟随等效的冻融循环
        for i, snow_event in enumerate(self.snow_events):
            # --- 阶段 1: 降雪阶段 ---
            step_number += 1
            sequence.append(SnowFTCStep(
                step=step_number,
                mode='Snow',
                duration_min=snow_duration_min,
                target_temp=snow_temp,
                snow_depth_mm=self.snow_depth_per_cycle_mm_ceiled,
                snow_intensity_mmh=snow_intensity,
                is_snowing=True
            ))

            # --- 阶段 2 & 3: 冻融循环（精确分配）---
            # 前 extra_cycles 次降雪后多安排 1 次冻融循环
            lab_ftc_this_snow = base_cycles_per_snow + (1 if i < extra_cycles else 0)

            for _ in range(lab_ftc_this_snow):
                # --- 阶段 2: 冻结阶段 ---
                step_number += 1
                freeze_duration_min = LAB_FTC_FREEZE_HOURS * 60
                sequence.append(SnowFTCStep(
                    step=step_number,
                    mode='Freeze',
                    duration_min=freeze_duration_min,
                    target_temp=LAB_FTC_TMIN,
                    snow_depth_mm=0.0,
                    snow_intensity_mmh=0.0,
                    is_snowing=False
                ))

                # --- 阶段 3: 融化阶段 ---
                step_number += 1
                thaw_duration_min = LAB_FTC_THAW_HOURS * 60
                sequence.append(SnowFTCStep(
                    step=step_number,
                    mode='Thaw',
                    duration_min=thaw_duration_min,
                    target_temp=LAB_FTC_TMAX,
                    snow_depth_mm=0.0,
                    snow_intensity_mmh=0.0,
                    is_snowing=False
                ))

        # 计算实际总降雪量
        actual_total_snow_mm = getattr(self, 'actual_total_snow_mm', 0.0)

        # 元数据
        meta = {
            'target_days': self.target_days,
            'total_snow_events': len(self.snow_events),
            'total_natural_ftc_events': len(self.ftc_events),
            'total_lab_ftc_events': self.total_lab_ftc_events,
            'total_snow_depth_input_cm': round(self.snow_stats.get('total_snow_depth_cm', 0.0), 2),
            'total_snow_depth_input_mm': round(self.snow_stats.get('total_snow_depth_mm', 0.0), 2),
            'snow_depth_per_cycle_mm_raw': round(getattr(self, 'snow_depth_per_cycle_mm_raw', 0.0), 4),
            'snow_depth_per_cycle_mm_ceiled': round(self.snow_depth_per_cycle_mm_ceiled, 2),
            'actual_total_snow_mm': round(actual_total_snow_mm, 2),
            'snow_duration_min': snow_duration_min,
            'lab_Tmin': LAB_FTC_TMIN,
            'lab_Tmax': LAB_FTC_TMAX,
            'ftc_damage_alpha': FTC_DAMAGE_ALPHA,
            'ftc_damage_beta': FTC_DAMAGE_BETA,
            'mapping_mode': 'physical_depth_direct_ftc_equivalence'
        }

        # 源数据信息
        source_info = {
            'csv_path': self.csv_path,
            'data_range': {
                'start': self.weather_data.start_time.isoformat() if self.weather_data and self.weather_data.start_time else None,
                'end': self.weather_data.end_time.isoformat() if self.weather_data and self.weather_data.end_time else None
            },
            'snow_statistics': self.snow_stats,
            'ftc_summary': self.ftc_summary,
            'snow_events': [e.to_dict() for e in self.snow_events],
            'ftc_events': [e.to_dict() for e in self.ftc_events],
            'lab_ftc_events': [e.to_dict() for e in self.lab_ftc_events]
        }

        return SnowFTCPlan(
            meta=meta,
            sequence=sequence,
            snow_events=self.snow_events,
            ftc_events=self.ftc_events,
            source_info=source_info
        )


# =============================================================================
# 降雪 - 冻融输出格式器（增强版 - 严格降雪控制）
# =============================================================================

class SnowFTCFormatter:
    """
    降雪 - 冻融实验方案格式器

    将 SnowFTCPlan 转换为硬件可执行的 CSV 格式
    严格确保降雪步的控制标志正确设置
    """

    # 输出 CSV 列名
    OUTPUT_COLUMNS = [
        '步骤编号',
        '工作状态（ON/OFF）',
        '运行时间（min）',
        '起始温度（℃）',
        '终点温度（℃）',
        '湿度控制标志（ON/OFF）',
        '起始湿度（%）',
        '终点湿度（%）',
        '日照控制标志（ON/OFF）',
        '日照控制方式（开环/闭环）',
        '日照起始角度（°）',
        '日照终点角度（°）',
        '起始日照强度（W/m2）',
        '终点日照强度（W/m2）',
        '降雨控制标志（ON/OFF）',
        '起始降雨量（mm/h）',
        '终点降雨量（mm/h）',
        '风速控制标志（ON/OFF）',
        '起始风速（m/s）',
        '终点风速（m/s）',
        '降雪控制标志（ON/OFF）',
        '起始降雪量（mm/h）',
        '终点降雪量（mm/h）'
    ]

    def __init__(self, default_humidity: float = 50.0,
                 temp_change_rate: float = 3.0):
        """
        Args:
            default_humidity: 默认湿度 (%)
            temp_change_rate: 温度变化速率 (°C/min)
        """
        self.default_humidity = default_humidity
        self.temp_change_rate = temp_change_rate
        self._current_temp = 20.0

    def format(self, plan: SnowFTCPlan) -> List[Dict]:
        """
        将实验方案转换为硬件步骤

        Args:
            plan: SnowFTCPlan 实验方案

        Returns:
            硬件步骤字典列表
        """
        steps = []
        self._current_temp = 20.0

        for exp_step in plan.sequence:
            new_steps = self._process_step(exp_step, len(steps) + 1)
            steps.extend(new_steps)

        return steps

    def _process_step(self, exp_step: SnowFTCStep,
                      step_number: int) -> List[Dict]:
        """处理单个实验步骤"""
        result_steps = []
        target_temp = exp_step.target_temp

        # 检查是否需要温度过渡
        if abs(target_temp - self._current_temp) > 0.1:
            transition = self._create_transition_step(
                step_number,
                self._current_temp,
                target_temp
            )
            result_steps.append(transition)
            step_number += 1

        # 创建主步骤
        main_step = self._create_main_step(exp_step, step_number, target_temp)
        result_steps.append(main_step)

        # 更新当前温度
        self._current_temp = target_temp

        return result_steps

    def _create_transition_step(self, step_number: int,
                                 start_temp: float,
                                 end_temp: float) -> Dict:
        """创建温度过渡步骤"""
        temp_diff = abs(end_temp - start_temp)
        duration_min = max(1.0, temp_diff / self.temp_change_rate)

        return {
            '步骤编号': step_number,
            '工作状态（ON/OFF）': 'ON',
            '运行时间（min）': round(duration_min, 1),
            '起始温度（℃）': round(start_temp, 1),
            '终点温度（℃）': round(end_temp, 1),
            '湿度控制标志（ON/OFF）': 'OFF',
            '起始湿度（%）': self.default_humidity,
            '终点湿度（%）': self.default_humidity,
            '日照控制标志（ON/OFF）': 'OFF',
            '日照控制方式（开环/闭环）': '开环',
            '日照起始角度（°）': 0.0,
            '日照终点角度（°）': 0.0,
            '起始日照强度（W/m2）': 0.0,
            '终点日照强度（W/m2）': 0.0,
            '降雨控制标志（ON/OFF）': 'OFF',
            '起始降雨量（mm/h）': 0.0,
            '终点降雨量（mm/h）': 0.0,
            '风速控制标志（ON/OFF）': 'OFF',
            '起始风速（m/s）': 0.0,
            '终点风速（m/s）': 0.0,
            '降雪控制标志（ON/OFF）': 'OFF',
            '起始降雪量（mm/h）': 0.0,
            '终点降雪量（mm/h）': 0.0
        }

    def _create_main_step(self, exp_step: SnowFTCStep,
                          step_number: int,
                          target_temp: float) -> Dict:
        """
        创建主步骤 - 严格降雪控制

        确保：
        - 降雪步：降雪=ON, 日照=OFF, 降雨=OFF
        - 非降雪步：降雪=OFF, 降雪量=0.0
        """
        mode = exp_step.mode

        # 基础步骤 - 所有控制默认 OFF
        step = {
            '步骤编号': step_number,
            '工作状态（ON/OFF）': 'ON',
            '运行时间（min）': round(exp_step.duration_min, 1),
            '起始温度（℃）': round(target_temp, 1),
            '终点温度（℃）': round(target_temp, 1),
            '湿度控制标志（ON/OFF）': 'OFF',
            '起始湿度（%）': self.default_humidity,
            '终点湿度（%）': self.default_humidity,
            '日照控制标志（ON/OFF）': 'OFF',
            '日照控制方式（开环/闭环）': '开环',
            '日照起始角度（°）': 0.0,
            '日照终点角度（°）': 0.0,
            '起始日照强度（W/m2）': 0.0,
            '终点日照强度（W/m2）': 0.0,
            '降雨控制标志（ON/OFF）': 'OFF',
            '起始降雨量（mm/h）': 0.0,
            '终点降雨量（mm/h）': 0.0,
            '风速控制标志（ON/OFF）': 'OFF',
            '起始风速（m/s）': 0.0,
            '终点风速（m/s）': 0.0,
            '降雪控制标志（ON/OFF）': 'OFF',
            '起始降雪量（mm/h）': 0.0,
            '终点降雪量（mm/h）': 0.0
        }

        # 根据模式设置控制标志 - 严格互斥
        if mode == 'Snow':
            # 降雪阶段：
            # - 降雪控制 ON
            # - 日照控制 OFF（确保雪花不融化）
            # - 降雨控制 OFF（使用雪花机而非喷淋）
            step['降雪控制标志（ON/OFF）'] = 'ON'
            # 降雪量保留 2 位小数，避免小值被四舍五入为 0.0
            step['起始降雪量（mm/h）'] = round(exp_step.snow_intensity_mmh, 2)
            step['终点降雪量（mm/h）'] = round(exp_step.snow_intensity_mmh, 2)
            # 确保日照和降雨为 OFF
            step['日照控制标志（ON/OFF）'] = 'OFF'
            step['降雨控制标志（ON/OFF）'] = 'OFF'

        elif mode == 'Freeze':
            # 冻结阶段：风雪舱，无降雪
            step['降雪控制标志（ON/OFF）'] = 'OFF'

        elif mode == 'Thaw':
            # 融化阶段：温度升高
            step['降雪控制标志（ON/OFF）'] = 'OFF'

        return step

    def to_csv(self, steps: List[Dict], output_path: str,
               encoding: str = 'utf-8-sig') -> None:
        """保存为 CSV 文件"""
        import csv
        from pathlib import Path

        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        with open(output_file, 'w', newline='', encoding=encoding) as f:
            writer = csv.DictWriter(f, fieldnames=self.OUTPUT_COLUMNS)
            writer.writeheader()
            for step in steps:
                writer.writerow(step)


# =============================================================================
# 便捷函数
# =============================================================================

def count_snow_events(csv_path: str,
                      snow_temp_threshold: float = 0.0,
                      verbose: bool = True) -> Tuple[List[SnowEvent], Dict[str, Any]]:
    """
    便捷函数：统计降雪事件次数

    统计规则：
    - 一次降雪之后，如果温度一直维持在 0 度以下，认为是一次连续降雪事件
    - 如果中间温度升至 0 度以上，则认为降雪结束，之后的是另一场降雪

    Args:
        csv_path: 天气数据 CSV 文件路径
        snow_temp_threshold: 降雪温度阈值（默认 0°C，低于此温度才降雪）
        verbose: 是否输出详细统计信息

    Returns:
        (snow_events, snow_stats) 元组：
        - snow_events: 降雪事件列表
        - snow_stats: 降雪统计字典

    Example:
        >>> events, stats = count_snow_events("data/data.csv")
        >>> print(f"全年降雪事件总数：{stats['total_snow_events']} 场")
    """
    from .data_loader import WeatherDataLoader

    # 加载数据
    loader = WeatherDataLoader(csv_path)
    dataset, _ = loader.load_with_statistics()

    if verbose:
        print(f"数据加载成功：{len(dataset)} 条记录")
        print(f"时间范围：{dataset.start_time} 至 {dataset.end_time}")

    # 提取降雪事件
    extractor = SnowEventExtractor(snow_temp_threshold=snow_temp_threshold)
    snow_events = extractor.extract(dataset)
    snow_stats = extractor.get_statistics(snow_events)

    if verbose:
        # 输出统计结果
        print("\n" + "="*60)
        print(f"统计结果（温度阈值 {snow_temp_threshold}°C）")
        print("="*60)
        print(f"全年降雪事件总数：{snow_stats['total_snow_events']} 场")
        print(f"总降雪深度：{snow_stats['total_snow_depth_mm']:.2f} mm (={snow_stats['total_snow_depth_cm']:.2f} cm)")
        print(f"平均每场降雪：{snow_stats['avg_snow_per_event_mm']:.2f} mm")
        print(f"最大单场降雪：{snow_stats['max_snow_event_cm']:.2f} cm (={snow_stats['max_snow_event_cm']*10:.2f} mm)")
        print(f"最小单场降雪：{snow_stats['min_snow_event_cm']:.2f} cm (={snow_stats['min_snow_event_cm']*10:.2f} mm)")

        # 输出每场降雪详情
        if snow_events:
            print("\n" + "="*60)
            print("每场降雪详情")
            print("="*60)
            print(f"{'序号':<6} {'开始时间':<22} {'结束时间':<22} {'雪深 (cm)':<10} {'时长 (h)':<10} {'均温 (°C)':<10}")
            print("-"*80)
            for idx, event in enumerate(snow_events, 1):
                start_str = event.start_time.strftime('%Y-%m-%d %H:%M')
                end_str = event.end_time.strftime('%Y-%m-%d %H:%M')
                # event.total_snow_depth 是 cm 单位
                print(f"{idx:<6} {start_str:<22} {end_str:<22} {event.total_snow_depth:<10.2f} {event.duration_hours:<10.1f} {event.temp_median:<10.1f}")

    return snow_events, snow_stats


def generate_snow_ftc_plan(csv_path: str,
                           target_days: float = 10.0,
                           output_dir: str = "output",
                           output_json: Optional[str] = None,
                           output_csv: Optional[str] = None,
                           use_timestamp: bool = True) -> SnowFTCPlan:
    """
    便捷函数：生成降雪 - 冻融实验方案（物理厚度直投版）

    Args:
        csv_path: 输入 CSV 路径
        target_days: 目标实验天数
        output_dir: 输出目录（默认 "output"）
        output_json: JSON 输出路径（可选，如不指定则自动生成带时间戳的文件名）
        output_csv: CSV 输出路径（可选，如不指定则自动生成带时间戳的文件名）
        use_timestamp: 是否使用时间戳命名（默认 True）

    Returns:
        SnowFTCPlan 实验方案
    """
    from datetime import datetime
    from pathlib import Path

    generator = SnowFTCPlanGenerator(csv_path, target_days)
    plan = generator.generate()

    # 如果未指定输出路径，自动生成带时间戳的文件名
    if use_timestamp:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)

        if not output_json:
            # 从 CSV 文件名提取地区名
            csv_name = Path(csv_path).stem  # 如 "processed_weather_data_bazhong"
            region_name = csv_name.replace("processed_weather_data_", "") if "processed_weather_data_" in csv_name else "default"
            output_json = str(output_path / f"snow_ftc_{region_name}_{timestamp}.json")

        if not output_csv:
            csv_name = Path(csv_path).stem
            region_name = csv_name.replace("processed_weather_data_", "") if "processed_weather_data_" in csv_name else "default"
            output_csv = str(output_path / f"snow_ftc_hardware_{region_name}_{timestamp}.csv")

    if output_json:
        plan.save(output_json)
        print(f"JSON 方案已保存：{output_json}")

    if output_csv:
        formatter = SnowFTCFormatter()
        steps = formatter.format(plan)
        formatter.to_csv(steps, output_csv)
        print(f"硬件 CSV 已保存：{output_csv}")

    return plan


# 模块导出
__all__ = [
    'SnowEvent',
    'FTCEvent',
    'SnowFTCStep',
    'SnowFTCPlan',
    'SnowEventExtractor',
    'FTCEventIdentifier',
    'SnowDepthMapper',          # 新增
    'SnowFTCPlanGenerator',
    'SnowFTCFormatter',
    'generate_snow_ftc_plan',
    'DEFAULT_SNOW_FTC_CONFIG'
]
