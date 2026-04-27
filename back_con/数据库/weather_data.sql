-- 当前气象相关表结构
-- 导出时间: 2026-04-27
-- 当前项目使用数据库: dunhuang_agent
-- 说明:
-- 1. 本文件只包含当前生效的气象相关表结构，不包含业务数据。
-- 2. 当前生效表为 station_info、weather_directory、weather_data。
-- 3. 旧字段 precipitation、windgusts_max、winddirection_dominant 已不再使用。

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS `dunhuang_agent`
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_general_ci;

USE `dunhuang_agent`;

DROP TABLE IF EXISTS `station_info`;
CREATE TABLE `station_info` (
  `station_code` varchar(50) NOT NULL COMMENT '站点编码',
  `province` varchar(50) NOT NULL COMMENT '省份',
  `city` varchar(50) NOT NULL COMMENT '城市',
  `latitude` decimal(10,8) DEFAULT NULL COMMENT '纬度',
  `longitude` decimal(11,8) DEFAULT NULL COMMENT '经度',
  `granularity` tinyint NOT NULL DEFAULT '2' COMMENT '颗粒度: 1=15分钟 2=小时 3=天',
  `create_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`station_code`, `granularity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='站点省市与坐标映射表';

DROP TABLE IF EXISTS `weather_directory`;
CREATE TABLE `weather_directory` (
  `id` int NOT NULL AUTO_INCREMENT COMMENT '主键',
  `province` varchar(50) NOT NULL COMMENT '省份',
  `city` varchar(50) NOT NULL COMMENT '城市',
  `station_code` varchar(50) NOT NULL DEFAULT 'UNKNOWN' COMMENT '气象站点编码',
  `granularity` tinyint NOT NULL COMMENT '采集颗粒度: 1=15分钟 2=小时 3=天',
  `start_time` datetime NOT NULL COMMENT '采集起始时间',
  `end_time` datetime NOT NULL COMMENT '采集结束时间',
  `total_count` int NOT NULL DEFAULT '0' COMMENT '数据总条数',
  `update_time` timestamp NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP COMMENT '最后更新时间',
  `create_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_prov_city_station_gran` (`province`, `city`, `station_code`, `granularity`),
  KEY `idx_province_city` (`province`, `city`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='气象站点目录索引表';

DROP TABLE IF EXISTS `weather_data`;
CREATE TABLE `weather_data` (
  `station_code` varchar(50) NOT NULL DEFAULT 'UNKNOWN' COMMENT '气象站点编码',
  `granularity` tinyint NOT NULL COMMENT '采集颗粒度: 1=15分钟 2=小时 3=天',
  `record_time` datetime NOT NULL COMMENT '数据记录时间',
  `avg_temperature` decimal(7,2) DEFAULT NULL COMMENT '气温(°C)',
  `relativehumidity_2m` int DEFAULT NULL COMMENT '相对湿度(%)',
  `rain_sum` decimal(8,2) DEFAULT NULL COMMENT '降雨量(mm)',
  `snow_sum` decimal(8,2) DEFAULT NULL COMMENT '降雪量(mm)',
  `max_continuous_wind_speed` decimal(6,2) DEFAULT NULL COMMENT '风速(m/s)',
  `shortwave_radiation_sum` decimal(8,2) DEFAULT NULL COMMENT '短波辐射(W/m^2)',
  `create_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`station_code`, `granularity`, `record_time`),
  KEY `idx_weather_data_time_station` (`record_time`, `station_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci COMMENT='小时级气象事实表';

SET FOREIGN_KEY_CHECKS = 1;
