# Agent 安装指南

**简体中文** | [English](agent-installation.md)

本指南用于把 Ambient Ops 安装任务交给 Codex 或其他本机 Agent，同时不把凭据、
破坏性存储操作或未经验证的“已完成”判断一并授权。Agent 仍以
[普通安装教程](installation.zh-CN.md)为主，本页补充权限和证据边界。

## 可以告诉 Agent 的信息

可放进任务里的非敏感信息：

- Docker 主机或群晖地址、目标目录
- `SITE_NAME` 与 IANA `DISPLAY_TIME_ZONE`
- 网络模式：`codex-only`、`snmpv3` 或 `unifi-api`
- 路由器 IPv4、SNMPv3 只读用户名、WAN 选择器
- 是否启用 Home Assistant
- 预期出现的 Codex 主机名称和 Android 设备型号

以下内容不要写进 Agent 提示词或对话：

- `agent_push_token`
- SNMPv3 认证密码与加密密码
- UniFi API key 或 Home Assistant token
- GitHub 凭据、NAS 管理员密码、Android 签名密钥

公开 GHCR 镜像不需要 GitHub 凭据。

## 可直接使用的 Agent 提示词

只替换其中非敏感的尖括号字段：

```text
在 <Docker-host> 的 <absolute-target-directory> 安装或升级 Ambient Ops，
使用 SITE_NAME=<site-name>、DISPLAY_TIME_ZONE=<iana-time-zone>、
AMBIENT_OPS_NETWORK_MODE=<profile>。

严格遵循 docs/installation.zh-CN.md 和 scripts/opl-fleet-cockpit.sh。只使用公开的
版本化 GHCR 镜像；不得在 NAS 上使用 compose.local-build.yaml 或构建源码，
不得创建 GHCR 登录或 DSM 计划任务，不得使用移动镜像标签。

不要让我把 token 或密码粘贴到对话；不要打印或读取 secret 文件内容；不要把
凭据写进 .env、Compose、命令、日志或仓库。只有需要我在可信终端执行文档中的
交互式 set-secret 命令时才暂停。Windows OPL Fleet Agent v0.2.9+ 使用自动设备配对页；
macOS OPL Fleet Agent v0.2.11+ 使用同样的自动配对流程；只有 headless 和旧版 bearer
agent 仍需由我在本机直接输入既有 agent token。

已有安装必须保留 .env、INSTANCE_ID、secrets 目录和 opl-fleet-cockpit_data 数据卷；
绝不能执行 docker compose down -v。修改运行中的实例前，记录当前镜像、提交、
health 回读和准确回滚命令。局域网中只保留一个发现与采集 owner。

只有以下终态全部满足才完成：Compose 没有 build 指令；固定版本的公开镜像正在
运行；/healthz 中所有已配置来源均 live；每台预期 Codex 主机只出现一次；mDNS
解析到目标实例；Android Kiosk 通过 Wi-Fi 工作且没有 adb reverse。真实重启 Docker
主机是另行授权的可选运维操作，不属于本次品牌迁移。最后报告准确命令、非敏感回读、改动文件、
镜像/版本和仍存在的边界。
```

SNMPv3 新安装可追加以下非敏感信息：

```text
路由器地址是 <ipv4>，SNMPv3 只读用户名是 <username>，已经验证的 WAN 选择器是
<ifName-ifAlias-or-index>。需要密码时请让我在可信终端执行两条交互式 set-secret
命令，不要向我索取密码内容。
```

## Agent 执行合同

### 1. 写入前先回读

Agent 应先确认：

- 准确仓库和默认分支
- 升级场景下现有 `.env`、Compose 镜像、`INSTANCE_ID` 和数据卷名称
- 局域网是否已有另一个 Ambient Ops 实例在广播
- 当前 `/healthz` 与 `/api/status`，且不能把 HTTP 200 当成来源就绪
- Android 更新前已安装 APK 的 package、版本和签名证书身份

允许检查 secret 文件是否存在、大小、owner 和 mode；不得打开内容、echo、复制
进证据，也不得把其哈希放进公开报告。

### 2. 只在全新安装时初始化

全新安装：

```bash
git clone https://github.com/gaofeng21cn/opl-fleet-cockpit.git <target>
cd <target>
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh init --profile <codex-only|snmpv3|unifi-api>
```

已有安装不得运行 `init`。Agent 只能修改文档允许的非敏感 `.env` 字段，并保留
实例身份和 secret 路径。

需要密码时，Agent 只要求用户在已经打开的可信终端执行准确命令：

```bash
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_auth_password
./scripts/opl-fleet-cockpit.sh set-secret unifi_snmp_priv_password
```

命令成功退出后 Agent 继续，不询问刚才输入的值。Linux/群晖上再按文档设置 UID
1000 owner，不得降低文件权限。

### 3. 生产写入前验证

```bash
./scripts/opl-fleet-cockpit.sh validate
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
```

渲染结果必须是版本化镜像，使用 `network_mode: host`、启用发现、没有 `ports:`
和 `build:`。根 `compose.yaml` 已可由 DSM 单独读取；`compose.host-network.yaml`
仅为旧的命令行流程兼容保留。

### 4. 通过仓库助手启动

```bash
./scripts/opl-fleet-cockpit.sh up
./scripts/opl-fleet-cockpit.sh status
```

Agent 可以查看 `./scripts/opl-fleet-cockpit.sh logs`。遇到失败应修复第一个真实断点，
而不是增加计划重启。日常自启动 owner 是 Docker Compose 的
`restart: unless-stopped`。

### 5. 连接 OPL Fleet Agent 与 Kiosk

Windows OPL Fleet Agent v0.2.9+ 与 macOS OPL Fleet Agent v0.2.11+ 会自动发现 Ambient Ops、
打开一次批准页，并分别使用 Windows DPAPI 或 macOS Keychain 保存每台设备的
私钥。用户核对六位配对码后批准设备，不再复制共享 token。只有 headless 和旧版
bearer agent 仍由用户在本机写入完全相同的 agent token。Agent 可以配置非敏感
开关并检查设备状态，但不能读取或通过对话中转 token。

Android APK 只能来自正式 Release，并同时校验同名 checksum。执行
`adb install -r` 前比较已安装与候选 APK 的签名证书。已有生产签名 Kiosk 的
日常升级不得先卸载。安装后验证 Home activity、Wi-Fi 发现和空的
`adb reverse --list`。

### 6. 终态验收

证据只包含非敏感事实：

- 仓库提交与 dirty/clean 状态
- 渲染后的镜像引用、容器 image ID/digest
- Compose 服务状态与 restart policy
- `/healthz` 的 mode、各来源状态与 machine 数量
- 预期 machine ID/名称，但不含 session 内容
- mDNS 服务身份与解析出的局域网地址
- Android package/version、证书摘要、Home activity、Wi-Fi 和空 reverse list
- 如另有 owner 授权重启，再记录重启后的服务回读

不能把配置校验、镜像拉取、容器创建或单独 HTTP 存活说成部署完成。

## 升级与回滚边界

升级前记录：

```bash
docker compose --env-file .env -p opl-fleet-cockpit \
  -f compose.yaml -f compose.host-network.yaml config --images
git rev-parse HEAD
./scripts/opl-fleet-cockpit.sh status
```

升级只改变经过审查的部署提交与 `OPL_FLEET_COCKPIT_IMAGE`，并保留 `.env`、
`INSTANCE_ID`、`secrets/` 和命名卷。验收失败时恢复之前记录的镜像与提交，再运行
`validate`、`up`。不得通过旋转 token、删除状态、卸载 Android App 或启动第二个
发现 owner 来临时回滚。

## DSM 构建错误规则

如果 DSM 提示无法“构建” `opl-fleet-cockpit`，Agent 应检查项目定义和日志。生产项目
只拉取公开镜像，根本不构建。DSM 项目应只包含 `compose.yaml`；确认准确项目写集后，
只移除误选的 `compose.local-build.yaml` 或 `build:`。不得用 GHCR Token、DSM
计划任务或在 NAS 上编译源码来解决。
