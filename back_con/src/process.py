import pandas as pd
import json

# 定义输入和输出文件名
input_file = 'back_con\敦煌市2024年数据.csv'
output_file = 'processed_weather_data_tianjin.csv'

def process_weather_file(input_path, output_path):
    # 读取原始文件内容
    with open(input_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    hourly_json_str = None

    # 遍历每一行，寻找包含 "hourly" 数据的行
    for line in lines:
        if line.startswith("hourly,"):
            # 该行的格式通常是: hourly,"{""time"": ... }"
            # 我们需要提取逗号后的部分，并处理 CSV 的转义字符
            
            # 找到第一个逗号的位置
            first_comma_index = line.find(',')
            
            if first_comma_index != -1:
                # 获取逗号后的所有内容，并去除首尾空白
                content = line[first_comma_index+1:].strip()
                
                # 处理 CSV 字符串格式：去除首尾的引号，将双重引号 "" 替换为单个 "
                if content.startswith('"') and content.endswith('"'):
                    content = content[1:-1]  # 去掉首尾引号
                    content = content.replace('""', '"')  # 反转义
                
                hourly_json_str = content
            break

    # 如果找到了数据字符串，进行 JSON 解析和表格转换
    if hourly_json_str:
        try:
            # 1. 解析 JSON 数据
            data = json.loads(hourly_json_str)
            
            # 2. 转换为 Pandas DataFrame
            df = pd.DataFrame(data)
            
            # 3. 保存为标准 CSV 文件 (不包含索引列)
            df.to_csv(output_path, index=False)
            
            print(f"处理成功！文件已保存为: {output_path}")
            print("-" * 30)
            print("数据预览 (前 5 行):")
            print(df.head())
            
        except json.JSONDecodeError as e:
            print(f"解析 JSON 时出错: {e}")
    else:
        print("错误：在文件中未找到 'hourly' 数据行。")

# 执行处理函数
if __name__ == "__main__":
    process_weather_file(input_file, output_file)