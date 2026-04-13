import requests
import schedule
import time
import json
import random
import os
import pandas as pd
from datetime import datetime, timedelta

API_ADD_FILE     = "http://localhost:3000/components/addFile"
API_ADD_FILEDATA = "http://localhost:3000/components/addFiledata"
headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

# --- 配置区域 ---
BASE_URL = "https://meteo.agrodigits.com/v1/archive" 
API_KEY = "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzY1MzUxNDc4LCJpYXQiOjE3NjUyNjUwNzgsImp0aSI6IjkxMDM3YWFlZjRhZDQ0NzU4YjIxYzNhMjI3OTEzYzllIiwidXNlcl9pZCI6NTU5fQ.Wn8YJSrnaB6GJqZMKDKge4j9ksuWOSaJPjK__IDsW7U"

# --- 定义中国各省/直辖市的经纬度列表 ---
PROVINCES = [
    {"name": "heilongjiang", "lat": 45.740297, "lon": 126.656192},  # 温带季风片区
    # {"name": "jilin", "lat": 43.817242, "lon": 126.496753},
    # {"name": "liaoning", "lat": 41.83321, "lon": 123.423099},
    # {"name": "beijing", "lat": 39.903839, "lon": 116.718425},
    # {"name": "tianjin", "lat": 39.292945, "lon": 117.336037},
    # {"name": "hebei", "lat": 38.034693, "lon": 114.46204}, 
    # {"name": "shandong", "lat": 36.671005, "lon": 117.014033},   
    # {"name": "shan1xi", "lat": 37.813477, "lon": 112.572693},
    # {"name": "henan", "lat": 34.748374, "lon": 113.619301},
    # {"name": "shan3xi", "lat": 33.947328, "lon": 108.891755}, 
    # # {"name": "xinjiang", "lat": 43.791827, "lon": 87.624653},     # 温带大陆性片区
    # {"name": "gansu", "lat": 36.05965, "lon": 103.823966}, 
    # {"name": "ningxia", "lat": 38.47079, "lon": 106.254299}, 
    # {"name": "neimeng", "lat": 40.815926, "lon": 111.758835}, 
    # {"name": "qinghai", "lat": 36.620943, "lon": 101.778152},  # 高原山地片区
    # {"name": "xizang", "lat": 29.651787, "lon": 91.115889}, 
    # {"name": "jiangsu", "lat": 32.062936, "lon": 118.757773},  # 亚热带季风片区
    # {"name": "anhui", "lat": 31.736056, "lon": 117.324458}, 
    # {"name": "zhejiang", "lat": 31.736056, "lon": 120.148095}, 
    # {"name": "fujian", "lat": 26.10377, "lon": 119.290381}, 
    # {"name": "taiwan", "lat": 25.037522, "lon": 121.563787}, 
    # {"name": "hunan", "lat": 28.117675, "lon": 112.977773}, 
    # {"name": "hubei", "lat": 30.54887, "lon": 114.33626}, 
    # {"name": "chongqing", "lat": 29.566288, "lon": 106.546855}, 
    # {"name": "jiangxi", "lat": 28.641052, "lon": 115.808091}, 
    # {"name": "guizhou", "lat": 26.601738, "lon": 106.703419}, 
    # {"name": "sichuan", "lat": 30.653901, "lon": 104.073623}, 
    # {"name": "shanghai", "lat": 31.232322, "lon": 121.469091}, 
    # {"name": "yunnan", "lat": 25.0482, "lon": 102.70827},   # 热带季风片区
    # {"name": "guangxi", "lat": 22.817966, "lon": 108.323542}, 
    # {"name": "guangdong", "lat": 23.135768, "lon": 113.26107}, 
    # {"name": "aomen", "lat": 22.189786, "lon": 113.538095}, 
    # {"name": "xianggang", "lat": 22.280685, "lon": 114.1544}, 
    # {"name": "hainan", "lat": 20.01994, "lon": 110.344387}    # 热带雨林片区
]

COLUMN_MAPPING = {
    "time": "year_month_day",              
    "weathercode (wmo code)": "station_code",          
    "temperature_2m_max (°C)": "max_temperature",
    "temperature_2m_min (°C)": "min_temperature",
    "temperature_2m_mean (°C)": "avg_temperature",
    "precipitation_sum (mm)": "precipitation",
    "rain_sum (mm)": "rain_sum",
    "snowfall_sum (cm)": "snow_sum",
    "windspeed_10m_max (m/s)": "max_continuous_wind_speed",
    "windgusts_10m_max (m/s)": "windgusts_max",
    "winddirection_10m_dominant (°)": "winddirection_dominant",
    "shortwave_radiation_sum (MJ/m²)": "shortwave_radiation_sum"
}

# 配置你想获取的数据字段 (根据文档中的 hourly 和 daily 参数)
HOURLY_VARS = []
DAILY_VARS = ["weathercode","temperature_2m_max","temperature_2m_min","temperature_2m_mean","precipitation_sum","rain_sum",
              "snowfall_sum","windspeed_10m_max","windgusts_10m_max","winddirection_10m_dominant","shortwave_radiation_sum"]


# 文件保存路径
# SAVE_DIR = "./back_con/public/"
SAVE_DIR = "./weather_data/"
import os
if not os.path.exists(SAVE_DIR):
    os.makedirs(SAVE_DIR)

def field_to_path_and_unit(field: str):
    mapping = {
        "year_month_day": (["date","year_month_day"], "year_month_day"),
        "avg_temperature": (["avg_temperature"], "C"),
        "max_temperature": (["max_temperature"], "C"),
        "min_temperature": (["min_temperature"], "C"),
        "precipitation":  (["precipitation"], "mm"),
        "rain_sum":       (["rain_sum"], "mm"),
        "snow_sum":       (["snow_sum"], "cm"),
        "max_continuous_wind_speed": (["max_continuous_wind_speed"], "m/s"),
        "windgusts_max":  (["windgusts_max"], "m/s"),
        "winddirection_dominant": (["winddirection_dominant"], "°"),
        "shortwave_radiation_sum": (["shortwave_radiation_sum"], "MJ/m²"),
    }
    return mapping.get(field, ([field], "none"))

def build_meta_from_xlsx(xlsx_path: str):
    df = pd.read_excel(xlsx_path)
    input_values, unit_values = [], []
    for col in df.columns:
        path, unit = field_to_path_and_unit(str(col))
        input_values.append(path)
        unit_values.append(unit)

    originalname = xlsx_path.split("-", -1)[-1]

    list0 = {
        "filename": os.path.basename(xlsx_path),
        "originalname": originalname,
        "inputValues": input_values,
        "unitValues":  unit_values,
        # 可选：如果要连数据一起发，可加上这一行
        # "records": df.to_dict(orient="records")
    }
    return list0

def post_json_like_frontend(xlsx_path: str):
    list0 = build_meta_from_xlsx(xlsx_path)
    payload_list = [list0]
    body = {"type": 2, "val": json.dumps(payload_list, ensure_ascii=False)}
    r1 = requests.post(API_ADD_FILE, json=body, headers=headers, timeout=60); r1.raise_for_status()
    r2 = requests.post(API_ADD_FILEDATA, json=body, headers=headers, timeout=120); r2.raise_for_status()
    print("上传成功：", xlsx_path)
    return r1.json(), r2.json()

# 数据清洗函数
def process_weather_data(filepath):
    """
    清洗 Excel 文件：
    1. 自动寻找表头（跳过前面的元数据）。
    2. 删除包含 #NUM! 的行。
    3. 删除单位行（如果有）。
    """
    try:
        # 1. 初步读取，不设表头，为了寻找真正的表头位置
        # Open-Meteo 的 Excel 通常前几行是元数据，真正的表头以 "time" 开头
        df_raw = pd.read_excel(filepath, header=None)
        
        # 寻找包含 "time" 的那一行作为表头行
        # 我们假设第一列包含 'time' (不区分大小写)
        header_row_index = -1
        for idx, row in df_raw.iterrows():
            first_cell = str(row[0])
            if "time" in first_cell.lower():
                header_row_index = idx
                break
        
        if header_row_index == -1:
            print(f"警告：在 {filepath} 中未找到 'time' 表头，跳过清洗。")
            return

        # 2. 重新读取文件，指定正确的表头行
        df = pd.read_excel(filepath, header=header_row_index)

        # 3. 处理单位行 (可选)
        # 有时候表头下面一行是单位（如 °C, mm），如果该行不是数据，通常 'time' 列无法转换为日期
        # 我们尝试将 data 转化为数值，如果转化失败通常就是单位行，会被变成 NaN
        
        # 4. 清理 #NUM! 和 非数值数据
        # 逻辑：除了 'time' 列，其他列都应该是数字
        cols_to_check = [c for c in df.columns if 'time' not in str(c).lower()]
        
        for col in cols_to_check:
            # 将该列强制转为数字，无法转换的（包括 '#NUM!', '°C'）都会变成 NaN (空值)
            df[col] = pd.to_numeric(df[col], errors='coerce')
        
        # 5. 删除包含空值 (NaN) 的行
        # 这一步会同时删掉：原始的 #NUM! 行、单位行、以及真正缺失数据的行
        original_len = len(df)
        df.dropna(inplace=True)
        dropped_count = original_len - len(df)

        # 6. 日期格式化：先转为 datetime 对象，再转为字符串格式 'YYYY-MM-DD'
        if 'time' in df.columns:
            df['time'] = pd.to_datetime(df['time']).dt.strftime('%Y-%m-%d')

        # 7. 重命名表头：使用 inplace=True 直接修改原对象
        df.rename(columns=COLUMN_MAPPING, inplace=True)

        # 8. 覆盖保存
        df.to_excel(filepath, index=False)
        if dropped_count > 0:
            print(f"   └─ 已清洗：删除了 {dropped_count} 行无效数据(含元数据/单位/#NUM!) + 日期格式化 + 表头重命名完毕")
        else:
            print(f"   └─ 已清洗：数据格式完美，无需删除行 + 日期格式化 + 表头重命名完毕")

    except Exception as e:
        print(f"数据清洗失败: {e}")

def fetch_single_location(loc_name, lat, lon, start_date, end_date):

    print(f"正在抓取 {loc_name} ({lat}, {lon}) 的数据...")

    # 2. 构造 API 参数字典 (对应文档中的 Requirements)
    params = {
        "format": "json",     # 明确指定json格式
        "out_format": "xlsx",
        "latitude": lat,
        "longitude": lon,
        "daily": ",".join(DAILY_VARS),
        "timezone": "Asia/Shanghai",  # 自动匹配当地时区
        "windspeed_unit": "ms",
        "start_date": start_date,
        "end_date": end_date,
        "api_key": API_KEY
    }

    try:
        # 3. 发送请求
        response = requests.get(BASE_URL, params=params, headers=headers)
        
        # 检查 HTTP 状态码
        response.raise_for_status() 
        
        # 特殊检查：虽然请求成功(200 OK)，但如果参数有误，API 可能返回 JSON 格式的错误信息而不是 Excel
        # 我们通过检查响应头的内容类型来判断
        content_type = response.headers.get('Content-Type', '')
        if 'json' in content_type:
            # 如果服务器返回的是 JSON，说明可能虽然状态码是 200 但业务逻辑有错
            error_data = response.json()
            if error_data.get("error"):
                print(f"{loc_name} API 业务错误: {error_data.get('reason')}")
                return False

        # 5. 保存数据到文件
        # 文件名包含时间戳，防止覆盖
        filename = f"{SAVE_DIR}{start_date}_to_{end_date}-{loc_name}.xlsx"
        with open(filename, 'wb') as f:
            f.write(response.content)

        print(f"{loc_name} 下载成功，正在清洗...")
            
        # 调用清洗函数
        process_weather_data(filename)

        # 调用示例
        # post_json_like_frontend(filename)

        # print(f"{loc_name} 已提交到后端入库。")
        
        return True

    except Exception as e:
        print(f"{loc_name} 抓取失败: {e}")
        return False


def fetch_all_provinces_task():
    # 主任务函数：循环所有省份进行数据抓取
    print(f"\n[{datetime.now()}] === 开始执行批量抓取任务 ===")

    # 计算日期 (过去30天)
    today = datetime.now()
    end_date = today.strftime("%Y-%m-%d")
    start_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")

# --- 2. 循环遍历地点列表 ---
    count = 0
    for province in PROVINCES:
        name = province['name']
        lat = province['lat']
        lon = province['lon']
        
        # 执行抓取
        success = fetch_single_location(name, lat, lon, start_date, end_date)
        
        if success:
            count += 1
        
        # --- 3. 关键修改：休息一阵子 (Rate Limiting) ---
        # 这样不会触发服务器的 QPS (每秒请求限制) 防火墙
        time.sleep(5)
        print(f"休息 5 秒，准备抓取下一个...")

    print(f"[{datetime.now()}] === 批量任务结束，成功抓取 {count}/{len(PROVINCES)} 个地点 ===\n")


# --- 调度配置 ---
# 设定任务时间
schedule.every().tuesday.at("16:47").do(fetch_all_provinces_task)
print("多地点抓取程序已启动，正在等待预定时间...")

# 主循环：保持脚本一直运行
while True:
    schedule.run_pending()
    time.sleep(1) # 避免占用过多 CPU