# back_con 后端项目介绍

## 一、项目概述
这是一个基于 Express 的 Node.js 后端服务项目，名为 "ming"，主要提供数据管理、用户权限控制、文件上传等功能。

## 二、技术栈
- **核心框架**: Express 4.17.1
- **数据库**: MySQL 2.18.1 (连接池方式)
- **身份验证**: JWT (jsonwebtoken)
- **其他依赖**:
  - cors: 处理跨域请求
  - multer: 文件上传
  - svg-captcha: 图形验证码
  - log4js: 日志记录
  - xlsx/csv-parser: Excel/CSV 文件处理

## 三、核心文件说明

### 1. app.js (主入口文件)
**功能**: 初始化 Express 服务器，配置中间件和路由
- 监听端口: 3000
- 中间件配置:
  - CORS 跨域支持（允许所有来源）
  - 静态资源服务（public 目录）
  - JSON 请求体解析
- 身份验证中间件: 检查用户是否被禁用
- 全局错误处理: 记录未处理的 Promise 拒决和异常

### 2. pool.js (数据库连接池)
**功能**: 管理 MySQL 数据库连接
- 数据库配置:
  - 主机: 127.0.0.1
  - 端口: 3306
  - 数据库: vue_admin
  - 用户: vue_user
- 连接池设置:
  - 最大连接数: 15
  - 日期以字符串格式返回
- 启动时测试连接状态

### 3. utils/index.js (工具函数库)
**核心工具方法**:
- **setToken/verToken**: JWT 令牌生成和验证
- **returnData**: 统一响应格式封装
- **getUserInfo**: 获取当前登录用户信息
- **getUserRole**: 获取用户角色权限
- **checkPermi**: 菜单权限验证
- **checkRole**: 角色权限验证
- **pageSize**: 分页 SQL 处理
- **getSum**: 获取查询总数
- **setLike**: 模糊查询条件添加
- **existName**: 检查名称是否重复

### 4. utils/config.js (配置文件)
- 文件上传路径: public
- 文件主机地址: http://127.0.0.1:3000

## 四、路由模块结构

### /admin (管理相关路由 - system/admin.js)
**主要功能**:
1. **登录认证**
   - 登录接口（验证