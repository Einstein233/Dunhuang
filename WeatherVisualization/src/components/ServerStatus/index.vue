<script setup lang="ts">
import CPUStatusDashboard from './components/CPUStatusDashboard/index.vue';
</script>

<template>
    <div class="WrapperOfServerStatus">
        <div style="width: 30%; margin-top: 2%;">
            <ElDescriptions
							:column="1"
            >
							<el-descriptions-item label="服务器名称">DESKTOP</el-descriptions-item>
							<el-descriptions-item label="服务器IP">1.1.1.1</el-descriptions-item>
							<el-descriptions-item label="操作系统">Windows 11</el-descriptions-item>
							<el-descriptions-item label="系统架构">xxx</el-descriptions-item>
							<el-descriptions-item label="CPU核心数">8</el-descriptions-item>
            </ElDescriptions>
        </div>
				<div>
					<CPUStatusDashboard />
				</div>
    </div>
</template>

<style scoped>
.WrapperOfServerStatus {
  background-color: transparent; /* 将背景设置为透明 */
  color: #fff; /* 文字颜色设置为白色 */
	display:flex;
}

:deep(.el-descriptions__label) {
  color: #ffffff; /* 标签颜色设置为灰色 */
}
:deep(.el-descriptions__content) {
  color: #fff; /* 内容颜色设置为白色 */
}

:deep(.el-descriptions__body){
  background: rgba(0, 0, 0, 0.12) !important;
}

</style>
