"""
天气数据模块 - 从 CSV 文件加载时间序列天气数据

提供根据时间生成数据类，支持按时间点、时间范围获取数据
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from pathlib import Path
import csv


@dataclass
class WeatherRecord:
    """单条天气数据记录"""
    time: datetime
    temperature_2m: float  # 2 米气温 (°C)
    relativehumidity_2m: float  # 2 米相对湿度 (%)
    rain: float  # 降雨量 (mm)
    snowfall: float  # 降雪量 (mm)
    shortwave_radiation: float  # 短波辐射 (W/m²)
    windspeed_10m: float  # 10 米风速 (m/s)

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            'time': self.time.isoformat(),
            'temperature_2m': self.temperature_2m,
            'relativehumidity_2m': self.relativehumidity_2m,
            'rain': self.rain,
            'snowfall': self.snowfall,
            'shortwave_radiation': self.shortwave_radiation,
            'windspeed_10m': self.windspeed_10m
        }


@dataclass
class WeatherData:
    """
    天气数据类 - 包含一段时间内的天气数据

    提供按时间点、时间范围查询数据的接口
    """
    records: List[WeatherRecord] = field(default_factory=list)
    time_index: Dict[datetime, WeatherRecord] = field(default_factory=dict)
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None

    def __post_init__(self):
        """初始化后构建索引"""
        self._build_index()

    def _build_index(self):
        """构建时间索引"""
        if self.records:
            self.time_index = {r.time: r for r in self.records}
            self.start_time = min(r.time for r in self.records)
            self.end_time = max(r.time for r in self.records)

    def get_by_time(self, time: datetime) -> Optional[WeatherRecord]:
        """
        根据精确时间点获取数据

        Args:
            time: 时间点

        Returns:
            WeatherRecord 或 None
        """
        return self.time_index.get(time)

    def get_by_time_range(
        self,
        start: datetime,
        end: Optional[datetime] = None
    ) -> List[WeatherRecord]:
        """
        根据时间范围获取数据

        Args:
            start: 起始时间
            end: 结束时间，如果不传则返回从 start 到末尾的所有数据

        Returns:
            WeatherRecord 列表
        """
        if end is None:
            end = self.end_time

        return [
            r for r in self.records
            if start <= r.time <= end
        ]

    def get_nearest(self, time: datetime) -> Optional[WeatherRecord]:
        """
        获取最接近指定时间的数据

        Args:
            time: 时间点

        Returns:
            最接近的 WeatherRecord 或 None
        """
        if not self.records:
            return None

        return min(
            self.records,
            key=lambda r: abs((r.time - time).total_seconds())
        )

    def get_interpolated(self, time: datetime) -> Optional[Dict[str, float]]:
        """
        获取线性插值后的数据

        Args:
            time: 时间点

        Returns:
            插值后的数据字典或 None
        """
        if not self.records:
            return None

        # 找到前后两条记录
        before = None
        after = None

        for r in self.records:
            if r.time <= time:
                before = r
            elif r.time > time and after is None:
                after = r
                break

        # 边界情况
        if before is None and after:
            return {k: v for k, v in after.to_dict().items() if k != 'time'}
        if after is None and before:
            return {k: v for k, v in before.to_dict().items() if k != 'time'}
        if before is None and after is None:
            return None

        # 完全匹配
        if before.time == time:
            return {k: v for k, v in before.to_dict().items() if k != 'time'}

        # 线性插值
        total_seconds = (after.time - before.time).total_seconds()
        elapsed_seconds = (time - before.time).total_seconds()
        ratio = elapsed_seconds / total_seconds

        numeric_fields = [
            'temperature_2m', 'relativehumidity_2m', 'rain',
            'snowfall', 'shortwave_radiation', 'windspeed_10m'
        ]

        result = {}
        for f in numeric_fields:
            before_val = getattr(before, f)
            after_val = getattr(after, f)
            result[f] = before_val + (after_val - before_val) * ratio

        return result

    def get_all(self) -> List[WeatherRecord]:
        """获取所有数据"""
        return self.records

    def __len__(self) -> int:
        return len(self.records)

    def __iter__(self):
        return iter(self.records)

    def __repr__(self):
        return (
            f"WeatherData(records={len(self.records)}, "
            f"from {self.start_time} to {self.end_time})"
        )


class WeatherDataLoader:
    """
    天气数据加载器 - 从 CSV 文件加载数据
    """

    def __init__(self, csv_path: str):
        """
        初始化加载器

        Args:
            csv_path: CSV 文件路径
        """
        self.csv_path = Path(csv_path)
        if not self.csv_path.exists():
            raise FileNotFoundError(f"CSV 文件不存在：{csv_path}")

    def load(
        self,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None
    ) -> WeatherData:
        """
        从 CSV 文件加载天气数据

        Args:
            start_time: 可选的起始时间过滤
            end_time: 可选的结束时间过滤

        Returns:
            WeatherData 对象
        """
        records = []

        with open(self.csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                # 解析时间
                time = datetime.fromisoformat(row['time'])

                # 时间范围过滤
                if start_time and time < start_time:
                    continue
                if end_time and time > end_time:
                    continue

                # 创建记录
                record = WeatherRecord(
                    time=time,
                    temperature_2m=float(row['temperature_2m']),
                    relativehumidity_2m=float(row['relativehumidity_2m']),
                    rain=float(row['rain']),
                    snowfall=float(row['snowfall']),
                    shortwave_radiation=float(row['shortwave_radiation']),
                    windspeed_10m=float(row['windspeed_10m'])
                )
                records.append(record)

        return WeatherData(records=records)

    def load_by_hours(self, hours: int) -> WeatherData:
        """
        加载最近 N 小时的数据（基于文件中最后一条记录的时间）

        Args:
            hours: 小时数

        Returns:
            WeatherData 对象
        """
        # 先获取最后一条记录的时间
        last_time = None
        with open(self.csv_path, 'r', encoding='utf-8') as f:
            reader = csv.DictReader(f)
            for row in reader:
                last_time = datetime.fromisoformat(row['time'])

        if last_time is None:
            return WeatherData()

        start_time = last_time - timedelta(hours=hours)
        return self.load(start_time=start_time)

    def load_by_date(self, date: datetime) -> WeatherData:
        """
        加载指定日期的数据

        Args:
            date: 日期（只看年月日部分）

        Returns:
            WeatherData 对象
        """
        start = datetime(date.year, date.month, date.day, 0, 0, 0)
        end = datetime(date.year, date.month, date.day, 23, 59, 59)
        return self.load(start_time=start, end_time=end)

    def load_by_date_range(
        self,
        start_date: datetime,
        end_date: datetime
    ) -> WeatherData:
        """
        加载指定日期范围内的数据

        Args:
            start_date: 起始日期
            end_date: 结束日期

        Returns:
            WeatherData 对象
        """
        start = datetime(start_date.year, start_date.month, start_date.day, 0, 0, 0)
        end = datetime(end_date.year, end_date.month, end_date.day, 23, 59, 59)
        return self.load(start_time=start, end_time=end)


# 便捷函数
def load_weather_data(csv_path: str) -> WeatherData:
    """
    便捷函数 - 加载所有天气数据

    Args:
        csv_path: CSV 文件路径

    Returns:
        WeatherData 对象
    """
    loader = WeatherDataLoader(csv_path)
    return loader.load()


def load_weather_data_by_time(
    csv_path: str,
    start: datetime,
    end: Optional[datetime] = None
) -> WeatherData:
    """
    便捷函数 - 按时间范围加载天气数据

    Args:
        csv_path: CSV 文件路径
        start: 起始时间
        end: 结束时间

    Returns:
        WeatherData 对象
    """
    loader = WeatherDataLoader(csv_path)
    return loader.load(start_time=start, end_time=end)


# 使用示例
if __name__ == "__main__":
    # 示例用法
    csv_file = "data/processed_weather_data.csv"

    # 1. 加载所有数据
    loader = WeatherDataLoader(csv_file)
    data = loader.load()
    print(f"加载了 {len(data)} 条记录")
    print(f"时间范围：{data.start_time} 到 {data.end_time}")

    # 2. 按精确时间查询
    query_time = datetime(2024, 1, 1, 12, 0, 0)
    record = data.get_by_time(query_time)
    if record:
        print(f"\n{query_time} 的数据：{record}")

    # 3. 按时间范围查询
    start = datetime(2024, 1, 1, 10, 0, 0)
    end = datetime(2024, 1, 1, 14, 0, 0)
    records = data.get_by_time_range(start, end)
    print(f"\n{start} 到 {end} 共 {len(records)} 条记录")

    # 4. 获取最接近的数据
    query_time = datetime(2024, 1, 1, 12, 30, 0)
    nearest = data.get_nearest(query_time)
    print(f"\n最接近 {query_time} 的数据：{nearest.time}")

    # 5. 获取插值数据
    interpolated = data.get_interpolated(query_time)
    print(f"{query_time} 的插值数据：{interpolated}")

    # 6. 按日期加载
    data_jan1 = loader.load_by_date(datetime(2024, 1, 1))
    print(f"\n2024-01-01 共 {len(data_jan1)} 条记录")
