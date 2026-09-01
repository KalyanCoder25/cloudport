# CloudPort application image: cloudport:1.0.0
#
# This image runs ONLY the backend API + deterministic workload engine
# (application/backend). It intentionally does not bundle the frontend --
# the dashboard is a separate static build (see application/frontend) served
# independently (e.g. via `npm run build` + any static file host, or
# `npm run dev` during development). This keeps the experimental workload
# container minimal and reduces its attack surface / build time inside Kind.

FROM node:20-alpine AS base
WORKDIR /app

# Install backend dependencies only (production).
COPY application/backend/package.json ./application/backend/package.json
RUN cd application/backend && npm install --omit=dev --no-audit --no-fund

# Copy source needed at runtime: backend + the analyzer modules it imports.
COPY application/backend ./application/backend
COPY analyzer ./analyzer

ENV NODE_ENV=production
ENV PORT=4000
ENV APP_VERSION=cloudport:1.0.0

EXPOSE 4000

# Basic container-level healthcheck hitting the app's own /health endpoint.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+(process.env.PORT||4000)+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["node", "application/backend/src/server.js"]
