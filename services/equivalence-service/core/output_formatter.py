"""
实验方案输出格式器模块 - 状态驱动版本

将实验方案（ExperimentPlan）转换为目标硬件系统可执行的 CSV 格式。
根据敦煌研究院环境舱工况表格式生成汇总表格。

核心编排逻辑：状态驱动法
- 状态 0：过渡与爬坡态 (Transition) - 温度变化需要时间，3°C/min
- 状态 1：降雨阶段 (Rain/Rain_Pause) - 风雨舱
- 状态 2：日照阶段 (Solar) - 夏季舱
- 状态 3：干燥平衡阶段 (Dry_Baseline) - 夏季舱
"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple
from pathlib import Path
import csv
import random

# 兼容模块导入
try:
    from .experiment_mapper import ExperimentPlan, ExperimentStep
except ImportError:
    from core.experiment_mapper import ExperimentPlan, ExperimentStep


# =============================================================================
# 常量定义
# =============================================================================

# 温度变化速率 (°C/min)
TEMP_CHANGE_RATE = 3.0

# 日照角度变化速率 (°/min)
SOLAR_ANGLE_RATE = 5.0

# 目标 CSV 的列名及顺序
OUTPUT_COLUMNS = [
    '步骤编号',
    '工作状态（ON/OFF）',
    '运行时间（min）',
    '起始温度（℃）',
    '终点温度（℃）',
    '湿度控制标志（ON/OFF）',
    '起始湿度（%）',
    '终点湿度（%）',
    '日照控制标志（ON/OFF）',
    '日照控制方式（开环/闭环）',
    '日照起始角度（°）',
    '日照终点角度（°）',
    '起始日照强度（W/m2）',
    '终点日照强度（W/m2）',
    '降雨控制标志（ON/OFF）',
    '起始降雨量（mm/h）',
    '终点降雨量（mm/h）',
    '风速控制标志（ON/OFF）',
    '起始风速（m/s）',
    '终点风速（m/s）',
    '降雪控制标志（ON/OFF）',
    '起始降雪量（mm/h）',
    '终点降雪量（mm/h）'
]

# 默认值常量
DEFAULT_HUMIDITY = 50.0  # 默认湿度 (%)
DEFAULT_SOLAR_MODE = '开环'  # 默认日照控制方式


# =============================================================================
# 数据类定义
# =============================================================================

@dataclass
class HardwareStep:
    """
    硬件执行步骤数据类

    对应目标 CSV 中的一行数据
    """
    step_number: int
    work_status: str = 'ON'
    duration_min: float = 0.0
    temp_start: float = 20.0
    temp_end: float = 20.0
    humidity_flag: str = 'OFF'
    humidity_start: float = DEFAULT_HUMIDITY
    humidity_end: float = DEFAULT_HUMIDITY
    solar_flag: str = 'OFF'
    solar_mode: str = DEFAULT_SOLAR_MODE
    solar_angle_start: float = 0.0
    solar_angle_end: float = 0.0
    solar_intensity_start: float = 0.0
    solar_intensity_end: float = 0.0
    rain_flag: str = 'OFF'
    rain_start: float = 0.0
    rain_end: float = 0.0
    wind_flag: str = 'OFF'
    wind_start: float = 0.0
    wind_end: float = 0.0
    snow_flag: str = 'OFF'
    snow_start: float = 0.0
    snow_end: float = 0.0

    def to_row(self) -> Dict[str, any]:
        """转换为 CSV 行数据"""
        return {
            '步骤编号': self.step_number,
            '工作状态（ON/OFF）': self.work_status,
            '运行时间（min）': round(self.duration_min, 1),
            '起始温度（℃）': round(self.temp_start, 1),
            '终点温度（℃）': round(self.temp_end, 1),
            '湿度控制标志（ON/OFF）': self.humidity_flag,
            '起始湿度（%）': round(self.humidity_start, 1),
            '终点湿度（%）': round(self.humidity_end, 1),
            '日照控制标志（ON/OFF）': self.solar_flag,
            '日照控制方式（开环/闭环）': self.solar_mode,
            '日照起始角度（°）': round(self.solar_angle_start, 1),
            '日照终点角度（°）': round(self.solar_angle_end, 1),
            '起始日照强度（W/m2）': round(self.solar_intensity_start, 1),
            '终点日照强度（W/m2）': round(self.solar_intensity_end, 1),
            '降雨控制标志（ON/OFF）': self.rain_flag,
            '起始降雨量（mm/h）': round(self.rain_start, 1),
            '终点降雨量（mm/h）': round(self.rain_end, 1),
            '风速控制标志（ON/OFF）': self.wind_flag,
            '起始风速（m/s）': round(self.wind_start, 2),
            '终点风速（m/s）': round(self.wind_end, 2),
            '降雪控制标志（ON/OFF）': self.snow_flag,
            '起始降雪量（mm/h）': round(self.snow_start, 1),
            '终点降雪量（mm/h）': round(self.snow_end, 1)
        }


# =============================================================================
# 输出格式器主类
# =============================================================================

class ExperimentPlanFormatter:
    """
    实验方案格式器 - 状态驱动版本

    将 ExperimentPlan 转换为硬件系统可执行的 CSV 格式
    包含温度过渡状态和日照角度控制
    """

    def __init__(
        self,
        default_humidity: float = DEFAULT_HUMIDITY,
        solar_mode: str = DEFAULT_SOLAR_MODE,
        temp_change_rate: float = TEMP_CHANGE_RATE,
        solar_angle_rate: float = SOLAR_ANGLE_RATE
    ):
        """
        初始化格式器

        Args:
            default_humidity: 默认湿度值
            solar_mode: 日照控制方式
            temp_change_rate: 温度变化速率 (°C/min)
            solar_angle_rate: 日照角度变化速率 (°/min)
        """
        self.default_humidity = default_humidity
        self.solar_mode = solar_mode
        self.temp_change_rate = temp_change_rate
        self.solar_angle_rate = solar_angle_rate

        # 状态跟踪
        self._current_temp: float = 20.0  # 当前温度
        self._solar_angle_offset: float = 0.0  # 日照角度偏移

    def format(self, plan: ExperimentPlan) -> List[HardwareStep]:
        """
        将实验方案转换为硬件执行步骤

        Args:
            plan: ExperimentPlan 实验方案

        Returns:
            HardwareStep 列表
        """
        steps: List[HardwareStep] = []

        # 重置状态
        self._current_temp = 20.0
        self._solar_angle_offset = 0.0

        for exp_step in plan.sequence:
            new_steps = self._process_step(exp_step, len(steps) + 1)
            steps.extend(new_steps)

        return steps

    def _process_step(self, exp_step: ExperimentStep, step_number: int) -> List[HardwareStep]:
        """
        处理单个实验步骤，可能生成多个硬件步骤（包括过渡状态）

        Args:
            exp_step: 实验步骤
            step_number: 起始步骤编号

        Returns:
            HardwareStep 列表
        """
        mode = exp_step.mode
        target_temp = exp_step.target_temp
        result_steps: List[HardwareStep] = []

        # 检查是否需要温度过渡状态
        if abs(target_temp - self._current_temp) > 0.1:
            transition_step = self._create_transition_step(
                step_number,
                self._current_temp,
                target_temp
            )
            result_steps.append(transition_step)
            step_number += 1

        # 创建主状态步骤
        main_step = self._create_main_step(exp_step, step_number, target_temp)
        result_steps.append(main_step)

        # 更新当前温度
        self._current_temp = target_temp

        return result_steps

    def _create_transition_step(
        self,
        step_number: int,
        start_temp: float,
        end_temp: float
    ) -> HardwareStep:
        """
        创建过渡状态步骤（状态 0）

        温度变化速率：3°C/min
        过渡时间 = |目标温度 - 当前温度| ÷ 3.0 （保底 1 分钟）

        Args:
            step_number: 步骤编号
            start_temp: 起始温度
            end_temp: 终点温度

        Returns:
            HardwareStep 过渡步骤
        """
        # 计算过渡时间
        temp_diff = abs(end_temp - start_temp)
        duration_min = max(1.0, temp_diff / self.temp_change_rate)
        duration_min = round(duration_min, 1)

        return HardwareStep(
            step_number=step_number,
            work_status='ON',
            duration_min=duration_min,
            temp_start=round(start_temp, 1),
            temp_end=round(end_temp, 1),
            humidity_flag='OFF',
            humidity_start=self.default_humidity,
            humidity_end=self.default_humidity,
            solar_flag='OFF',
            solar_mode=self.solar_mode,
            solar_angle_start=0.0,
            solar_angle_end=0.0,
            solar_intensity_start=0.0,
            solar_intensity_end=0.0,
            rain_flag='OFF',
            rain_start=0.0,
            rain_end=0.0,
            wind_flag='OFF',
            wind_start=0.0,
            wind_end=0.0,
            snow_flag='OFF',
            snow_start=0.0,
            snow_end=0.0
        )

    def _create_main_step(
        self,
        exp_step: ExperimentStep,
        step_number: int,
        target_temp: float
    ) -> HardwareStep:
        """
        创建主状态步骤（状态 1/2/3）

        Args:
            exp_step: 实验步骤
            step_number: 步骤编号
            target_temp: 目标温度

        Returns:
            HardwareStep 主状态步骤
        """
        mode = exp_step.mode

        # 基础步骤
        step = HardwareStep(
            step_number=step_number,
            work_status='ON',
            duration_min=exp_step.duration_min,
            temp_start=round(target_temp, 1),
            temp_end=round(target_temp, 1),
            humidity_flag='OFF',
            humidity_start=self.default_humidity,
            humidity_end=self.default_humidity,
            solar_flag='OFF',
            solar_mode=self.solar_mode,
            solar_angle_start=0.0,
            solar_angle_end=0.0,
            solar_intensity_start=0.0,
            solar_intensity_end=0.0,
            rain_flag='OFF',
            rain_start=0.0,
            rain_end=0.0,
            wind_flag='OFF',
            wind_start=0.0,
            wind_end=0.0,
            snow_flag='OFF',
            snow_start=0.0,
            snow_end=0.0
        )

        # 根据模式设置控制标志
        if mode == 'Rain':
            # 状态 1: 降雨阶段 - 风雨舱
            step.rain_flag = 'ON'
            step.rain_start = exp_step.intensity or 0.0
            step.rain_end = exp_step.intensity or 0.0
            step.wind_flag = 'ON'
            step.wind_start = exp_step.wind_speed or 0.0
            step.wind_end = exp_step.wind_speed or 0.0

        elif mode == 'Rain_Pause':
            # 状态 1: 脉冲入渗阶段 - 风雨舱
            step.rain_flag = 'OFF'
            step.wind_flag = 'ON'
            step.wind_start = exp_step.wind_speed or 0.0
            step.wind_end = exp_step.wind_speed or 0.0

        elif mode == 'Solar':
            # 状态 2: 日照阶段 - 夏季舱
            step.solar_flag = 'ON'
            step.solar_intensity_start = exp_step.intensity or 0.0
            step.solar_intensity_end = exp_step.intensity or 0.0
            # 计算日照角度（按 5°/min）
            step.solar_angle_start, step.solar_angle_end = self._calculate_solar_angles(
                exp_step.duration_min
            )

        elif mode == 'Dry_Baseline':
            # 状态 3: 干燥平衡阶段 - 夏季舱
            # 所有控制关闭
            pass

        return step

    def _calculate_solar_angles(self, duration_min: float) -> Tuple[float, float]:
        """
        计算日照起始角度和终点角度

        规则：
        - 随机生成起始角度（0° 到 45° 之间）
        - 最大可偏转角度 = 运行时间 × 5°
        - 终点角度 = Min(90°, 起始角度 + 最大可偏转角度)

        Args:
            duration_min: 运行时间（分钟）

        Returns:
            (起始角度，终点角度) 元组
        """
        # 随机生成起始角度（0° 到 45°）
        angle_start = random.uniform(0, 45)

        # 计算最大可偏转角度
        max_sweep = duration_min * self.solar_angle_rate

        # 计算终点角度
        angle_end = min(90.0, angle_start + max_sweep)

        return (round(angle_start, 1), round(angle_end, 1))

    def to_csv(
        self,
        steps: List[HardwareStep],
        output_path: str,
        encoding: str = 'utf-8-sig'
    ) -> None:
        """
        将硬件步骤保存为 CSV 文件

        Args:
            steps: HardwareStep 列表
            output_path: 输出文件路径
            encoding: 文件编码
        """
        if not steps:
            return

        output_file = Path(output_path)
        output_file.parent.mkdir(parents=True, exist_ok=True)

        with open(output_file, 'w', newline='', encoding=encoding) as f:
            writer = csv.DictWriter(f, fieldnames=OUTPUT_COLUMNS)
            writer.writeheader()
            for step in steps:
                writer.writerow(step.to_row())

    def format_to_dict(self, steps: List[HardwareStep]) -> List[Dict]:
        """将硬件步骤转换为字典列表"""
        return [step.to_row() for step in steps]

    def reset_state(self, initial_temp: float = 20.0):
        """
        重置状态跟踪器

        Args:
            initial_temp: 初始温度
        """
        self._current_temp = initial_temp
        self._solar_angle_offset = 0.0


# =============================================================================
# 便捷函数
# =============================================================================

def generate_hardware_csv(
    plan: ExperimentPlan,
    output_path: str,
    formatter: Optional[ExperimentPlanFormatter] = None
) -> List[HardwareStep]:
    """便捷函数：生成硬件可执行的 CSV 文件"""
    if formatter is None:
        formatter = ExperimentPlanFormatter()

    steps = formatter.format(plan)
    formatter.to_csv(steps, output_path)
    return steps


def convert_plan_to_hardware_steps(
    plan: ExperimentPlan,
    formatter: Optional[ExperimentPlanFormatter] = None
) -> List[HardwareStep]:
    """便捷函数：将实验方案转换为硬件步骤"""
    if formatter is None:
        formatter = ExperimentPlanFormatter()
    return formatter.format(plan)
