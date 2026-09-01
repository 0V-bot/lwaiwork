# =============================================================================
# lwaiwork frontend - 极简 Dockerfile（与 backend 同代）
#
# 同样去掉所有 apt 调用。Next.js standalone 自带 static 资产 + server.js，
# 不需要额外 runtime 依赖。healthcheck 用 node 内置的 http。
# =============================================================================

# Stage 1: deps
FROM node:20-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_registry=https://registry.npmmirror.com
COPY package.json package-lock.json* ./
# Use `npm install` (not `npm ci`) so an outdated lockfile won't block build;
# see backend/Dockerfile for the full rationale.
RUN npm install --omit=optional --no-audit --no-fund

# Stage 2: build
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ENV npm_config_registry=https://registry.npmmirror.com
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# Stage 3: runtime
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder --chown=1001:1001 /app/.next/standalone ./
COPY --from=builder --chown=1001:1001 /app/.next/static ./.next/static
COPY --from=builder --chown=1001:1001 /app/public ./public
RUN groupadd -g 1001 -r nodejs && useradd -u 1001 -r nextjs -g nodejs

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||3000)+'/login',(r)=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server.js"]
