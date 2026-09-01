# =============================================================================
# lwaiwork backend - 极简 Dockerfile
#
# 2026-09-01 优化（绕开 alpine / Debian 在国内 ECS 的网络卡死）：
#   - base image: node:20-bookworm-slim（自带 node + tini-free 路径，
#     但我们不用 tini —— 直接 CMD node 也行）
#   - 不装 apt 包（不卡 build-essential），用 bcryptjs（纯 JS）替代 native bcrypt
#   - npm registry 切 npmmirror.com（淘宝源）
#   - 三阶段：deps（仅 install）→ build（仅 tsc）→ runtime（仅 dist + node_modules）
# =============================================================================

# ---------- Stage 1: dependencies（无 native build） ---------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# npmmirror 国内源（避免 Docker Hub 抖动）
ENV npm_config_registry=https://registry.npmmirror.com \
    npm_config_loglevel=warn

COPY package.json package-lock.json* ./
# --omit=optional: 跳过 optional deps（如 fsevents），避免触发 prebuilt binary 网络
# 但保留 main deps（含 bcryptjs）
RUN npm ci --omit=optional

# ---------- Stage 2: build --------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV npm_config_registry=https://registry.npmmirror.com

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# 单独 tsc 编译（不用 nest build 因为它会调 rimraf，沙箱偶有干扰；用 tsc 直跑同效果）
RUN npx tsc -p tsconfig.build.json

# ---------- Stage 3: runtime ------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# tini + curl（healthcheck 用）—— debian 镜像自带 curl 但 tini 没有
# apt 安装最小集（已实测在阿里云 ECS mirrors 上秒级）
RUN apt-get update -q && \
    apt-get install -y --no-install-recommends tini curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 非 root 用户
RUN groupadd -g 1001 -r nodejs && useradd -u 1001 -r nestjs -g nodejs && \
    chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
