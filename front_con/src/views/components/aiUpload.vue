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
          <!-- 表头行选择 -->
          <div style="display:flex; align-items:center; margin-right:12px; font-size:14px; color:#606266;">
            <span style="white-space:nowrap; margin-right:6px;">表头在第</span>
            <el-input-number
              v-model="headerRowIndex"
              :min="1"
              :max="20"
              :step="1"
              size="mini"
              style="width:80px;"
              @change="applyHeaderRow"
            />
            <span style="white-space:nowrap; margin-left:6px;">行</span>
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

              <!-- 站点省市（从已有站点下拉选择，或手动输入新站点）-->
              <el-form-item label="省份 / 城市" style="width: 80%; margin-top: 10px;">
                <el-row :gutter="10">
                  <el-col :span="12">
                    <el-select
                      v-model="stationProvince"
                      placeholder="选择省份"
                      filterable
                      allow-create
                      clearable
                      style="width:100%"
                      @change="onProvinceChange"
                    >
                      <el-option
                        v-for="p in provinceOptions"
                        :key="p"
                        :label="p"
                        :value="p"
                      />
                    </el-select>
                  </el-col>
                  <el-col :span="12">
                    <el-select
                      v-model="stationCity"
                      placeholder="选择城市"
                      filterable
                      allow-create
                      clearable
                      style="width:100%"
                    >
                      <el-option
                        v-for="c in cityOptions"
                        :key="c"
                        :label="c"
                        :value="c"
                      />
                    </el-select>
                  </el-col>
                </el-row>
                <div style="font-size:12px;color:#aaa;margin-top:4px;">
                  已有站点可直接选择；新站点可直接输入
                </div>
              </el-form-item>

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
      stationProvince: '',  // 站点省份
      stationCity: '',      // 站点城市
      provinceOptions: [],  // 省份下拉选项
      cityOptions: [],      // 城市下拉选项（根据省份联动）

      // ── 内置省市表 ────────────────────────────────────────────
      PROVINCE_CITY_MAP: {
        '北京': ['北京'],
        '天津': ['天津'],
        '上海': ['上海'],
        '重庆': ['重庆', '万州', '涪陵', '合川', '江津', '永川', '荣昌', '璧山', '铜梁', '大足', '潼南', '綦江', '南川', '梁平', '丰都', '垫江', '忠县', '开州', '云阳', '奉节', '巫山', '巫溪', '城口', '秀山', '酉阳', '彭水', '黔江', '石柱', '武隆'],
        '河北': ['石家庄', '唐山', '秦皇岛', '邯郸', '邢台', '保定', '张家口', '承德', '沧州', '廊坊', '衡水'],
        '山西': ['太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁'],
        '内蒙古': ['呼和浩特', '包头', '乌海', '赤峰', '通辽', '鄂尔多斯', '呼伦贝尔', '巴彦淖尔', '乌兰察布', '兴安盟', '锡林郭勒盟', '阿拉善盟'],
        '辽宁': ['沈阳', '大连', '鞍山', '抚顺', '本溪', '丹东', '锦州', '营口', '阜新', '辽阳', '盘锦', '铁岭', '朝阳', '葫芦岛'],
        '吉林': ['长春', '吉林', '四平', '辽源', '通化', '白山', '松原', '白城', '延边'],
        '黑龙江': ['哈尔滨', '齐齐哈尔', '鸡西', '鹤岗', '双鸭山', '大庆', '伊春', '佳木斯', '七台河', '牡丹江', '黑河', '绥化', '大兴安岭'],
        '江苏': ['南京', '无锡', '徐州', '常州', '苏州', '南通', '连云港', '淮安', '盐城', '扬州', '镇江', '泰州', '宿迁'],
        '浙江': ['杭州', '宁波', '温州', '嘉兴', '湖州', '绍兴', '金华', '衢州', '舟山', '台州', '丽水'],
        '安徽': ['合肥', '芜湖', '蚌埠', '淮南', '马鞍山', '淮北', '铜陵', '安庆', '黄山', '滁州', '阜阳', '宿州', '六安', '亳州', '池州', '宣城'],
        '福建': ['福州', '厦门', '莆田', '三明', '泉州', '漳州', '南平', '龙岩', '宁德'],
        '江西': ['南昌', '景德镇', '萍乡', '九江', '新余', '鹰潭', '赣州', '吉安', '宜春', '抚州', '上饶'],
        '山东': ['济南', '青岛', '淄博', '枣庄', '东营', '烟台', '潍坊', '济宁', '泰安', '威海', '日照', '临沂', '德州', '聊城', '滨州', '菏泽'],
        '河南': ['郑州', '开封', '洛阳', '平顶山', '安阳', '鹤壁', '新乡', '焦作', '濮阳', '许昌', '漯河', '三门峡', '南阳', '商丘', '信阳', '周口', '驻马店'],
        '湖北': ['武汉', '黄石', '十堰', '宜昌', '襄阳', '鄂州', '荆门', '孝感', '荆州', '黄冈', '咸宁', '随州', '恩施'],
        '湖南': ['长沙', '株洲', '湘潭', '衡阳', '邵阳', '岳阳', '常德', '张家界', '益阳', '郴州', '永州', '怀化', '娄底', '湘西'],
        '广东': ['广州', '深圳', '珠海', '汕头', '佛山', '韶关', '湛江', '肇庆', '江门', '茂名', '惠州', '梅州', '汕尾', '河源', '阳江', '清远', '东莞', '中山', '潮州', '揭州', '云浮'],
        '广西': ['南宁', '柳州', '桂林', '梧州', '北海', '防城港', '钦州', '贵港', '玉林', '百色', '贺州', '河池', '来宾', '崇左'],
        '海南': ['海口', '三亚', '三沙', '儋州', '五指山', '琼海', '文昌', '万宁', '东方', '定安', '屯昌', '澄迈', '临高', '白沙', '昌江', '乐东', '陵水', '保亭', '琼中'],
        '四川': ['成都', '自贡', '攀枝花', '泸州', '德阳', '绵阳', '广元', '遂宁', '内江', '乐山', '南充', '眉山', '宜宾', '广安', '达州', '雅安', '巴中', '资阳', '阿坝', '甘孜', '凉山'],
        '贵州': ['贵阳', '六盘水', '遵义', '安顺', '毕节', '铜仁', '黔西南', '黔东南', '黔南'],
        '云南': ['昆明', '曲靖', '玉溪', '保山', '昭通', '丽江', '普洱', '临沧', '楚雄', '红河', '文山', '西双版纳', '大理', '德宏', '怒江', '迪庆'],
        '西藏': ['拉萨', '日喀则', '昌都', '林芝', '山南', '那曲', '阿里'],
        '陕西': ['西安', '铜川', '宝鸡', '咸阳', '渭南', '延安', '汉中', '榆林', '安康', '商洛'],
        '甘肃': ['兰州', '嘉峪关', '金昌', '白银', '天水', '武威', '张掖', '平凉', '酒泉', '庆阳', '定西', '陇南', '临夏', '甘南', '敦煌'],
        '青海': ['西宁', '海东', '海北', '黄南', '海南', '果洛', '玉树', '海西'],
        '宁夏': ['银川', '石嘴山', '吴忠', '固原', '中卫'],
        '新疆': ['乌鲁木齐', '克拉玛依', '吐鲁番', '哈密', '昌吉', '博尔塔拉', '巴音郭楞', '阿克苏', '克孜勒苏', '喀什', '和田', '伊犁', '塔城', '阿勒泰', '石河子'],
        '台湾': ['台北', '台中', '台南', '高雄', '基隆', '新竹', '嘉义'],
        '香港': ['香港'],
        '澳门': ['澳门'],
      },
      headerRowIndex: 1,    // 表头所在行号（1-based）
      rawPreviewRows: [],   // upFile 返回的原始预览行（二维数组）
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
    this.loadStationOptions();
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
    // 初始化省市数据（静态内置表，覆盖全国省份城市）
    loadStationOptions() {
      this.provinceOptions = Object.keys(this.PROVINCE_CITY_MAP);
    },

    // 省份变化时联动城市
    onProvinceChange(province) {
      this.stationCity = '';
      this.cityOptions = this.PROVINCE_CITY_MAP[province] || [];
    },

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
      list[0].stationProvince = this.stationProvince;
      list[0].stationCity = this.stationCity;
      this.save(list);
      this.inputValues = [];
      this.value = [];
      this.unitSelections = [];
      this.stationProvince = '';
      this.stationCity     = '';
      this.cityOptions     = [];
      this.headerRowIndex  = 1;
      this.rawPreviewRows  = [];
      this.e_dataVisible   = false;
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

    // 打开"选择数据格式"弹窗
    openDataVisible() {
      let list = this.$refs.upFile.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      this.value         = [];
      this.e_dataVisible = true;

      // upFile 把第1行当作内部表头吃掉了，需要把它拼回来
      // rawPreviewRows[0] = 文件第1行（upFile 的内部表头）
      // rawPreviewRows[1+] = 文件第2行起的数据
      const firstRow = this.$refs.upFile.get_headers();  // 文件第1行
      const dataRows = this.$refs.upFile.get_preview();  // 文件第2行起
      this.rawPreviewRows = [firstRow, ...dataRows];

      // 自动检测表头行（英文+中文关键词扫描）
      this.headerRowIndex = this.detectHeaderRow(this.rawPreviewRows);

      // 根据检测结果初始化表头和预览
      this.applyHeaderRow(this.headerRowIndex);
    },

    // 根据 headerRowIndex 更新 headerLabels / columnsCount / previewData
    applyHeaderRow(rowIdx) {
      const rows = this.rawPreviewRows;
      if (!rows || !rows.length) return;
      const idx = rowIdx - 1; // 转为 0-based
      if (idx < 0 || idx >= rows.length) return;
      this.headerLabels   = rows[idx].map(v => String(v ?? ''));
      this.columnsCount   = this.headerLabels.length;
      this.inputValues    = new Array(this.columnsCount).fill('');
      this.value          = [];
      this.unitSelections = [];
      this.previewData    = rows.slice(idx + 1, idx + 11);
      this.previewHeaders = this.headerLabels.slice();
    },

    // 自动检测：找包含最多气象关键词的行（英文+中文）
    detectHeaderRow(rows) {
      if (!rows || !rows.length) return 1;
      const en = ['time','date','temp','precip','rain','snow','wind','radiation',
                  'gust','direction','windspeed','winddirection','windgusts','shortwave'];
      const zh = ['时间','日期','气温','温度','降水','降雨','降雪','风速','辐射','阵风','风向'];
      let bestRow = 0, bestScore = -1;
      const limit = Math.min(rows.length, 10);
      for (let i = 0; i < limit; i++) {
        const score = rows[i].reduce((s, cell) => {
          const c = String(cell ?? '').toLowerCase();
          return s + en.filter(k => c.includes(k)).length
                   + zh.filter(k => c.includes(k)).length;
        }, 0);
        if (score > bestScore) { bestScore = score; bestRow = i; }
      }
      return bestRow + 1; // 转回 1-based
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

    // 自动正则匹配（英文 + 中文双轨）
    autoMatchFormat() {
      this.headerLabels.forEach((header, idx) => {
        let matchedType = null;
        let matchedUnit = null;

        const h  = header.toLowerCase();  // 英文匹配（转小写）
        const zh = header;                // 中文匹配（保留原始）

        // ── 字段推断（优先级从高到低）────────────────────────

        // 时间（含 time/date/year/month/day 及中文）
        if (/date|time|day|year|month/.test(h) || /时间|日期|年月日|采集时间/.test(zh)) {
          if (/year/.test(h) && /month/.test(h) && /day/.test(h)) matchedType = ['date', 'year_month_day'];
          else if (/year/.test(h) && /month/.test(h))             matchedType = ['date', 'year_month'];
          else if (/year/.test(h))                                 matchedType = ['date', 'date_year'];
          else if (/month/.test(h))                                matchedType = ['date', 'date_month'];
          else if (/day/.test(h))                                  matchedType = ['date', 'date_day'];
          else                                                     matchedType = ['date', 'year_month_day'];
        }

        // 降水量（precip 优先，避免被 rain 匹配）
        else if (/precip/.test(h) || /降水量|降水/.test(zh)) {
          matchedType = ['precipitation'];
        }

        // 降雨量
        else if (/rain/.test(h) || /降雨/.test(zh)) {
          matchedType = ['rain_sum'];
        }

        // 降雪量
        else if (/snow/.test(h) || /降雪|积雪/.test(zh)) {
          matchedType = ['snow_sum'];
        }

        // 阵风（gust 优先于 wind，避免被风速拦截）
        else if (/gust/.test(h) || /阵风/.test(zh)) {
          matchedType = ['windgusts_max'];
        }

        // 风向（direction 优先于 windspeed）
        else if (/direction/.test(h) || /风向/.test(zh)) {
          matchedType = ['winddirection_dominant'];
        }

        // 风速（windspeed / windspeed_10m / wind_speed 等）
        else if (/wind/.test(h) || /风速/.test(zh)) {
          matchedType = ['max_continuous_wind_speed'];
        }

        // 短波辐射
        else if (/shortwave|radiation/.test(h) || /辐射|日照/.test(zh)) {
          matchedType = ['shortwave_radiation_sum'];
        }

        // 温度（放在风/辐射之后，避免误匹配）
        else if (/tmp|temp|temperature/.test(h) || /气温|温度/.test(zh)) {
          matchedType = ['avg_temperature'];
        }

        // 露点
        else if (/dew/.test(h) || /露点/.test(zh)) {
          matchedType = ['avg_dew_point'];
        }

        // 气压
        else if (/sea.*pressure|pressure.*sea/.test(h)) {
          matchedType = ['avg_sea_level_pressure'];
        }
        else if (/pressure/.test(h) || /气压/.test(zh)) {
          matchedType = ['avg_station_pressure'];
        }

        // 能见度
        else if (/visibility/.test(h) || /能见度/.test(zh)) {
          matchedType = ['avg_visibility'];
        }

        // 站点编码
        else if (/station.*code|site.*id/.test(h) || /站点编码|气象编码/.test(zh)) {
          matchedType = ['station_code'];
        }

        // 站点名称
        else if (/name|place/.test(h) || /站点名|站名/.test(zh)) {
          matchedType = ['station_name'];
        }

        // 纬度/经度/高程
        else if (/lat/.test(h) || /纬度/.test(zh))              matchedType = ['latitude'];
        else if (/lon|lng/.test(h) || /经度/.test(zh))          matchedType = ['longitude'];
        else if (/elev/.test(h) || /高程|海拔/.test(zh))        matchedType = ['station_elevation'];

        // 属性/指示器
        else if (/attribute/.test(h))   matchedType = [this.guessAttributeType(this.value[idx])];
        else if (/indicator/.test(h))   matchedType = ['indicator'];

        // 默认忽略
        else matchedType = ['indicator'];

        // ── 单位推断（括号内单位优先）──────────────────────
        if      (/\(°c\)|\(celsius\)/.test(h) || /°c/.test(h))  matchedUnit = 'C';
        else if (/\(°f\)|\(fahrenheit\)/.test(h))                matchedUnit = 'F';
        else if (/\(hpa\)/.test(h))                              matchedUnit = 'hPa';
        else if (/\(kpa\)/.test(h))                              matchedUnit = 'kPa';
        else if (/\(km\/h\)/.test(h))                            matchedUnit = 'km/h';
        else if (/\(m\/s\)/.test(h) || /m\/s/.test(h))          matchedUnit = 'm/s';
        else if (/\(mm\)/.test(h))                               matchedUnit = 'mm';
        else if (/\(cm\)/.test(h))                               matchedUnit = 'cm';
        else if (/\(km\)/.test(h))                               matchedUnit = 'km';
        else if (/\(m\)/.test(h))                                matchedUnit = 'm';
        else if (/\(°\)/.test(h))                                matchedUnit = '°';
        else if (/\(w\/m.?2\)|\(w\/m²\)/i.test(h))              matchedUnit = 'W/m²';
        else if (/\(mj\/m.?2\)|\(mj\/m²\)/i.test(h))            matchedUnit = 'MJ/m²';

        // 无括号单位时用默认值
        const unitOptions = this.getUnitOptions(matchedType);
        if (!matchedUnit && unitOptions.length) matchedUnit = unitOptions[0].value;

        this.$set(this.value,          idx, matchedType);
        this.$set(this.unitSelections, idx, matchedUnit);
        this.$set(this.inputValues,    idx, matchedType);
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