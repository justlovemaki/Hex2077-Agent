# 使用 Node.js 20 镜像
FROM node:20-slim

# 设置工作目录
WORKDIR /app

# 安装必要的构建依赖（针对 pdf-parse 和 mammoth 可能需要的系统库）
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装依赖
RUN npm install

# 复制所有源代码
COPY . .

# 编译 TypeScript
RUN npm run build

# 暴露服务端口
EXPOSE 3000

# 设置数据持久化卷
VOLUME [ "/app/data" ]

# 启动命令
CMD ["npm", "run", "start"]
