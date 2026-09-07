<p align="center">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

<h1 align="center">OPL Fleet Cockpit</h1>

<p align="center"><strong>把 OPL Fleet 遥测汇总成一块安静、常亮、可自托管的驾驶舱</strong></p>
<p align="center">OPL Fleet Agent · Telemetry Gateway · 浏览器、Android 常驻屏与原生 iOS 客户端</p>

<p align="center">
  <a href="https://github.com/gaofeng21cn/opl-fleet-cockpit/releases/latest"><img src="https://img.shields.io/github/v/release/gaofeng21cn/opl-fleet-cockpit" alt="最新版本"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg" alt="Apache-2.0 许可证"></a>
  <img src="https://img.shields.io/badge/deployment-Docker-blue.svg" alt="Docker 部署">
</p>

<p align="center">
  <img src="./docs/assets/readme-gallery/htc-load.png" alt="HTC 5G Hub 上运行的单机 Codex 负载界面" width="100%">
</p>

<p align="center"><sub>来自已部署 HTC 5G Hub 常驻屏的 1280×720 实机截图</sub></p>

<table>
  <tr>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-overview.png" alt="总览界面"></td>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-network.png" alt="网络界面"></td>
  </tr>
  <tr>
    <td align="center"><sub>总览</sub></td>
    <td align="center"><sub>网络</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-machines.png" alt="机器界面"></td>
    <td width="50%"><img src="./docs/assets/readme-gallery/htc-pet.png" alt="Codex 宠物界面"></td>
  </tr>
  <tr>
    <td align="center"><sub>机器</sub></td>
    <td align="center"><sub>宠物</sub></td>
  </tr>
</table>

<p align="center"><strong>原生 iPhone 客户端</strong></p>

<table>
  <tr>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-home.png" alt="OPL Fleet Cockpit 原生 iPhone 首页"></td>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-load.png" alt="iPhone 上完整显示的竖屏负载动画"></td>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-pet.png" alt="iPhone 上的 Codex 宠物显示"></td>
    <td width="25%"><img src="./docs/assets/readme-gallery/ios-live-activity.jpg" alt="iPhone 锁定屏幕上的 OPL Fleet Cockpit 负载实时活动"></td>
  </tr>
  <tr>
    <td align="center"><sub>首页</sub></td>
    <td align="center"><sub>负载</sub></td>
    <td align="center"><sub>宠物</sub></td>
    <td align="center"><sub>实时活动</sub></td>
  </tr>
</table>

<table>
  <tr>
    <td width="33%" valign="top">
      <strong>主要用途</strong><br/>
      在可信局域网内统一查看 Codex 活跃度、网络吞吐、设备在线状态和宠物状态
    </td>
    <td width="33%" valign="top">
      <strong>使用入口</strong><br/>
      浏览器、五英寸 Android 常驻屏、Prometheus，以及可选的 Home Assistant
    </td>
    <td width="33%" valign="top">
      <strong>隐私边界</strong><br/>
      Codex 原始会话始终留在各台电脑；服务端只接收允许清单内的汇总指标
    </td>
  </tr>
</table>

> OPL Fleet Cockpit 面向可信局域网，不是公网监控平台。显示页、状态接口和设备批准页默认没有浏览器登录；如需跨越不可信网络，必须增加 HTTPS、访问控制或私有 VPN。

## 产品定位

OPL Fleet Cockpit 在可信局域网聚合 Codex 活跃度、主机负载、可选路由器 WAN 指标及宠物状态。
Gateway 拥有遥测聚合、持久化、发现和展示；Fleet registry、policy、admission、lease
与 dispatch 由 OPL Flow、私有 Instance 和 Fleet Controller 负责。

[OPL Fleet Agent](https://github.com/gaofeng21cn/opl-fleet-agent) 在各电脑采集本机汇总数据。
提示词、回复、session 标识、仓库路径及凭据不属于遥测合同。桌面上报端完成一次设备批准后，
使用各自密钥签名快照。

Gateway 容器包含服务端和浏览器界面。Android 与 iOS 均可发现 Gateway（Fleet）或
单台局域网 Agent（Direct）；Direct 不需要 Gateway。Prometheus 和 Home Assistant 是下游消费者。

## 安装入口

[中文安装教程](docs/installation.zh-CN.md)负责配置、启动、数据源验收与升级，支持 Codex-only、
SNMPv3 和 UniFi API 三种模式。生产使用经过审查的版本化 GHCR 镜像，并保持一个持久化 Gateway 实例。
委托安装时，同时遵循 [Agent 安装边界](docs/agent-installation.zh-CN.md)。

- [Android 常驻屏](android-kiosk/README.md)：签名安装和设备验收。
- [原生 iOS](docs/ios-app.md)：客户端行为、发现和开发。
- [安全边界](docs/security.md)：可信局域网、认证及凭据要求。
- [文档导航](docs/README.md)：按读者任务分工的专项参考及生命周期。

## 开发验证

```bash
npm ci
npm test
npm run build
docker compose -f compose.yaml config --quiet
python3 ops/public-readiness-check.py --current
```

Docker smoke 入口为 `ops/docker/smoke-test.sh`，用于隔离开发容器。
本地构建结果不证明已部署实例的运行状态。

项目采用 [Apache License 2.0](LICENSE)。
