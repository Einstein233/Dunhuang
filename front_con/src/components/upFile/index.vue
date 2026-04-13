<template>
  <div class="file-box">
    <!-- 上传组件封装的上传控件 -->
    <el-upload
        :action="action"
        :list-type="listType"
        :multiple="multiple"
        ref="upImg"
        :limit="limit"
        :file-list="fileList"
        :headers="headers"
        :drag="drag"
        :accept="accept"
        :on-success="onSuccess"
        :on-remove="onRemove"
        :on-change="handleFileUpload"
        :before-upload="beforeUpload"
        :on-exceed="handleExceed"
        :on-preview="handlePictureCardPreview"
        :disabled="isDisabled"
    >
      <i class="el-icon-plus" v-if="listType==='picture-card'"></i>
      <el-button v-else size="small" type="primary" plain style="margin-top: 5px">点击选择</el-button>

      <!--      <i class="el-icon-upload"></i>-->

      <div v-if="drag" class="el-upload__text"><em>支持拖拽上传</em></div>
      <div v-if="accept" class="el-upload__tip" slot="tip">只能上传类型：{{accept}}</div>
      <div v-if="size" class="el-upload__tip" slot="tip">最大不超过：{{size}} M</div>
    </el-upload>

    <el-dialog   :visible.sync="dialogVisible" size="tiny" append-to-body>
      <img width="100%" :src="dialogImageUrl" alt="预览">
    </el-dialog>

  </div>
</template>

<script>
import {getToken} from "@/utils/auth";
import XLSX from 'xlsx';
import jschardet from 'jschardet'
import iconv from 'iconv-lite'

export default {
  name: "upFile",
  
  // 外部传入的配置项 
  props:{
    //文件数量 为0 不限制
    limit:{
      type:Number,
      default: 0
    },
    //是否多选
    multiple:{
      type:Boolean,
      default:true
    },
    //默认列表 {url,name,upUrl}
    fileList:{
      type:Array,
      default: ()=>[]
    },
    //是否拖拽（这里可以设置是否drag to upload，但是拖拽上传的界面很丑）
    drag:{
      type:Boolean,
      default:false
    },
    //展示类型  picture-card/picture/text
    listType:{
      default:"picture-card"
    },
    //文件类型 为空不限制 .jpg,png
    accept:{
      type:String,
      default:".csv, .xlsx, .xls,"
    },
    //文件大小限制，为0不限制   单位M
    size:{
      type:Number,
      default: 0
    },
    //是否禁用
    isDisabled:{
      type:Boolean,
      default:false
    }
  },
  
  // 组件内部状态
  data(){
    return {
      dialogImageUrl:"",
      dialogVisible:false,
      e_dataVisible:true,
      action:process.env.VUE_APP_BASE_API+"/file/file",  // 上传接口
      headers:{token:getToken()},
      list:[],  // 实际上传成果后显示的文件列表
      columnsCount: 0,  // 文件列数
      headersRow: [],  // 表头（文件的第一行）
    }
  },

  // 监听fileList的变化
  watch:{
    fileList(list){
      this.list=list;
    }
  },

  // 上传行为逻辑
  methods:{

    onSubmit() {
          console.log('submit!');
    },

    // 对外暴露上传结果，供父级组件获取已上传的文件
    getFileRes(){
      return this.list;
    },

    // 点击图片预览时触发弹窗，展示上传图片（若是图片文件）
    handlePictureCardPreview(file) {
      this.dialogImageUrl = file.url;
      this.dialogVisible = true;
    },

    // 上传成果后触发
    onSuccess(res){
      let { data, code, msg } = res;

      if( code === 203 ) {
        this.$message.error("登陆失效，请重新登陆！");
        this.$store.dispatch('user/logout');
        return;
      }
      if( code != 1 ) return this.$message.error( msg || "上传失败！" );

      this.list=this.list.concat(data)  // 将返回的数据加入list

      this.$emit("upSuccess",{data});  // 发出upSuccess时间给父级组件监听
    },

    // 删除文件时触发
    onRemove(res){
      // 从list中移除该文件
      let { response } = res;
      let data = response ? response.data:[res];
      let index = this.list.findIndex(t=>t.url == data[0].url);
      this.list.splice(index,1)

      // 发出upRemove事件通知父级组件
      if(response) return this.$emit("upRemove",{data});
      this.$emit("upRemove",{data});
    },

    // 上传文件之前进行校验（文件类型和文件大小）
    beforeUpload(res){

      let { size, accept } = this;

      if( size && (res.size/1024/1024/1024) > size ){
        this.$message.error(`最大不超过${size} G`);
        return false;
      };

      if(accept){
        const regex = /\.([^.]*)$/;
        const match = res.name.match(regex);
        const result = match ? match[0] : "";
        if(!accept.includes(result)){
          this.$message.error(`只能上传类型：${accept}`);
          return false;
        }
      }
      return true;
    },

    // 核心逻辑：文件上传先判断是不是csv、excel（自动识别csv编码）
    handleFileUpload(file) {
      const reader = new FileReader();

      reader.onload = (e) => {
        const buffer = e.target.result;

        // 自动检测编码
        let encoding = 'utf-8';
        const detected = jschardet.detect(buffer);
        if (detected.encoding) {
          encoding = detected.encoding.toLowerCase();
          // 修正：常见csv会被检测成gb2312、windows-1252、ascii等
          if (encoding === 'gb2312' || encoding === 'windows-1252' || encoding === 'ascii') encoding = 'gbk';
        }

        // 用 iconv-lite 解码 buffer 为文本
        const content = iconv.decode(new Uint8Array(buffer), encoding);

        // csv 解析
        if (file.raw.type === 'text/csv') {
          console.log("csv文件, 编码: " + encoding);
          const lines = content.split(/\r?\n/).filter(l => l.trim() !== '');
          const firstLine = lines[0];
          this.headersRow = firstLine.split(',');
          this.columnsCount = this.headersRow.length;
          this.previewRows = lines.slice(1, 6).map(line => line.split(','));
        }

        // Excel
        else if (
          file.raw.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
          file.raw.type === 'application/vnd.ms-excel'
        ) {
          console.log("excel文件");
          const workbook = XLSX.read(buffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
          this.headersRow = jsonData[0];
          this.columnsCount = this.headersRow.length;
          this.previewRows = jsonData.slice(1, 6);
        }

        // 其他类型报错
        else {
          console.log("file.raw.type:", file.raw.type);
          this.$message.error(`只能上传文件类型: csv, xls, xlsx`);
        }
      };

      // 用二进制方式读取，方便编码检测
      reader.readAsArrayBuffer(file.raw);
    },

    // 上传文件超过上限触发错误提示
    handleExceed() {
      this.$message.error(`一次性最多可上传：${this.limit}个`);
    },

    // 情况上传组件的文件列表和状态
    clearFiles(){
      this.list=[];
      this.$refs.upImg.clearFiles();
    },

    // 返回列数（供外部组件调用）
    get_columnsCount(){
      return this.columnsCount;
    },

    // 返回表头名（供外部组件调用）
    get_headers() {
      return this.headersRow;
    },

    get_preview(count = 10) {
    // 假设 this.tableData 是数组，每一项是解析后的表格一行
    // 返回前count行
    return this.previewRows.slice(0, count);
    },
  }
}
</script>

<style scoped lang="scss">
  .file-box{
    ::v-deep .el-upload-dragger{
      width: 148px;
      height: 148px;
      .el-upload__text{
        width: 100%;
        position: absolute;
        top: 45px;
      }
    }
    ::v-deep .el-upload__tip{
      line-height: 15px;
    }
  }
</style>
