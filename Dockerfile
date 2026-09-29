FROM docker.io/denoland/deno:2.9.7 AS builder
ENV DENO_DIR=/deno-dir
WORKDIR /app
COPY . .
RUN deno install --frozen && deno task build:web \
    && deno bundle --platform=deno --minify --frozen-lockfile \
       --output=dist/server/main.js packages/platform/deno/main.ts
RUN mkdir -p /runtime/app/packages/platform/deno /runtime/app/packages/db \
             /runtime/app/apps/web /runtime/app/scripts /runtime/data \
    && cp dist/server/main.js /runtime/app/packages/platform/deno/main.js \
    && cp -r packages/db/migrations /runtime/app/packages/db/ \
    && cp -r apps/web/dist /runtime/app/apps/web/ \
    && cp scripts/backup.ts /runtime/app/scripts/

FROM docker.io/denoland/deno:distroless-2.9.7
ENV DENO_DIR=/deno-dir \
    HOST=0.0.0.0 \
    PORT=8000 \
    DATABASE_PATH=/data/pushrss.db \
    PUSHRSS_WEB_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=builder /runtime/ /
VOLUME ["/data"]
EXPOSE 8000
CMD ["run", "--no-config", "--no-lock", "--cached-only", "--allow-net", "--allow-read", "--allow-write=/data", "--allow-env", "packages/platform/deno/main.js"]
