import Mock from "mockjs";
//处理路径传参
import { parameteUrl } from "@/utils/query-param"
import { climateRegions, climateTypeToValue, provinceCities, antiqueType } from "../views/index/bottom.map";
import { cpuUsage } from "process";
import { regionCodes } from "@/views/index/center.map";

function ArrSet(Arr: any[], id: string): any[] {
    let obj: any = {}
    const arrays = Arr.reduce((setArr, item) => {
        obj[item[id]] ? '' : (obj[item[id]] = true && setArr.push(item))
        return setArr
    }, [])
    return arrays
}

/**
* @description: min ≤ r ≤ max  随机数
* @param {*} Min
* @param {*} Max
* @return {*}
*/

function RandomNumBoth(Min: any, Max: any) {
    var Range = Max - Min;
    var Rand = Math.random();
    var num = Min + Math.round(Rand * Range); //四舍五入
    return num;
}

// 根据params去匹配搜索字典中的对应province和所属气候片区（要对应颜色渲染）
// 先匹配当前的level是city还是province，如果是city则要使用其province信息来匹配气候片区，因为没有定义子城市的气候片区
export function getRegionNameByAdcode(regionCode: string | number) {
  for (const key in regionCodes) {
    const region = regionCodes[key];

    if (String(region.adcode) === String(regionCode)) {
      const name = region.name;
      const level = region.level;

      // 省级直接用 name，市级用 province 去匹配气候片区
      const climateMatchName =
        level === "city" ? region.province : region.name;

      console.log("region match name =", name);
      console.log("climate match name =", climateMatchName);

      for (const climate in climateRegions) {
        if (climateRegions[climate].includes(climateMatchName)) {
          return {
            name,
            climate,
            level,
            adcode: region.adcode,
            province: region.province || region.name,
          };
        }
      }
      // 找到了行政区，但没找到气候片区
      return {
        name,
        climate: null,
        level,
        adcode: region.adcode,
        province: region.province || region.name,
      };
    }
  }
  return null;
}

//左中
export default [
    {
        url: "/bigscreen/countUserNum",
        type: "get",
        response: () => {
            const a = Mock.mock({
                success: true,
                data: {
                    relicNum: '@integer(0, 100)',
                    metalNum: '@integer(0, 100)',
                    paperNum: '@integer(0, 100)',
                    textileNum: '@integer(0, 100)',
                    jadeNum: '@integer(0, 100)',
                    stoneNum: '@integer(0, 100)',
                    potteryNum: '@integer(0, 100)',
                    otherNum: '@integer(0, 100)',
                }
            })
            a.data.totalNum = a.data.relicNum + a.data.metalNum + a.data.paperNum + a.data.textileNum + a.data.jadeNum + a.data.stoneNum + a.data.potteryNum + a.data.otherNum
            return a
        },
    },
    {
        url: "/bigscreen/countDeviceNum",
        type: "get",
        response: () => {
            const a = Mock.mock({
                success: true,
                data: {
                    stationNum: '@integer(10, 1000)',
                    recordeddaysNum: '@integer(365, 730)',
                    recordedmessageNum: '@integer(500, 1000)',
                    errormessageNum: '@integer(0, 50)'
                }
            })
            // a.data.onlineNum = a.data.totalNum - a.data.offlineNum
            return a
        }
    },
    //左下
    {
        url: "/bigscreen/leftBottom",
        type: "get",
        response: () => {
            const a = Mock.mock({
                success: true,
                data: {
                    "list|20": [
                        {
                            provinceName: "@province()",
                            cityName: '@city()',
                            countyName: "@county()",
                            createTime: "@datetime('yyyy-MM-dd HH:mm:ss')",
                            deviceId: "6c512d754bbcd6d7cd86abce0e0cac58",
                            "gatewayno|+1": 10000,
                            "onlineState|1": [0, 1],

                        }
                    ]
                }
            })
            return a
        }
    },
    //右上
    {
        url: "/bigscreen/alarmNum",
        type: "get",
        response: () => {
            const a = Mock.mock({
                success: true,
                data: {
                    dateList: ['2021-11', '2021-12', '2022-01', '2022-02', '2022-03', "2022-04"],
                    "numList|6": [
                        '@integer(0, 1000)'
                    ],
                    "numList2|6": [
                        '@integer(0, 1000)'
                    ]
                }
            })
            return a
        }
    },
    //右中
    {
        url: "/bigscreen/ranking",
        type: "get",
        response: () => {

            // 遍历类型，生成数据
            let antique = Object.keys(antiqueType).map(type => {
                return {
                    name: type,
                    value: Mock.Random.integer(0, 100)
                };
            });

            // 按 value 从大到小排序（如果需要）
            // antique = antique.sort((a, b) => b.value - a.value);

            let a = {
                success: true,
                data: antique
            }
            return a
        }
    },
    //右下
    {
        url: "/bigscreen/rightBottom",
        type: "get",
        response: () => {
            const a = Mock.mock({
                success: true,
                data: {
                    "list|40": [{
                        alertdetail: "@csentence(5,10)",
                        "alertname|1": ["水浸告警", "各种报警"],
                        alertvalue: "@float(60, 200)",
                        createtime: "2022-04-19 08:38:33",
                        deviceid: null,
                        "gatewayno|+1": 10000,
                        phase: "A1",
                        sbInfo: "@csentence(10,18)",
                        "terminalno|+1": 100,
                        provinceName: "@province()",
                        cityName: '@city()',
                        countyName: "@county()",
                    }],

                }
            })
            return a
        }
    },
    //安装计划
    {
        url: "/bigscreen/installationPlan",
        type: "get",
        response: () => {

            let num = RandomNumBoth(26, 32);
            const a = Mock.mock({
                ["category|" + num]: ["@city()"],
                ["barData|" + num]: ["@integer(10, 100)"],
            })
            let lineData = [], rateData = [];
            for (let index = 0; index < num; index++) {
                let lineNum = Mock.mock('@integer(0, 100)') + a.barData[index]
                lineData.push(lineNum)
                let rate = a.barData[index] / lineNum;
                rateData.push((rate * 100).toFixed(0))
            }
            a.lineData = lineData
            a.rateData = rateData
            return {
                success: true,
                data: a
            }
        }
    },

    // 模拟地图数据接口（GET请求接口，用来返回地图需要的数据） 
    {
        url: "/bigscreen/centerMap",
        type: "get",
        response: (options: any) => {
            let params = parameteUrl(options.url)   // 自定义函数，用来从url中解析出参数（params获取url中的regioncode）
            
            // 若不是全局的中国地图，返回省内各城市数据
            if (params.regionCode && !["china"].includes(params.regionCode)) {

                console.log("param_infoooo123 = ", params)
                // 根据点击获取的行政编码去匹配对用城市信息和所属气候类型
                const param_info = getRegionNameByAdcode(params.regionCode)
                const fixedCityData: any[] = [];
                console.log("param_infoooo = ", param_info)

                if (!param_info || !param_info.climate) {   // 确保传入paraminfo可以处理异常值
                    throw new Error('找不到气候类型');
                }

                const provinceName = param_info.level === "city" ? 
                    param_info.province : param_info.name;

                const provinceKey = provinceName.slice(0, 2);

                if (provinceCities[provinceKey] == undefined) {   // 如果点击区域是直辖市则不做任何操作
                    window["$message"].warning("暂无下级地市");
                    throw new Error('直辖市，无下级城市');
                }

                Object.entries(provinceCities[provinceKey]).forEach(city => {
                    fixedCityData.push({
                        name: city[1],
                        value: climateTypeToValue[param_info.climate],
                        climate: param_info?.climate
                    });
                });
                console.log("fixedCityData = ", fixedCityData)

                return {
                    success: true,
                    data: {
                        dataList: fixedCityData,
                        regionCode: params.regionCode
                    }
                };
            } 
            // 目前是china并且climateID等于undefined表示当前是大屏中间地图的多气候片区渲染
            else if (params.regionCode && ["china"].includes(params.regionCode) && params.climateID == undefined){ 
                // 手动生成基于气候分区的省份数据
                const fixedClimateData: any[] = [];
                Object.entries(climateRegions).forEach(([climate, provinces]) => {
                    provinces.forEach(province => {
                        fixedClimateData.push({
                            name: province,
                            value: climateTypeToValue[climate],
                            climate: climate
                        });
                        // console.log("检查信息: ", climate, climateTypeToValue[climate])
                    });
                });

                return {
                    success: true,
                    data: {
                        dataList: fixedClimateData,
                        regionCode: 'china'
                    }
                };
            } 
            // 六个气候片区个别的区域渲染
            else {
                // 手动生成基于气候分区的省份数据
                const fixedClimateData: any[] = [];
                const climate_entry = Object.entries(climateRegions)
                // console.log(" climate_entry: ",  climate_entry)
                const [climate, provinces] = climate_entry[params.climateID]; // 解构出 key 和 value
                // console.log("各气候片区的数值： ", climate_entry[params.climateID])
                provinces.forEach(province => {
                    fixedClimateData.push({
                        name: province,
                        value: climateTypeToValue[climate],  
                        climate: climate
                    });
                });

                // 打印输出内容以供检查
                // console.log("生成的气候区数据：", fixedClimateData);

                return {
                    success: true,
                    data: {
                        dataList: fixedClimateData,
                        regionCode: 'china'
                    }
                };
            }
        }
    },

    //CPU状态
    {
			url: "/bigscreen/CPUStatus",
			type:"get",
			response: () => {
				const a = Mock.mock({
					success: true,
					data: {
						CPUUsage: '@integer(10, 90)'
					}
				})
				return a;
			}
    },
		//气象信息
		{
			url: "/bigscreen/WeatherInfo",
			type: "get",
			response: () => {
				const a = Mock.mock({
					success: true,
					data: {
						WeatherStationCode : '@integer(1001099999, 1001199999)',
						Date : '2022/1/1',
						Latitude : '@integer(0, 90)',
						Longtitude : '@integer(0, 90)',
						HeightOfMeteorologicalStation : '@integer(0, 8848)',
						NameOfMeteorologicalStation : "JAN MAYEN NOR NAVY, NO",
						AverageTemperature : '@integer(0, 100)',
						AttributesOfAverageTemperature : 19,
						AverageDewPoint : '@integer(0, 5)',
						AttributesOfAverageDewPoint : 19,
						AverageSeaLevelPressure : '@integer(1010, 1012)',
						AttributesOfAverageSeaLevelPressure : 19,
						AverageObservatoryPressure : '@integer(0, 10)',
						AttributesOfAverageObservatoryPressure : 19,
						AverageVisibility : '@integer(0, 1000)',
						AttributesOfAverageVisibility : 4,
						AverageWindSpeed : '@integer(0, 80)',
						AttributesOfAverageWindSpeed : 19,
						MaximumSustainedWindSpeed : '@integer(20, 90)',
						AttributesOfMaximumSustainedWindSpeed : 35.5,
						HighestTemperature : '@integer(20, 50)',
						AttributesOfHighestTemperature : null,
						LowestTemperature : '@integer(0, 20)',
						AttributesOfLowestTemperature : null,
						Precipitation : '@integer(0, 90)',
						AttributesOfPrecipitation : "E",
						DepthOfSnow : '@integer(0, 90)',
						Indicator : 1000,
					}
				})
				return a;
			}
		}
];

