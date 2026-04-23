<template>
  <div class="download-bg">
    <div class="download-card animate-fadein">
      <div class="download-title">
        <span>数据库下载</span>
      </div>
      <el-form class="download-form">
        <!-- 选择地区 -->
        <el-form-item label="选择地区" class="download-label">
          <el-select
            v-model="selectedRegions"
            multiple
            placeholder="请选择地区"
            style="width:360px; margin-top: 10px; margin-bottom: 10px;"
            filterable
            collapse-tags
            @change="handleRegionChange"
          >
            <el-option label="全选" value="__ALL_REGIONS__" key="__ALL_REGIONS__" />
            <el-option
              v-for="opt in regionOptions"
              :key="opt.city"
              :label="opt.province + ' · ' + opt.city + '  (' + opt.total_count + '条)'"
              :value="opt.city"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="选择特征" class="download-label">
          <el-select
            v-model="selectedFields"
            multiple
            placeholder="请选择需要下载的特征"
            style="width:360px; margin-bottom: 10px;"
            filterable
            collapse-tags
            @change="handleFieldsChange"
          >
            <el-option
              key="__ALL__"
              label="全选"
              value="__ALL__"
              :disabled="fields.length === 0"
            />
            <el-option
              v-for="item in fields"
              :key="item"
              :label="fieldMap[item] || item"
              :value="item"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="起止时间" class="download-label">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            range-separator="至"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            format="yyyy-MM-dd"
            value-format="yyyy-MM-dd"
            class="date-picker"
            style="width: 360px; margin-bottom: 10px;"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="loading"
            :disabled="loading || !canDownload"
            class="download-btn"
            @click="downloadData"
          >下载数据</el-button>
          <el-button
            type="default"
            :class="{'clear-btn-active': !isClearButtonDisabled}"
            class="clear-btn"
            :disabled="isClearButtonDisabled"
            @click="clearSelections"
          >清空</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script>
import axios from 'axios';
export default {
  data() {
    return {

      fields: [
        "record_time", "station_code", "avg_temperature",
        "precipitation", "rain_sum", "snow_sum", "max_continuous_wind_speed", "windgusts_max",
        "winddirection_dominant", "shortwave_radiation_sum"
      ],

      // 字段中文名
      fieldMap: {
        record_time: "采集时间",
        station_code: "气象编码",
        avg_temperature: "平均气温 (°C)",
        precipitation: "降水量 (mm)",
        rain_sum: "降雨量 (mm)",
        snow_sum: "降雪量 (mm)",
        max_continuous_wind_speed: "风速 (m/s)",
        windgusts_max: "阵风风速 (m/s)",
        winddirection_dominant: "主导风向 (°)",
        shortwave_radiation_sum: "短波辐射 (W/m²)"
      },

      // 地区列表从 weather_directory 动态加载
      regionOptions: [],  // [{ city, province, station_code, start_time, end_time, total_count }]
      selectedFields: [],
      selectedRegions: [],
      dateRange: [],
      loading: false,
      isClearButtonDisabled: true  // 清空按钮的状态
    }
  },
  created() {
    this.loadRegions();
  },

  computed: {
    // 判断是否可以下载
    canDownload() {
      return (
        this.selectedFields.length > 0 &&
        Array.isArray(this.dateRange) &&
        this.dateRange.length === 2 &&
        this.selectedRegions.length > 0
      )
    }
  },
  methods: {
    // 动态加载地区列表
    async loadRegions() {
      try {
        const res = await axios.get('http://localhost:3000/weather/generalDownload/regions');
        this.regionOptions = res.data.data || [];
      } catch {
        this.$message.error('地区列表加载失败，请检查后端服务');
      }
    },

    // 处理全选和普通多选
    handleRegionChange(val) {
      if (val.includes("__ALL_REGIONS__")) {
        const allCities = this.regionOptions.map(o => o.city);
        this.selectedRegions = this.selectedRegions.length < allCities.length
          ? allCities
          : [];
      }
    },
    handleFieldsChange(val) {
      // 如果刚刚点击了“全选”
      if (val.includes("__ALL__")) {
        // 只要不是所有都已选，就全选所有
        if (this.selectedFields.length < this.fields.length) {
          this.selectedFields = this.fields.slice() // 新数组
        } else {
          // 如果本来就是全选，再点“全选”则全部清空
          this.selectedFields = []
        }
      } else {
        // 普通多选场景：如果用户取消了某个选项，要确保“全选”不会自动勾上
        // （此处不需要特别处理，el-select不会自动勾“全选”，只有我们加上才会）
      }
    },
    // 清空所有选择的地区、特征和时间
    clearSelections() {
      this.selectedRegions = [];
      this.selectedFields = [];
      this.dateRange = [];
    },
    // 下载数据，按城市逐个请求
    async downloadData() {
      if (!this.canDownload) return;
      this.loading = true;

      try {
        for (let city of this.selectedRegions) {
          const res = await axios.post(
            'http://localhost:3000/weather/generalDownload',
            {
              city,
              fields: this.selectedFields,
              start:  this.dateRange[0],
              end:    this.dateRange[1],
            },
            { responseType: 'blob' }
          );

          const blob = new Blob([res.data], {
            type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          });
          const url = window.URL.createObjectURL(blob);
          const a   = document.createElement('a');
          a.href     = url;
          a.download = `${city}_${this.dateRange[0]}_${this.dateRange[1]}.xlsx`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }
        this.$message.success('下载完成');
      } catch (err) {
        this.$message.error('下载失败，请检查网络或参数');
      }

      this.loading = false;
    }
  },
  watch: {
    selectedRegions(newVal) {
      this.isClearButtonDisabled = !(newVal.length || this.selectedFields.length || this.dateRange.length);
    },
    selectedFields(newVal, oldVal) {
      // 同样的检查逻辑
      this.isClearButtonDisabled = !(newVal.length || this.selectedRegions.length || this.dateRange.length);
    },
    dateRange(newVal, oldVal) {
      // 同样的检查逻辑
      this.isClearButtonDisabled = !(newVal.length || this.selectedRegions.length || this.selectedFields.length);
    }
  }
}
</script>

<style scoped lang="scss">
.download-bg {
  height: 85vh;
  width: 88vw;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.download-card {
  width: 60%;
  max-width: 600px;
  min-width: 330px;
  margin: 0 auto;
  background: rgba(255,255,255,0.92);
  box-shadow: 0 4px 16px 0 rgba(220, 176, 112, 0.08);
  border-radius: 24px;
  overflow: hidden;
  padding: 30px 38px 8px 38px;
  backdrop-filter: blur(5px);
  border: 4px solid #e5b072;
  position: relative;
  animation: fadein 1s;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.download-title {
  font-size: 28px;
  font-weight: 700;
  color: #a95b23;
  text-align: center;
  margin-bottom: 24px;
  letter-spacing: 2px;
  text-shadow: 0 2px 10px #fbe4be60;
  width: 100%;
}

.download-form {
  width: 100%;
  text-align: center;
}

.el-form-item {
  display: flex;
  flex-direction: row;
  align-items: center;
  margin-bottom: 26px;
  width: 100%;
  justify-content: center;
}

.date-picker {
  min-width: 230px;
  margin: 0 auto;
}

.download-btn,
.clear-btn {
  min-width: 130px;
  font-size: 17px;
  height: 38px;
  border-radius: 12px;
  background: linear-gradient(88deg, #fcc273 0%, #ffc799 80%);
  border: none;
  color: #753d10;
  box-shadow: 0 2px 12px #ffedc0a0;
  transition: all 0.15s;
  margin: 0 10px;
}

.clear-btn {
  background: #ede2d2;
  color: #b39e7c;
}

.clear-btn-active {
  background: #f3a647;
  color: #fff;
}

.download-btn:active,
.download-btn:focus,
.clear-btn:active,
.clear-btn:focus {
  background: linear-gradient(90deg, #f3a647 0%, #fdcd8f 100%);
  color: #5d320a;
}

.download-btn[disabled],
.clear-btn[disabled] {
  background: #ede2d2;
  color: #b39e7c;
  cursor: not-allowed;
  border: none;
}

.animate-fadein {
  animation: fadein 1.1s cubic-bezier(.36, .07, .19, .97) both;
}
@keyframes fadein {
  0% {
    opacity: 0;
    transform: translateY(35px) scale(0.98);
  }
  100% {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>