FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

ENV NODE_OPTIONS="--max-old-space-size=512"

EXPOSE 3100

CMD ["npx", "ts-node", "--transpile-only", "src/index.ts"]
