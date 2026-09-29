# PushRSS

PushRSS 是面向个人使用的 RSS 推送服务，支持Server酱³ 和 Telegram Bot
通知渠道，且服务可运行在 Docker 或 Cloudflare Workers。

## Docker 部署

基于 Deno distroless 镜像。

```sh
docker pull ghcr.io/cab233/pushrss:latest
```

## Cloudflare Workers 部署

```sh
deno install --frozen
deno task wrangler login
deno task wrangler d1 create pushrss
deno task wrangler queues create pushrss-jobs
```

将创建数据库时返回的 `database_id` 写入 [`wrangler.jsonc`](wrangler.jsonc) 的
`DB` 配置，然后迁移、设置密钥并发布：

```sh
deno task db:migrate:worker:remote
deno task wrangler secret put PUSHRSS_MASTER_KEY
deno task wrangler secret put PUSHRSS_ADMIN_PASSWORD
deno task build:web
deno task wrangler deploy
```

两个 secret 分别填写前述 Base64 主密钥和自行设置的管理密码。Worker
同源提供网页前端与 API，通过 Worker 定时任务扫描到期订阅源，Queues
负责执行抓取与通知任务。后续发布继续使用原
`PUSHRSS_MASTER_KEY`，并在数据库迁移变化时先执行远程迁移。

## 本地开发

```sh
deno install --frozen
# 填写 PUSHRSS_MASTER_KEY 与 PUSHRSS_ADMIN_PASSWORD
cp .env.example .env
deno task dev
```

使用构建后的单服务前端时，执行：

```sh
deno task build:web
PUSHRSS_WEB_DIR=apps/web/dist deno task dev:api
```

## 本地 Worker 开发

`.dev.vars` 仅用于本地开发，生产环节中 secret 由 Wrangler 管理。

```sh
# 填写 PUSHRSS_MASTER_KEY 与 PUSHRSS_ADMIN_PASSWORD
cp .dev.vars.example .dev.vars
deno task build:web
deno task db:migrate:worker
deno task dev:worker
```

## 环境变量

| 变量                     | 用途与默认值                                                         |
| ------------------------ | -------------------------------------------------------------------- |
| `PUSHRSS_MASTER_KEY`     | 32 字节随机密钥的标准 Base64 编码；用于加密渠道凭据                  |
| `PUSHRSS_ADMIN_PASSWORD` | 自行设置的非空管理密码                                               |
| `DATABASE_PATH`          | Deno SQLite 路径，默认 `./pushrss.db`；容器固定为 `/data/pushrss.db` |
| `HOST`                   | Deno 监听地址，默认 `127.0.0.1`；容器固定为 `0.0.0.0`                |
| `PORT`                   | Deno 监听端口，默认 `8000`                                           |
| `PUSHRSS_WEB_DIR`        | 构建后的前端目录；设置后由 Deno 同源提供管理界面                     |

`deno task dev`、`deno task db:migrate` 和 `deno task db:backup` 自动读取根目录
`.env`；进程中已设置的同名环境变量优先。Docker Compose
读取同一文件，并覆盖容器内的数据库路径、监听地址、端口和前端目录。`.env` 与
`.dev.vars` 已加入 Git 忽略规则。

管理界面使用密码登录，并通过 HttpOnly、SameSite=Strict 的签名 Cookie
保留 7 天会话；刷新页面后自动恢复，点击“退出”会清除浏览器会话。HTTPS
访问时 Cookie 使用 Secure 属性，修改管理密码或主密钥会使已有会话失效。管理 API
继续接受 Basic 认证（用户名为 `admin`），旧客户端可使用以密码为值的 Bearer
认证。`GET /health` 可直接用于存活检查。
主密钥丢失后，数据库中的渠道凭据将无法解密；备份时应同时保存数据库和主密钥。

## 备份与恢复

SQLite 运行中可使用 `VACUUM INTO` 生成一致性快照，脚本会检查快照完整性。在项目根目录运行：

```sh
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
deno task db:backup "backups/pushrss-$stamp.db"
cp .env "backups/pushrss-$stamp.env"
```
