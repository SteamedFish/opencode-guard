# 故障排查指南

OpenCode Guard 的常见问题和解决方案。

## 目录

- [插件无法工作](#插件无法工作)
- [Git 提交包含脱敏值](#git-提交包含脱敏值)
- [MCP 工具调用失败](#mcp-工具调用失败)
- [AI 检测问题](#ai-检测问题)
- [性能问题](#性能问题)
- [调试模式](#调试模式)

---

## 插件无法工作

### 症状
敏感数据（邮箱、API 密钥等）未经脱敏直接发送给 LLM 提供商。

### 常见原因

1. **找不到配置文件**
   - 插件需要配置文件才能工作
   - 解决方案：创建 `opencode-guard.config.json`（参见[配置指南](CONFIGURATION.zh-CN.md)）

2. **缺少 `global_salt`**
   - 没有设置 `global_salt` 插件将无法工作
   - 解决方案：在配置中添加 `"global_salt": "your-salt-here"`

3. **`enabled: false`**
   - 确保配置中的 `enabled` 设置为 `true`

### 调试步骤

```bash
# 启用调试日志以查看发生了什么
export OPENCODE_GUARD_DEBUG=1
opencode
```

留意以下消息：
- `[opencode-guard] config: not found (plugin disabled)` — 缺少配置文件
- `[opencode-guard] config: /path/to/config, enabled=false` — 配置中禁用了插件
- `[opencode-guard] masked N sensitive values` — 正常工作

### 验证配置文件位置

```bash
# 检查配置文件是否存在于预期位置
ls -la ~/.config/opencode/opencode-guard.config.json
ls -la ./opencode-guard.config.json
ls -la ./.opencode/opencode-guard.config.json
```

### 快速检查清单

- [ ] 配置文件存在于[预期位置](CONFIGURATION.zh-CN.md#配置文件位置)之一
- [ ] 配置中设置了 `enabled: true`
- [ ] 设置了 `global_salt` 且为非空字符串
- [ ] 盐值至少 32 个字符以确保安全
- [ ] 配置是有效的 JSON（无语法错误）

---

## Git 提交包含脱敏值

### 症状
提交消息或文件内容包含脱敏值（如 `ce_.rbgrrq@sisyphuslabs.ai`）而不是真实邮箱。

### 原因
git MCP 服务器不在 `exclude_mcp_servers` 列表中，因此它接收到的是脱敏数据。

### 解决方案

将 git MCP 服务器添加到排除列表：

```json
{
  "exclude_mcp_servers": ["git", "github", "filesystem"]
}
```

### 重要说明

- OpenCode 的内置工具（`bash`, `read`, `write`, `edit` 等）自动视为本地
- 只有 MCP 服务器和 MCP 工具需要显式配置
- 将任何需要处理原始数据的 MCP 服务器添加到排除列表

详见 [MCP 服务器配置指南](MCP_SERVERS.zh-CN.md)。

---

## MCP 工具调用失败

### 症状
外部 API 调用（邮件、Slack、Webhook）失败，因为它们接收到脱敏数据。

### 了解此行为

这是**故意的安全行为**。外部服务器应该接收脱敏数据以保护你的机密。

### 解决方案

**方案 1：添加到排除列表（谨慎使用）**

对于确实需要真实数据的外部 API：

```json
{
  "exclude_mcp_servers": ["slack", "sendgrid"]
}
```

⚠️ **警告**：将外部 API 添加到排除列表会将你的敏感数据暴露给第三方。仅对可信服务执行此操作。

**方案 2：改用本地工具**

对于必须使用真实数据的操作，使用 OpenCode 的内置工具而非 MCP 服务器：

- 使用 `bash` 工具替代 shell MCP 服务器
- 使用 `write`/`read` 工具替代 filesystem MCP 服务器

---

## AI 检测问题

### 模型加载失败

**症状**：AI 检测已启用但未工作，或出现模型加载错误。

**解决方案**：

1. **检查架构兼容性**
   - 确保模型使用 BERT/DistilBERT/RoBERTa/DeBERTa
   - 参见 [AI 检测指南](AI_DETECTION.zh-CN.md) 了解支持的架构

2. **确认你使用的是 PII 模型而非 NER 模型**
   - PII 模型检测：密码、API 密钥、信用卡
   - NER 模型检测：姓名、组织、地点
   - 参见 [AI 检测指南](AI_DETECTION.zh-CN.md#推荐的本地模型)

3. **检查网络连接**
   - 首次运行需要下载模型

4. **清除缓存并重试**
   ```bash
   rm -rf ~/.cache/huggingface/hub/
   ```

### 超时错误

```
[opencode-guard] AI detection failed: AI detection timeout after 500ms
```

**解决方案**：

1. **增加超时时间**
   ```json
   {
     "detection": {
       "ai_timeout_ms": 2000
     }
   }
   ```

2. **使用更小的模型**
   - 使用 `gravitee-io/bert-small-pii-detection`（~30MB）替代更大的模型

3. **禁用 AI 检测**
   如果性能至关重要：
   ```json
   {
     "detection": {
       "ai_detection": false
     }
   }
   ```

### "Architecture not supported" 错误

模型使用 `@xenova/transformers` 不支持的架构：

- ❌ ModernBERT（如 `joneauxedgar/pasteproof-pii-detector-v2`）
- ❌ 用于令牌分类的 GPT 风格模型

**解决方案**：使用[推荐列表](AI_DETECTION.md#recommended-local-models)中的模型。

---

## 性能问题

### 高内存使用（本地 AI 提供商）

本地提供商将 ML 模型加载到内存中：

- **首次运行**：下载模型（根据模型大小 30-560MB）
- **运行时**：根据模型大小使用约 200-600MB RAM

**建议**：

| 环境 | 推荐模型 | 大小 |
|------|---------|------|
| 低内存 | `gravitee-io/bert-small-pii-detection` | ~30MB |
| 平衡 | `SoelMgd/bert-pii-detection` | ~66MB |
| 高精度 | `iiiorg/piiranha-v1-detect-personal-information` | ~400MB |

**替代方案**：使用 OpenAI 提供商（无本地内存开销）

### 响应时间慢

**原因和解决方案**：

1. **AI 检测超时太短**
   - 增加 `ai_timeout_ms`
   - 或如果不需要则禁用 AI 检测

2. **大模型加载**
   - 切换到更小的模型
   - 首次加载后模型会被缓存

3. **模式过多**
   - 检查自定义模式的复杂度
   - 移除未使用的模式

---

## 调试模式

启用调试日志以诊断问题：

```bash
export OPENCODE_GUARD_DEBUG=1
opencode
```

### 调试输出说明

| 消息 | 含义 |
|-----|------|
| `config: not found (plugin disabled)` | 在任何位置都找不到配置文件 |
| `config: /path/to/config, enabled=false` | 找到配置但插件被禁用 |
| `config: /path/to/config, enabled=true` | 配置加载成功 |
| `masked N sensitive values` | 成功脱敏 N 个值 |
| `AI detection failed: ...` | AI 检测错误（可能回退到正则） |
| `pattern compiled: ...` | 自定义模式加载成功 |

### 获取更多帮助

如果问题仍然存在：

1. 查看 [AI 检测指南](AI_DETECTION.zh-CN.md) 了解 AI 特定问题
2. 查看 [MCP 服务器指南](MCP_SERVERS.zh-CN.md) 了解 MCP 特定问题
3. 查看 [配置指南](CONFIGURATION.zh-CN.md) 了解设置问题
4. 提交 issue 并包含调试输出
