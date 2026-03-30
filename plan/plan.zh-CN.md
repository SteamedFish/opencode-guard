# OpenCode Guard 实现计划

> **目标**：构建一个具有格式保持脱敏功能的 OpenCode 插件 - 敏感数据被替换为保持原始格式的逼真值。

**架构**：插件使用格式特定的脱敏器（邮箱、令牌、IP、UUID 等）生成确定性的逼真替换。每个脱敏器使用基于 HMAC 种子的 RNG 以保证可重现性。

**技术栈**：Node.js（ES 模块）、原生加密、OpenCode 插件 API

---

## 项目结构

```
./
├── src/
│   ├── index.js              # 插件入口点 - OpenCode 钩子
│   ├── engine.js             # redact/redactDeep - 核心脱敏逻辑
│   ├── detector.js           # 基于模式的敏感数据检测
│   ├── patterns.js           # 内置模式（邮箱、uuid、ipv4 等）
│   ├── session.js            # MaskSession - 确定性脱敏存储
│   ├── config.js             # 从多个源加载配置
│   ├── restore.js            # restoreText/restoreDeep - 还原
│   ├── utils.js              # createSeededRNG、哈希工具
│   ├── streaming-unmasker.js # 流式响应还原
│   └── maskers/              # 每种数据类型的专用脱敏器
│       ├── index.js          # 脱敏器注册表和分发
│       ├── email.js          # 邮箱脱敏（保留域名）
│       ├── token.js          # API 密钥脱敏（保留前缀）
│       ├── ip.js             # IPv4/IPv6 脱敏（保留网络）
│       ├── uuid.js           # UUID 脱敏
│       ├── mac.js            # MAC 地址脱敏
│       ├── basicAuth.js      # HTTP Basic Auth 脱敏
│       ├── database.js       # 数据库 URL 脱敏
│       ├── credential.js     # 密码/用户名脱敏
│       ├── generic.js        # 基于回退模式的脱敏
│       └── custom.js         # 自定义脱敏器注册表
├── tests/                    # 镜像 src/ 结构
├── docs/                     # 额外文档
├── opencode-guard.config.json.example  # 配置模板
├── package.json              # ES 模块，Node >=18
└── README.md / README.zh-CN.md
```

---

## 核心功能模块

### 1. 配置系统 (`src/config.js`)
- 从多个位置加载配置（环境变量、项目根目录、.opencode 目录、用户配置目录）
- 验证必需字段（global_salt）
- 支持检测设置、排除端点、模式配置

### 2. 检测管道 (`src/detector.js`)
- 并行运行正则和 AI 检测
- 合并结果并去重
- 冲突解决（优先选择更长的匹配）

### 3. 格式保持脱敏 (`src/maskers/`)
每种数据类型的专用脱敏器：
- **邮箱**：保留域名，脱敏本地部分
- **API 密钥**：保留前缀（sk-、ghp_），重新生成后缀
- **IP**：保留网络前缀，脱敏主机部分
- **UUID**：生成有效的 UUID v4 替换
- **MAC**：生成有效的 MAC 地址替换
- **数据库 URL**：脱敏用户名和密码
- **凭据**：脱敏密码、用户名等

### 4. 会话管理 (`src/session.js`)
- 基于内存的映射存储
- TTL 清理（惰性过期）
- 最大映射限制防止内存泄漏
- 确定性映射（原始→脱敏，脱敏→原始）

### 5. 还原系统 (`src/restore.js`)
- 文本还原：在字符串中查找并替换脱敏值
- 深度还原：遍历 JSON 结构并还原所有值

### 6. 流式还原 (`src/streaming-unmasker.js`)
- 在 token 边界上缓冲
- 检测部分脱敏值
- 实时还原

---

## OpenCode 插件生命周期

1. **加载**：调用 `OpenCodeGuard(ctx)`，加载配置
2. **转换**：`experimental.chat.messages.transform` - 对传出消息脱敏
3. **完成**：`experimental.text.complete` - 对传入响应还原
4. **MCP 之前**：`mcp.tool.call.before` - 对工具参数脱敏
5. **MCP 之后**：`mcp.tool.call.after` - 对工具结果还原

---

## AI 检测功能

使用机器学习模型进行上下文敏感数据检测：
- 本地提供商：@xenova/transformers（默认，设备端）
- OpenAI 提供商：GPT-4（高精度，云端）
- 自定义提供商：OpenAI 兼容端点（自托管）

**支持的模型架构**：BERT、DistilBERT、RoBERTa、DeBERTa、ELECTRA、MobileBERT

**推荐模型**：
- `SoelMgd/bert-pii-detection`（默认，~66MB）
- `gneeraj/deeppass2-bert`（密码检测，~560MB）
- `iiiorg/piiranha-v1-detect-personal-information`（高精度，~400MB）
- `gravitee-io/bert-small-pii-detection`（轻量，~30MB）

---

## 配置示例

```json
{
  "global_salt": "your-secret-salt-here",
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "SoelMgd/bert-pii-detection",
    "auto_install_deps": true,
    "ai_timeout_ms": 500
  },
  "exclude_llm_endpoints": [
    "http://localhost:1234"
  ],
  "exclude_mcp_servers": [
    "local-filesystem"
  ]
}
```

---

## 测试

- 每个脱敏器的单元测试
- 检测管道集成测试
- 配置加载测试
- 会话管理测试
- 端到端脱敏/还原测试

运行测试：
```bash
npm test
```

---

## 文档

- `README.md` / `README.zh-CN.md` - 主文档
- `docs/CONFIGURATION.md` - 配置参考
- `docs/PATTERNS.md` - 模式指南
- `docs/AI_DETECTION.md` - AI 检测文档
- `docs/MCP_SERVERS.md` - MCP 服务器配置
- `docs/TROUBLESHOOTING.md` - 故障排查
- `plan/design.md` - 架构设计

---

## 许可证

GPL-3.0-or-later