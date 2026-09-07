# OPL Fleet Cockpit 安装教程

**简体中文** | [English](installation.md)

本教程负责 Docker 安装、日常升级和回滚。[群晖部署](deployment-synology.md)
补充 DSM 管理差异；搬迁已有写入者时遵循[宿主迁移](host-migration.md)。

## 准备条件

Linux Docker 主机需具备 Compose v2、Git、curl 和 OpenSSL。生产通过 TCP/8787
向可信局域网提供服务，通过 UDP/5353 发布 mDNS。服务没有浏览器登录，须遵守
[安全边界](security.md)。SNMPv3 另需通过 IPv4/UDP 161 访问经验证的路由器。

发布工作流构建公开的 `linux/amd64` 与 `linux/arm64` 镜像。选择经过审查的发布并核对附件；
默认镜像引用由 `.env.example` 拥有，本教程不维护“最新已发布版本”。公开拉取不需要
GitHub 凭据，NAS 不构建源码。

## 1. 初始化

选择长期保留的目录，群晖例如 `/volume1/docker/opl-fleet-cockpit`：

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git
cd opl-fleet-cockpit
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init
```

默认模式为 `codex-only`。在 `.env` 尚不存在时，可按需要改用
`init --profile snmpv3` 或 `init --profile unifi-api`。
`init` 拒绝覆盖已有配置，会生成稳定的 `INSTANCE_ID`、随机 256 位
`secrets/agent_push_token` 及空白可选 secret 文件，不打印凭据。升级不能重新初始化。

## 2. 配置

编辑 `.env` 的非敏感字段：

```dotenv
SITE_NAME=Home OPL Fleet Cockpit
DISPLAY_TIME_ZONE=Asia/Shanghai
```

保持生成的 `INSTANCE_ID` 稳定。`OPL_FLEET_COCKPIT_IMAGE` 固定到经过审查的发布，
不得使用 `latest`。已有部署保留实际的 `OPL_FLEET_COCKPIT_DATA_VOLUME` 值。

| 模式 | 额外配置 |
| --- | --- |
| `codex-only` | 不需要路由器凭据 |
| `snmpv3` | 经过验证的路由器地址、只读用户、精确 WAN 选择器、认证及加密 secret 文件 |
| `unifi-api` | 控制器地址、站点及只读 API key 文件 |

[路由器配置](unifi.md)负责选择器、协议、可选客户端计数、延迟及数据源验证。
SNMP 兼容性需要真实 IF-MIB Counter64 证据，不能按品牌判断。
[Home Assistant](home-assistant.md) 为可选集成。

通过交互式命令录入所需凭据：

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
```

以上两条用于 SNMPv3；API 模式使用 `set-secret unifi_api_key`，
Home Assistant 使用 `set-secret ha_token`。凭据不能写入 `.env`、命令行参数、
对话、日志或 Git。

Linux/群晖容器以 UID/GID 1000 运行：

```bash
sudo chown -R 1000:1000 secrets
sudo chmod 700 secrets
sudo chmod 600 secrets/*
```

Docker Desktop 可能转换属主；不要使用 644 权限绕过问题。

## 3. 启动与连接

```bash
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
./scripts/opl-fleet-cockpit.sh status
```

脚本验证配置、拉取固定镜像，并通过生产 Compose 与 `restart: unless-stopped`
启动服务，不使用 `compose.local-build.yaml`。失败时查看脚本的 `logs` 输出。

各电脑安装经过审查的 [OPL Fleet Agent 发布](https://github.com/gaofeng21cn/opl-fleet-agent/releases)，
按其 Gateway 配对流程核对六位验证码后批准。签名设备私钥留在本机，宿主搬迁须保留
Gateway 设备批准。Headless bearer 上报端通过受保护的本机存储使用已有 token，不通过对话传递。

[Android Kiosk 指南](../android-kiosk/README.md)负责签名 APK 选择、安装及设备验收；
原生客户端见 [iOS 指南](ios-app.md)。Direct 模式直连单台 Agent，不能证明 Gateway 采集正常。

## 4. 验收

读取目标主机的 `/healthz` 与 `/api/status`。HTTP 200 只证明存活。
要求非演示模式、每台预期机器唯一且数据新鲜、只有一个 mDNS 实例，
并对每个已配置采集器验证 live 指标。`codex-only` 不要求 WAN 就绪。

核对实际版本化镜像、host 网络、发现、无 `build:` 或端口映射、重启策略及持久化
`/data` 数据卷。Kiosk 在范围内时，按其指南验证无 `adb reverse` 的 Wi-Fi 工作及设备行为。
Docker 主机重启是另行授权的操作，重启策略不能证明重启恢复。

## 升级与回滚

记录部署提交、实际镜像及摘要、`INSTANCE_ID`、真实数据卷和数据源健康状态：

```bash
git rev-parse HEAD
docker compose --env-file .env -p opl-fleet-cockpit -f compose.yaml config --images
./scripts/opl-fleet-cockpit.sh status
```

只按经过审查的发布要求更新部署文件，设置准确的 `OPL_FLEET_COCKPIT_IMAGE`，
运行 `validate`、`up` 后重复验收。回滚时恢复之前的镜像和部署提交，再执行相同命令。
保留 `.env`、`secrets/`、`INSTANCE_ID` 和实际数据卷，禁止 `docker compose down -v`。
DSM 构建错误见[群晖参考](deployment-synology.md)。
