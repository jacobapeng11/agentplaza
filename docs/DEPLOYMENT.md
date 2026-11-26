# Agent Plaza 部署指南

本指南假设在仓库根目录的 Linux 或 WSL 终端执行命令。需要从公网访问时，请为站点启用 HTTPS。

## 部署前准备

| 设施 | Docker Compose | Kubernetes |
| --- | --- | --- |
| 运行环境 | Linux Docker Engine 和 Docker Compose 插件 v2.30 或更新版本。单机验证可从 2 vCPU、4 GiB 内存和 20 GiB 可用磁盘起步，生产容量按负载和数据保留量评估。 | Kubernetes 集群、与集群版本兼容的 `kubectl`、能构建镜像的 Docker 主机或 CI、集群节点可拉取镜像的镜像仓库。 |
| MongoDB | Compose 自带 MongoDB 8.0，使用认证和命名卷，自动创建 `agentplaza` 数据库用户。x86_64 主机需支持 AVX。 | 提前开通支持认证的 MongoDB，准备专用数据库和拥有该库读写权限的账户。按需配置 TLS、网络放行、持久化和备份。 |
| Redis | Compose 自带 Redis 8.2，启用密码、AOF 持久化和命名卷。 | 提前开通支持认证的 Redis，准备用于应用会话的专用实例或数据库。按需配置 TLS、网络放行、持久化和备份。 |
| 入口 | 对外开放时准备站点域名、TLS 证书和 HTTPS 反向代理，代理所有路径到前端。 | 正式访问准备域名、运行中的 Ingress Controller、负载均衡或入口地址，以及该命名空间的 TLS Secret。也可用 `kubectl port-forward` 本地验收。 |
| 登录 | 客户提供兼容 IdTrust 授权码登录及用户信息接口的身份服务。后台能访问该服务，浏览器能访问授权页面。 | 同左。 |
| 构建网络 | 构建主机需能访问容器镜像仓库和 npm Registry。隔离环境需预先镜像基础镜像和 npm 依赖。 | 同左。运行时集群节点需可访问应用镜像仓库。 |

在身份服务中创建授权码应用，记录客户端 ID 和密钥，登记与浏览器访问地址匹配的回调 URL，例如 `https://plaza.example.com/`。

身份服务需提供以下 IdTrust 兼容接口，并为应用授权查询用户信息。

| 接口 | 应用使用方式 |
| --- | --- |
| `GET /oauth2/authorize` | 浏览器获取授权码，身份服务回调站点根路径。 |
| `GET /oauth2/token` | 后端使用授权码交换 `access_token`。 |
| `GET /oauth2/get_user_info` | 后端使用 `access_token` 读取用户标识 `name`，该字段在客户身份系统中需唯一且稳定。 |

身份服务地址 `OAUTH_HOST` 使用 HTTPS。本地联调时，身份服务和站点仅对各自的回环地址支持 HTTP。请准备普通用户和管理员各一个，将管理员的 `name` 原值写入 `ADMIN_BADGES`。在这里文档使用的 `example.com` 地址需要替换为实际域名。使用私有 CA 时，将 CA 加入构建镜像和运行环境的信任链，Node.js 服务也可通过 `NODE_EXTRA_CA_CERTS` 指向挂载的 PEM 文件。

## Docker Compose

### 配置并启动

```bash
cp .env.example .env
cp deploy/compose/backend.env.example deploy/compose/backend.env
chmod 600 .env deploy/compose/backend.env

# 独立生成 MongoDB 管理员、MongoDB 应用账号、Redis 密码，各执行一次
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

1. 编辑 `.env`，依次填写 `MONGO_ROOT_PASSWORD`、`MONGO_APP_PASSWORD` 和 `REDIS_PASSWORD`。用十六进制密码可直接拼入数据库 URI。默认监听 `127.0.0.1:8080`，可通过 `PLAZA_PORT` 调整端口。
2. 编辑 `deploy/compose/backend.env`，填写 `FRONTEND_URL`、四项 OAuth 参数和部署时需要的可选配置。按 `KEY=VALUE` 写入原值。设置 `ADMIN_BADGES` 为管理员的身份服务工号，多个工号以逗号分隔。
3. 正式部署时把域名解析到 HTTPS 反向代理，转发整站至 `http://127.0.0.1:8080`，保留请求路径、查询参数、Host 和协议头。让 `FRONTEND_URL` 和回调使用公开 HTTPS 地址。本机试用可把它们设为 `http://localhost:8080` 和 `http://localhost:8080/`，并在身份服务中登记该回调。数据库和后端端口保留在 Compose 内部网络。

```bash
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/api/ready
```

MongoDB 的初始化脚本在新数据卷首次启动时执行。更改已有部署的 MongoDB 账户密码时，先在数据库内更新账号，再更新 `.env` 并重建容器。MongoDB 数据和 Redis 会话分别留在 `mongo-data` 和 `redis-data` 命名卷里。按客户的数据保留要求为这两个服务配置备份和还原演练。

### 可选浏览器配置

默认以前端同源路径请求 API。要在界面启用 FastGPT 跳转或配置 MCP 网关入口，可复制并编辑公开运行时配置。

```bash
cp deploy/frontend.config.js.example deploy/frontend.config.local.js
docker compose -f compose.yaml -f deploy/compose/config.override.example.yaml up -d --wait
```

用上述两个 `-f` 参数执行该部署的后续更新。浏览器会下载 `/config.js`，其中只填写公开地址。

### 更新和停止

备份 MongoDB、保存当前版本和配置后，获取准备部署的版本再执行 `docker compose up -d --build --wait`。变更后端配置也使用该命令重建受影响服务。对外部反向代理，请限制访问日志中的 OAuth 回调查询参数，因为其中会包含短期授权码。停止时执行 `docker compose down`，保留数据卷。回滚时切回之前的代码和配套配置后重新构建，必要时按数据库备份恢复数据。

## Kubernetes

示例创建前端和后端两个 Deployment、相应的 ClusterIP Service、前端运行时 ConfigMap，并提供单独的 Ingress 示例。MongoDB 和 Redis 由客户预先部署并提供持久化，本应用的 Pod 无须数据 PVC。首次部署默认各运行一个副本。

### 构建并推送镜像

```bash
REGISTRY=registry.example.com/agentplaza
TAG=1.0.0

docker login registry.example.com
docker buildx build --platform linux/amd64 -t "$REGISTRY/backend:$TAG" --push ./backend
docker buildx build --platform linux/amd64 -t "$REGISTRY/frontend:$TAG" --push ./frontend
```

将 `REGISTRY`、`TAG`、登录域名和目标架构改成实际值。例如 ARM64 集群选择 `linux/arm64`。编辑 `deploy/k8s/app.yaml` 的两处 `image` 到刚推送的标签或镜像摘要。私有仓库需要在部署命名空间创建镜像拉取 Secret，并为两个 Deployment 的 `spec.template.spec.imagePullSecrets` 引用它，或使用集群已经配置的节点级凭证。

### 创建配置并部署

```bash
kubectl create namespace agentplaza
cp deploy/k8s/backend.env.example deploy/k8s/backend.env
chmod 600 deploy/k8s/backend.env
# 编辑 deploy/k8s/backend.env 后执行
kubectl -n agentplaza create secret generic agentplaza-backend-env \
  --from-env-file=deploy/k8s/backend.env --dry-run=client -o yaml \
  | kubectl -n agentplaza apply -f -

kubectl -n agentplaza apply -f deploy/k8s/app.yaml
kubectl -n agentplaza rollout status deployment/agentplaza-backend --timeout=180s
kubectl -n agentplaza rollout status deployment/agentplaza-frontend --timeout=180s
```

`MONGODB_URI` 和 `REDIS_URL` 填客户实际连接地址。URI 用户名和密码中的特殊字符需做百分号编码，启用 Redis TLS 时使用 `rediss://`。如果启用了网络策略，允许 Pod 访问集群 DNS、MongoDB、Redis、身份服务和已启用的外部集成，并允许前端访问 `backend:3000`。把生产密钥保存在客户的密钥管理系统，并限制 Kubernetes Secret 的读取权限。上面的环境文件可作为首次创建 Secret 的输入。

启用可选浏览器配置时，编辑 `app.yaml` 中的 `agentplaza-frontend-config`。更新 Secret 或 ConfigMap 后，执行对应的 `kubectl -n agentplaza rollout restart deployment/agentplaza-backend` 或 `kubectl -n agentplaza rollout restart deployment/agentplaza-frontend`，使 Pod 读取更新后的环境变量或配置文件。

### 配置入口并验收

将 `deploy/k8s/ingress.example.yaml` 中的 Ingress Class、两个域名值、证书 Secret 名称改成实际值。如果证书由客户提供，可预先创建 TLS Secret。已有证书管理器可以按客户流程生成相同名称的 Secret。

```bash
kubectl -n agentplaza create secret tls agentplaza-tls --cert=fullchain.pem --key=privkey.pem
kubectl -n agentplaza apply -f deploy/k8s/ingress.example.yaml
kubectl -n agentplaza get pods,svc,ingress
curl -fsS https://plaza.example.com/api/ready
```

验证 DNS 已指向入口地址，同时核对 HTTPS 地址、`FRONTEND_URL`、`OAUTH_REDIRECT_URI` 与身份服务登记一致。只做本地连通验证时，可不应用 Ingress，执行以下命令并打开第二个终端。

```bash
kubectl -n agentplaza port-forward svc/agentplaza-frontend 8080:80
```

```bash
curl -fsS http://localhost:8080/healthz
curl -fsS http://localhost:8080/api/health
curl -fsS http://localhost:8080/api/ready
```

## 应用环境变量

| 配置 | 用途 |
| --- | --- |
| `FRONTEND_URL` | 浏览器使用的站点 origin，如 `https://plaza.example.com`。 |
| `OAUTH_HOST`、`OAUTH_CLIENT_ID`、`OAUTH_CLIENT_SECRET`、`OAUTH_REDIRECT_URI` | IdTrust 兼容服务地址、客户端 ID、密钥、完整回调 URI。回调走站点根路径并包含末尾 `/`。 |
| `MONGODB_URI`、`REDIS_URL` | MongoDB 和 Redis 连接地址。Compose 自动生成，Kubernetes 由客户填写。 |
| `ADMIN_BADGES` | 可选管理员身份标识，逗号分隔。按身份服务返回的工号填写。 |
| `FASTGPT_FRONTEND_BASE_URL`、`FASTGPT_DEFAULT_API_BASE_URL` | 可选 FastGPT 浏览器入口和默认服务端 API 地址。配置前先开通客户 FastGPT 和对应应用凭据。 |
| `HIGRESS_CONSOLE_BASE_URL`、`HIGRESS_GATEWAY_BASE_URL` | 可选 Higress 控制台与数据面网关地址。两者及加密密钥均配置后启用 MCP 集成，具有管理员权限的用户可以发布和操作服务。配置控制台令牌 `HIGRESS_CONSOLE_BEARER_TOKEN`，或 `HIGRESS_CONSOLE_USERNAME` 和 `HIGRESS_CONSOLE_PASSWORD`。 |
| `WECOM_BOT_SECRET_ENCRYPTION_KEY` | 保存 MCP 或企业微信机器人等集成凭据时使用的加密密钥。可由 `openssl rand -hex 32` 生成，所有后端副本共用一份并备份。 |
| `VITE_FASTGPT_FRONTEND_BASE_URL`、`VITE_MCP_GATEWAY_BASE_URL` | 可选浏览器地址，配置在公开的 `config.js`，可与后端网络中的服务地址不同。 |

配置 `WECOM_BOT_WORKER_ENABLED=true` 和凭据加密密钥后启用企业微信机器人。客户需在企业微信开通支持长连接的机器人并获得机器人 ID 和密钥，按需配置 FastGPT。需要接收媒体时，配置 `WECOM_BOT_MEDIA_UPLOAD_URL` 和 `WECOM_BOT_MEDIA_ALLOWED_HOSTS`，可按需填写 `WECOM_BOT_MEDIA_PUBLIC_BASE_URL`、`WECOM_BOT_MEDIA_UPLOAD_RESPONSE_HOSTS` 和 `WECOM_BOT_MEDIA_BUCKET_NAME`。链接应用需要上传图片或文件时，配置兼容上传接口 `MINIO_UPLOAD_URL`，如需指定存储桶，填写 `MINIO_BUCKET`。部署环境需允许后台访问已启用的外部服务。只使用基础广场功能时可留空第三方集成配置。

## 验收和排查

1. 检查 `/healthz`、`/api/health`、`/api/ready` 返回 200。`/api/ready` 检查 MongoDB 和 Redis，返回 503 时先核对数据库地址、权限、网络和证书。
2. 在浏览器打开站点，用普通账号登录，验证广场页面和应用列表能加载。新部署数据库初次使用时列表可能为空。用管理员账号验证管理权限，创建或发布一条可公开的测试应用，再用普通账号确认可见性符合配置。
3. 已启用的 FastGPT、Higress、企业微信集成逐项进行一次实际调用。检查使用的 API 地址和授权为客户环境。
4. Compose 诊断用 `docker compose ps` 和 `docker compose logs --tail=100 backend frontend mongo redis`。Kubernetes 诊断用 `kubectl -n agentplaza describe pod <pod>` 和 `kubectl -n agentplaza logs deployment/agentplaza-backend --tail=100`。遇到登录回调失败时检查站点 HTTPS 地址、完整回调 URI、浏览器时钟和身份配置，分享日志前去掉账号、凭据、连接串和回调查询参数。

参考 [Docker Compose 启动顺序](https://docs.docker.com/compose/how-tos/startup-order/) 和 [Kubernetes 探针说明](https://kubernetes.io/docs/concepts/workloads/pods/probes/)。