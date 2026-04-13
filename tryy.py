import os, json, requests, pandas as pd

API_ADD_FILE     = "http://localhost:3000/components/addFile"
API_ADD_FILEDATA = "http://localhost:3000/components/addFiledata"
HEADERS = {"Authorization": "Bearer <TOKEN>"}  # 如不需要可删

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
    r1 = requests.post(API_ADD_FILE, json=body, headers=HEADERS, timeout=60); r1.raise_for_status()
    r2 = requests.post(API_ADD_FILEDATA, json=body, headers=HEADERS, timeout=120); r2.raise_for_status()
    print("上传成功：", xlsx_path)
    return r1.json(), r2.json()

# 调用示例
post_json_like_frontend("./back_con/public/2025-11-09_to_2025-12-09-anhui.xlsx")