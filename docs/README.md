# 文档导航与生命周期

本目录按读者任务分工。代码、配置和测试拥有实现事实；文档解释当前合同与操作路径。
文档不记录部署、测试、App Store 审核的滚动状态，这些状态须从对应运行面或发布系统回读。

| 文档 | 唯一职责 | 主要事实来源 |
| --- | --- | --- |
| [安装教程](installation.zh-CN.md) / [English](installation.md) | 完成 Docker 新安装及日常升级、回滚 | `scripts/opl-fleet-cockpit.sh`、`compose.yaml`、`.env.example` |
| [Agent 安装边界](agent-installation.zh-CN.md) / [English](agent-installation.md) | 委托安装时的权限、凭据与证据约束 | 安装教程和安全合同 |
| [群晖部署](deployment-synology.md) | DSM 与受限部署命令的宿主差异 | `ops/synology/opl-fleet-cockpit-deploy` 与安装脚本 |
| [宿主迁移](host-migration.md) | 搬迁现有实例时的单写入者切换与数据连续性 | `server/store.mjs`、`server/pairing.mjs` 和实际卷 |
| [macOS 运行参考](macos-runtime.md) | 现存 LaunchAgent 运行与恢复 | `ops/macos/install-runtime.sh` |
| [NAS 备份审计](nas-backup-audit.md) | 可选的只读 Hyper Backup 回读 | `ops/synology/opl-nas-audit` |
| [Android Kiosk](../android-kiosk/README.md) | 专用显示端构建、签名、安装和设备验收 | Android 源码、Gradle 与 release workflow |
| [iOS 客户端](ios-app.md) | 原生客户端行为及开发构建 | `ios-app/Sources`、`ios-app/project.yml` |
| [App Store 提交](app-store-submission.md) | 待提交元数据和审核说明 | iOS 项目配置；外部状态由 App Store Connect 拥有 |
| [iOS 支持](ios-support.md) | 面向用户的求助入口 | 仓库 Issue 入口 |
| [隐私政策](privacy-policy.md) | 面向用户的数据处理承诺 | iOS 网络、存储与隐私声明 |
| [安全边界](security.md) | 部署信任边界、认证与凭据要求 | 服务端认证、Compose 与存储 |
| [Agent 上报 API](agent-push-api.md) | 入站快照、认证、素材及新鲜度协议 | `server/server.mjs`、`status-model.mjs`、`pairing.mjs` |
| [路由器采集](unifi.md) | SNMPv3 兼容性、配置及 UniFi API | `server/unifi-snmp.mjs`、`server/unifi.mjs` |
| [Home Assistant](home-assistant.md) | 可选下游状态同步 | `server/home-assistant.mjs` |
| [独立实现决策](prior-art.md) | 保留选择专用服务的设计理由 | 当前服务边界和依赖 |

根 README 只负责产品定位与入口，`AGENTS.md` 负责贡献者约束；双语文件是同一主题的语言投影，
修改时同步核对。LICENSE 与既有许可文本保留法律出处，不承担产品说明。

## 维护规则

行为、入口或配置变化时，在同一修改中更新对应主题文档及其语言投影。一个主题只保留一处完整说明，
其他文档引用它。新增文档前先确认现有主题不能承载该任务；确需新增时，在上表说明读者任务与事实来源。

版本号来自配置、发布附件或构建元数据；命令示例选择经过审查的不可变发布，不把旧发布号写成“当前版本”。
测试数量、上传 UUID、审核排队状态、逐次修复清单留在 Git、CI、Release 或 App Store Connect，
不向常用文档累加。

删除失效内容前核对调用者，并把仍影响操作的数据、权限和失败语义迁入当前主题。完全过时且没有独有
决策价值的内容直接删除，Git 保留历史；只有仍可解释约束的历史才保留为明确的决策记录，
不得继续作为安装入口。移动和删除文档同时修复入站链接，不留占位兼容页。

校验只检查链接、资源、格式和可执行示例的确定性问题；语义是否准确由代码与实际调用证据判断，
不得用关键词或固定章节快照代替。
