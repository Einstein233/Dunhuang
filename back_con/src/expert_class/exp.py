from typing import List, Dict, Any, Optional
import pandas as pd
import json
import math
import numpy as np
from sklearn.mixture import GaussianMixture



class ExperimentInput:
    """
    实验输入数据类（DataFrame 版本）

    - weather_data_table: pandas.DataFrame
    - fields: 字段列表
    """

    def __init__(self,file_path:str):
        # 主数据表（DataFrame）
        self.df = pd.read_csv(file_path)
        self.df['time'] = pd.to_datetime(self.df['time'])

    def show_head(self, n: int = 5):
        """
        显示表格前 n 行数据（默认 5 行）
        """
        if self.df is None:
            print("当前没有数据")
            return

        print(self.df.head(n))

    def get_columns(self):
        """
        返回所有字段名（列名）的列表
        """
        return self.df.columns.tolist()

class RainfallEquivalenceCalculator:
    def __init__(self, rain_data):
        self.rain_data:List = rain_data
        
        # --- [参数设置] 用户可在此处调整 ---
        # 工况阈值 (mm/h)
        self.thresholds:Dict = {
            'light': 0.3,      # 默认小雨上限
            'moderate': 0.9    # 默认中雨上限 (大于0.9为大雨)
        }
        self.lab_intensities:Dict = {
            'light': 20,
            'moderate': 40,
            'heavy': 60
        }

        #基于损伤的缩放因子的参数设置
        self.min_scaling_factor = 0.6
        self.max_scaling_factor = 1.4
        self.k = 2.0
        self.x0 = 0.65

        self.min_rainfall = 0.3
        self.min_raingap = 3
        self.rain_events_list = []
        self.repre_rain_mm = 5

        self.target_rain_sum_mm = 5.0
        self.correction_exponent = 0.1

                

    #根据降雨强度计算缩放参数
    def calculate_scaling_factor(self, intensity):
        """
        sigmoid函数缩放因子
        """
        
        min_f = self.min_scaling_factor
        max_f = self.max_scaling_factor
        k = self.k      
        x0 = self.x0    
        
        exponent = -k * (intensity - x0)
        
        try:
            sigmoid_part = 1 / (1 + math.exp(exponent))
        except OverflowError:
            sigmoid_part = 0.0 if exponent > 0 else 1.0
            
        factor = min_f + (max_f - min_f) * sigmoid_part
        
        return factor
    
    #根据实验降雨强度与自然降雨强度的比值计算降雨的时间补偿系数
    def calculate_correction_factor(self, lab_intensity, natural_intensity):
        """
        逆幂律函数计算时间补偿因子
        公式: Correction = (I_lab / I_natural) ^ n
        其中 n = 0.1
        """
        if natural_intensity <= 0:
            return 1.0
        
        ratio = lab_intensity / natural_intensity
        
        ratio = max(1.0, ratio)
        
        correction_factor = math.pow(ratio, self.correction_exponent)
        return correction_factor
    
    #根据聚类算法计算地区的降雨强度的小/中/大雨阈值
    def rainfall_cluster_thresholds(
        self,
        n_clusters=3,
        min_samples=30,
        random_state=42
    ):  
        """
        Returns
        -------
        thresholds : dict
            {
                "T1": 小雨-中雨分界(mm),
                "T2": 中雨-大雨分界(mm),
                "method": "gmm" or "quantile"
            }
        """
        rainfall_mm = np.asarray(self.rain_data, dtype=float)
        rain = rainfall_mm[rainfall_mm > 0]                 # 1. 只保留有雨小时
        if len(rain) < max(min_samples, n_clusters * 5):    # 数据太少，回退到分位数
            T1 = np.percentile(rain, 70)
            T2 = np.percentile(rain, 90)
            return {"T1": T1, "T2": T2, "method": "quantile_fallback"}

        x = np.log1p(rain).reshape(-1, 1)                   # 2. 对数变换（处理长尾）

        gmm = GaussianMixture(                              # 3. GMM 聚类
            n_components=n_clusters,
            covariance_type="full",
            random_state=random_state
        )
        gmm.fit(x)
        labels = gmm.predict(x)
        means = gmm.means_.flatten()
        order = np.argsort(means)
        mean1 = means[order[0]]
        mean2 = means[order[1]]
        mean3 = means[order[2]]
        T1 = np.expm1((mean1 + mean2) / 2)
        T2 = np.expm1((mean2 + mean3) / 2)

        #对数据进行处理
        self.thresholds['light'] = T1
        self.thresholds['moderate'] = T2
        return {"T1": T1, "T2": T2, "method": "gmm"}
    
    def extract_rain_events(self, eps=1e-6) -> Dict:
        """
        从小时降雨量序列中提取连续降雨事件（如果降雨间隔小于3h则认为是一次降雨）
        输出结构不变。
        """
        merge_gap_hours = self.min_raingap
        rain_data = self.rain_data

        events = []
        current_sum = 0.0
        event_min = self.min_rainfall

        dry_gap = 0
        in_event = False

        # ✅ 每次提取前先清空，避免跨季节/跨调用累积
        self.rain_events_list = []

        for r in rain_data:
            r = 0.0 if r is None else float(r)
            if r > eps:
                current_sum += r
                dry_gap = 0
                in_event = True
            else:
                if in_event:
                    dry_gap += 1
                    if dry_gap > merge_gap_hours:
                        events.append(current_sum)
                        current_sum = 0.0
                        dry_gap = 0
                        in_event = False

        if in_event and current_sum > 0:
            events.append(current_sum)

        # 过滤掉太小的事件，形成 rain_events_list
        for event in events:
            if event > event_min:
                self.rain_events_list.append(float(event))

        # ✅ 关键修复：判断“过滤后的事件列表”是否为空
        if len(self.rain_events_list) == 0:
            return {
                "event_totals": [],
                "event_count": 0,
                "mean_event_rain": 0.0,
                "max_event_rain": 0.0,
                "min_event_rain": 0.0
            }

        return {
            "event_totals": self.rain_events_list,
            "event_count": len(self.rain_events_list),
            "mean_event_rain": sum(self.rain_events_list) / len(self.rain_events_list),
            "max_event_rain": max(self.rain_events_list),
            "min_event_rain": min(self.rain_events_list)
        }
    
    def process_rain_event_data(self):
        """
        对连续降雨事件总量进行处理：
        1. 统一到 0.1 mm 粒度
        2. 排序
        输出结构不变：{"processed_data": [...]}
        """
        data = np.asarray(self.rain_events_list, dtype=float)

        # ✅ 空就返回空，不抛异常（保证 pipeline 不崩）
        if data.size == 0:
            self.rain_events_list = np.array([], dtype=float)
            return {"processed_data": []}

        data_rounded = np.round(data, 1)
        data_sorted = np.sort(data_rounded)
        self.rain_events_list = data_sorted

        return {"processed_data": data_sorted.tolist()}

    def cluster_rain_events_two_classes(self, random_state=42):
        """
        二类聚类（小/大事件），方法不变：GMM + log1p + 2类
        输出字段不变。
        少雨/无雨：按均值 fallback（你项目口径）
        """
        data = np.asarray(self.rain_events_list, dtype=float)
        data = data[data > 0]

        def _safe_stats(arr: np.ndarray):
            if arr.size == 0:
                return {"count": 0, "mean": 0.0, "max": 0.0}
            return {
                "count": int(arr.size),
                "mean": float(np.mean(arr)),
                "max": float(np.max(arr))
            }

        def _fallback_mean():
            # ✅ 你要的策略：少雨/无雨按均值
            small_events = np.array([], dtype=float)
            large_events = data.copy()

            stats = {
                "small": _safe_stats(small_events),
                "large": _safe_stats(large_events),
            }

            # 无事件 -> 0；有事件 -> mean（而不是 percentile）
            recommended_event_rain = float(stats["large"]["mean"])

            self.repre_rain_mm = recommended_event_rain
            return {
                "small_events": small_events.tolist(),
                "large_events": large_events.tolist(),
                "stats": stats,
                "recommended_event_rain": recommended_event_rain
            }

        # ---------- 0) 无事件：直接均值 fallback ----------
        if data.size == 0:
            return _fallback_mean()

        # ---------- 1) 少事件：不聚类，均值 fallback ----------
        if data.size < 5:
            return _fallback_mean()

        # ---------- 2) 正常 GMM 聚类（方法不变） ----------
        x = np.log1p(data).reshape(-1, 1)

        gmm = GaussianMixture(
            n_components=2,
            covariance_type="full",
            random_state=random_state
        )
        gmm.fit(x)

        labels = gmm.predict(x)
        means = gmm.means_.flatten()

        large_label = int(np.argmax(means))
        small_label = 1 - large_label

        small_events = data[labels == small_label]
        large_events = data[labels == large_label]

        # 退化保护：某类为空 -> 均值 fallback
        if small_events.size == 0 or large_events.size == 0:
            return _fallback_mean()

        stats = {
            "small": _safe_stats(small_events),
            "large": _safe_stats(large_events),
        }

        # ✅ 正常情况仍保留你原来的推荐规则（不改变“聚类方法”，也不改变正常输出口径）
        recommended_event_rain = float(max(
            stats["large"]["mean"],
            float(np.percentile(large_events, 75))
        ))

        self.repre_rain_mm = recommended_event_rain

        return {
            "small_events": small_events.tolist(),
            "large_events": large_events.tolist(),
            "stats": stats,
            "recommended_event_rain": recommended_event_rain
        }

    def calculate(self) -> str:
        """
        对一段时间进行计算结果
        （仅整理结构与可读性，不改变任何逻辑与输出）
        """
        conditions = ["light", "moderate", "heavy"]
        final_output: Dict[str, Any] = {}

        # ---------- 0) 输入检查 ----------
        if not self.rain_data:
            return json.dumps({"error": "rain_data 为空"}, ensure_ascii=False)

        # ---------- 工具函数：统一输出结构 ----------
        def _empty_simple_result() -> Dict[str, Any]:
            # 无雨时：保持你原来的简版结构
            return {
                "equivalent_total_rain": 0.0,
                "intensity_setting": 0.0,
                "event_count": 0,
                "single_duration_min": 0.0,
            }

        def _finalize_no_rain() -> str:
            for cond in conditions:
                final_output[cond] = _empty_simple_result()
            return json.dumps(final_output, indent=4, ensure_ascii=False)

        # ---------- 1) 从 list 中抽取小时降雨量序列（mm/h） ----------
        def _extract_hourly_rains(data_list) -> np.ndarray:
            rains: List[float] = []
            for item in data_list:
                if isinstance(item, (int, float, np.number)):
                    rains.append(float(item))
                elif isinstance(item, dict):
                    if "rain" in item:
                        rains.append(float(item.get("rain", 0.0) or 0.0))
                    elif "total_precip" in item:
                        rains.append(float(item.get("total_precip", 0.0) or 0.0))
                    else:
                        # 未识别字段，按0处理（也可以改为 raise）
                        rains.append(0.0)
                else:
                    # 未知类型，按0处理
                    rains.append(0.0)

            rains_arr = np.asarray(rains, dtype=float)
            rains_arr = np.nan_to_num(rains_arr, nan=0.0, posinf=0.0, neginf=0.0)
            return rains_arr

        rains_arr = _extract_hourly_rains(self.rain_data)

        # ---------- 2) 只取有雨小时 ----------
        rain_vals = rains_arr[rains_arr > 0]
        if rain_vals.size == 0:
            return _finalize_no_rain()

        # ---------- 3) 分类函数（按小时降雨强度阈值） ----------
        def get_condition(p: float) -> str:
            if p <= self.thresholds["light"]:
                return "light"
            elif p <= self.thresholds["moderate"]:
                return "moderate"
            else:
                return "heavy"

        # ---------- 4) 分工况计算：等效总雨量、实验室总时长、次数、单次时长 ----------
        for cond in conditions:
            cond_mask = np.array([get_condition(p) == cond for p in rain_vals], dtype=bool)
            cond_data = rain_vals[cond_mask]

            if cond_data.size == 0:
                final_output[cond] = _empty_simple_result()
                continue

            # A) 自然降雨统计
            natural_intensity_setting = float(cond_data.mean())
            raw_total = float(cond_data.sum())

            # B) 缩放/等效（你当前逻辑为写死：s_factor=1, equivalent_total=raw_total）
            s_factor = 1.0
            equivalent_total = raw_total  # 因为 effective_rain_hourly = total_precip * 1

            # C) 实验室强度（mm/h）
            lab_intensity = float(self.lab_intensities[cond])

            # D) 时间补偿（你当前逻辑写死 correction_factor=1.0）
            correction_factor = 1.0
            if lab_intensity > 0:
                theoretical_hours = equivalent_total / lab_intensity
            else:
                theoretical_hours = 0.0

            final_lab_hours = theoretical_hours * correction_factor
            total_duration_min = final_lab_hours * 60.0

            # E) 单次目标时长（分钟）
            if lab_intensity > 0:
                single_duration_hours_target = self.target_rain_sum_mm / lab_intensity
                single_duration_min_target = single_duration_hours_target * 60.0
            else:
                single_duration_min_target = 0.0

            # F) 次数（保持你原来的 round + 至少 1 次逻辑）
            if single_duration_min_target > 0:
                event_count = max(1, round(total_duration_min / single_duration_min_target))
            else:
                event_count = 0

            # 微调单次时长以匹配总时长
            single_duration_min_actual = (total_duration_min / event_count) if event_count > 0 else 0.0

            # 实际喷淋总量
            actual_spray_total = final_lab_hours * lab_intensity

            # 输出结构保持一致
            final_output[cond] = {
                "natural_stats": {
                    "avg_intensity": round(natural_intensity_setting, 3),
                    "raw_total": round(raw_total, 3),
                },
                "calc_params": {
                    "s_factor": round(s_factor, 3),
                    "correction_factor": round(correction_factor, 3),
                    "target_equivalent_rain": round(equivalent_total, 3),
                },
                "lab_settings": {
                    "intensity_setting": lab_intensity,
                    "actual_spray_total": round(actual_spray_total, 3),
                    "total_duration_min": round(total_duration_min, 2),
                },
                "execution_plan": {
                    "event_count": int(event_count),
                    "single_duration_min": round(single_duration_min_actual, 2),
                },
            }

        return json.dumps(final_output, indent=4, ensure_ascii=False)
