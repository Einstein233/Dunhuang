<script setup lang="ts">

import { ref, onMounted, defineEmits, watch } from "vue";
import {Scene, PointLayer, BaiduMap} from "@antv/l7";
import { GaodeMap } from "@antv/l7-maps";
import points_data from "@/assets/points_data.json";  // 这个点数据网上随机扒下来的
import { useDataStore } from "@/stores";
import WeatherInfoCard from "@/views/index/Map.vue";
import BorderBox13 from "@/components/datav/border-box-13";

const { setPointPosition, setCardShow } = useDataStore();


const initMap = () => {

  // 地图场景：创建地图容器，底图是baidu，然后把地图挂载到DOM中的map id元素上
  const scene = new Scene({
    id: "map",
    // map: new GaodeMap({
    //   mapStyle: 'amap://styles/darkblue',
    //   center: [107.054293, 38.246265],
    //   zoom: 3.5,
    //   token: "36e7fbf6b069ab4834feb88a40bc562a",
    //   // token: "4b8d96b56bed29b2df4a7713e3e1421e",
    //   doubleClickZoom: false,
    // }),
    map: new BaiduMap({
      // mapStyle: "amap://styles/blue",
      // style: "dark",
      center: [107.054293, 38.246265],
      zoom: 5,
      // style: "344b005fd5b4220a55241c25e7733e81",
      // token: "36e7fbf6b069ab4834feb88a40bc562a",
      // doubleClickZoom: false,
    }),
  });

  
  // 点图层：把一组坐标点数据points_data加载进来，每个点都有经纬度，然后可视化每个数据点
  const pointLayer = new PointLayer()
      .source(points_data, {
        parser: {
          type: "json",
          x: "lng",   // 经度
          y: "lat",   // 维度
        },
      })
      .shape("circle")
      .size(3)
      .active({
        color: '#FF0000',
      })
      .color("#14C9C9")
      .style({
        opacity: 0.6,
      });


  // 交互事件：用户双击某个点会拿到他的经纬度，然后调用setpointposition()和setcardshow()
  pointLayer.on("dblclick", (e) => {
    console.log('用户点击');
    // const { lng, lat } = e.lngLat;
    const { lng, lat } = e.feature;
    setPointPosition({lng, lat});
    setCardShow(true);
  });

  // 把点图层添加到地图中，地图上就能看到这些点
  scene.addLayer(pointLayer);
};


// 组件加载完成时自动执行initMap()来初始化地图
onMounted(() => {
  console.log('地图初始化');
  initMap();
});

</script>

<template>
  <div id="map"></div>
<!--  <div class="maptitle">-->
<!--      <div class="zuo"></div>-->
<!--      <span class="titletext">监测站分布图</span>-->
<!--      <div class="you"></div>-->
<!--  </div>-->
<!--  <div class="map-page">-->
<!--    <BorderBox13>-->
<!--      <div class="map-wrapper">-->
<!--        <div id="map" ></div>-->
<!--      </div>-->
<!--    </BorderBox13>-->
<!--  </div>-->
</template>

<style scoped lang="scss">
//控制画布大小
//#map {
//  width: 96%;
//  height: 550px;
//  position: relative;
//}
#map {
  height: 94%;
  width: 97%;
  margin: auto; /* 水平居中容器 */
  top: 3.5%;
  border-radius: 20px;
  overflow: hidden;
}
//
//.maptitle {
//  height: 60px;
//  display: flex;
//  justify-content: center;
//  padding-top: 10px;
//  box-sizing: border-box;
//
//  .titletext {
//    font-size: 28px;
//    font-weight: 900;
//    letter-spacing: 6px;
//    background: linear-gradient(92deg, #0072ff 0%, #00eaff 48.8525390625%, #01aaff 100%);
//    -webkit-background-clip: text;
//    -webkit-text-fill-color: transparent;
//    margin: 0 10px;
//  }
//
//  .zuo,
//  .you {
//    background-size: 100% 100%;
//    width: 29px;
//    height: 20px;
//    margin-top: 8px;
//  }
//
//  .zuo {
//    background: url("@/assets/img/xiezuo.png") no-repeat;
//  }
//
//  .you {
//    background: url("@/assets/img/xieyou.png") no-repeat;
//  }
//}
//
////控制画布大小？
//.map-page {
//  height: 580px;
//  width: 100%;
//  box-sizing: border-box;
//  position: relative;
//
//  //控制画布左右位置
//  .map-wrapper {
//    padding: 17px 0 10px 25px;
//  }
//}
</style>
