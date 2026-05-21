<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { graphic } from "echarts/core";
import { ElMessage } from "element-plus";
import { weatherDashboard } from "@/api";

type MetricDefinition = {
  key: string;
  label: string;
  unit: string;
};

type RankingItem = {
  rank: number;
  province: string;
  city: string;
  stationCode: string;
  value: number;
  unit: string;
};

const metrics = ref<MetricDefinition[]>([]);
const rankings = ref<Record<string, RankingItem[]>>({});
const currentMetricIndex = ref(0);
let rotateTimer: number | null = null;

const currentMetric = computed(() => metrics.value[currentMetricIndex.value]);
const currentRanking = computed(() => {
  const metric = currentMetric.value;
  if (!metric) return [];

  const rows = rankings.value[metric.key] || [];
  const placeholders: RankingItem[] = [
    { rank: 4, province: "陕西", city: "西安", stationCode: "placeholder-4", value: 0, unit: metric.unit },
    { rank: 5, province: "河南", city: "洛阳", stationCode: "placeholder-5", value: 0, unit: metric.unit },
  ];

  return [...rows, ...placeholders]
    .slice(0, 5)
    .map((item, index) => ({
      ...item,
      rank: index + 1,
      unit: metric.unit,
    }));
});

const maxValue = computed(() => {
  return Math.max(...currentRanking.value.map((item) => Number(item.value) || 0), 1);
});

const chartOption = computed(() => {
  const metric = currentMetric.value;
  const rows = currentRanking.value;
  if (!metric || !rows.length) return {};

  return {
    grid: { left: 54, right: 56, top: 8, bottom: 14 },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "shadow" },
      backgroundColor: "rgba(255, 248, 236, 0.96)",
      borderColor: "rgba(199, 113, 45, 0.45)",
      textStyle: { color: "#3b2415" },
      formatter: (items: any[]) => {
        const item = items[0];
        const row = rows[item.dataIndex];
        return `${row.province}/${row.city}<br/>${metric.label}: ${row.value} ${metric.unit}`;
      },
    },
    xAxis: {
      type: "value",
      show: false,
      max: maxValue.value * 1.18,
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((item) => item.city),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: {
        color: "#3b2415",
        fontSize: 12,
        formatter: (value: string, index: number) => `${index + 1}. ${value}`,
      },
    },
    series: [
      {
        type: "bar",
        barWidth: 14,
        data: rows.map((item, index) => ({
          value: item.value,
          itemStyle: {
            borderRadius: [0, 9, 9, 0],
            color: new graphic.LinearGradient(0, 0, 1, 0, [
              { offset: 0, color: index === 0 ? "#c96022" : "#d77d34" },
              { offset: 1, color: index === 0 ? "#efb85c" : "#f0bf73" },
            ]),
          },
        })),
        label: {
          show: true,
          position: "right",
          color: "#4a2a16",
          fontSize: 12,
          fontWeight: 700,
          formatter: (item: any) => `${Number(item.value).toLocaleString()} ${metric.unit}`,
        },
      },
      {
        type: "bar",
        barGap: "-100%",
        barWidth: 14,
        data: rows.map(() => maxValue.value),
        silent: true,
        itemStyle: {
          borderRadius: [0, 9, 9, 0],
          color: "rgba(165, 94, 42, 0.12)",
        },
        z: -1,
      },
    ],
  };
});

const topItem = computed(() => currentRanking.value[0]);

async function loadData() {
  try {
    const res = await weatherDashboard();
    if (res.success || res.code === 1) {
      metrics.value = res.data.metrics || [];
      rankings.value = res.data.rankings || {};
      currentMetricIndex.value = 0;
      return;
    }
    ElMessage.warning(res.msg || "城市气候排行加载失败");
  } catch (error: any) {
    ElMessage.error(error?.message || error || "城市气候排行加载失败");
  }
}

function startRotate() {
  rotateTimer = window.setInterval(() => {
    if (metrics.value.length > 1) {
      currentMetricIndex.value = (currentMetricIndex.value + 1) % metrics.value.length;
    }
  }, 4500);
}

onMounted(async () => {
  await loadData();
  startRotate();
});

onBeforeUnmount(() => {
  if (rotateTimer) {
    window.clearInterval(rotateTimer);
  }
});
</script>

<template>
  <div class="ranking-panel">
    <template v-if="currentMetric && currentRanking.length">
      <div class="ranking-head">
        <div>
          <div class="metric-title">{{ currentMetric.label }}排行</div>
          <div class="metric-subtitle">基于数据库逐小时气候观测聚合</div>
        </div>
        <div class="leader" v-if="topItem">
          <span>TOP</span>
          <strong>{{ topItem.city }}</strong>
        </div>
      </div>

      <v-chart class="ranking-chart" :option="chartOption" autoresize />

    </template>
    <div v-else class="empty-state">暂无气候排行数据</div>
  </div>
</template>

<style scoped lang="scss">
.ranking-panel {
  width: 100%;
  height: calc(100% - 22px);
  padding: 7px 9px;
  box-sizing: border-box;
  color: #3b2415;
  overflow: hidden;
  background: #fff0d6;
  border: 1px solid rgba(206, 112, 42, 0.22);
  border-radius: 10px;
  box-shadow: inset 0 0 18px rgba(186, 101, 36, 0.08);
}

.ranking-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  margin-top: 8px;
  margin-bottom: 8px;
}

.metric-title {
  color: #2b1b10;
  font-size: 20px;
  font-weight: 800;
}

.metric-subtitle {
  margin-top: 5px;
  color: rgba(72, 45, 26, 0.68);
  font-size: 12px;
}

.leader {
  min-width: 70px;
  padding: 5px 8px;
  border: 1px solid rgba(206, 112, 42, 0.28);
  background: linear-gradient(135deg, rgba(255, 238, 207, 0.92), rgba(244, 195, 130, 0.42));
  text-align: center;
  border-radius: 8px;

  span {
    display: block;
    color: rgba(73, 45, 25, 0.62);
    font-size: 10px;
    letter-spacing: 0;
  }

  strong {
    display: block;
    margin-top: 2px;
    color: #9d4f19;
    font-size: 15px;
  }
}

.ranking-chart {
  width: 100%;
  height: 198px;
}

.empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(58, 36, 21, 0.55);
}
</style>
