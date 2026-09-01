# =============================================================================
# lwaiwork backend - multi-stage build
#
# 2026-09-01 优化：用 node:20-bookworm-slim 替代 alpine。理由：
#   - alpine 自带的 apk 包源在国内 ECS 拉取曾卡住 35 分钟
#     (`apk add python3 make g++ libc6-compat` 进程一直被挂起)
#   - Debian bookworm-slim 自带 build-essential/gcc/make，无需外部源
#   - 镜像稍大（~150MB vs alpine ~50MB），但 build 稳定可控
# 镜像源：npm 走 npmmirror.com（淘宝源），避免 Docker Hub network 抖动
# =============================================================================

# ---------- Stage 1: install dependencies ----------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

# bcrypt 是 native 模块，需要 build-essential（Debian 自带，但保险起见还是装）
RUN apt-get update -q && apt-get install -y --no-install-recommends \
    build-essential python3 && rm -rf /var/lib/apt/lists/*

# 切到淘宝源（npm 默认 registry.docker-cn.com 在国内也偶有卡顿）
ENV npm_config_registry=https://registry.npmmirror.com

COPY package.json package-lock.json* ./
# Install every dependency (dev included) because `nest build` needs the TS toolchain
RUN npm ci --include=dev || npm install --include=dev

# ---------- Stage 2: build --------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

RUN apt-get update -q && apt-get install -y --no-install-recommends \
    build-essential python3 && rm -rf /var/lib/apt/lists/*

ENV npm_config_registry=https://registry.npmmirror.com

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Strip devDependencies and rebuild native modules against the runtime base
RUN npm prune --omit=dev && npm rebuild bcrypt

# ---------- Stage 3: runtime ------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# PORT=4000: ECS 8.130.181.74 already occupies 22 / 80 / 443 / 3000, so 3000 is
# unusable. Container listens on 4000; docker-compose publishes it as 4001.
ENV PORT=4000

# tini + curl for healthcheck
RUN apt-get update -q && apt-get install -y --no-install-recommends \
    tini curl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Run as a non-root user (least privilege)
RUN groupadd -g 1001 -r nodejs && useradd -u 1001 -r nestjs -g nodejs
RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
