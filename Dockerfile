# Single image for the OrbitOps server (serves the built web app) and the simulator.
# Both run TypeScript through tsx at runtime by design, so the runtime stage keeps the
# workspace sources and dev tooling (tsx) instead of a compiled bundle.
#
# Server (default):   docker run -p 4000:4000 -e JWT_SECRET=... -e DEVICE_API_KEY=... orbitops
# Simulator:          docker run -e SERVER_URL=... -e DEVICE_API_KEY=... orbitops \
#                       node_modules/.bin/tsx packages/simulator/src/index.ts

# ---- Stage 1: install all workspace deps and build the web app ----
FROM node:24-alpine AS build
WORKDIR /app

COPY . .
RUN npm ci && npm run build -w @orbitops/web

# ---- Stage 2: runtime ----
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=4000 \
    SERVE_WEB=true

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/data ./data

# node:alpine images ship an unprivileged "node" user (uid 1000).
USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# Invoke the tsx binary directly rather than via npx so SIGTERM reaches Node and graceful shutdown runs.
CMD ["node_modules/.bin/tsx", "packages/server/src/index.ts"]
