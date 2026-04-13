<template>
    <div class="CPUStatusWrapper">
        <div id="CPUStatus" style="width: 440px; height: 250px;"></div>
    </div>
</template>

<script setup lang="ts">
import { onMounted, nextTick } from 'vue';
import * as echarts from 'echarts';
import { CPUStatus } from '@/api';
import { ElMessage } from 'element-plus';

const createChart = () => {
    const myChart = echarts.init(document.getElementById('CPUStatus'));

    const chartData: number[] = Array(61).fill(0);
    const xAxisData: string[] = Array(60).fill('');

    xAxisData.splice(0, 1, '60秒');
    xAxisData.splice(60, 0, '0');

    const option:echarts.EChartsOption = {
        animation: false,
        title: [
            {
                text: "CPU",
                left: "40%",
            },
            {
                text: "100%",
                right: "4%",
                top: "7%",
                textStyle: {
                    color: "#777",
                    fontSize: 12,
                    fontWeight: 'normal',
                },
            },
        ],
        xAxis: {
            boundaryGap: false,
            data: xAxisData,
            type: 'category',
            splitLine: {
                show: true,
                lineStyle: {
                color: ['#ccc'],
                width: 1,
                type: 'solid',
                },
            },
            axisTick: {
                show: false,
            },
        },
        yAxis: {
            name: '%利用率',
            type: 'value',
            axisLabel: {
                show: false,
            },
        },
        series: [
            {
                type: "line",
                data: chartData,
                areaStyle: {
                color: "#d5e5ff",
                },
                lineStyle: {
                width: 0,
                },
                showSymbol: false,
            },
        ],
    };

    myChart.setOption(option);

    setInterval(() => {
        // chartData.push(Math.random() * 100);
        CPUStatus()
         .then((res) => {
					if(res.success){
						// console.log("CPU使用率:",res.data.CPUUsage);
						let usage = res.data.CPUUsage;
						chartData.push(usage);
					} else {
						ElMessage({
							message: res.msg,
							type: "warning",
						})
					}
				 })
				 .catch((err) => {
					ElMessage.error(err);
				 })
        if (chartData.length >= 60) {
        chartData.shift();
        }
        myChart.setOption({
        series: [
            {
            data: chartData,
            },
        ],
        });
    }, 1000);
};

onMounted(() =>{
    nextTick(() =>{
        createChart();
    });
});
</script>

<style lang="scss" scoped>
</style>
