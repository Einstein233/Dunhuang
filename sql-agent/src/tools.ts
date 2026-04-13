import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

// 实例化 Prisma 客户端，建立与 Docker MySQL 的物理连接
const prisma = new PrismaClient();

// ==========================================
// 🚨 新增：企业级 SQL 鉴权与安检机 (只读沙箱)
// ==========================================
function validateSQL(query: string): string | null {
    // 黑名单正则：\b 匹配单词边界，i 忽略大小写。
    // 这样可以拦截 "DROP TABLE" 但会放过 "SELECT drop_rate"
    const dangerousKeywords = /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|REPLACE|GRANT|REVOKE)\b/i;
    
    if (dangerousKeywords.test(query)) {
        // 返回温柔但坚定的警告，引导大模型自我修正
        return "【系统安全拦截】权限不足！当前数据库处于只读沙箱模式，严禁执行包含修改、删除或破坏性操作的语句。请修改您的 SQL 语句，仅使用 SELECT 进行查询。";
    }
    
    return null; // 安全，放行
}

/**
 * 工具 1：获取数据库表结构 (Agent 的眼睛)
 */
export function getDatabaseSchema(): string {
    console.log("🛠️  [工具调用] 大模型正在查看数据库表结构...");
    try {
        const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        return schema;
    } catch (error) {
        return "获取表结构失败，请检查 prisma/schema.prisma 文件是否存在。";
    }
}

/**
 * 工具 2：执行 SQL 查询 (Agent 的手)
 */
export async function executeSQL(query: string): Promise<string> {
    console.log(`\n🛠️  [工具调用] 大模型要求执行 SQL: \n${query}\n`);
    
    // 🛡️ 第一道防线：执行前进行安全鉴权
    const validationError = validateSQL(query);
    if (validationError) {
        console.log(`🚨 [安全拦截] 成功拦截危险 SQL: ${query}`);
        return validationError; // 直接将警告返回给大模型，触发其自我反思
    }

    try {
        const result = await prisma.$queryRawUnsafe(query);
        const jsonData = JSON.stringify(result);
        return `DATA_MARKER:${jsonData}`;
    } catch (error: any) {
        return `SQL 执行报错：${error.message}`;
    }
}

/**
 * 工具 2 增强版：执行 SQL 查询并返回原始数据（用于回调）
 */
export async function executeSQLWithCallback(query: string): Promise<{ text: string; data: Record<string, any>[] | null }> {
    console.log(`\n🛠️  [工具调用] 大模型要求执行 SQL: \n${query}\n`);
    
    // 🛡️ 第一道防线：执行前进行安全鉴权
    const validationError = validateSQL(query);
    if (validationError) {
        console.log(`🚨 [安全拦截] 成功拦截危险 SQL: ${query}`);
        return {
            text: validationError, // 将警告内容发给大模型
            data: null
        };
    }

    try {
        const result = await prisma.$queryRawUnsafe(query);
        return {
            text: JSON.stringify(result),
            data: result as Record<string, any>[]
        };
    } catch (error: any) {
        return {
            text: `SQL 执行报错：${error.message}`,
            data: null
        };
    }
}

/**
 * 工具 3：图表配置生成器
 * 根据数据和图表类型生成 ECharts 配置
 */
export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'radar';

export function generateChartConfig(
    data: Record<string, any>[],
    chartType: ChartType,
    xAxisField?: string,
    yAxisField?: string
): string {
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
function generateCartesianChart(
    data: Record<string, any>[],
    chartType: string,
    xField: string,
    yField: string
): string {
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
            data: data.map((item: any) => item[xField]),
            name: xField,
            axisLabel: { rotate: 45 }
        },
        yAxis: {
            type: 'value',
            name: yField
        },
        series: [{
            name: yField,
            data: data.map((item: any) => item[yField]),
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
function generatePieChart(
    data: Record<string, any>[],
    nameField: string,
    valueField: string
): string {
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
            data: data.map((item: any) => ({
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
function generateScatterChart(
    data: Record<string, any>[],
    xField: string,
    yField: string
): string {
    const config = {
        title: {
            text: `${xField} vs ${yField}`,
            left: 'center'
        },
        tooltip: {
            trigger: 'item',
            formatter: function(params: any) {
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
            data: data.map((item: any) => [item[xField], item[yField]]),
            symbolSize: 10
        }]
    };
    return JSON.stringify(config);
}

/**
 * 生成雷达图
 */
function generateRadarChart(
    data: Record<string, any>[],
    indicatorField: string,
    valueField: string
): string {
    const indicator = data.map((item: any) => ({
        name: String(item[indicatorField]),
        max: Math.max(...data.map((d: any) => d[valueField])) * 1.2
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
                value: data.map((item: any) => item[valueField]),
                name: valueField
            }]
        }]
    };
    return JSON.stringify(config);
}
