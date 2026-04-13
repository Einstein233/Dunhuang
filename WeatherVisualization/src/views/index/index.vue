<script setup lang="ts">
import ItemWrap from "@/components/item-wrap";
import LeftTop from "./left-top.vue";
import LeftCenter from "./left-center.vue";
import LeftBottom from "./left-bottom.vue";
import CenterMap from "./center-map.vue";
import ClimateMap from "./ClimateMap.vue";
import CenterBottom from "./center-bottom.vue";
import RightWhole from "./right-whole.vue";
import RightTop from "./right-top.vue";
import RightCenter from "./right-center.vue";
import RightBottom from "./right-bottom.vue";
import Map from "@/components/Map/index.vue";
import { ref, nextTick, onBeforeUnmount } from "vue";
import ToolBar from "@/components/TooolBar/index.vue";   // 日期筛选
import WeatherInfoCard from "@/components/WeatherInfoCard/index.vue";
import ServerStatus from "@/components/ServerStatus/index.vue";
import { regionCodes } from "./bottom.map";

interface PointProps {
  lat: number;
  lng: number;
}

const selectedPoint = ref<PointProps>();
const selectedDate = ref<string>();

const updateSelectedPoint = (val: PointProps) => {
  selectedPoint.value = val;
};

const updateSelectedDate = (val: string) => {
  selectedDate.value = val;
};

const climates = [
  { title: 5},   // 热带季风片区
  { title: 4},   // 亚热带季风片区
  { title: 3},   // 高原山地片区
  { title: 2},   // 温带大陆性片区
  { title: 1},   // 温带季风片区
  { title: 0},   // 热带雨林片区
];

const showInfo = ref(false);
const currentRegion = ref({});
const currentCity = ref("北京"); // 默认城市，避免初始化时出现undefined

const handleCityChange = (city: string) => {
  setTimeout(() => {
      currentCity.value = city;
    }, 400); // 延迟
}

const emit = defineEmits(['showRegionPopup']);
const showRegionPopup = (regionData: any) => {
  emit('showRegionPopup', regionData);
};

</script>

<template>
  <div class="index-box">

    <div class="top_area">

      <div class="contetn_left">
        <ItemWrap class="contetn_left-top contetn_l-item" title="全国古文物分布">
          <LeftTop/>
        </ItemWrap>
        <ItemWrap
          class="contetn_left-bottom contetn_l-item"
          :title="`${currentCity}`"
          style="padding: 0 -10px 16px 10px"
        >
          <LeftBottom @city-change="handleCityChange"/>
        </ItemWrap>
      </div>

      <div class="contetn_center">
        <CenterMap class="contetn_center_top" title="多环境要素站点分布图" />
          <!--      <Map @update="updateSelectedPoint" />-->
      </div>

      <div class="contetn_right">
        <ItemWrap class="contetn_left-bottom contetn_r-item" title="智能问答">
          <RightWhole/>
        </ItemWrap>
      </div>

    </div>

    <!-- 子组件ClimateMap发射showregion事件，这里调用showregionpopup接收传来的参数 -->
    <div class="bottom_area">
      <ItemWrap class="bottom-item" title="热带季风片区">
        <ClimateMap :climateID="climates[0].title" @show-region="showRegionPopup"/>
      </ItemWrap>
      <ItemWrap class="bottom-item" title="亚热带季风片区">
        <ClimateMap :climateID="climates[1].title" @show-region="showRegionPopup"/>
      </ItemWrap>
      <ItemWrap class="bottom-item" title="高原山地片区">
        <ClimateMap :climateID="climates[2].title" @show-region="showRegionPopup"/>
      </ItemWrap>
      <ItemWrap class="bottom-item" title="温带大陆性片区">
        <ClimateMap :climateID="climates[3].title" @show-region="showRegionPopup"/>
      </ItemWrap>
      <ItemWrap class="bottom-item" title="温带季风片区">
        <ClimateMap :climateID="climates[4].title" @show-region="showRegionPopup"/>
      </ItemWrap>
      <ItemWrap class="bottom-item" title="热带雨林片区">
        <ClimateMap :climateID="climates[5].title" @show-region="showRegionPopup"/>
      </ItemWrap>
    </div>

  </div>

</template>

<style scoped lang="scss">
.index-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  min-height: calc(100% - 64px);
  justify-content: space-between;
}

.top_area {
  display: flex;
  width: 100%;
}

//左边 右边 结构一样
.contetn_left {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  position: relative;
  width: 400px;
  box-sizing: border-box;
  flex-shrink: 0;
  gap: 20px;
}

.contetn_right {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  position: relative;
  width: 400px;
  box-sizing: border-box;
  flex-shrink: 0;
}

.contetn_center {
  flex: 1;
  margin: 0px 30px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
}

// contetn_l-item 和contetn_r-item 控制左右两侧部件的长度
.contetn_l-item {
  height: 323px;
}

.contetn_r-item {
  height: 665px;
}

.bottom_area {
  width: 100%;
  display: flex;
  flex-direction: row;
  justify-content: space-between; // 或 space-around
  align-items: stretch;
  height: 300px; // 或你想要的高度
  margin-top: 10px;
  gap: 10px;
}

.bottom-item {
  flex: 1;
  min-width: 0;
  margin: 0 0;
  display: flex;
  flex-direction: column;
  justify-content: stretch;
}
</style>
