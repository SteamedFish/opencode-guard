# MCP 服务器配置指南

本指南介绍如何为不同类型的 MCP（Model Context Protocol）服务器配置 OpenCode Guard。

## 什么是 MCP 服务器？

MCP 服务器为 OpenCode 扩展工具和能力：
- **本地服务器**：文件系统、git、shell 命令（在您的机器上运行）
- **外部服务器**：API、Web 服务、第三方集成（将数据发送到外部）

### 内置工具自动视为本地

**OpenCode 的内置工具**（如 `bash`、`read`、`write`、`edit`、`grep`、`task` 等）**自动视为本地**，无需添加到任何排除列表。这些工具始终通过 `tool.execute.before` 钩子接收真实（未掩码）数据。

您只需要为以下情况配置排除：
- **MCP 服务器**通过 `exclude_mcp_servers`（如 `"filesystem"`、`"git"`）
- **特定 MCP 工具**通过 `exclude_mcp_tools`（如 `"submit_plan"`、`"schedule_job"`）

## 安全挑战

不同类型的服务器需要不同的处理方式：

| 服务器类型 | 示例 | 参数应该 | 结果应该 |
|-----------|------|---------|---------|
| **本地** | 文件系统、git、shell | **恢复**（真实数据） | **掩码**（对 LLM 隐藏） |
| **外部** | 邮件 API、Web 服务 | **掩码**（隐藏秘密） | **掩码**（对 LLM 隐藏） |

## 配置

### `exclude_mcp_servers` - 将服务器标记为"本地"

将本地/受信任的服务器添加到此列表，以便它们接收**真实（未掩码）数据**：

```json
{
  "exclude_mcp_servers": [
    "filesystem",
    "git", 
    "github",
    "shell",
    "local-tools"
  ]
}
```

**默认行为**：不在此列表中的服务器被视为**外部**，接收**掩码数据**。

### `exclude_mcp_tools` - 将特定工具标记为"本地"

将特定工具名称添加到此列表，以便无论它们来自哪个服务器，都将其视为本地：

```json
{
  "exclude_mcp_tools": [
    "submit_plan",
    "schedule_job",
    "list_jobs"
  ]
}
```

**默认排除**：以下工具默认自动排除：
- `submit_plan`, `schedule_job`, `list_jobs`, `get_version`
- `get_skill`, `install_skill`
- `get_job`, `update_job`, `delete_job`, `run_job`, `job_logs`
- `cleanup_global`

这些是 OpenCode 的内置工具，需要真实数据才能正常工作。

### 常见 MCP 服务器

#### 始终排除（本地）
这些需要真实数据才能正常工作：

```json
{
  "exclude_mcp_servers": [
    "filesystem",      // 文件操作
    "git",            // Git 命令
    "github",         // GitHub CLI 操作
    "shell",          // Shell 命令执行
    "terminal",       // 终端访问
    "command-runner"  // 命令执行
  ]
}
```

#### 永不排除（外部）
这些应该接收掩码数据以保护秘密：

```json
{
  // 这些是外部的 - 不要添加到 exclude_mcp_servers
  "external_servers": [
    "email-service",     // 邮件发送 API
    "slack",            // Slack 集成
    "webhook",          // Webhook 调用
    "api-client",       // 通用 API 客户端
    "analytics",        // 分析服务
    "logging-service"   // 外部日志
  ]
}
```

## 工作原理

### 本地/排除服务器的流程

```
1. 用户："提交消息：联系 clio-agent@sisyphuslabs.ai"
   → LLM 看到："联系 ce_.rbgrrq@sisyphuslabs.ai"（已掩码）

2. LLM 生成 git 工具调用：
   → 参数：{ message: "联系 ce_.rbgrrq@sisyphuslabs.ai" }

3. mcp.tool.call.before（git 被排除）：
   → 恢复参数：{ message: "联系 clio-agent@sisyphuslabs.ai" }

4. Git 使用真实邮箱执行

5. mcp.tool.call.after：
   → 在返回给 LLM 之前掩码结果
```

### 外部服务器的流程

```
1. 用户："发送邮件给 clio-agent@sisyphuslabs.ai"
   → LLM 看到："联系 ce_.rbgrrq@sisyphuslabs.ai"（已掩码）

2. LLM 生成邮件工具调用：
   → 参数：{ to: "ce_.rbgrrq@sisyphuslabs.ai" }

3. mcp.tool.call.before（email-service 未被排除）：
   → 掩码参数：{ to: "do+evluzbn@sisyphuslabs.ai" }（双重掩码）
   
   ⚠️ 邮件发送失败 - 但原始秘密受到保护！

4. mcp.tool.call.after：
   → 在返回给 LLM 之前掩码结果
```

## 故障排除

### Git 提交包含掩码值

**问题**：提交消息显示 `ce_.rbgrrq@sisyphuslabs.ai` 而不是 `clio-agent@sisyphuslabs.ai`

**解决方案**：将 git MCP 服务器添加到 `exclude_mcp_servers`：
```json
{
  "exclude_mcp_servers": ["git"]
}
```

### 文件写入时包含掩码内容

**问题**：文件包含掩码值而不是真实数据

**解决方案**：将文件系统服务器添加到排除列表：
```json
{
  "exclude_mcp_servers": ["filesystem"]
}
```

### 外部 API 调用失败

**问题**：邮件/API 调用失败，因为它们接收到掩码数据

**预期行为**：这是**故意为之的安全行为**。API 接收掩码数据而不是真实秘密。

**解决方法**：如果您必须向外部 API 发送真实数据（不推荐），请将其添加到排除列表：
```json
{
  "exclude_mcp_servers": ["my-api-service"]
}
```

**警告**：这会将您的敏感数据暴露给外部服务！

## 完整示例配置

```json
{
  "enabled": true,
  "global_salt": "your-secret-salt-here",
  "exclude_mcp_servers": [
    "filesystem",
    "git",
    "github",
    "shell",
    "terminal"
  ],
  "patterns": {
    "builtin": ["email", "uuid", "ipv4"],
    "exclude": ["example.com", "localhost"]
  }
}
```

## 查找您的 MCP 服务器名称

要查找哪些 MCP 服务器处于活动状态：
1. 启用调试模式：在配置中设置 `"debug": true`
2. 查找日志：`[opencode-guard] mcp.tool.call.before: ...`
3. `serverName` 参数显示服务器 ID

## 安全最佳实践

1. **默认为排除**：有疑问时，排除该服务器
2. **最小化排除**：仅排除绝对需要真实数据的服务器
3. **定期审查**：检查哪些服务器被排除以及原因
4. **永不排除不受信任的服务器**：永远不要将第三方 API 添加到排除列表

## 常见问题

**问：为什么不直接为所有服务器恢复？**
答：为外部 API 恢复会将您的真实秘密发送给第三方，违背插件的目的。

**问：如果我需要向 API 发送真实数据怎么办？**
答：考虑数据是否真正敏感。如果是，请使用其他通信方式。如果不是，请谨慎地将服务器添加到排除列表。

**问：如何知道服务器是本地还是外部？**
答：问："这个服务器会将数据发送到我的机器外部吗？" 如果是，它是外部的，不应该被排除。

**问：我可以排除特定工具而不是整个服务器吗？**
答：可以！使用 `exclude_mcp_tools` 配置选项将特定工具标记为本地，无论它们属于哪个服务器。当您希望服务器中的大多数工具被掩码，但需要特定工具接收真实数据时，这很有用。

**问：那同时执行本地和外部操作的工具呢？**
答：目前，您必须根据主要用例选择。考虑为不同操作使用单独的 MCP 服务器。
