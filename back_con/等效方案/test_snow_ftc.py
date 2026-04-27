#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
降雪 - 冻融循环模块输出脚本

输出内容：
1. 总降雪量、降雪次数、每次降雪量
2. 冻融事件次数，等效冻融损伤指标
3. 标准冻融块的设置、冻融块设置数量
4. 目标 CSV 文件
"""

import sys
from pathlib import Path

# 添加父目录到路径
sys.path.insert(0, str(Path(__file__).parent))

# =============================================================================
# 全局配置 - 只需修改这一处！
# =============================================================================
DATA_FILE = "processed_weather_data.csv"  # 修改这里的数据文件名
# =============================================================================

from core import (
    WeatherDataLoader,
    FTCEventIdentifier,
    FTCEquivalenceConverter,
    SnowFTCPlanGenerator,
    SnowFTCFormatter,
    count_snow_events,
    # 配置常量
    LAB_FTC_TMIN,
    LAB_FTC_TMAX,
    LAB_FTC_FREEZE_HOURS,
    LAB_FTC_THAW_HOURS
)


def main():
    """主函数：输出降雪 - 冻融统计信息"""

    csv_path = Path(__file__).parent / "data" / DATA_FILE

    if not csv_path.exists():
        print(f"错误：数据文件不存在：{csv_path}")
        sys.exit(1)

    # ==========================================================================
    # 1. 降雪统计
    # ==========================================================================
    print("=" * 60)
    print("1. 降雪统计")
    print("=" * 60)

    snow_events, snow_stats = count_snow_events(str(csv_path), snow_temp_threshold=0.0, verbose=False)

    total_snow_cm = snow_stats['total_snow_depth_cm']
    total_snow_mm = snow_stats['total_snow_depth_mm']
    n_events = snow_stats['total_snow_events']
    avg_snow_mm = snow_stats['avg_snow_per_event_mm']

    print(f"降雪次数：{n_events} 次")
    print(f"总降雪量：{total_snow_cm} cm (= {total_snow_mm} mm)")
    print(f"平均每场降雪：{avg_snow_mm:.2f} mm")

    print("\n每次降雪详情:")
    print(f"{'序号':<6} {'开始时间':<22} {'结束时间':<22} {'降雪量 (cm)':<12} {'降雪量 (mm)':<12}")
    print("-" * 74)
    for event in snow_events:
        snow_cm = event.total_snow_depth  # 本身就是 cm
        snow_mm = event.total_snow_depth * 10.0  # cm → mm
        print(f"{event.event_id:<6} {str(event.start_time):<22} {str(event.end_time):<22} "
              f"{snow_cm:<12.2f} {snow_mm:<12.2f}")

    # ==========================================================================
    # 2. 冻融事件与损伤指标
    # ==========================================================================
    print("\n" + "=" * 60)
    print("2. 冻融事件与损伤指标")
    print("=" * 60)

    # 加载数据并识别冻融事件
    loader = WeatherDataLoader(str(csv_path))
    dataset, _ = loader.load_with_statistics()

    ftc_identifier = FTCEventIdentifier(
        freeze_start=-2.2,
        thaw_start=1.2
    )
    natural_events = ftc_identifier.identify(dataset)

    n_natural_ftc = len(natural_events)

    # 计算等效转换
    converter = FTCEquivalenceConverter(
        damage_alpha=1.0,
        damage_beta=0.5
    )
    lab_events = converter.convert(natural_events)

    total_natural_damage = sum(e.ftc_damage for e in natural_events)
    lab_damage = converter.lab_damage
    n_lab_cycles = converter.get_total_lab_events(lab_events)

    print(f"自然冻融事件次数：{n_natural_ftc} 次")
    print(f"自然冻融总损伤指标：{total_natural_damage:.2f}")
    print(f"实验室标准冻融损伤：{lab_damage:.2f}")
    print(f"等效冻融损伤指标：{n_lab_cycles} 次实验室循环")
    print(f"等效转换比：{total_natural_damage / lab_damage:.2f} (= {total_natural_damage:.2f} / {lab_damage:.2f})")

    # ==========================================================================
    # 3. 标准冻融块设置
    # ==========================================================================
    print("\n" + "=" * 60)
    print("3. 标准冻融块设置")
    print("=" * 60)

    print(f"冻结温度：{LAB_FTC_TMIN}°C")
    print(f"融化温度：{LAB_FTC_TMAX}°C")
    print(f"冻结时长：{LAB_FTC_FREEZE_HOURS} 小时")
    print(f"融化时长：{LAB_FTC_THAW_HOURS} 小时")
    print(f"单次循环总时长：{LAB_FTC_FREEZE_HOURS + LAB_FTC_THAW_HOURS} 小时")
    print(f"冻融块设置数量：{n_lab_cycles} 次")

    # ==========================================================================
    # 4. 目标 CSV 文件
    # ==========================================================================
    print("\n" + "=" * 60)
    print("4. 目标 CSV 文件")
    print("=" * 60)

    print(f"数据文件：{csv_path.absolute()}")
    print(f"地区名称：{DATA_FILE.replace('processed_weather_data_', '').replace('.csv', '')}")

    # ==========================================================================
    # 生成输出文件
    # ==========================================================================
    print("\n" + "=" * 60)
    print("生成实验方案文件")
    print("=" * 60)

    generator = SnowFTCPlanGenerator(str(csv_path), target_days=10.0)
    plan = generator.generate()

    # 使用时间戳保存文件
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    region_name = DATA_FILE.replace('processed_weather_data_', '').replace('.csv', '')

    output_json = Path(__file__).parent / "output" / f"snow_ftc_{region_name}_{timestamp}.json"
    output_csv = Path(__file__).parent / "output" / f"snow_ftc_hardware_{region_name}_{timestamp}.csv"

    output_json.parent.mkdir(parents=True, exist_ok=True)

    # 保存 JSON
    plan.save(str(output_json))
    print(f"JSON 方案：{output_json}")

    # 保存 CSV
    formatter = SnowFTCFormatter()
    hardware_steps = formatter.format(plan)
    formatter.to_csv(hardware_steps, str(output_csv))
    print(f"硬件 CSV: {output_csv}")

    print("\n" + "=" * 60)
    print("输出完成")
    print("=" * 60)


if __name__ == "__main__":
    main()
