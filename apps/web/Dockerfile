FROM node:24-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
ARG VITE_LIVEKIT_URL
ARG VITE_GIPHY_API_KEY
ENV VITE_LIVEKIT_URL=$VITE_LIVEKIT_URL
ENV VITE_GIPHY_API_KEY=$VITE_GIPHY_API_KEY
RUN pnpm --filter web build

FROM nginxinc/nginx-unprivileged:1.28-alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080
