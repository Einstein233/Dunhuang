import { GET, POST, FILE, FILEPOST, PUT, GETNOBASE } from "../api";

const indexUrl = {
  leftTop: "/bigscreen/countDeviceNum",
  leftCenter: "/bigscreen/countUserNum",
  centerMap: "/bigscreen/centerMap",
  centerBottom: "/bigscreen/installationPlan",
  leftBottom: "/bigscreen/leftBottom",
  rightTop: "/bigscreen/alarmNum",
  rightBottom: "/bigscreen/rightBottom",
  rightCenter: "/bigscreen/ranking",
  CPUStatus: "/bigscreen/CPUStatus",
  WeatherInfo: "/bigscreen/WeatherInfo",
  weatherDashboard: "/bigscreen/weatherDashboard",
};

export default indexUrl;

export const countDeviceNum = (param: any = {}) => {
  return GET(indexUrl.leftTop, param);
};

export const countUserNum = (param: any = {}) => {
  return GET(indexUrl.leftCenter, param);
};

export const leftBottom = (param: any = {}) => {
  return GET(indexUrl.leftBottom, param);
};

export const centerMap = (param: any = {}) => {
  return GET(indexUrl.centerMap, param);
};

export const installationPlan = (param: any = {}) => {
  return GET(indexUrl.centerBottom, param);
};

export const alarmNum = (param: any = {}) => {
  return GET(indexUrl.rightTop, param);
};

export const ranking = (param: any = {}) => {
  return GET(indexUrl.rightCenter, param);
};

export const rightBottom = (param: any = {}) => {
  return GET(indexUrl.rightBottom, param);
};

export const CPUStatus = (param: any = {}) => {
  return GET(indexUrl.CPUStatus, param);
};

export const WeatherInfo = (param: any = {}) => {
  return GET(indexUrl.WeatherInfo, param);
};

export const weatherDashboard = (param: any = {}) => {
  return GETNOBASE(`http://localhost:3000${indexUrl.weatherDashboard}`, param);
};

export { GET, POST, FILE, FILEPOST, PUT, GETNOBASE };
