FROM node:20-bullseye AS nodebase
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM python:3.11-bullseye AS pybase
WORKDIR /py
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

FROM node:20-bullseye AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=nodebase /app/node_modules ./node_modules
COPY . .
RUN mkdir -p public
RUN npm run build

FROM node:20-bullseye
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

# 前端产物与依赖
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=nodebase /app/node_modules ./node_modules

# 后端代码与依赖
COPY --from=pybase /usr/local /usr/local
COPY backend/app ./backend/app

# 进程管理：使用一个 Node 进程 + 一个 Uvicorn 后端
# 简单起见用 sh 启动二者
EXPOSE 3000 8000

CMD sh -c "uvicorn backend.app.main:app --host 0.0.0.0 --port 8000 & npm run start"


