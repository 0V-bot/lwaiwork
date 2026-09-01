# =============================================================================
# lwaiwork backend - multi-stage build (node:20-alpine)
# Stage 1 deps -> Stage 2 build -> Stage 3 runtime (production only)
# =============================================================================

# ---------- Stage 1: install dependencies ----------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# bcrypt is a native addon: it needs a toolchain to compile against alpine/musl
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json* ./
# Install every dependency (dev included) because `nest build` needs the TS toolchain
RUN npm ci --include=dev || npm install --include=dev

# ---------- Stage 2: build --------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache python3 make g++ libc6-compat

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build

# Strip devDependencies and rebuild native modules against the runtime base
RUN npm prune --omit=dev && npm rebuild bcrypt

# ---------- Stage 3: runtime ------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# PORT=4000: ECS 8.130.181.74 already occupies 22 / 80 / 443 / 3000, so 3000 is
# unusable. Container listens on 4000; docker-compose publishes it as 4001.
ENV PORT=4000

# curl is only used by the container healthcheck
RUN apk add --no-cache tini curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Run as a non-root user (least privilege)
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nestjs -G nodejs
RUN chown -R nestjs:nodejs /app
USER nestjs

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:4000/api/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
