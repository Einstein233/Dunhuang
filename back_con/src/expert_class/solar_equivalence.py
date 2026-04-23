# -*- coding: utf-8 -*-
"""
solar_equivalence.py

把以下两份脚本的功能合并为一个文件（不改变算法逻辑）：
- post_rain_solar_ecap.py：计算雨后可用日照能量 Ecap（MJ/m^2）及区域统计 E*
- representative_solar_intensity.py：在相同雨后窗口内，计算代表性日照强度（W/m^2）的分位数（默认 P90）

输入：逐小时 CSV，至少包含列：
  - time (ISO datetime)
  - rain
  - shortwave_radiation

雨事件定义：连续小时 rain > rain_threshold (默认 0.0)
雨后窗口定义（与原脚本一致）：
  - window_start = rain_end + 1 hour
  - window_end   = min(rain_end + Wmax_hours, next_rain_start - 1 hour)  (若有下一次降雨)
Ecap 计算（与原脚本一致）：
  - rad_MJm2 = shortwave_radiation[W/m^2] * 3600 / 1e6
  - Ecap_i = sum(rad_MJm2 over window)
代表性强度（与原脚本一致）：
  - 取所有雨后窗口内 shortwave_radiation 样本
  - 过滤 daylight_threshold（默认 0.0）以上样本
  - I_rep = percentile(p)（默认 p=90）

运行方式：
  python solar_equivalence.py --csv back_con/processed_weather_data_bazhong.csv --wmax 48 --p 90 --out-events rain_events_ecap.csv

注意：本文件仅做“合并 + 结构清晰化”，不改变算法逻辑或口径。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Sequence, Tuple, List

import numpy as np
import pandas as pd

REQUIRED_COLUMNS = ("time", "rain", "shortwave_radiation")


# -----------------------------
# I/O
# -----------------------------
def load_hourly_weather(csv_path: str) -> pd.DataFrame:
    """Load hourly weather CSV and validate required columns."""
    df = pd.read_csv(csv_path)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}. Found: {list(df.columns)}")
    df["time"] = pd.to_datetime(df["time"])
    df = df.sort_values("time").reset_index(drop=True)
    return df


# -----------------------------
# Rain events + windows (single source of truth)
# -----------------------------
def detect_rain_events(df: pd.DataFrame, rain_threshold: float = 0.0) -> pd.DataFrame:
    """
    Detect contiguous rain events.
    A rain hour is rain > rain_threshold.
    Returns columns:
      event_id, rain_start, rain_end, rain_hours, rain_mm
    """
    is_rain = (df["rain"] > rain_threshold).to_numpy()
    event_ids = np.full(len(df), np.nan)

    eid = 0
    in_event = False
    for i, r in enumerate(is_rain):
        if r and not in_event:
            eid += 1
            in_event = True
        elif (not r) and in_event:
            in_event = False
        if r:
            event_ids[i] = eid

    tmp = df.copy()
    tmp["rain_event_id"] = event_ids
    rain_df = tmp.dropna(subset=["rain_event_id"]).copy()

    events = []
    for k, g in rain_df.groupby("rain_event_id"):
        g = g.sort_values("time")
        events.append(
            {
                "event_id": int(k),
                "rain_start": g["time"].iloc[0],
                "rain_end": g["time"].iloc[-1],
                "rain_hours": int(len(g)),
                "rain_mm": float(g["rain"].sum()),  # assuming rain is mm/h
            }
        )

    return pd.DataFrame(events).sort_values("event_id").reset_index(drop=True)


def build_post_rain_windows(events_df: pd.DataFrame, wmax_hours: int = 48) -> pd.DataFrame:
    """
    Add per-event post-rain windows (same definition as original scripts):
      window_start = rain_end + 1h
      window_end   = min(rain_end + wmax_hours, next_rain_start - 1h)
    """
    out = events_df.copy()
    next_starts: List[pd.Timestamp] = []
    window_starts: List[pd.Timestamp] = []
    window_ends: List[pd.Timestamp] = []

    for i in range(len(out)):
        rain_end = pd.to_datetime(out.loc[i, "rain_end"])
        next_start = pd.to_datetime(out.loc[i + 1, "rain_start"]) if i < len(out) - 1 else pd.NaT
        next_starts.append(next_start)

        ws = rain_end + pd.Timedelta(hours=1)
        we = rain_end + pd.Timedelta(hours=wmax_hours)
        if pd.notna(next_start):
            we = min(we, next_start - pd.Timedelta(hours=1))

        window_starts.append(ws)
        window_ends.append(we)

    out["next_rain_start"] = next_starts
    out["window_start"] = window_starts
    out["window_end"] = window_ends
    return out


# -----------------------------
# Ecap (MJ/m^2) + region stats
# -----------------------------
def compute_post_rain_ecap(
    df: pd.DataFrame,
    events_df: pd.DataFrame,
    wmax_hours: int = 48,
) -> pd.DataFrame:
    """
    Compute per-event post-rain available energy Ecap (MJ/m^2).

    Window:
      [rain_end + 1h, min(rain_end + wmax_hours, next_rain_start - 1h)]
    """
    tmp = df.copy()
    tmp["rad_MJm2"] = tmp["shortwave_radiation"] * 3600.0 / 1e6  # W/m^2 -> MJ/m^2 per hour

    windows = build_post_rain_windows(events_df, wmax_hours=wmax_hours)

    cap_hours_list: List[int] = []
    ecaps: List[float] = []

    t = tmp["time"]
    for _, row in windows.iterrows():
        ws = row["window_start"]
        we = row["window_end"]

        if pd.isna(ws) or pd.isna(we) or we < ws:
            ecaps.append(0.0)
            cap_hours_list.append(0)
            continue

        mask = (t >= ws) & (t <= we)
        ecaps.append(float(tmp.loc[mask, "rad_MJm2"].sum()))
        cap_hours_list.append(int(mask.sum()))

    out = windows.copy()
    out["cap_end"] = out["window_end"]  # 兼容原脚本字段语义（cap_end == window_end）
    out["cap_hours"] = cap_hours_list
    out["Ecap_MJm2"] = ecaps
    return out


def compute_region_E_star(
    events_with_ecap: pd.DataFrame,
    quantiles: Sequence[float] = (0.50, 0.75),
    col: str = "Ecap_MJm2",
) -> Dict[str, float]:
    """Compute region-level E* statistics as quantiles of per-event Ecap."""
    if col not in events_with_ecap.columns:
        raise ValueError(f"Column '{col}' not found in events dataframe.")
    s = events_with_ecap[col].astype(float)

    out: Dict[str, float] = {}
    for q in quantiles:
        out[f"Ecap_P{int(q * 100):02d}_MJm2"] = float(s.quantile(q))

    # helpful extras (same spirit as original)
    out["Ecap_mean_MJm2"] = float(s.mean())
    out["Ecap_min_MJm2"] = float(s.min())
    out["Ecap_max_MJm2"] = float(s.max())
    out["num_rain_events"] = int(len(events_with_ecap))
    return out


# -----------------------------
# Representative intensity (W/m^2) from post-rain windows
# -----------------------------
def representative_solar_intensity_pXX(
    df: pd.DataFrame,
    events_df: pd.DataFrame,
    wmax_hours: int = 48,
    p: float = 90.0,
    rain_threshold: float = 0.0,  # kept for diagnostics parity
    daylight_threshold: float = 0.0,
) -> Tuple[float, Dict[str, float]]:
    """
    Compute representative solar intensity (W/m^2) as the p-th percentile from post-rain windows.
    (logic unchanged vs original)
    """
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns in df: {missing}")

    windows = build_post_rain_windows(events_df, wmax_hours=wmax_hours)

    # Union-mask across all windows
    flag = np.zeros(len(df), dtype=bool)
    t = df["time"]
    for _, row in windows.iterrows():
        ws = row["window_start"]
        we = row["window_end"]
        if pd.isna(ws) or pd.isna(we) or we < ws:
            continue
        flag |= ((t >= ws) & (t <= we)).to_numpy()

    samples = df.loc[flag, "shortwave_radiation"].astype(float)
    samples = samples[samples > daylight_threshold]  # daylight only

    if len(samples) == 0:
        raise ValueError("No daylight samples found in post-rain windows. Check thresholds or input data.")

    I_rep = float(np.percentile(samples.to_numpy(), p))

    diagnostics = {
        "p": float(p),
        "wmax_hours": float(wmax_hours),
        "rain_threshold": float(rain_threshold),
        "daylight_threshold": float(daylight_threshold),
        "num_rain_events": float(len(events_df)),
        "num_samples": float(len(samples)),
        "min_Wm2": float(samples.min()),
        "median_Wm2": float(samples.median()),
        "mean_Wm2": float(samples.mean()),
        "p90_Wm2": float(np.percentile(samples.to_numpy(), 90.0)),
        "p95_Wm2": float(np.percentile(samples.to_numpy(), 95.0)),
        "max_Wm2": float(samples.max()),
    }
    return I_rep, diagnostics


# -----------------------------
# End-to-end runner
# -----------------------------
def run_solar_equivalence(
    csv_path: str,
    wmax_hours: int = 48,
    rain_threshold: float = 0.0,
    ecap_quantiles: Sequence[float] = (0.50, 0.75),
    intensity_p: float = 90.0,
    daylight_threshold: float = 0.0,
    out_events_csv: Optional[str] = None,
) -> Tuple[pd.DataFrame, Dict[str, float], float, Dict[str, float]]:
    """
    End-to-end:
      1) load
      2) detect rain events
      3) compute per-event Ecap
      4) compute region-level E* (quantiles of Ecap)
      5) compute representative solar intensity (pXX) from the SAME post-rain windows
      6) optionally save events table
    """
    df = load_hourly_weather(csv_path)
    events = detect_rain_events(df, rain_threshold=rain_threshold)

    events_ecap = compute_post_rain_ecap(df, events, wmax_hours=wmax_hours)
    ecap_stats = compute_region_E_star(events_ecap, quantiles=ecap_quantiles)

    I_rep, I_diag = representative_solar_intensity_pXX(
        df=df,
        events_df=events,
        wmax_hours=wmax_hours,
        p=intensity_p,
        rain_threshold=rain_threshold,
        daylight_threshold=daylight_threshold,
    )

    # carry-through metadata (same spirit as originals)
    ecap_stats["Wmax_hours"] = int(wmax_hours)
    ecap_stats["rain_threshold"] = float(rain_threshold)
    ecap_stats["I_rep_Wm2"] = float(I_rep)
    ecap_stats["I_rep_p"] = float(intensity_p)
    ecap_stats["daylight_threshold"] = float(daylight_threshold)

    if out_events_csv:
        events_ecap.to_csv(out_events_csv, index=False)

    return events_ecap, ecap_stats, I_rep, I_diag


# -----------------------------
# CLI
# -----------------------------
if __name__ == "__main__":
    import argparse
    from pprint import pprint

    parser = argparse.ArgumentParser(description="Post-rain solar equivalence (Ecap + representative intensity)")
    parser.add_argument("--csv", required=True, help="Hourly weather CSV path")
    parser.add_argument("--wmax", type=int, default=48, help="Wmax hours for post-rain window cap")
    parser.add_argument("--rain-threshold", type=float, default=0.0, help="Rain threshold (mm/h) to define rain hours")
    parser.add_argument("--p", type=float, default=90.0, help="Percentile for representative intensity (e.g., 90)")
    parser.add_argument("--daylight-threshold", type=float, default=0.0, help="Keep samples > this threshold (W/m^2)")
    parser.add_argument("--ecap-q", nargs="*", type=float, default=[0.50, 0.75],
                        help="Quantiles for Ecap stats, e.g. --ecap-q 0.5 0.75")
    parser.add_argument("--out-events", default=None, help="Optional: write per-event table to CSV")

    args = parser.parse_args()

    events_table, region_stats, I_rep, I_diag = run_solar_equivalence(
        csv_path=args.csv,
        wmax_hours=args.wmax,
        rain_threshold=args.rain_threshold,
        ecap_quantiles=tuple(args.ecap_q),
        intensity_p=args.p,
        daylight_threshold=args.daylight_threshold,
        out_events_csv=args.out_events,
    )

    print("\nRegion stats (E* + I_rep):")
    pprint(region_stats)

    print("\nRepresentative intensity diagnostics:")
    pprint(I_diag)

    print("\nFirst 5 events:")
    print(events_table.head())
