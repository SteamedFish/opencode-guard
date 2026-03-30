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
- 🔧 **智能 MCP 处理**：针对本地和外部 MCP 服务器的不同处理（[查看文档](docs/MCP_SERVERS.zh-CN.md)）
- 💾 **内存存储**：不使用 SQLite，不持久化存储敏感信息

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
| 用户名 | `username=admin` | `username=********` | 脱敏值 |

## 安装

### 方法一：NPM 包（推荐）

```bash
npm install opencode-guard
```

在 `opencode.json` 中添加：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-guard"
  ]
}
```

**⚠️ 安装后，你必须创建配置文件**（详见下方的[配置](#配置)部分）。默认情况下插件在未配置时会被禁用。

### 方法二：本地开发

1. 克隆本仓库：
```bash
git clone https://github.com/SteamedFish/opencode-guard.git
```

2. 在 `opencode.json` 中添加：
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "file://./opencode-guard/src/index.js"
  ]
}
```

## 配置

> ⚠️ **重要提示：没有配置文件时插件默认禁用！**
>
> 出于安全考虑，插件需要**同时满足**：
> 1. 配置文件必须存在
> 2. `enabled: true` 和 `global_salt` 必须设置
>
> 如果找不到配置文件，或缺少这些值，插件将静默不执行任何操作。
> 使用 `OPENCODE_GUARD_DEBUG=1` 可查看调试信息。

### 快速设置

**你必须创建 `opencode-guard.config.json` 文件**在以下任一位置：

**方案 1：全局配置（推荐）**

首先，生成一个安全的盐值（选择以下任一方法）：

```bash
# 方法 1：OpenSSL（推荐）
openssl rand -base64 32

# 方法 2：/dev/urandom
head -c 32 /dev/urandom | base64

# 方法 3：Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

然后创建配置文件：

```bash
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode-guard.config.json << 'EOF'
{
  "enabled": true,
  "global_salt": "YOUR_GENERATED_SALT_HERE"
}
EOF
```

> 💡 **安全提示**：使用长且随机的盐值（至少 32 字节）。像对待密码一样对待它——不要分享或提交到版本控制。

**方案 2：项目特定配置**
在与 `opencode.json` 相同的目录（你的 OpenCode 项目根目录）创建 `opencode-guard.config.json`。

> **注意**：插件不能开箱即用。`global_salt` 是确定性脱敏所必需的，必须由你自行提供。

### 完整示例

```json
{
  "enabled": true,
  "debug": false,
  "global_salt": "your-secret-salt-change-this",
  "session_ttl": "1h",
  "max_mappings": 100000,
  "masking": {
    "format_preserving": true,
    "preserve_domains": true,
    "preserve_prefixes": true
  },
  "detection": {
    "parallel": true,
    "ai_detection": false,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  },
  "exclude_llm_endpoints": [
    "http://localhost:11434"
  ],
  "exclude_mcp_servers": [
    "local-filesystem"
  ],
  "patterns": {
    "keywords": [],
    "regex": [
      { "pattern": "sk-[A-Za-z0-9]{48}", "category": "OPENAI_KEY", "mask_as": "sk_token" }
    ],
    "builtin": ["email", "uuid", "ipv4"],
    "exclude": ["example.com", "localhost"]
  },
  "custom_maskers": {}
}
```

### 配置选项

| 选项 | 描述 | 默认值 |
|-----|------|--------|
| `enabled` | 启用/禁用插件。**注意：** 如果没有配置文件，插件将被禁用 | `true`（配置文件存在时） |
| `debug` | 启用调试日志 | `false` |
| `global_salt` | **必填。** 确定性脱敏的密钥盐值。没有此项插件无法工作 | （无 — 必须设置） |
| `session_ttl` | 会话超时（如 "1h", "30m"） | `"1h"` |
| `max_mappings` | 每会话最大缓存映射数 | `100000` |
| `detection.parallel` | 正则和 AI 检测并行运行 | `true` |
| `detection.ai_detection` | 启用基于 AI 的检测 | `false` |
| `exclude_llm_endpoints` | 跳过脱敏的 LLM 端点 | `[]` |
| `exclude_mcp_servers` | 视为"本地"的 MCP 服务器（参见 [MCP 服务器指南](docs/MCP_SERVERS.zh-CN.md)） | `[]` |

### 配置文件位置（按优先级排序）

插件按以下顺序搜索配置（找到第一个即停止）：

1. **`OPENCODE_GUARD_CONFIG`** 环境变量（显式指定路径）
2. **`./opencode-guard.config.json`** — 项目根目录（`opencode.json` 所在目录）
3. **`./.opencode/opencode-guard.config.json`** — 项目的 `.opencode/` 子目录
4. **`~/.config/opencode/opencode-guard.config.json`** — 全局用户配置

**重要提示**：目前配置**不会合并**。找到的第一个配置文件将被完整使用。如果同时存在全局配置和项目配置，只有项目配置会被加载。

## 支持的模式

### 内置检测

- **邮箱**：`user@example.com`
- **API 密钥**：`sk-...`, `sk-proj-...`, `sk-or-v1-...`, `sk-litellm-...`, `sk-kimi-...`, `sk-ant-...`
- **GitHub 令牌**：`ghp_...`, `gho_...`, `ghu_...`, `ghs_...`, `ghr_...`
- **AWS 密钥**：`AKIA...`, `ASIA...`
- **HTTP 基础认证**：`https://user:pass@host`, `Basic base64...`
- **数据库 URL**：`postgres://...`, `mysql://...`, `mongodb://...`, `mongodb+srv://...`
- **环境变量**：`DATABASE_URL=...`, `CONNECTION_STRING=...`
- **通用凭据**：`api_key=...`, `secret_key=...`, `access_token=...` 等
- **密码**：`password=...`, `passwd=...`, `pwd=...`
- **用户名**：`username=...`, `user=...`
- **IP 地址**：IPv4、IPv6（保留网络前缀）
- **MAC 地址**：`aa:bb:cc:dd:ee:ff`、`aa-bb-cc-dd-ee-ff`、`AABBCCDDEEFF`（保留 OUI 前缀）
- **UUID**：标准 UUID 格式

### 自定义模式

在配置中添加自定义检测模式：

```json
{
  "patterns": {
    "regex": [
      {
        "pattern": "myapp-[a-z0-9]{32}",
        "category": "MYAPP_TOKEN",
        "mask_as": "token"
      }
    ]
  }
}
```

### 自定义脱敏器

定义自定义脱敏行为：

```json
{
  "custom_maskers": {
    "my_token": {
      "type": "prefixed_token",
      "prefix": "myapp-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    }
  }
}
```

## 故障排查

### 插件没有进行脱敏

**症状**：敏感数据（邮箱、API 密钥等）被直接发送给 LLM 提供商，没有经过脱敏处理。

**常见原因**：
1. **找不到配置文件**：插件需要配置文件才能工作。请参阅[配置](#配置)部分。
2. **缺少 `global_salt`**：没有设置 `global_salt` 插件将无法工作。
3. **`enabled: false`**：确保配置中的 `enabled` 设置为 `true`。

**调试步骤**：
```bash
# 启用调试日志以查看发生了什么
export OPENCODE_GUARD_DEBUG=1
opencode
```

留意以下消息：
- `[opencode-guard] config: not found (plugin disabled)` — 缺少配置文件
- `[opencode-guard] config: /path/to/config, enabled=false` — 配置中禁用了插件
- `[opencode-guard] masked N sensitive values` — 正常工作

**验证配置文件位置**：
```bash
# 检查配置文件是否存在于预期位置
ls -la ~/.config/opencode/opencode-guard.config.json
ls -la ./opencode-guard.config.json
ls -la ./.opencode/opencode-guard.config.json
```

### Git 提交包含掩码值

**症状**：提交消息或文件内容包含掩码值（如 `ce_.rbgrrq@sisyphuslabs.ai`）而不是真实邮箱。

**原因**：git MCP 服务器不在 `exclude_mcp_servers` 列表中，因此它接收到的是掩码数据。

**解决方案**：将您的 git MCP 服务器添加到排除列表：
```json
{
  "exclude_mcp_servers": ["git", "github", "filesystem"]
}
```

详见 [MCP 服务器配置指南](docs/MCP_SERVERS.zh-CN.md)。

### MCP 工具调用因掩码数据而失败

**症状**：外部 API 调用（邮件、Slack、Webhook）失败，因为它们接收到掩码数据。

**原因**：这是**故意的安全行为**。外部服务器应该接收掩码数据以保护您的秘密。

**解决方案**：
- 对于确实需要真实数据的外部 API：添加到 `exclude_mcp_servers`（谨慎使用）
- 对于必须使用真实数据的操作：使用本地工具（git、文件系统）代替

⚠️ **警告**：将外部 API 添加到排除列表会将您的敏感数据暴露给第三方。

## 安全说明

1. **全局盐值**：`global_salt` 是确定性脱敏的关键。请妥善保管并保持不变。
   - 使用加密安全的方法生成（OpenSSL、`/dev/urandom` 或 Node.js `crypto.randomBytes`）
   - 使用至少 32 字节的熵
   - 切勿将盐值提交到版本控制
   - 备份你的盐值——丢失它意味着你无法恢复之前脱敏的值
2. **无持久化存储**：所有映射仅存储在内存中。插件重启 = 全新会话。
3. **格式合规**：脱敏值保持有效格式（邮箱通过邮箱正则验证，IP 是有效地址等）。
4. **加密安全**：使用 HMAC-SHA256 进行种子生成。没有盐值无法逆向还原。

## 许可证

本项目采用 GNU 通用公共许可证 v3.0 或更高版本 - 详见 [LICENSE](LICENSE) 文件。

## 贡献

欢迎贡献！请随时提交 Pull Request。

## 致谢

- 灵感来自 [VibeGuard](https://github.com/inkdust2021/VibeGuard)
- 为 [OpenCode](https://opencode.ai) 构建
