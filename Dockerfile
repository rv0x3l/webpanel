# WebPanel — single-image Dockerfile
# Build:  docker build -t webpanel .
# Run:    docker run -d --name webpanel -p 8787:8787 \
#               -v /var/run/docker.sock:/var/run/docker.sock \
#               -v webpanel-data:/app/backend/data \
#               -e ADMIN_PASSWORD=changeme \
#               webpanel

FROM node:20-bookworm-slim

# Tools used by the panel: docker CLI, systemctl/journalctl (when systemd is exposed), curl, openssh-client for SSH features.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl openssh-client docker.io procps iproute2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend deps first (better layer caching)
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# Copy the rest of the project
COPY backend ./backend
COPY frontend ./frontend

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV DB_PATH=/app/backend/data/panel.db

EXPOSE 8787
VOLUME ["/app/backend/data"]

WORKDIR /app/backend
CMD ["node", "server.js"]
