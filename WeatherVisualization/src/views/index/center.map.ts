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
    },

    // 下面开始是省内各个城市的 regionCodes
    // 甘肃省内城市
    "酒泉市": {
        "adcode": "620900",
        "level": "city",
        "name": "酒泉市",
        "province": "甘肃省"
    },
    "嘉峪关市": {
        "adcode": "620200",
        "level": "city",
        "name": "嘉峪关市",
        "province": "甘肃省"
    },
    "张掖市": {
        "adcode": "620700",
        "level": "city",
        "name": "张掖市",
        "province": "甘肃省"
    },
    "金昌市": {
        "adcode": "620300",
        "level": "city",
        "name": "金昌市",
        "province": "甘肃省"
    },
    "兰州市": {
        "adcode": "620100",
        "level": "city",
        "name": "兰州市",
        "province": "甘肃省"
    },
    "白银市": {
        "adcode": "620400",
        "level": "city",
        "name": "白银市",
        "province": "甘肃省"
    },
    "天水市": {
        "adcode": "620500",
        "level": "city",
        "name": "天水市",
        "province": "甘肃省"
    },
    "武威市": {
        "adcode": "620600",
        "level": "city",
        "name": "武威市",
        "province": "甘肃省"
    },
    "平凉市": {
        "adcode": "620800",
        "level": "city",
        "name": "平凉市",
        "province": "甘肃省"
    },
    "庆阳市": {
        "adcode": "621000",
        "level": "city",
        "name": "庆阳市",
        "province": "甘肃省"
    },
    "定西市": {
        "adcode": "621100",
        "level": "city",
        "name": "定西市",
        "province": "甘肃省"
    },
    "陇南市": {
        "adcode": "621200",
        "level": "city",
        "name": "陇南市",
        "province": "甘肃省"
    },
    "临夏回族自治州": {
        "adcode": "622900",
        "level": "city",
        "name": "临夏回族自治州",
        "province": "甘肃省"
    },
    "甘南藏族自治州": {
        "adcode": "623000",
        "level": "city",
        "name": "甘南藏族自治州",
        "province": "甘肃省"
    },

    // 河北省
    "石家庄市": {
        "adcode": "130100",
        "level": "city",
        "name": "石家庄市",
        "province": "河北省"
    },
    "唐山市": {
        "adcode": "130200",
        "level": "city",
        "name": "唐山市",
        "province": "河北省"
    },
    "秦皇岛市": {
        "adcode": "130300",
        "level": "city",
        "name": "秦皇岛市",
        "province": "河北省"
    },
    "邯郸市": {
        "adcode": "130400",
        "level": "city",
        "name": "邯郸市",
        "province": "河北省"
    },
    "邢台市": {
        "adcode": "130500",
        "level": "city",
        "name": "邢台市",
        "province": "河北省"
    },
    "保定市": {
        "adcode": "130600",
        "level": "city",
        "name": "保定市",
        "province": "河北省"
    },
    "张家口市": {
        "adcode": "130700",
        "level": "city",
        "name": "张家口市",
        "province": "河北省"
    },
    "承德市": {
        "adcode": "130800",
        "level": "city",
        "name": "承德市",
        "province": "河北省"
    },
    "沧州市": {
        "adcode": "130900",
        "level": "city",
        "name": "沧州市",
        "province": "河北省"
    },
    "廊坊市": {
        "adcode": "131000",
        "level": "city",
        "name": "廊坊市",
        "province": "河北省"
    },
    "衡水市": {
        "adcode": "131100",
        "level": "city",
        "name": "衡水市",
        "province": "河北省"
    },

    // 山西省
    "太原市": {
        "adcode": "140100",
        "level": "city",
        "name": "太原市",
        "province": "山西省"
    },
    "大同市": {
        "adcode": "140200",
        "level": "city",
        "name": "大同市",
        "province": "山西省"
    },
    "阳泉市": {
        "adcode": "140300",
        "level": "city",
        "name": "阳泉市",
        "province": "山西省"
    },
    "长治市": {
        "adcode": "140400",
        "level": "city",
        "name": "长治市",
        "province": "山西省"
    },
    "晋城市": {
        "adcode": "140500",
        "level": "city",
        "name": "晋城市",
        "province": "山西省"
    },
    "朔州市": {
        "adcode": "140600",
        "level": "city",
        "name": "朔州市",
        "province": "山西省"
    },
    "晋中市": {
        "adcode": "140700",
        "level": "city",
        "name": "晋中市",
        "province": "山西省"
    },
    "运城市": {
        "adcode": "140800",
        "level": "city",
        "name": "运城市",
        "province": "山西省"
    },
    "忻州市": {
        "adcode": "140900",
        "level": "city",
        "name": "忻州市",
        "province": "山西省"
    },
    "临汾市": {
        "adcode": "141000",
        "level": "city",
        "name": "临汾市",
        "province": "山西省"
    },
    "吕梁市": {
        "adcode": "141100",
        "level": "city",
        "name": "吕梁市",
        "province": "山西省"
    },

    // 辽宁省
    "沈阳市": {
        "adcode": "210100",
        "level": "city",
        "name": "沈阳市",
        "province": "辽宁省"
    },
    "大连市": {
        "adcode": "210200",
        "level": "city",
        "name": "大连市",
        "province": "辽宁省"
    },
    "鞍山市": {
        "adcode": "210300",
        "level": "city",
        "name": "鞍山市",
        "province": "辽宁省"
    },
    "抚顺市": {
        "adcode": "210400",
        "level": "city",
        "name": "抚顺市",
        "province": "辽宁省"
    },
    "本溪市": {
        "adcode": "210500",
        "level": "city",
        "name": "本溪市",
        "province": "辽宁省"
    },
    "丹东市": {
        "adcode": "210600",
        "level": "city",
        "name": "丹东市",
        "province": "辽宁省"
    },
    "锦州市": {
        "adcode": "210700",
        "level": "city",
        "name": "锦州市",
        "province": "辽宁省"
    },
    "营口市": {
        "adcode": "210800",
        "level": "city",
        "name": "营口市",
        "province": "辽宁省"
    },
    "阜新市": {
        "adcode": "210900",
        "level": "city",
        "name": "阜新市",
        "province": "辽宁省"
    },
    "辽阳市": {
        "adcode": "211000",
        "level": "city",
        "name": "辽阳市",
        "province": "辽宁省"
    },
    "盘锦市": {
        "adcode": "211100",
        "level": "city",
        "name": "盘锦市",
        "province": "辽宁省"
    },
    "铁岭市": {
        "adcode": "211200",
        "level": "city",
        "name": "铁岭市",
        "province": "辽宁省"
    },
    "朝阳市": {
        "adcode": "211300",
        "level": "city",
        "name": "朝阳市",
        "province": "辽宁省"
    },
    "葫芦岛市": {
        "adcode": "211400",
        "level": "city",
        "name": "葫芦岛市",
        "province": "辽宁省"
    },

    // 吉林省
    "长春市": {
        "adcode": "220100",
        "level": "city",
        "name": "长春市",
        "province": "吉林省"
    },
    "吉林市": {
        "adcode": "220200",
        "level": "city",
        "name": "吉林市",
        "province": "吉林省"
    },
    "四平市": {
        "adcode": "220300",
        "level": "city",
        "name": "四平市",
        "province": "吉林省"
    },
    "辽源市": {
        "adcode": "220400",
        "level": "city",
        "name": "辽源市",
        "province": "吉林省"
    },
    "通化市": {
        "adcode": "220500",
        "level": "city",
        "name": "通化市",
        "province": "吉林省"
    },
    "白山市": {
        "adcode": "220600",
        "level": "city",
        "name": "白山市",
        "province": "吉林省"
    },
    "松原市": {
        "adcode": "220700",
        "level": "city",
        "name": "松原市",
        "province": "吉林省"
    },
    "白城市": {
        "adcode": "220800",
        "level": "city",
        "name": "白城市",
        "province": "吉林省"
    },
    "延边朝鲜族自治州": {
        "adcode": "222400",
        "level": "city",
        "name": "延边朝鲜族自治州",
        "province": "吉林省"
    },

    // 黑龙江省
    "哈尔滨市": {
        "adcode": "230100",
        "level": "city",
        "name": "哈尔滨市",
        "province": "黑龙江省"
    },
    "齐齐哈尔市": {
        "adcode": "230200",
        "level": "city",
        "name": "齐齐哈尔市",
        "province": "黑龙江省"
    },
    "鸡西市": {
        "adcode": "230300",
        "level": "city",
        "name": "鸡西市",
        "province": "黑龙江省"
    },
    "鹤岗市": {
        "adcode": "230400",
        "level": "city",
        "name": "鹤岗市",
        "province": "黑龙江省"
    },
    "双鸭山市": {
        "adcode": "230500",
        "level": "city",
        "name": "双鸭山市",
        "province": "黑龙江省"
    },
    "大庆市": {
        "adcode": "230600",
        "level": "city",
        "name": "大庆市",
        "province": "黑龙江省"
    },
    "伊春市": {
        "adcode": "230700",
        "level": "city",
        "name": "伊春市",
        "province": "黑龙江省"
    },
    "佳木斯市": {
        "adcode": "230800",
        "level": "city",
        "name": "佳木斯市",
        "province": "黑龙江省"
    },
    "七台河市": {
        "adcode": "230900",
        "level": "city",
        "name": "七台河市",
        "province": "黑龙江省"
    },
    "牡丹江市": {
        "adcode": "231000",
        "level": "city",
        "name": "牡丹江市",
        "province": "黑龙江省"
    },
    "黑河市": {
        "adcode": "231100",
        "level": "city",
        "name": "黑河市",
        "province": "黑龙江省"
    },
    "绥化市": {
        "adcode": "231200",
        "level": "city",
        "name": "绥化市",
        "province": "黑龙江省"
    },
    "大兴安岭地区": {
        "adcode": "232700",
        "level": "city",
        "name": "大兴安岭地区",
        "province": "黑龙江省"
    },

    // 江苏省
    "南京市": {
        "adcode": "320100",
        "level": "city",
        "name": "南京市",
        "province": "江苏省"
    },
    "无锡市": {
        "adcode": "320200",
        "level": "city",
        "name": "无锡市",
        "province": "江苏省"
    },
    "徐州市": {
        "adcode": "320300",
        "level": "city",
        "name": "徐州市",
        "province": "江苏省"
    },
    "常州市": {
        "adcode": "320400",
        "level": "city",
        "name": "常州市",
        "province": "江苏省"
    },
    "苏州市": {
        "adcode": "320500",
        "level": "city",
        "name": "苏州市",
        "province": "江苏省"
    },
    "南通市": {
        "adcode": "320600",
        "level": "city",
        "name": "南通市",
        "province": "江苏省"
    },
    "连云港市": {
        "adcode": "320700",
        "level": "city",
        "name": "连云港市",
        "province": "江苏省"
    },
    "淮安市": {
        "adcode": "320800",
        "level": "city",
        "name": "淮安市",
        "province": "江苏省"
    },
    "盐城市": {
        "adcode": "320900",
        "level": "city",
        "name": "盐城市",
        "province": "江苏省"
    },
    "扬州市": {
        "adcode": "321000",
        "level": "city",
        "name": "扬州市",
        "province": "江苏省"
    },
    "镇江市": {
        "adcode": "321100",
        "level": "city",
        "name": "镇江市",
        "province": "江苏省"
    },
    "泰州市": {
        "adcode": "321200",
        "level": "city",
        "name": "泰州市",
        "province": "江苏省"
    },
    "宿迁市": {
        "adcode": "321300",
        "level": "city",
        "name": "宿迁市",
        "province": "江苏省"
    },

    // 浙江省
    "杭州市": {
        "adcode": "330100",
        "level": "city",
        "name": "杭州市",
        "province": "浙江省"
    },
    "宁波市": {
        "adcode": "330200",
        "level": "city",
        "name": "宁波市",
        "province": "浙江省"
    },
    "温州市": {
        "adcode": "330300",
        "level": "city",
        "name": "温州市",
        "province": "浙江省"
    },
    "嘉兴市": {
        "adcode": "330400",
        "level": "city",
        "name": "嘉兴市",
        "province": "浙江省"
    },
    "湖州市": {
        "adcode": "330500",
        "level": "city",
        "name": "湖州市",
        "province": "浙江省"
    },
    "绍兴市": {
        "adcode": "330600",
        "level": "city",
        "name": "绍兴市",
        "province": "浙江省"
    },
    "金华市": {
        "adcode": "330700",
        "level": "city",
        "name": "金华市",
        "province": "浙江省"
    },
    "衢州市": {
        "adcode": "330800",
        "level": "city",
        "name": "衢州市",
        "province": "浙江省"
    },
    "舟山市": {
        "adcode": "330900",
        "level": "city",
        "name": "舟山市",
        "province": "浙江省"
    },
    "台州市": {
        "adcode": "331000",
        "level": "city",
        "name": "台州市",
        "province": "浙江省"
    },
    "丽水市": {
        "adcode": "331100",
        "level": "city",
        "name": "丽水市",
        "province": "浙江省"
    },

    // 安徽省
    "合肥市": {
        "adcode": "340100",
        "level": "city",
        "name": "合肥市",
        "province": "安徽省"
    },
    "芜湖市": {
        "adcode": "340200",
        "level": "city",
        "name": "芜湖市",
        "province": "安徽省"
    },
    "蚌埠市": {
        "adcode": "340300",
        "level": "city",
        "name": "蚌埠市",
        "province": "安徽省"
    },
    "淮南市": {
        "adcode": "340400",
        "level": "city",
        "name": "淮南市",
        "province": "安徽省"
    },
    "马鞍山市": {
        "adcode": "340500",
        "level": "city",
        "name": "马鞍山市",
        "province": "安徽省"
    },
    "淮北市": {
        "adcode": "340600",
        "level": "city",
        "name": "淮北市",
        "province": "安徽省"
    },
    "铜陵市": {
        "adcode": "340700",
        "level": "city",
        "name": "铜陵市",
        "province": "安徽省"
    },
    "安庆市": {
        "adcode": "340800",
        "level": "city",
        "name": "安庆市",
        "province": "安徽省"
    },
    "黄山市": {
        "adcode": "341000",
        "level": "city",
        "name": "黄山市",
        "province": "安徽省"
    },
    "滁州市": {
        "adcode": "341100",
        "level": "city",
        "name": "滁州市",
        "province": "安徽省"
    },
    "阜阳市": {
        "adcode": "341200",
        "level": "city",
        "name": "阜阳市",
        "province": "安徽省"
    },
    "宿州市": {
        "adcode": "341300",
        "level": "city",
        "name": "宿州市",
        "province": "安徽省"
    },
    "六安市": {
        "adcode": "341500",
        "level": "city",
        "name": "六安市",
        "province": "安徽省"
    },
    "亳州市": {
        "adcode": "341600",
        "level": "city",
        "name": "亳州市",
        "province": "安徽省"
    },
    "池州市": {
        "adcode": "341700",
        "level": "city",
        "name": "池州市",
        "province": "安徽省"
    },
    "宣城市": {
        "adcode": "341800",
        "level": "city",
        "name": "宣城市",
        "province": "安徽省"
    },

    // 福建省
    "福州市": {
        "adcode": "350100",
        "level": "city",
        "name": "福州市",
        "province": "福建省"
    },
    "厦门市": {
        "adcode": "350200",
        "level": "city",
        "name": "厦门市",
        "province": "福建省"
    },
    "莆田市": {
        "adcode": "350300",
        "level": "city",
        "name": "莆田市",
        "province": "福建省"
    },
    "三明市": {
        "adcode": "350400",
        "level": "city",
        "name": "三明市",
        "province": "福建省"
    },
    "泉州市": {
        "adcode": "350500",
        "level": "city",
        "name": "泉州市",
        "province": "福建省"
    },
    "漳州市": {
        "adcode": "350600",
        "level": "city",
        "name": "漳州市",
        "province": "福建省"
    },
    "南平市": {
        "adcode": "350700",
        "level": "city",
        "name": "南平市",
        "province": "福建省"
    },
    "龙岩市": {
        "adcode": "350800",
        "level": "city",
        "name": "龙岩市",
        "province": "福建省"
    },
    "宁德市": {
        "adcode": "350900",
        "level": "city",
        "name": "宁德市",
        "province": "福建省"
    },

    // 江西省
    "南昌市": {
        "adcode": "360100",
        "level": "city",
        "name": "南昌市",
        "province": "江西省"
    },
    "景德镇市": {
        "adcode": "360200",
        "level": "city",
        "name": "景德镇市",
        "province": "江西省"
    },
    "萍乡市": {
        "adcode": "360300",
        "level": "city",
        "name": "萍乡市",
        "province": "江西省"
    },
    "九江市": {
        "adcode": "360400",
        "level": "city",
        "name": "九江市",
        "province": "江西省"
    },
    "新余市": {
        "adcode": "360500",
        "level": "city",
        "name": "新余市",
        "province": "江西省"
    },
    "鹰潭市": {
        "adcode": "360600",
        "level": "city",
        "name": "鹰潭市",
        "province": "江西省"
    },
    "赣州市": {
        "adcode": "360700",
        "level": "city",
        "name": "赣州市",
        "province": "江西省"
    },
    "吉安市": {
        "adcode": "360800",
        "level": "city",
        "name": "吉安市",
        "province": "江西省"
    },
    "宜春市": {
        "adcode": "360900",
        "level": "city",
        "name": "宜春市",
        "province": "江西省"
    },
    "抚州市": {
        "adcode": "361000",
        "level": "city",
        "name": "抚州市",
        "province": "江西省"
    },
    "上饶市": {
        "adcode": "361100",
        "level": "city",
        "name": "上饶市",
        "province": "江西省"
    },

    // 山东省
    "济南市": {
        "adcode": "370100",
        "level": "city",
        "name": "济南市",
        "province": "山东省"
    },
    "青岛市": {
        "adcode": "370200",
        "level": "city",
        "name": "青岛市",
        "province": "山东省"
    },
    "淄博市": {
        "adcode": "370300",
        "level": "city",
        "name": "淄博市",
        "province": "山东省"
    },
    "枣庄市": {
        "adcode": "370400",
        "level": "city",
        "name": "枣庄市",
        "province": "山东省"
    },
    "东营市": {
        "adcode": "370500",
        "level": "city",
        "name": "东营市",
        "province": "山东省"
    },
    "烟台市": {
        "adcode": "370600",
        "level": "city",
        "name": "烟台市",
        "province": "山东省"
    },
    "潍坊市": {
        "adcode": "370700",
        "level": "city",
        "name": "潍坊市",
        "province": "山东省"
    },
    "济宁市": {
        "adcode": "370800",
        "level": "city",
        "name": "济宁市",
        "province": "山东省"
    },
    "泰安市": {
        "adcode": "370900",
        "level": "city",
        "name": "泰安市",
        "province": "山东省"
    },
    "威海市": {
        "adcode": "371000",
        "level": "city",
        "name": "威海市",
        "province": "山东省"
    },
    "日照市": {
        "adcode": "371100",
        "level": "city",
        "name": "日照市",
        "province": "山东省"
    },
    "临沂市": {
        "adcode": "371300",
        "level": "city",
        "name": "临沂市",
        "province": "山东省"
    },
    "德州市": {
        "adcode": "371400",
        "level": "city",
        "name": "德州市",
        "province": "山东省"
    },
    "聊城市": {
        "adcode": "371500",
        "level": "city",
        "name": "聊城市",
        "province": "山东省"
    },
    "滨州市": {
        "adcode": "371600",
        "level": "city",
        "name": "滨州市",
        "province": "山东省"
    },
    "菏泽市": {
        "adcode": "371700",
        "level": "city",
        "name": "菏泽市",
        "province": "山东省"
    },

    // 河南省
    "郑州市": {
        "adcode": "410100",
        "level": "city",
        "name": "郑州市",
        "province": "河南省"
    },
    "开封市": {
        "adcode": "410200",
        "level": "city",
        "name": "开封市",
        "province": "河南省"
    },
    "洛阳市": {
        "adcode": "410300",
        "level": "city",
        "name": "洛阳市",
        "province": "河南省"
    },
    "平顶山市": {
        "adcode": "410400",
        "level": "city",
        "name": "平顶山市",
        "province": "河南省"
    },
    "安阳市": {
        "adcode": "410500",
        "level": "city",
        "name": "安阳市",
        "province": "河南省"
    },
    "鹤壁市": {
        "adcode": "410600",
        "level": "city",
        "name": "鹤壁市",
        "province": "河南省"
    },
    "新乡市": {
        "adcode": "410700",
        "level": "city",
        "name": "新乡市",
        "province": "河南省"
    },
    "焦作市": {
        "adcode": "410800",
        "level": "city",
        "name": "焦作市",
        "province": "河南省"
    },
    "濮阳市": {
        "adcode": "410900",
        "level": "city",
        "name": "濮阳市",
        "province": "河南省"
    },
    "许昌市": {
        "adcode": "411000",
        "level": "city",
        "name": "许昌市",
        "province": "河南省"
    },
    "漯河市": {
        "adcode": "411100",
        "level": "city",
        "name": "漯河市",
        "province": "河南省"
    },
    "三门峡市": {
        "adcode": "411200",
        "level": "city",
        "name": "三门峡市",
        "province": "河南省"
    },
    "南阳市": {
        "adcode": "411300",
        "level": "city",
        "name": "南阳市",
        "province": "河南省"
    },
    "商丘市": {
        "adcode": "411400",
        "level": "city",
        "name": "商丘市",
        "province": "河南省"
    },
    "信阳市": {
        "adcode": "411500",
        "level": "city",
        "name": "信阳市",
        "province": "河南省"
    },
    "周口市": {
        "adcode": "411600",
        "level": "city",
        "name": "周口市",
        "province": "河南省"
    },
    "驻马店市": {
        "adcode": "411700",
        "level": "city",
        "name": "驻马店市",
        "province": "河南省"
    },
    "济源市": {
        "adcode": "419001",
        "level": "city",
        "name": "济源市",
        "province": "河南省"
    },

    // 湖北省
    "武汉市": {
        "adcode": "420100",
        "level": "city",
        "name": "武汉市",
        "province": "湖北省"
    },
    "黄石市": {
        "adcode": "420200",
        "level": "city",
        "name": "黄石市",
        "province": "湖北省"
    },
    "十堰市": {
        "adcode": "420300",
        "level": "city",
        "name": "十堰市",
        "province": "湖北省"
    },
    "宜昌市": {
        "adcode": "420500",
        "level": "city",
        "name": "宜昌市",
        "province": "湖北省"
    },
    "襄阳市": {
        "adcode": "420600",
        "level": "city",
        "name": "襄阳市",
        "province": "湖北省"
    },
    "鄂州市": {
        "adcode": "420700",
        "level": "city",
        "name": "鄂州市",
        "province": "湖北省"
    },
    "荆门市": {
        "adcode": "420800",
        "level": "city",
        "name": "荆门市",
        "province": "湖北省"
    },
    "孝感市": {
        "adcode": "420900",
        "level": "city",
        "name": "孝感市",
        "province": "湖北省"
    },
    "荆州市": {
        "adcode": "421000",
        "level": "city",
        "name": "荆州市",
        "province": "湖北省"
    },
    "黄冈市": {
        "adcode": "421100",
        "level": "city",
        "name": "黄冈市",
        "province": "湖北省"
    },
    "咸宁市": {
        "adcode": "421200",
        "level": "city",
        "name": "咸宁市",
        "province": "湖北省"
    },
    "随州市": {
        "adcode": "421300",
        "level": "city",
        "name": "随州市",
        "province": "湖北省"
    },
    "恩施土家族苗族自治州": {
        "adcode": "422800",
        "level": "city",
        "name": "恩施土家族苗族自治州",
        "province": "湖北省"
    },
    "仙桃市": {
        "adcode": "429004",
        "level": "city",
        "name": "仙桃市",
        "province": "湖北省"
    },
    "潜江市": {
        "adcode": "429005",
        "level": "city",
        "name": "潜江市",
        "province": "湖北省"
    },
    "天门市": {
        "adcode": "429006",
        "level": "city",
        "name": "天门市",
        "province": "湖北省"
    },
    "神农架林区": {
        "adcode": "429021",
        "level": "city",
        "name": "神农架林区",
        "province": "湖北省"
    },

    // 湖南省
    "长沙市": {
        "adcode": "430100",
        "level": "city",
        "name": "长沙市",
        "province": "湖南省"
    },
    "株洲市": {
        "adcode": "430200",
        "level": "city",
        "name": "株洲市",
        "province": "湖南省"
    },
    "湘潭市": {
        "adcode": "430300",
        "level": "city",
        "name": "湘潭市",
        "province": "湖南省"
    },
    "衡阳市": {
        "adcode": "430400",
        "level": "city",
        "name": "衡阳市",
        "province": "湖南省"
    },
    "邵阳市": {
        "adcode": "430500",
        "level": "city",
        "name": "邵阳市",
        "province": "湖南省"
    },
    "岳阳市": {
        "adcode": "430600",
        "level": "city",
        "name": "岳阳市",
        "province": "湖南省"
    },
    "常德市": {
        "adcode": "430700",
        "level": "city",
        "name": "常德市",
        "province": "湖南省"
    },
    "张家界市": {
        "adcode": "430800",
        "level": "city",
        "name": "张家界市",
        "province": "湖南省"
    },
    "益阳市": {
        "adcode": "430900",
        "level": "city",
        "name": "益阳市",
        "province": "湖南省"
    },
    "郴州市": {
        "adcode": "431000",
        "level": "city",
        "name": "郴州市",
        "province": "湖南省"
    },
    "永州市": {
        "adcode": "431100",
        "level": "city",
        "name": "永州市",
        "province": "湖南省"
    },
    "怀化市": {
        "adcode": "431200",
        "level": "city",
        "name": "怀化市",
        "province": "湖南省"
    },
    "娄底市": {
        "adcode": "431300",
        "level": "city",
        "name": "娄底市",
        "province": "湖南省"
    },
    "湘西土家族苗族自治州": {
        "adcode": "433100",
        "level": "city",
        "name": "湘西土家族苗族自治州",
        "province": "湖南省"
    },

    // 广东省
    "广州市": {
        "adcode": "440100",
        "level": "city",
        "name": "广州市",
        "province": "广东省"
    },
    "韶关市": {
        "adcode": "440200",
        "level": "city",
        "name": "韶关市",
        "province": "广东省"
    },
    "深圳市": {
        "adcode": "440300",
        "level": "city",
        "name": "深圳市",
        "province": "广东省"
    },
    "珠海市": {
        "adcode": "440400",
        "level": "city",
        "name": "珠海市",
        "province": "广东省"
    },
    "汕头市": {
        "adcode": "440500",
        "level": "city",
        "name": "汕头市",
        "province": "广东省"
    },
    "佛山市": {
        "adcode": "440600",
        "level": "city",
        "name": "佛山市",
        "province": "广东省"
    },
    "江门市": {
        "adcode": "440700",
        "level": "city",
        "name": "江门市",
        "province": "广东省"
    },
    "湛江市": {
        "adcode": "440800",
        "level": "city",
        "name": "湛江市",
        "province": "广东省"
    },
    "茂名市": {
        "adcode": "440900",
        "level": "city",
        "name": "茂名市",
        "province": "广东省"
    },
    "肇庆市": {
        "adcode": "441200",
        "level": "city",
        "name": "肇庆市",
        "province": "广东省"
    },
    "惠州市": {
        "adcode": "441300",
        "level": "city",
        "name": "惠州市",
        "province": "广东省"
    },
    "梅州市": {
        "adcode": "441400",
        "level": "city",
        "name": "梅州市",
        "province": "广东省"
    },
    "汕尾市": {
        "adcode": "441500",
        "level": "city",
        "name": "汕尾市",
        "province": "广东省"
    },
    "河源市": {
        "adcode": "620900",
        "level": "city",
        "name": "河源市",
        "province": "广东省"
    },
    "阳江市": {
        "adcode": "441600",
        "level": "city",
        "name": "阳江市",
        "province": "广东省"
    },
    "清远市": {
        "adcode": "441800",
        "level": "city",
        "name": "清远市",
        "province": "广东省"
    },
    "东莞市": {
        "adcode": "441900",
        "level": "city",
        "name": "东莞市",
        "province": "广东省"
    },
    "中山市": {
        "adcode": "442000",
        "level": "city",
        "name": "中山市",
        "province": "广东省"
    },
    "潮州市": {
        "adcode": "445100",
        "level": "city",
        "name": "潮州市",
        "province": "广东省"
    },
    "揭阳市": {
        "adcode": "445200",
        "level": "city",
        "name": "揭阳市",
        "province": "广东省"
    },
    "云浮市": {
        "adcode": "445300",
        "level": "city",
        "name": "云浮市",
        "province": "广东省"
    },

    // 广西壮族自治区
    "南宁市": {
        "adcode": "450100",
        "level": "city",
        "name": "南宁市",
        "province": "广西壮族自治区"
    },
    "柳州市": {
        "adcode": "450200",
        "level": "city",
        "name": "柳州市",
        "province": "广西壮族自治区"
    },
    "桂林市": {
        "adcode": "450300",
        "level": "city",
        "name": "桂林市",
        "province": "广西壮族自治区"
    },
    "梧州市": {
        "adcode": "450400",
        "level": "city",
        "name": "梧州市",
        "province": "广西壮族自治区"
    },
    "北海市": {
        "adcode": "450500",
        "level": "city",
        "name": "北海市",
        "province": "广西壮族自治区"
    },
    "防城港市": {
        "adcode": "450600",
        "level": "city",
        "name": "防城港市",
        "province": "广西壮族自治区"
    },
    "钦州市": {
        "adcode": "450700",
        "level": "city",
        "name": "钦州市",
        "province": "广西壮族自治区"
    },
    "贵港市": {
        "adcode": "450800",
        "level": "city",
        "name": "贵港市",
        "province": "广西壮族自治区"
    },
    "玉林市": {
        "adcode": "450900",
        "level": "city",
        "name": "玉林市",
        "province": "广西壮族自治区"
    },
    "百色市": {
        "adcode": "451000",
        "level": "city",
        "name": "百色市",
        "province": "广西壮族自治区"
    },
    "贺州市": {
        "adcode": "451100",
        "level": "city",
        "name": "贺州市",
        "province": "广西壮族自治区"
    },
    "河池市": {
        "adcode": "451200",
        "level": "city",
        "name": "河池市",
        "province": "广西壮族自治区"
    },
    "来宾市": {
        "adcode": "451300",
        "level": "city",
        "name": "来宾市",
        "province": "广西壮族自治区"
    },
    "崇左市": {
        "adcode": "451400",
        "level": "city",
        "name": "崇左市",
        "province": "广西壮族自治区"
    },

    // 海南省
    "海口市": {
        "adcode": "460100",
        "level": "city",
        "name": "海口市",
        "province": "海南省"
    },
    "三亚市": {
        "adcode": "460200",
        "level": "city",
        "name": "三亚市",
        "province": "海南省"
    },
    "三沙市": {
        "adcode": "460300",
        "level": "city",
        "name": "三沙市",
        "province": "海南省"
    },
    "儋州市": {
        "adcode": "460400",
        "level": "city",
        "name": "儋州市",
        "province": "海南省"
    },
    "五指山市": {
        "adcode": "469001",
        "level": "city",
        "name": "五指山市",
        "province": "海南省"
    },
    "琼海市": {
        "adcode": "469002",
        "level": "city",
        "name": "琼海市",
        "province": "海南省"
    },
    "文昌市": {
        "adcode": "469005",
        "level": "city",
        "name": "文昌市",
        "province": "海南省"
    },
    "万宁市": {
        "adcode": "469006",
        "level": "city",
        "name": "万宁市",
        "province": "海南省"
    },
    "东方市": {
        "adcode": "469007",
        "level": "city",
        "name": "东方市",
        "province": "海南省"
    },
    "定安县": {
        "adcode": "469021",
        "level": "city",
        "name": "定安县",
        "province": "海南省"
    },
    "屯昌县": {
        "adcode": "469022",
        "level": "city",
        "name": "屯昌县",
        "province": "海南省"
    },
    "澄迈县": {
        "adcode": "469023",
        "level": "city",
        "name": "澄迈县",
        "province": "海南省"
    },
    "临高县": {
        "adcode": "469024",
        "level": "city",
        "name": "临高县",
        "province": "海南省"
    },
    "白沙黎族自治县": {
        "adcode": "469025",
        "level": "city",
        "name": "白沙黎族自治县",
        "province": "海南省"
    },
    "昌江黎族自治县": {
        "adcode": "469026",
        "level": "city",
        "name": "昌江黎族自治县",
        "province": "海南省"
    },
    "乐东黎族自治县": {
        "adcode": "469027",
        "level": "city",
        "name": "乐东黎族自治县",
        "province": "海南省"
    },
    "陵水黎族自治县": {
        "adcode": "469028",
        "level": "city",
        "name": "陵水黎族自治县",
        "province": "海南省"
    },
    "保亭黎族苗族自治县": {
        "adcode": "469029",
        "level": "city",
        "name": "保亭黎族苗族自治县",
        "province": "海南省"
    },
    "琼中黎族苗族自治县": {
        "adcode": "469030",
        "level": "city",
        "name": "琼中黎族苗族自治县",
        "province": "海南省"
    },

    // 四川省
    "成都市": {
        "adcode": "510100",
        "level": "city",
        "name": "成都市",
        "province": "四川省"
    },
    "自贡市": {
        "adcode": "510300",
        "level": "city",
        "name": "自贡市",
        "province": "四川省"
    },
    "攀枝花市": {
        "adcode": "510400",
        "level": "city",
        "name": "攀枝花市",
        "province": "四川省"
    },
    "泸州市": {
        "adcode": "510500",
        "level": "city",
        "name": "泸州市",
        "province": "四川省"
    },
    "德阳市": {
        "adcode": "510600",
        "level": "city",
        "name": "德阳市",
        "province": "四川省"
    },
    "绵阳市": {
        "adcode": "510700",
        "level": "city",
        "name": "绵阳市",
        "province": "四川省"
    },
    "广元市": {
        "adcode": "510800",
        "level": "city",
        "name": "广元市",
        "province": "四川省"
    },
    "遂宁市": {
        "adcode": "510900",
        "level": "city",
        "name": "遂宁市",
        "province": "四川省"
    },
    "内江市": {
        "adcode": "511000",
        "level": "city",
        "name": "内江市",
        "province": "四川省"
    },
    "乐山市": {
        "adcode": "511100",
        "level": "city",
        "name": "乐山市",
        "province": "四川省"
    },
    "南充市": {
        "adcode": "511300",
        "level": "city",
        "name": "南充市",
        "province": "四川省"
    },
    "眉山市": {
        "adcode": "511400",
        "level": "city",
        "name": "眉山市",
        "province": "四川省"
    },
    "宜宾市": {
        "adcode": "511500",
        "level": "city",
        "name": "宜宾市",
        "province": "四川省"
    },
    "广安市": {
        "adcode": "511600",
        "level": "city",
        "name": "广安市",
        "province": "四川省"
    },
    "达州市": {
        "adcode": "511700",
        "level": "city",
        "name": "达州市",
        "province": "四川省"
    },
    "雅安市": {
        "adcode": "511800",
        "level": "city",
        "name": "雅安市",
        "province": "四川省"
    },
    "巴中市": {
        "adcode": "511900",
        "level": "city",
        "name": "巴中市",
        "province": "四川省"
    },
    "资阳市": {
        "adcode": "512000",
        "level": "city",
        "name": "资阳市",
        "province": "四川省"
    },
    "阿坝藏族羌族自治州": {
        "adcode": "513200",
        "level": "city",
        "name": "阿坝藏族羌族自治州",
        "province": "四川省"
    },
    "甘孜藏族自治州": {
        "adcode": "513300",
        "level": "city",
        "name": "甘孜藏族自治州",
        "province": "四川省"
    },
    "凉山彝族自治州": {
        "adcode": "513400",
        "level": "city",
        "name": "凉山彝族自治州",
        "province": "四川省"
    },

    // 贵州省
    "贵阳市": {
        "adcode": "520100",
        "level": "city",
        "name": "贵阳市",
        "province": "贵州省"
    },
    "六盘水市": {
        "adcode": "520200",
        "level": "city",
        "name": "六盘水市",
        "province": "贵州省"
    },
    "遵义市": {
        "adcode": "520300",
        "level": "city",
        "name": "遵义市",
        "province": "贵州省"
    },
    "安顺市": {
        "adcode": "520400",
        "level": "city",
        "name": "安顺市",
        "province": "贵州省"
    },
    "毕节市": {
        "adcode": "520500",
        "level": "city",
        "name": "毕节市",
        "province": "贵州省"
    },
    "铜仁市": {
        "adcode": "520600",
        "level": "city",
        "name": "铜仁市",
        "province": "贵州省"
    },
    "黔西南布依族苗族自治州": {
        "adcode": "522300",
        "level": "city",
        "name": "黔西南布依族苗族自治州",
        "province": "贵州省"
    },
    "黔东南苗族侗族自治州": {
        "adcode": "522600",
        "level": "city",
        "name": "黔东南苗族侗族自治州",
        "province": "贵州省"
    },
    "黔南布依族苗族自治州": {
        "adcode": "522700",
        "level": "city",
        "name": "黔南布依族苗族自治州",
        "province": "贵州省"
    },

    // 云南省
    "昆明市": {
        "adcode": "530100",
        "level": "city",
        "name": "昆明市",
        "province": "云南省"
    },
    "曲靖市": {
        "adcode": "530300",
        "level": "city",
        "name": "曲靖市",
        "province": "云南省"
    },
    "玉溪市": {
        "adcode": "530400",
        "level": "city",
        "name": "玉溪市",
        "province": "云南省"
    },
    "保山市": {
        "adcode": "530500",
        "level": "city",
        "name": "保山市",
        "province": "云南省"
    },
    "昭通市": {
        "adcode": "530600",
        "level": "city",
        "name": "昭通市",
        "province": "云南省"
    },
    "丽江市": {
        "adcode": "530700",
        "level": "city",
        "name": "丽江市",
        "province": "云南省"
    },
    "普洱市": {
        "adcode": "530800",
        "level": "city",
        "name": "普洱市",
        "province": "云南省"
    },
    "临沧市": {
        "adcode": "530900",
        "level": "city",
        "name": "临沧市",
        "province": "云南省"
    },
    "楚雄彝族自治州": {
        "adcode": "532300",
        "level": "city",
        "name": "楚雄彝族自治州",
        "province": "云南省"
    },
    "红河哈尼族彝族自治州": {
        "adcode": "532500",
        "level": "city",
        "name": "红河哈尼族彝族自治州",
        "province": "云南省"
    },
    "文山壮族苗族自治州": {
        "adcode": "532600",
        "level": "city",
        "name": "文山壮族苗族自治州",
        "province": "云南省"
    },
    "西双版纳傣族自治州": {
        "adcode": "532800",
        "level": "city",
        "name": "西双版纳傣族自治州",
        "province": "云南省"
    },
    "大理白族自治州": {
        "adcode": "532900",
        "level": "city",
        "name": "大理白族自治州",
        "province": "云南省"
    },
    "德宏傣族景颇族自治州": {
        "adcode": "533100",
        "level": "city",
        "name": "德宏傣族景颇族自治州",
        "province": "云南省"
    },
    "怒江傈僳族自治州": {
        "adcode": "533300",
        "level": "city",
        "name": "怒江傈僳族自治州",
        "province": "云南省"
    },
    "迪庆藏族自治州": {
        "adcode": "533400",
        "level": "city",
        "name": "迪庆藏族自治州",
        "province": "云南省"
    },

    // 西藏自治区
    "拉萨市": {
        "adcode": "540100",
        "level": "city",
        "name": "拉萨市",
        "province": "西藏自治区"
    },
    "日喀则市": {
        "adcode": "540200",
        "level": "city",
        "name": "日喀则市",
        "province": "西藏自治区"
    },
    "昌都市": {
        "adcode": "540300",
        "level": "city",
        "name": "昌都市",
        "province": "西藏自治区"
    },
    "林芝市": {
        "adcode": "540400",
        "level": "city",
        "name": "林芝市",
        "province": "西藏自治区"
    },
    "山南市": {
        "adcode": "540500",
        "level": "city",
        "name": "山南市",
        "province": "西藏自治区"
    },
    "那曲市": {
        "adcode": "540600",
        "level": "city",
        "name": "那曲市",
        "province": "西藏自治区"
    },
    "阿里地区": {
        "adcode": "542500",
        "level": "city",
        "name": "阿里地区",
        "province": "西藏自治区"
    },

    // 陕西省
    "西安市": {
        "adcode": "610100",
        "level": "city",
        "name": "西安市",
        "province": "西藏自治区"
    },
    "铜川市": {
        "adcode": "610200",
        "level": "city",
        "name": "铜川市",
        "province": "西藏自治区"
    },
    "宝鸡市": {
        "adcode": "610300",
        "level": "city",
        "name": "宝鸡市",
        "province": "西藏自治区"
    },
    "咸阳市": {
        "adcode": "610400",
        "level": "city",
        "name": "咸阳市",
        "province": "西藏自治区"
    },
    "渭南市": {
        "adcode": "610500",
        "level": "city",
        "name": "渭南市",
        "province": "西藏自治区"
    },
    "延安市": {
        "adcode": "610600",
        "level": "city",
        "name": "延安市",
        "province": "西藏自治区"
    },
    "汉中市": {
        "adcode": "610700",
        "level": "city",
        "name": "汉中市",
        "province": "西藏自治区"
    },
    "榆林市": {
        "adcode": "610800",
        "level": "city",
        "name": "榆林市",
        "province": "西藏自治区"
    },
    "安康市": {
        "adcode": "610900",
        "level": "city",
        "name": "安康市",
        "province": "西藏自治区"
    },
    "商洛市": {
        "adcode": "611000",
        "level": "city",
        "name": "商洛市",
        "province": "西藏自治区"
    },

    // 青海省
    "西宁市": {
        "adcode": "630100",
        "level": "city",
        "name": "西宁市",
        "province": "青海省"
    },
    "海东市": {
        "adcode": "630200",
        "level": "city",
        "name": "海东市",
        "province": "青海省"
    },
    "海北藏族自治州": {
        "adcode": "632200",
        "level": "city",
        "name": "海北藏族自治州",
        "province": "青海省"
    },
    "黄南藏族自治州": {
        "adcode": "632300",
        "level": "city",
        "name": "黄南藏族自治州",
        "province": "青海省"
    },
    "海南藏族自治州": {
        "adcode": "632500",
        "level": "city",
        "name": "海南藏族自治州",
        "province": "青海省"
    },
    "果洛藏族自治州": {
        "adcode": "632600",
        "level": "city",
        "name": "果洛藏族自治州",
        "province": "青海省"
    },
    "玉树藏族自治州": {
        "adcode": "632700",
        "level": "city",
        "name": "玉树藏族自治州",
        "province": "青海省"
    },
    "海西蒙古族藏族自治州": {
        "adcode": "632800",
        "level": "city",
        "name": "海西蒙古族藏族自治州",
        "province": "青海省"
    },

    // 宁夏回族自治区
    "银川市": {
        "adcode": "640100",
        "level": "city",
        "name": "银川市",
        "province": "宁夏回族自治区"
    },
    "石嘴山市": {
        "adcode": "640200",
        "level": "city",
        "name": "石嘴山市",
        "province": "宁夏回族自治区"
    },
    "吴忠市": {
        "adcode": "640300",
        "level": "city",
        "name": "吴忠市",
        "province": "宁夏回族自治区"
    },
    "固原市": {
        "adcode": "640400",
        "level": "city",
        "name": "固原市",
        "province": "宁夏回族自治区"
    },
    "中卫市": {
        "adcode": "640500",
        "level": "city",
        "name": "中卫市",
        "province": "宁夏回族自治区"
    },

    // 新疆维吾尔自治区
    "乌鲁木齐市": {
        "adcode": "650100",
        "level": "city",
        "name": "乌鲁木齐市",
        "province": "新疆维吾尔自治区"
    },
    "克拉玛依市": {
        "adcode": "650200",
        "level": "city",
        "name": "克拉玛依市",
        "province": "新疆维吾尔自治区"
    },
    "吐鲁番市": {
        "adcode": "650400",
        "level": "city",
        "name": "吐鲁番市",
        "province": "新疆维吾尔自治区"
    },
    "哈密市": {
        "adcode": "650500",
        "level": "city",
        "name": "哈密市",
        "province": "新疆维吾尔自治区"
    },
    "昌吉回族自治州": {
        "adcode": "652300",
        "level": "city",
        "name": "昌吉回族自治州",
        "province": "新疆维吾尔自治区"
    },
    "博尔塔拉蒙古自治州": {
        "adcode": "652700",
        "level": "city",
        "name": "博尔塔拉蒙古自治州",
        "province": "新疆维吾尔自治区"
    },
    "巴音郭楞蒙古自治州": {
        "adcode": "652800",
        "level": "city",
        "name": "巴音郭楞蒙古自治州",
        "province": "新疆维吾尔自治区"
    },
    "阿克苏地区": {
        "adcode": "652900",
        "level": "city",
        "name": "阿克苏地区",
        "province": "新疆维吾尔自治区"
    },
    "克孜勒苏柯尔克孜自治州": {
        "adcode": "653000",
        "level": "city",
        "name": "克孜勒苏柯尔克孜自治州",
        "province": "新疆维吾尔自治区"
    },
    "喀什地区": {
        "adcode": "653100",
        "level": "city",
        "name": "喀什地区",
        "province": "新疆维吾尔自治区"
    },
    "和田地区": {
        "adcode": "653200",
        "level": "city",
        "name": "和田地区",
        "province": "新疆维吾尔自治区"
    },
    "伊犁哈萨克自治州": {
        "adcode": "654000",
        "level": "city",
        "name": "伊犁哈萨克自治州",
        "province": "新疆维吾尔自治区"
    },
    "塔城地区": {
        "adcode": "654200",
        "level": "city",
        "name": "塔城地区",
        "province": "新疆维吾尔自治区"
    },
    "阿勒泰地区": {
        "adcode": "654300",
        "level": "city",
        "name": "阿勒泰地区",
        "province": "新疆维吾尔自治区"
    },
    "石河子市": {
        "adcode": "659001",
        "level": "city",
        "name": "石河子市",
        "province": "新疆维吾尔自治区"
    },
    "阿拉尔市": {
        "adcode": "659002",
        "level": "city",
        "name": "阿拉尔市",
        "province": "新疆维吾尔自治区"
    },
    "图木舒克市": {
        "adcode": "659003",
        "level": "city",
        "name": "图木舒克市",
        "province": "新疆维吾尔自治区"
    },
    "五家渠市": {
        "adcode": "659004",
        "level": "city",
        "name": "五家渠市",
        "province": "新疆维吾尔自治区"
    },
    "北屯市": {
        "adcode": "659005",
        "level": "city",
        "name": "北屯市",
        "province": "新疆维吾尔自治区"
    },
    "铁门关市": {
        "adcode": "659006",
        "level": "city",
        "name": "铁门关市",
        "province": "新疆维吾尔自治区"
    },
    "双河市": {
        "adcode": "659007",
        "level": "city",
        "name": "双河市",
        "province": "新疆维吾尔自治区"
    },
    "可克达拉市": {
        "adcode": "659008",
        "level": "city",
        "name": "可克达拉市",
        "province": "新疆维吾尔自治区"
    },
    "昆玉市": {
        "adcode": "659009",
        "level": "city",
        "name": "昆玉市",
        "province": "新疆维吾尔自治区"
    },
    "胡杨河市": {
        "adcode": "659010",
        "level": "city",
        "name": "胡杨河市",
        "province": "新疆维吾尔自治区"
    },

    // 内蒙古自治区
    "呼和浩特市": {
        "adcode": "150100",
        "level": "city",
        "name": "呼和浩特市",
        "province": "内蒙古自治区"
    },
    "包头市": {
        "adcode": "150200",
        "level": "city",
        "name": "包头市",
        "province": "内蒙古自治区"
    },
    "乌海市": {
        "adcode": "150300",
        "level": "city",
        "name": "乌海市",
        "province": "内蒙古自治区"
    },
    "赤峰市": {
        "adcode": "150400",
        "level": "city",
        "name": "赤峰市",
        "province": "内蒙古自治区"
    },
    "通辽市": {
        "adcode": "150500",
        "level": "city",
        "name": "通辽市",
        "province": "内蒙古自治区"
    },
    "鄂尔多斯市": {
        "adcode": "150600",
        "level": "city",
        "name": "鄂尔多斯市",
        "province": "内蒙古自治区"
    },
    "呼伦贝尔市": {
        "adcode": "150700",
        "level": "city",
        "name": "呼伦贝尔市",
        "province": "内蒙古自治区"
    },
    "巴彦淖尔市": {
        "adcode": "150800",
        "level": "city",
        "name": "巴彦淖尔市",
        "province": "内蒙古自治区"
    },
    "乌兰察布市": {
        "adcode": "150900",
        "level": "city",
        "name": "乌兰察布市",
        "province": "内蒙古自治区"
    },
    "兴安盟": {
        "adcode": "152200",
        "level": "city",
        "name": "兴安盟",
        "province": "内蒙古自治区"
    },
    "锡林郭勒盟": {
        "adcode": "152500",
        "level": "city",
        "name": "锡林郭勒盟",
        "province": "内蒙古自治区"
    },
    "阿拉善盟": {
        "adcode": "152900",
        "level": "city",
        "name": "阿拉善盟",
        "province": "内蒙古自治区"
    },
}