<template>
  <div class="dashboard-container">
    <div class="title">欢迎进入敦煌多场耦合后台管理系统</div>
<!--    <div class="hint1">由于演示需要，某些固定数据无法进行编辑和删除，可新增数据进行测试！<span>（如需完整体验，请将代码拉到本地进行使用）</span></div>-->
    <button @click="goToDataScreen">查看数据大屏</button>
  </div>
</template>


<script>
export default {
  methods: {
    goToDataScreen() {
      // 使用 router.push 跳转到目标页面
      window.location.href = "http://localhost:8112/";
    }
  }
}
</script>


<style lang="scss" scoped>
// 单独设置主页的背景图
.dashboard-container{
  background: url('~@/assets/images/background.png') center center / cover no-repeat;
  padding: 55px 20px;
  text-align: center;
  min-height: 94.3vh;  
}

.title {
  font-size: 48px;
  font-weight: bold;
  letter-spacing: 3px;
  padding: 24px 48px;
  margin-bottom: 36px;
  margin-top: 275px;
  margin-left: 250px;
  margin-right: 250px;
  background: linear-gradient(90deg, #e5af72ae 0%, #f9e0b2b0 50%, #e5af72a9 100%);
  color: #8c5d1f;
  border-radius: 40px;
  box-shadow: 0 8px 24px 0 rgba(193, 140, 62, 0.18), 0 1.5px 2px 0 #f3d89f;
  border: 4px solid #e1b385;
  text-align: center;
  position: relative;
}

  .hint1{
    font-size: 20px;
    font-weight: 700;
    color: #d00202;
    margin-top: 50px;
    span{
      color: #666;
    }
  }
    
  button {
    padding: 12px 20px;
    font-size: 20px;
    border: 2px solid #c48843;
    border-radius: 22px;
    background: #fdf6e4; // 浅米色底
    color: #a17943;
    font-weight: 500;
    letter-spacing: 2px;
    box-shadow: 0 2px 10px rgba(224,176,129,0.07);
    cursor: pointer;
    transition: 
      background 0.2s,
      color 0.2s,
      border-color 0.2s,
      box-shadow 0.2s;

    &:hover {
      background: #f7c97e;
      color: #664100;
      border-color: #c48843;
      box-shadow: 0 6px 24px rgba(196,136,67,0.13);
    }

    &:active {
      background: #e0b081;
      color: #a97a44;
      border-color: #e0b081;
    }
  }

</style>

