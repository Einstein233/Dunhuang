<script setup lang="ts">
import { useDataStore } from "@/stores";

const dataStore = useDataStore();

// watch(selectedDate, () => {
//   console.log(selectedDate);
//   // setDate(selectedDate.value);
// });

// Todo: 根据数据库时间范围修改
const isValidDate = (time: Date) => {
  return !(time >= new Date("2021-12-31") && time <= new Date("2023-01-01"));
};
</script>

<template>
  <div class="tool-bar">
    <el-space size="large">
      <el-date-picker
        v-model="dataStore.date"
        :default-value="new Date('2022-01-01')"
        type="date"
        placeholder="选择日期"
        size="large"
        value-format="YYYY-MM-DD"
        :disabled-date="isValidDate"
      />
<!--      <el-button size="large" type="primary" style="font-weight: bold">-->
<!--        上传文件-->
<!--      </el-button>-->
    </el-space>
  </div>
</template>

<style scoped lang="scss">
.tool-bar {
  position: absolute;
  top: -35px;
  left: 15px;
  z-index: 9999;
}
</style>
