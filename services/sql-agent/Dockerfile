# 1. 基础底座：使用官方的 Node 24 轻量级镜像
FROM node:24

# 2. 安装 OpenSSL (Prisma 在 Linux 环境下生成 Client 所需的底层依赖)
RUN apt-get update -y && apt-get install -y openssl

# 3. 在集装箱里建一个工作目录
WORKDIR /app

# 4. 先把依赖账本拷进去，并安装依赖包
COPY package*.json ./
RUN npm install

# 5. 把你的 ts 代码、prisma 图纸全拷进去
COPY . .

# 6. 极其核心的一步：必须在 Docker 内部重新生成 Prisma Client！
# 因为你本地是 Windows/Mac，而 Docker 里是 Linux，底层引擎不一样
RUN npx prisma generate

# 7. 暴露出你服务器的 3000 端口
EXPOSE 3000

# 8. 启动命令（就是你 package.json 里配置的那个 start 命令）
CMD ["npm", "run", "start"]