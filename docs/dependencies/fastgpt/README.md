# FastGPT 与 MongoDB 接入

Agent Plaza 与客户自托管的 FastGPT 核心应用共用 MongoDB 业务库。Agent Plaza 的 `MONGODB_URI` 必须指向 FastGPT 应用实际使用的数据库名，应用列表、团队成员和权限关系来自这个库。如果只有托管 SaaS 的网页或 API 地址，请先向客户确认可部署的自托管实例和数据库访问方式。

## 1. 准备 FastGPT 实例与测试数据

1. 已运行 FastGPT 时，记录部署版本、FastGPT 网页地址、内部 API 地址和 MongoDB 拓扑。按当前发布版本核对数据结构和 API 行为。
2. 新部署时，从官方模板选定明确版本和向量库。准备模板所需的 MongoDB、Redis、向量数据库、S3 兼容对象存储、模型网关，以及所选版本要求的插件和 Sandbox 服务。先让 FastGPT 独立运行，通过网页登录、创建应用，验证模型和知识库调用。Kubernetes 环境按客户采用的 FastGPT 集群部署方案安装。采用 Sealos 时，可按官方指南部署模板、配置模型并验收知识库。下文从已就绪的 FastGPT 服务开始。[FastGPT 部署架构](https://doc.fastgpt.io/self-host) · [FastGPT Sealos 部署](https://doc.fastgpt.io/self-host/deploy/sealos)
3. 在 FastGPT 创建测试团队、团队成员和测试应用，选用可用模型并发布。准备一个用户用于 Agent Plaza 联调，确认身份服务返回的用户标识能匹配 FastGPT 团队成员记录。现有匹配优先使用绑定的 FastGPT 用户 ID。没有绑定时可按成员记录的 `name` 匹配工号。分别准备有应用权限和无应用权限的账号。
4. 需要企业微信机器人调用 FastGPT 时，准备能调用所选已发布应用的 API 凭据。在 FastGPT 的「发布渠道 → API 访问」查看实例支持的凭据类型和权限。Agent Plaza 当前适配 `POST /api/v1/chat/completions`。上线前用实际 FastGPT 版本验证调用和 Agent Plaza 的凭据绑定流程。[FastGPT 应用 API](https://doc.fastgpt.io/guide/build/publish/openapi)

单机安装 FastGPT 的客户可以在自己的安装目录执行官方 Docker Compose 向导。下载并检查脚本，运行时选择明确版本，按向导填写模型、站点、存储和服务参数。

```bash
mkdir -p fastgpt-install
cd fastgpt-install
curl -fsSL https://doc.fastgpt.io/deploy/install.sh -o install.sh
less install.sh
bash install.sh
docker compose ps
```

升级已有环境先备份数据和配置，再按目标版本的迁移步骤执行。[FastGPT Docker Compose 部署](https://doc.fastgpt.io/self-host/deploy/docker)

## 2. 核对实际数据库并创建专用账号

1. 通过客户的密钥管理系统或 FastGPT 管理员核对核心应用的 `MONGODB_URI`。记录 URI 路径里的业务库名、`authSource`、TLS、种子地址和副本集名。FastGPT 插件服务可能使用独立数据库，应选择核心应用使用的库。Agent Plaza 使用一条 MongoDB 连接，广场元数据也写入这一个库。
2. 确认共享库存在 FastGPT 测试应用数据。广场读取 `apps`、`team_members`、`resource_permissions` 及组织、成员组等相关记录。广场会写入自己的应用扩展、链接应用、分类、收藏、MCP、Skill 和企业微信记录。启用 Agent Plaza 为企业微信配置创建 FastGPT 密钥的功能时，还会访问 `openapis` 并写入密钥记录。沿用 FastGPT 的备份与恢复流程，在预发布数据库核对应用版本的数据结构和索引。
3. 由数据库管理员创建专用账号。下例假设业务库为 `fastgpt`，账号建在 `admin`。授予该业务库的 `readWrite`，以支持广场初始化集合和索引。需要集合级权限时，由数据库管理员根据启用的功能验证自定义角色、集合初始化和索引操作。

```javascript
// 在 MongoDB 管理员的 mongosh 会话内执行
db.getSiblingDB('admin').createUser({
  user: 'agentplaza',
  pwd: passwordPrompt(),
  roles: [{ role: 'readWrite', db: 'fastgpt' }]
});
```

上例的 URI 路径和认证参数为 `/fastgpt?authSource=admin`。如果账号建在业务库，将 `authSource` 设为该业务库。用密钥管理系统保存密码，将 URI 用户名、密码中的保留字符进行百分号编码。测试集群也应启用鉴权。[MongoDB 创建用户](https://www.mongodb.com/docs/manual/reference/method/db.createUser/) · [MongoDB 连接串格式](https://www.mongodb.com/docs/manual/reference/connection-string-formats/)

## 3. 选择 MongoDB 网络接入方式

### Kubernetes 同一集群

1. 在 FastGPT 所在命名空间查看已有 Service、工作负载和 Pod 标签。以下 `fastgpt-mongo` 是示例 MongoDB Service 名，请按实际结果替换。

   ```bash
   ns=fastgpt
   mongo_svc=fastgpt-mongo
   kubectl -n "$ns" get deploy,statefulset,pod,svc
   kubectl -n "$ns" get pods --show-labels
   kubectl -n "$ns" get svc "$mongo_svc" \
     -o jsonpath='{.spec.type}{" selector="}{.spec.selector}{"\n"}{range .spec.ports[*]}{.name}{" port="}{.port}{" targetPort="}{.targetPort}{"\n"}{end}'
   kubectl -n "$ns" get endpointslice \
     -l "kubernetes.io/service-name=$mongo_svc" -o wide
   ```

2. 核对 Service selector 选中 MongoDB 的 Pod，EndpointSlice 有对应地址和端口，端点处于就绪状态。客户端 URI 使用 Service 的 `port`，`targetPort` 匹配 MongoDB 实际监听端口，常见为 `27017/TCP`。命名的 `targetPort` 和 Pod 声明的端口名称一致。复用符合条件的 ClusterIP Service。同命名空间可用短 Service 名，跨命名空间可用 `fastgpt-mongo.fastgpt.svc.cluster.local`。集群自定义 DNS 后缀时替换 `cluster.local`。
3. 若单实例 MongoDB 没有 Service，从仓库根目录复制 [ClusterIP 示例](mongo-clusterip.example.yaml)，核对命名空间、selector 和端口，并应用实际配置。正在运行的副本集优先复用其 Headless Service 和稳定成员地址。

   ```bash
   cp docs/dependencies/fastgpt/mongo-clusterip.example.yaml mongo-clusterip.local.yaml
   # 修改 mongo-clusterip.local.yaml 后执行
   kubectl apply --dry-run=server -f mongo-clusterip.local.yaml
   kubectl apply -f mongo-clusterip.local.yaml
   kubectl -n fastgpt get endpointslice \
     -l kubernetes.io/service-name=fastgpt-mongo -o wide
   ```

4. 配置 NetworkPolicy 时，允许 Agent Plaza 后端及启用的 Skill worker 访问 MongoDB Pod 的 TCP 端口和集群 DNS。存在 MongoDB 入站策略时，同时放行这些工作负载。按 FastGPT API 对应 Service 端口配置 HTTP 访问。[Kubernetes Service](https://kubernetes.io/docs/concepts/services-networking/service/) · [EndpointSlice](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/)

### Kubernetes 跨集群或与外部 Docker 互访

1. 建立专用或互连网络，例如同一 VPC、VPC 对等连接或 VPN。确认返回路由、私有 DNS 和证书。Service 的 ClusterIP 和集群 DNS 名通常仅在本集群可用。
2. 优先使用**私有 TCP LoadBalancer**。复制 [私有 LoadBalancer 示例](mongo-private-lb.example.yaml)，它使用独立的 Service 名 `fastgpt-mongo-private`，便于继续保留现有 MongoDB Service。按云厂商说明将 `loadBalancerClass` 的占位符换成获批的内网类。使用注解配置内网的控制器时，先填该平台要求的私有类型或内部 scheme 注解，再移除占位的 `loadBalancerClass`。替换示例来源网段，填写实际 MongoDB selector 和端口。示例默认关闭 LoadBalancer 的 NodePort 分配，采用依赖 NodePort 的内网负载均衡控制器时按平台安全要求配置。

   ```bash
   cp docs/dependencies/fastgpt/mongo-private-lb.example.yaml mongo-private-lb.local.yaml
   # 按客户平台填写内网类或内网注解、批准的来源网段、selector 和端口。
   kubectl apply --dry-run=server -f mongo-private-lb.local.yaml
   kubectl apply -f mongo-private-lb.local.yaml
   kubectl -n fastgpt get svc fastgpt-mongo-private
   ```

   在云平台中核对负载均衡器为私有地址，在防火墙或安全组只允许获批的 Agent Plaza 出站地址。启动应用前从后端网络验证此端口和证书。
3. 使用 NodePort 时，复制上一节模板并改为 `type: NodePort`，使用实际 MongoDB selector、端口。通过 `kubectl -n fastgpt get svc <服务名>` 获取分配的 NodePort，URI 使用可路由的节点内网 DNS 和该端口。NodePort 可能监听多个节点接口，请通过节点防火墙、云安全组和私有路由限制来源。MongoDB 通过私网 TCP 加数据库 TLS 连接。HTTP Ingress 用于网页和 API。数据库端口留在私网。
4. 多成员副本集为驱动发现的成员提供逐个可达、证书名称可校验的稳定地址。使用部署工具支持的跨网络 DNS、独立私有端点或 split-horizon。共享负载均衡地址可以作为种子时，驱动仍会按副本集返回的成员地址建立连接。上线前从 Agent Plaza 网络逐个验证。[Kubernetes Service 类型](https://kubernetes.io/docs/concepts/services-networking/service/) · [MongoDB 连接选项](https://www.mongodb.com/docs/manual/reference/connection-string-options/)

### Docker Compose 同一宿主机

1. 在 FastGPT 部署目录查看实际网络和 MongoDB 容器网络别名。用 `docker compose ps --services` 的结果替换示例服务名。

   ```bash
   docker compose ps --services
   docker network ls
   mongo_container=$(docker compose ps -q fastgpt-mongo)
   docker inspect --format '{{range $name, $net := .NetworkSettings.Networks}}{{printf "%s %v\n" $name $net.Aliases}}{{end}}' "$mongo_container"
   ```

2. 在 Agent Plaza 的 `.env` 将 `FASTGPT_DOCKER_NETWORK` 设为上一步可访问 MongoDB 和 FastGPT API 的网络名，使用 [FastGPT 共享网络覆盖文件](../../../deploy/compose/fastgpt-network.example.yaml) 将后端加入该网络。可以让两套 Compose 应用都引用同一个由客户维护的外部网络，确保重建后网络和别名稳定。
3. 在 `deploy/compose/backend.env` 设置 `MONGODB_URI`，地址使用共享网络上实际的 MongoDB DNS 别名和容器内端口。启用 Skill worker 时，按 [部署手册](../../DEPLOYMENT.md) 配置对象存储，并使用相同覆盖文件和 `--profile skills`。后续更新继续使用同组 Compose 文件。

   ```bash
   docker compose -f compose.yaml -f deploy/compose/fastgpt-network.example.yaml config --quiet
   docker compose -f compose.yaml -f deploy/compose/fastgpt-network.example.yaml up -d --build --wait
   # 启用 Skill worker 的部署使用以下命令
   docker compose -f compose.yaml -f deploy/compose/fastgpt-network.example.yaml --profile skills up -d --build --wait
   ```

Docker 主机与 FastGPT MongoDB 分属不同网络时，使用上一节的私有 TCP 接入方式和可校验 TLS 的数据库地址。Compose 中的回环地址指向当前容器，跨容器应填网络别名或可达的私有 DNS 名。[Docker Compose 网络](https://docs.docker.com/compose/how-tos/networking/)

## 4. 设置连接串和 FastGPT 地址

下面的 `PASSWORD_URLENCODED` 表示经过百分号编码的密码。复制到 Compose 后端环境文件，或按部署手册生成 Kubernetes 后端 Secret。为已启用且访问共用库的工作负载提供同库连接配置。示例假设 TLS 已启用，使用实际 MongoDB 的协议和 CA。

```dotenv
# 单实例。将主机、端口、业务库名和认证库改成实际值。
MONGODB_URI=mongodb://agentplaza:PASSWORD_URLENCODED@fastgpt-mongo.fastgpt.svc.cluster.local:27017/fastgpt?authSource=admin&tls=true

# 副本集。使用下面这一行前先移除上一项，填写实际成员和副本集名。
# MONGODB_URI=mongodb://agentplaza:PASSWORD_URLENCODED@mongo-0.db.example.com:27017,mongo-1.db.example.com:27017,mongo-2.db.example.com:27017/fastgpt?authSource=admin&replicaSet=rs0&tls=true

FASTGPT_FRONTEND_BASE_URL=https://fastgpt.example.com
FASTGPT_DEFAULT_API_BASE_URL=http://fastgpt-app.fastgpt.svc.cluster.local:3000/api
```

- `FASTGPT_FRONTEND_BASE_URL` 和前端运行时 `VITE_FASTGPT_FRONTEND_BASE_URL` 使用浏览器可访问的 FastGPT 站点根地址。
- `FASTGPT_DEFAULT_API_BASE_URL` 是 Agent Plaza 后端可访问的 API 基础地址，通常以 `/api` 结尾。应用追加 `/v1/chat/completions`，最终路径为 `/api/v1/chat/completions`。Docker 共享网络可用类似 `http://fastgpt-app:3000/api` 的地址。
- 有意部署的**单成员**副本集，如果返回的成员地址在 Agent Plaza 网络不可解析，可在测试或单机临时接入用唯一的私有端点与 `directConnection=true`。先用 `hello` 确认该端点是可写主节点。这样固定连接此节点，不做副本集发现和自动故障切换。多成员生产部署应使用可发现的地址及正确的 `replicaSet`。[MongoDB 副本集连接说明](https://www.mongodb.com/docs/manual/reference/connection-string-options/#mongodb-urioption-urioption.directConnection)

## 5. 验收与排查

1. 从 Agent Plaza 后端所在网络做 DNS、端口和 TLS 检查。用部署时同一条 URI 认证，通过授权的数据库会话执行 `db.runCommand({ ping: 1 })` 和 `db.runCommand({ hello: 1 })`。核对当前库名、`setName`、`primary` 和 `hosts`，避免将完整连接串写入命令记录。证书名称应匹配数据库地址，私有 CA 按 [部署手册](../../DEPLOYMENT.md) 注入。
2. 用站点 `/api/ready` 检查 MongoDB 和 Redis 均就绪。用测试账号登录 Agent Plaza，确认可以找到有权限的应用，并能打开正确的 FastGPT 站点。用另一个账号确认受限应用没有向它开放。
3. 启用机器人或 API 调用时，给已发布应用发送一条测试消息，确认应用权限、模型可用性以及 API 路径。

从正在运行的 Agent Plaza 后端容器可执行只读探测。它读取容器已有的连接配置，输出 ping、拓扑和 FastGPT 应用集合是否存在。Docker 使用启动时相同的 Compose 覆盖文件。Kubernetes 将首行替换为 `kubectl -n agentplaza exec -i deploy/agentplaza-backend -- node - <<'NODE'`。

```bash
docker compose exec -T backend node - <<'NODE'
const mongoose = require('mongoose');

(async () => {
  const connection = mongoose.createConnection(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 8000
  });
  try {
    await connection.asPromise();
    const ping = await connection.db.command({ ping: 1 });
    const hello = await connection.db.command({ hello: 1 });
    const appCollection = await connection.db.listCollections({ name: 'apps' }, {
      nameOnly: true
    }).hasNext();
    console.log({
      mongoReady: ping.ok === 1,
      replicaSet: hello.setName || null,
      hosts: hello.hosts || [],
      appCollection
    });
    if (ping.ok !== 1 || !appCollection) process.exitCode = 1;
  } catch (error) {
    console.error('MongoDB probe failed:', error.code || error.name);
    process.exitCode = 1;
  } finally {
    await connection.close();
  }
})();
NODE
```

| 现象 | 检查顺序 |
| --- | --- |
| 连接超时或 DNS 解析失败 | 核对 Pod NetworkPolicy 或 Docker 共享网络，再查 Service selector、EndpointSlice、端口和副本集公布的成员地址。 |
| `Authentication failed` 或索引权限不足 | 核对认证库、业务库、密码编码、TLS CA、账号状态及创建集合和索引的权限。 |
| 数据库已连接，但广场无 FastGPT 应用 | 核对是否连接核心应用库，以及 FastGPT 应用状态、用户身份映射和团队资源权限。 |
| API 返回 `401`、`403` 或 `404` | 核对凭据授权、应用 ID、部署的 API 基础地址和最终 `/api/v1/chat/completions` 路径。 |
