# -*- coding: utf-8 -*-
"""
full_experiment_pipeline_v2.py

改进点（不改你们已有 winter/split 算法公式，只改“如何使用它们”）：
1) 先把逐小时数据聚合为逐日数据（daily），再做季节切分（避免小时级温度波动导致季节碎片化）。
2) 在 daily 上得到“连续的春/夏/秋”（各 1 段）与“冬季”（允许跨年时为 2 段），
   不再对每个非冬季片段分别 split，从而避免春夏秋被切成很多不连续片段。
3) 把 daily 的季节区间映射回 hourly：按日期筛选对应小时记录，供降雨/日照模拟使用。
4) 增加 JSON 序列化安全转换（date/datetime/numpy -> 可写 JSON）。
5) 日照模块在“该季节无雨事件”时返回空结果，不再报 'event_id'。

依赖同目录文件：
- exp.py
- ssegment_core_only.py
- solar_equivalence.py
- seasonal_equivalence_ssegment.py

运行：
    python full_experiment_pipeline_v2.py --csv back_con\\data\\processed_weather_data.csv
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

from expert_class.exp import ExperimentInput, RainfallEquivalenceCalculator
from expert_class.Ssegment import winter, split, non_winter, IndexRange
from expert_class.solar_equivalence import (
    detect_rain_events,
    compute_post_rain_ecap,
    compute_region_E_star,
    representative_solar_intensity_pXX,
)
from expert_class.seasonal_equivalence_ssegment import SeasonalEquivConfig, compute_seasonal_equiv_from_results


# -----------------------------
# JSON safe
# -----------------------------
def to_json_safe(obj):
    """递归把对象转换为 JSON 可序列化结构（不改结果含义，只改表示）。"""
    if isinstance(obj, dict):
        return {str(k): to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [to_json_safe(v) for v in obj]
    if isinstance(obj, tuple):
        return [to_json_safe(v) for v in obj]
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, np.generic):
        return obj.item()
    return obj


# -----------------------------
# Path resolve
# -----------------------------
def _resolve_csv_path(user_path: str) -> str:
    candidates = [user_path, user_path.replace("\\", "/")]
    base = os.path.basename(user_path.replace("\\", "/"))
    candidates += [base, os.path.join("/mnt/data", base), os.path.join(os.path.dirname(os.path.abspath(__file__)), base)]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    raise FileNotFoundError(f"找不到输入 CSV：尝试过 {candidates}")


# -----------------------------
# Seasonal segmentation (continuous) on DAILY data
# -----------------------------
def build_daily_df(
    df_hourly: pd.DataFrame,
    time_col: str = "time",
    temp_col: str = "temperature_2m",
    rh_col: str = "relativehumidity_2m",
    wind_col: str = "windspeed_10m",
    rain_col: str = "rain",
    rad_col: str = "shortwave_radiation",
) -> pd.DataFrame:
    """
    将逐小时数据聚合为逐日：
    - temp_min: 每日最低温（用于 winter）
    - temp_mean: 每日平均温（用于 split）
    - rh_mean / wind_mean: 每日均值（用于环境等效统计）
    - rain_sum: 每日雨量和（用于你们若要按天分析可扩展；当前主要用于审计）
    - rad_mean: 每日平均短波（仅审计）
    """
    df = df_hourly.copy()
    df[time_col] = pd.to_datetime(df[time_col], errors="coerce")
    df = df.dropna(subset=[time_col]).sort_values(time_col).reset_index(drop=True)
    df["date"] = df[time_col].dt.date

    agg = {
        temp_col: ["min", "mean"],
        rh_col: "mean",
        wind_col: "mean",
        rain_col: "sum",
        rad_col: "mean",
    }
    daily = df.groupby("date", as_index=False).agg(agg)

    # flatten columns
    daily.columns = [
        "date",
        "temperature_2m_min",
        "temperature_2m_mean",
        "relativehumidity_2m",
        "windspeed_10m",
        "rain_sum",
        "shortwave_radiation_mean",
    ]
    # add a time col for compatibility (use midnight)
    daily["time"] = pd.to_datetime(daily["date"])
    daily = daily.sort_values("time").reset_index(drop=True)
    return daily


def season_segment_continuous_daily(
    daily: pd.DataFrame,
    T0: float = 0.0,
    g_days: int = 6,
    winter_min_len_days: int = 7,
    nonwinter_min_seg_len_days: int = 15,
) -> Dict[str, List[IndexRange]]:
    """
    在“逐日”数据上做“连续季节”切分：
    - 先用 winter() 找冬季段（可能多段）
    - 选出“主冬季”形态：若冬季出现在年初与年末，则合并为跨年冬季（表现为两个区间）
      否则选取最长冬季段为冬季（一个区间）
    - 非冬季为 winter 的补集（通常是一个连续区间）
    - 对非冬季的那一个连续区间，使用 split() 一次性切出 spring/summer/autumn（各一个区间，保证连续）

    返回：
      {"winter":[(l,r),...], "spring":[(l,r)], "summer":[(l,r)], "autumn":[(l,r)]}
    """
    # winter segmentation on daily min temp
    w = winter(
        df=daily,
        T0=T0,
        g=g_days,
        min_len=winter_min_len_days,
        date_col="time",
        tmin_col="temperature_2m_min",
        write_cold=False,
    )
    W_all = list(w.get("W_idx", []))
    n = len(daily)

    # no winter at all
    if not W_all:
        # whole year is non-winter; split once
        tmean = daily["temperature_2m_mean"].tolist()
        sp, su, au = split(tmean, 0, n - 1, min_seg_len=nonwinter_min_seg_len_days)
        return {"winter": [], "spring": [sp] if sp else [], "summer": [su], "autumn": [au] if au else []}

    # sort
    W_all = sorted((int(l), int(r)) for (l, r) in W_all if l is not None and r is not None and r >= l)

    # Heuristic: if first winter touches start and last winter touches end -> treat as wrap-around winter (2 segments)
    first_l, first_r = W_all[0]
    last_l, last_r = W_all[-1]
    wrap_winter: List[IndexRange] = []
    if first_l <= 3 and last_r >= n - 4:  # small buffer in days
        wrap_winter = [(last_l, last_r), (first_l, first_r)]
        winter_ranges = wrap_winter
    else:
        # choose the longest winter segment as "winter"
        lens = [(r - l + 1, (l, r)) for (l, r) in W_all]
        winter_ranges = [max(lens, key=lambda x: x[0])[1]]

    # non-winter is complement of selected winter ranges
    # Mark winter days
    is_winter = np.zeros(n, dtype=bool)
    for l, r in winter_ranges:
        is_winter[l : r + 1] = True

    # find continuous non-winter ranges
    nonwinter_ranges: List[IndexRange] = []
    i = 0
    while i < n:
        if is_winter[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and (not is_winter[j + 1]):
            j += 1
        nonwinter_ranges.append((i, j))
        i = j + 1

    if not nonwinter_ranges:
        # all winter
        return {"winter": winter_ranges, "spring": [], "summer": [], "autumn": []}

    # Choose the longest non-winter block to define spring/summer/autumn (continuous)
    nn_len, (p, q) = max(((r - l + 1), (l, r)) for (l, r) in nonwinter_ranges)
    tmean = daily["temperature_2m_mean"].tolist()
    sp, su, au = split(tmean, p, q, min_seg_len=nonwinter_min_seg_len_days)

    out = {
        "winter": winter_ranges,
        "spring": [sp] if sp else [],
        "summer": [su],
        "autumn": [au] if au else [],
    }
    return out


def map_daily_ranges_to_hourly(
    df_hourly: pd.DataFrame,
    daily: pd.DataFrame,
    season_ranges_daily: Dict[str, List[IndexRange]],
    time_col: str = "time",
) -> Dict[str, pd.DataFrame]:
    """
    将 daily 的 season ranges 映射回 hourly：按日期选取。
    这样 spring/summer/autumn 在 hourly 上也会保持“整体连续”（除非数据缺天）。
    winter 若为跨年冬季，hourly 上会呈现两段（年末+年初）。
    """
    dfh = df_hourly.copy()
    dfh[time_col] = pd.to_datetime(dfh[time_col], errors="coerce")
    dfh = dfh.dropna(subset=[time_col]).sort_values(time_col).reset_index(drop=True)
    dfh["date"] = dfh[time_col].dt.date

    dates = daily["date"].tolist()

    out: Dict[str, pd.DataFrame] = {}
    for season, ranges in season_ranges_daily.items():
        if not ranges:
            out[season] = dfh.iloc[0:0].copy()
            continue
        # collect dates for the season
        season_dates: List[date] = []
        for l, r in ranges:
            l2 = max(0, int(l))
            r2 = min(len(dates) - 1, int(r))
            season_dates.extend(dates[l2 : r2 + 1])

        mask = dfh["date"].isin(set(season_dates))
        out[season] = dfh.loc[mask].drop(columns=["date"]).reset_index(drop=True)

    return out


# -----------------------------
# Per-season simulations (same as v1 but with better guards)
# -----------------------------
def run_rainfall_equivalence_for_df(df_season: pd.DataFrame) -> Dict:
    rainfall_list = df_season["rain"].tolist()
    calc = RainfallEquivalenceCalculator(rainfall_list)

    # 无雨：直接 calculate()（它输出全 0 结构）
    if pd.Series(rainfall_list).fillna(0.0).sum() <= 0:
        out_json = calc.calculate()
        return json.loads(out_json) if isinstance(out_json, str) else out_json

    rain_thresholds = calc.rainfall_cluster_thresholds()
    calc.extract_rain_events()
    calc.process_rain_event_data()
    repre = calc.cluster_rain_events_two_classes()

    calc.thresholds["light"] = rain_thresholds["T1"]
    calc.thresholds["moderate"] = rain_thresholds["T2"]
    calc.target_rain_sum_mm = repre["recommended_event_rain"]

    out_json = calc.calculate()
    return json.loads(out_json) if isinstance(out_json, str) else out_json


def run_solar_equivalence_for_df(
    df_season: pd.DataFrame,
    wmax_hours: int = 48,
    rain_threshold: float = 0.0,
    intensity_p: float = 90.0,
    daylight_threshold: float = 0.0,
    ecap_quantiles=(0.50, 0.75),
) -> Dict:
    events = detect_rain_events(df_season, rain_threshold=rain_threshold)

    # 无雨事件：返回空结果（不报错）
    if events is None or len(events) == 0:
        return {
            "ecap_stats": {
                "num_rain_events": 0,
                "Ecap_P50_MJm2": float("nan"),
                "Ecap_P75_MJm2": float("nan"),
                "Ecap_mean_MJm2": float("nan"),
                "Ecap_min_MJm2": float("nan"),
                "Ecap_max_MJm2": float("nan"),
            },
            "I_rep_Wm2": float("nan"),
            "I_rep_diag": {"error": "no rain events in this season"},
            "num_rain_events": 0,
            "num_ecap_rows": 0,
        }

    events_ecap = compute_post_rain_ecap(df_season, events, wmax_hours=wmax_hours)
    ecap_stats = compute_region_E_star(events_ecap, quantiles=ecap_quantiles)

    I_rep, I_diag = representative_solar_intensity_pXX(
        df=df_season,
        events_df=events,
        wmax_hours=wmax_hours,
        p=intensity_p,
        rain_threshold=rain_threshold,
        daylight_threshold=daylight_threshold,
    )

    return {
        "ecap_stats": ecap_stats,
        "I_rep_Wm2": I_rep,
        "I_rep_diag": I_diag,
        "num_rain_events": int(len(events)),
        "num_ecap_rows": int(len(events_ecap)),
    }


# -----------------------------
# Main pipeline
# -----------------------------
def run_full_pipeline(
    csv_path: str,
    wmax_hours: int = 48,
    intensity_p: float = 90.0,
    rain_threshold: float = 0.0,
    daylight_threshold: float = 0.0,
    # segmentation params (in DAYS, because we run on daily)
    T0: float = 0.0,
    g_days: int = 6,
    winter_min_len_days: int = 7,
    nonwinter_min_seg_len_days: int = 15,
) -> Dict:
    weather = ExperimentInput(csv_path)
    dfh = weather.df.copy()
    dfh["time"] = pd.to_datetime(dfh["time"], errors="coerce")
    dfh = dfh.dropna(subset=["time"]).sort_values("time").reset_index(drop=True)

    # daily aggregation + continuous segmentation
    daily = build_daily_df(dfh)
    season_ranges_daily = season_segment_continuous_daily(
        daily=daily,
        T0=T0,
        g_days=g_days,
        winter_min_len_days=winter_min_len_days,
        nonwinter_min_seg_len_days=nonwinter_min_seg_len_days,
    )
    per_season_df = map_daily_ranges_to_hourly(dfh, daily, season_ranges_daily)

    # Env equivalence uses the same segmentation result format that seasonal_equivalence expects.
    # We'll synthesize winter_result + segmentation_result compatible structures from continuous ranges.
    winter_result = {
        "W_idx": season_ranges_daily["winter"],
        "K_w": len(season_ranges_daily["winter"]),
        "W_date": [
            (daily.loc[l, "date"], daily.loc[r, "date"]) for (l, r) in season_ranges_daily["winter"]
        ],
    }
    # segmentation_result expects seasons: list of dicts; we will provide one dict containing the continuous segments
    seg_one = {
        "spring": season_ranges_daily["spring"][0] if season_ranges_daily["spring"] else None,
        "summer": season_ranges_daily["summer"][0] if season_ranges_daily["summer"] else None,
        "autumn": season_ranges_daily["autumn"][0] if season_ranges_daily["autumn"] else None,
    }
    segmentation_result = {"seasons": [seg_one], "NW_idx": []}

    cfg = SeasonalEquivConfig(
        time_col="time",
        temp_col="temperature_2m",
        rh_col="relativehumidity_2m",
        wind_col="windspeed_10m",
    )
    seasonal_env_equiv = compute_seasonal_equiv_from_results(
        df=dfh,
        winter_result=winter_result,
        segmentation_result=segmentation_result,
        cfg=cfg,
    )

    seasons = ["spring", "summer", "autumn", "winter"]
    per_season: Dict[str, Dict] = {}

    for season in seasons:
        df_season = per_season_df.get(season, dfh.iloc[0:0].copy())
        season_out: Dict[str, object] = {
            "daily_ranges": season_ranges_daily.get(season, []),
            "num_rows_hourly": int(len(df_season)),
        }

        if len(df_season) > 0 and "rain" in df_season.columns:
            season_out["rainfall_equivalence"] = run_rainfall_equivalence_for_df(df_season)
        else:
            season_out["rainfall_equivalence"] = {"error": "no data for season or missing rain column"}

        if len(df_season) > 0 and "shortwave_radiation" in df_season.columns:
            season_out["solar_equivalence"] = run_solar_equivalence_for_df(
                df_season=df_season,
                wmax_hours=wmax_hours,
                rain_threshold=rain_threshold,
                intensity_p=intensity_p,
                daylight_threshold=daylight_threshold,
            )
        else:
            season_out["solar_equivalence"] = {"error": "no data for season or missing shortwave_radiation column"}

        season_out["env_equivalence"] = seasonal_env_equiv.get(season, {})
        per_season[season] = season_out

    result = {
        "meta": {
            "csv_path": csv_path,
            "num_rows_hourly": int(len(dfh)),
            "num_days": int(len(daily)),
            "wmax_hours": int(wmax_hours),
            "intensity_p": float(intensity_p),
            "rain_threshold": float(rain_threshold),
            "daylight_threshold": float(daylight_threshold),
            "segmentation_params_days": {
                "T0": float(T0),
                "g_days": int(g_days),
                "winter_min_len_days": int(winter_min_len_days),
                "nonwinter_min_seg_len_days": int(nonwinter_min_seg_len_days),
            },
        },
        "season_ranges_daily": season_ranges_daily,
        "winter_result_summary": {
            "K_w": winter_result["K_w"],
            "W_date": winter_result["W_date"],
        },
        "per_season": per_season,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description="Full seasonal experiment pipeline (v2 continuous seasons)")
    parser.add_argument("--csv", default=r"back_con\data\processed_weather_data.csv", help="Input CSV path")
    parser.add_argument("--wmax", type=int, default=48, help="Wmax hours for post-rain solar window")
    parser.add_argument("--p", type=float, default=90.0, help="Percentile for representative solar intensity")
    parser.add_argument("--rain-threshold", type=float, default=0.0, help="Rain threshold (mm/h)")
    parser.add_argument("--daylight-threshold", type=float, default=0.0, help="Daylight threshold (W/m^2)")
    parser.add_argument("--out", default="full_pipeline_result_v2.json", help="Output JSON filename")

    # segmentation params (days)
    parser.add_argument("--T0", type=float, default=0.0, help="Cold threshold (°C) on DAILY Tmin")
    parser.add_argument("--g-days", type=int, default=6, help="Warm gap tolerance (days)")
    parser.add_argument("--winter-min-len-days", type=int, default=7, help="Minimum winter length (days)")
    parser.add_argument("--nonwinter-min-seg-len-days", type=int, default=15, help="Min segment length for split (days)")

    args = parser.parse_args()
    csv_path = _resolve_csv_path(args.csv)

    result = run_full_pipeline(
        csv_path=csv_path,
        wmax_hours=args.wmax,
        intensity_p=args.p,
        rain_threshold=args.rain_threshold,
        daylight_threshold=args.daylight_threshold,
        T0=args.T0,
        g_days=args.g_days,
        winter_min_len_days=args.winter_min_len_days,
        nonwinter_min_seg_len_days=args.nonwinter_min_seg_len_days,
    )

    # write json safely
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(to_json_safe(result), f, ensure_ascii=False, indent=2)

    print(f"Done. Result saved to: {args.out}")
    print(json.dumps(to_json_safe(result["winter_result_summary"]), ensure_ascii=False, indent=2))

    for s in ["spring", "summer", "autumn", "winter"]:
        env = result["per_season"][s].get("env_equivalence", {})
        print(
            f"{s}: rows={result['per_season'][s]['num_rows_hourly']}  "
            f"T_equiv={env.get('T_equiv')}  RH_equiv={env.get('RH_equiv')}  U_equiv={env.get('U_equiv')}"
        )


if __name__ == "__main__":
    main()
