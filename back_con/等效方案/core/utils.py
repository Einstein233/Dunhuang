"""
工具函数模块 - 提供可复用的通用工具函数

包含：
- 时间处理工具
- 数据统计工具
- 数值计算工具
"""

from datetime import datetime, timedelta
from typing import List, Optional, Tuple
import math


# =============================================================================
# 时间处理工具
# =============================================================================

def parse_iso_datetime(dt_string: str) -> datetime:
    """
    解析 ISO 格式的时间字符串

    Args:
        dt_string: ISO 格式时间字符串，如 "2024-01-01T12:00:00"

    Returns:
        datetime 对象

    Raises:
        ValueError: 当格式不正确时
    """
    return datetime.fromisoformat(dt_string)


def hours_between(start: datetime, end: datetime) -> float:
    """
    计算两个时间点之间的小时数

    Args:
        start: 起始时间
        end: 结束时间

    Returns:
        小时数（浮点数）
    """
    delta = end - start
    return delta.total_seconds() / 3600


def truncate_to_hour(dt: datetime) -> datetime:
    """
    将时间截断到整点

    Args:
        dt: 输入时间

    Returns:
        截断到整点的时间
    """
    return dt.replace(minute=0, second=0, microsecond=0)


def truncate_to_day(dt: datetime) -> datetime:
    """
    将时间截断到当天的 00:00:00

    Args:
        dt: 输入时间

    Returns:
        截断到当天 00:00:00 的时间
    """
    return dt.replace(hour=0, minute=0, second=0, microsecond=0)


# =============================================================================
# 数据统计工具
# =============================================================================

def calculate_mean(values: List[float]) -> float:
    """
    计算算术平均值

    Args:
        values: 数值列表

    Returns:
        平均值

    Raises:
        ValueError: 当列表为空时
    """
    if not values:
        raise ValueError("数值列表不能为空")
    return sum(values) / len(values)


def calculate_median(values: List[float]) -> float:
    """
    计算中位数 (P50)

    Args:
        values: 数值列表

    Returns:
        中位数
    """
    if not values:
        raise ValueError("数值列表不能为空")

    sorted_values = sorted(values)
    n = len(sorted_values)
    mid = n // 2

    if n % 2 == 0:
        return (sorted_values[mid - 1] + sorted_values[mid]) / 2
    else:
        return sorted_values[mid]


def calculate_percentile(values: List[float], percentile: float) -> float:
    """
    计算百分位数

    Args:
        values: 数值列表
        percentile: 百分位值 (0-100)，如 P99 则传 99

    Returns:
        对应百分位的数值
    """
    if not values:
        raise ValueError("数值列表不能为空")
    if not 0 <= percentile <= 100:
        raise ValueError("百分位必须在 0-100 之间")

    sorted_values = sorted(values)
    n = len(sorted_values)

    # 计算索引位置
    k = (percentile / 100) * (n - 1)
    f = math.floor(k)
    c = math.ceil(k)

    if f == c:
        return sorted_values[int(k)]

    # 线性插值
    return sorted_values[int(f)] * (c - k) + sorted_values[int(c)] * (k - f)


def calculate_sum(values: List[float]) -> float:
    """
    计算总和

    Args:
        values: 数值列表

    Returns:
        总和
    """
    return sum(values) if values else 0.0


def find_min_index(values: List[float]) -> int:
    """
    找到最小值的索引

    Args:
        values: 数值列表

    Returns:
        最小值的索引，空列表返回 -1
    """
    if not values:
        return -1
    return values.index(min(values))


# =============================================================================
# 数值计算工具
# =============================================================================

def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
    """
    安全除法，避免除零错误

    Args:
        numerator: 分子
        denominator: 分母
        default: 除零时的默认返回值

    Returns:
        除法结果或默认值
    """
    if denominator == 0:
        return default
    return numerator / denominator


def clamp(value: float, min_val: float, max_val: float) -> float:
    """
    将值限制在指定范围内

    Args:
        value: 输入值
        min_val: 最小值
        max_val: 最大值

    Returns:
        限制后的值
    """
    return max(min_val, min(max_val, value))


def sqrt_ratio(numerator: float, denominator: float) -> float:
    """
    计算开平方比例 sqrt(numerator / denominator)

    用于防止值过小导致的结果过小

    Args:
        numerator: 分子
        denominator: 分母

    Returns:
        开平方比例值，分母为 0 时返回 0
    """
    if denominator == 0:
        return 0.0
    if numerator < 0 or denominator < 0:
        raise ValueError("分子和分母必须为非负数")

    return math.sqrt(numerator / denominator)


def round_to_precision(value: float, decimals: int = 2) -> float:
    """
    四舍五入到指定精度

    Args:
        value: 输入值
        decimals: 小数位数

    Returns:
        四舍五入后的值
    """
    factor = 10 ** decimals
    return round(value * factor) / factor


def interpolate_linear(
    x: float,
    x0: float,
    y0: float,
    x1: float,
    y1: float
) -> float:
    """
    线性插值

    已知两点 (x0, y0) 和 (x1, y1)，求 x 对应的 y 值

    Args:
        x: 目标 x 值
        x0, y0: 第一个点的坐标
        x1, y1: 第二个点的坐标

    Returns:
        插值结果
    """
    if x1 == x0:
        return y0
    t = (x - x0) / (x1 - x0)
    return y0 + t * (y1 - y0)


# =============================================================================
# 列表处理工具
# =============================================================================

def find_adjacent_pair_min_sum(
    values: List[float]
) -> Tuple[int, int]:
    """
    找到相邻且和最小的两个元素的索引

    用于事件合并算法中找到最优合并对象

    Args:
        values: 数值列表

    Returns:
        (index_a, index_b) 元组，表示两个元素的索引
    """
    if len(values) < 2:
        return (-1, -1)

    min_sum = float('inf')
    result = (0, 1)

    for i in range(len(values) - 1):
        current_sum = values[i] + values[i + 1]
        if current_sum < min_sum:
            min_sum = current_sum
            result = (i, i + 1)

    return result


def merge_adjacent_elements(
    values: List[float],
    idx_a: int,
    idx_b: int
) -> List[float]:
    """
    合并相邻的两个元素

    Args:
        values: 原始列表
        idx_a: 第一个元素索引
        idx_b: 第二个元素索引（必须等于 idx_a + 1）

    Returns:
        合并后的新列表
    """
    if idx_b != idx_a + 1:
        raise ValueError("只能合并相邻元素")

    merged_value = values[idx_a] + values[idx_b]
    return values[:idx_a] + [merged_value] + values[idx_b + 1:]


def sliding_window_sum(values: List[float], window_size: int) -> List[float]:
    """
    计算滑动窗口内的和

    Args:
        values: 数值列表
        window_size: 窗口大小

    Returns:
        每个窗口内的和组成的列表
    """
    if window_size <= 0 or window_size > len(values):
        return []

    result = []
    for i in range(len(values) - window_size + 1):
        window_sum = sum(values[i:i + window_size])
        result.append(window_sum)

    return result
