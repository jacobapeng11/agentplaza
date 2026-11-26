# Higress MCP 网关接入

Agent Plaza 通过 Higress Console 管理 MCP 服务来源、路由和插件，通过 Higress Gateway 向客户端交付 MCP 地址。启用 MCP 发布时需要这两个入口及服务凭据加密密钥。

| 入口 | 调用方 | 配置示例 |
| --- | --- | --- |
| Console 管理 API | Agent Plaza 后端 | 私网或集群内地址，如 `http://higress-console.higress-system.svc.cluster.local:8080` |
| Gateway 应用流量 | MCP 客户端和需要访问网关的 Agent Plaza 后端 | TLS 域名，如 `https://mcp.example.com` |
| 被代理的 MCP 或 REST 服务 | Higress Gateway；使用发现或 URL 导入时也可能由 Agent Plaza 后端访问 | 以私网服务 DNS 为例，`mcp-upstream.tools.svc.cluster.local` |

准备客户认可的 Higress 版本、域名、TLS 证书和明确的上游测试服务。网络策略只给应用后端开放管理 API，给网关开放上游服务。生产环境管理 API 保持在受控网络，数据面按客户使用范围开放。可能涉及长连接时，确认入口代理允许 SSE 流式响应，并配置适合调用时长的超时。[Higress Helm 部署](https://higress.cn/docs/latest/ops/deploy-by-helm/) · [Higress MCP 快速开始](https://higress.cn/docs/ai/mcp-quick-start/)

## 1. 安装或检查已有 Higress

### Docker 单机

1. 查看 Higress [独立部署文档](https://higress.cn/docs/latest/ops/deploy-by-docker/) 和选用的版本，拉取经过客户验证的 All-in-One 镜像标签或摘要。下例用官方镜像的 `latest` 取当前镜像供试用，并记录镜像摘要。正式部署填写已验证的摘要。
2. 准备独立数据目录用于 `/data`，定期备份。把 Higress 容器加入 Agent Plaza 后端可访问的受控 Docker 网络。同机使用 FastGPT 共享网络覆盖文件时，可填同一个网络名。也可让后端通过单独的管理网络访问 Console。
3. 确认本机端口可用。下面把 Console 映射到本机 `18001` 方便初始化，把网关 HTTP/HTTPS 映射到本机 `18080` 和 `18443`。同组网络容器访问 Console 使用容器名及 `8001`。正式对外访问将数据面映射到客户 HTTPS 入口，并限制 Console 的来源。

   ```bash
   HIGRESS_IMAGE=higress-registry.cn-hangzhou.cr.aliyuncs.com/higress/all-in-one:latest
   docker pull "$HIGRESS_IMAGE"
   docker image inspect --format '{{index .RepoDigests 0}}' "$HIGRESS_IMAGE"
   mkdir -p "$PWD/higress-data"
   read -r -p 'Agent Plaza 后端可访问的 Docker 网络名: ' HIGRESS_NETWORK
   docker network inspect "$HIGRESS_NETWORK" >/dev/null
   docker run -d --name higress-ai --restart unless-stopped \
     --network "$HIGRESS_NETWORK" \
     --mount "type=bind,src=$PWD/higress-data,dst=/data" \
     -p 127.0.0.1:18001:8001 \
     -p 127.0.0.1:18080:8080 \
     -p 127.0.0.1:18443:8443 \
     "$HIGRESS_IMAGE"
   docker ps --filter name=higress-ai
   ```

4. 打开 `http://127.0.0.1:18001/` 初始化管理员，再按下一节配置机器凭据。选择 HTTP Basic 时，依所选发布版本启用 `HIGRESS_CONSOLE_ADMIN_BASIC_AUTH_ENABLED=true`。当前 Console 支持该环境变量，使用 All-in-One 时确认发行镜像将其传递给 Console 进程。在容器创建配置中启用，变更时用同一数据目录及原参数重建容器。Basic 管理流量跨宿主机时使用专用 HTTPS 入口。[Higress Console 认证配置](https://github.com/higress-group/higress-console/blob/main/backend/console/src/main/java/com/alibaba/higress/console/constant/SystemConfigKey.java)

### Kubernetes

1. 准备 Helm、`kubectl`、节点可访问的镜像仓库、证书，以及数据面的负载均衡或入口资源。已有 Higress 时先查看其版本和 Release values，复用已就绪的 Controller、Console 及 Gateway。新安装时先查询 Helm Chart 版本，再明确选定版本。

   ```bash
   helm repo add higress.io https://higress.io/helm-charts
   helm repo update higress.io
   helm search repo higress.io/higress --versions
   read -r -p '已验证的 Higress Chart 版本: ' HIGRESS_CHART_VERSION
   helm upgrade --install higress higress.io/higress -n higress-system \
     --create-namespace --version "$HIGRESS_CHART_VERSION" \
     --set higress-console.service.type=ClusterIP
   kubectl -n higress-system get deploy,pod,svc
   ```

2. 使用 `helm show values higress.io/higress --version "$HIGRESS_CHART_VERSION"` 查看 Chart options，并核对该版本的 Console 子 Chart。由 `kubectl get svc` 确认管理和数据面 Service 名、Service 端口及就绪端点。管理端保留为 ClusterIP。典型的 Console 容器端口为 `8080`，客户端 URL 使用实际的 Service 端口，集群自定义 DNS 时更换域后缀。首次初始化可临时端口转发，下面假设 Service 名是 `higress-console`，端口为 `8080`。

   ```bash
   kubectl -n higress-system get svc higress-console higress-gateway
   kubectl -n higress-system get endpointslice \
     -l kubernetes.io/service-name=higress-console
   kubectl -n higress-system port-forward svc/higress-console 18001:8080
   ```

   从 `http://127.0.0.1:18001/` 初始化管理员。需要 HTTP Basic 并且 Console 子 Chart 支持该选项时，在现有版本的 Helm values 中配置以下字段，再携带原有完整配置和已选版本升级。操作后重新验证管理入口。

   ```yaml
   higress-console:
     service:
       type: ClusterIP
     admin:
       basicAuth:
         enabled: true
   ```

3. 给 Gateway 配置 MCP 域名和 TLS，DNS 指向数据面的负载均衡或 HTTPS 入口。确保 Agent Plaza 后端到 Console 的端口和 Gateway 到上游服务的端口开放。跨命名空间使用完整 Service DNS 名。若需要从集群外访问 Console，使用私网访问方式及 TLS。多个 Ingress Controller 共存时，核对各自的 Ingress Class。[Higress Helm 部署](https://higress.cn/docs/latest/ops/deploy-by-helm/) · [Console Helm 选项](https://github.com/higress-group/higress-console/blob/main/helm/values.yaml)

## 2. 核对 Console API，再配置 Agent Plaza

Agent Plaza 直接调用 Console 管理 API。Web 登录完成后能看到控制台，仍需用机器认证验证 API。当前上游 Console 使用浏览器会话，HTTP Basic 是可选模式，默认关闭。Agent Plaza 支持两种 HTTP 请求配置，二选一。

- 原生 Console 支持 HTTP Basic 并已按版本启用时，填写 `HIGRESS_CONSOLE_USERNAME` 和 `HIGRESS_CONSOLE_PASSWORD`。使用客户批准的管理身份，保持 API 在受控网络。
- 客户已有兼容的受控管理 API 入口，且该入口支持 Bearer 令牌时，填写 `HIGRESS_CONSOLE_BEARER_TOKEN`。该入口须自行验证令牌权限，并完成与 Console 的受支持认证。Agent Plaza 不发起浏览器登录或维护 Console Cookie。仅可使用网页登录且没有可用机器认证入口时，MCP 发布条件未满足。[Higress Console 会话验证实现](https://github.com/higress-group/higress-console/blob/main/backend/console/src/main/java/com/alibaba/higress/console/service/SessionServiceImpl.java)

按客户采用的版本核对以下接口。可先对可读列表试探认证，再在预发布环境创建并删除一个测试服务检查写入和撤销权限。

| 用途 | Console 管理接口 |
| --- | --- |
| 创建、读取、更新和回收服务来源 | `POST /v1/service-sources`，`GET / PUT / DELETE /v1/service-sources/{name}` |
| 直连 MCP 的路由管理 | `POST /v1/routes`，`GET / PUT / DELETE /v1/routes/{name}` |
| 路由认证与转换插件 | `PUT / DELETE /v1/routes/{route}/plugin-instances/{plugin}`，插件名按配置使用 `key-auth` 或 `transformer` |
| OpenAPI 转 MCP | `POST /v1/mcpServer/swaggerToMcpConfig`，`PUT /v1/mcpServer`，`GET / DELETE /v1/mcpServer/{name}` |

为 Compose 编辑 `deploy/compose/backend.env`，或按 [部署手册](../../DEPLOYMENT.md) 更新 Kubernetes 后端 Secret。示例管理地址请替换成实际 Console 管理 API 入口。

```dotenv
HIGRESS_CONSOLE_BASE_URL=http://higress-console.higress-system.svc.cluster.local:8080
HIGRESS_GATEWAY_BASE_URL=https://mcp.example.com
HIGRESS_CONSOLE_USERNAME=
HIGRESS_CONSOLE_PASSWORD=
# 使用 Bearer 时留空用户名和密码。
HIGRESS_CONSOLE_BEARER_TOKEN=
WECOM_BOT_SECRET_ENCRYPTION_KEY=
ADMIN_BADGES=
```

- 同 Docker 网络时，管理地址可用 `http://higress-ai:8001`。API 路径由后端追加为 `/v1/...`。
- `HIGRESS_GATEWAY_BASE_URL` 决定后端生成的客户端访问地址。也可以配置优先级更高的 `MCP_GATEWAY_BASE_URL`，保持单一规范域名。前端 `config.js` 的可选 `VITE_MCP_GATEWAY_BASE_URL` 使用客户端可访问的同一地址。
- 用 `openssl rand -hex 32` 生成 `WECOM_BOT_SECRET_ENCRYPTION_KEY`。所有后端副本共用同一份并将其备份到密钥管理系统。修改此密钥会影响已加密的集成凭据。
- `ADMIN_BADGES` 配置获准发布 MCP 的 IdTrust 用户标识，多人以逗号分隔。Console 认证字段、MCP 上游凭据和加密密钥都留在后端密钥配置中。

更新环境后重建或滚动重启后端。用下列只读命令在已运行的 Agent Plaza 后端容器内验证 Console 认证。输出只有 HTTP 状态，用实际 Compose 覆盖文件组合运行首行。Kubernetes 可将首行改成 `kubectl -n agentplaza exec -i deploy/agentplaza-backend -- node - <<'NODE'`。

```bash
docker compose exec -T backend node - <<'NODE'
const e = process.env;
const authorization = e.HIGRESS_CONSOLE_BEARER_TOKEN
  ? 'Bearer ' + e.HIGRESS_CONSOLE_BEARER_TOKEN
  : 'Basic ' + Buffer.from(e.HIGRESS_CONSOLE_USERNAME + ':' + e.HIGRESS_CONSOLE_PASSWORD).toString('base64');
fetch(e.HIGRESS_CONSOLE_BASE_URL.replace(/\/+$/, '') + '/v1/routes', {
  headers: { Authorization: authorization },
  redirect: 'manual',
  signal: AbortSignal.timeout(10000)
}).then(response => {
  const json = (response.headers.get('content-type') || '').includes('application/json');
  console.log('Console HTTP', response.status, 'JSON', json);
  if (!response.ok || !json) process.exitCode = 1;
}).catch(error => {
  console.error('Console connection failed:', error.cause?.code || error.name);
  process.exitCode = 1;
});
NODE
```

## 3. 发布并验证一条 MCP 服务

1. 以 `ADMIN_BADGES` 内的身份登录 Agent Plaza。在 MCP 广场打开发布页面，先建立一个命名唯一的测试服务。
2. 直连现有 MCP 时选择直连路由，提供测试 MCP 的完整上游 URL、传输类型（Streamable HTTP 或 SSE）、网关域名及路由路径。先验证上游能用标准客户端发现工具。在安全策略允许时，Agent Plaza 也可访问上游进行工具预览。带认证或要求初始化会话的上游，按实际协议使用其 MCP 客户端验收。
3. 将 REST API 转成 MCP 时选择 OpenAPI，输入上游服务地址、端口和协议，提交 OpenAPI/Swagger 规范或已转换的工具配置。确认规范里的操作与实际服务一致，先在测试环境使用只读工具。使用远端文档 URL 时，Agent Plaza 后端需能读取文档，Higress Gateway 需能调用对应 REST 上游。按需设置上游认证、网关消费者或插件。
4. 发布后看同步状态，核对 Console 中已创建的服务来源和对应路由或 MCP Server。直连模式使用选择的网关路径。OpenAPI 模式常用 `/mcp-servers/<名称>`，旧式 SSE 使用带 `/sse` 的地址。使用 Agent Plaza 页面显示的完整 URL。
5. 从实际客户端网络打开 MCP Inspector，按发布时相同的传输类型和网关鉴权配置，连接、列出工具并调用一个只读工具。可用 `npx @modelcontextprotocol/inspector` 打开测试界面。只为测试客户端提供其获批使用的数据面凭据。结束后删除测试发布，确认关联资源的同步状态。[MCP Inspector](https://github.com/modelcontextprotocol/inspector)

## 4. 常见问题

| 现象 | 检查顺序 |
| --- | --- |
| Console `401`、`403`、`302` 或返回 HTML | 核对是否进入管理 API、是否完成 Console 初始化、所用版本是否启用了 Basic，以及客户管理入口是否授权 Bearer。确认配置里只启用一种凭据。 |
| Console `404` | 核对 `HIGRESS_CONSOLE_BASE_URL` 为 Console API，确认当前 Console 版本提供规范中的路径。 |
| MCP 菜单不可用或发布按钮缺失 | 检查配置中同时存在 Console、Gateway 和加密密钥。发布另需 IdTrust 账号匹配 `ADMIN_BADGES`。 |
| 同步失败 | 查看 Agent Plaza 的失败步骤，检查服务来源名称、路由域名、路径冲突、对应插件及 Console 权限。修复后用服务的重新同步操作复验。 |
| Gateway `404` 或 `503` | 先确认客户端走数据面域名和预期路由，再核对 Console 配置下发、上游服务端口、EndpointSlice、DNS、网络策略和证书。 |
| SSE 或工具查询超时 | 核对客户端与上游的传输类型、路由或会话要求，关闭该入口链路上影响 SSE 的缓冲，并确认超时符合调用时长。 |
