import sys
import json
import pandas as pd

def main():
    # 从stdin读取json数据
    input_data = sys.stdin.read()
    data = json.loads(input_data)
    if not data:
        print(json.dumps({"error": "输入数据为空"}))
        return

    # 字段映射（根据你实际字段名，适当调整）
    # 假设数据库传进来的字段如下（请对照实际传入字段）
    # 'year_month_day', 'temperature_2m_max', 'temperature_2m_min', 'temperature_2m_mean',
    # 'precipitation_sum', 'rain_sum', 'snowfall_sum', 'windspeed_10m_max', 'windgusts_10m_max',
    # 'winddirection_10m_dominant', 'shortwave_radiation_sum'

    df = pd.DataFrame(data)
    # 字段类型转换
    df['time'] = pd.to_datetime(df.get('year_month_day', df.get('time')))
    for col in [
        'max_temperature', 'min_temperature', 'avg_temperature',
        'precipitation', 'rain_sum', 'snow_sum',
        'max_continuous_wind_speed', 'windgusts_max',
        'winddirection_dominant', 'shortwave_radiation_sum'
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce')

    selected_df = df  # 全部数据，不再手动筛选

    mean_temp = selected_df['avg_temperature']
    season_flags = {'风雨舱': False, '夏季舱': False, '冬季舱': False}

    # 各个字段统计
    avg_temp = float(mean_temp.mean())
    total_rainfall = float(selected_df['rain_sum'].sum())
    rainy_days = int((selected_df['rain_sum'] > 0).sum())
    total_snowfall = float(selected_df['snow_sum'].sum())
    snowy_days = int((selected_df['snow_sum'] > 0).sum())
    avg_wind_speed = float(selected_df['max_continuous_wind_speed'].mean())
    avg_radiation = float(selected_df['shortwave_radiation_sum'].mean())
    dim_radiation_days = int((selected_df['shortwave_radiation_sum'] < 20).sum())
    bright_radiation_days = int((selected_df['shortwave_radiation_sum'] >= 20).sum())
    dim_radiation_mean = float(selected_df[selected_df['shortwave_radiation_sum'] < 20]['shortwave_radiation_sum'].mean() or 0)
    bright_radiation_mean = float(selected_df[selected_df['shortwave_radiation_sum'] >= 20]['shortwave_radiation_sum'].mean() or 0)

    # 冬季舱逻辑
    mean_low = mean_temp <= 10
    low_temp_days = int(mean_low.sum())
    consecutive = 0
    max_consecutive = 0
    for is_low in mean_low:
        if is_low:
            consecutive += 1
            max_consecutive = max(max_consecutive, consecutive)
        else:
            consecutive = 0
    if (low_temp_days >= len(mean_temp) // 4 and (max_consecutive >= low_temp_days // 2 or max_consecutive >= 28)) or \
       total_snowfall >= 2 or snowy_days >= 7 or (len(mean_temp) < 280 and (low_temp_days >= 14 or low_temp_days >= len(mean_temp) // 8)):
        season_flags['冬季舱'] = True

    # 夏季舱逻辑
    mean_high = mean_temp > 25
    high_temp_days = int(mean_high.sum())
    consecutive = 0
    max_consecutive = 0
    for is_high in mean_high:
        if is_high:
            consecutive += 1
            max_consecutive = max(max_consecutive, consecutive)
        else:
            consecutive = 0
    if (high_temp_days >= (len(mean_temp) // 4) and (max_consecutive >= high_temp_days // 2 or max_consecutive >= 28)) or \
       (len(mean_temp) < 280 and (high_temp_days >= 14 or high_temp_days >= len(mean_temp) // 8)):
        season_flags['夏季舱'] = True

    # 风雨舱逻辑
    mid_temp = (mean_temp > 10) & (mean_temp <= 25)
    mid_temp_days = int(mid_temp.sum())
    season_flags['风雨舱'] = True

    # 各天气对应劣化值
    Temp_v = [2, 1.5, 1.1, 0.8, 0.5, 0.2, 0.1, 0.1, 0.5, 1, 2]
    Radio_v = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]
    Wind_v = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
    Rain_v = [0, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2]
    Snow_v = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
    Summer_v = 0
    Winter_v = 0
    RW_v = 0

    winter_detail = {}
    summer_detail = {}
    windrain_detail = {}

    if season_flags['冬季舱']:
        low_temp_values = selected_df[mean_low]['avg_temperature']
        temp_mean = float(low_temp_values.mean() or 0)
        temp_lvl = int((temp_mean + 50) // 10 if not pd.isna(temp_mean) else 0)
        snow_lvl = int((total_snowfall + snowy_days - 1) // snowy_days if snowy_days else 0)
        radio_lvl = int(dim_radiation_mean // 3 if not pd.isna(dim_radiation_mean) else 0)
        temp_time = int((low_temp_days + 9) // 10)
        snow_time = int((total_snowfall + (snow_lvl * 2) - 1)// (snow_lvl * 2)) if snow_lvl else 0
        radio_time = int((dim_radiation_days + 9) // 10 if dim_radiation_days > 0 else 0)
        Winter_v = Temp_v[min(temp_lvl,10)] * temp_time + Snow_v[min(snow_lvl,10)] * snow_time + Radio_v[min(radio_lvl,10)] * radio_time
        winter_detail = {
            "温度等级": temp_lvl,
            "温度时长": temp_time,
            "降雪等级": snow_lvl,
            "降雪时长": snow_time,
            "日照等级": radio_lvl,
            "日照时长": radio_time,
            "劣化预测值": Winter_v
        }

    if season_flags['夏季舱']:
        high_temp_values = selected_df[mean_high]['avg_temperature']
        temp_mean = float(high_temp_values.mean() or 0)
        temp_lvl = int((temp_mean + 59) // 10 if not pd.isna(temp_mean) else 0)
        radio_lvl = int((bright_radiation_mean + 2) // 3 if not pd.isna(bright_radiation_mean) else 0)
        temp_time = int((high_temp_days + 9) // 10)
        radio_time = int((bright_radiation_days + 9) // 10 if bright_radiation_days > 0 else 0)
        Summer_v = Temp_v[min(temp_lvl,10)] * temp_time + Radio_v[min(radio_lvl,10)] * radio_time
        summer_detail = {
            "温度等级": temp_lvl,
            "温度时长": temp_time,
            "日照等级": radio_lvl,
            "日照时长": radio_time,
            "劣化预测值": Summer_v
        }

    if season_flags['风雨舱']:
        mild_temp_values = selected_df[mid_temp]['avg_temperature']
        temp_mean = float(mild_temp_values.mean() or 0)
        temp_lvl = int((temp_mean + 59) // 10 if not pd.isna(temp_mean) else 0)
        rain_lvl = int((total_rainfall + rainy_days - 1) // rainy_days if rainy_days else 0)
        wind_lvl = int(avg_wind_speed + 2 if avg_wind_speed > 0 else 0)
        temp_time = int((mid_temp_days + 9) // 10)
        rain_time = int((total_rainfall + (rain_lvl * 20) - 1)// (rain_lvl * 20)) if rain_lvl else 0
        wind_time = int(len(selected_df) // 10 if avg_wind_speed > 0 else 0)
        RW_v = Temp_v[min(temp_lvl,10)] * temp_time + Rain_v[min(rain_lvl,10)] * rain_time + Wind_v[min(wind_lvl,10)] * wind_time
        windrain_detail = {
            "温度等级": temp_lvl,
            "温度时长": temp_time,
            "降雨等级": rain_lvl,
            "降雨时长": rain_time,
            "风速等级": wind_lvl,
            "刮风时长": wind_time,
            "劣化预测值": RW_v
        }

    # 汇总所有结果
    result = {
        "avg_temp": avg_temp,
        "total_rainfall": total_rainfall,
        "rainy_days": rainy_days,
        "total_snowfall": total_snowfall,
        "snowy_days": snowy_days,
        "avg_wind_speed": avg_wind_speed,
        "avg_radiation": avg_radiation,
        "dim_radiation_days": dim_radiation_days,
        "bright_radiation_days": bright_radiation_days,
        "season_flags": season_flags,
        "winter_detail": winter_detail,
        "summer_detail": summer_detail,
        "windrain_detail": windrain_detail,
        "总劣化预测值": round(Winter_v + Summer_v + RW_v, 1)
    }

    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
