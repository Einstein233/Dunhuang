#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
气候应力等效实验方案自动生成系统 (CSEE-Gen) - 主程序入口

使用方式:
    python main.py [--days DAYS] [--input INPUT] [--output OUTPUT]

示例:
    # 使用默认配置运行
    python main.py

    # 指定实验天数和输入输出文件
    python main.py --days 20 --input data/data.csv --output plan.json
"""

import sys
import argparse
from datetime import datetime
from pathlib import Path

from core import (
    ExperimentConfig,
    DEFAULT_CONFIG,
    ExperimentPlanGenerator,
    ExperimentPlanFormatter,
    generate_hardware_csv
)


def print_header():
    """打印程序头部信息"""
    print("=" * 60)
    print("CSEE-Gen v2.0.0 (Climate Stress Equivalence Experiment Generator)")
    print("=" * 60)
    print()


def print_stage(stage_num: int, stage_name: str):
    """打印阶段标题"""
    print(f"\n{'='*10} 阶段 {stage_num}: {stage_name} {'='*10}")


def print_config_summary(config: ExperimentConfig):
    """打印配置摘要"""
    print("配置参数:")
    print(f"  无雨阈值：{config.no_rain_threshold_hours}h")
    print(f"  日照时长：{config.solar_duration_hours}h")
    print(f"  干燥时长：{config.dry_duration_hours}h")
    print(f"  脉冲降雨阈值：{config.pulse_rain_max_duration_min}min")
    print(f"  降雨强度档位：{config.rain_intensity_gears}")
    print(f"  最大日照强度：{config.max_solar_intensity} W/m2")
    print()


def run_demo():
    """运行演示"""
    print_header()

    # 配置参数
    csv_path = "data/processed_weather_data_tianjin.csv"
    target_days = 20
    config = DEFAULT_CONFIG

    print(f"输入文件：{csv_path}")
    print(f"目标实验天数：{target_days} 天")
    print(f"目标总时长：{target_days * 24} 小时")
    print_config_summary(config)

    # 阶段 1: 加载数据
    print_stage(1, "加载天气数据")
    generator = ExperimentPlanGenerator(csv_path, target_days, config)
    generator._load_data()

    print(f"数据记录数：{len(generator.weather_data)} 条")
    print(f"时间范围：{generator.weather_data.start_time} 至 {generator.weather_data.end_time}")
    print(f"数据跨度：{(generator.weather_data.end_time - generator.weather_data.start_time).days + 1} 天")
    print(f"气候统计:")
    print(f"  降雨温度中位数：{generator.climate_stats.rain_temp_median:.1f}°C")
    print(f"  白天温度中位数：{generator.climate_stats.daytime_temp_median:.1f}°C")
    print(f"  全时段温度中位数：{generator.climate_stats.overall_temp_median:.1f}°C")
    print(f"  平均风速：{generator.climate_stats.overall_wind_avg:.2f} m/s")

    # 阶段 2: 提取事件
    print_stage(2, "提取降雨事件")
    generator._extract_events()
    stats = generator.event_extractor.get_event_statistics(generator.raw_events)
    print(f"原始降雨事件数：{len(generator.raw_events)} 个")
    print(f"平均降雨量：{stats['avg_rain']:.2f} mm")
    print(f"最大降雨量：{stats['max_rain']:.2f} mm")

    # 阶段 3: 事件合并
    print_stage(3, "事件合并")
    generator._merge_events()
    print(f"合并后事件数：{len(generator.merged_events)} 个")
    print(f"原始事件数：{stats['total_events']} -> 合并后：{len(generator.merged_events)}")

    # 阶段 4: 能量耦合
    print_stage(4, "能量耦合")
    generator._couple_energy()
    print(f"耦合后事件数：{len(generator.coupled_events)} 个")

    # 阶段 5: 生成方案
    print_stage(5, "生成实验方案")
    plan = generator._generate_steps()

    rain_steps = [s for s in plan.sequence if s.mode == 'Rain']
    solar_steps = [s for s in plan.sequence if s.mode == 'Solar']
    dry_steps = [s for s in plan.sequence if s.mode == 'Dry_Baseline']

    print(f"实验方案步骤总数：{len(plan.sequence)} 个")
    print(f"  - Rain steps: {len(rain_steps)}")
    print(f"  - Solar steps: {len(solar_steps)}")
    print(f"  - Dry steps: {len(dry_steps)}")
    print(f"总降雨量：{plan.meta['total_rain_volume']:.2f} mm")
    print(f"实际循环数：{plan.meta['actual_cycles']} 个")

    # 显示实验序列前 6 步
    print("\n实验序列（前 6 步）:")
    for step in plan.sequence[:6]:
        if step.mode == 'Rain':
            print(f"  Step {step.step}: {step.mode} - "
                  f"intensity={step.intensity}mm/h, duration={step.duration_min:.1f}min, "
                  f"temp={step.target_temp:.1f}°C, wind={step.wind_speed:.2f}m/s")
        elif step.mode == 'Solar':
            print(f"  Step {step.step}: {step.mode} - "
                  f"duration={step.duration_hour}h, temp={step.target_temp:.1f}°C, wind={step.wind_speed:.2f}m/s")
        else:
            print(f"  Step {step.step}: {step.mode} - "
                  f"duration={step.duration_hour}h, temp={step.target_temp:.1f}°C, wind={step.wind_speed:.2f}m/s")

    # 保存输出
    print_stage(6, "保存实验方案")
    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # 保存 JSON 格式
    json_path = output_dir / f"experiment_plan_{timestamp}.json"
    plan.save(str(json_path))
    print(f"JSON 方案已保存至：{json_path}")

    plan.save("experiment_plan.json")
    print(f"JSON 方案已保存至：experiment_plan.json")

    # 保存硬件 CSV 格式
    formatter = ExperimentPlanFormatter()
    hardware_steps = formatter.format(plan)
    csv_path = output_dir / f"hardware_plan_{timestamp}.csv"
    formatter.to_csv(hardware_steps, str(csv_path))
    print(f"硬件 CSV 已保存至：{csv_path}")

    formatter.to_csv(hardware_steps, "hardware_plan.csv")
    print(f"硬件 CSV 已保存至：hardware_plan.csv")

    print("\n" + "=" * 60)
    print("实验方案生成完成!")
    print("=" * 60)

    return plan


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description='CSEE-Gen: Climate Stress Equivalence Experiment Generator')
    parser.add_argument('--days', '-d', type=float, default=10.0, help='Target experiment days (default: 10)')
    parser.add_argument('--input', '-i', type=str, default='data/processed_weather_data.csv', help='Input CSV file path')
    parser.add_argument('--output', '-o', type=str, default='experiment_plan.json', help='Output JSON file path')
    parser.add_argument('--demo', action='store_true', help='Run demo mode')

    args = parser.parse_args()

    if args.demo or len(sys.argv) == 1:
        run_demo()
    else:
        print(f"Input file: {args.input}")
        print(f"Target days: {args.days}")
        print(f"Output file: {args.output}")

        generator = ExperimentPlanGenerator(args.input, args.days)
        plan = generator.generate()
        plan.save(args.output)

        print(f"\nExperiment plan saved to: {args.output}")


if __name__ == "__main__":
    main()
