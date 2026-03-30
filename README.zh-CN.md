# OpenCode Guard

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

> **隐私优先的 OpenCode 插件，支持格式保持脱敏**

[English Documentation](README.md)

## 概述

OpenCode Guard 是一个专注于隐私保护的 [OpenCode](https://opencode.ai) 插件，可在敏感数据到达 LLM 提供商和 MCP 服务器之前自动进行脱敏处理。与传统的占位符脱敏不同，本插件采用**格式保持脱敏**技术——脱敏后的值保留原始数据的格式和结构，使其看起来与真实值无法区分。

**主要特性：**
- 🎭 **格式保持脱敏**：脱敏后的邮箱看起来像邮箱，令牌看起来像令牌
- 🔒 **确定性**：相同输入 + 相同盐值 = 相同脱敏输出
- ⚡ **并行检测**：正则表达式和 AI 检测同时运行
- 🔌 **LLM + MCP 支持**：同时支持 LLM API 调用和 MCP 工具调用的脱敏
- 🚫 **排除端点**：可配置特定端点跳过脱敏
- 💾 **内存存储**：不持久化存储敏感信息

## 免责声明

[![Vibe Coded](https://img.shields.io/badge/Vibe_Coded-100%25-blueviolet)](https://x.com/karpathy/status/1915000668776960013)

本项目由 [Kimi K2.5 for Coding](https://www.moonshot.cn/) **100% Vibe Coding** 编写。作者不懂 JavaScript，一行代码都没看过——但能用就行！🎉

## 演示

在这个演示中，我们要求 LLM：
1. **原样打印**一个邮箱地址
2. 将 `@` 替换为 `_AT_` 后**再打印一次**

[![asciicast](https://asciinema.org/a/OtAgAKxNuZNofN5O.png)](https://asciinema.org/a/OtAgAKxNuZNofN5O)

**使用的提示词：**

> This is my email: "thisemailisfake@example.com", please print the email as is, and print the email with @ replaced with "\_AT\_".

**观察要点：**

- **原样打印**的邮箱被正确还原为原始值——因为脱敏值保持了相同的邮箱格式，OpenCode Guard 可以匹配并还原。
- **`@` → `_AT_`** 的版本**未被还原**——仍然显示的是脱敏后的内容。这正是 LLM 从未看到真实邮箱的证据。LLM 对它收到的*脱敏邮箱*执行了格式变换，产生了一个不再匹配任何已知脱敏值的字符串，因此 OpenCode Guard 无法（也不应该）还原它。

## 快速开始

### 1. 安装

> ⚠️ **尚未发布到 NPM**：本包尚未发布到 NPM。在经过更多测试验证稳定性后，将会发布 beta 版本。

克隆到你选择的位置：

```bash
git clone https://github.com/SteamedFish/opencode-guard.git ~/opencode-guard
```

在 `opencode.json` 中添加：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file:///home/username/opencode-guard/src/index.js"
  ]
}
```

> **路径说明**：你可以使用绝对路径（`file:///home/...`）或相对路径。相对路径会从 **`opencode.json` 文件所在位置**解析，而不是你当前的工作目录。

### 2. 配置

生成安全盐值：

```bash
openssl rand -base64 32
```

在 `~/.config/opencode/opencode-guard.config.json` 创建配置文件：

```json
{
  "enabled": true,
  "global_salt": "YOUR_GENERATED_SALT_HERE"
}
```

> ⚠️ **没有配置文件时插件默认禁用。** 详见[配置指南](docs/CONFIGURATION.zh-CN.md)了解所有选项。

### 3. 完成

OpenCode Guard 现在会自动对所有 LLM 和 MCP 交互中的敏感数据进行脱敏。

## 工作原理

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│    原始文本  │────▶│    脱敏引擎   │────▶│  LLM 提供商  │
│             │     │              │     │             │
└─────────────┘     └──────────────┘     └─────────────┘
                           │
                           ▼
                    ┌──────────────┐
                    │   确定性脱敏值 │
                    └──────────────┘
```

### 脱敏示例

| 数据类型 | 原始值 | 脱敏值 | 策略 |
|---------|-------|--------|------|
| 邮箱 | `john@example.com` | `a3f7@example.com` | 保留域名 |
| OpenAI 密钥 | `sk-abc123...` | `sk-x9m2p5q...` | 保留前缀 |
| GitHub 令牌 | `ghp_xxxxxx` | `ghp_yyyyyy` | 保留前缀 |
| IPv4 | `192.168.1.100` | `192.168.x.x` | 保留网络前缀 |
| IPv6 | `fe80::1` | `fe80:0:0:0::xxxx` | 保留网络前缀 |
| MAC 地址 | `00:1b:44:11:3a:b7` | `00:1b:44:xx:xx:xx` | 保留 OUI 前缀 |
| 数据库 URL | `postgres://user:pass@host` | `postgres://****:****@host` | 脱敏凭据 |
| 密码 | `password=secret` | `password=********` | 脱敏值 |

## 内置检测

- **邮箱**、**API 密钥**（OpenAI、GitHub、AWS）、**HTTP 基础认证**
- **数据库 URL**（PostgreSQL、MySQL、MongoDB）
- **IP 地址**（IPv4、IPv6，保留网络前缀）
- **MAC 地址**、**UUID**
- **凭据**（password=...、username=...、api_key=...）

详见[模式指南](docs/PATTERNS.zh-CN.md)了解自定义模式。

## 可选 AI 检测

用于检测正则可能遗漏的敏感数据：

```bash
npm install @xenova/transformers
```

```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local"
  }
}
```

详见 [AI 检测指南](docs/AI_DETECTION.zh-CN.md) 了解详细设置。

## 文档

| 指南 | 说明 |
|-----|------|
| [配置](docs/CONFIGURATION.zh-CN.md) | 完整配置参考 |
| [模式](docs/PATTERNS.zh-CN.md) | 内置模式和自定义检测 |
| [AI 检测](docs/AI_DETECTION.zh-CN.md) | AI 驱动的检测设置 |
| [MCP 服务器](docs/MCP_SERVERS.zh-CN.md) | MCP 服务器配置 |
| [故障排查](docs/TROUBLESHOOTING.zh-CN.md) | 常见问题及解决方案 |

## 安全说明

1. **全局盐值**：妥善保管 `global_salt` 并保持不变。丢失它意味着无法恢复之前脱敏的值。
2. **无持久化存储**：所有映射仅存储在内存中。插件重启 = 全新会话。
3. **格式合规**：脱敏值保持有效格式（邮箱通过邮箱正则验证，IP 是有效地址等）。
4. **加密安全**：使用 HMAC-SHA256 进行种子生成。没有盐值无法逆向还原。

## 故障排查

**插件没有脱敏？**

```bash
export OPENCODE_GUARD_DEBUG=1
opencode
```

常见原因：
- 找不到配置文件
- 未设置 `global_salt`
- `enabled: false`

详见[故障排查指南](docs/TROUBLESHOOTING.zh-CN.md)了解详细解决方案。

## 许可证

本项目采用 GNU 通用公共许可证 v3.0 或更高版本 — 详见 [LICENSE](LICENSE) 文件。

## 致谢

- 灵感来自 [VibeGuard](https://github.com/inkdust2021/VibeGuard) 和 [OpenCode-VibeGuard](https://github.com/inkdust2021/opencode-vibeguard)
- 为 [OpenCode](https://opencode.ai) 构建
