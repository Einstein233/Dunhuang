<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import dayjs from "dayjs";
import axios from "axios";
import { RouterView } from "vue-router";
import { storeToRefs } from "pinia";
import { ElMessage } from "element-plus";

import ScaleScreen from "@/components/scale-screen";
import MessageContent from "@/components/Plugins/MessageContent";
import { useSettingStore } from "@/stores/index";

import Headers from "./header.vue";
import Setting from "./setting.vue";
import { popupProvinceRegions, popupCityRegions } from "./index/bottom.map";

type RegionPopupData = {
  name?: string;
  climate?: string;
  level?: string;
  area?: string;
};

type RegionDirectoryItem = {
  province: string;
  city: string;
  station_code: string;
  start_time: string;
  end_time: string;
  total_count: number;
};

type ExperimentQuerySummary = {
  province: string;
  city: string;
  stationCode: string;
  startDate: string;
  endDate: string;
  rowCount: number;
  dataCoverageStart: string;
  dataCoverageEnd: string;
};

type ExperimentRequestSummary = {
  experimentType: string;
  targetDays: number;
};

type ExperimentTypeOption = {
  label: string;
  value: "rain_solar" | "snow_freeze_thaw";
};

type ExperimentResponseData = {
  query: ExperimentQuerySummary;
  request: ExperimentRequestSummary;
  plan: Record<string, any> | null;
  hardwareSteps: Array<Record<string, any>>;
};

const BACKEND_BASE_URL = "http://localhost:3000";
const DEFAULT_EXPERIMENT_TYPE: ExperimentTypeOption["value"] = "rain_solar";

const settingStore = useSettingStore();
const { isScale } = storeToRefs(settingStore);
const wrapperStyle = {};

const showInfo = ref(false);
const loading = ref(false);
const regionLoading = ref(false);
const popupRef = ref<HTMLElement | null>(null);
const resultTableRef = ref<any>(null);

const currentRegion = ref<RegionPopupData>({});
const availableRegions = ref<RegionDirectoryItem[]>([]);
const selectedStationCode = ref("");
const dataTimeRange = ref<[string, string] | []>([]);
const experimentType = ref<ExperimentTypeOption["value"]>(DEFAULT_EXPERIMENT_TYPE);
const targetDays = ref(10);
const simulationResult = ref<ExperimentResponseData | null>(null);

const experimentTypeOptions: ExperimentTypeOption[] = [
  { label: "降雨-日照耦合实验", value: "rain_solar" },
  { label: "降雪-冻融耦合实验", value: "snow_freeze_thaw" },
];

const regionNameCandidates = computed(() => {
  const climate = currentRegion.value.climate;
  const level = currentRegion.value.level;
  const area = currentRegion.value.area;
  const name = currentRegion.value.name;

  if (!climate || !area) {
    return availableRegions.value.map((item) => item.city);
  }

  if (area === "bottom_map") {
    return popupProvinceRegions[climate] || [];
  }

  if (area === "center_map") {
    if (level === "province") {
      return popupCityRegions[climate]?.[name?.slice(0, 2) || ""] || [];
    }
    if (level === "city") {
      return name ? [name] : [];
    }
  }

  return [];
});

const regionOptions = computed(() => {
  const candidates = new Set(regionNameCandidates.value);
  if (!candidates.size) {
    return availableRegions.value;
  }

  return availableRegions.value.filter((item) => {
    return candidates.has(item.city) || candidates.has(item.province);
  });
});

const selectedRegionMeta = computed(() => {
  return regionOptions.value.find((item) => item.station_code === selectedStationCode.value) || null;
});

const tableColumns = computed(() => {
  const firstRow = simulationResult.value?.hardwareSteps?.[0];
  return firstRow ? Object.keys(firstRow) : [];
});

const popupLeft = ref(125);
const popupTop = ref(55);
let dragging = false;
let offsetX = 0;
let offsetY = 0;
let popupResizeObserver: ResizeObserver | null = null;
let tableLayoutFrameId: number | null = null;

function scheduleResultTableLayout() {
  if (tableLayoutFrameId !== null) {
    window.cancelAnimationFrame(tableLayoutFrameId);
  }

  tableLayoutFrameId = window.requestAnimationFrame(async () => {
    tableLayoutFrameId = null;
    await nextTick();
    resultTableRef.value?.doLayout?.();
  });
}

function stopObservingPopupResize() {
  if (popupResizeObserver) {
    popupResizeObserver.disconnect();
    popupResizeObserver = null;
  }

  if (tableLayoutFrameId !== null) {
    window.cancelAnimationFrame(tableLayoutFrameId);
    tableLayoutFrameId = null;
  }
}

function observePopupResize() {
  if (!popupRef.value || popupResizeObserver) {
    return;
  }

  popupResizeObserver = new ResizeObserver(() => {
    scheduleResultTableLayout();
  });
  popupResizeObserver.observe(popupRef.value);
}

function startDrag(event: MouseEvent) {
  if (!popupRef.value) return;
  dragging = true;
  offsetX = event.clientX - popupLeft.value;
  offsetY = event.clientY - popupTop.value;
  document.addEventListener("mousemove", onDrag);
  document.addEventListener("mouseup", stopDrag);
}

function onDrag(event: MouseEvent) {
  if (!dragging) return;
  popupLeft.value = event.clientX - offsetX;
  popupTop.value = event.clientY - offsetY;
}

function stopDrag() {
  dragging = false;
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
}

onBeforeUnmount(() => {
  document.removeEventListener("mousemove", onDrag);
  document.removeEventListener("mouseup", stopDrag);
  window.removeEventListener("resize", scheduleResultTableLayout);
  stopObservingPopupResize();
});

function getDefaultDateRange(region: RegionDirectoryItem): [string, string] {
  const minDate = dayjs(region.start_time);
  const maxDate = dayjs(region.end_time);
  const latestOneYearStart = maxDate.subtract(364, "day");
  const startDate = latestOneYearStart.isAfter(minDate) ? latestOneYearStart : minDate;

  return [
    startDate.format("YYYY-MM-DD"),
    maxDate.format("YYYY-MM-DD"),
  ];
}

async function loadAvailableRegions() {
  regionLoading.value = true;
  try {
    const response = await axios.get(`${BACKEND_BASE_URL}/experiment/regions`);
    if (response.data.code !== 0) {
      throw new Error(response.data.msg || "获取地区失败");
    }
    availableRegions.value = response.data.data || [];
  } catch (error: any) {
    ElMessage.error(error?.message || "获取地区失败");
  } finally {
    regionLoading.value = false;
  }
}

function resetFormState() {
  selectedStationCode.value = "";
  dataTimeRange.value = [];
  experimentType.value = DEFAULT_EXPERIMENT_TYPE;
  targetDays.value = 10;
  simulationResult.value = null;
}

async function showRegionPopup(regionData: RegionPopupData) {
  currentRegion.value = regionData || {};
  resetFormState();

  if (!showInfo.value) {
    popupLeft.value = 125;
    popupTop.value = 55;
  }

  showInfo.value = true;

  if (!availableRegions.value.length) {
    await loadAvailableRegions();
  }
}

function closeRegionPopup() {
  showInfo.value = false;
  stopObservingPopupResize();
}

function clearSelection() {
  simulationResult.value = null;
  experimentType.value = DEFAULT_EXPERIMENT_TYPE;
  targetDays.value = 10;

  if (selectedRegionMeta.value) {
    dataTimeRange.value = getDefaultDateRange(selectedRegionMeta.value);
  } else {
    selectedStationCode.value = "";
    dataTimeRange.value = [];
  }
}

function normalizeFileSegment(value: string) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "_");
}

function csvEscape(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function buildResultFileName() {
  const result = simulationResult.value;
  if (!result) {
    return "equivalence_plan.csv";
  }

  const city = normalizeFileSegment(result.query.city || "region");
  const startDate = normalizeFileSegment(result.query.startDate || "start");
  const endDate = normalizeFileSegment(result.query.endDate || "end");
  const experimentTypeLabel = normalizeFileSegment(result.request.experimentType || "plan");

  return `${city}_${experimentTypeLabel}_${startDate}_${endDate}.csv`;
}

function downloadSimulationResult() {
  const result = simulationResult.value;
  if (!result || !result.hardwareSteps.length) {
    ElMessage.warning("当前还没有可下载的等效方案表格");
    return;
  }

  const columns = tableColumns.value;
  const header = columns.map((column) => csvEscape(column)).join(",");
  const rows = result.hardwareSteps.map((row) =>
    columns.map((column) => csvEscape(row[column])).join(",")
  );
  const csvText = [`\ufeff${header}`, ...rows].join("\r\n");
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = objectUrl;
  link.download = buildResultFileName();
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(objectUrl);

  ElMessage.success("等效方案表格已开始下载");
}

async function handleStartSimulate() {
  const region = selectedRegionMeta.value;
  const [startDate, endDate] = dataTimeRange.value;

  if (!region) {
    ElMessage.warning("请先选择待模拟地区");
    return;
  }

  if (!startDate || !endDate) {
    ElMessage.warning("请先选择自然气候时间窗口");
    return;
  }

  loading.value = true;
  simulationResult.value = null;

  try {
    const response = await axios.post(`${BACKEND_BASE_URL}/experiment/run`, {
      city: region.city,
      stationCode: region.station_code,
      startDate,
      endDate,
      experimentType: experimentType.value,
      targetDays: targetDays.value,
    });

    if (response.data.code !== 0) {
      throw new Error(response.data.msg || "等效方案计算失败");
    }

    simulationResult.value = response.data.data;
    ElMessage.success("等效方案计算完成");
  } catch (error: any) {
    ElMessage.error(error?.message || "等效方案计算失败");
  } finally {
    loading.value = false;
  }
}

watch(
  () => regionOptions.value,
  (options) => {
    if (!showInfo.value) return;

    if (!options.length) {
      selectedStationCode.value = "";
      dataTimeRange.value = [];
      return;
    }

    const hasCurrentSelection = options.some((item) => item.station_code === selectedStationCode.value);
    if (hasCurrentSelection) {
      return;
    }

    const matchedByMap = options.find((item) => {
      return item.city === currentRegion.value.name || item.province === currentRegion.value.name;
    });
    selectedStationCode.value = (matchedByMap || options[0]).station_code;
  },
  { immediate: true }
);

watch(selectedStationCode, () => {
  simulationResult.value = null;
  if (selectedRegionMeta.value) {
    dataTimeRange.value = getDefaultDateRange(selectedRegionMeta.value);
  } else {
    dataTimeRange.value = [];
  }
});

watch(
  showInfo,
  (visible) => {
    if (!visible) {
      stopObservingPopupResize();
      return;
    }

    nextTick(() => {
      observePopupResize();
      scheduleResultTableLayout();
    });
  },
  { flush: "post" }
);

watch(
  () => simulationResult.value?.hardwareSteps.length || 0,
  (rowCount) => {
    if (showInfo.value && rowCount > 0) {
      scheduleResultTableLayout();
    }
  },
  { flush: "post" }
);

onMounted(() => {
  loadAvailableRegions();
  window.addEventListener("resize", scheduleResultTableLayout);
});
</script>

<template>
  <scale-screen
    width="1920"
    height="1080"
    :delay="500"
    :fullScreen="false"
    :boxStyle="{
      background: `url('/src/assets/img/background1.png') center center / cover no-repeat`,
      overflow: isScale ? 'hidden' : 'auto',
    }"
    :wrapperStyle="wrapperStyle"
    :autoScale="isScale"
  >
    <div class="content_wrap">
      <Headers />
      <RouterView @showRegionPopup="showRegionPopup" />
      <MessageContent />
    </div>

    <Teleport to="body">
      <div
        v-if="showInfo"
        ref="popupRef"
        class="popup"
        :style="{ left: `${popupLeft}px`, top: `${popupTop}px` }"
      >
        <div class="popup-header" @mousedown="startDrag">
          <span class="popup-title">等效方案计算设置</span>
          <span class="popup-close" @click="closeRegionPopup">×</span>
        </div>

        <div class="popup-upper">
          <div class="config-grid">
            <div class="config-item">
              <span class="label">待模拟地区</span>
              <el-select
                v-model="selectedStationCode"
                :loading="regionLoading"
                placeholder="请选择地区"
                style="width: 100%"
                filterable
              >
                <el-option
                  v-for="item in regionOptions"
                  :key="item.station_code"
                  :label="item.province === item.city ? item.city : `${item.province} / ${item.city}`"
                  :value="item.station_code"
                />
              </el-select>
              <div v-if="selectedRegionMeta" class="hint-line">
                数据覆盖范围：{{ selectedRegionMeta.start_time }} 至 {{ selectedRegionMeta.end_time }}
              </div>
              <div v-else class="hint-line warning-text">
                当前双击区域暂无可用气候数据
              </div>
            </div>

            <div class="config-item">
              <span class="label">自然气候时间窗口</span>
              <el-date-picker
                v-model="dataTimeRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                value-format="YYYY-MM-DD"
                format="YYYY-MM-DD"
                style="width: 100%"
              />
              <div class="hint-line">
                默认使用该地区最近一年的可用数据窗口，你也可以手动调整。
              </div>
            </div>

            <div class="config-item">
              <span class="label">实验类型</span>
              <el-select
                v-model="experimentType"
                placeholder="请选择实验类型"
                style="width: 100%"
              >
                <el-option
                  v-for="item in experimentTypeOptions"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </div>

            <div class="config-item">
              <span class="label">目标实验室时长</span>
              <div class="duration-row">
                <el-input-number
                  v-model="targetDays"
                  :min="1"
                  :max="365"
                  :step="1"
                  step-strictly
                  style="width: 180px"
                />
                <span class="duration-unit">天</span>
              </div>
              <div class="hint-line">
                先以“天”为第一版时长单位，后续可以再扩展成更细粒度。
              </div>
            </div>
          </div>
        </div>

        <div class="popup-middle">
          <template v-if="loading">
            <div class="loading-spinner">
              <div class="spinner"></div>
              <div class="loading-text">正在生成等效方案，请稍候...</div>
            </div>
          </template>

          <template v-else-if="simulationResult">
            <div class="result-wrap">
              <div class="result-summary">
                <div class="summary-card">
                  <span class="summary-label">地区</span>
                  <strong>{{ simulationResult.query.province }} / {{ simulationResult.query.city }}</strong>
                </div>
                <div class="summary-card">
                  <span class="summary-label">数据窗口</span>
                  <strong>{{ simulationResult.query.startDate }} 至 {{ simulationResult.query.endDate }}</strong>
                </div>
                <div class="summary-card">
                  <span class="summary-label">原始记录数</span>
                  <strong>{{ simulationResult.query.rowCount }}</strong>
                </div>
                <div class="summary-card">
                  <span class="summary-label">实验类型</span>
                  <strong>{{ simulationResult.request.experimentType }}</strong>
                </div>
                <div class="summary-card">
                  <span class="summary-label">目标时长</span>
                  <strong>{{ simulationResult.request.targetDays }} 天</strong>
                </div>
                <div class="summary-card">
                  <span class="summary-label">表格行数</span>
                  <strong>{{ simulationResult.hardwareSteps.length }}</strong>
                </div>
              </div>

              <div v-if="simulationResult.hardwareSteps.length" class="result-table">
                <div class="result-toolbar">
                  <el-button size="small" type="primary" plain @click="downloadSimulationResult">
                    下载当前表格
                  </el-button>
                </div>
                <el-table
                  ref="resultTableRef"
                  class="result-data-table"
                  :data="simulationResult.hardwareSteps"
                  border
                  stripe
                  height="100%"
                  size="small"
                >
                  <el-table-column
                    v-for="column in tableColumns"
                    :key="column"
                    :prop="column"
                    :label="column"
                    min-width="140"
                    show-overflow-tooltip
                  />
                </el-table>
              </div>

              <div v-else class="placeholder">
                当前方案已计算完成，但暂时没有可展示的表格数据。
              </div>
            </div>
          </template>

          <template v-else>
            <div class="placeholder">
              双击地图区域后，选择地区与时间窗口，即可在这里看到等效方案表格。
            </div>
          </template>
        </div>

        <div class="popup-lower">
          <el-button class="action-btn" @click="clearSelection">重置</el-button>
          <el-button
            type="primary"
            class="action-btn"
            :loading="loading"
            :disabled="!selectedRegionMeta || !dataTimeRange.length"
            @click="handleStartSimulate"
          >
            开始计算
          </el-button>
        </div>
      </div>
    </Teleport>
  </scale-screen>

  <Setting />
</template>

<style lang="scss" scoped>
.content_wrap {
  width: 100%;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.popup {
  position: fixed;
  width: min(88vw, 980px);
  min-width: 760px;
  min-height: 720px;
  max-height: 86vh;
  background: rgba(255, 251, 246, 0.98);
  color: #2d210f;
  border: 1px solid rgba(160, 112, 48, 0.28);
  border-radius: 18px;
  z-index: 100;
  box-shadow: 0 18px 50px rgba(45, 27, 5, 0.22);
  display: flex;
  flex-direction: column;
  resize: both;
  overflow: hidden;
  backdrop-filter: blur(10px);
}

.popup-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  background: linear-gradient(90deg, rgba(250, 235, 214, 0.98), rgba(255, 247, 236, 0.98));
  border-bottom: 1px solid rgba(188, 144, 79, 0.18);
  cursor: move;
  user-select: none;
}

.popup-title {
  font-size: 24px;
  font-weight: 700;
  color: #9c5a1f;
  letter-spacing: 1px;
}

.popup-close {
  font-size: 30px;
  color: #9c5a1f;
  cursor: pointer;
  transition: color 0.2s ease;
}

.popup-close:hover {
  color: #d0511d;
}

.popup-upper {
  padding: 20px 24px 16px;
  border-bottom: 1px solid rgba(188, 144, 79, 0.14);
  background: rgba(255, 250, 243, 0.88);
}

.config-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px 20px;
}

.config-item {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 14px;
  font-weight: 700;
  color: #7a4a16;
}

.hint-line {
  min-height: 20px;
  font-size: 12px;
  color: #87663a;
  line-height: 1.6;
}

.warning-text {
  color: #bf5b2b;
}

.duration-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.duration-unit {
  font-size: 14px;
  color: #7a4a16;
}

.popup-middle {
  flex: 1;
  min-height: 0;
  padding: 18px 24px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.96), rgba(255, 248, 239, 0.96));
}

.result-wrap {
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-summary {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.summary-card {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(247, 236, 217, 0.9);
  border: 1px solid rgba(186, 143, 83, 0.16);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-label {
  font-size: 12px;
  color: #8d6a40;
}

.summary-card strong {
  font-size: 14px;
  color: #4f3415;
  line-height: 1.5;
}

.result-table {
  flex: 1;
  min-height: 260px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.result-toolbar {
  display: flex;
  justify-content: flex-end;
  align-items: center;
}

.result-data-table {
  flex: 1;
  min-height: 0;
}

.placeholder {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: #8c7354;
  font-size: 14px;
  line-height: 1.8;
  padding: 24px;
  border: 1px dashed rgba(186, 143, 83, 0.28);
  border-radius: 16px;
  background: rgba(252, 247, 240, 0.9);
}

.popup-lower {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  padding: 14px 24px 18px;
  border-top: 1px solid rgba(188, 144, 79, 0.14);
  background: rgba(255, 252, 248, 0.96);
}

.action-btn {
  min-width: 112px;
}

.loading-spinner {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #8b662f;
}

.spinner {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  border: 4px solid rgba(210, 154, 79, 0.2);
  border-top-color: #c4741f;
  animation: spin 0.9s linear infinite;
}

.loading-text {
  margin-top: 14px;
  font-size: 14px;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 980px) {
  .popup {
    min-width: 92vw;
    width: 92vw;
    min-height: 80vh;
  }

  .config-grid {
    grid-template-columns: 1fr;
  }

  .result-summary {
    grid-template-columns: 1fr;
  }
}
</style>
