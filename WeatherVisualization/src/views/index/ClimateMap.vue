<script setup lang="ts">

import { ref, reactive, nextTick } from "vue";
import { centerMap, GETNOBASE } from "@/api";
import { registerMap, getMap } from "echarts/core";  // ECharts用于绘制图表和地图的JS可视化库
import { optionHandle, regionCodes } from "./bottom.map";
import BorderBox13 from "@/components/datav/border-box-13";
import { ElMessage } from "element-plus";

import type { MapdataType, ClimateDataItem } from "./bottom.map";
import Map from "@/components/Map/index.vue";


const option = ref({});   // 创建一个响应式的空对象，用来存放Echarts的图表配置
const code = ref("china");  // 初始为整张中国地图，若是点击省就会变成该省编码

const props = defineProps<{
  climateID: number
}>();

// 异步函数：接收两个参数 regioncode（地图区域的编码）和 list（name和value的数据列表，如地区名+数据值） 
// 根据区域代码获取该区域的 GeoJSON 行政边界数据，提取每个区块的中心点（坐标），然后将传入的业务数据绑定上坐标，输出成 mapData 数组供 ECharts 等图表使用。
const dataSetHandle = async (regionCode: string, list: object[]) => {

  const geojson: any = await getGeojson(regionCode);  // 获取regioncode对应的geojson地图数据
  let cityCenter: any = {};   // 存储每个城市或区域的中心点坐标
  let mapData: MapdataType[] = [];  // 最终需要传给图表的数据结构数组，每项包含 name 和 value

  // 遍历geojson获取当前地图每块行政区中心点，存到citycenter字典中，name为key
  geojson.features.forEach((element: any) => {
    cityCenter[element.properties.name] = element.properties.centroid || element.properties.center;
  });

  // 将传入的业务数据与中心坐标合并，生成地图可视化数据格式
  list.forEach((item: any) => {
    if (cityCenter[item.name]) {
      mapData.push({
        name: item.name,
        value: cityCenter[item.name].concat(item.value), // mapdata value [经度, 纬度, 业务值]
      });
    }
  });
  await nextTick();

  // datasethandle被调用就会执行optionhandle去更新生成新的图表配置
  option.value = optionHandle(regionCode, list as ClimateDataItem[], mapData);
};


// 前端地图点击交互后拉取数据并刷新图表
const getData = async (regionCode: string, climateID: number) => {
  // centerMap()不是立即返回结果，而是先返回promise对象，要等他执行完才能拿到数据，所以后面用then处理
  // 这里会调用centerMap函数通过GET请求去出发模拟函数随机生成省份数据和城市数据，返回regioncode和对应value
  centerMap({ regionCode: regionCode, climateID: climateID })
    .then((res) => {
      // console.log("中上--设备分布", res);
      // 如果请求成功，则调用dataSetHandle()把区域编码和区域数据传进去
      if (res.success) {
        dataSetHandle(res.data.regionCode, res.data.dataList);
        code.value = regionCode; // 返回按钮在点击后会刷新code并触发按钮消失
      } else {
        ElMessage.error(res.msg);
      }
    })
    .catch((err) => {
      ElMessage.error(err);
    });
};


// 加载地图GeoJSON数据
const getGeojson = (regionCode: string) => {
  return new Promise<boolean>(async (resolve) => {
    let mapjson = getMap(regionCode);  // 调用getMap()查看该区域地图是否已经注册过
    // 如果已经注册直接取geoJSON数据
    if (mapjson) {
      mapjson = mapjson.geoJSON;
      resolve(mapjson);   // 返回mapjson数据（本地获取）
    } 
    // 否则调用GETNOBASE()请求geojson数据文件
    else {
      mapjson = await GETNOBASE(`./map-geojson/${regionCode}.json`).then((data) => data);
      code.value = regionCode;  // 更新响应式变量
      // 注册地图数据给Echarts
      registerMap(regionCode, {
        geoJSON: mapjson as any,
        specialAreas: {},
      });
      resolve(mapjson);   // 返回mapjson数据（远程加载）
    }
  });
};


getData(code.value, props.climateID);    // 初始化和传入气候片区信息

// 为了确保气候片区是统一管理，所以各个片区页面的点击会传送名为show-region的事件带着参数给父级容器接收
const emit = defineEmits(['show-region']);

const mapClick = (params: any) => {
  emit('show-region', {
    ...params.data,
    name: params.name,
    adcode: regionCodes[params.name]?.adcode,
    level: regionCodes[params.name]?.level,
    climate: params.data.climate,
    area: "bottom_map",
  });
};

</script>

<template>
  <div class="centermap">
    <div class="mapwrap">
      <!-- vchart中点击地图区域会调用mapClick处理用户交互 -->
      <v-chart
        class="chart"
        :option="option"
        ref="centerMapRef"
        @click="mapClick"  
        v-if="JSON.stringify(option) != '{}'"
        />
    </div>
  </div>
</template>

<style scoped lang="scss">
.centermap {
  margin-bottom: 5px;

  .maptitle {
    height: 60px;
    display: flex;
    justify-content: center;
    padding-top: 10px;
    box-sizing: border-box;

    .titletext {
      font-size: 28px;
      font-weight: 900;
      letter-spacing: 6px;
      background: linear-gradient(92deg, #d13a00 0%, #ff7c1e 50%, #ff3333 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin: 0 10px;
    }

    .zuo,
    .you {
      background-size: 100% 100%;
      width: 29px;
      height: 20px;
      margin-top: 8px;
    }

    .zuo {
      background: url("@/assets/img/xiezuo.png") no-repeat;
    }

    .you {
      background: url("@/assets/img/xieyou.png") no-repeat;
    }
  }

  .mapwrap {
    height: 252px;
    width: 100%;
    // padding: 0 0 10px 0;
    box-sizing: border-box;
    position: relative;

    .chart{
      width: 99%;
      height: 94%;
      margin-top: -4px;
      margin-left: 0px;
      margin-right: 7px;
      border-radius: 10px;
      overflow: hidden;
    }
  }
}
</style>
