// 定义mapData数据结构，用来表示地图上每一个数据点
export interface MapdataType {
    name: string;   // 地区名称
    value: [number, number, number];  //x,y,value [经度，纬度，数据值]
}

export interface ClimateDataItem {
    name: string;
    value: number;
    climate: string;
}

// 生成ECharts地图配置项（option），根据传入的区域代码、业务数据和地图数据来构造一个完整的地图图表配置
export const optionHandle = (regionCode: string,
    list: ClimateDataItem[], 
    mapData: MapdataType[]) => {
    let top = 60;   // 中国地图偏移高度
    // console.log("list: ", list)
    let zoom = ["china"].includes(regionCode) ? 1.18 : 1;   // china就放大地图否则正常比例
    return {
        backgroundColor: "rgba(255, 255, 255, 0)",
        tooltip: {
            show: false,
        },
        legend: {
            show: false,
        },
        visualMap: {
            seriesIndex:0,  // 如下视觉映射只影响series0，地图数据第一层
            // 左下角的图例设计
            left: 15,
            bottom: 18,
            pieces: [
                { value: 0, label: "热带雨林片区" },
                { value: 1, label: "温带季风片区" }, // 不指定 max，表示 max 为无限大（Infinity）。
                { value: 2, label: "温带大陆性片区" },  // gte是greater equal
                { value: 3, label: "高原山地片区" },  // lte是lesser equal
                { value: 4, label: "亚热带季风片区" },
                { value: 5, label: "热带季风片区" },
            ],
            inRange: {
                // 图例的渐变颜色，从小到大
                color: [
                    // 暖色系
                    "rgba(255, 214, 165, 0.9)",  // 浅橙黄
                    "rgba(255,180,120,0.9)",  // 浅橙
                    "rgba(255,140,70,0.9)",   // 橙
                    "rgba(255,99,71,0.9)",    // 番茄红
                    "rgba(230,58,48,0.9)",    // 深红橙
                    "rgba(170,22,22,0.9)"     // 深酒红
                ],
            },
            // 图例的文字颜色
            textStyle: {
                color: "#000",
            },
            backgroundColor: "rgba(255,255,255,0.95)",  // **白色背景，略透明可调**
            borderColor: "#ccc",                        // **边框颜色**
            borderWidth: 1,                             // **边框宽度**
            padding: [9, 10, 9, 10],                  // **上下左右内边距，可自调**
        },

        // 设置地图底层地理坐标系的geo配置
        geo: {
            map: regionCode,  // 根据点击区域值动态变化
            roam: true,  // 不允许用户drag或zoom交互
            selectedMode: false, //是否允许选中多个区域
            zoom: zoom,
            top: top,
            // aspectScale: 0.78,
            show: true,  // 是否显示geo的地图底层

            // 因为geo和scatter都应用在同一个图层layer，所以geo默认的效果会覆盖到scatter，如果要统一就要在geo这里添加相应scatter的修改
            // 鼠标移入或选中区域时的效果配置（高亮状态）
            emphasis: {
                label: {
                    show: false,
                },
                // 设置高亮状态下地图区域的颜色样式
                itemStyle: {
                    // areaColor: "rgba(56,155,183,.7)",
                    areaColor:{
                        type: "radial",  // 径向渐变，从中心向四周扩散
                        // xy渐变中心在区域中心点，r渐变半径（占据整个图形区域的80%）
                        x: 0.5,
                        y: 0.5,
                        r: 0.8,
                        colorStops: [   // 渐变的颜色点
                            {
                                offset: 0,  // 中心颜色
                                color: "rgba(147, 235, 248, 0)", // 0% 处的颜色
                            },
                            {
                                offset: 1,  // 边缘颜色
                                color: "rgba(56,155,183, .8)", // 100% 处的颜色
                            },
                        ],
                        globalCoord: false, // 让每个区域独立高亮
                    },
                    borderWidth: 1,   // 控制区域边界线的清晰度
                },
            },
        },
        
        series: [
            // map图层会根据regioncode渲染地图区域（包括控制交互、样式、提示框等）
            {
                name: "MAP",
                type: "map",
                map: regionCode,
                // aspectScale: 0.78,
                data: list,
                // data: [1,100],
                selectedMode: false, //是否允许选中多个区域
                zoom: zoom,
                geoIndex: 0,  // effectscatter默认0，如果这里设置1，会在不同上下层，导致坐标轴不统一会错乱打点
                top: top,

                // 提示框的配置
                tooltip: {   
                    show: true,
                    formatter: function (params: any) {  // 显示内容：有数据显示，没有显示名字
                        if (params.data) {
                            // return params.name + "：" + params.data["value"];
                            return params.name;
                        } else {
                            return params.name;
                        }
                    },
                    // 提示框背景、文字、边框颜色 
                    backgroundColor: "rgba(0,0,0,.6)",
                    borderColor: "rgba(147, 235, 248, .8)",
                    textStyle: {
                        color: "#FFF",
                    },
                },

                // 地图上区域名称的文本标签
                label: {
                    show: false,
                    color: "#000",
                    // position: [-10, 0],
                    formatter: function (val: any) {  // 格式化文字显示内容 北京市->北京
                        // console.log(val)
                        if (val.data !== undefined) {
                            return val.name.slice(0, 2);
                        } else {
                            return "";
                        }
                    },
                    rich: {},   // 高级文本样式配置，可是个别设置不同区域名配置
                },

                // 鼠标移入或选中区域时的效果配置（高亮状态）
                emphasis: {
                    label: {
                        show: false,
                    },
                    // 设置高亮状态下地图区域的颜色样式
                    itemStyle: {
                        // areaColor: "rgba(56,155,183,.7)",
                        areaColor:{
                            type: "radial",  // 径向渐变，从中心向四周扩散
                            // xy渐变中心在区域中心点，r渐变半径（占据整个图形区域的80%）
                            x: 0.5,
                            y: 0.5,
                            r: 0.8,
                            colorStops: [   // 渐变的颜色点
                                {
                                    offset: 0,  // 中心颜色
                                    color: "rgba(147, 235, 248, 0)", // 0% 处的颜色
                                },
                                {
                                    offset: 1,  // 边缘颜色
                                    color: "rgba(56,155,183, .8)", // 100% 处的颜色
                                },
                            ],
                            globalCoord: false, // 让每个区域独立高亮
                        },
                        borderWidth: 1,   // 控制区域边界线的清晰度
                    },
                },

                // 控制地图在默认状态下（非鼠标交互）各个区域的视觉效果
                itemStyle: {
                    borderColor: "rgba(147, 235, 248, .8)",
                    borderWidth: 1,
                    areaColor: {
                        type: "radial",
                        x: 0.5,
                        y: 0.5,
                        r: 0.8,
                        colorStops: [
                            {
                                offset: 0,
                                color: "rgba(147, 235, 248, 0)", // 0% 处的颜色
                            },
                            {
                                offset: 1,
                                color: "rgba(147, 235, 248, .2)", // 100% 处的颜色
                            },
                        ],
                        globalCoord: false, // 缺为 false
                    },
                    shadowColor: "rgba(128, 217, 248, .3)",
                    shadowOffsetX: -2,
                    shadowOffsetY: 2,
                    shadowBlur: 10,
                },
            },

            // effectScatter图层会根据mapData渲染经纬度打点，显示涟漪动画
            {
                data: mapData,  // 数据结构：[经度,纬度,数据值]
                type: "effectScatter",
                coordinateSystem: "geo",   // 绘制在geo地图坐标上
                symbolSize: function (val: any) {  // 控制坐标点的大小
                    return 4;
                    // return val[2] / 50; 这个设计根据数据值来动态调整大小
                },
                legendHoverLink: true,  // 鼠标移到图例上，点会高亮
                showEffectOn: "render",  // 渲染完就出大涟漪动画
                rippleEffect: {   // 涟漪特效设置
                    // period: 4,
                    scale: 6,
                    color: "rgba(255,255,255, 1)",
                    brushType: "fill",
                },

                // 用户悬停在点上会展示对应信息
                // tooltip: {
                //     show: false,
                //     formatter: function (params: any) {
                //         if (params.data) {
                //             return params.name + "：" + params.data["value"][2];
                //         } else {
                //             return params.name;
                //         }
                //     },
                //     backgroundColor: "rgba(0,0,0,.6)",
                //     borderColor: "rgba(147, 235, 248, .8)",
                //     textStyle: {
                //         color: "#FFF",
                //     },
                // },

                // 地图上各个区域的名字（北京）样式
                label: {
                    formatter: (param: any) => {
                        return param.name.slice(0, 2);
                    },

                    fontSize: 12,
                    offset: [0, 2],
                    position: "bottom",
                    textBorderColor: "#fff",
                    textShadowColor: "#000",
                    textShadowBlur: 0,
                    textBorderWidth: 0,
                    color: "#000",
                    show: true,
                },

                // colorBy: "data",

                // 设置每个散点的样式外观
                itemStyle: {
                    color: "rgba(255,255,255,1)",
                    borderColor: "rgba(255,255,255,2)",
                    borderWidth: 4,
                    shadowColor: "#000",
                    shadowBlur: 10,
                },
            },
        ],
        //动画效果
        // animationDuration: 1000,
        // animationEasing: 'linear',
        // animationDurationUpdate: 1000
    };
}

export const regionCodes: any = {
    "中国": {
        "adcode": "100000",
        "level": "country",
        "name": "中华人民共和国"
    },
    "新疆维吾尔自治区": {
        "adcode": "650000",
        "level": "province",
        "name": "新疆维吾尔自治区"
    },
    "湖北省": {
        "adcode": "420000",
        "level": "province",
        "name": "湖北省"
    },
    "辽宁省": {
        "adcode": "210000",
        "level": "province",
        "name": "辽宁省"
    },
    "广东省": {
        "adcode": "440000",
        "level": "province",
        "name": "广东省"
    },
    "内蒙古自治区": {
        "adcode": "150000",
        "level": "province",
        "name": "内蒙古自治区"
    },
    "黑龙江省": {
        "adcode": "230000",
        "level": "province",
        "name": "黑龙江省"
    },
    "河南省": {
        "adcode": "410000",
        "level": "province",
        "name": "河南省"
    },
    "山东省": {
        "adcode": "370000",
        "level": "province",
        "name": "山东省"
    },
    "陕西省": {
        "adcode": "610000",
        "level": "province",
        "name": "陕西省"
    },
    "贵州省": {
        "adcode": "520000",
        "level": "province",
        "name": "贵州省"
    },
    "上海市": {
        "adcode": "310000",
        "level": "province",
        "name": "上海市"
    },
    "重庆市": {
        "adcode": "500000",
        "level": "province",
        "name": "重庆市"
    },
    "西藏自治区": {
        "adcode": "540000",
        "level": "province",
        "name": "西藏自治区"
    },
    "安徽省": {
        "adcode": "340000",
        "level": "province",
        "name": "安徽省"
    },
    "福建省": {
        "adcode": "350000",
        "level": "province",
        "name": "福建省"
    },
    "湖南省": {
        "adcode": "430000",
        "level": "province",
        "name": "湖南省"
    },
    "海南省": {
        "adcode": "460000",
        "level": "province",
        "name": "海南省"
    },
    "江苏省": {
        "adcode": "320000",
        "level": "province",
        "name": "江苏省"
    },
    "青海省": {
        "adcode": "630000",
        "level": "province",
        "name": "青海省"
    },
    "广西壮族自治区": {
        "adcode": "450000",
        "level": "province",
        "name": "广西壮族自治区"
    },
    "宁夏回族自治区": {
        "adcode": "640000",
        "level": "province",
        "name": "宁夏回族自治区"
    },
    "浙江省": {
        "adcode": "330000",
        "level": "province",
        "name": "浙江省"
    },
    "河北省": {
        "adcode": "130000",
        "level": "province",
        "name": "河北省"
    },
    "香港特别行政区": {
        "adcode": "810000",
        "level": "province",
        "name": "香港特别行政区"
    },
    "台湾省": {
        "adcode": "710000",
        "level": "province",
        "name": "台湾省"
    },
    "澳门特别行政区": {
        "adcode": "820000",
        "level": "province",
        "name": "澳门特别行政区"
    },
    "甘肃省": {
        "adcode": "620000",
        "level": "province",
        "name": "甘肃省"
    },
    "四川省": {
        "adcode": "510000",
        "level": "province",
        "name": "四川省"
    },
    "天津市": {
        "adcode": "120000",
        "level": "province",
        "name": "天津市"
    },
    "江西省": {
        "adcode": "360000",
        "level": "province",
        "name": "江西省"
    },
    "云南省": {
        "adcode": "530000",
        "level": "province",
        "name": "云南省"
    },
    "山西省": {
        "adcode": "140000",
        "level": "province",
        "name": "山西省"
    },
    "北京市": {
        "adcode": "110000",
        "level": "province",
        "name": "北京市"
    },
    "吉林省": {
        "adcode": "220000",
        "level": "province",
        "name": "吉林省"
    },
    "南海诸岛": {
        "adcode": "chinaNanhai",
        "level": "province",
        "name": "吉林省"
    }
}