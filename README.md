# Agent Plaza

Agent Plaza 是一个可自托管的智能体与 MCP 服务目录。用户可以浏览、搜索和收藏应用，维护自己的链接应用。配置 FastGPT、Higress 或企业微信后，可以启用对应的集成。

## 部署

| 方式 | 需要提前准备 |
| --- | --- |
| Docker Compose | Linux 主机、Docker Engine 和 Compose 插件。Compose 会部署 MongoDB 和 Redis。 |
| Kubernetes | 可用集群、kubectl、镜像仓库，以及集群可访问的 MongoDB 和 Redis。对外访问需要 Ingress 控制器、域名和 TLS 证书。 |
| 两种方式通用 | 具备 IdTrust 兼容接口的 OAuth 2.0 服务、已登记的回调地址，以及客户自己的账号和密钥。 |

[部署手册](docs/DEPLOYMENT.md)包含环境变量、启动命令、初始化配置、健康检查、更新与故障排查说明。

客户部署版覆盖广场、链接应用和按需启用的集成。部署时请配置客户自己的数据库、身份源和管理员名单。

## 项目结构

- `frontend/` 包含 Vue 前端和同源 API 代理。
- `backend/` 包含 Express API、MongoDB 模型和 Redis 会话逻辑。
- `deploy/` 包含 Docker Compose 配置模板和 Kubernetes 清单。
