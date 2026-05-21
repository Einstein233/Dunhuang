<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ElMessage } from "element-plus";
import { weatherDashboard } from "@/api";

type CityClimateSummary = {
  province: string;
  city: string;
  stationCode: string;
  startTime: string;
  endTime: string;
  recordCount: number;
  coverageYears: number;
  annualAvgTemperature: number;
  temperatureRange: number;
  annualRain: number;
  annualSnow: number;
  annualAvgHumidity: number;
  annualMaxWindSpeed: number;
  annualRadiation: number;
};

const props = withDefaults(
  defineProps<{
    hoverRegion?: string;
  }>(),
  {
    hoverRegion: "",
  }
);

const cities = ref<CityClimateSummary[]>([]);
const currentIndex = ref(0);
let rotateTimer: number | null = null;

function normalizeRegionName(value?: string) {
  return String(value || "")
    .trim()
    .replace(/特别行政区|壮族自治区|回族自治区|维吾尔自治区|自治区|省|市|地区|盟/g, "");
}

function createEmptyCity(regionName: string): CityClimateSummary {
  return {
    province: normalizeRegionName(regionName) || "暂无数据",
    city: "",
    stationCode: "empty-hover-region",
    startTime: "",
    endTime: "",
    recordCount: 0,
    coverageYears: 0,
    annualAvgTemperature: 0,
    temperatureRange: 0,
    annualRain: 0,
    annualSnow: 0,
    annualAvgHumidity: 0,
    annualMaxWindSpeed: 0,
    annualRadiation: 0,
  };
}

const hoveredCity = computed(() => {
  if (!props.hoverRegion) return null;
  const target = normalizeRegionName(props.hoverRegion);
  const matched = cities.value.find((item) => {
    return (
      normalizeRegionName(item.city) === target ||
      normalizeRegionName(item.province) === target
    );
  });

  return matched || createEmptyCity(props.hoverRegion);
});

const currentCity = computed(() => hoveredCity.value || cities.value[currentIndex.value]);
const displayRegionName = computed(() => {
  const city = currentCity.value;
  if (!city) return "";
  if (!city.city) return city.province;
  return city.province === city.city ? city.city : `${city.province} / ${city.city}`;
});

const metricCards = computed(() => {
  const city = currentCity.value;
  if (!city) return [];

  return [
    { label: "年均气温", value: city.annualAvgTemperature, unit: "℃", color: "#b85d1d" },
    { label: "年均降雨", value: city.annualRain, unit: "mm/年", color: "#c9772b" },
    { label: "年均湿度", value: city.annualAvgHumidity, unit: "%", color: "#7d8d3a" },
    { label: "年均最大风速", value: city.annualMaxWindSpeed, unit: "m/s", color: "#9d6a2f" },
  ];
});

function formatDate(value?: string) {
  return value ? value.slice(0, 10) : "--";
}

async function loadData() {
  try {
    const res = await weatherDashboard();
    if (res.success || res.code === 1) {
      cities.value = res.data.cities || [];
      currentIndex.value = 0;
      return;
    }
    ElMessage.warning(res.msg || "城市气候数据加载失败");
  } catch (error: any) {
    ElMessage.error(error?.message || error || "城市气候数据加载失败");
  }
}

function startRotate() {
  rotateTimer = window.setInterval(() => {
    if (cities.value.length > 1) {
      currentIndex.value = (currentIndex.value + 1) % cities.value.length;
    }
  }, 5000);
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
  <div class="climate-overview">
    <template v-if="currentCity">
      <div class="city-row">
        <div>
          <div class="city-name">{{ displayRegionName }}</div>
          <div class="date-range">
            {{ formatDate(currentCity.startTime) }} - {{ formatDate(currentCity.endTime) }}
          </div>
        </div>
        <div class="record-pill">
          <span>{{ currentCity.recordCount.toLocaleString() }}</span>
          <small>小时记录</small>
        </div>
      </div>

      <div class="metric-grid">
        <div class="metric-card" v-for="item in metricCards" :key="item.label">
          <div class="metric-label">{{ item.label }}</div>
          <div class="metric-value" :style="{ color: item.color }">
            {{ item.value.toLocaleString() }}<span>{{ item.unit }}</span>
          </div>
          <div class="metric-track">
            <i :style="{ width: `${Math.min(100, Math.max(12, Number(item.value) % 100))}%`, background: item.color }"></i>
          </div>
        </div>
      </div>
    </template>
    <div v-else class="empty-state">暂无气候统计数据</div>
  </div>
</template>

<style scoped lang="scss">
.climate-overview {
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

.city-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 26px;
  margin-top: 10px;
  margin-bottom: 0px;
}

.city-name {
  color: #2b1b10;
  font-size: 20px;
  font-weight: 700;
}

.date-range {
  margin-top: 3px;
  color: rgba(72, 45, 26, 0.7);
  font-size: 12px;
}

.record-pill {
  min-width: 76px;
  padding: 4px 7px;
  border: 1px solid rgba(206, 112, 42, 0.28);
  background: linear-gradient(135deg, rgba(255, 238, 207, 0.92), rgba(244, 195, 130, 0.42));
  text-align: center;
  border-radius: 8px;

  span {
    display: block;
    color: #9d4f19;
    font-size: 14px;
    font-weight: 800;
  }

  small {
    color: rgba(73, 45, 25, 0.64);
    font-size: 11px;
  }
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  height: calc(100% - 58px);
  align-content: start;
  margin-top: 24px;
}

.metric-card {
  height: 82px;
  padding: 9px 10px;
  border: 1px solid rgba(206, 112, 42, 0.14);
  background: rgba(255, 250, 241, 0.72);
  border-radius: 8px;
}

.metric-label {
  color: rgba(58, 36, 21, 0.72);
  font-size: 12px;
}

.metric-value {
  margin-top: 7px;
  font-size: 18px;
  font-weight: 800;
  line-height: 1;

  span {
    margin-left: 4px;
    color: rgba(58, 36, 21, 0.62);
    font-size: 12px;
    font-weight: 500;
  }
}

.metric-track {
  height: 4px;
  margin-top: 16px;
  overflow: hidden;
  background: rgba(165, 94, 42, 0.12);
  border-radius: 999px;

  i {
    display: block;
    height: 100%;
    border-radius: 4px;
  }
}

.empty-state {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
}
</style>
