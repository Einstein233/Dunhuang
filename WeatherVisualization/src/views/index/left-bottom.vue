<script setup lang="ts">

import { ref, reactive, onMounted, onUnmounted } from "vue";
import CapsuleChart from "@/components/datav/capsule-chart";
import { ranking } from "@/api";
import { ElMessage } from "element-plus";
import DataRank from "./DataRank.vue";
import { cityList } from "./bottom.map";

const currentCityIndex = ref(0);
const currentCity = ref(cityList[0]);
const emit = defineEmits(['city-change']); // 这个要定时发送城市名给index父级容器动态变化title

function changeCityAndRefresh() {
  currentCityIndex.value = (currentCityIndex.value + 1) % cityList.length;
  currentCity.value = cityList[currentCityIndex.value];
  emit('city-change', currentCity.value); // 通知父级城市变化
  getData(); // 这里会调用 ranking()，让数据刷新
}

const config = ref({
  showValue: true,
  unit: "数量",
});

const data = ref([]);

const getData = () => {
  ranking()
    .then((res) => {
      // console.log("左下--区域文物分布", res);
      if (res.success) {
        data.value = res.data;
      } else {
        ElMessage({
          message: res.msg,
          type: "warning",
        });
      }
    })
    .catch((err) => {
      ElMessage.error(err);
    });
};

// 定时刷新文物区域分布
let timer: any = null;
onMounted(() => {
  emit("city-change", cityList[0]); // 页面一开始就发一次
  getData(); // 初始加载一次
  timer = setInterval(changeCityAndRefresh, 4000);
});
onUnmounted(() => timer && clearInterval(timer));

</script>

<template>
  <div class="left_bottom">
    <CapsuleChart :config="config" style="width: 100%; height: 260px" :data="data" />
     <!-- <DataRank /> -->
  </div>
</template>

<style scoped lang="scss">
.left_bottom {
  box-sizing: border-box;
  padding: 0 7px;
}
</style>
