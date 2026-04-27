<template>
  <div class="box">
    <div style="text-align: center">
      <upFile ref="upFile" :fileList="fileList" listType="text" :size="2" :limit="6"></upFile>
      <!-- <el-button v-loading="addLoading" :type="id?'danger':'primary'" style="margin-top: 20px" @click="savePage">{{id?'修改文件':'保存上传'}}</el-button> -->

      <el-button v-loading="addLoading" :type="id ? 'danger' : 'primary'" style="margin-top: 20px"
        @click="openeDataVisible">{{ id ? '修改数据格式' : '选择数据格式' }}</el-button>
      <!-- <el-button @click="openDialogVisible" type="success">弹窗上传</el-button> -->
    </div>
    <!-- <el-button @click="defaultEvent" type="info">回复默认设置</el-button> -->
    <el-button @click="openDialogVisible" type="success">弹窗上传</el-button>
    
    <el-table :data="list" style="margin-top: 15px" v-loading="loading">
      <el-table-column label="编号" align="center" width="100" prop="id" />
      <el-table-column label="文件（点击下载）" align="center" prop="val" width="500">
        <template slot-scope="scope">
          <div v-for="t in imgEvent(scope.row)" :key="t.id">
            <el-link type="primary" target="_blank" :href="t.url">{{ t.originalname }}</el-link>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="更新时间" align="center" prop="updateTime" />
      <el-table-column label="创建时间" align="center" prop="createTime" />
      <el-table-column label="操作" align="center" width="250">
        <template slot-scope="scope">
          <el-button size="mini" @click="handleEdit(scope.row)">编辑</el-button>
          <el-button size="mini" type="primary" @click="handleDialogEdit(scope.row)">弹窗编辑</el-button>
          <el-button size="mini" type="danger" @click="handleDelete(scope.row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <pagination v-show="total > 0" :total="total" :page.sync="queryParams.page" :limit.sync="queryParams.size"
      @pagination="getFile" />
    <el-dialog title="上传文件" :visible.sync="dialogVisible" width="50%" style="text-align: center">
      <upFile ref="upFileDialog" :fileList="fileListDialog" listType="text" :size="2" :limit="6"></upFile>
      <span slot="footer" class="dialog-footer">
        <el-button @click="dialogVisible = false">取 消</el-button>
        <el-button :type="id ? 'danger' : 'primary'" @click="saveDialog"
          v-loading="addLoading">{{ id ? '修改文件' : '保存上传' }}</el-button>
      </span>
    </el-dialog>
    <el-dialog title="选择数据格式" :visible.sync="e_dataVisible" width="50%" style="text-align: center">
      <!-- <upFile ref="upFileDialog" :fileList="fileListDialog" listType="text" :size="2" :limit="6"></upFile> -->
      <!-- <el-cascader :options="options" :show-all-levels="false" /> -->


      <el-form v-if="columnsCount > 1" label-width="80px">
        <el-form-item v-for="index in columnsCount" :key="index" :label="'第' + index + '列'">
          <el-cascader v-model="value[index - 1]" :options="options" :props="{ expandTrigger: 'hover' }"
            @change="(value, node) => handleChange(value, index - 1)"></el-cascader>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="savePage">文件上传</el-button>
          <el-button @click="e_dataVisible = false ;value=[]">取消</el-button>
        </el-form-item>
      </el-form>
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
      list: [],
      loading: false,
      addLoading: false,
      total: 0,
      queryParams: {
        size: 10,
        page: 1
      },
      fileList: [],
      fileListDialog: [],
      id: undefined,
      dialogVisible: false,
      e_dataVisible: false,
      columnsCount: 0,
      inputValues: [],
      value: [],
      options: [
        {
          value: 'station_code',
          label: '气象站代码',
        },
        {
          value: 'date',
          label: '日期',
          children: [
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
          value: 'relativehumidity_2m',
          label: '相对湿度',
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
          value: 'snow_depth',
          label: '积雪深度',
        },
        {
          value: 'indicator',
          label: '指示器',
        },
      ]
    }
  },

  created() {
    this.getFile();
  },
  methods: {
    handleChange(value, index) {
      // console.log('值变化:', value, '索引:', index);
      this.inputValues[index] = value;
    },
    onSubmit() {
      console.log(this.inputValues);
      this.e_dataVisible = false;
    },
    async getFile() {
      let { data, total } = await getFile(this.queryParams);

      this.list = data;
      this.total = total;
    },
    //页面上传
    savePage() {
      //获取了文件组件结果
      let list = this.$refs.upFile.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      // 检查是否有空值
      if (this.inputValues.some(v => v === '')) {
        return this.$message.error('请填写所有数据格式！');
      }
      list[0].inputValues = this.inputValues;
      this.save(list);
      this.inputValues = [];
      this.value = [];
      this.e_dataVisible = false;
    },
    //弹窗上传
    saveDialog() {
      let list = this.$refs.upFileDialog.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      this.save(list);
    },
    //保存上传
    async save(list) {
      try {
        let { id } = this;
        this.addLoading = true;
        id && await upFileReq({ val: JSON.stringify(list), id })
        !id && await addFile({ type: 2, val: JSON.stringify(list) });
        !id && await addFiledata({ type: 2, val: JSON.stringify(list) });

        this.addLoading = false;
        this.id = undefined;
        this.getFile();
        this.$message.success(id ? "修改成功" : "保存成功！");
        this.$refs.upFile.clearFiles();
        //如果是弹窗
        if (this.dialogVisible) {
          this.$refs.upFileDialog.clearFiles();
          this.dialogVisible = false;
        }
      } catch (e) {
        this.addLoading = false;
      }
    },
    handleDelete(row) {
      console.log(row);
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
    openDialogVisible() {
      this.dialogVisible = true;
      this.id = undefined;
      this.$nextTick(() => {
        this.$refs.upFileDialog.clearFiles();
      })
    },
    openeDataVisible() {
      let list = this.$refs.upFile.getFileRes();
      if (list.length === 0) return this.$message.error("请先选择文件！");
      this.value = [];
      this.e_dataVisible = true;
      this.columnsCount = this.$refs.upFile.get_columnsCount();
      this.inputValues = new Array(this.columnsCount).fill('');
      console.log(this.inputValues)
    },
    //页面修改
    handleEdit(row) {
      //回显文件
      this.$set(this, "fileList", this.imgEvent(row));
      this.id = row.id;
    },
    //弹窗修改
    handleDialogEdit(row) {
      this.dialogVisible = true;
      this.$nextTick(() => {
        this.$set(this, "fileListDialog", this.imgEvent(row));
        this.id = row.id;
      });
    },
    defaultEvent() {
      this.id = undefined;
      this.$refs.upFile.clearFiles();
    },
    imgEvent(row) {
      try {
        return JSON.parse(row.val)
      } catch (e) {
        return []
      }
    }
  },
  components: { upFile }
}
</script>




<style scoped lang="scss"></style>
