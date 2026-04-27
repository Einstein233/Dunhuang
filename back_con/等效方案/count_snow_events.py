#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
降雪事件统计脚本

统计规则：一次降雪之后，如果温度一直维持在 0 度以下，认为是一次连续降雪事件；
         如果中间温度升至 0 度以上，则认为降雪结束，之后的是另一场降雪。

使用方法：
    python count_snow_events.py
"""

import sys
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from core import count_snow_events


if __name__ == "__main__":
    # 默认数据文件路径
    default_csv = Path(__file__).parent / "data" / "processed_weather_data.csv"

    if not default_csv.exists():
        print(f"错误：数据文件不存在：{default_csv}")
        print("请确保 data/processed_weather_data.csv 文件存在")
        sys.exit(1)

    # 支持命令行参数指定阈值
    threshold = 0.0
    if len(sys.argv) > 1:
        try:
            threshold = float(sys.argv[1])
            print(f"使用自定义温度阈值：{threshold}°C")
        except ValueError:
            print(f"警告：无效的温度阈值，使用默认值 0°C")

    print("\n" + "#"*60)
    print("# 降雪事件统计")
    print("#"*60 + "\n")

    # 使用集成后的便捷函数
    count_snow_events(str(default_csv), snow_temp_threshold=threshold, verbose=True)
