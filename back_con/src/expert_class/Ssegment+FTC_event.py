import os
import argparse
from typing import List, Tuple, Dict, Optional

import pandas as pd
import matplotlib.pyplot as plt
import numpy as np

from dataclasses import dataclass


def read_data(
    csv_path: str,
    date_col: str = "time",
    tmin_col: str = "temperature_2m",
) -> pd.DataFrame:
    """
    只负责读取/清洗数据：
    - 读 csv
    - 日期解析 + 排序
    - 最低温转数值 & 去掉缺失
    返回：清洗后的 df
    """
    df = pd.read_csv(csv_path)

    # 日期解析并排序
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col]).sort_values(date_col).reset_index(drop=True)

    # 最低温转数值 & 去 NaN
    df[tmin_col] = pd.to_numeric(df[tmin_col], errors="coerce")
    df = df.dropna(subset=[tmin_col]).reset_index(drop=True)

    return df


def winter(
    df: pd.DataFrame,
    T0: float = 0.0,
    g: int = 6,
    min_len: int = 7,
    date_col: str = "time",
    tmin_col: str = "temperature_2m",
    write_cold: bool = True,
) -> Dict:
    """
    只负责冬季划分（基于 df 的最低温列）：
    1) cold[t] = 1 if tmin < T0 else 0
    2) 连续段构建：允许 cold=0 连续长度 <= g 不断开
    3) 过滤太短段：段长 < min_len 的剔除
    """
    tmin = df[tmin_col].tolist()

    cold = [1 if x < T0 else 0 for x in tmin]
    if write_cold:
        df = df.copy()
        df["cold"] = cold

    N = len(tmin)
    W_idx: List[Tuple[int, int]] = []

    in_seg = False
    l = -1
    last_cold_idx = -1
    warm_run = 0

    for i in range(N):
        if cold[i] == 1:
            if not in_seg:
                in_seg = True
                l = i
            last_cold_idx = i
            warm_run = 0
        else:
            if in_seg:
                warm_run += 1
                if warm_run > g:
                    r = last_cold_idx
                    if r >= l and (r - l + 1) >= min_len:
                        W_idx.append((l, r))

                    in_seg = False
                    l = -1
                    last_cold_idx = -1
                    warm_run = 0

    # 收尾
    if in_seg:
        r = last_cold_idx
        if r >= l and (r - l + 1) >= min_len:
            W_idx.append((l, r))

    dates = df[date_col].tolist()
    W_date = [(dates[l].date(), dates[r].date()) for (l, r) in W_idx]

    return {
        "df": df,
        "W_idx": W_idx,
        "W_date": W_date,
        "K_w": len(W_idx),
        "params": {
            "T0": T0,
            "g": g,
            "min_len": min_len,
            "date_col": date_col,
            "tmin_col": tmin_col,
        },
    }


def non_winter(
    N: int,
    W_idx: List[Tuple[int, int]],
) -> List[Tuple[int, int]]:
    """
    冬季区间补集 -> 非冬季连续区间列表 [(p,q),...]
    """
    if N <= 0:
        return []
    if not W_idx:
        return [(0, N - 1)]

    W_sorted = sorted(W_idx)
    res: List[Tuple[int, int]] = []
    cur = 0

    for l, r in W_sorted:
        if l > cur:
            res.append((cur, l - 1))
        cur = max(cur, r + 1)

    if cur <= N - 1:
        res.append((cur, N - 1))

    return res


def split(
    tmean: List[float],
    p: int,
    q: int,
    min_seg_len: int = 15,
    smooth_win: int = 7,
) -> Tuple[Optional[Tuple[int, int]], Tuple[int, int], Optional[Tuple[int, int]]]:
    """
    对非冬季区间 [p,q] 做三段切分（保证最高温在夏季）
    返回：(spring_seg, summer_seg, autumn_seg)，均为全局索引闭区间
    """
    y = np.array(tmean[p : q + 1], dtype=float)
    L = len(y)

    if L < 3 * min_seg_len:
        # 太短，不切：整体视为夏季
        return (None, (p, q), None)

    # 平滑（移动平均，避免尖峰噪声影响切点）
    if smooth_win > 1:
        pad = smooth_win // 2
        ypad = np.pad(y, (pad, pad), mode="edge")
        kernel = np.ones(smooth_win, dtype=float) / smooth_win
        y_sm = np.convolve(ypad, kernel, mode="valid")
    else:
        y_sm = y

    # 峰值位置（强制夏季包含峰值）
    peak_local = int(np.argmax(y_sm))

    # 防止峰值过靠近边界导致无法切三段
    left_limit = min_seg_len
    right_limit = L - min_seg_len - 1
    peak_local = int(np.clip(peak_local, left_limit, right_limit))

    dy = np.diff(y_sm)

    # tau1：峰值左侧最大上升斜率
    left_start = min_seg_len - 1
    left_end = peak_local - min_seg_len
    if left_end <= left_start:
        tau1_local = peak_local - min_seg_len
    else:
        tau1_local = int(np.argmax(dy[left_start : left_end + 1]) + left_start)

    # tau2：峰值右侧最大下降斜率
    right_start = peak_local + min_seg_len
    right_end = L - min_seg_len - 1
    if right_start > right_end:
        tau2_local = peak_local + min_seg_len
    else:
        # dy[i] 表示 i -> i+1 的变化，因此索引换算要小心
        tau2_local = int(np.argmin(dy[right_start - 1 : right_end]) + (right_start - 1) + 1)

    tau1 = p + tau1_local
    tau2 = p + tau2_local

    spring = (p, tau1)
    summer = (tau1 + 1, tau2)
    autumn = (tau2 + 1, q)

    return spring, summer, autumn


def segmentation(
    df: pd.DataFrame,
    W_idx: List[Tuple[int, int]],
    tmean_col: str = "temperature_2m_mean",
    min_seg_len: int = 15,
) -> Dict:
    """
    输出：
      - NW_idx: 非冬季区间
      - seasons: [{"spring":..., "summer":..., "autumn":...}, ...]
    """
    N = len(df)
    tmean = df[tmean_col].tolist()

    NW_idx = non_winter(N, W_idx)

    seasons: List[Dict] = []
    for p, q in NW_idx:
        spring, summer, autumn = split(tmean, p, q, min_seg_len=min_seg_len)
        seasons.append({"spring": spring, "summer": summer, "autumn": autumn})

    return {"NW_idx": NW_idx, "seasons": seasons}


def graph(
    df: pd.DataFrame,
    W_idx: List[Tuple[int, int]],
    seasons: List[Dict],
    save_path: str,
    date_col: str = "time",
    tmin_col: str = "temperature_2m",
    tmean_col: str = "temperature_2m_mean",
    rain_col: str = "rain_sum",
    snow_col: str = "snowfall_sum",
    title: str = "Season Segmentation",
):
    # --- 列存在性检查（避免 KeyError）---
    need_cols = [date_col, tmin_col, tmean_col, rain_col, snow_col]
    missing = [c for c in need_cols if c not in df.columns]
    if missing:
        raise KeyError(f"Missing columns: {missing}\nCurrent columns: {list(df.columns)}")

    # --- 保存目录不存在则创建（Windows下常见）---
    out_dir = os.path.dirname(save_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    dates = df[date_col]
    tmin = df[tmin_col]
    tmean = df[tmean_col]
    rain = df[rain_col]
    snow = df[snow_col]

    fig, ax1 = plt.subplots(figsize=(14, 6))

    # ==================
    # 背景色：季节分段（先画春夏秋，再画冬季，让冬季更“压得住”）
    # ==================
    # 统一风格：背景尽量淡，不和线/柱的颜色冲突
    season_style = {
        "spring": ("#BFE7C3", 0.7),  # 淡绿
        "summer": ("#FFD1DC", 0.7),  # 淡红
        "autumn": ("#FFD2B8", 0.7),  # 淡橙
    }
    winter_style = ("#C7D7FF", 0.7)  # 淡蓝（冬季）

    # 春夏秋背景
    for s in seasons:
        for name in ("spring", "summer", "autumn"):
            seg = s.get(name)
            if seg is None:
                continue
            l, r = seg
            if l is None or r is None:
                continue
            c, a = season_style[name]
            ax1.axvspan(dates.iloc[l], dates.iloc[r], color=c, alpha=a, zorder=0)

    # 冬季背景（最后画，更明显）
    for l, r in W_idx:
        ax1.axvspan(dates.iloc[l], dates.iloc[r], color=winter_style[0], alpha=winter_style[1], zorder=0)

    # ==================
    # 左轴：温度（线）
    # ==================
    ax1.plot(dates, tmin, color="#6BAED6", alpha=0.70, linewidth=2.0, label="Min Temperature (°C)", zorder=3)
    ax1.plot(dates, tmean, color="#E31A1C", alpha=0.95, linewidth=2.2, label="Mean Temperature (°C)", zorder=4)
    ax1.axhline(0, color="black", linestyle="--", linewidth=1, alpha=0.6, zorder=2)

    ax1.set_ylabel("Temperature (°C)")
    ax1.set_xlabel("Date")

    # ==================
    # 右轴：雨 + 雪（柱）
    # ==================
    ax2 = ax1.twinx()
    ax2.bar(dates, rain, width=1.0, color="#FDAE6B", alpha=0.55, label="Rain (mm)", zorder=1)
    ax2.bar(dates, snow, width=1.0, bottom=rain, color="#74C9E5", alpha=0.75, label="Snow (mm)", zorder=1)
    ax2.set_ylabel("Precipitation (mm)")

    # ==================
    # 图例：包含季节patch
    # ==================
    from matplotlib.patches import Patch

    season_patches = [
        Patch(facecolor=season_style["spring"][0], alpha=season_style["spring"][1], label="Spring"),
        Patch(facecolor=season_style["summer"][0], alpha=season_style["summer"][1], label="Summer"),
        Patch(facecolor=season_style["autumn"][0], alpha=season_style["autumn"][1], label="Autumn"),
        Patch(facecolor=winter_style[0], alpha=winter_style[1], label="Winter"),
    ]

    lines1, labels1 = ax1.get_legend_handles_labels()
    lines2, labels2 = ax2.get_legend_handles_labels()

    ax1.legend(
        lines1 + lines2 + season_patches,
        labels1 + labels2 + [p.get_label() for p in season_patches],
        loc="upper left",
        framealpha=0.95,
    )

    ax1.set_title(title)
    plt.tight_layout()
    plt.savefig(save_path, dpi=300, bbox_inches="tight")
    plt.close()


def read_hourly_data(
    csv_path: str,
    date_col: str = "time",
) -> pd.DataFrame:
    """
    读取小时级数据：
    - 读 csv
    - 解析 time 为 datetime
    - 排序
    """
    dfh = pd.read_csv(csv_path)
    dfh[date_col] = pd.to_datetime(dfh[date_col], errors="coerce")
    dfh = dfh.dropna(subset=[date_col]).sort_values(date_col).reset_index(drop=True)
    return dfh


def filter_hourly_by_winter_dates(
    df_hour: pd.DataFrame,
    W_date: List[Tuple],
    date_col: str = "time",
) -> pd.DataFrame:
    """
    用日数据得到的冬季日期段 W_date，筛选小时数据，只保留冬季时段。
    W_date: [(date_start, date_end), ...] 其中元素是 datetime.date
    """
    if not W_date:
        # 没有冬季段，返回空表（也可以改成返回原表，看你需求）
        return df_hour.iloc[0:0].copy()

    t = df_hour[date_col]

    mask = pd.Series(False, index=df_hour.index)
    for d0, d1 in W_date:
        start_dt = pd.Timestamp(d0)  # d0 00:00:00
        end_dt = pd.Timestamp(d1) + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)  # d1 23:59:59.999999
        mask |= (t >= start_dt) & (t <= end_dt)

    return df_hour.loc[mask].copy()


def split_by_time_gap(
    dfh: pd.DataFrame,
    time_col: str = "time",
    max_gap_hours: float = 2.0,   # 超过这个间隔就断开（你可调：2h / 6h / 24h）
) -> List[pd.DataFrame]:
    """
    把小时数据按时间间隔切成多个“连续段”，避免 2月 与 12月 这种不连续月份被当成同一段。
    """
    if len(dfh) == 0:
        return []

    dfh = dfh.sort_values(time_col).reset_index(drop=True)
    t = pd.to_datetime(dfh[time_col], errors="coerce")
    dfh = dfh.loc[t.notna()].copy()
    dfh[time_col] = pd.to_datetime(dfh[time_col])
    dfh = dfh.sort_values(time_col).reset_index(drop=True)

    gaps = dfh[time_col].diff().dt.total_seconds().div(3600.0)
    cut_idx = dfh.index[(gaps > max_gap_hours).fillna(False)].tolist()

    # 根据 cut_idx 切片
    segments = []
    start = 0
    for ci in cut_idx:
        segments.append(dfh.iloc[start:ci].copy())
        start = ci
    segments.append(dfh.iloc[start:].copy())

    # 过滤空段
    segments = [seg for seg in segments if len(seg) > 0]
    return segments



@dataclass
class FTCEvent:
    """
    一次冻融循环事件（Freeze–Thaw Cycle, FTC）的汇总记录。

    说明：
    - 你这里的“完整冻融循环”定义为：冻结 -> 融化 -> 再冻结（闭合）
      或者：冻结 -> 融化 -> 冬季结束（开放式结束，末尾收尾记录）

    字段分成 4 类：
    1) 时间与长度
    2) 冻结/融化子阶段持续时长
    3) 温度极值与“幅值强度”
    4) 耦合强度 + 湿度加权后的最终强度
    """
    k: int                              # 事件序号（全局从 1 开始）
    start_time: pd.Timestamp            # 事件开始时间（真实段）
    end_time: pd.Timestamp              # 事件结束时间（真实段）
    duration_hours: float               # 真实事件持续时间（小时）
    n_points: int                       # 真实事件数据点数（小时数据的话=小时数）

    # -------- 冻结 / 融化阶段统计（注意：你后面是基于 48h 窗口做强度）--------
    freeze_duration_hours: float        # 48h 窗口内：冻结时长（小时）
    thaw_duration_hours: float          # 48h 窗口内：融化时长（小时）
    n_freeze_points: int                # 48h 窗口内：冻结点数
    n_thaw_points: int                  # 48h 窗口内：融化点数

    # -------- 48h 窗口内温度极值 --------
    tmin: float                         # 48h 窗口内最低温
    tmax: float                         # 48h 窗口内最高温

    # -------- 幅值强度（相对于阈值）--------
    freeze_intensity: float             # F = freeze_start - tmin（越冷越强）
    thaw_intensity: float               # M = tmax - thaw_start（越热越强）
    coupling_FxM: float                 # 耦合项：F*M*(带软时长修正)

    # -------- 湿度/最终强度 --------
    hmax_freezing: float                # 48h 窗口内冻结阶段最大湿度
    intensity_ftc: float                # 最终 FTC 强度（耦合项 * 湿度因子）


def compute_freeze_thaw_cycles(
    dfh: pd.DataFrame,
    time_col: str = "time",
    temp_col: str = "temperature",
    humidity_col: str = "humidity",
    alpha: float = 1.0,               # 湿度权重：环境计算可用；实验舱通常设 0
    epsilon: float = 0.001,           # 防止乘法为 0 / 防止阈值边界导致 M=0
    freeze_start: float = -2.2,       # 冻结开始阈值：T < freeze_start 认为“进入冻结态”
    thaw_start: float = 1.2,          # 融化开始阈值：T > thaw_start 认为“进入融化态”
    min_freezing_hours: int = 1,      # 事件内至少要有多少小时处于冻结（过滤噪声）
    min_thawing_hours: int = 1,       # 事件内至少要有多少小时处于融化（过滤噪声）
    write_state: bool = False,        # 是否在输出 dfh 里写 state 列，便于核查
) -> tuple[list[FTCEvent], pd.DataFrame]:
    """
    识别“冻融循环事件”（FTC）并计算每次事件强度。

    事件定义（状态机）：
    - 启动：出现 temp < freeze_start（进入冻结）
    - 转换：之后出现 temp > thaw_start（进入融化），标记 has_thawed=True
    - 闭合：在 has_thawed=True 后，再次出现 temp < freeze_start，则事件闭合，记录一次 FTC

    为什么要用 freeze_start / thaw_start 两个阈值？
    - freeze_start < thaw_start 构成滞回区间，避免温度在 0℃上下噪声波动时频繁触发
      （例如 -0.2, +0.2 来回跳不会立刻被识别成“融化/冻结切换”）

    强度计算窗口：
    - 事件强度只用事件开始后的前 48 小时 seg_cap 计算（你写死 cap_hours=48）
      这样可以：
      1) 防止超长事件导致强度被“稀释/拉长”
      2) 更符合“冻融损伤主要由初期剧烈循环贡献”的假设
    """

    # ---------- 1) 基础列检查，避免 KeyError ----------
    need = [time_col, temp_col, humidity_col]
    missing = [c for c in need if c not in dfh.columns]
    if missing:
        raise KeyError(f"Hourly df missing columns: {missing}")

    # ---------- 2) 清洗：时间转 datetime、排序；温度湿度转数值、去缺失 ----------
    dfh = dfh.copy()
    dfh[time_col] = pd.to_datetime(dfh[time_col], errors="coerce")
    dfh = dfh.dropna(subset=[time_col]).sort_values(time_col).reset_index(drop=True)

    dfh[temp_col] = pd.to_numeric(dfh[temp_col], errors="coerce")
    dfh[humidity_col] = pd.to_numeric(dfh[humidity_col], errors="coerce")
    dfh = dfh.dropna(subset=[temp_col, humidity_col]).reset_index(drop=True)

    N = len(dfh)
    if N == 0:
        return [], dfh


    # ---------- 3) 可选：写入每小时状态 state（0=无事件，1=冻结，2=融化）----------
    if write_state:
        dfh["state"] = 0

    events: list[FTCEvent] = []

    # ---------- 4) 状态机变量 ----------
    in_cycle = False          # 是否已经进入“某一次事件”的追踪状态
    has_thawed = False        # 在本事件中是否已经经历过“融化阶段”
    start_idx: Optional[int] = None  # 事件起点在 dfh 中的行号

    # 滞回区间内（freeze_start <= T <= thaw_start）保持上一次的状态，避免抖动
    last_state = 0  # 0/1/2

    def finalize_event(end_idx: int):
        """
        将 [start_idx, end_idx] 这段事件输出为 FTCEvent。
        注意：强度只基于事件开始后的 48h（seg_cap）计算；时间字段仍记录真实段 seg_full。
        """
        nonlocal start_idx, events

        if start_idx is None:
            return

        # ===== 1) 真实事件段（用于记录 start/end/duration）=====
        seg_full = dfh.iloc[start_idx : end_idx + 1].copy()

        # ===== 2) 强度计算窗口：事件开始后的前 48 小时 =====
        cap_hours = 48  
        seg_cap = seg_full.iloc[:cap_hours].copy()  # 只保留前 48 行

        # 在窗口内定义冻结/融化子段（严格使用阈值两端）
        freeze_seg = seg_cap[seg_cap[temp_col] < freeze_start]
        thaw_seg   = seg_cap[seg_cap[temp_col] > thaw_start]

        # 过滤：窗口内冻结不足 / 融化不足，则认为是噪声或不完整事件
        if len(freeze_seg) < min_freezing_hours:
            return
        if len(thaw_seg) < min_thawing_hours:
            return

        # 只在 48h 窗口内取极值（强度用窗口极值）
        tmin = float(seg_cap[temp_col].min())
        tmax = float(seg_cap[temp_col].max())

        # 冻结幅值 F：最低温比冻结阈值低多少（越冷越强）
        freeze_intensity = max(0.0, freeze_start - tmin)   # tmin 更低 -> 更强

        # 融化幅值 M：最高温比融化阈值高多少（越热越强）
        thaw_intensity = max(0.0, tmax - thaw_start + epsilon)

        # 窗口内冻结/融化时长（小时级数据：行数 ≈ 小时数）
        freeze_duration_hours = float(len(freeze_seg))
        thaw_duration_hours = float(len(thaw_seg))

        # 耦合项：F*M + “软时长修正”（时长越长，耦合略增，但会饱和）
        coupling = coupling_with_soft_duration(
            freeze_intensity=freeze_intensity,
            thaw_intensity=thaw_intensity,
            freeze_hours=freeze_duration_hours,
            thaw_hours=thaw_duration_hours,
            tau_f=6.0, tau_t=4.0, w_f=0.10, w_t=0.10,
        )

        # 湿度项：只看 48h 窗口内冻结阶段的最大湿度段
        hmax_f = float(freeze_seg[humidity_col].max()) if len(freeze_seg) else 0.0

        # 最终强度：耦合项 * (1 + alpha * 湿度/100)
        intensity = coupling * (1.0 + alpha * hmax_f / 100.0)

        # ===== 3) 真实事件时间字段（seg_full）=====
        start_time = seg_full[time_col].iloc[0]
        end_time = seg_full[time_col].iloc[-1]
        duration_hours = (end_time - start_time).total_seconds() / 3600.0

        # （可选调试）48h 窗口的“有效结束时间”
        # cap_end_time = seg_cap[time_col].iloc[-1]
        # cap_duration_hours = (cap_end_time - start_time).total_seconds() / 3600.0

        # ===== 4) 写入事件表 =====
        events.append(
            FTCEvent(
                k=len(events) + 1,
                start_time=start_time,
                end_time=end_time,
                duration_hours=float(duration_hours),
                n_points=len(seg_full),

                freeze_duration_hours=freeze_duration_hours,
                thaw_duration_hours=thaw_duration_hours,
                n_freeze_points=len(freeze_seg),
                n_thaw_points=len(thaw_seg),

                tmin=tmin,
                tmax=tmax,
                freeze_intensity=freeze_intensity,
                thaw_intensity=thaw_intensity,
                coupling_FxM=coupling,
                hmax_freezing=hmax_f,
                intensity_ftc=float(intensity),
            )
        )

    # ---------- 5) 主循环：逐小时扫描，跑状态机 ----------
    for i in range(N):
        temp = float(dfh.at[i, temp_col])
        hum = float(dfh.at[i, humidity_col])

        if not in_cycle:
            # 尚未进入事件：检测“冻结启动条件”
            # 这里加了 hum > 0 的门槛（如果湿度有 0/缺失意义，可避免误触发）
            if hum > 0 and temp < freeze_start:
                in_cycle = True
                has_thawed = False
                start_idx = i
                last_state = 1
                if write_state:
                    dfh.at[i, "state"] = 1
            else:
                last_state = 0
                if write_state:
                    dfh.at[i, "state"] = 0

        else:
            # 已在事件追踪中：判断是否进入融化、是否闭合
            if temp > thaw_start:
                # 进入融化阶段
                has_thawed = True
                last_state = 2
                if write_state:
                    dfh.at[i, "state"] = 2

            elif temp < freeze_start:
                # 处于冻结区间
                if has_thawed:
                    # 冻结 -> 融化 -> 再冻结：事件闭合
                    finalize_event(i)

                    # 重置状态，准备捕捉下一次事件
                    in_cycle = False
                    has_thawed = False
                    start_idx = None
                    last_state = 0
                    if write_state:
                        dfh.at[i, "state"] = 0
                else:
                    # 仍在初始冻结阶段（尚未发生融化）
                    last_state = 1
                    if write_state:
                        dfh.at[i, "state"] = 1

            else:
                # 滞回区间：freeze_start <= T <= thaw_start
                # 维持 last_state，避免在阈值附近抖动触发切换
                if write_state:
                    dfh.at[i, "state"] = last_state if last_state in (1, 2) else 1

    # ---------- 6) 收尾：如果冬季末尾停在“已融化但未再冻结” ----------
    if in_cycle and has_thawed and start_idx is not None:
        finalize_event(N - 1)

    return events, dfh


def lab_cycle_intensity(
    Tmin_lab: float = -18.0,
    Tmax_lab: float = 5.0,
    freeze_start: float = -2.2,
    thaw_start: float = 1.2,
    freeze_hours: float = 2.5,
    thaw_hours: float = 1.5,
    alpha: float = 0.0,          # 实验舱一般设 0（不引入湿度）
    hmax_freezing: float = 0.0,  # 实验舱冻结期最高湿度（如果不用湿度就保持 0）
    epsilon: float = 0.001,
) -> float:
    """
    计算“实验舱标准单次冻融循环”的强度，结构与环境事件强度保持一致，便于做等效映射。

    1) 幅值：
       F = freeze_start - Tmin_lab
       M = Tmax_lab - thaw_start
    2) 耦合：调用 coupling_with_soft_duration (带软时长修正)
    3) 湿度：乘以 (1 + alpha*h/100)，通常 alpha=0 -> 该项为 1
    """
    F = max(0.0, freeze_start - Tmin_lab)                # 冻结幅值
    M = max(0.0, Tmax_lab - thaw_start + epsilon)        # 融化幅值

    coupling = coupling_with_soft_duration(
        freeze_intensity=F,
        thaw_intensity=M,
        freeze_hours=freeze_hours,
        thaw_hours=thaw_hours,
        tau_f=6.0, tau_t=4.0, w_f=0.10, w_t=0.10,
    )

    intensity = coupling * (1.0 + alpha * hmax_freezing / 100.0)
    return float(intensity)

def coupling_with_soft_duration(
    freeze_intensity: float,
    thaw_intensity: float,
    freeze_hours: float,
    thaw_hours: float,
    tau_f: float = 6.0,   # 冻结时长“饱和尺度”（小时）
    tau_t: float = 4.0,   # 融化时长“饱和尺度”（小时）
    w_f: float = 0.10,    # 冻结时长修正权重（相对增益）
    w_t: float = 0.10,    # 融化时长修正权重（相对增益）
) -> float:
    """
    将幅值项 F*M 与“软时长修正”结合。

    基础幅值项：
      I_amp = F * M
      F = freeze_intensity
      M = thaw_intensity

    软时长函数（单调递增但会饱和）：
      g_f = 1 - exp(-freeze_hours / tau_f)
      g_t = 1 - exp(-thaw_hours / tau_t)

    最终耦合：
      I = I_amp * (1 + w_f*g_f + w_t*g_t)

    解释：
    - freeze_hours / thaw_hours 增大时，g_f/g_t 趋于 1，额外增益趋于 w_f/w_t 的上限。
    - 这样避免“持续时间无限拉长导致强度无限增大”的不合理情况。
    """
    I_amp = freeze_intensity * thaw_intensity
    g_f = 1.0 - np.exp(-freeze_hours / tau_f)
    g_t = 1.0 - np.exp(-thaw_hours / tau_t)
    return float(I_amp * (1.0 + w_f * g_f + w_t * g_t))


def design_partial_lab_cycle_by_residual(
    residual: float,
    Tmin_lab: float = -18.0,
    Tmax_lab: float = 5.0,
    freeze_start: float = -2.2,
    thaw_start: float = 1.2,
    freeze_hours: float = 2.5,
    thaw_hours: float = 1.5,
    alpha: float = 0.0,
    hmax_freezing: float = 0.0,
    epsilon: float = 0.001,
    # 下面这些要和你 compute_freeze_thaw_cycles 里一致
    tau_f: float = 6.0,
    tau_t: float = 4.0,
    w_f: float = 0.10,
    w_t: float = 0.10,
    max_iter: int = 60,
) -> dict:
    """
    目标：给定 residual(环境总强度除去若干完整实验舱循环后的“剩余强度”),
    设计一个“部分幅值”的实验舱循环，使其强度尽可能接近 residual。

    思路：用一个缩放参数 s ∈ [0,1] 同时缩放冻结/融化幅值，保持 F/M 的比例不变：
      - s = 0 :温度幅值接近阈值(最弱),Tmin≈freeze_start, Tmax≈thaw_start
      - s = 1 :达到标准实验舱循环幅值(最强),Tmin=Tmin_lab, Tmax=Tmax_lab
    """

    if residual <= 0:
        return {"ok": False, "reason": "residual<=0"}

    # 标准实验舱幅值（用于确定缩放的最大幅度）
    F_lab = max(0.0, freeze_start - Tmin_lab)
    M_lab = max(0.0, Tmax_lab - thaw_start + epsilon)
    if F_lab <= 0 or M_lab <= 0:
        return {"ok": False, "reason": "lab amplitudes invalid"}

    # 标准实验舱“完整循环”的强度上限 I_full
    I_full = lab_cycle_intensity(
        Tmin_lab=Tmin_lab,
        Tmax_lab=Tmax_lab,
        freeze_start=freeze_start,
        thaw_start=thaw_start,
        freeze_hours=freeze_hours,
        thaw_hours=thaw_hours,
        alpha=alpha,
        hmax_freezing=hmax_freezing,
        epsilon=epsilon,
    )

    # 如果 residual >= I_full，说明“剩余”已经不小于一个完整循环
    # 这种情况下部分循环会饱和到 full cycle（外层应该增加 full cycles）
    if residual >= I_full:
        return {
            "ok": True,
            "Tmin_partial": float(Tmin_lab),
            "Tmax_partial": float(Tmax_lab),
            "I_partial": float(I_full),
            "residual": float(residual),
            "residual_error": float(residual - I_full),
            "note": "residual >= I_full, partial saturated at full lab cycle"
        }

    # 定义 I(s)：给定缩放 s，构造对应 Tmin/Tmax，再算强度
    def I_of_s(s: float) -> float:
        # Tmin 从 freeze_start 往下拉到 Tmin_lab（冻结幅值逐渐变强）
        Tmin = freeze_start - s * F_lab
        # Tmax 从 thaw_start 往上推到 Tmax_lab（融化幅值逐渐变强）
        Tmax = (thaw_start - epsilon) + s * M_lab

        # 强制限制在实验舱可控范围内
        Tmin = float(np.clip(Tmin, Tmin_lab, freeze_start))
        Tmax = float(np.clip(Tmax, thaw_start, Tmax_lab))

        return lab_cycle_intensity(
            Tmin_lab=Tmin,
            Tmax_lab=Tmax,
            freeze_start=freeze_start,
            thaw_start=thaw_start,
            freeze_hours=freeze_hours,
            thaw_hours=thaw_hours,
            alpha=alpha,
            hmax_freezing=hmax_freezing,
            epsilon=epsilon,
        )

    # 二分搜索：I(s) ~ residual（I(s) 单调时很稳）
    lo, hi = 0.0, 1.0
    best_s = 0.0
    best_I = I_of_s(0.0)
    best_err = abs(best_I - residual)

    for _ in range(max_iter):
        mid = (lo + hi) / 2.0
        I_mid = I_of_s(mid)
        err = abs(I_mid - residual)

        # 记录当前最优解
        if err < best_err:
            best_err = err
            best_s = mid
            best_I = I_mid

        # 单调性：若 I(mid) < residual，说明 s 太小，要增大
        if I_mid < residual:
            lo = mid
        else:
            hi = mid

    # 用 best_s 还原 Tmin/Tmax
    Tmin_best = float(np.clip(freeze_start - best_s * F_lab, Tmin_lab, freeze_start))
    Tmax_best = float(np.clip((thaw_start - epsilon) + best_s * M_lab, thaw_start, Tmax_lab))

    return {
        "ok": True,
        "Tmin_partial": Tmin_best,
        "Tmax_partial": Tmax_best,
        "I_partial": float(best_I),
        "residual": float(residual),
        "residual_error": float(residual - best_I),
        "s_scale": float(best_s),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Winter segmentation for Dunhuang dataset")
    parser.add_argument("--path", type=str, default="back_con\data\processed_weather_data.csv", help="path to csv")
    parser.add_argument("--T0", type=float, default=0.0, help="cold threshold (°C)")
    parser.add_argument("--g", type=int, default=6, help="gap tolerance (days)")
    parser.add_argument("--min_len", type=int, default=7, help="minimum winter segment length (days)")
    parser.add_argument("--out", type=str, default="image/Season Segmentation.png")

    parser.add_argument("--hour_path", type=str, default="back_con\data\processed_weather_data.csv", help="path to hourly csv")
    parser.add_argument("--hour_out", type=str, default="dunhuang_hour_winter.csv", help="output winter-only hourly csv")
    parser.add_argument("--hour_temp_col", type=str, default="temperature", help="hourly temperature column name")
    parser.add_argument("--hour_hum_col", type=str, default="humidity", help="hourly humidity column name")
    parser.add_argument("--ftc_out", type=str, default="ftc_events_winter.csv", help="output FTC events csv")
    parser.add_argument("--alpha", type=float, default=1.0, help="alpha for intensity formula")
    parser.add_argument("--write_state", action="store_true", help="write per-hour state labels")
    parser.add_argument("--state_out", type=str, default="dunhuang_hour_winter_with_state.csv", help="output hourly with state csv")
    parser.add_argument("--freeze_start", type=float, default=-2.2, help="freeze start threshold (°C), e.g. -2.2")
    parser.add_argument("--thaw_start", type=float, default=1.2, help="thaw start threshold (°C), e.g. 1.2")
    parser.add_argument("--min_thawing_hours", type=int, default=1, help="minimum thawing hours in an event")
    parser.add_argument("--min_freezing_hours", type=int, default=1, help="minimum freezing hours in an event")
    parser.add_argument("--epsilon", type=float, default=0.001, help="avoid 0° multiply let intensity become 0")

    # ====== 实验舱等效映射参数 ======
    parser.add_argument("--lab_Tmin", type=float, default=-18.0, help="lab cycle Tmin (°C)")
    parser.add_argument("--lab_Tmax", type=float, default=5.0, help="lab cycle Tmax (°C)")
    parser.add_argument("--lab_total_hours", type=float, default=4.0, help="lab cycle total hours (not used in formula, for record)")
    parser.add_argument("--lab_freeze_hours", type=float, default=2.5, help="lab freeze duration hours")
    parser.add_argument("--lab_thaw_hours", type=float, default=1.5, help="lab thaw duration hours")
    parser.add_argument("--lab_alpha", type=float, default=1.0, help="lab humidity weight (usually 0)")
    parser.add_argument("--lab_hmax_freezing", type=float, default=85.0, help="lab freezing max humidity if used")
    parser.add_argument("--equiv_out", type=str, default="ftc_equivalent_mapping.csv", help="output equivalent mapping csv")


    args = parser.parse_args()

    df = read_data(csv_path=args.path)

    result = winter(df=df, T0=args.T0, g=args.g, min_len=args.min_len)

    print("冬季段数量 K_w =", result["K_w"])
    print("冬季段（索引）W_idx =", result["W_idx"])
    print("冬季段（日期）W_date =")
    for a, b in result["W_date"]:
        print("  ", a, "->", b)

    nw_result = segmentation(
        df=result["df"],
        W_idx=result["W_idx"],
        tmean_col="temperature_2m",
        min_seg_len=15,
    )

    print("非冬季区间 NW_idx =", nw_result["NW_idx"])
    print("春 / 夏 / 秋 划分：")
    for s in nw_result["seasons"]:
        print(s)

    graph(
        df=result["df"],
        W_idx=result["W_idx"],
        seasons=nw_result["seasons"],
        save_path=args.out,
        rain_col="rain_sum",
        snow_col="snowfall_sum",
        tmin_col="temperature_2m",
        tmean_col="temperature_2m_mean",
        date_col="time",
    )


    # ====== 用冬季日期段筛选小时数据，并输出 ======
    dfh = read_hourly_data(csv_path=args.hour_path, date_col="time")
    dfh_winter = filter_hourly_by_winter_dates(df_hour=dfh, W_date=result["W_date"], date_col="time")

    dfh_winter.to_csv(args.hour_out, index=False, encoding="utf-8-sig")
    print(f"已输出冬季小时数据：{args.hour_out}，行数 = {len(dfh_winter)}")


    # ====== 冻融循环识别（按时间连续段分别计算，避免 2月/12月跨段拼接）======
    segments = split_by_time_gap(dfh_winter, time_col="time", max_gap_hours=2.0)

    all_events: list[FTCEvent] = []
    all_state_parts: list[pd.DataFrame] = []

    for seg in segments:
        ev, st = compute_freeze_thaw_cycles(
            seg,
            time_col="time",
            temp_col=args.hour_temp_col,
            humidity_col=args.hour_hum_col,
            alpha=args.alpha,
            epsilon=args.epsilon,
            freeze_start=args.freeze_start,
            thaw_start=args.thaw_start,
            min_freezing_hours=args.min_freezing_hours,
            min_thawing_hours=args.min_thawing_hours,
            write_state=args.write_state,
        )
        all_events.extend(ev)
        all_state_parts.append(st)

    # 合并 state（如果要输出每小时状态）
    dfh_state = pd.concat(all_state_parts, ignore_index=True) if all_state_parts else dfh_winter.copy()

    # 重新编号 k（确保全局递增）
    for idx, e in enumerate(all_events, start=1):
        e.k = idx

    events = all_events


    # 输出每次冻融循环汇总
    events_df = pd.DataFrame([e.__dict__ for e in events])

    # ====== 等效映射：环境强度总量 -> 实验舱冻融循环 ======
    if len(events_df) > 0:
        I_env_total = float(events_df["intensity_ftc"].sum())

        I_lab = lab_cycle_intensity(
            Tmin_lab=args.lab_Tmin,
            Tmax_lab=args.lab_Tmax,
            freeze_start=args.freeze_start,
            thaw_start=args.thaw_start,
            freeze_hours=args.lab_freeze_hours,
            thaw_hours=args.lab_thaw_hours,
            alpha=args.lab_alpha,
            hmax_freezing=args.lab_hmax_freezing,
            epsilon=args.epsilon,
        )

        if I_lab > 0:
            n_equiv = I_env_total / I_lab
            n_full = int(I_env_total // I_lab)
            residual = I_env_total - n_full * I_lab

            partial = design_partial_lab_cycle_by_residual(
                residual=residual,
                Tmin_lab=args.lab_Tmin,
                Tmax_lab=args.lab_Tmax,
                freeze_start=args.freeze_start,
                thaw_start=args.thaw_start,
                freeze_hours=args.lab_freeze_hours,
                thaw_hours=args.lab_thaw_hours,
                alpha=args.lab_alpha,
                hmax_freezing=args.lab_hmax_freezing,
                epsilon=args.epsilon,
            )

            # ====== 单独保存等效映射结果（推荐）======
            mapping_row = {
                "I_env_total": I_env_total,
                "I_lab_single": I_lab,
                "n_equiv": n_equiv,
                "n_full": n_full,
                "residual": residual,
                "lab_Tmin": args.lab_Tmin,
                "lab_Tmax": args.lab_Tmax,
                "lab_freeze_hours": args.lab_freeze_hours,
                "lab_thaw_hours": args.lab_thaw_hours,
            }

            if partial.get("ok"):
                mapping_row.update({
                    "lab_Tmin_partial": partial["Tmin_partial"],
                    "lab_Tmax_partial": partial["Tmax_partial"],
                    "I_partial": partial["I_partial"],
                    "residual_error": partial["residual_error"],
                })

            pd.DataFrame([mapping_row]).to_csv(
                args.equiv_out, index=False, encoding="utf-8-sig"
            )
            print(f"[OK] Equivalent mapping saved to: {args.equiv_out}")
        else:
            print("[WARN] I_lab <= 0, skip equivalent mapping")
    else:
        print("[INFO] No FTC events, skip equivalent mapping")


    # ====== 强度归一化到 0–100（后处理，不影响物理计算）======
    if len(events_df) > 0:
        I_raw = events_df["intensity_ftc"]
        if I_raw.max() > I_raw.min():
            events_df["intensity_norm_0_100"] = (
                100 * (I_raw - I_raw.min()) / (I_raw.max() - I_raw.min())
            )
        else:
            # 所有事件强度相同，避免除零
            events_df["intensity_norm_0_100"] = 50.0

    # 保存结果
    events_df.to_csv(args.ftc_out, index=False, encoding="utf-8-sig")
    print(f"冻融循环次数 K = {len(events)}，已输出事件表：{args.ftc_out}")

    # （可选）输出每小时状态，方便你核对
    if args.write_state:
        dfh_state.to_csv(args.state_out, index=False, encoding="utf-8-sig")
        print(f"已输出带状态的小时数据：{args.state_out}")
