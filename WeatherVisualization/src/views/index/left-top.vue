<script setup lang="ts">
import { ref, reactive } from "vue";
import { graphic } from "echarts/core";
import { countUserNum } from "@/api";
import {ElMessage} from "element-plus"

let colors = ["#0BFC7F", "#A0A0A0", "#F48C02", "#F4023C"];

const option = ref({});

const state = reactive({
  relicNum: 0,
  metalNum: 0,
  paperNum: 0,
  textileNum: 0,
  jadeNum: 0,
  stoneNum: 0,
  potteryNum: 0,
  otherNum: 0,
  totalNum: 0,
});

const echartsGraphic = (colors: string[]) => {
  return new graphic.LinearGradient(1, 0, 0, 0, [
    { offset: 0, color: colors[0] },
    { offset: 1, color: colors[1] },
  ]);
};

const getData = () => {
  countUserNum().then((res) => {
    // console.log("左上--古文物类型分布",res);
    if (res.success) {
      state.relicNum = res.data.relicNum;
      state.metalNum = res.data.metalNum;
      state.paperNum = res.data.paperNum;
      state.textileNum = res.data.textileNum;
      state.jadeNum = res.data.jadeNum;
      state.stoneNum = res.data.stoneNum;
      state.potteryNum = res.data.potteryNum;
      state.otherNum = res.data.otherNum;
      state.totalNum = res.data.totalNum;
      setOption();
    }else{
      ElMessage.error(res.msg)
    }
  }).catch(err=>{
    ElMessage.error(err)
  });
};
getData();
const setOption = () => {
  option.value = {
    title: {
      top: 110,
      left: "center",
      text: [`{value|${state.totalNum}}`, "{name|总数}"].join("\n"),
      textStyle: {
        rich: {
          value: {
            color: "#000000",
            fontSize: 24,
            fontWeight: "bold",
            lineHeight: 20,
            padding:[4,0,4,0]
          },
          name: {
            color: "#000000",
            lineHeight: 20,
          },
        },
      },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(0,0,0,.6)",
      borderColor: "rgba(147, 235, 248, .8)",
      textStyle: {
        color: "#FFF",
      },
    },
    series: [
      {
        name: "用户总览",
        type: "pie",
        radius: ["35%", "72%"],
        // avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 6,
          borderColor: "rgba(255,255,255,0)",
          borderWidth: 2,
        },
        color: colors,
        label: {
          show: true,
          formatter: "   {b|{b}}   \n   {per|{d}%}  ",
          //   position: "outside",
          rich: {
            b: {
              color: "#000",
              fontSize: 12,
              lineHeight: 26,
            },
            c: {
              color: "#31ABE3",
              fontSize: 14,
            },
            per: {
              color: "#31ABE3",
              fontSize: 14,
            },
          },
        },
        emphasis: {
          show: false,
        },
        legend: {
          show: false,
        },
        tooltip: { show: true },

        labelLine: {
          show: true,
          length: 8, // 第一段线 长度
          length2: 8, // 第二段线 长度
          smooth: 0.8,
          lineStyle: {},
        },
        data: [
          {
            value: state.otherNum,
            name: "其他",
            itemStyle: {
              color: echartsGraphic(["#fbbf24", "#f59e42"]),
            },
          },  
          {
            value: state.paperNum,
            name: "纸质类",
            itemStyle: {
              color: echartsGraphic(["#ff926b", "#ffb878"]),
            },
          },
          {
            value: state.textileNum,
            name: "织布类",
            itemStyle: {
              color: echartsGraphic(["#d46a3f", "#e09a6c"]),
            },
          },
          {
            value: state.jadeNum,
            name: "玉器类",
            itemStyle: {
              color: echartsGraphic(["#e9b97f", "#ffd9a0"]),
            },
          },
          {
            value: state.potteryNum,
            name: "陶器类",
            itemStyle: {
              color: echartsGraphic(["#c1440e", "#ec9f65"]),
            },
          },
          {
            value: state.metalNum,
            name: "青铜类",
            itemStyle: {
              color: echartsGraphic(["#ff735c", "#ffb569"]),
            },
          },
          {
            value: state.stoneNum,
            name: "石刻类",
            itemStyle: {
              color: echartsGraphic(["#a8552d", "#e2854d"]),
            },
          },
          {
            value: state.relicNum,
            name: "建筑类",
            itemStyle: {
              color: echartsGraphic(["#e06666", "#f9be81"]),
            },
          },
        ],
      },
    ],
  };
};
</script>

<template>
  <v-chart class="chart" :option="option" />
</template>

<style scoped lang="scss">
  .chart {
    width: 360px;
    height: 250px;
    box-sizing: border-box;
  }
</style>
