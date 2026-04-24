<script setup lang="ts">

import { ref, onBeforeUnmount, watch, computed } from "vue";
import { RouterView } from "vue-router";
import ScaleScreen from "@/components/scale-screen";
import Headers from "./header.vue";
import Setting from "./setting.vue";
import { useSettingStore } from "@/stores/index";
import { storeToRefs } from "pinia";
import MessageContent from "@/components/Plugins/MessageContent";
import { ElSelect, ElOption } from "element-plus";
import { popupProvinceRegions, popupCityRegions, countyCities, antiqueTypeList } from "./index/bottom.map";
import axios from "axios";

const settingStore = useSettingStore();
const { isScale } = storeToRefs(settingStore);
const wrapperStyle = {};

const simulationResult = ref(null); // 保存后端返回的数据
const loading = ref(false);

// 判断当前点击的交互弹窗的地区是province还是city
const regionOptions = computed(() => {
  const climate = currentRegion.value.climate;
  const level = currentRegion.value.level;
  const area = currentRegion.value.area;
  const name = currentRegion.value.name;

  if (!climate || !area) return [];

  // 先判断来源区域 bottom_map：按气候片区显示省
  if (area === "bottom_map") {
    return popupProvinceRegions[climate] || [];
  }

  // 再判断 center_map 下的层级 (center_map：再按 level 细分)
  if (area === "center_map") {
    // 点的是省 -> 弹窗显示该气候片区下的城市列表
    if (level === "province") {
      return popupCityRegions[climate]?.[name.slice(0,2)] || [];
    }
    // 点的是城市 -> 弹窗只显示当前城市自己
    if (level === "city") {
      return name ? [name] : [];
    }
  }
  return [];
});

// 环境因子类型（弹窗）
const envFactorMap: Record<string, string[]> = {
  "气温": ["max_temperature", "min_temperature", "avg_temperature"],
  "降水": ["precipitation"],
  "降雨": ["rain_sum"],
  "降雪": ["snow_sum"],
  "风速": ["max_continuous_wind_speed"],
  "太阳辐照": ["shortwave_radiation_sum"],
};

const regionNameMap: Record<string, string> = {
  "北京": "beijing",
  "天津": "tianjin",
  "河北": "hebei",
  "山东": "shandong",
  "辽宁": "liaoning",
  "吉林": "jilin",
  "黑龙江": "heilongjiang",
  "山西": "shan1xi",
  "陕西": "shan3xi",
  "河南": "henan",
  "内蒙古": "neimenggu",
  "宁夏": "ningxia",
  "甘肃": "gansu",
  "新疆": "xinjiang",
  "青海": "qinghai",
  "西藏": "xizang",
  "江苏": "jiangsu",
  "四川": "sichuan",
  "台湾": "taiwan",
  "福建": "fujian",
  "上海": "shanghai",
  "浙江": "zhejiang",
  "安徽": "anhui",
  "江西": "jiangxi",
  "湖南": "hunan",
  "湖北": "hubei",
  "重庆": "chongqing",
  "贵州": "guizhou",
  "广东": "guangdong",
  "广西": "guangxi",
  "澳门": "aomen",
  "云南": "yunnan",
  "香港": "xianggang"
}

const envFactorList = Object.keys(envFactorMap);
const experimentTypeOptions = ["降雨-日照耦合实验", "降雪-冻融耦合实验"];

// 弹窗设计
const showInfo = ref(false);
const currentRegion = ref({});
const popupLeft = ref(125);  // 弹窗初始位置
const popupTop = ref(55);  // 弹窗初始位置

let dragging = false;
let offsetX = 0;
let offsetY = 0;
const popupRef = ref<HTMLElement | null>(null);

const showRegionPopup = (regionData: any) => {
  console.log("===== 弹窗页面收到 =====");
  console.log("regionData =", regionData);
  console.log("climate =", regionData.climate);
  console.log("popupProvinceRegions", popupProvinceRegions[regionData.climate]);
  currentRegion.value = regionData;

  // 每次切换区域，清空已选内容
  expLocation.value = [];
  dataTimeRange.value = [new Date(), new Date()];
  simulateTimeYear.value = [];
  simulateTimeMonth.value = [];
  expTimeMonth.value = [];
  expTimeDay.value = [];
  envFactor.value = [];
  experimentType.value = "降雨-日照耦合实验";
  simulationResult.value = null;
  
  if (!showInfo.value) {
    popupLeft.value = 125;  // 弹窗初始位置
    popupTop.value = 55;    // 弹窗初始位置
  }
  showInfo.value = true;
  // console.log("climateRegions: ", popupRegions[currentRegion.value.climate]);
  // console.log("currentRegions: ", currentRegion.value.climate);
};

const closeRegionPopup = () => {
  showInfo.value = false;
};

const startDrag = (e: MouseEvent) => {
  if (!popupRef.value) return;
  dragging = true;
  offsetX = e.clientX - popupLeft.value;
  offsetY = e.clientY - popupTop.value;
  document.addEventListener('mousemove', onDrag);
  document.addEventListener('mouseup', stopDrag);
};
const onDrag = (e: MouseEvent) => {
  if (!dragging) return;
  popupLeft.value = e.clientX - offsetX;
  popupTop.value = e.clientY - offsetY;
};
const stopDrag = () => {
  dragging = false;
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
};
onBeforeUnmount(() => {
  document.removeEventListener('mousemove', onDrag);
  document.removeEventListener('mouseup', stopDrag);
});

// 弹窗内容
const expLocation = ref<string[]>([]);
const expTimeMonth = ref(); 
const expTimeDay = ref();  
const dataTimeRange = ref<[Date, Date]>([new Date(), new Date()]);
const simulateTimeYear = ref(); 
const simulateTimeMonth = ref();   
const envFactor = ref<string[]>([]); 
const experimentType = ref<string>("降雨-日照耦合实验");

const handleRegionChange = (val: string[]) => {
  const regionList = regionOptions.value;
  // console.log("regionList = ", regionList);
  // console.log("expLocation before = ", expLocation.value.length);
  // 修改区域选择
  if (val.includes("ALL_REGIONS")) {
    if(expLocation.value.length < regionList.length){
      expLocation.value = [ ...regionList];
    } else {
      expLocation.value = [];
    }
  } 
};

const handleEnvFactorChange = (val: string[]) => {
  const allList = [...envFactorList];
  // console.log("regionList = ", allList);
  // console.log("envFactor before = ", envFactor.value.length);
  // 修改区域选择
  if (val.includes("ALL_ENV")) {
    if(envFactor.value.length < allList.length){
      envFactor.value = [ ...allList];
    } else {
      envFactor.value = [];
    }
  } 
};

// 控制按钮的高亮和禁用
const isClearButtonActive = ref(false);
const isStartButtonActive = ref(false);

// 清空选择
const clearSelection = () => {
  expLocation.value = [];
  envFactor.value = [];
  dataTimeRange.value = [new Date(), new Date()];
  expTimeDay.value = [];
  expTimeMonth.value = [];
  simulateTimeMonth.value = [];
  simulateTimeYear.value = [];
  experimentType.value = "降雨-日照耦合实验";
  simulationResult.value = null;
};

const handleStartSimulate = async () => {

  loading.value = true; // 开始加载

  const envFactorsForParams = Array.from(new Set(
    envFactor.value.flatMap(item => envFactorMap[item] || [])
  ));

  const regionsForParams = expLocation.value.map(name => regionNameMap[name] || name);

  const params = {
    regions: regionsForParams,
    dataRange: dataTimeRange.value,
    simulateYear: simulateTimeYear.value,
    simulateMonth: simulateTimeMonth.value,
    expMonth: expTimeMonth.value,
    expDay: expTimeDay.value,
    envFactors: envFactorsForParams,
    experimentType: experimentType.value
  };

  try {
    // 替换成你的后端API地址
    console.log("params = ", params);
    const resp = await axios.post('http://localhost:3000/experiment/run', params);

    // 后端会返回预测结果
    const result = resp.data;

    if(result.code === 0) {
      simulationResult.value = result.data; // 保存数据
    }

    // 这里可以在页面上展示结果
    console.log("预测结果：", result);
  } catch (e) {
    // 错误处理
    console.error("实验模拟失败", e);
  }
  loading.value = false; // 结束加载
};

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
      <!-- 监听 showRegionPopup 事件 -->
      <RouterView @showRegionPopup="showRegionPopup" />
      <MessageContent />
    </div>

    <!-- 弹窗统一渲染到这里 -->
    <Teleport to="body">
      <div 
        v-if="showInfo" 
        class="popup"
        ref="popupRef"
        :style="{ left: popupLeft + 'px', top: popupTop + 'px' }"
      >
        <div class="popup-header" @mousedown="startDrag">
          <span class="popup-title">劣化模拟实验设置</span>
          <span class="popup-close" @click="closeRegionPopup">×</span>
        </div>
        <div class="popup-upper">
          <div class="config-row">
            <span class="label">实验地区：</span>
            <el-select 
              v-model="expLocation" 
              multiple
              style="width: 230px;"
              placeholder="选项"
              filterable
              collapse-tags
              @change="handleRegionChange"
            >
              <el-option
                label="全选"
                :value="'ALL_REGIONS'"
                :key="'ALL_REGIONS'"
              />
              <el-option
                v-for="region in regionOptions"
                :key="region"
                :label="region"
                :value="region"
              />
            </el-select>
          </div>

          <div class="config-row">
            <span class="label">数据时间：</span>
            <div style="width: 230px">
              <el-date-picker
                v-model="dataTimeRange"
                type="daterange"
                range-separator="至"
                start-placeholder="开始日期"
                end-placeholder="结束日期"
                format="YYYY-MM-DD"
                value-format="YYYY-MM-DD"
                style="width: 100%;" 
              />
            </div>
          </div>

          <div class="config-row">
            <span class="label">模拟时间：</span>
            <el-select v-model="simulateTimeYear" placeholder="年数" style="width: 111px; margin-right: 8px;">
              <el-option
                v-for="num in 120"
                :key="num"
                :value="num"
                :label="num + ' 年'"
              />
            </el-select>
            <el-select v-model="simulateTimeMonth" placeholder="月数" style="width: 111px;">
              <el-option
                v-for="num in 11"
                :key="num"
                :value="num"
                :label="num + ' 月'"
              />
            </el-select>
          </div>

          <div class="config-row">
            <span class="label">实验时间：</span>
            <el-select v-model="expTimeMonth" placeholder="月数" style="width: 111px; margin-right: 8px;">
              <el-option
                v-for="num in 120"
                :key="num"
                :value="num"
                :label="num + ' 月'"
              />
            </el-select>
            <el-select v-model="expTimeDay" placeholder="天数" style="width: 111px;">
              <el-option
                v-for="num in 29"
                :key="num"
                :value="num"
                :label="num + ' 天'"
              />
            </el-select>
          </div>

          <div class="config-row">
            <span class="label">环境因子：</span>
            <el-select
              v-model="envFactor"
              multiple
              style="width: 230px;"
              placeholder="选项"
              filterable
              collapse-tags
              @change="handleEnvFactorChange"
            >
              <el-option
                label="全选"
                :value="'ALL_ENV'"
                :key="'ALL_ENV'"
              />
              <el-option
                v-for="item in envFactorList"
                :key="item"
                :label="item"
                :value="item"
              />
            </el-select>
          </div>

          <div class="config-row">
            <span class="label">实验类型：</span>
            <el-select v-model="experimentType" style="width: 230px;" placeholder="选项">
              <el-option
                v-for="item in experimentTypeOptions"
                :key="item"
                :label="item"
                :value="item"
              />
            </el-select>
          </div>

        </div>
        <div class="popup-middle">
          <template v-if="loading">
            <div class="loading-spinner">
              <div class="spinner"></div>
              <div style="margin-top:10px;color:#b67e2b;">正在计算，请稍候…</div>
            </div>
          </template>
          <template v-else-if="simulationResult">
            <div class="scheme-card">
              <div v-if="simulationResult.season_flags.冬季舱">
                <strong class="capsule-line">冬季舱</strong>
                <div class="factor-line">温度等级：{{ simulationResult.winter_detail.温度等级 }}（时长：{{ simulationResult.winter_detail.温度时长 }}小时）</div>
                <div class="factor-line">降雪等级：{{ simulationResult.winter_detail.降雪等级 }}（时长：{{ simulationResult.winter_detail.降雪时长 }}小时）</div>
                <div class="factor-line">日照等级：{{ simulationResult.winter_detail.日照等级 }}（时长：{{ simulationResult.winter_detail.日照时长 }}小时）</div>
              </div>
              <div v-if="simulationResult.season_flags.夏季舱">
                <strong class="capsule-line">夏季舱</strong>
                <div class="factor-line">温度等级：{{ simulationResult.summer_detail.温度等级 }}（时长：{{ simulationResult.summer_detail.温度时长 }}小时）</div>
                <div class="factor-line">日照等级：{{ simulationResult.summer_detail.日照等级 }}（时长：{{ simulationResult.summer_detail.日照时长 }}小时）</div>
              </div>
              <div v-if="simulationResult.season_flags.风雨舱">
                <strong class="capsule-line">风雨舱</strong>
                <div class="factor-line">温度等级：{{ simulationResult.windrain_detail.温度等级 }}（时长：{{ simulationResult.windrain_detail.温度时长 }}小时）</div>
                <div class="factor-line">降雨等级：{{ simulationResult.windrain_detail.降雨等级 }}（时长：{{ simulationResult.windrain_detail.降雨时长 }}小时）</div>
                <div class="factor-line">风速等级：{{ simulationResult.windrain_detail.风速等级 }}（时长：{{ simulationResult.windrain_detail.刮风时长 }}小时）</div>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="placeholder">（模拟方案展示）</div>
          </template>
        </div>
      <div class="popup-lower">
        <el-button 
          type="primary" 
          class="start-btn"
          :disabled="isStartButtonActive"
          @click="handleStartSimulate"
          >开始模拟
        </el-button>
        <el-button 
          type="primary" 
          class="clear-btn"
          :disabled="isClearButtonActive"
          @click="clearSelection"
          >清空
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
  padding: 16px 16px 16px 16px;
  box-sizing: border-box;
}

.popup {
  position: fixed;
  min-width: 350px;
  min-height: 601px;
  background: #fff;
  color: #000;
  border: 1px solid #333;
  border-radius: 10px;
  z-index: 100;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18);
  display: flex;
  flex-direction: column;
  resize: both;
  overflow: auto;
}

.popup-header {
  height: 50px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 18px;
  background: #f6f6f6;
  border-bottom: 1px solid #eee;
  cursor: move;            // 鼠标为可拖拽
  user-select: none;
}

.popup-title {
  font-size: 23px;
  font-weight: bold;
  color: #b16a36;        
}

.popup-close {
  font-size: 28px;
  font-weight: bold;
  height: 45px;
  color: #b16a36;
  cursor: pointer;
  transition: color 0.2s;
}

.popup-close:hover {
  color: #d64620;
}

/* 内容区弹性排布 */
.popup-upper {
  padding-top: 20px;
  padding-right: 20px;
  padding-left: 5px;
  display: flex;
  font-size: 12px;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
}

.popup-middle {
  border-top: 1px solid #f1ece7;
  min-height: 240px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ffffff;
  color: #888;
}

.popup-lower {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px 0 10px 0;
  border-top: 1px solid #f1ece7;
  background: #ffffff;
}

.config-row {
  width: 100%;
  display: flex;
  align-items: center;
  margin-bottom: 20px;
  min-height: 30px;
}

.label {
  min-width: 100px;
  color: #6b4300;
  font-size: 17px;
  font-weight: 500;
  margin-right: 15px;
  text-align: right;
}

.start-btn {
  font-size: 16px;
  padding: 18px 40px;
  margin-top: 5px;
  margin-bottom: 5px;
  margin-right: 15px;
  border-radius: 6px;
  font-weight: 500;
  letter-spacing: 3px;
  background-color: #e54d42; // 明亮的红色
  color: #fff;               // 白色字体
  border: none;              // 移除默认边框（可选）
  box-shadow: 0 2px 10px rgba(229,77,66,0.08); // 可选，增加质感
  transition: background 0.2s;
}

.clear-btn {
  font-size: 16px;
  padding: 18px 40px;
  margin-top: 5px;
  margin-bottom: 5px;
  border-radius: 6px;
  font-weight: 500;
  letter-spacing: 3px;
  background-color: #a19e9d; // 明亮的红色
  color: #fff;               // 白色字体
  border: none;              // 移除默认边框（可选）
  box-shadow: 0 2px 10px rgba(229,77,66,0.08); // 可选，增加质感
  transition: background 0.2s;
}

.start-btn:hover {
  background-color: #b33427; // 深一点的红色（悬停效果）
}

// 模拟实验结果展示设计
.scheme-card {
  display: flex;
  flex-direction: column;
  justify-content: center;
  background: #ffffff;
  width: 100%;
  color: #5e412f;
  font-size: 15px;
}
.scheme-card h3 {
  // margin-bottom: 10px;
  color: #c95d3c;
}
.factor-line {
  margin-left: 10px;
  margin-bottom: 3px;
  line-height: 1.6;
}
.capsule-line {
  margin-left: 10px;
}
strong {
  font-size: 17px;
  color: #6b4300;
  margin-top: 5px;
  display: block;
}

// loading 加载设计
.loading-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100px;
}

.spinner {
  border: 6px solid #f3e3c0;
  border-top: 6px solid #b67e2b;  // 沙漠金色
  border-radius: 50%;
  width: 46px;
  height: 46px;
  animation: spin 1.1s linear infinite;
  margin-bottom: 8px;
}

@keyframes spin {
  0% { transform: rotate(0deg);}
  100% { transform: rotate(360deg);}
}

</style>
