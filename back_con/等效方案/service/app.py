from __future__ import annotations

import csv
import shutil
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from core import (
    ExperimentPlanFormatter,
    ExperimentPlanGenerator,
    SnowFTCFormatter,
    SnowFTCPlanGenerator,
)


RAIN_SOLAR = "rain_solar"
SNOW_FREEZE_THAW = "snow_freeze_thaw"

EXPERIMENT_TYPE_MAP = {
    "rain_solar": RAIN_SOLAR,
    "rain-solar": RAIN_SOLAR,
    "降雨-日照耦合实验": RAIN_SOLAR,
    "snow_freeze_thaw": SNOW_FREEZE_THAW,
    "snow-freeze-thaw": SNOW_FREEZE_THAW,
    "降雪-冻融耦合实验": SNOW_FREEZE_THAW,
}

CANONICAL_TYPE_TO_CN = {
    RAIN_SOLAR: "降雨-日照耦合实验",
    SNOW_FREEZE_THAW: "降雪-冻融耦合实验",
}


class EquivalenceRequest(BaseModel):
    experiment_type: str | None = Field(default=None, description="实验类型")
    experimentType: str | None = Field(default=None, description="实验类型（前端字段）")
    target_days: float | None = Field(default=None, description="目标实验天数")
    targetDays: float | None = Field(default=None, description="目标实验天数（前端字段）")
    weather_data: list[dict[str, Any]] | None = Field(default=None, description="天气数据数组")
    weatherData: list[dict[str, Any]] | None = Field(default=None, description="天气数据数组（前端字段）")
    csv_path: str | None = Field(default=None, description="CSV 文件路径")
    csvPath: str | None = Field(default=None, description="CSV 文件路径（前端字段）")
    return_hardware_steps: bool = Field(default=True, description="是否返回硬件步骤")
    returnHardwareSteps: bool | None = Field(default=None, description="是否返回硬件步骤（前端字段）")


app = FastAPI(
    title="Equivalence Experiment API",
    version="1.0.0",
    description="降雨-日照耦合实验与降雪-冻融耦合实验的统一服务接口。",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _safe_float(value: Any, default: float = 0.0) -> float:
    if value is None or value == "":
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _first_non_null(row: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in row and row[key] is not None and row[key] != "":
            return row[key]
    return None


def _normalize_time(value: Any, row_index: int) -> str:
    if value is None or value == "":
        raise HTTPException(status_code=400, detail=f"weather_data 第 {row_index + 1} 行缺少时间字段")

    if isinstance(value, datetime):
        return value.strftime("%Y-%m-%dT%H:%M")

    text = str(value).strip()
    if " " in text and "T" not in text:
        text = text.replace(" ", "T")
    if len(text) == 10:
        text = f"{text}T00:00"

    try:
        dt = datetime.fromisoformat(text)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"weather_data 第 {row_index + 1} 行时间格式无效: {value}",
        ) from exc

    return dt.strftime("%Y-%m-%dT%H:%M")


def _normalize_weather_row(row: dict[str, Any], row_index: int) -> dict[str, Any]:
    time_value = _first_non_null(row, ["time", "year_month_day", "yearMonthDay", "date", "datetime"])
    max_temp = _safe_float(_first_non_null(row, ["max_temperature", "temperature_max"]))
    min_temp = _safe_float(_first_non_null(row, ["min_temperature", "temperature_min"]))

    temperature = _safe_float(
        _first_non_null(row, ["temperature_2m", "avg_temperature", "temperature_avg"]),
        default=(max_temp + min_temp) / 2 if max_temp or min_temp else 0.0,
    )

    return {
        "time": _normalize_time(time_value, row_index),
        "temperature_2m": temperature,
        "relativehumidity_2m": _safe_float(
            _first_non_null(row, ["relativehumidity_2m", "relative_humidity", "humidity"]),
            default=50.0,
        ),
        "rain": _safe_float(_first_non_null(row, ["rain", "rain_sum", "precipitation"]), default=0.0),
        "snowfall": _safe_float(_first_non_null(row, ["snowfall", "snow_sum"]), default=0.0),
        "shortwave_radiation": _safe_float(
            _first_non_null(row, ["shortwave_radiation", "shortwave_radiation_sum"]),
            default=0.0,
        ),
        "windspeed_10m": _safe_float(
            _first_non_null(row, ["windspeed_10m", "max_continuous_wind_speed", "wind_speed"]),
            default=0.0,
        ),
    }


def _write_temp_csv(weather_data: list[dict[str, Any]]) -> tuple[str, str]:
    if not weather_data:
        raise HTTPException(status_code=400, detail="weather_data 不能为空")

    normalized_rows = [_normalize_weather_row(row, idx) for idx, row in enumerate(weather_data)]
    normalized_rows.sort(key=lambda item: item["time"])

    temp_dir = tempfile.mkdtemp(prefix="equivalence_")
    csv_path = Path(temp_dir) / "input_weather.csv"
    fieldnames = [
        "time",
        "temperature_2m",
        "relativehumidity_2m",
        "rain",
        "snowfall",
        "shortwave_radiation",
        "windspeed_10m",
    ]

    with open(csv_path, "w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(normalized_rows)

    return str(csv_path), temp_dir


def _resolve_experiment_type(payload: EquivalenceRequest) -> str:
    raw_type = (payload.experiment_type or payload.experimentType or "降雨-日照耦合实验").strip()
    normalized = EXPERIMENT_TYPE_MAP.get(raw_type)
    if not normalized:
        raise HTTPException(
            status_code=400,
            detail="experiment_type 无效，可选值：降雨-日照耦合实验 / 降雪-冻融耦合实验",
        )
    return normalized


def _resolve_target_days(payload: EquivalenceRequest) -> float:
    target_days = payload.target_days if payload.target_days is not None else payload.targetDays
    if target_days is None:
        return 10.0
    if target_days <= 0:
        raise HTTPException(status_code=400, detail="target_days 必须大于 0")
    return float(target_days)


def _resolve_return_hardware_steps(payload: EquivalenceRequest) -> bool:
    if payload.returnHardwareSteps is not None:
        return bool(payload.returnHardwareSteps)
    return bool(payload.return_hardware_steps)


def _resolve_input_csv(payload: EquivalenceRequest) -> tuple[str, str | None, str]:
    weather_data = payload.weather_data if payload.weather_data is not None else payload.weatherData
    csv_path = payload.csv_path if payload.csv_path is not None else payload.csvPath

    if weather_data:
        temp_csv, temp_dir = _write_temp_csv(weather_data)
        return temp_csv, temp_dir, "weather_data"

    if csv_path:
        path_obj = Path(csv_path)
        if not path_obj.exists():
            raise HTTPException(status_code=400, detail=f"csv_path 不存在: {csv_path}")
        return str(path_obj), None, "csv_path"

    raise HTTPException(status_code=400, detail="请提供 weather_data 或 csv_path")


def _run_rain_solar(csv_path: str, target_days: float, return_hardware_steps: bool) -> dict[str, Any]:
    plan = ExperimentPlanGenerator(csv_path, target_days).generate()
    response: dict[str, Any] = {"plan": plan.to_dict()}

    if return_hardware_steps:
        formatter = ExperimentPlanFormatter()
        hardware_steps = formatter.format(plan)
        response["hardware_steps"] = [step.to_row() for step in hardware_steps]

    return response


def _run_snow_freeze_thaw(csv_path: str, target_days: float, return_hardware_steps: bool) -> dict[str, Any]:
    plan = SnowFTCPlanGenerator(csv_path, target_days).generate()
    response: dict[str, Any] = {"plan": plan.to_dict()}

    if return_hardware_steps:
        formatter = SnowFTCFormatter()
        response["hardware_steps"] = formatter.format(plan)

    return response


@app.get("/health")
def health_check() -> dict[str, Any]:
    return {"status": "ok", "service": "equivalence-api", "timestamp": datetime.utcnow().isoformat() + "Z"}


@app.post("/api/v1/equivalence/run")
def run_equivalence(payload: EquivalenceRequest) -> dict[str, Any]:
    experiment_type = _resolve_experiment_type(payload)
    target_days = _resolve_target_days(payload)
    return_hardware_steps = _resolve_return_hardware_steps(payload)
    csv_path, temp_dir, input_source = _resolve_input_csv(payload)

    try:
        if experiment_type == RAIN_SOLAR:
            result = _run_rain_solar(csv_path, target_days, return_hardware_steps)
        else:
            result = _run_snow_freeze_thaw(csv_path, target_days, return_hardware_steps)
    finally:
        if temp_dir:
            shutil.rmtree(temp_dir, ignore_errors=True)

    return {
        "code": 0,
        "msg": "ok",
        "experiment_type": experiment_type,
        "experiment_type_label": CANONICAL_TYPE_TO_CN[experiment_type],
        "target_days": target_days,
        "input_source": input_source,
        "result": result,
    }

