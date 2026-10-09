FROM node:22-bookworm-slim AS workspace
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY shared ./shared
COPY backend ./backend
COPY workers ./workers
COPY web ./web
COPY scripts ./scripts
COPY tests ./tests
RUN pnpm install --no-frozen-lockfile
RUN pnpm run build:shared
RUN pnpm --filter @mission-runner/backend build
RUN pnpm --filter @mission-runner/github-worker build
RUN pnpm --filter @mission-runner/browser-worker build
RUN pnpm --filter @mission-runner/web build

FROM workspace AS backend-runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["pnpm","--filter","@mission-runner/backend","start"]

FROM workspace AS github-runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8791
EXPOSE 8791
CMD ["pnpm","--filter","@mission-runner/github-worker","start"]

FROM workspace AS browser-runtime
RUN pnpm --filter @mission-runner/browser-worker exec playwright install --with-deps chromium
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8792 BROWSER_HEADLESS=true
EXPOSE 8792
CMD ["pnpm","--filter","@mission-runner/browser-worker","start"]

FROM nginx:1.28-alpine AS web-runtime
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=workspace /app/web/dist /usr/share/nginx/html
EXPOSE 80
