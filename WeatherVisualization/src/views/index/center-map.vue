<script setup lang="ts">

import { ref, reactive, nextTick } from "vue";
import { centerMap, GETNOBASE } from "@/api";
import { registerMap, getMap } from "echarts/core";  // ECharts用于绘制图表和地图的JS可视化库
import { optionHandle, regionCodes } from "./center.map";
import BorderBox13 from "@/components/datav/border-box-13";
import { ElMessage } from "element-plus";

import type { MapdataType } from "./center.map";
import Map from "@/components/Map/index.vue";


const option = ref({});   // 创建一个响应式的空对象，用来存放Echarts的图表配置
const code = ref("china");  // 初始为整张中国地图，若是点击省就会变成该省编码

const emit = defineEmits(['update-father']);

// prop是property：组件对外暴露的参数接口。使用子组件时可以通过prop向它传递数据。
withDefaults(
  // 组件接收一个名为title的prop，类型可以是数字或字符串
  defineProps<{
    // 结束数值
    title: number | string;
  }>(),
  {
    title: "地图",  // 如果没有传入title，默认为"地图"
  }
);


// 异步函数：接收两个参数 regioncode（地图区域的编码）和 list（name和value的数据列表，如地区名+数据值） 
// 根据区域代码获取该区域的 GeoJSON 行政边界数据，提取每个区块的中心点（坐标），然后将传入的业务数据绑定上坐标，输出成 mapData 数组供 ECharts 等图表使用。
const dataSetHandle = async (regionCode: string, list: object[]) => {
  // console.log("regionCode ", regionCode);
  const geojson: any = await getGeojson(regionCode);  // 获取regioncode对应的geojson地图数据
  // console.log("geojson ", geojson);
  let cityCenter: any = {};   // 存储每个城市或区域的中心点坐标
  let mapData: MapdataType[] = [];  // 最终需要传给图表的数据结构数组，每项包含 name 和 value

  // 遍历geojson获取当前地图每块行政区中心点，存到citycenter字典中，name为key
  geojson.features.forEach((element: any) => {
    cityCenter[element.properties.name] = element.properties.centroid || element.properties.center;
  });

  // 将传入的业务数据与中心坐标合并，生成地图可视化数据格式
  // console.log("传入的业务数据：", list)
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
  option.value = optionHandle(regionCode, list, mapData);
};


// 前端地图点击交互后拉取数据并刷新图表
const getData = async (regionCode: string) => {
  // 如果 regionCode 是 chinaNanhai，设置为海南省的 460000
  if (regionCode === "chinaNanhai") {
    regionCode = "460000";  // 替换为海南省的 regionCode
  }

  // centerMap()不是立即返回结果，而是先返回promise对象，要等他执行完才能拿到数据，所以后面用then处理
  // 这里会调用centerMap函数通过GET请求去出发模拟函数随机生成省份数据和城市数据，返回regioncode和对应value
  centerMap({ regionCode: regionCode })
    .then((res) => {
      // console.log("中上--设备分布", res);
      // 如果请求成功，则调用dataSetHandle()把区域编码和区域数据传进去
      if (res.success) {
        dataSetHandle(res.data.regionCode, res.data.dataList);
        emit('update-father', res.data.dataList[0].father);
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
    // console.log("mapjson = ", mapjson);
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


getData(code.value);    // 用于初始化中国地图，世界地图用onmounted


// 地图点击事件的回调函数，用来处理用户点击某个地图区域时的行为
// params 是 ECharts 点击事件传回来的参数对象，包含了点击区域的信息
const mapClick = (params: any) => {
  // console.log("params = ", params);
  // 看看用户点击的区域有没有对应的编码数据
  let xzqData = regionCodes[params.name];
  if (xzqData) {
    getData(xzqData.adcode);
  } else {
    window["$message"].warning("暂无下级地市");
  }
};

</script>

<template>
  <div class="centermap">
    <div class="maptitle">
      <div class="zuo"></div>
      <span class="titletext">{{ title }}</span>
      <div class="you"></div>
    </div>
    <div class="mapwrap">
      <BorderBox13 background-color="#ffffffc2">
        <!-- 这个Map和quanguo是两种地图组件，map是世界地图，quanguo是中国地图 -->
        <!-- <Map/> --> 
        <!-- quanguo是一个按钮，点击大屏右上角返回机会执行getdata，把地图切换回中国全图 -->
        <!-- 这个按钮只有在当前不是中国地图的时候才显示返回按钮 -->
        <!-- vchart中点击地图区域会调用mapClick处理用户交互 -->
        <v-chart
         class="chart"
         :option="option"
         ref="centerMapRef"
         @click="mapClick"  
         v-if="JSON.stringify(option) != '{}'"
        />
        <div class="quanguo" @click="getData('china')" v-if="code !== 'china'">返 回</div>
      </BorderBox13>
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
    height: 615px;
    width: 100%;
    // padding: 0 0 10px 0;
    box-sizing: border-box;
    position: relative;

    // 返回按钮
    .quanguo {
      display: flex;
      justify-content: center;  // 水平居中对齐
      align-items: center;      // 垂直居中对齐
      position: absolute;
      right: 40px;
      top: 30px;
      width: 80px;
      height: 28px;
      border: 1px solid #D45B38;
      border-radius: 10px;
      color: #F1A54C;
      text-align: center;
      line-height: 25px;
      cursor: pointer;
      box-shadow: 0 2px 4px rgba(212, 91, 56, 0.5), 0 0 6px rgba(212, 91, 56, 0.4);
      z-index: 10;
    }
    .chart{
      width: 98.5%;
      height: 96%;
      margin-top: -10px;
      margin-left: 9px;
      margin-right: 9px;
      border-radius: 30px;
      overflow: hidden;
    }
  }
}
</style>
