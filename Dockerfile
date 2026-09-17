FROM --platform=$BUILDPLATFORM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-alpine
ARG BUILD_DATE
ARG VCS_REF
ARG VERSION=dev
LABEL org.opencontainers.image.title="OPL Fleet Cockpit Gateway" \
      org.opencontainers.image.description="Self-hosted OPL Fleet telemetry gateway and cockpit server" \
      org.opencontainers.image.created="${BUILD_DATE}" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/gaofeng21cn/opl-fleet-cockpit"
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY scripts/discover-unifi.mjs ./scripts/discover-unifi.mjs
COPY src/load-model.mjs ./src/load-model.mjs
COPY src/status-history.mjs ./src/status-history.mjs
COPY kiosk-release ./kiosk-release
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1
CMD ["node", "server/server.mjs"]
