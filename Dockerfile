FROM docker.io/denoland/deno:2.9.7 AS builder
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY . .
RUN deno install --frozen && deno task build:web

FROM docker.io/denoland/deno:2.9.7
ENV DENO_DIR=/deno-dir \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/data/pushrss.db \
    PUSHRSS_WEB_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=builder /deno-dir /deno-dir
COPY --from=builder /app /app
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8000
CMD ["run", "--cached-only", "--allow-net", "--allow-read", "--allow-write=/data", "--allow-env", "packages/platform/deno/main.ts"]
