"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabaseSchema = getDatabaseSchema;
exports.executeSQL = executeSQL;
exports.executeSQLWithCallback = executeSQLWithCallback;
exports.generateChartConfig = generateChartConfig;
const client_1 = require("@prisma/client");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
// 实例化 Prisma 客户端，建立与 Docker MySQL 的物理连接
const prisma = new client_1.PrismaClient();
/**
 * 工具 1：获取数据库表结构 (Agent 的眼睛)
 */
function getDatabaseSchema() {
    console.log("🛠️  [工具调用] 大模型正在查看数据库表结构...");
    try {
        // 直接读取 Prisma 反向生成的配置文件，里面包含了最精准的表结构和类型
        const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        return schema;
    }
    catch (error) {
        return "获取表结构失败，请检查 prisma/schema.prisma 文件是否存在。";
    }
}
/**
 * 工具 2：执行 SQL 查询 (Agent 的手)
 */
async function executeSQL(query) {
    console.log(`\n🛠️  [工具调用] 大模型要求执行 SQL: \n${query}\n`);
    try {
        // 使用 Prisma 的原生 SQL 执行能力
        // 注意：在真实的生产环境中，这里需要做极其严格的 SQL 注入拦截和只读权限控制
        // 但在我们目前的本地 Agent 开发中，为了灵活性先直接放行
        const result = await prisma.$queryRawUnsafe(query);
        // 将数据库返回的对象数组转化为 JSON 字符串，方便大模型阅读
        // 添加 DATA_MARKER 标记，让后端识别这是结构化数据
        const jsonData = JSON.stringify(result);
        return `DATA_MARKER:${jsonData}`;
    }
    catch (error) {
        // 如果 SQL 报错，把报错信息原封不动地返回给大模型，聪明的模型会自己反思并修改 SQL
        return `SQL 执行报错：${error.message}`;
    }
}
/**
 * 工具 2 增强版：执行 SQL 查询并返回原始数据（用于回调）
 */
async function executeSQLWithCallback(query) {
    console.log(`\n🛠️  [工具调用] 大模型要求执行 SQL: \n${query}\n`);
    try {
        const result = await prisma.$queryRawUnsafe(query);
        return {
            text: JSON.stringify(result),
            data: result
        };
    }
    catch (error) {
        return {
            text: `SQL 执行报错：${error.message}`,
            data: null
        };
    }
}
function generateChartConfig(data, chartType, xAxisField, yAxisField) {
    console.log(`\n📊 [图表工具] 生成 ${chartType} 图表配置...\n`);
    if (!data || data.length === 0) {
        return JSON.stringify({ error: '没有数据可绘制' });
    }
    const columns = Object.keys(data[0]);
    const xField = xAxisField || columns[0];
    const yField = yAxisField || columns[1];
    switch (chartType) {
        case 'bar':
        case 'line':
        case 'area':
            return generateCartesianChart(data, chartType, xField, yField);
        case 'pie':
            return generatePieChart(data, xField, yField);
        case 'scatter':
            return generateScatterChart(data, xField, yField);
        case 'radar':
            return generateRadarChart(data, xField, yField);
        default:
            return generateCartesianChart(data, 'bar', xField, yField);
    }
}
/**
 * 生成直角坐标系图表（柱状图、折线图、面积图）
 */
function generateCartesianChart(data, chartType, xField, yField) {
    const config = {
        title: {
            text: `${yField} - ${chartType === 'bar' ? '柱状图' : chartType === 'line' ? '折线图' : '面积图'}`,
            left: 'center'
        },
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' }
        },
        xAxis: {
            type: 'category',
            data: data.map((item) => item[xField]),
            name: xField,
            axisLabel: { rotate: 45 }
        },
        yAxis: {
            type: 'value',
            name: yField
        },
        series: [{
                name: yField,
                data: data.map((item) => item[yField]),
                type: chartType === 'area' ? 'line' : chartType,
                areaStyle: chartType === 'area' ? {} : undefined,
                smooth: chartType === 'line' || chartType === 'area'
            }]
    };
    return JSON.stringify(config);
}
/**
 * 生成饼图
 */
function generatePieChart(data, nameField, valueField) {
    const config = {
        title: {
            text: `${nameField} 分布`,
            left: 'center'
        },
        tooltip: {
            trigger: 'item',
            formatter: '{b}: {c} ({d}%)'
        },
        legend: {
            orient: 'vertical',
            left: 'left'
        },
        series: [{
                name: nameField,
                type: 'pie',
                radius: '60%',
                data: data.map((item) => ({
                    name: String(item[nameField]),
                    value: item[valueField]
                })),
                emphasis: {
                    itemStyle: {
                        shadowBlur: 10,
                        shadowOffsetX: 0,
                        shadowColor: 'rgba(0, 0, 0, 0.5)'
                    }
                }
            }]
    };
    return JSON.stringify(config);
}
/**
 * 生成散点图
 */
function generateScatterChart(data, xField, yField) {
    const config = {
        title: {
            text: `${xField} vs ${yField}`,
            left: 'center'
        },
        tooltip: {
            trigger: 'item',
            formatter: function (params) {
                return `${xField}: ${params.data[0]}<br/>${yField}: ${params.data[1]}`;
            }
        },
        xAxis: {
            type: 'value',
            name: xField,
            scale: true
        },
        yAxis: {
            type: 'value',
            name: yField,
            scale: true
        },
        series: [{
                type: 'scatter',
                data: data.map((item) => [item[xField], item[yField]]),
                symbolSize: 10
            }]
    };
    return JSON.stringify(config);
}
/**
 * 生成雷达图
 */
function generateRadarChart(data, indicatorField, valueField) {
    const indicator = data.map((item) => ({
        name: String(item[indicatorField]),
        max: Math.max(...data.map((d) => d[valueField])) * 1.2
    }));
    const config = {
        title: {
            text: '雷达图',
            left: 'center'
        },
        tooltip: {},
        radar: {
            indicator: indicator,
            radius: '65%'
        },
        series: [{
                type: 'radar',
                data: [{
                        value: data.map((item) => item[valueField]),
                        name: valueField
                    }]
            }]
    };
    return JSON.stringify(config);
}
