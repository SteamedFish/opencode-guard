# 配置指南

OpenCode Guard 的完整配置说明。

## 目录

- [快速设置](#快速设置)
- [配置文件位置](#配置文件位置)
- [完整配置选项](#完整配置选项)
- [环境变量](#环境变量)
- [自定义模式](#自定义模式)
- [自定义脱敏器](#自定义脱敏器)

---

## 快速设置

**你必须创建 `opencode-guard.config.json` 文件**在以下任一位置：

### 方案 1：全局配置（推荐）

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

> **安全提示**：使用长且随机的盐值（至少 32 字节）。像对待密码一样对待它——不要分享或提交到版本控制。

### 方案 2：项目特定配置

在与 `opencode.json` 相同的目录（你的 OpenCode 项目根目录）创建 `opencode-guard.config.json`。

> **注意**：插件不能开箱即用。`global_salt` 是确定性脱敏所必需的，必须由你自行提供。

---

## 配置文件位置

插件按以下顺序搜索配置（找到第一个即停止）：

1. **`OPENCODE_GUARD_CONFIG`** 环境变量（显式指定路径）
2. **`./opencode-guard.config.json`** — 项目根目录（`opencode.json` 所在目录）
3. **`./.opencode/opencode-guard.config.json`** — 项目的 `.opencode/` 子目录
4. **`~/.config/opencode/opencode-guard.config.json`** — 全局用户配置

**重要提示**：目前配置**不会合并**。找到的第一个配置文件将被完整使用。如果同时存在全局配置和项目配置，只有项目配置会被加载。

---

## 完整配置选项

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
  "exclude_mcp_tools": [
    "submit_plan",
    "schedule_job",
    "list_jobs",
    "get_version",
    "get_skill",
    "install_skill",
    "get_job",
    "update_job",
    "delete_job",
    "cleanup_global",
    "run_job",
    "job_logs"
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

### 选项参考

| 选项 | 描述 | 默认值 |
|-----|------|--------|
| `enabled` | 启用/禁用插件。**注意：** 如果没有配置文件，插件将被禁用 | `true`（配置文件存在时） |
| `debug` | 启用调试日志 | `false` |
| `global_salt` | **必填。** 确定性脱敏的密钥盐值。没有此项插件无法工作 | （无 — 必须设置） |
| `session_ttl` | 会话超时（如 "1h", "30m"） | `"1h"` |
| `max_mappings` | 每会话最大缓存映射数 | `100000` |
| `masking.format_preserving` | 启用格式保持脱敏 | `true` |
| `masking.preserve_domains` | 脱敏时保留邮箱域名 | `true` |
| `masking.preserve_prefixes` | 保留令牌前缀（如 `sk-`, `ghp_`） | `true` |
| `detection.parallel` | 正则和 AI 检测并行运行 | `true` |
| `detection.ai_detection` | 启用基于 AI 的检测 | `false` |
| `detection.ai_provider` | AI 提供商："local", "openai", 或 "custom" | `"local"` |
| `detection.ai_timeout_ms` | AI 检测超时时间（毫秒） | `500` |
| `exclude_llm_endpoints` | 跳过脱敏的 LLM 端点 | `[]` |
| `exclude_mcp_servers` | 视为"本地"的 MCP 服务器 | `[]` |
| `exclude_mcp_tools` | 根据工具名称视为"本地"的 MCP 工具 | 内置工具 |

---

## 环境变量

| 变量 | 描述 |
|------|------|
| `OPENCODE_GUARD_CONFIG` | 配置文件的显式路径 |
| `OPENCODE_GUARD_DEBUG` | 启用调试模式（设为 `1`） |

---

## 自定义模式

添加你自己的正则表达式模式以检测自定义敏感数据：

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

### 模式选项

- `pattern`: 正则表达式字符串（必需）
- `category`: 敏感数据类型的标签（可选）
- `mask_as`: 使用哪个脱敏器（可选，默认为 generic）

---

## 自定义脱敏器

为特定数据类型定义自定义脱敏行为：

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

### 脱敏器类型

- `prefixed_token`: 保留前缀并脱敏其余部分
- `regex`: 应用基于正则的脱敏
- `fixed`: 替换为固定字符串

详见[模式指南](PATTERNS.zh-CN.md)了解更多关于自定义模式和脱敏器的详细信息。
