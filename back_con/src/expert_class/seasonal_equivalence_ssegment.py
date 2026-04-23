# -*- coding: utf-8 -*-
"""
seasonal_equivalence_ssegment.py

基于你们的 Ssegment.py 季节分割输出（冬季 W_idx + 非冬季 seasons[{spring,summer,autumn}]）
计算“地区 + 季节”的等效背景控制参数：

- 温度（temperature）：春/秋取 P50，冬取 P25，夏取 P75
- 相对湿度（relative humidity）：均值 mean
- 风速（wind speed）：均值 mean

适配的数据形态：
- df：逐时/逐日均可（只要列名一致、time可解析）
- 冬季分割：winter(df) -> {"W_idx": [(l,r),...], ...}
- 非冬季三段：segmentation(df, W_idx) -> {"seasons": [{"spring":(l,r)|None,"summer":(l,r),"autumn":(l,r)|None}, ...], ...}
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

import pandas as pd


IndexRange = Tuple[int, int]


@dataclass(frozen=True)
class SeasonalEquivConfig:
    """列名配置（按你们常用列名默认）。"""
    time_col: str = "time"
    # 等效温度默认用 mean 列（你们分割也是用 mean/min）
    temp_col: str = "temperature_2m_mean"
    rh_col: str = "relativehumidity_2m"
    wind_col: str = "windspeed_10m"

    # 温度分位数规则（按你的要求）
    temp_quantiles: Dict[str, float] = None  # type: ignore

    def __post_init__(self):
        if self.temp_quantiles is None:
            object.__setattr__(
                self,
                "temp_quantiles",
                {
                    "spring": 0.50,
                    "autumn": 0.50,
                    "winter": 0.25,
                    "summer": 0.75,
                },
            )


def _ensure_df(df: pd.DataFrame, cfg: SeasonalEquivConfig) -> pd.DataFrame:
    """检查列 & time 转 datetime & 排序。"""
    need = [cfg.time_col, cfg.temp_col, cfg.rh_col, cfg.wind_col]
    missing = [c for c in need if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}. Found: {list(df.columns)}")
    out = df.copy()
    out[cfg.time_col] = pd.to_datetime(out[cfg.time_col], errors="coerce")
    out = out.dropna(subset=[cfg.time_col]).sort_values(cfg.time_col).reset_index(drop=True)
    return out


def _normalize_ranges(ranges: Iterable[Optional[IndexRange]], n: int) -> List[IndexRange]:
    """清理 None、截断到 [0,n-1]，并保证 l<=r。"""
    out: List[IndexRange] = []
    for seg in ranges:
        if seg is None:
            continue
        l, r = seg
        if l is None or r is None:
            continue
        l2 = max(0, int(l))
        r2 = min(n - 1, int(r))
        if r2 >= l2:
            out.append((l2, r2))
    return out


def _flatten_seasons(seasons_list: List[Dict[str, Optional[IndexRange]]], n: int) -> Dict[str, List[IndexRange]]:
    """
    segmentation(...) 的 seasons 是一个 list，每个元素包含 spring/summer/autumn 的 (l,r) 或 None。
    这里把它们汇总成：
      {"spring":[(l,r),...], "summer":[...], "autumn":[...]}
    """
    spring: List[IndexRange] = []
    summer: List[IndexRange] = []
    autumn: List[IndexRange] = []
    for s in seasons_list:
        spring += _normalize_ranges([s.get("spring")], n)
        summer += _normalize_ranges([s.get("summer")], n)
        autumn += _normalize_ranges([s.get("autumn")], n)
    return {"spring": spring, "summer": summer, "autumn": autumn}


def _select_values_by_ranges(df: pd.DataFrame, col: str, ranges: List[IndexRange]) -> pd.Series:
    """按多个索引闭区间拼接出一个 Series。"""
    if not ranges:
        return pd.Series([], dtype=float)
    parts = []
    for l, r in ranges:
        parts.append(df.loc[l:r, col].astype(float))
    return pd.concat(parts, axis=0, ignore_index=True)


def _agg_quantile(values: pd.Series, q: float) -> float:
    if len(values) == 0:
        return float("nan")
    return float(values.quantile(q))


def _agg_mean(values: pd.Series) -> float:
    if len(values) == 0:
        return float("nan")
    return float(values.mean())


def compute_seasonal_equiv_from_ssegment(
    df: pd.DataFrame,
    W_idx: List[IndexRange],
    seasons_list: List[Dict[str, Optional[IndexRange]]],
    cfg: Optional[SeasonalEquivConfig] = None,
) -> Dict[str, Dict[str, float]]:
    """
    直接基于 Ssegment 的输出计算四季等效值。

    返回：
      {
        "spring": {"T_equiv":..., "RH_equiv":..., "U_equiv":..., "num_samples":..., "T_rule_quantile":...},
        "summer": {...},
        "autumn": {...},
        "winter": {...}
      }
    """
    cfg = cfg or SeasonalEquivConfig()
    df2 = _ensure_df(df, cfg)
    n = len(df2)

    # 整理索引段
    winter_ranges = _normalize_ranges(W_idx, n)
    nonwinter = _flatten_seasons(seasons_list, n)

    season_ranges: Dict[str, List[IndexRange]] = {
        "winter": winter_ranges,
        "spring": nonwinter["spring"],
        "summer": nonwinter["summer"],
        "autumn": nonwinter["autumn"],
    }

    out: Dict[str, Dict[str, float]] = {}

    for season, ranges in season_ranges.items():
        T_vals = _select_values_by_ranges(df2, cfg.temp_col, ranges)
        RH_vals = _select_values_by_ranges(df2, cfg.rh_col, ranges)
        U_vals = _select_values_by_ranges(df2, cfg.wind_col, ranges)

        qT = cfg.temp_quantiles.get(season)
        if qT is None:
            raise ValueError(f"Season '{season}' missing in cfg.temp_quantiles: {cfg.temp_quantiles}")

        out[season] = {
            # 温度：按季节分位数（春秋P50、冬P25、夏P75）
            "T_equiv": _agg_quantile(T_vals, qT),
            "T_rule_quantile": float(qT),
            # 湿度、风速：均值
            "RH_equiv": _agg_mean(RH_vals),
            "U_equiv": _agg_mean(U_vals),
            # 样本量（审计/质量控制）
            "num_samples": float(len(T_vals)),
        }

    return out


def compute_seasonal_equiv_from_results(
    df: pd.DataFrame,
    winter_result: Dict[str, Any],
    segmentation_result: Dict[str, Any],
    cfg: Optional[SeasonalEquivConfig] = None,
) -> Dict[str, Dict[str, float]]:
    """
    直接吃你们 winter(...) 和 segmentation(...) 的返回 dict，免手动取字段。
    """
    W_idx = winter_result.get("W_idx", [])
    seasons_list = segmentation_result.get("seasons", [])
    if not isinstance(W_idx, list):
        raise ValueError("winter_result['W_idx'] must be a list of (l,r).")
    if not isinstance(seasons_list, list):
        raise ValueError("segmentation_result['seasons'] must be a list of dicts.")
    return compute_seasonal_equiv_from_ssegment(df=df, W_idx=W_idx, seasons_list=seasons_list, cfg=cfg)
