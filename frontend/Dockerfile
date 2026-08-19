# Build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Tránh OOM / treo im lặng khi tsc+vite trên máy Docker ít RAM
ENV CI=true \
    NODE_OPTIONS=--max-old-space-size=4096 \
    NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Vite transpile TS trực tiếp. `tsc -b` trên Alpine/Docker nhỏ dễ treo hoặc bị kill.
# Typecheck vẫn chạy local: npm run typecheck
RUN npm run build:docker

# Serve stage — mặc định proxy tới service `backend` (all-in-docker).
# USB host compose mount nginx-ui.conf đè file này.
FROM nginx:1.27-alpine
COPY nginx.docker-backend.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
