<script setup lang="ts">

import { computed, ref ,onBeforeUpdate, nextTick} from "vue";
import { merge } from "lodash-es";
import { useElementSize  } from "@vueuse/core";
import type { PropType } from "vue";

const props = defineProps({
  color: {
    type: Array as unknown as PropType<[string, string]>,
    default: () => [],
  },
  backgroundColor: {
    type: String,
    default: "transparent",
  },
});
// const defaultColor = ["#d13a00", "#ffae00"];  // 深红色搭配
const defaultColor = ["#ff926b", "#ffd27a"];
const domRef = ref(null);
const { width, height } = useElementSize(domRef,{width:0,height:0}, { box: 'border-box' });
const mergedColor = computed<[string, string]>(() => {
  return merge(defaultColor, props.color);
});


</script>

<template>
  <div class="dv-border-box-13 dv-border-box" ref="domRef">
    <!-- 绘制每个部件的边框设计 -->
    <svg :width="width" :height="height" class="dv-border-svg-container">
      <!-- 边框 -->
      <path
        :fill="backgroundColor"
        :stroke="mergedColor[0]"
        :stroke-width="3"
        :d="`
            M 5 20 L 5 10 L 12 3  L 60 3 L 68 10
            L ${width - 20} 10 L ${width - 5} 25
            L ${width - 5} ${height - 5} L 20 ${height - 5}
            L 5 ${height - 20} L 5 20
        `"
      />
      <!-- 左上角三格 -->
      <path
        fill="transparent"
        stroke-width="3"
        stroke-linecap="round"
        stroke-dasharray="10, 5"
        :stroke="mergedColor[0]"
        :d="`M 16 9 L 61 9`"
      />

      <path
        fill="transparent"
        stroke="{mergedColor[1]}"
        :d="`M 5 20 L 5 10 L 12 3  L 60 3 L 68 10`"
      />
      <!-- 右下角边角 -->
      <path
        fill="transparent"
        :stroke="mergedColor[1]"
        :stroke-width="3"
        :d="`M ${width - 5} ${height - 30} L ${width - 5} ${height - 5} L ${
          width - 30
        } ${height - 5}`"
      />
    </svg>
    <div class="dv-border-box-content">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped lang="scss">
.dv-border-box {
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
}
.dv-border-svg-container {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0px;
  left: 0px;
  display: block;
}
.dv-border-box-content {
  position: relative;
  width: 100%;
  height: 100%;
  top: 15px;
  // z-index: 0;
}
</style>
