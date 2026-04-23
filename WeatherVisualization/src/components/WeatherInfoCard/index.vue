<script setup lang="ts">
import { ElMessage } from "element-plus";
import { column } from "element-plus/es/components/table-v2/src/common";
import { defineProps, watch, ref } from "vue";
import { WeatherInfo } from "@/api";

import {useDataStore} from "@/stores";
import { tr } from "element-plus/es/locale";
import {data} from "autoprefixer";
import axios from "axios";

const DialogShow = ref(false);
const dataStore = useDataStore();
// const Record = ref<{
//   WeatherStationCode : number;
//   Date : string;
//   Latitude : number;
//   Longtitude : number;
//   HeightOfMeteorologicalStation : number;
//   NameOfMeteorologicalStation : string;
//   AverageTemperature : number;
//   AttributesOfAverageTemperature : number;
//   AverageDewPoint : number;
//   AttributesOfAverageDewPoint : number;
//   AverageSeaLevelPressure : number;
//   AttributesOfAverageSeaLevelPressure : number;
//   AverageObservatoryPressure : number;
//   AttributesOfAverageObservatoryPressure : number;
//   AverageVisibility : number;
//   AttributesOfAverageVisibility : number;
//   AverageWindSpeed : number;
//   AttributesOfAverageWindSpeed : number;
//   MaximumSustainedWindSpeed : number;
//   AttributesOfMaximumSustainedWindSpeed : number;
//   HighestTemperature : number;
//   AttributesOfHighestTemperature : number;
//   LowestTemperature : number;
//   AttributesOfLowestTemperature : number;
//   Precipitation : number;
//   AttributesOfPrecipitation : string;
//   DepthOfSnow : number;
//   Indicator : number;
// }| undefined>(undefined);

// Record.value = {
//   WeatherStationCode : 1001099999,
//   Date : "2022/1/1",
//   Latitude : 70.9333333,
//   Longtitude : -8.6666667,
//   HeightOfMeteorologicalStation : 9,
//   NameOfMeteorologicalStation : "JAN MAYEN NOR NAVY, NO",
//   AverageTemperature : 12.1,
//   AttributesOfAverageTemperature : 19,
//   AverageDewPoint : 3.8,
//   AttributesOfAverageDewPoint : 19,
//   AverageSeaLevelPressure : 1010.2,
//   AttributesOfAverageSeaLevelPressure : 19,
//   AverageObservatoryPressure : 9,
//   AttributesOfAverageObservatoryPressure : 19,
//   AverageVisibility : 9.9,
//   AttributesOfAverageVisibility : 4,
//   AverageWindSpeed : 16.6,
//   AttributesOfAverageWindSpeed : 19,
//   MaximumSustainedWindSpeed : 27,
//   AttributesOfMaximumSustainedWindSpeed : 35.5,
//   HighestTemperature : 18,
//   AttributesOfHighestTemperature : null,
//   LowestTemperature : 9,
//   AttributesOfLowestTemperature : null,
//   Precipitation : 0.01,
//   AttributesOfPrecipitation : "E",
//   DepthOfSnow : 999.9,
//   Indicator : 1000,
// };

// watch(
//   () => props.pointData,
//   (newVal) => {
//     if (newVal) {
//       // 当 pointData 有值时，显示弹窗
//       DialogShow.value = true;
//       console.log("用户点击散点",newVal);
//     }
//   }
// );

const Record = ref<{ [key: string]: any } | null>(null);
watch( () => dataStore.cardShow,
  async (newval) => {
    if(newval){
      console.log(dataStore.pointPosition);
      try {
        const response = await axios.post("http://127.0.0.1:3000/components/weatherInfo",{
          data: {
            lat : dataStore.pointPosition?.lat,
            lng : dataStore.pointPosition?.lng,
            date : dataStore.date,
          }
        });
        console.log(response.data.data[0]);
        Record.value = response?.data.data[0];
        console.log(Record)
        console.log(Record.value);
        DialogShow.value = true;
      } catch(error) {
        ElMessage.error("获取气象记录失败，请稍后。");
        DialogShow.value = false;
      }
      // WeatherInfo()
      //  .then((res) => {
      //   if(res.success){
      //     console.log(res.data);
      //     Record.value = res.data;
      //     DialogShow.value = true;
      //   } else {
      //     ElMessage.error("获取气象记录失败，请稍后。");
      //     DialogShow.value = false;
      //   }
      //  })
      //  .catch((err) => {
      //   ElMessage.error(err);
      //   DialogShow.value = false;
      //  })
    }
  },
  {immediate: true}
);
</script>

<template>
  <div>
    <el-dialog
      v-model="dataStore.cardShow"
      title="气象信息"
      width="80%"
      draggable
      :modal="false"
    >
      <el-descriptions
				border
        size="large"
        :column="4"
			>
        <el-descriptions-item label="气象站代码">{{ Record?.station_code }}</el-descriptions-item>
        <el-descriptions-item label="日期">{{Record?.year_month_day}}</el-descriptions-item>
        <el-descriptions-item label="纬度">{{Record?.latitude}}</el-descriptions-item>
        <el-descriptions-item label="经度">{{Record?.longitude}}</el-descriptions-item>
        <el-descriptions-item label="气象站高程">{{Record?.station_elevation}}</el-descriptions-item>
        <el-descriptions-item label="气象站名称">{{Record?.station_name}}</el-descriptions-item>
        <el-descriptions-item label="平均气温">{{ Record?.avg_temperature }}</el-descriptions-item>
        <el-descriptions-item label="平均气温属性">{{ Record?.avg_temperature_attribute }}</el-descriptions-item>
        <el-descriptions-item label="平均露点">{{ Record?.avg_dew_point }}</el-descriptions-item>
        <el-descriptions-item label="平均露点属性">{{ Record?.avg_dew_point_attribute }}</el-descriptions-item>
        <el-descriptions-item label="平均海平面压强">{{ Record?.avg_sea_level_pressure }}</el-descriptions-item>
        <el-descriptions-item label="平均海平面压强属性">{{ Record?.avg_sea_level_pressure_attribute }}</el-descriptions-item>
        <el-descriptions-item label="平均观测站压强">{{ Record?.avg_station_pressure }}</el-descriptions-item>
        <el-descriptions-item label="平均观测站压强属性">{{ Record?.avg_station_pressure_attribute }}</el-descriptions-item>
        <el-descriptions-item label="平均能见度">{{ Record?.avg_visibility }}</el-descriptions-item>
        <el-descriptions-item label="平均能见度属性">{{ Record?.avg_visibility_attribute }}</el-descriptions-item>
        <el-descriptions-item label="平均风速">{{ Record?.avg_wind_speed }}</el-descriptions-item>
        <el-descriptions-item label="平均风速属性">{{ Record?.avg_wind_speed_attribute }}</el-descriptions-item>
        <el-descriptions-item label="最大持续风速">{{ Record?.max_continuous_wind_speed }}</el-descriptions-item>
        <el-descriptions-item label="最大持续风速属性">{{ Record?.max_continuous_wind_speed_attribute }}</el-descriptions-item>
        <el-descriptions-item label="最高气温">{{ Record?.max_temperature }}</el-descriptions-item>
        <el-descriptions-item label="最高气温属性">{{ Record?.max_temperature_attribute }}</el-descriptions-item>
        <el-descriptions-item label="最低气温">{{ Record?.min_temperature }}</el-descriptions-item>
        <el-descriptions-item label="最低气温属性">{{ Record?.min_temperature_attribute }}</el-descriptions-item>
        <el-descriptions-item label="降水量">{{ Record?.precipitation }}</el-descriptions-item>
        <el-descriptions-item label="降水量属性">{{ Record?.precipitation_attribute }}</el-descriptions-item>
        <el-descriptions-item label="积雪深度">{{ Record?.snow_depth }}</el-descriptions-item>
        <el-descriptions-item label="指示器">{{ Record?.indicator }}</el-descriptions-item>
      </el-descriptions>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dataStore.setCardShow(false)">关闭</el-button>
        </div>
      </template>

    </el-dialog>
  </div>
</template>

<style scoped lang="scss"></style>
