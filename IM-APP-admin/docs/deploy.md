# IM-APP 管理后台部署指南

> 目标：把 `IM-APP-admin`（Go 后端，端口 8090）部署到 Linux 服务器，并用 nginx 承载前端 `IM-APP-system` 与 API 反向代理。
> 本文以「Linux + systemd + nginx」为主，附 Docker 方式。

---

## 一、前置条件

| 项 | 要求 |
|---|---|
| 数据库 | PostgreSQL（示例 `100.100.65.41:5432/im_app`），**已初始化 server 表**（`users/groups/forward_tasks/auth_sessions` 等），否则 admin 迁移 001/002 的 ALTER 会失败 |
| 服务器 | Linux（x86_64），可访问数据库 |
| 编译机 | Go 1.25+（本机即可交叉编译） |

> 建表：admin 服务**启动时自动执行** `migrations/` 下所有 SQL，无需手动建表。

---

## 二、构建二进制（本机交叉编译到 Linux）

```powershell
cd D:\project\go\IM-APP\IM-APP-admin

$env:GOOS="linux"
$env:GOARCH="amd64"
$env:CGO_ENABLED="0"
go build -o im-app-admin ./cmd/admin

# 恢复本机构建变量
$env:GOOS=""
$env:GOARCH=""
$env:CGO_ENABLED=""
```

> ARM 服务器用 `$env:GOARCH="arm64"`。

---

## 三、服务器目录结构

```
/opt/im-admin/
├── im-app-admin        # 二进制（可执行权限 chmod +x）
├── migrations/         # 从 IM-APP-admin/migrations/ 整个拷过去（启动时执行）
└── .env                # 配置（同本地 .env，含密钥，勿提交 git）
```

上传：
```bash
scp im-app-admin root@<服务器>:/opt/im-admin/
scp -r migrations root@<服务器>:/opt/im-admin/
scp .env root@<服务器>:/opt/im-admin/
chmod +x /opt/im-admin/im-app-admin
```

`.env` 示例：
```bash
HTTP_ADDR=:8090
DATABASE_URL=postgres://postgres:密码@100.100.65.41:5432/im_app?sslmode=disable
JWT_SECRET=<随机长密钥>
ADMIN_BOOTSTRAP_PASSWORD=<首次初始化超管密码>
# 若前端与 API 跨域，填前端域名
ADMIN_CORS_ORIGINS=https://admin.example.com
# 生产环境建议
GIN_MODE=release
```

> ⚠️ **`WorkingDirectory` 必须指向 `/opt/im-admin`**，因为迁移和 `.env` 都是相对当前工作目录读取的。

---

## 四、systemd 服务

创建 `/etc/systemd/system/im-admin.service`：

```ini
[Unit]
Description=IM-APP Admin API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/im-admin
EnvironmentFile=/opt/im-admin/.env
ExecStart=/opt/im-admin/im-app-admin
Restart=always
RestartSec=5
# 建议用专用用户运行
# User=www-data

[Install]
WantedBy=multi-user.target
```

启动：
```bash
systemctl daemon-reload
systemctl enable --now im-admin
systemctl status im-admin
# 查看启动日志（确认 migrations applied / 端口监听）
journalctl -u im-admin -f
```

验证：`curl http://127.0.0.1:8090/api/admin/v1/health` 返回 `{"code":0,...}`。

---

## 五、前端部署（IM-APP-system）

```powershell
cd D:\project\go\IM-APP\IM-APP-system
npm ci
npm run build        # 产出 dist/（注意 .env.production 里 VITE_API_URL=/api/admin/v1）
```

上传 `dist/` 到服务器，由 nginx 托管。

---

## 六、nginx 反向代理

`/etc/nginx/conf.d/im-admin.conf`：

```nginx
server {
    listen 80;
    server_name admin.example.com;   # 你的域名/IP

    root /opt/im-admin-web/dist;      # 前端 dist 目录
    index index.html;

    # API 反向代理
    location /api/admin/ {
        proxy_pass http://127.0.0.1:8090;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 前端 SPA 路由
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

```bash
nginx -t && systemctl reload nginx
```

> 同域部署（前端 + API 都在 nginx 下）时**无跨域问题**；若前端和 API 分离域名，需在 `.env` 配置 `ADMIN_CORS_ORIGINS` 并在 nginx 加 CORS 头。

---

## 七、Docker 方式（可选）

`Dockerfile`：
```dockerfile
FROM golang:1.25 AS build
WORKDIR /app
COPY . .
RUN CGO_ENABLED=0 go build -o im-app-admin ./cmd/admin

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/im-app-admin .
COPY migrations ./migrations
EXPOSE 8090
CMD ["./im-app-admin"]
```

启动（数据库用外部，不建容器内）：
```bash
docker run -d --name im-admin --restart=always \
  -p 8090:8090 \
  --env-file /opt/im-admin/.env \
  -v /opt/im-admin/.env:/app/.env:ro \
  im-admin:latest
```

---

## 八、验证清单

1. `systemctl status im-admin` 为 running
2. `journalctl -u im-admin` 出现 `migrations applied`、`super admin ensured`、`Admin API listening on :8090`
3. `curl http://127.0.0.1:8090/api/admin/v1/health` 返回 200
4. 浏览器访问域名 → 前端页面 → `admin / 初始密码` 登录成功
5. 用户/群/举报等列表能拉到数据（依赖 server 表有数据）

---

## 九、常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 启动报 `relation "users" does not exist` | 目标库没有 server 表，先初始化 server 迁移，或只执行 admin 的 003~007 |
| 提示「未设置 ADMIN_BOOTSTRAP_PASSWORD」 | 首次启动必须设置该变量才会创建超管；已有管理员后会自动跳过 |
| 前端登录 404 | 前端 `VITE_API_URL` 需带 `/api/admin/v1`；nginx `/api/admin/` 代理段要正确 |
| 前端跨域被拦 | 同域部署即可；跨域则在 `.env` 配置 `ADMIN_CORS_ORIGINS` |
| 修改 `.env` 后不生效 | `systemctl restart im-admin` |
