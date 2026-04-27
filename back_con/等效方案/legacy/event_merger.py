"""
事件合并模块 - 第三阶段：基于槽位预算的事件合并

核心逻辑：
- 根据用户设定的实验室总时长，计算最大允许场次
- 通过合并 V 值最小的相邻事件，将事件总数压缩到预算范围内
- 保证总降雨量在压缩过程中守恒
"""

from dataclasses import dataclass, field
from datetime import datetime
from typing import List, Tuple, Optional

# 兼容模块导入和直接运行
try:
    from .event_extractor import RainEvent
    from .energy_coupler import CoupledEvent
    from .utils import (
        find_adjacent_pair_min_sum,
        calculate_mean,
        round_to_precision
    )
except ImportError:
    from event_extractor import RainEvent
    from energy_coupler import CoupledEvent
    from utils import (
        find_adjacent_pair_min_sum,
        calculate_mean,
        round_to_precision
    )


@dataclass
class MergeResult:
    """
    合并结果数据类

    Attributes:
        events: 合并后的事件列表
        original_count: 原始事件数量
        merged_count: 合并后事件数量
        total_rain_before: 合并前总降雨量
        total_rain_after: 合并后总降雨量（应与合并前相等）
        merge_operations: 记录的合并操作日志
    """
    events: List[RainEvent]
    original_count: int
    merged_count: int
    total_rain_before: float
    total_rain_after: float
    merge_operations: List[str] = field(default_factory=list)

    @property
    def rain_conserved(self) -> bool:
        """检查降雨量是否守恒"""
        # 允许 0.01mm 的浮点误差
        return abs(self.total_rain_before - self.total_rain_after) < 0.01

    def to_dict(self) -> dict:
        """转换为字典格式"""
        return {
            'original_count': self.original_count,
            'merged_count': self.merged_count,
            'reduction_rate': round_to_precision(
                1 - self.merged_count / max(self.original_count, 1)
            ),
            'total_rain_before': round_to_precision(self.total_rain_before),
            'total_rain_after': round_to_precision(self.total_rain_after),
            'rain_conserved': self.rain_conserved,
            'merge_operations_count': len(self.merge_operations)
        }


class EventMerger:
    """
    事件合并器

    基于槽位预算对降雨事件进行合并，确保实验可在预设时间内完成
    """

    def __init__(
        self,
        cycle_rain_duration: float = 1.0,
        cycle_solar_duration: float = 12.0,
        cycle_dry_duration: float = 12.0
    ):
        """
        初始化合并器

        Args:
            cycle_rain_duration: 单次循环降雨基础时长 (小时)
            cycle_solar_duration: 单次循环日照时长 (小时)，默认 12 小时
            cycle_dry_duration: 单次循环干燥时长 (小时)，默认 12 小时
        """
        self.cycle_rain_duration = cycle_rain_duration
        self.cycle_solar_duration = cycle_solar_duration
        self.cycle_dry_duration = cycle_dry_duration

    def calculate_max_cycles(self, total_hours: float) -> int:
        """
        根据实验室总时长计算最大允许场次（槽位预算）

        Args:
            total_hours: 实验室总时长 (小时)

        Returns:
            最大允许场次数
        """
        cycle_duration = self.get_cycle_duration()
        if cycle_duration <= 0:
            return 0
        return int(total_hours / cycle_duration)

    def get_cycle_duration(self) -> float:
        """
        获取单次循环的标准时长

        Returns:
            单次循环时长 (小时)
        """
        return (
            self.cycle_rain_duration +
            self.cycle_solar_duration +
            self.cycle_dry_duration
        )

    def merge(
        self,
        events: List[RainEvent],
        max_cycles: Optional[int] = None,
        total_hours: Optional[float] = None
    ) -> MergeResult:
        """
        执行事件合并

        Args:
            events: 原始事件列表
            max_cycles: 最大允许场次，如果提供则优先使用
            total_hours: 实验室总时长，用于计算 max_cycles

        Returns:
            MergeResult 合并结果
        """
        if not events:
            return MergeResult(
                events=[],
                original_count=0,
                merged_count=0,
                total_rain_before=0.0,
                total_rain_after=0.0
            )

        # 记录原始状态
        original_count = len(events)
        total_rain_before = sum(e.total_rain for e in events)

        # 确定目标场次
        if max_cycles is None and total_hours is not None:
            max_cycles = self.calculate_max_cycles(total_hours)

        if max_cycles is None or max_cycles >= original_count:
            # 不需要合并
            return MergeResult(
                events=events.copy(),
                original_count=original_count,
                merged_count=original_count,
                total_rain_before=total_rain_before,
                total_rain_after=total_rain_before
            )

        # 执行合并
        merged_events = events.copy()
        merge_operations = []
        iteration = 0

        while len(merged_events) > max_cycles and len(merged_events) > 1:
            iteration += 1

            # 找到 V 值最小的两个相邻事件进行合并
            merge_idx = self._find_best_merge_index(merged_events)

            if merge_idx < 0 or merge_idx >= len(merged_events) - 1:
                # 无法继续合并
                break

            # 执行合并
            event_a = merged_events[merge_idx]
            event_b = merged_events[merge_idx + 1]

            merged_event = self._merge_two_events(event_a, event_b)
            merge_operations.append(
                f"[迭代{iteration}] 合并事件 #{event_a.event_id} "
                f"(V={round_to_precision(event_a.total_rain)}mm) 和 "
                f"#{event_b.event_id} (V={round_to_precision(event_b.total_rain)}mm) "
                f"-> 新事件 V={round_to_precision(merged_event.total_rain)}mm"
            )

            # 更新列表
            merged_events = (
                merged_events[:merge_idx] +
                [merged_event] +
                merged_events[merge_idx + 2:]
            )

        # 计算最终状态
        total_rain_after = sum(e.total_rain for e in merged_events)

        return MergeResult(
            events=merged_events,
            original_count=original_count,
            merged_count=len(merged_events),
            total_rain_before=total_rain_before,
            total_rain_after=total_rain_after,
            merge_operations=merge_operations
        )

    def _find_best_merge_index(
        self,
        events: List[RainEvent]
    ) -> int:
        """
        找到最佳合并位置的索引

        策略：找到相邻且 V 值之和最小的一对事件

        Args:
            events: 事件列表

        Returns:
            最佳合并位置的索引（返回 i 表示合并 i 和 i+1）
        """
        if len(events) < 2:
            return -1

        rain_values = [e.total_rain for e in events]
        idx_a, idx_b = find_adjacent_pair_min_sum(rain_values)

        return idx_a

    def _merge_two_events(
        self,
        event_a: RainEvent,
        event_b: RainEvent
    ) -> RainEvent:
        """
        合并两个事件

        Args:
            event_a: 第一个事件
            event_b: 第二个事件

        Returns:
            合并后的新事件
        """
        # 生成新的事件 ID
        new_event_id = min(event_a.event_id, event_b.event_id)

        # 总降雨量相加（能量守恒）
        new_total_rain = event_a.total_rain + event_b.total_rain

        # 时间范围取并集
        new_start_time = min(event_a.start_time, event_b.start_time)
        new_end_time = max(event_a.end_time, event_b.end_time)

        # 日照能量按权重重新计算
        # 权重基于降雨量
        total_rain_sum = event_a.total_rain + event_b.total_rain
        if total_rain_sum > 0:
            weight_a = event_a.total_rain / total_rain_sum
            weight_b = event_b.total_rain / total_rain_sum
            new_esolar_48 = (
                event_a.esolar_48 * weight_a +
                event_b.esolar_48 * weight_b
            )
        else:
            new_esolar_48 = (event_a.esolar_48 + event_b.esolar_48) / 2

        # 合并记录
        new_records = event_a.records + event_b.records
        # 按时间排序
        new_records.sort(key=lambda r: r.time)

        # 记录子事件（用于追溯）
        sub_events = []
        for e in [event_a, event_b]:
            if e.merged_events:
                sub_events.extend(e.merged_events)
            else:
                sub_events.append(e)

        # 合并温度字段：取两个事件的平均值（因为合并后代表更长的时间段）
        new_rain_temp_median = (event_a.rain_temp_median + event_b.rain_temp_median) / 2
        new_daytime_temp_median = (event_a.daytime_temp_median + event_b.daytime_temp_median) / 2
        # 干燥阶段温度是全时段的，合并后保持不变（两个事件都引用同一全时段数据）
        new_dry_temp_median = event_a.dry_temp_median  # 两个事件的全时段温度应该相同
        new_wind_speed_avg = event_a.wind_speed_avg  # 同上，全时段平均风速相同

        return RainEvent(
            event_id=new_event_id,
            total_rain=new_total_rain,
            start_time=new_start_time,
            end_time=new_end_time,
            esolar_48=new_esolar_48,
            records=new_records,
            hourly_rain=event_a.hourly_rain + event_b.hourly_rain,
            merged_events=sub_events,
            rain_temp_median=new_rain_temp_median,
            daytime_temp_median=new_daytime_temp_median,
            dry_temp_median=new_dry_temp_median,
            wind_speed_avg=new_wind_speed_avg
        )

    def merge_until_target(
        self,
        events: List[RainEvent],
        target_count: int
    ) -> MergeResult:
        """
        合并事件直到达到目标数量

        Args:
            events: 原始事件列表
            target_count: 目标事件数量

        Returns:
            MergeResult 合并结果
        """
        if not events:
            return MergeResult(
                events=[],
                original_count=0,
                merged_count=0,
                total_rain_before=0.0,
                total_rain_after=0.0
            )

        original_count = len(events)
        total_rain_before = sum(e.total_rain for e in events)

        if target_count >= original_count:
            return MergeResult(
                events=events.copy(),
                original_count=original_count,
                merged_count=original_count,
                total_rain_before=total_rain_before,
                total_rain_after=total_rain_before
            )

        # 使用 merge 方法
        return self.merge(events, max_cycles=target_count)
