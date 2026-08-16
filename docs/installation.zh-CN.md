# OPL Fleet Cockpit 安装教程

**简体中文** | [English](installation.md)

这是 Linux Docker 主机或群晖 NAS 的普通用户路径。部署只使用一份不含密码的
`.env`、`secrets/` 下的私密文件、公开的多架构镜像和正式签名 Android APK。
NAS 不在本地构建应用源码。

用户可见产品名为 `OPL Fleet Cockpit`，其中的容器承担
`OPL Fleet Cockpit Gateway`。新安装使用品牌化的仓库、镜像、Compose project、路径和
数据卷；已有安装的 `ambient-ops` 镜像、环境变量、数据卷和
`_ambient-ops._tcp.local` 作为原位迁移兼容别名保留。

## 准备条件

- Linux 主机或群晖 NAS，已安装 Docker Engine 与 Docker Compose v2
- Docker 主机具备 `git`、`curl` 和 `openssl`
- 可信局域网或私有 VPN 可以访问 TCP/8787
- 服务端、OPL Fleet Agent 电脑和 Android Kiosk 之间可传递 UDP/5353 mDNS
- 可选：Docker 主机可通过 IPv4/UDP 161 访问经过验证的 SNMPv3 路由器
- 首次安装 Android 时可使用一台装有 `adb` 的电脑

当前正式服务端镜像是 `ghcr.io/gaofeng21cn/opl-fleet-cockpit:0.1.42`，同时支持
`linux/amd64` 与 `linux/arm64`。该镜像公开可拉取；正常安装不要创建或配置
GitHub Token。

## 1. 创建安装目录

选择一个长期保留的目录。群晖常用路径是 `/volume1/docker/opl-fleet-cockpit`。

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git
cd opl-fleet-cockpit
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init
```

`init` 默认生成最小的 `codex-only` 配置。若新安装一开始就需要路由器遥测，
在 `.env` 尚不存在时改用：

```bash
./scripts/opl-fleet-cockpit.sh init --profile snmpv3
# 或者：./scripts/opl-fleet-cockpit.sh init --profile unifi-api
```

`init` 会拒绝覆盖已有 `.env`，并创建：

- 与所选模式匹配的 `.env`，其中包含自动生成且长期稳定的 `INSTANCE_ID`
- `secrets/agent_push_token`，包含随机 256 位 token
- SNMPv3、UniFi API 和 Home Assistant 使用的空白可选 secret 文件

命令不会打印任何 secret。升级或迁移时必须保留 `.env`、`secrets/` 与 Docker
数据卷。

## 2. 只编辑一份配置文件

用本机文本编辑器打开 `.env`。如果只显示 Codex 和宠物页面，普通用户只需编辑：

```dotenv
SITE_NAME=Home Ambient Ops
DISPLAY_TIME_ZONE=Asia/Shanghai
```

模板已经固定到经过审查的版本化镜像；升级时才修改 `OPL_FLEET_COCKPIT_IMAGE`，并且
不要使用移动标签。时区使用 IANA 名称，例如 `Asia/Shanghai`、`Europe/London`
或 `America/Los_Angeles`。首次启动后不要再修改 `INSTANCE_ID`。

三种网络模式只能选择一种：

| 模式 | 适用情况 | 额外配置 |
| --- | --- | --- |
| `codex-only` | 只需要 Codex 与宠物页面 | `init` 默认模式 |
| `snmpv3` | SNMPv3 authPriv 路由器 | 新安装使用 `init --profile snmpv3`；地址、用户、WAN 选择器、两份密码 |
| `unifi-api` | UniFi API 备用路径 | 新安装使用 `init --profile unifi-api`；控制器 URL 与 API key 文件 |

### SNMPv3 模式

新安装应先使用 `./scripts/opl-fleet-cockpit.sh init --profile snmpv3`，再在 `.env`
中填写非敏感信息。已有 `codex-only` 安装也可手动添加以下字段：

```dotenv
UNIFI_SNMP_HOST=192.168.1.1
UNIFI_SNMP_USER=ambient-ops
UNIFI_SNMP_INTERFACES=WAN
UNIFI_SNMP_CLIENT_INTERFACES=LAN
UNIFI_SNMP_PORT=161
UNIFI_SNMP_AUTH_PROTOCOL=sha
UNIFI_SNMP_PRIV_PROTOCOL=aes
UNIFI_POLL_MS=250
UNIFI_RATE_WINDOW_MS=2000
NETWORK_LATENCY_HOST=1.1.1.1
NETWORK_LATENCY_PORT=443
NETWORK_LATENCY_TIMEOUT_MS=1500
NETWORK_AUXILIARY_POLL_MS=5000
```

`UNIFI_SNMP_INTERFACES` 是精确的 IF-MIB 索引、`ifName` 或 `ifAlias`，匹配时
不区分大小写。多个独立 WAN 用逗号分隔；不要把承载同一流量的 VLAN、PPPoE、
隧道与物理层重复计数。

`UNIFI_SNMP_CLIENT_INTERFACES` 是可选的 LAN 接口选择器，读取标准 IPv4
邻居表并按动态条目的唯一 MAC 去重。因此显示值是活跃邻居估计，不等于控制器
维护的完整客户端清单；路由器不提供 `ipNetToMediaTable` 时保持为空即可。
TCP 延迟探针同样可选，应填写一个确实希望监测的稳定目标；它不需要 raw socket。

用交互式命令录入两个密码，避免写入 shell 历史：

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
```

历史遗留的 `UNIFI_` 前缀不代表只能使用 UniFi。路由器只有在真实流量下验证
`ifHCInOctets` 与 `ifHCOutOctets` 后才能视为兼容。操作见
[路由器与 SNMP 验证文档](unifi.md)。

### UniFi API 备用模式

新安装应先使用 `./scripts/opl-fleet-cockpit.sh init --profile unifi-api`，再设置：

```dotenv
UNIFI_BASE_URL=https://192.168.1.1
UNIFI_SITE=default
```

再执行：

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_api_key
```

SNMPv3 已经正常工作时不需要 API key。

## 3. 设置 Linux 与群晖权限

容器以 UID/GID 1000 运行。所有可选 secret 录入完毕后，让这个非 root 用户可读，
同时保持文件私密：

```bash
sudo chown -R 1000:1000 secrets
sudo chmod 700 secrets
sudo chmod 600 secrets/*
```

macOS Docker Desktop 通常会自动转换 bind mount 权限，不需要这一步。不要用
`chmod 644` 绕过权限问题。

## 4. 验证并启动

```bash
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
```

脚本会验证必填项和 secret、渲染生产 Compose、拉取固定版本的公开镜像，并使用
`restart: unless-stopped` 启动。它永远不会选择 `compose.local-build.yaml`。

随时检查：

```bash
./scripts/opl-fleet-cockpit.sh status
./scripts/opl-fleet-cockpit.sh logs
curl -fsS http://<server-ip>:8787/api/status
```

`/healthz` 返回 HTTP 200 只证明进程存活；还要分别看 `network`、`codex` 与
`machines`。在 `codex-only` 模式下，网络状态不是验收条件。

## 5. 连接每台 OPL Fleet Agent 电脑

从 [OPL Fleet Agent Releases](https://github.com/gaofeng21cn/opl-fleet-agent/releases)
在 macOS 安装 `v0.2.11` 或更高版本，在 Windows 安装 `v0.2.9` 或更高版本。
各电脑的 Codex 原始 session 始终保留在本机，只向 Ambient Ops 发送汇总快照。

打开 Ambient Ops 与自动发现。桌面版会生成每台设备独立的 P-256 密钥，自动
打开局域网批准页，并显示同一个六位配对码；核对后选择 **Allow device**。
macOS 私钥保存在登录 Keychain，Windows 私钥保存为当前用户 DPAPI 密文，
不需要复制共享 token。

`secrets/agent_push_token` 只保留给 headless 与旧版 bearer agent；确实保留
这类 agent 时才在本机输入，绝不要粘贴到对话、截图、Issue 或文档。

每台主机完成一次推送后，应只出现一个稳定且状态为 live 的设备。如果同一主机
出现两次，应停止旧 sender，而不是反复删除在线状态。

## 6. 安装 Android Kiosk

从 [Ambient Ops v0.1.22](https://github.com/gaofeng21cn/opl-fleet-cockpit/releases/tag/v0.1.22)
下载：

- `Ambient-Ops-Kiosk-1.2.7.apk`
- `Ambient-Ops-Kiosk-1.2.7.apk.sha256`

校验并安装：

```bash
shasum -a 256 -c Ambient-Ops-Kiosk-1.2.7.apk.sha256
adb install -r Ambient-Ops-Kiosk-1.2.7.apk
adb shell cmd package set-home-activity \
  cn.gaofeng.ambientops.kiosk/.MainActivity
adb shell am start -n cn.gaofeng.ambientops.kiosk/.MainActivity
```

生产 APK 使用项目固定证书签名。不要在升级时先卸载，否则会清除已记住的服务
身份。`1.2.1` 及后续版本会在页面健康 10 秒后检查当前 Ambient Ops，之后每 6 小时检查一次；
只在接入外部电源且 Wi-Fi 在线时工作，并只接受固定包名、项目证书、递增
`versionCode` 和 manifest SHA-256 完全匹配的 APK。每个版本化服务端镜像都
内置其 GitHub Release 中完全相同的签名 APK。

无人值守安装需要 Magisk root，并首次永久允许 Kiosk 的 `su` 请求。没有 root
时仍可校验发布文件后使用 `adb install -r`。两种路径都不需要 GitHub 凭据。

完成安装后，USB 不参与日常运行。Kiosk 通过 Wi-Fi mDNS 发现服务，记住逻辑
实例，保持沉浸式全屏，并在网络变化后自动重试。

Kiosk `1.2.7` 在页面可见时每 15 秒读取当前服务器由构建内容生成的 UI revision。
连续两次确认 revision 已变化后，WebView 只刷新一次；断网时继续保留当前画面。
因此替换版本化 Docker 镜像后，所有在线 Kiosk 会自行加载新版页面，不需要 USB，
也不会固定周期盲目刷新。

## 7. 最终验收

按实际启用功能完成以下检查：

- Compose 解析到版本化 GHCR 镜像，且没有 `build:`。
- `/healthz` 中 `mode=live`。
- 每台预期 OPL Fleet Agent 主机只出现一次且状态为 live。
- 使用 `snmpv3` 时 `network=live`，制造已知流量时 WAN 速率会变化。
- Android Kiosk 通过 Wi-Fi 加载所有页面，`adb reverse --list` 为空。
- HTC 冷启动后无需 USB 即可重新成为 Android Home。
- 重启恢复检查需要另行获得 owner 授权，不属于本次品牌迁移门禁。

容器自启动依靠 `restart: unless-stopped`。不需要也不建议创建 DSM 计划任务。

## 升级与回滚

升级前记录当前镜像和仓库提交：

```bash
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
git rev-parse HEAD
```

只把 `OPL_FLEET_COCKPIT_IMAGE` 改为经过审查的新版本；若该版本要求新的部署文件，再更新
检出的仓库提交，然后执行：

```bash
./scripts/opl-fleet-cockpit.sh validate
./scripts/opl-fleet-cockpit.sh up
```

重新完成验收。回滚时恢复之前记录的镜像和部署提交，再运行同样两条命令。保留
`.env`、`secrets/`、`INSTANCE_ID` 和命名卷 `opl-fleet-cockpit_data`。升级或回滚时
绝不能执行 `docker compose down -v`。

## 群晖“无法构建项目”处理

生产部署根本不执行构建。如果 DSM 提示“无法构建项目 opl-fleet-cockpit”，进入
Container Manager 日志，并检查项目使用的 Compose 文件。DSM 项目只能使用：

```text
compose.yaml
```

不得包含 `compose.local-build.yaml`，最终渲染内容必须是 `network_mode: host`、
`DISCOVERY_ENABLED=true`，且不能有 `ports` 或 `build:`。通过 SSH 验证：

```bash
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml config --quiet
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml config --images
```

镜像应为 `ghcr.io/gaofeng21cn/opl-fleet-cockpit:<version>`。它是公开镜像，不需要
GHCR 登录或 DSM 计划任务。迁移、持久化、防火墙与重启验证见
[群晖部署参考](deployment-synology.md)。

## 当前产品边界

这套路径适合具备 Docker 基础的用户自助操作，也适合 Agent 按配套指南代装。
用户仍需对局域网/防火墙、稳定实例身份，以及可选的路由器凭据与 WAN 接口作出
本地决定。路由器兼容性必须实测，不能按品牌整体承诺。

现有 API、安全、Home Assistant、迁移、本地开发和 Android 签名文档继续作为
高级参考；简化安装路径不会删除或替代这些开发者资料。
