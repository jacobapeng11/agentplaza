# Agent Plaza 部署总览

本文中的命令在 Linux 或 WSL 终端执行。建议先用测试环境接通所有依赖，再在生产环境使用客户自己的 DNS、账号、证书和密钥。

## 1. 列出要启用的模块

| 模块 | 依赖 | 谁需要访问 |
| --- | --- | --- |
| 基础应用广场 | 正在运行、有应用的 FastGPT，及其实际使用的主 MongoDB 数据库 | Agent Plaza 后端和启用的 Skill Worker 访问同一个 MongoDB |
| 登录和会话 | IdTrust 兼容授权码身份服务、Redis | 浏览器访问身份授权页，后端访问身份 API 和 Redis |
| FastGPT 应用访问 | FastGPT 网页入口，按实际集成配置服务端 FastGPT API | 浏览器访问网页入口，Agent Plaza 可选集成访问相应 API |
| MCP 市场 | 支持项目所需管理 API 的 Higress 控制面和可用数据面网关 | 后端访问控制面，MCP 客户端访问网关，网关访问上游 |
| Skill 市场 | 私有 S3 兼容存储桶、Skill Worker | 后端和 Worker 访问存储和 MongoDB |
| 企业微信机器人 | 企业微信长连接机器人凭据，及用于机器人服务的 FastGPT 配置 | 后端访问机器人服务和配置的 FastGPT API |

先完成 [FastGPT / MongoDB 接入](dependencies/fastgpt/README.md)，再按需完成 [Higress / MCP 接入](dependencies/higress/README.md) 和 [Skill / OSS 接入](dependencies/skill-oss/README.md)。各手册包含所需的服务、端口、配置和验收步骤。

### 身份源与密钥

1. 在 IdTrust 兼容身份服务中创建 OAuth 2.0 授权码应用，取客户端 ID 和密钥。把站点根路径登记为回调，例如 `https://plaza.example.com/`，末尾 `/` 也参与匹配。
2. 确认该服务提供 `GET /oauth2/authorize`、`GET /oauth2/token`（返回 `access_token`）和 `GET /oauth2/get_user_info`（返回唯一稳定的 `name` 账号标识）。浏览器访问授权地址，后端访问服务端接口。正式身份地址使用 HTTPS。
3. 准备普通账号及管理员账号。管理员以 `ADMIN_BADGES` 中的账号标识为准，多个值用逗号分隔。用身份服务返回的精确值。
4. 将密码、Token、对象存储密钥和应用加密密钥交由客户的密钥管理系统。示例文件可提交，实际 `.env` 或 `backend.env` 仅在部署端使用。使用私有 CA 时，将 CA 加入浏览器、Node.js 和服务信任链。Node.js 可用 `NODE_EXTRA_CA_CERTS` 指向只读挂载的 PEM 文件。

### 其他可选服务

链接应用的图片上传可以使用项目原有的上传服务接口，按客户部署填写 `MINIO_UPLOAD_URL`，需要指定桶时填写 `MINIO_BUCKET`。该接口的配置独立于 Skill 的 `SKILL_OSS_*`。企业微信长连接机器人需要客户自己的机器人配置和对应的 FastGPT API 访问，按需填写 `WECOM_BOT_WORKER_ENABLED=true` 与 `WECOM_BOT_SECRET_ENCRYPTION_KEY`。密钥用于保存受保护的集成凭据，各后端副本使用同一份。带媒体上传的机器人另需配置 `WECOM_BOT_MEDIA_UPLOAD_URL` 和 `WECOM_BOT_MEDIA_ALLOWED_HOSTS`。

## 2. Docker Compose

### 基础设施

- Linux 主机、Docker Engine、Docker Compose **2.30 或更新版本**、Git、curl 和 OpenSSL。拉镜像或安装依赖的环境需访问镜像仓库与 npm Registry。离线环境预先镜像相同版本。
- FastGPT 与可达的 MongoDB。合用同台 Docker 主机时可以使用共享网络。跨主机用 VPN、VPC 或受控的私网 TCP 入口。
- 正式站点用 HTTPS 反向代理和域名。MongoDB 通信通过前一步准备的私网路径。
- Compose 使用带密码、AOF 和命名卷的 Redis。单机验证可从 2 vCPU / 4 GiB 内存起步。启用 Skill 后额外为 Worker、上传临时文件和部署的 OSS 服务预留资源。

### 配置

```bash
git clone https://github.com/jacobapeng11/agentplaza.git
cd agentplaza
cp .env.example .env
cp deploy/compose/backend.env.example deploy/compose/backend.env
chmod 600 .env deploy/compose/backend.env
openssl rand -hex 32
```

1. 把生成的密码放在 `.env` 的 `REDIS_PASSWORD`。入口默认绑定 `127.0.0.1:8080`。
2. 编辑 `deploy/compose/backend.env`，填入 FastGPT 主库的 `MONGODB_URI`、前端 origin、身份回调和管理员名单。该环境文件采用 raw 模式，每行 `KEY=VALUE`，值按原样传入，通常无需用引号包裹。MongoDB URI 的用户名和密码中的保留字符要做 URI 百分号编码。
3. 按模块手册配置 FastGPT UI/API、Higress、OSS。浏览器侧 FastGPT 或 MCP 地址可以放在公开运行时配置中，凭据只放后端环境。见下方覆盖配置。
4. 生产环境将公开域名全部路径代理至 `http://127.0.0.1:8080`，保留 Host、路径和查询参数。`FRONTEND_URL` 与 `OAUTH_REDIRECT_URI` 使用实际 HTTPS 域名。代理访问日志应省略 OAuth 回调查询参数。
5. 共用 FastGPT Docker 网络时按 [FastGPT 手册](dependencies/fastgpt/README.md) 加载 `deploy/compose/fastgpt-network.example.yaml`，并在 `.env` 设置网络名。后续 `up`、`ps`、`logs` 等命令保持相同的 `-f` 参数。

### 启动并检查

```bash
docker compose config --quiet
docker compose up -d --build --wait
docker compose ps
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS http://127.0.0.1:8080/api/ready
```

启用 Skill 后，确保 `SKILL_ENABLED=true` 和对象存储配置已填入，使用 `docker compose --profile skills up -d --build --wait` 同时启动 Skill Worker。外层 HTTPS 代理也要允许 Skill 上传请求的大小，详见 [OSS 手册](dependencies/skill-oss/README.md)。

`/api/ready` 返回 MongoDB、Redis 连接状态。请求成功之后仍需用客户身份登录并检查实际 FastGPT 应用列表。未配置 Higress 或禁用 Skill 时，对应市场入口隐藏。Redis 命名卷持久化会话。MongoDB 和 OSS 由各自运维方备份。

### 覆盖浏览器配置

```bash
cp deploy/frontend.config.js.example deploy/frontend.config.local.js
# 编辑 FastGPT 网页地址和 MCP 客户端可达的网关地址
docker compose -f compose.yaml -f deploy/compose/config.override.example.yaml up -d --wait
```

同时使用 FastGPT 网络时，再加一个 `-f deploy/compose/fastgpt-network.example.yaml`；使用 Skill 时加 `--profile skills`。浏览器加载 `/config.js`，可通过开发者工具确认值。该文件储存公开 URL。

## 3. Kubernetes

### 基础设施

1. 可用集群、兼容的 `kubectl`、镜像构建环境和集群可达的镜像仓库。
2. 按 FastGPT 手册准备目标 MongoDB Service。跨命名空间确认 DNS、网络策略和 TLS。跨集群确认路由、私有负载均衡、MongoDB 副本集成员地址、TLS 名称和来源限制。
3. 客户提供 Redis 认证、持久化和备份。后端和 Skill Worker 访问 FastGPT MongoDB。启用 Skill 后两者还需访问对象存储，后端继续访问 Redis。可选 MCP 控制面和身份服务也需要各自的出网规则。使用 NetworkPolicy 时确认同时放行 DNS 和相应目标端口。
4. 对外 HTTPS 入口需要 Ingress Controller、域名、入口地址及 TLS Secret。只做验收时可使用 `kubectl port-forward`。Skill 大文件需要同步调整控制器的请求体限制和超时时间。

### 构建镜像

```bash
REGISTRY=registry.example.com/agentplaza
TAG=1.1.0
docker login registry.example.com
docker buildx build --platform linux/amd64 -t "$REGISTRY/backend:$TAG" --push ./backend
docker buildx build --platform linux/amd64 -t "$REGISTRY/frontend:$TAG" --push ./frontend
```

根据节点架构选择 `linux/amd64` 或 `linux/arm64`。将 `deploy/k8s/app.yaml` 两处 `image` 换成构建结果。启用 Skill 时也要把 `deploy/k8s/skill-worker.example.yaml` 的镜像改成同版本后端镜像。私有镜像仓库使用集群节点凭据，或在同命名空间创建并从 `spec.template.spec.imagePullSecrets` 引用拉取 Secret。

### 应用配置和 Deployment

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

如启用 Skill，先设置 `SKILL_ENABLED=true` 和 OSS，再执行：

```bash
kubectl -n agentplaza apply -f deploy/k8s/skill-worker.example.yaml
kubectl -n agentplaza rollout status deployment/agentplaza-skill-worker --timeout=180s
```

MongoDB 和 Redis 通过现有服务接入，MongoDB、Redis、OSS 的持久化由各服务管理。工作负载的 `/tmp` 使用临时存储。更新 Secret 后重启后端和已启用的 Worker，更新公开浏览器配置时编辑 `app.yaml` 的 `agentplaza-frontend-config` 后重新应用并重启前端。挂载为子路径的 ConfigMap 文件由新 Pod 读入。

```bash
kubectl -n agentplaza rollout restart deployment/agentplaza-backend
# 如已部署 Worker
kubectl -n agentplaza rollout restart deployment/agentplaza-skill-worker
```

### 安装入口及验证

将 `deploy/k8s/ingress.example.yaml` 中的 Ingress Class、域名和证书 Secret 名称换成客户值，证书由客户或证书管理器颁发。

```bash
kubectl -n agentplaza create secret tls agentplaza-tls --cert=fullchain.pem --key=privkey.pem
kubectl -n agentplaza apply -f deploy/k8s/ingress.example.yaml
kubectl -n agentplaza get pods,svc,ingress
curl -fsS https://plaza.example.com/api/ready
```

测试集群也可以先执行 `kubectl -n agentplaza port-forward svc/agentplaza-frontend 8080:80`，再在另一个终端访问 `http://127.0.0.1:8080` 验证页面和探针。测试登录也要登记对应的完整回调地址，并将前端 origin 同步为浏览器实际访问地址。

## 4. 功能验收、更新与回滚

| 验收项 | 成功信号 |
| --- | --- |
| 前端、后端、数据服务 | `/healthz`、`/api/health`、`/api/ready` 返回 200。 |
| 身份源 | 两个身份账号都能登录，管理员能进入对应管理页。 |
| FastGPT | 已有测试应用出现在符合原有可见性规则的目录中，点开能到客户 FastGPT。 |
| MCP | 管理员发布测试服务，目录可见，使用 MCP 客户端连接客户网关并调用测试工具。 |
| Skill | 测试 ZIP 进入审阅流程，批准发布后能搜索和下载。 |
| 基础操作 | 确认数据备份任务、日志可见、监控基础设施、密钥轮换操作和访问规则符合客户要求。 |

更新前记录镜像标签和 Git 版本，备份共享 MongoDB 以及现有 Skill 桶中的对象。Compose 更新使用原 `-f`／`--profile` 参数运行 `up -d --build --wait`；Kubernetes 用新镜像更新相关 Deployment，再检查 rollout。上线优先在与生产隔离的 FastGPT 数据副本和存储桶验证。回滚需同时恢复配套代码、配置和镜像，并根据数据迁移情况决定是否恢复数据库及对象。

### 从旧版 Compose 独立数据库升级

早期客户版的 Compose 文件会创建独立 MongoDB 和数据卷。升级前先用原版本的部署配置确认数据卷与数据库名称，备份原卷中的 Agent Plaza 数据，并记录原有前后端版本和连接配置。新版本启动时连接 FastGPT 主库，旧库里的链接应用、收藏及管理数据不会自动出现在新库。

如果旧独立库里已有需要保留的数据，由 MongoDB 管理员对比两边的集合、对象 ID、唯一索引和身份标识，在测试库验证逐集合导出及合并策略。迁移前备份 FastGPT 主库，先在测试环境确认应用权限和关联数据，再进行生产切换。避免覆盖 FastGPT 的应用、用户、团队或权限集合。确认迁移和回滚窗口结束后再清理原 MongoDB 容器或数据卷。

诊断时可使用 `docker compose logs --tail=100 backend frontend redis`、`docker compose --profile skills logs --tail=100 skill-worker`，或 `kubectl -n agentplaza logs deployment/agentplaza-backend --tail=100`。对外分享前去除连接串、账号标识、凭据及回调查询。`/api/ready` 仅检查核心 MongoDB 和 Redis，FastGPT UI、Higress、OSS 各自按接入手册验收。

外部参考 [Docker Compose 配置](https://docs.docker.com/reference/compose-file/services/) · [Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/)。
