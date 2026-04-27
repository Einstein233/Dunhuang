"""
气候应力等效实验方案自动生成系统 (CSEE-Gen)

将长周期的自然气候数据映射为实验室可执行的等效实验方案。

使用示例:
    from experiment_mapper import ExperimentPlanGenerator, ExperimentPlanFormatter

    # 1. 生成实验方案
    generator = ExperimentPlanGenerator("data/data.csv", target_days=10)
    plan = generator.generate()

    # 2. 转换为硬件可执行的 CSV
    formatter = ExperimentPlanFormatter()
    formatter.to_csv(formatter.format(plan), "output.csv")
"""

from core import (
    ExperimentConfig,
    DEFAULT_CONFIG,
    ExperimentPlanGenerator,
    ExperimentPlan,
    ExperimentPlanFormatter,
    HardwareStep,
    generate_hardware_csv,
    generate_experiment_plan
)

__version__ = '2.0.0'
__all__ = [
    'ExperimentConfig',
    'DEFAULT_CONFIG',
    'ExperimentPlanGenerator',
    'ExperimentPlan',
    'ExperimentPlanFormatter',
    'HardwareStep',
    'generate_hardware_csv',
    'generate_experiment_plan'
]
