<template>
  <div class="box">
    <div style="text-align: center">
      <!-- 用于上传文件的封装组件，文件大小限制2MB，最多6个文件 -->
      <upFile ref="upFile" :fileList="fileList" listType="text" :size="2" :limit="6"></upFile>

      <!-- 按钮1：点击后打开"选择数据格式"弹窗，根据id判读那两种可能性 -->
      <!-- <el-button v-loading="addLoading" :type="id?'danger':'primary'" style="margin-top: 20px" @click="savePage">{{id?'修改文件':'保存上传'}}</el-button> -->
      <el-button 
        v-loading="addLoading" 
        :type="id ? 'danger' : 'primary'" 
        style="margin-top: 20px; margin-bottom: 25px;"
        @click="openDataVisible">{{ id ? '修改数据格式' : '选择数据格式' }}
      </el-button>
      <!-- <el-button @click="openDialogVisible" type="success">弹窗上传</el-button> -->
    </div>

    <!-- 按钮2：打开"弹窗上传"窗口 -->
    <!-- <el-button @click="defaultEvent" type="info">回复默认设置</el-button> -->
    <!-- <el-button @click="openDialogVisible" type="success">弹窗上传</el-button> -->
    
    <!-- 文件列表上传的表格展示，每个column都是一列 -->
    <div class="table-card">
      <el-table :data="list" v-loading="loading">
        <el-table-column label="编号" align="center" width="50" prop="id" />

        <!-- imgEvent用来提取每一行的文件数据，el-link展示文件名，点击后在新窗口下载 -->
        <el-table-column label="文件（点击下载）" align="center" prop="val" width="550">
          <template slot-scope="scope">
            <div v-for="t in imgEvent(scope.row)" :key="t.id">
              <el-link type="primary" target="_blank" :href="t.url">{{ t.originalname }}</el-link>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" align="center" prop="updateTime" width="265"/>

        <el-table-column label="创建时间" align="center" prop="createTime" width="265"/>

        <!-- 操作按钮组 -->
        <el-table-column label="操作" align="center" width="300">
          <template slot-scope="scope">
            <el-button size="mini" @click="handleEdit(scope.row)">编辑</el-button>
            <el-button size="mini" type="primary" @click="handleDialogEdit(scope.row)">弹窗编辑</el-button>
            <el-button size="mini" type="danger" @click="handleDelete(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 分页组件：传入当前页码、每页页数、总条数等 -->
      <pagination 
          v-show="total > 0" 
          :total="total" 
          :page.sync="queryParams.page" 
          :limit.sync="queryParams.size"
          @pagination="getFile" 
          style="margin-top: 0px; padding: 12px 0px 0px 10px;"
      />
    </div>


    <!-- "弹窗上传"功能，弹窗内容框架 -->
    <el-dialog title="上传文件" :visible.sync="dialogVisible" width="50%" style="text-align: center">
      <upFile ref="upFileDialog" :fileList="fileListDialog" listType="text" :size="2" :limit="6"></upFile>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button :type="id ? 'danger' : 'primary'" @click="saveDialog"
          v-loading="addLoading">{{ id ? '修改文件' : '保存上传' }}</el-button>
      </span>
    </el-dialog>

    <!-- "选择数据格式"弹窗设计 -->
    <el-dialog :visible.sync="e_dataVisible" width="65%" :show-close="false">
      <!-- <upFile ref="upFileDialog" :fileList="fileListDialog" listType="text" :size="2" :limit="6"></upFile> -->
      <!-- <el-cascader :options="options" :show-all-levels="false" /> -->

      <template #title>
        <div style="display: flex; align-items: center; width: 100%; position: relative;">
          <div style="flex: 1;"></div>
          <div style="flex: none; font-size: 22px; text-align: center; white-space: nowrap;">
            选择格式与量纲
          </div>
          <div style="flex: 1; display: flex; justify-content: flex-end;">
            <el-button
              size="mini"
              type="success"
              @click="autoMatchFormat"
              style="font-size: 13.5px; height: 29px; margin-right: 25px;"
            >
              智能匹配
            </el-button>
          </div>
          <!-- 打叉按钮设计 -->
          <button
            @click="e_dataVisible = false"
            style="
              background: transparent;
              border: none;
              cursor: pointer;
              outline: none;
              font-size: 22px;
              color: #909399;
              margin-left: 0px;
              transition: color 0.18s;
            "
            @mouseover="e => e.target.style.color='#e54d42'"
            @mouseleave="e => e.target.style.color='#909399'"
            aria-label="关闭"
          >&#10005;
          </button>
        </div>
      </template>

      <!-- 根据文件列数动态生成表单项，对每列设置数据格式 -->
      <div style="display: flex; justify-content: center;">
        <el-form v-if="columnsCount > 1" label-width="300px" label-position="left">
            <el-form-item
              v-for="index in columnsCount"
              :key="index"
              :label="'第 ' + index + ' 列 : ' + headerLabels[index - 1]"
            >
              <!-- 设置 gutter 为 10，表示列间距为 10px -->
              <el-row :gutter="20" style="width: 100%">
                <!-- 左边字段类型 -->
                <el-col :span="11">
                  <el-cascader
                    v-model="value[index - 1]"
                    :options="options"
                    :props="{ expandTrigger: 'hover' }"
                    @change="(val) => handleChange(val, index - 1)"
                    style="width: 100%;"
                  />
                </el-col>

                <!-- 右边单位选择 -->
                <el-col :span="11">
                  <el-select
                    v-model="unitSelections[index - 1]"
                    placeholder="选择单位"
                    clearable
                    style="width: 100%"
                  >
                    <el-option
                      v-for="item in getUnitOptions(value[index - 1])"
                      :key="item.value"
                      :label="item.label"
                      :value="item.value"
                    />
                  </el-select>
                </el-col>
              </el-row>
            </el-form-item>
            
            <div style="width: 100%; display: flex; flex-direction: column; align-items: center;">
              <!-- 预览区域 -->
              <div style="font-weight: bold;">
                <el-table
                  :data="previewData"
                  size="mini"
                  border
                  :header-cell-style="{ background: '#f8f8f9', fontWeight: 600 }"
                  max-height="270"
                >
                  <el-table-column
                    v-for="(header, idx) in previewHeadersComputed"
                    :key="idx"
                    :label="header"
                  >
                    <template slot-scope="scope">
                      {{ scope.row[idx] }}
                    </template>
                  </el-table-column>
                </el-table>
              </div>

              <el-form-item style="margin-top: 15px; margin-right: 25%;">
                <el-button type="primary" @click="savePage">文件上传</el-button>
                <el-button @click="e_dataVisible = false ;value=[]">取消</el-button>
              </el-form-item>
            </div>
          </el-form>
      </div>

      <!-- <span slot="footer" class="dialog-footer">
      <el-button @click="dialogVisible = false">取 消</el-button>
      <el-button :type="id?'danger':'primary'" @click="saveDialog" v-loading="addLoading">{{id?'修改文件':'保存上传'}}</el-button>
      </span> -->
    </el-dialog>
  </div>
</template>


<script>
import upFile from "@/components/upFile";
import { addFile, getFile, upFileReq, delFile,addFiledata } from "@/api/components";

export default {
  name: "File",
  data() {
    return {
      list: [],  // 当前页面展示的文件数据列表
      loading: false,  // 控制el-table的加载动画
      addLoading: false,
      total: 0,  // 总数居条数
      queryParams: {  // 分页参数，包含当前页码和每页条数
        size: 10,
        page: 1
      },
      fileList: [],  // 页面中展示的上传文件列表
      fileListDialog: [],  // 弹窗中的上传文件列表
      id: undefined,  // 当前编辑的文件ID，有id表示"编辑"状态，而不是"新增"状态
      dialogVisible: false,  // 是否显示上传文件的弹窗
      e_dataVisible: false,  // 是否显示“选择数据格式”的弹窗
      columnsCount: 0,  // 当前上传的文件总列数
      inputValues: [],  // 用户在“选择数据格式”时，为每一列选择的值数组
      value: [],  // 用于绑定el-cascader的值
      unitSelections: [],  
      headerLabels: [],  // 上传文件中的表头名称，用于生成“第几列：列名”的提示
      previewHeaders: [], // 数据预览区的表头
      previewData: [],    // 数据预览区的行内容
      options: [   // 传给el-cascader组件的字段定义列表，让用户选择每列数据的含义
        {
          value: 'station_code',
          label: '气象站代码',
        },
        {
          value: 'date',
          label: '日期',
          children: [  // children是二级选项
            {
              value: 'date_year',
              label: '年',
            },
            {
              value: 'date_month',
              label: '月',
            },
            {
              value: 'date_day',
              label: '日',
            },
            {
              value: 'year_month',
              label: '年月',
            },
            {
              value: 'year_month_day',
              label: '年月日',
            },

          ],
        },
        {
          value: 'latitude',
          label: '纬度',
        },
        {
          value: 'longitude',
          label: '经度',
        },
        {
          value: 'station_elevation',
          label: '气象站高程',
        },
        {
          value: 'station_name',
          label: '气象站名称',
        },
        {
          value: 'avg_temperature',
          label: '平均气温',
        },
        {
          value: 'avg_temperature_attribute',
          label: '平均气温属性',
        },
        {
          value: 'avg_dew_point',
          label: '平均露点',
        },
        {
          value: 'avg_dew_point_attribute',
          label: '平均露点属性',
        },
        {
          value: 'avg_sea_level_pressure',
          label: '平均海平面压强',
        },
        {
          value: 'avg_sea_level_pressure_attribute',
          label: '平均海平面压强属性',
        },
        {
          value: 'avg_station_pressure',
          label: '平均观测站压强',
        },
        {
          value: 'avg_station_pressure_attribute',
          label: '平均观测站压强属性',
        },
        {
          value: 'avg_visibility',
          label: '平均能见度',
        },
        {
          value: 'avg_visibility_attribute',
          label: '平均能见度属性',
        },
        {
          value: 'avg_wind_speed',
          label: '平均风速',
        },
        {
          value: 'avg_wind_speed_attribute',
          label: '平均风速属性',
        },
        {
          value: 'max_continuous_wind_speed',
          label: '最大持续风速',
        },
        {
          value: 'max_continuous_wind_speed_attribute',
          label: '最大持续风速属性',
        },
        {
          value: 'windgusts_max',
          label: '最大阵风',
        },
        {
          value: 'winddirection_dominant',
          label: '主导风向',
        },
        {
          value: 'max_temperature',
          label: '最高气温',
        },
        {
          value: 'max_temperature_attribute',
          label: '最高气温属性',
        },
        {
          value: 'min_temperature',
          label: '最低气温',
        },
        {
          value: 'min_temperature_attribute',
          label: '最低气温属性',
        },
        {
          value: 'precipitation',
          label: '降水量',
        },
        {
          value: 'precipitation_attribute',
          label: '降水量属性',
        },
        {
          value: 'rain_sum',
          label: '降雨量',
        },
        {
          value: 'snow_sum',
          label: '降雪量',
        },
        {
          value: 'indicator',
          label: '指示器',
        },
        {
          value: 'shortwave_radiation_sum',
          label: '太阳辐照',
        },
      ]
    }
  },

  // 初始化文件列表和分页信息
  created() {
    this.getFile();
  },

  computed: {
    // 预览表头 = 你选择的格式名 + 量纲
    previewHeadersComputed() {
      return this.headerLabels.map((header, idx) => {
        const field = this.value[idx]?.length
          ? this.options.find(opt => opt.value === this.value[idx][0])?.label || header
          : header;
        const unit = this.unitSelections[idx]
          ? this.getUnitOptions(this.value[idx]).find(item => item.value === this.unitSelections[idx])?.label
          : '';
        return unit && unit !== '无单位' ? `${field} (${unit}) ` : field;
      });
    }
  },

  methods: {
    // 用户在"选择数据格式"弹窗的操作，将用户选择的字段值存入inputValues数组中
    handleChange(val, index) {
      const unitOptions = this.getUnitOptions(val);
      // 不管之前选没选过，格式一改就直接用新格式的第一个量纲
      if (unitOptions.length) {
        this.$set(this.unitSelections, index, unitOptions[0].value);
      }
    },

    // 调试用而已，打印用户输入后关闭弹窗
    onSubmit() {
      // console.log(this.inputValues);
      this.e_dataVisible = false;
    },

    // 通过API获取文件数据并设置表格和分页总数
    async getFile() {
      let { data, total } = await getFile(this.queryParams);
      this.list = data;
      this.total = total;
    },

    // 处理页面上传并提交前的数据验证
    savePage() {
      //获取了文件组件结果
      let list = this.$refs.upFile.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      // 检查是否有空值
      if (this.inputValues.some(v => v === '')) {
        console.log("look here = ", this.inputValues);
        return this.$message.error('请填写所有数据格式！');
      }
      list[0].inputValues = this.inputValues;
      list[0].unitValues = this.unitSelections;
      this.save(list);
      this.inputValues = [];
      this.value = [];
      this.unitSelections = [];
      this.e_dataVisible = false;
    },

    // 处理弹窗中的上传文件
    saveDialog() {
      let list = this.$refs.upFileDialog.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      this.save(list);
    },

    // 保存上传（，最后更新文件列表，重置状态，清除上传缓存）
    async save(list) {
      try {
        let { id } = this;
        this.addLoading = true;  // 启动上传按钮上的加载动画，避免用户重复点击

        // 如果有id则是编辑行为调用upFIleReq，否则是新增行为调用addFile和addFileData
        //  id是要更新的数据编号，val是上传的文件数据，type 2表示文件类型
        id && await upFileReq({ val: JSON.stringify(list), id })
        !id && await addFile({ type: 2, val: JSON.stringify(list) });
        !id && await addFiledata({ type: 2, val: JSON.stringify(list) });

        this.addLoading = false; // 停止加载动画
        this.id = undefined;  // 重置编辑状态为新增
        this.getFile();  // 重新获取文件列表
        this.$message.success(id ? "修改成功" : "保存成功！"); // 这里判断的原本的id，不是this.id
        this.$refs.upFile.clearFiles();  // 清空上传组件中的文件

        //如果是弹窗上传，清空弹窗状态
        if (this.dialogVisible) {
          this.$refs.upFileDialog.clearFiles();
          this.dialogVisible = false;
        }
      } catch (e) {  // 异常处理
        this.addLoading = false;
      }
    },

    // 确认后执行文件删除，并刷新列表
    handleDelete(row) {
      // console.log(row);
      this.$confirm('此操作将永久删除该文件, 是否继续?', '提示', {
        confirmButtonText: '确定',
        cancelButtonText: '取消',
        type: 'error'
      }).then(async () => {
        await delFile(row);
        this.getFile();
        this.$message.success("删除成功！");
      })
    },

    // 打开上传弹窗并重置状态
    openDialogVisible() {
      this.dialogVisible = true;
      this.id = undefined;
      this.$nextTick(() => {
        this.$refs.upFileDialog.clearFiles();
      })
    },

    // 打开"选择数据格式"弹窗，从上传组件中获取列数和表头，用于生成格式设置表单项
    openDataVisible() {
      let list = this.$refs.upFile.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      this.value = [];
      this.e_dataVisible = true;
      this.columnsCount = this.$refs.upFile.get_columnsCount();
      this.headerLabels = this.$refs.upFile.get_headers();
      this.inputValues = new Array(this.columnsCount).fill('');
      // console.log(this.inputValues)
      this.previewHeaders = this.headerLabels.slice(); // 拷贝一份
      this.previewData = this.$refs.upFile.get_preview(); // 例如前10行的二维数组
      console.log("previewData = ", this.previewData);
    },

    // 页面修改
    handleEdit(row) {
      //回显文件
      this.$set(this, "fileList", this.imgEvent(row));
      this.id = row.id;
    },

    // 弹窗修改
    handleDialogEdit(row) {
      this.dialogVisible = true;
      this.$nextTick(() => {
        this.$set(this, "fileListDialog", this.imgEvent(row));
        this.id = row.id;
      });
    },

    // 重置页面上传状态，清楚当前选择的文件和ID
    defaultEvent() {
      this.id = undefined;
      this.$refs.upFile.clearFiles();
    },

    // 解析数据库中存储的val内容，回显上传文件内容
    imgEvent(row) {
      try {
        return JSON.parse(row.val)
      } catch (e) {
        return []
      }
    },

    getUnitOptions(typePath) {
      if (!typePath || !typePath.length) return [];
      const main = typePath[typePath.length - 1];  // 不直接设置0是因为date有孩子节点，否则只能拿到date

      const unitMap = {
        station_code: [{ label: "无单位", value: "none" }],
        station_name: [{ label: "无单位", value: "none" }],
        station_elevation: [
          { label: "m", value: "m" },
          { label: "ft", value: "ft" }
        ],
        // date: [{ label: "无单位", value: "none" }],
        date_year: [{ label: "年", value: "year" }],
        date_month: [{ label: "月", value: "month" }],
        date_day: [{ label: "日", value: "day" }],
        year_month: [{ label: "年月", value: "year_month" }],
        year_month_day: [{ label: "年月日", value: "year_month_day" }],
        latitude: [
          { label: "°", value: "degree" }
        ],
        longitude: [
          { label: "°", value: "degree" }
        ],

        avg_temperature: [
          { label: "°C", value: "C" },
          { label: "°F", value: "F" }
        ],
        avg_temperature_attribute: [{ label: "无单位", value: "none" }],

        avg_dew_point: [
          { label: "°C", value: "C" },
          { label: "°F", value: "F" }
        ],
        avg_dew_point_attribute: [{ label: "无单位", value: "none" }],

        avg_sea_level_pressure: [
          { label: "hPa", value: "hPa" },
          { label: "kPa", value: "kPa" }
        ],
        avg_sea_level_pressure_attribute: [{ label: "无单位", value: "none" }],

        avg_station_pressure: [
          { label: "hPa", value: "hPa" },
          { label: "kPa", value: "kPa" }
        ],
        avg_station_pressure_attribute: [{ label: "无单位", value: "none" }],

        avg_visibility: [
          { label: "m", value: "m" },
          { label: "km", value: "km" }
        ],
        avg_visibility_attribute: [{ label: "无单位", value: "none" }],

        avg_wind_speed: [
          { label: "m/s", value: "m/s" },
          { label: "km/h", value: "km/h" }
        ],
        avg_wind_speed_attribute: [{ label: "无单位", value: "none" }],

        max_continuous_wind_speed: [
          { label: "km/h", value: "km/h" },
          { label: "m/s", value: "m/s" }
          
        ],
        max_continuous_wind_speed_attribute: [{ label: "无单位", value: "none" }],

        windgusts_max: [
          { label: "m/s", value: "m/s" },
          { label: "km/h", value: "km/h" }
        ],

        winddirection_dominant: [
          { label: "°", value: "°" }
        ],

        max_temperature: [
          { label: "°C", value: "C" },
          { label: "°F", value: "F" }
        ],

        max_temperature_attribute: [{ label: "无单位", value: "none" }],

        min_temperature: [
          { label: "°C", value: "C" },
          { label: "°F", value: "F" }
        ],

        min_temperature_attribute: [{ label: "无单位", value: "none" }],

        precipitation: [
          { label: "mm", value: "mm" },  
          { label: "cm", value: "cm" } 
        ],
        
        precipitation_attribute: [{ label: "无单位", value: "none" }],

        rain_sum: [
          { label: "mm", value: "mm" },  
          { label: "cm", value: "cm" } 
        ],

        snow_sum: [
        { label: "cm", value: "cm" },  
        { label: "mm", value: "mm" }          
        ],

        shortwave_radiation_sum: [
          { label: "MJ/m²", value: "MJ/m²" },
          { label: "W/m²", value: "W/m²" }
        ],

        indicator: [{ label: "无单位", value: "none" }]
      };
      // console.log("unitMap[main]", unitMap[main]);
      return unitMap[main] || [{ label: "无单位", value: "none" }];
    },

    // 自动正则匹配
    autoMatchFormat() {
      // 遍历每个表头，自动填充字段类型和值
      this.headerLabels.forEach((header, idx) => {
        
        // 字段类型正则
        let matchedType = null;
        let matchedUnit = null;

        const h = header.toLowerCase();  // 先全部转小写，方便匹配
        // console.log("h content = ", h);

        // 字段推断
        if (/station.*code/.test(h)) matchedType = ['station_code'];
        else if (/name|place/.test(h)) matchedType = ['station_name'];
        else if (/lat/.test(h)) matchedType = ['latitude'];
        else if (/lon|lng/.test(h)) matchedType = ['longitude'];
        else if (/elev/.test(h)) matchedType = ['station_elevation'];

        else if (/date|time|day|year|month/.test(h)) {
          // 细分年月日
          if (/year/.test(h) && /month/.test(h) && /day/.test(h)) matchedType = ['date', 'year_month_day'];
          else if (/year/.test(h) && /month/.test(h)) matchedType = ['date', 'year_month'];
          else if (/year/.test(h)) matchedType = ['date', 'date_year'];
          else if (/month/.test(h)) matchedType = ['date', 'date_month'];
          else if (/day/.test(h)) matchedType = ['date', 'date_day'];
          else matchedType = ['date', 'year_month_day'];  // 默认情况下都是年月日
        }

        // 温度相关
        else if (/tmp|temp|temperature/.test(h)) {
          if (/min|minimum/.test(h)) matchedType = ['min_temperature'];
          else if (/max|maximum/.test(h)) matchedType = ['max_temperature'];
          else matchedType = ['avg_temperature'];
        }

        // 露点
        else if (/dew/.test(h)) matchedType = ['avg_dew_point'];

        // 气压
        else if (/pressure|sea/i.test(h) && /sea/.test(h)) matchedType = ['avg_sea_level_pressure'];
        else if (/pressure|station/.test(h)) matchedType = ['avg_station_pressure'];
        
        // 风速
        else if (/wind.*speed/.test(h)) {
          if (/max|cont/.test(h)) matchedType = ['max_continuous_wind_speed'];
          else matchedType = ['avg_wind_speed'];
        }

        // 阵风
        else if (/wind.*gusts/.test(h)) {
          if (/max|cont/.test(h)) matchedType = ['windgusts_max'];
        }

        // 主导风向
        else if (/wind.*direction/.test(h)) {
          if (/dominant/.test(h)) matchedType = ['winddirection_dominant'];
        }

        // 能见度
        else if (/visibility/.test(h)) matchedType = ['avg_visibility'];

        // 降水
        else if (/precip/.test(h)) matchedType = ['precipitation'];

        // 降雨
        else if (/rain/.test(h)) matchedType = ['rain_sum'];

        // 积雪
        else if (/snow/.test(h)) matchedType = ['snow_sum'];

        // 其它属性/指示
        else if (/attribute/.test(h)) matchedType = [this.guessAttributeType(this.value[idx])];
        else if (/indicator/.test(h)) matchedType = ['indicator'];
        else if (/shortwave.*radiation/.test(h)) matchedType = ['shortwave_radiation_sum'];

        // 默认
        else matchedType = ['station_code'];

        // ------ 单位推断 ------
        if (/\(°c\)|\(c\)|\(celsius\)/.test(h)) matchedUnit = 'C';
        else if (/\(°f\)|\(f\)|\(fahrenheit\)/.test(h)) matchedUnit = 'F';
        else if (/\(hpa\)/.test(h)) matchedUnit = 'hPa';
        else if (/\(kpa\)/.test(h)) matchedUnit = 'kPa';
        else if (/\(km\/h\)/.test(h)) matchedUnit = 'km/h';
        else if (/\(m\/s\)/.test(h)) matchedUnit = 'm/s';
        else if (/\(mm\)/.test(h)) matchedUnit = 'mm';
        else if (/\(cm\)/.test(h)) matchedUnit = 'cm';
        else if (/\(km\)/.test(h)) matchedUnit = 'km';
        else if (/\(degree\)|\(°C\)/.test(h)) matchedUnit = 'degree';
        else if (/\(m\)/.test(h)) matchedUnit = 'm';
        else if (/\(°\)/.test(h)) matchedUnit = '°';
        else if (/\(mj\/m²\)|\(mj\/m2\)|\(mj\/m\^2\)/i.test(h)) matchedUnit = 'MJ/m²';
        else if (/\(w\/m²\)|\(w\/m2\)|\(w\/m\^2\)/i.test(h)) matchedUnit = 'W/m²';

        // 年月日
        else if (/year/.test(h)) matchedUnit = 'year';
        else if (/month/.test(h)) matchedUnit = 'month';
        else if (/day/.test(h)) matchedUnit = 'day';

        // 表头信息没有指定量纲就使用默认量纲
        const unitOptions = this.getUnitOptions(matchedType);
        if (!matchedUnit && unitOptions.length) matchedUnit = unitOptions[0].value;

        // console.log("matchedType = ", matchedType);
        // console.log("matchedUnit = ", matchedUnit);

        // 设置到选择器
        this.$set(this.value, idx, matchedType);
        this.$set(this.unitSelections, idx, matchedUnit);
        this.$set(this.inputValues, idx, matchedType);   // 需要同时写入inputValues
      });
      this.$message.success("已根据表头自动填充格式与量纲，可人工调整！");
    },
    // 处理“属性”类字段的智能匹配（可自定义扩展）
    guessAttributeType(typeArr) {
      if (!typeArr || !typeArr.length) return 'station_code';
      const last = Array.isArray(typeArr) ? typeArr[typeArr.length - 1] : '';
      return last && last.endsWith('_attribute') ? last : 'station_code';
    }
  },
  components: { upFile }  // 注册自定义上传组件upFile，用于处理文件选择和预处理逻辑
}
</script>




<style scoped lang="scss">
.table-card {
  background: rgba(255,255,255,0.92);
  box-shadow: 0 4px 16px 0 rgba(220, 176, 112, 0.08);
  border-radius: 24px;
  overflow: hidden;
  padding: 2px 25px 15px 25px;
  backdrop-filter: blur(5px);
  border: 4px solid #e5b072;
  position: relative;
  animation: fadein 1s;
}

/* 移除表格和分页之间的间隙 */
.table-card .el-table {
  border-radius: 18px 18px 0 0;
  margin-bottom: 0;
}

/* 让分页器更贴合底部 */
.table-card .table-pagination {
  padding: 18px 0 14px 0;
  background: transparent;
  text-align: right;
}

/* 让分页器四角呼应表格 */
.table-card .table-pagination >>> .el-pagination {
  border-radius: 0 0 18px 18px;
  background: transparent;
}

</style>