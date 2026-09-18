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

**无需配置文件即可开始使用**——首次运行时插件会自动生成一个（见[配置文件位置](#配置文件位置)）。只有需要自定义设置或使用自己的盐值时，才需要执行以下步骤。

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

> **注意**：插件开箱即用——如果没有配置文件，首次运行时会自动生成包含随机 `global_salt` 的最小配置。但如果你自行创建配置文件，则**必须**包含 `global_salt`：已有配置缺少此项会禁用插件（fail-safe）。

---

## 配置文件位置

插件按以下顺序搜索配置（找到第一个即停止）：

1. **`OPENCODE_GUARD_CONFIG`** 环境变量（显式指定路径）
2. **`./opencode-guard.config.json`** — 项目根目录（`opencode.json` 所在目录）
3. **`./.opencode/opencode-guard.config.json`** — 项目的 `.opencode/` 子目录
4. **`~/.config/opencode/opencode-guard.config.json`** — 全局用户配置

**重要提示**：目前配置**不会合并**。找到的第一个配置文件将被完整使用。如果同时存在全局配置和项目配置，只有项目配置会被加载。

**首次运行自动生成**：如果在上述任何位置都找不到配置文件，插件会在位置 4（`~/.config/opencode/opencode-guard.config.json`）自动创建最小配置，内含随机生成的 `global_salt`（权限 `0600`），并立即启用自身。生成的文件可随时编辑。如果文件写入失败，插件会回退为内存随机盐（重启后映射失效）、打印警告，并保持启用状态。

**配置损坏 = 失效关闭（fail-closed）**：如果配置文件*存在*但无法解析（JSON 无效），插件会打印错误并禁用自身。此时**不会**自动生成替代配置——自动生成仅发生在完全不存在配置文件时。请修复或删除损坏的文件。

---

## 完整配置选项

```json
{
  "enabled": true,
  "debug": false,
  "debug_file": "",
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
    "ai_timeout_ms": 2000
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
| `enabled` | 启用/禁用插件。插件默认启用，只有显式设置 `enabled: false` 才会禁用。如果完全没有配置文件，首次运行时会自动生成最小配置（见[配置文件位置](#配置文件位置)） | `true` |
| `debug` | 启用调试日志 | `false` |
| `debug_file` | 将调试输出追加写入此文件（仅在 `debug` 开启时生效）。在 OpenCode v2 下控制台输出不可见时尤其有用。**警告：** 文件包含明文敏感信息（脱敏值→原始值的映射）。路径必须是绝对路径（相对路径会被拒绝并告警）；文件每次启动时都会被清空（truncate），并以 `0600` 权限创建；启用文件日志时启动阶段会打印警告。请仅在临时调试时开启，调试结束后删除该文件 | `""`（关闭） |
| `global_salt` | **必填。** 确定性脱敏的密钥盐值。没有此项插件无法工作。可被 `OPENCODE_GUARD_SALT` 环境变量覆盖（最高优先级）。如果包含盐值的配置文件可被 group/others 读取，插件会打印警告（期望权限：`0600`） | （无 — 必须设置） |
| `session_ttl` | 会话超时（如 "1h", "30m"） | `"1h"` |
| `max_mappings` | 每会话最大缓存映射数 | `100000` |
| `masking.format_preserving` | 启用格式保持脱敏 | `true` |
| `masking.preserve_domains` | 脱敏时保留邮箱域名 | `true` |
| `masking.preserve_prefixes` | 保留令牌前缀（如 `sk-`, `ghp_`） | `true` |
| `detection.parallel` | 正则和 AI 检测并行运行 | `true` |
| `detection.ai_detection` | 启用基于 AI 的检测。**这是唯一默认关闭的功能**——其他所有功能均开箱即用 | `false` |
| `detection.ai_provider` | AI 提供商："local", "openai", 或 "custom" | `"local"` |
| `detection.ai_timeout_ms` | AI 检测超时时间（毫秒） | `2000` |
| `exclude_llm_endpoints` | 跳过脱敏的 LLM 端点。支持主机名或 `host:port` 条目（scheme 可选）。域名条目匹配精确主机及其子域名（如 `api.example.com` 覆盖 `v2.api.example.com`），但不会匹配无关后缀（如 `api.example.com.evil.tld` **不会**被排除）。空条目会被拒绝并告警 | `[]` |
| `exclude_mcp_servers` | 视为"本地"的 MCP 服务器 | `[]` |
| `exclude_mcp_tools` | 视为"本地"的 MCP 工具。**按服务器限定作用域：** 裸工具名仅对 `exclude_mcp_servers` 中列出的服务器生效（绝不匹配外部服务器）。如需对特定服务器上的特定工具豁免，请使用限定条目 `server/tool`（或实际的 `server_tool` 名称） | 内置工具 |

---

## 环境变量

| 变量 | 描述 |
|------|------|
| `OPENCODE_GUARD_CONFIG` | 配置文件的显式路径 |
| `OPENCODE_GUARD_DEBUG` | 启用调试模式（设为 `1`） |
| `OPENCODE_GUARD_DEBUG_FILE` | 调试日志文件路径（覆盖 `debug_file`；仅在调试开启时生效） |
| `OPENCODE_GUARD_SALT` | 覆盖配置文件中的 `global_salt`（最高优先级） |

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
