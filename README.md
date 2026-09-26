# PushRSS

PushRSS 是面向个人使用的 RSS 推送服务，支持Server酱³ 和 Telegram Bot
通知渠道，且服务可运行在 Docker 或 Cloudflare Workers。

## 本地启动

需要 Deno 2.9.7。在仓库根目录安装锁定的依赖，并创建配置文件：

```sh
# 安装依赖
deno install --frozen

# 配置变量
cp .env.example .env
```

同时启动后端服务和前端开发服务器：

```sh
deno task dev
```

浏览器打开 Vite 输出的地址，默认是
`http://127.0.0.1:5173`。Vite 将 `/api` 和 `/health` 代理到
`http://127.0.0.1:8000`。修改 `.env` 中的 `PORT` 时，同步修改
[`apps/web/vite.config.ts`](apps/web/vite.config.ts) 的代理目标。
后端启动时自动迁移 SQLite 数据库，并运行抓取调度器和任务消费者。单独启动服务时可使用
`deno task dev:api` 或 `deno task dev:web`。

使用构建后的单服务前端时，执行：

```sh
deno task build:web
PUSHRSS_WEB_DIR=apps/web/dist deno task dev:api
```

浏览器随后打开 `http://127.0.0.1:8000`。静态前端、API 和后台任务由同一个 Deno
进程提供。

## Docker 自托管

需要 Docker 和 Docker Compose。先按“本地启动”中的方法创建 `.env`
并填写主密钥与管理密码，然后运行：

```sh
docker compose up -d --build
```

浏览器打开
`http://127.0.0.1:8000`。容器启动时自动迁移数据库，运行管理界面、API、
调度器和任务消费者。`compose.yaml` 将 SQLite 数据库保存在 `pushrss-data`
命名卷的 `/data/pushrss.db`，并将服务映射到宿主机回环地址。更新镜像时再次运行
`docker compose up -d --build`。公网访问可通过宿主机的 TLS 反向代理接入。

## Cloudflare Workers 部署

需要已登录的 Cloudflare 账号，并为 D1、Queues 和 Workers
准备可用资源。先创建数据库与队列：

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

本地模拟 Worker 使用独立的 `.dev.vars`：

```sh
cp .dev.vars.example .dev.vars
# 填写 PUSHRSS_MASTER_KEY 与 PUSHRSS_ADMIN_PASSWORD
deno task build:web
deno task db:migrate:worker
deno task dev:worker
```

浏览器打开 `http://localhost:8787`。`.dev.vars` 只用于本地开发，线上 secret 由
Wrangler 管理。

## 配置

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

## 使用管理界面

1. 在“通知渠道”中添加 Server酱³ SendKey 或 Telegram Bot Token 与 Chat ID，
   按需设置解析模式和链接预览。渠道测试会发送已关联文章中最新的一篇；尚无文章时发送固定测试消息。
2. 在“订阅源”中填写 RSS / Atom 地址、抓取周期，并选择一个或多个通知渠道。
   网页中的抓取周期填写整数分钟；API 的 `intervalSeconds` 字段以秒计。
   既有非整分钟配置会按约数显示，编辑其他字段时保留原周期。
   名称可以留空，下一次成功抓取会使用 RSS / Atom 的标题。首次抓取保存全部文章，
   只推送最新的一篇新增文章；定时抓取推送全部新增文章。
3. 在订阅源详情查看文章和最近错误；需要立即抓取时点击“刷新”，本次仅推送最新的一篇新增文章。编辑地址会保留已有文章、投递记录和渠道关联。
4. 在“投递记录”查看文章、订阅源、通知渠道、结果和失败原因；未命名订阅源显示地址。自动重试每轮最多尝试 5
   次；发送结果未知时，先核对接收端，再手动重试。

“概览”显示订阅源、今日文章、今日成功投递和失败情况。“设置”可按分钟调整新订阅源的默认抓取周期。文章和投递记录随关联资源保留；已完成及失败任务保留
30 天。

## 备份与恢复

SQLite 运行中可使用 `VACUUM INTO` 生成一致性快照，脚本会检查快照完整性。Deno
自托管在仓库根目录运行：

```sh
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
deno task db:backup "backups/pushrss-$stamp.db"
cp .env "backups/pushrss-$stamp.env"
```

Docker 自托管在容器内生成快照，再复制到宿主机：

```sh
umask 077
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
docker compose exec -T pushrss deno run -A scripts/backup.ts "/data/pushrss-$stamp.db"
docker compose cp "pushrss:/data/pushrss-$stamp.db" "backups/pushrss-$stamp.db"
cp .env "backups/pushrss-$stamp.env"
```

将数据库快照与对应 `.env`
一起存放在受保护的备份位置。恢复时先停止服务，使用快照替换数据库文件，清理旧的
WAL / SHM 文件，然后用对应的主密钥启动。Docker
的恢复命令如下，将“日期”替换为备份文件名中的实际时间戳：

```sh
docker compose stop pushrss
docker compose run --rm --no-deps -v "$PWD/backups/pushrss-日期.db:/restore.db:ro" \
  --entrypoint sh pushrss -c \
  'cp /restore.db /data/pushrss.db && rm -f /data/pushrss.db-wal /data/pushrss.db-shm'
cp "backups/pushrss-日期.env" .env
docker compose up -d
```

Deno 直接部署遵循相同步骤：停止 Deno 进程，将快照复制到
`DATABASE_PATH`，清理同名的 `-wal` 和 `-shm` 文件，恢复对应
`.env`，再启动服务。恢复后通过 `/health`
和管理界面检查订阅源、渠道及投递记录；结果未知的投递应在核对接收端后手动重试。

## 开发与验证

仓库使用 Deno workspace。`apps/web` 是 React 管理界面，`apps/server` 是共享 Hono
API；`packages/core` 实现抓取和通知流程，`packages/db` 保存共享 schema 与迁移，
`packages/notifier` 实现渠道协议，`packages/platform` 提供 Deno 与 Cloudflare
适配。

```sh
deno task verify
deno task test:platform
deno run -A npm:@playwright/test install chromium
deno task test:web
```

`verify` 包含格式、lint、类型检查、自动测试、前端构建和 Worker dry-run。
`test:platform` 使用固定 RSS / Atom 样例和模拟通知服务，验证 Deno SQLite 与本地
Workers D1 / Queues / Cron 链路，并检查 SQLite 快照恢复。`test:web` 使用本地
Chromium 验证中文界面。直接构建可使用 `deno task build:web` 和
`deno task build:worker`。
