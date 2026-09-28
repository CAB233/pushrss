FROM docker.io/denoland/deno:2.9.7 AS builder
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY . .
RUN deno install --frozen && deno task build:web \
    && deno bundle --platform=deno --minify --frozen-lockfile \
       --output=dist/server/main.js packages/platform/deno/main.ts

FROM docker.io/denoland/deno:distroless-2.9.7
ENV DENO_DIR=/deno-dir \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/data/pushrss.db \
    PUSHRSS_WEB_DIR=/app/apps/web/dist
WORKDIR /app
# 保持迁移目录相对后端入口的位置，供 import.meta.url 定位。
COPY --from=builder /app/dist/server/main.js ./packages/platform/deno/main.js
COPY --from=builder /app/packages/db/migrations/ ./packages/db/migrations/
COPY --from=builder /app/apps/web/dist/ ./apps/web/dist/
COPY --from=builder /app/scripts/backup.ts ./scripts/backup.ts
RUN ["/bin/deno", "eval", "Deno.mkdirSync('/data', { recursive: true })"]
VOLUME ["/data"]
EXPOSE 8000
CMD ["run", "--no-config", "--no-lock", "--cached-only", "--allow-net", "--allow-read", "--allow-write=/data", "--allow-env", "packages/platform/deno/main.js"]
