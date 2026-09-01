# =============================================================================
# lwaiwork backend - 极简 Dockerfile（2026-09-01 第四次迭代）
#
# 痛点回顾：
#   v1 (alpine):  apk add 卡 35+ 分钟（海外源在国内 ECS 不可达）
#   v2 (bookworm): apt install 卡 10+ 分钟（同上，mirrors.aliyuncs.com 也偶发卡）
#   v3 (bookworm-only-runtime): apt install tini/curl 卡住
#   v4 (本版):     完全不调用 apt。删 tini 也不要了；healthcheck 用 node 内置 http
#
# 极简化：
#   - 唯一的 apt 调用：删掉
#   - 唯一外部网络调用：npm（淘宝源 + main deps，没 native build）
#   - 健康检查：node 内置的 http.get 取代 curl
#   - 进程模型：node 内置 signal 处理（SIGTERM）足够做容器级优雅退出，省 tini
# =============================================================================

# ---------- Stage 1: dependencies ----------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

ENV npm_config_registry=https://registry.npmmirror.com \
    npm_config_loglevel=warn

COPY package.json package-lock.json* ./
# Use `npm install` (not `npm ci`) so an outdated lockfile won't block build;
# the deploy host has no way to run a separate lockfile-sync step, and
# `npm install` is fast enough on the ECS mirror (~10-30s extra per build).
# If lockfile is missing entirely, npm install generates a fresh one inside
# the build stage - the host filesystem's lockfile (which may be outdated
# from a Windows-side dev env) is NOT touched.
RUN npm install --omit=optional --no-audit --no-fund

# ---------- Stage 2: build (tsc only) ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV npm_config_registry=https://registry.npmmirror.com

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx tsc -p tsconfig.build.json

# ---------- Stage 3: runtime ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000

# 直接 COPY 编译产物 + node_modules
COPY --from=builder /app/dist ./dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 非 root 用户
RUN groupadd -g 1001 -r nodejs && useradd -u 1001 -r nestjs -g nodejs && \
    chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 4000

# healthcheck: 不用 curl（避免 apt 安装），用 node 内置 http
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:4000/api/health',(r)=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/main.js"]
