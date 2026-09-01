# --------------------------------------------------------------------------
# lwaiwork frontend - multi-stage build
#
# 2026-09-01 优化：用 node:20-bookworm-slim 替代 alpine
#   （同 backend，详见后端 Dockerfile 注释）
#   npm 切到淘宝源 npmmirror.com
# --------------------------------------------------------------------------

# --------------------------------------------------------------------------
# Stage 1 - dependencies
# --------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps
WORKDIR /app

ENV npm_config_registry=https://registry.npmmirror.com

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# --------------------------------------------------------------------------
# Stage 2 - build
# NEXT_PUBLIC_* variables are inlined into the JS bundle at build time, so the
# API URL MUST be passed as a build-arg here. Setting it at runtime later has
# no effect.
# --------------------------------------------------------------------------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

ENV npm_config_registry=https://registry.npmmirror.com

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --------------------------------------------------------------------------
# Stage 3 - runtime
# `output: 'standalone'` (next.config.mjs) makes Next emit a self-contained
# server.js with only the node_modules it actually needs.
# --------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd -g 1001 -r nodejs && useradd -u 1001 -r nextjs -g nodejs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/login').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
