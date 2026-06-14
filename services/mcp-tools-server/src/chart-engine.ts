export type ChartType = 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'radar';

type QueryResultRow = Record<string, unknown>;

export function generateChartConfig(
  data: QueryResultRow[],
  chartType: ChartType,
  xAxisField?: string,
  yAxisField?: string
): object {
  if (!data || data.length === 0) {
    return { error: '没有可用于绘图的数据。' };
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

function generateCartesianChart(
  data: QueryResultRow[],
  chartType: string,
  xField: string,
  yField: string
): object {
  return {
    title: {
      text: `${yField} - ${chartType === 'bar' ? '柱状图' : chartType === 'line' ? '折线图' : '面积图'}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
    },
    xAxis: {
      type: 'category',
      data: data.map((item) => item[xField]),
      name: xField,
      axisLabel: { rotate: 45 },
    },
    yAxis: {
      type: 'value',
      name: yField,
    },
    series: [
      {
        name: yField,
        data: data.map((item) => item[yField]),
        type: chartType === 'area' ? 'line' : chartType,
        areaStyle: chartType === 'area' ? {} : undefined,
        smooth: chartType === 'line' || chartType === 'area',
      },
    ],
  };
}

function generatePieChart(
  data: QueryResultRow[],
  nameField: string,
  valueField: string
): object {
  return {
    title: {
      text: `${nameField} 分布`,
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      left: 'left',
    },
    series: [
      {
        name: nameField,
        type: 'pie',
        radius: '60%',
        data: data.map((item) => ({
          name: String(item[nameField]),
          value: item[valueField],
        })),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: 'rgba(0, 0, 0, 0.5)',
          },
        },
      },
    ],
  };
}

function generateScatterChart(
  data: QueryResultRow[],
  xField: string,
  yField: string
): object {
  return {
    title: {
      text: `${xField} vs ${yField}`,
      left: 'center',
    },
    tooltip: {
      trigger: 'item',
    },
    xAxis: {
      type: 'value',
      name: xField,
      scale: true,
    },
    yAxis: {
      type: 'value',
      name: yField,
      scale: true,
    },
    series: [
      {
        type: 'scatter',
        data: data.map((item) => [item[xField], item[yField]]),
        symbolSize: 10,
      },
    ],
  };
}

function generateRadarChart(
  data: QueryResultRow[],
  indicatorField: string,
  valueField: string
): object {
  const numericValues = data
    .map((item) => Number(item[valueField] ?? 0))
    .filter((value) => Number.isFinite(value));

  const maxValue = numericValues.length ? Math.max(...numericValues) * 1.2 : 100;

  const indicator = data.map((item) => ({
    name: String(item[indicatorField]),
    max: maxValue,
  }));

  return {
    title: {
      text: '雷达图',
      left: 'center',
    },
    tooltip: {},
    radar: {
      indicator,
      radius: '65%',
    },
    series: [
      {
        type: 'radar',
        data: [
          {
            value: data.map((item) => item[valueField]),
            name: valueField,
          },
        ],
      },
    ],
  };
}
