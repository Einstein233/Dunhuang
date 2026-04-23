"""
敦煌项目气候数据处理服务器
simu_exper_server.py - 用于处理气候数据
"""

import json
import os
import pandas as pd
from expert_class.exp import (ExperimentInput,
                              RainfallEquivalenceCalculator
                              )

from back_con.src.expert_class.Ssegment import winter, segmentation
from pprint import pprint

def main():    
    print("=" * 60)
    print("开始执行气候数据处理任务")
    print("=" * 60)
    
    weather_data = ExperimentInput("back_con/processed_weather_data_tianjin.csv")

    df = weather_data.df.copy()

    rainfall_list = df["rain"].tolist()

    calculator = RainfallEquivalenceCalculator(rainfall_list)

    #计算区分大中小雨三种工况的阈值
    rain_thresholds = calculator.rainfall_cluster_thresholds()

    #计算地区代表降雨量
    repre_rain = calculator.extract_rain_events()

    print("++++++++++++++")
    list = calculator.process_rain_event_data()
    print(f"事件降雨量的列表为:{list}")
    repre_rain = calculator.cluster_rain_events_two_classes()

    calculator.thresholds['light'] = rain_thresholds['T1']
    calculator.thresholds['moderate'] = rain_thresholds['T2']
    calculator.target_rain_sum_mm = repre_rain['recommended_event_rain']

    print(f"更改后的阈值是：{calculator.thresholds}，地区代表降雨量是:{calculator.target_rain_sum_mm}")
    result_json = calculator.calculate()

    from pprint import pprint
    if isinstance(result_json, str):
        result_json = json.loads(result_json)

    print("雨量等效汇总表：")
    pprint(result_json)


if __name__ == "__main__":
    main()
