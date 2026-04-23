<template>

  <el-tabs type="border-card" v-model="activeTab" @tab-click="(tab, event) => handleTabClick(tab, event)">
      <el-tab-pane name="夏季仓" label="夏季仓">
          <div class="box1-class">
              <h2 style="margin-top: 15px">
                  添加配置
              </h2>
              <el-divider></el-divider>

              <div class="box-class">
                  <el-form :inline="true" class="demo-form-inline">

                      <el-form-item label="环境因素：">
                          <!-- <el-input v-model="formInline.user" placeholder="审批人"></el-input> -->
                          <el-cascader v-model="env_factor" :options="option_factor_xj"
                              :props="{ expandTrigger: 'hover' }" @change="(value) => handleChange(value)">
                          </el-cascader>
                      </el-form-item>

                      <el-form-item label="模拟数值：">
                          <el-input v-model="env_num">
                              <template slot="append">{{ env_unit }}</template></el-input>
                      </el-form-item>
                      <el-form-item label="模拟时间：">
                          <el-input v-model="env_time">
                              <template slot="append">min</template></el-input>
                      </el-form-item>
                      <el-form-item>
                          <el-button type="primary" @click="onSubmit">添加</el-button>
                          <el-button @click="handlesSubmit">清除</el-button>
                      </el-form-item>
                  </el-form>
              </div>

          </div>
          <div class="box2-class">
              <h2>
                  已有配置
              </h2>
              <div class="table-container">

                  <el-table :data="list" style="width: 100%">
                      <el-table-column label="" align="center" width="250" />
                      <el-table-column label="环境因子" align="center" width="250" prop="p1" />
                      <el-table-column label="数据类型" align="center" width="250" prop="p2" />
                      <el-table-column label="数值模拟" align="center" width="250" prop="p3" />
                      <el-table-column label="模拟时间" align="center" width="250" prop="p4" />
                      <el-table-column label="创建时间" align="center" width="250" prop="p5" />
                      <el-table-column label="操作" align="center" width="250" prop="id">
                          <template slot-scope="scope">
                              <!-- <el-button size="mini" @click="handleEdit(scope.row)">编辑</el-button> -->
                              <el-button size="mini" type="danger" @click="handleDelete(scope.row)">删除</el-button>
                          </template>
                      </el-table-column>
                  </el-table>
              </div>
          </div>

      </el-tab-pane>
      <el-tab-pane name="冬季仓" label="冬季仓">
          <div class="box1-class">
              <h2 style="margin-top: 15px">
                  添加配置
              </h2>
              <el-divider></el-divider>

              <div class="box-class">
                  <el-form :inline="true" class="demo-form-inline">

                      <el-form-item label="环境因素：">
                          <!-- <el-input v-model="formInline.user" placeholder="审批人"></el-input> -->
                          <el-cascader v-model="env_factor" :options="option_factor_dj"
                              :props="{ expandTrigger: 'hover' }" @change="(value) => handleChange(value)">
                          </el-cascader>
                      </el-form-item>

                      <el-form-item label="模拟数值：">
                          <el-input v-model="env_num">
                              <template slot="append">{{ env_unit }}</template></el-input>
                      </el-form-item>
                      <el-form-item label="模拟时间：">
                          <el-input v-model="env_time">
                              <template slot="append">min</template></el-input>
                      </el-form-item>
                      <el-form-item>
                          <el-button type="primary" @click="onSubmit">添加</el-button>
                          <el-button @click="handlesSubmit">清除</el-button>
                      </el-form-item>
                  </el-form>
              </div>

          </div>
          <div class="box2-class">
              <h2>
                  已有配置
              </h2>
              <div class="table-container">

                  <el-table :data="list" style="width: 100%">
                      <el-table-column label="" align="center" width="250" />
                      <el-table-column label="环境因子" align="center" width="250" prop="p1" />
                      <el-table-column label="数据类型" align="center" width="250" prop="p2" />
                      <el-table-column label="数值模拟" align="center" width="250" prop="p3" />
                      <el-table-column label="模拟时间" align="center" width="250" prop="p4" />
                      <el-table-column label="创建时间" align="center" width="250" prop="p5" />
                      <el-table-column label="操作" align="center" width="250" prop="id">
                          <template slot-scope="scope">
                              <!-- <el-button size="mini" @click="handleEdit(scope.row)">编辑</el-button> -->
                              <el-button size="mini" type="danger" @click="handleDelete(scope.row)">删除</el-button>
                          </template>
                      </el-table-column>
                  </el-table>
              </div>
          </div>

      </el-tab-pane>
      <el-tab-pane name="风雨舱" label="风雨舱">

          <div class="box1-class">
              <h2 style="margin-top: 15px">
                  添加配置
              </h2>
              <el-divider></el-divider>

              <div class="box-class">
                  <el-form :inline="true" class="demo-form-inline">

                      <el-form-item label="环境因素：">
                          <!-- <el-input v-model="formInline.user" placeholder="审批人"></el-input> -->
                          <el-cascader v-model="env_factor" :options="option_factor_fy"
                              :props="{ expandTrigger: 'hover' }" @change="(value) => handleChange(value)">
                          </el-cascader>
                      </el-form-item>

                      <el-form-item label="模拟数值：">
                          <el-input v-model="env_num">
                              <template slot="append">{{ env_unit }}</template></el-input>
                      </el-form-item>
                      <el-form-item label="模拟时间：">
                          <el-input v-model="env_time">
                              <template slot="append">min</template></el-input>
                      </el-form-item>
                      <el-form-item>
                          <el-button type="primary" @click="onSubmit">添加</el-button>
                          <el-button @click="handlesSubmit">清除</el-button>
                      </el-form-item>
                  </el-form>
              </div>

          </div>
          <div class="box2-class">
              <h2>
                  已有配置
              </h2>
              <div class="table-container">

                  <el-table :data="list" style="width: 100%">
                      <el-table-column label="" align="center" width="250" />
                      <el-table-column label="环境因子" align="center" width="250" prop="p1" />
                      <el-table-column label="数据类型" align="center" width="250" prop="p2" />
                      <el-table-column label="数值模拟" align="center" width="250" prop="p3" />
                      <el-table-column label="模拟时间" align="center" width="250" prop="p4" />
                      <el-table-column label="创建时间" align="center" width="250" prop="p5" />
                      <el-table-column label="操作" align="center" width="250" prop="id">
                          <template slot-scope="scope">
                              <!-- <el-button size="mini" @click="handleEdit(scope.row)">编辑</el-button> -->
                              <el-button size="mini" type="danger" @click="handleDelete(scope.row)">删除</el-button>
                          </template>
                      </el-table-column>
                  </el-table>
              </div>
          </div>

      </el-tab-pane>

  </el-tabs>


</template>
<script>
import { addCondition, getCondition, delCondition } from "@/api/components";

export default {
  data() {
      return {

          list: [],
          total: 0,
          queryParams: {
              size: 10,
              page: 1
          },
          activeTab: '', // 当前激活的标签页的name
          option_factor_fy: [
              {
                  value: '温度',
                  label: '温度',
                  children: [
                      { value: '高温', label: '高温' },
                      { value: '低温', label: '低温' }
                  ]
              }, {
                  value: '湿度',
                  label: '湿度',
                  children: [
                      { value: '高湿', label: '高湿' },
                      { value: '低湿', label: '低湿' }
                  ]
              }, {
                  value: '风',
                  label: '风',
                  children: [
                      { value: '风速', label: '风速' },
                      { value: '风向', label: '风向' }
                  ]
              }, {
                  value: '雨',
                  label: '雨',
                  children: [
                      { value: '降雨量', label: '降雨量' },
                  ]
              },
          ],
          option_factor_xj: [
              {
                  value: '温度',
                  label: '温度',
                  children: [
                      { value: '高温', label: '高温' },
                      { value: '低温', label: '低温' }
                  ]
              }, {
                  value: '湿度',
                  label: '湿度',
                  children: [
                      { value: '高湿', label: '高湿' },
                      { value: '低湿', label: '低湿' }
                  ]
              }, {
                  value: '光照',
                  label: '光照',
                  children: [
                      { value: '强度', label: '强度' },
                  ]
              },
          ],
          option_factor_dj: [
              {
                  value: '温度',
                  label: '温度',
                  children: [
                      { value: '低温', label: '低温' }
                  ]
              }, {
                  value: '降雪',
                  label: '降雪',
                  children: [
                      { value: '降雪量', label: '降雪量' },
                  ]
              }, {
                  value: '光照',
                  label: '光照',
                  children: [
                      { value: '强度', label: '强度' },
                  ]
              },
          ],
          env_num: '',
          env_time: '',
          env_factor: [],
          env_unit: '',

      }
  },

  methods: {

      async onSubmit() {
          console.log('submit!');
          //判断是否为空
          if (this.env_factor.length == 0 || this.env_num == '' || this.env_time == '') {
              this.$message({
                  message: '请填写完整信息',
                  type: 'warning'
              });
              return;
          }
          
          let list = [];
          list.push({
              type: this.activeTab,
              env_factor: this.env_factor,
              env_num: this.env_num,
              env_time: this.env_time,
              env_unit: this.env_unit
          });
          console.log(list);
          await addCondition({ val: JSON.stringify(list) });
          //清空
          this.env_num = '';
          this.env_time = '';
          this.env_factor = [];
          this.env_unit = '';
          this.getConditions();

      },
      handleChange(value) {
          console.log(value[0]);
          if (value[0] == '温度') {
              this.env_unit = '℃';
          } else if (value[0] == '湿度') {
              this.env_unit = '%';
          } else if (value[0] == '风') {
              if (value[1] == '风速') {
                  this.env_unit = 'm/s';
              } else if (value[1] == '风向') {
                  this.env_unit = '';
              }
          } else if (value[0] == '雨') {
              this.env_unit = 'mm';
          } else if (value[0] == '光照') {
              this.env_unit = 'lux';
          } else if (value[0] == '降雪') {
              this.env_unit = 'mm';
          }
      },

      handleTabClick(tab, event) {
          this.activeTab = tab.name;
          this.getConditions();
      },

      async getConditions() {
          let queryParams = this.queryParams;
          queryParams.type = this.activeTab;
          let { data, total } = await getCondition(queryParams);
          this.list = [];
          //解析data变成可以展示的数据
          for (let i = 0; i < total; i++) {
              let item = [];
              let dataItem = JSON.parse(data[i].val);
              dataItem = dataItem[0];

              item.p1 = dataItem.env_factor[0];
              item.p2 = dataItem.env_factor[1];
              item.p3 = dataItem.env_num + dataItem.env_unit;
              item.p4 = dataItem.env_time;
              item.p5 = data[i].create_time;
              item.id = data[i].id;
              this.list.push(item);
          }
      },
      handleDelete(row) {
          this.$confirm('此操作将永久删除该配置, 是否继续?', '提示', {
              confirmButtonText: '确定',
              cancelButtonText: '取消',
              type: 'error'
          }).then(async () => {
              console.log(row);
              let parm = {};
              parm.id = row.id;
              await delCondition(parm);
              this.getConditions();
              this.$message.success("删除成功！");
          })
      },
      handlesSubmit() {
          this.env_num = '';
          this.env_time = '';
          this.env_factor = [];
          this.env_unit = '';
      }
  }
}
</script>

<style scoped lang="scss">
.box1-class {
  height: 200px;
  margin: 0 auto;
  background-color: rgb(255, 255, 255);
  text-align: center;
  /*给父元素设置text-align*/
  box-shadow: 0 2px 4px rgba(0, 0, 0, .12), 0 0 6px rgba(0, 0, 0, .04);
}

.box2-class {
  height: 550px;
  background-color: rgb(255, 255, 255);
  text-align: center;
  /*给父元素设置text-align*/
  box-shadow: 0 2px 4px rgba(0, 0, 0, .12), 0 0 6px rgba(0, 0, 0, .04);
}

.box-class {
  height: 150px;
  background-color: rgb(255, 255, 255);
  text-align: center;
  /*给父元素设置text-align*/
  box-shadow: 0 2px 4px rgba(0, 0, 0, .12), 0 0 6px rgba(0, 0, 0, .04);
}

.table-container {
  display: flex;
  //   justify-content: center;
  align-items: center;
  margin: auto;
  //   height: 100vh; /* 设置容器高度为视口高度 */
}
</style>