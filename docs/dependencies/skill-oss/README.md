# Skill 市场接入 OSS 与解析 Worker

Skill 市场依赖两个存储平面。FastGPT 的共享 MongoDB 保存 Skill 元数据、版本、审核、收藏和解析任务。私有的 S3 兼容桶保存用户提交的原始 ZIP 及解析后的文件。Agent Plaza API 和 Worker 使用同一个桶。最终用户通过登录后的 Agent Plaza 下载，浏览器只需访问站点域名。

## 1. 选择存储和网络

| 部署 | S3 API 入口 | 准备项 |
| --- | --- | --- |
| Amazon S3 | 使用区域 SDK 端点，`SKILL_OSS_ENDPOINT` 留空 | 普通私有 Bucket、Region、访问角色或凭据，Pod 可达 S3 或 VPC Endpoint |
| 自托管 S3 兼容服务 | 客户私有 S3 API，例如 `https://objects.example.com` 或同集群 `https://s3.storage.svc.cluster.local:9000` | RustFS、MinIO 或通过验收的兼容服务，持久化、证书、Bucket、应用账号 |
| 云厂商对象存储 | 客户账号下启用 S3 兼容的 API 地址 | 确认服务支持 AWS SigV4、`PutObject`、`GetObject`，并确认区域签名和寻址规则 |

将 S3 API 的网络入口放在客户可控的私网或经 TLS 保护的云端入口。Agent Plaza API Pod 和 Skill Worker Pod 都需要 DNS、TLS 信任和出网线路。若用同机 Docker，把应用加入对象存储所在私网或使用通往存储的主机私网地址。测试 HTTP 端点只用于隔离环境。

自托管时分别确认 S3 API 端口和管理控制台端口。例如 RustFS 默认的 S3 API 为 `9000`、控制台为 `9001`，环境变量应指向 S3 API。存储侧预留持久卷和备份，管理控制台可通过运维网络访问。[RustFS 容器部署](https://docs.rustfs.com/en/installation/container) · [RustFS 状态与端口](https://docs.rustfs.com/en/operations/status-check)

## 2. 创建桶、存储身份和策略

### A. 使用 Amazon S3

在 AWS 控制台创建 **General purpose bucket**，选择接近后端的 Region，保留 **Block Public Access** 和默认存储加密。名称按环境区分。也可以在已经绑定存储管理员身份的终端创建。以下以 `us-east-1` 为例。其他区域创建命令需同时指定 `LocationConstraint`。

```bash
SKILL_BUCKET=replace-with-your-unique-skill-bucket
AWS_REGION=us-east-1
aws s3api create-bucket --bucket "$SKILL_BUCKET" --region "$AWS_REGION"
aws s3api get-public-access-block --bucket "$SKILL_BUCKET" --region "$AWS_REGION"
aws s3api get-bucket-encryption --bucket "$SKILL_BUCKET" --region "$AWS_REGION"
```

创建 Agent Plaza 专用 IAM 角色或访问身份，绑定下方对象级策略。Kubernetes 使用工作负载身份时，将应用 ServiceAccount 关联到该角色，并让前端之外的两个 Deployment 使用它。按云厂商要求投射令牌或注入凭据。若填写静态凭据，将它们存进 Secret。开启自定义 KMS 加密的桶还需要按桶策略和 KMS Key Policy 为应用身份授权相应的加解密操作。[AWS S3 CLI 指南](https://docs.aws.amazon.com/AmazonS3/latest/userguide/GettingStartedS3CLI.html) · [S3 操作和资源权限](https://docs.aws.amazon.com/service-authorization/latest/reference/list_s3.html)

### B. 使用自托管 S3 兼容服务

1. 部署或复用对象存储。Docker 单机验收可按官方容器手册绑定数据目录和内部端口。Kubernetes 通过已有存储或其 Helm/Operator 部署，并确保 PVC 或外部后端持久。测试服务至少应在两次重启之间保留对象。正式环境按客户的容量和恢复目标部署。
2. 登录存储管理端，创建独立私有 Bucket，例如 `agentplaza-skills`。验证匿名权限关闭。存储通过持久卷、版本控制和备份保留发布版本的对象。
3. 创建专用应用账号或限定权限的 Access Key，下面的策略中替换桶名。自托管桶名可以和示例一致，应用使用此账号的 Key，运维账号只负责建桶、授权和备份。
4. 记录 S3 API Endpoint、Bucket、签名 Region、Access Key ID 和 Secret Access Key。临时 STS 凭据还需要 Session Token。自托管端点通常使用 path-style，将桶名放在路径里。若网关要求 virtual-host style，则关闭 path-style 并配置桶子域的 DNS 和证书。
5. 使用私有 CA 时，在 API 和 Worker 镜像中加入 CA 或挂载并设置 `NODE_EXTRA_CA_CERTS`。连接地址用证书覆盖的名称，应用校验 TLS。

[AWS S3 CLI 文档](https://docs.aws.amazon.com/cli/latest/reference/s3api/index.html) · [RustFS TLS 配置](https://docs.rustfs.com/en/integration/tls-configured)

### 应用最小权限策略示例

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadWriteAgentPlazaSkillObjects",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": [
        "arn:aws:s3:::agentplaza-skills/skills/imports/*",
        "arn:aws:s3:::agentplaza-skills/skills/artifacts/*"
      ]
    }
  ]
}
```

`skills/imports/` 存上传 ZIP，`skills/artifacts/` 存发布和审核引用的解析结果。应用凭据无需建桶、改策略或删对象。若供应商的策略字段不同，在该存储的策略编辑器授予等价权限。可先用单独的测试对象验证读写。正式清理策略需考虑未审阅的任务和已发布历史版本，避免提前删掉 MongoDB 仍引用的对象。

### C. Docker 单机部署 RustFS 示例

以下示例用于隔离的单机验收。数据保存在命名卷，主机端口仅绑定回环，后端和 Worker 走 Docker 私网。将 `STORAGE_NETWORK` 改成二者已经加入的网络。使用 FastGPT 共享网络覆盖时，可使用该已存在网络。

```bash
STORAGE_NETWORK=fastgpt_default
RUSTFS_IMAGE=rustfs/rustfs:1.0.6
docker network inspect "$STORAGE_NETWORK" >/dev/null
docker volume create agentplaza-skill-objects
read -r -p '存储管理员 Access Key ID: ' RUSTFS_ACCESS_KEY
read -r -s -p '存储管理员 Secret Access Key: ' RUSTFS_SECRET_KEY
printf '\n'
export RUSTFS_ACCESS_KEY RUSTFS_SECRET_KEY

docker run -d --name agentplaza-objects --restart unless-stopped \
  --network "$STORAGE_NETWORK" \
  --mount type=volume,source=agentplaza-skill-objects,target=/data \
  -p 127.0.0.1:19000:9000 -p 127.0.0.1:19001:9001 \
  -e RUSTFS_ACCESS_KEY -e RUSTFS_SECRET_KEY \
  -e RUSTFS_ADDRESS=:9000 -e RUSTFS_CONSOLE_ADDRESS=:9001 \
  -e RUSTFS_CONSOLE_ENABLE=true "$RUSTFS_IMAGE" /data
unset RUSTFS_ACCESS_KEY RUSTFS_SECRET_KEY
curl -fsS http://127.0.0.1:19000/health
```

打开 `http://127.0.0.1:19001`，用存储管理员账号登录，创建桶和上面的策略，再创建并授权应用专用身份。部署环境的 endpoint 用 `http://agentplaza-objects:9000`，访问凭据填应用身份。正式部署时使用私网 TLS 地址，配置持久化、备份和容量。Kubernetes 自托管可选 RustFS Helm 或 Operator，先在存储命名空间确认 PVC 就绪、私有 S3 Service 有可用后端，再用 Service DNS 填写 endpoint。[RustFS Docker](https://docs.rustfs.com/en/installation/container/docker) · [RustFS Kubernetes Helm](https://docs.rustfs.com/en/installation/cloud-native/helm-chart) · [RustFS IAM](https://docs.rustfs.com/en/security-compliance/iam)

## 3. 从应用网络验证读写

从与 API、Worker 相同的网络使用获授权的 CLI profile 或临时凭据测试。自托管环境为以下命令加 `--endpoint-url https://objects.example.com` 并按需要把 AWS CLI profile 的 `s3.addressing_style` 设为 `path`。使用真实 Region 和桶名，把测试写入应用允许的前缀。由运维账号在验证后清理 probe 对象。

```bash
SKILL_BUCKET=agentplaza-skills
SKILL_REGION=us-east-1
PROBE_KEY="skills/imports/deploy-probe-$(date +%s).txt"
PROBE_DIR=$(mktemp -d)
printf 'agentplaza storage check\n' > "$PROBE_DIR/source.txt"
aws --profile agentplaza-skill --region "$SKILL_REGION" s3api put-object \
  --bucket "$SKILL_BUCKET" --key "$PROBE_KEY" --body "$PROBE_DIR/source.txt"
aws --profile agentplaza-skill --region "$SKILL_REGION" s3api get-object \
  --bucket "$SKILL_BUCKET" --key "$PROBE_KEY" "$PROBE_DIR/result.txt"
cmp "$PROBE_DIR/source.txt" "$PROBE_DIR/result.txt"
```

## 4. 设置 Agent Plaza 和 Worker

| 环境变量 | 填法 |
| --- | --- |
| `SKILL_ENABLED` | `true` 开启 Skill API 和前端入口 |
| `SKILL_OSS_BUCKET` | 已创建的私有桶名 |
| `SKILL_OSS_REGION` | 存储请求签名使用的 Region，默认 `us-east-1` |
| `SKILL_OSS_ENDPOINT` | 自托管 S3 API origin。AWS 区域端点可留空 |
| `SKILL_OSS_FORCE_PATH_STYLE` | 显式设为 `true` 或 `false`。设置自定义端点时默认 `true` |
| `SKILL_OSS_ACCESS_KEY_ID`、`SKILL_OSS_SECRET_ACCESS_KEY` | 按对填写。两项留空时 SDK 使用部署环境的默认凭据链 |
| `SKILL_OSS_SESSION_TOKEN` | 配套静态 STS 凭据时填写，有效期和刷新由部署环境管理 |
| `SKILL_MAX_ARCHIVE_BYTES` | ZIP 最大 50 MiB，超过返回上传错误 |
| `SKILL_MAX_EXPANDED_BYTES`、`SKILL_MAX_FILES` | 解包总量默认 200 MiB，最多 10,000 个文件 |
| `SKILL_MAX_SKILL_MD_BYTES`、`SKILL_MAX_PATH_DEPTH` | 单份说明默认 1 MiB，路径最多 20 层 |
| `SKILL_PARSER_POLL_MS` | Worker 查询队列间隔，默认 2,000 毫秒 |
| `MONGODB_URI` | API、Worker 都指向 [FastGPT 主 MongoDB](../fastgpt/README.md) 的同一数据库 |

API 在启动时读取开关，登录时向界面返回功能状态。已有会话用户可退出并重新登录刷新入口。

**Docker Compose**

1. 将值写入实际的 `deploy/compose/backend.env`。同一个文件用于 API 与 Worker，不提交该文件。
2. 保留原有 Compose 叠加文件和参数。执行：

```bash
docker compose --profile skills config --quiet
docker compose --profile skills up -d --build --wait
docker compose --profile skills ps
docker compose --profile skills logs --tail=80 skill-worker
```

**Kubernetes**

1. 在已有 `deploy/k8s/backend.env` 填入值并重建 `agentplaza-backend-env` Secret，见 [部署总览](../../DEPLOYMENT.md)。
2. 将 `deploy/k8s/skill-worker.example.yaml` 的镜像改成与 `app.yaml` 相同的发布后端镜像，应用并更新 API。Worker 对 MongoDB 和 OSS 发出请求，无独立 HTTP 或 Ingress 服务。

```bash
kubectl -n agentplaza apply -f deploy/k8s/skill-worker.example.yaml
kubectl -n agentplaza rollout restart deployment/agentplaza-backend
kubectl -n agentplaza rollout restart deployment/agentplaza-skill-worker
kubectl -n agentplaza rollout status deployment/agentplaza-skill-worker --timeout=180s
kubectl -n agentplaza logs deployment/agentplaza-skill-worker --tail=80
```

Worker 从 MongoDB 队列解析任务。默认按一个副本验收，按压缩包体积、并发量和 S3 带宽评估扩容。处理大 ZIP 时 Worker 会使用内存，API 会将上传暂存于 `/tmp`。Skill 上传路径的默认 Nginx 请求上限为 60 MiB，外层反代、Ingress、WAF 或负载均衡也要允许至少 60 MiB 和足够的上传时间。使用 ingress-nginx 时可按控制器版本设置 `nginx.ingress.kubernetes.io/proxy-body-size: "60m"`，其它控制器按其兼容配置设置。若提升应用的 ZIP 上限，配套调整各层限制及 API 临时盘和 Worker 内存。

## 5. 从界面验收完整流程

1. 生成一个最小的 Skill 压缩包。`SKILL.md` 可在 ZIP 根目录或有独立 Skill 的子目录。

```bash
mkdir -p sample-skill
cat > sample-skill/SKILL.md <<'SKILL'
---
name: rollout-check
description: Summarize a customer deployment acceptance checklist.
---
# Rollout Check

Confirm the test services are ready and record the observed results.
SKILL
(cd sample-skill && zip -q ../rollout-check.zip SKILL.md)
```

2. 普通用户登录，打开 Skill 市场并上传 `rollout-check.zip`。等待解析完成，确认能看到识别出的 Skill，选择提交审核。
3. 以配置在 `ADMIN_BADGES` 的身份登录，在 Skill 管理页面打开待审核条目，检查内容，选择分类并批准。
4. 用普通账号重新打开市场，找到已发布的条目并下载 ZIP。用 `unzip -l` 验证文件，确认发布条目可访问，未发布的内容受登录和审批权限控制。
5. 检查存储端应用身份对 `skills/imports/`、`skills/artifacts/` 的操作记录，以及 Worker 无持续重试。备份应同时覆盖数据库元数据和桶对象。旧部署若保存了 Skill 数据，迁移时需要将已发布及待审核引用的 ZIP 一并复制，并核对每条记录的桶和对象键；只有旧下载 URL 的记录需要先转换成有效的对象引用。更换桶或 Region 前在测试环境验证拷贝、恢复和下载。

## 6. 排障

| 现象 | 先检查 |
| --- | --- |
| Skill 菜单未出现 | `SKILL_ENABLED`、API 是否已重启、登录会话是否重新建立 |
| 上传返回 413 | 浏览器请求体、外层代理及 Nginx 大小限制、`SKILL_MAX_ARCHIVE_BYTES` |
| S3 403 / `SignatureDoesNotMatch` | 身份对应策略、桶 Region、系统时间、path-style、代理是否改写了签名请求的 Host 或路径 |
| `NoSuchBucket` 或 `NoSuchKey` | 签名所用 Endpoint、桶名或旧数据的对象是否复制完整，生命周期是否删除了仍在使用的对象 |
| 一直处于等待解析 | Worker 是否启动、API 和 Worker 是否连同一个 MongoDB/同一个桶、Worker 日志及 Pod 重启次数 |
| 任务失败但健康检查是绿的 | `/api/ready` 只检查 MongoDB 和 Redis。单独执行 S3 Put/Get 和 ZIP 全链路验收 |
| Skill 内容为空或 ZIP 被拒绝 | 检查 `SKILL.md`、文件数量、路径层级、压缩和展开大小 |
