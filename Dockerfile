# Multi-stage build for @petal/core, the deployable Next.js shell.
# Build from the repo root:
#   docker build -t petal --build-arg FRAPPE_SOCKETIO_URL=http://frappe:9000 .
#
# Runtime env (read on every request, no rebuild needed):
#   FRAPPE_BACKEND_URL   Frappe site URL the proxy talks to
#   FRAPPE_SITE_NAME     Frappe site name, if it differs from the backend hostname
#   PETAL_APPS           JSON array of custom apps (overrides petal.config.ts)
#   PETAL_TENANTS        JSON object keyed by hostname — enables multi-tenancy
# Build-time args (Next.js serializes rewrites and NEXT_PUBLIC_* at build):
#   FRAPPE_SOCKETIO_URL  realtime server (default: backend host on :9000)
#   PETAL_REALTIME=0     disable realtime entirely

FROM node:20-slim AS base
RUN corepack enable && corepack prepare pnpm@10 --activate

FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages ./packages
COPY tooling ./tooling
RUN pnpm install --frozen-lockfile

FROM base AS builder
ARG FRAPPE_SOCKETIO_URL
ARG PETAL_REALTIME=1
ENV FRAPPE_SOCKETIO_URL=$FRAPPE_SOCKETIO_URL \
    PETAL_REALTIME=$PETAL_REALTIME \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY --from=deps /repo /repo
COPY . .
RUN pnpm --filter @petal/core... build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 petal

# .next/standalone already contains a pruned node_modules with only the
# packages actually required at runtime (traced by Next.js).
COPY --from=builder --chown=petal:nodejs /repo/packages/core/.next/standalone ./
COPY --from=builder --chown=petal:nodejs /repo/packages/core/.next/static ./packages/core/.next/static
COPY --from=builder --chown=petal:nodejs /repo/packages/core/public ./packages/core/public
# Static app config written by withPetal() at build time; read via fs at runtime,
# so Next's output tracing doesn't pick it up on its own.
COPY --from=builder --chown=petal:nodejs /repo/packages/core/.petal ./packages/core/.petal

USER petal
EXPOSE 3000
CMD ["node", "packages/core/server.js"]
