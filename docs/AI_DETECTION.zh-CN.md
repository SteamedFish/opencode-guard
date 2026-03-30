# AI 检测功能

OpenCode Guard 现在包含 AI 驱动的敏感数据检测功能，可以识别传统正则表达式可能遗漏的机密和 PII 信息。

## 概述

AI 检测使用机器学习模型对文本进行上下文分析并识别：
- 自然语言中的密码和机密信息
- 代码片段中的 API 密钥
- 日志中嵌入的凭据
- 对话中提到的 PII

这通过捕获边缘情况和上下文相关的敏感信息，补充了现有的基于正则的检测。

## 提供商

三种 AI 提供商选项可用：

### 1. 本地（默认）- Transformers.js

使用 `@xenova/transformers` 进行设备端推理。数据不会离开你的机器。

**优点：**
- 100% 隐私 - 无 API 调用
- 无网络延迟
- 离线工作
- 免费

**缺点：**
- 需要下载模型（首次运行时约 100MB）
- 比云 API 慢
- 准确率低于 GPT-4

**设置：**

选项 1 - 手动安装：
```bash
npm install @xenova/transformers
```

选项 2 - 自动安装（首次使用时自动安装包）：
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "auto_install_deps": true,
    "ai_timeout_ms": 500
  }
}
```

**配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "SoelMgd/bert-pii-detection",
    "auto_install_deps": false,
    "ai_timeout_ms": 500
  }
}
```

**模型下载：**

首次使用本地模型时，会自动下载并缓存：
- **位置**：`~/.cache/huggingface/hub/`（可通过 `HF_HOME` 环境变量更改）
- **大小**：每个模型约 100MB
- **离线使用**：下载后，模型可离线工作
- **清理**：删除缓存目录以移除模型

#### 推荐的本地模型

本地提供商使用 token 分类模型。**重要：你需要 PII 专用模型，而不是通用 NER 模型。**

**区别是什么？**
- **PII 模型**：检测密码、API 密钥、信用卡、SSN、邮箱、机密
- **NER 模型**：仅检测姓名、组织、位置（PER、ORG、LOC、MISC）

**为什么较小的模型效果更好：**
- 大型语言模型（7B+ 参数）可能"过度思考"并尝试解释内容而不是仅识别模式
- 它们可能生成解释性文本或以意外方式"帮助"
- 更小、任务专用的模型恰好训练用于一项工作：检测敏感数据

**推荐的 PII 检测模型（全部兼容 Transformers.js）：**

| 模型 | 大小 | 架构 | 最适合 | 密码/机密检测 | 备注 |
|-------|------|--------------|----------|---------------------------|-------|
| `SoelMgd/bert-pii-detection` | ~66MB | DistilBERT | **通用 PII** | ✅ 是 | **推荐默认**。56 个 PII 类别，AI4Privacy 数据集 |
| `gneeraj/deeppass2-bert` | ~560MB | XLM-RoBERTa | **密码、机密、API 密钥** | ✅ 是 | 专门训练用于代码中的机密检测 |
| `iiiorg/piiranha-v1-detect-personal-information` | ~400MB | DeBERTa-v3 | **PII 密集型内容** | ✅ 是（密码 98% 精确度） | 17 种 PII 类型，99.44% 准确率 |
| `gravitee-io/bert-small-pii-detection` | ~30MB | BERT-small | **通用 PII** | ✅ 是 | 资源受限环境的轻量选项 |

**模型详情：**

**SoelMgd/bert-pii-detection**（推荐默认）
- **架构**：DistilBERT（完全兼容 transformers.js）
- **大小**：约 66MB 下载
- **训练**：AI4Privacy PII-42k 数据集
- **类别**：56 种 PII 类型，包括：
  - 凭据：PASSWORD、USERNAME、API_KEY、SECRET_KEY
  - 金融：CREDIT_CARD、BANK_ACCOUNT、SWIFT_BIC
  - 个人：EMAIL、PHONE_NUMBER、SSN、DATE_OF_BIRTH
  - 位置：ADDRESS、CITY、ZIP_CODE、COUNTRY
  - 在线：IP_ADDRESS、MAC_ADDRESS、URL

**gneeraj/deeppass2-bert**
- **架构**：XLM-RoBERTa（兼容 transformers.js）
- **大小**：约 560MB 下载
- **训练**：专注于代码中的机密检测
- **最适合**：检测源代码中的硬编码密码、API 密钥、令牌
- **博客**：[SpecterOps DeepPass2 公告](https://specterops.io/blog/2025/07/31/whats-your-secret-secret-scanning-by-deeppass2/)

**iiiorg/piiranha-v1-detect-personal-information**
- **架构**：DeBERTa-v3（transformers.js 支持）
- **大小**：约 400MB 下载
- **训练**：AI4Privacy PII-200k 数据集
- **类别**：6 种语言的 17 种 PII 类型
- **准确率**：总体 99.44%，邮箱 100% 准确率，密码 98% 精确度
- **备注**：之前被认为不兼容，但 DeBERTa 确实受 @xenova/transformers 支持

**gravitee-io/bert-small-pii-detection**
- **架构**：BERT-small（兼容 transformers.js）
- **大小**：约 30MB 下载
- **训练**：组合多个 PII 数据集
- **最适合**：速度优先的资源受限环境

**⚠️ 应避免使用的模型：**

| 模型 | 避免原因 |
|-------|-----------|
| `Xenova/bert-base-NER` | **仅 NER 模型** - 检测 PER、ORG、LOC、MISC。不检测密码或 API 密钥 |
| `dslim/bert-base-NER` | 相同限制 - 仅 NER |
| `joneauxedgar/pasteproof-pii-detector-v2` | 使用 ModernBERT 架构 - **不受** @xenova/transformers 支持 |
| 大型对话模型（Llama、Mistral 等） | 不适合 token 分类任务 |
| 代码生成模型 | 针对完全不同的任务训练 |

**如何验证模型是 PII 还是 NER：**

检查模型的标签列表：
- **PII 标签**：PASSWORD、API_KEY、CREDIT_CARD、SSN、EMAIL、SECRET
- **NER 标签**：PER、ORG、LOC、MISC（姓名、组织、位置）

使用 SoelMgd/bert-pii-detection 的示例：
```javascript
const { pipeline } = require('@xenova/transformers');

const detector = await pipeline('token-classification', 'SoelMgd/bert-pii-detection');
const result = await detector('My password is SuperSecret123!');
// 检测："SuperSecret123!" 为 PASSWORD
```

**自定义模型配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "SoelMgd/bert-pii-detection",
    "ai_timeout_ms": 500
  }
}
```

### 2. OpenAI

使用 OpenAI 的 GPT-4 进行高精度检测。

**优点：**
- 最高准确率
- 快速响应时间
- 善于理解上下文

**缺点：**
- 数据发送到 OpenAI API
- 需要 API 密钥
- 每次请求收费

**配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "openai",
    "ai_timeout_ms": 2000,
    "openai_api_key": "sk-...",
    "openai_model": "gpt-4"
  }
}
```

### 3. 自定义 / 自托管

使用你自己的 OpenAI 兼容 API 端点（Ollama、LocalAI 等）

**优点：**
- 如果自托管则保护隐私
- 无每次请求费用
- 可定制模型

**缺点：**
- 需要基础设施设置
- 模型质量各异

**配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "custom",
    "ai_timeout_ms": 5000,
    "custom_api_endpoint": "http://localhost:1234/v1",
    "custom_api_key": "optional-api-key"
  }
}
```

## 架构兼容性

### @xenova/transformers 支持：
- ✅ BERT
- ✅ DistilBERT
- ✅ RoBERTa / XLM-RoBERTa
- ✅ DeBERTa / DeBERTa-v2 / DeBERTa-v3
- ✅ ELECTRA
- ✅ MobileBERT

### 不支持：
- ❌ ModernBERT
- ❌ GPT/LLaMA/Mistral（用于 token 分类 - 不同任务）

## 示例

### 检测自然语言中的密码

输入：
```
我的数据库密码是 SuperSecret123!，我的 API 密钥是 sk-abc123...
```

正则检测：`sk-abc123...`
AI 检测：`SuperSecret123!`

### 检测代码中的机密

输入：
```javascript
const config = {
  password: 'hunter2',
  apiKey: process.env.API_KEY
};
```

正则检测：无（无明显模式）
AI 检测：`hunter2` 为密码

### 检测日志中的 PII

输入：
```
用户 john@example.com 使用密码 "MyP@ssw0rd!" 从 192.168.1.100 登录
```

正则检测：`john@example.com`、`192.168.1.100`
AI 检测：`MyP@ssw0rd!` 为密码

## 故障排查

### 模型加载失败

1. 检查架构兼容性 - 确保模型使用 BERT/DistilBERT/RoBERTa/DeBERTa
2. 验证你使用的是 PII 模型，而不是 NER 模型：
   ```javascript
   // 检查模型标签
   const detector = await pipeline('token-classification', 'model-name');
   console.log(detector.model.config.id2label);
   // 应显示：PASSWORD、API_KEY 等（不是 PER、ORG、LOC）
   ```
3. 检查初始下载的互联网连接
4. 清除缓存并重试：`rm -rf ~/.cache/huggingface/hub/`

### 模型下载但不检测密码

模型可能是 NER 模型，而不是 PII 模型：
- NER 模型检测：姓名、组织、位置
- PII 模型检测：密码、API 密钥、信用卡、机密

切换到上面表格中的推荐 PII 模型。

### "架构不支持"错误

模型使用 @xenova/transformers 不支持的架构：
- ❌ ModernBERT（例如，joneauxedgar/pasteproof-pii-detector-v2）
- ❌ 用于 token 分类的 GPT 风格模型

使用上面推荐列表中的模型。

### 超时错误

```
[opencode-guard] AI detection failed: AI detection timeout after 500ms
```

解决方案：
1. 增加 `ai_timeout_ms`（默认：500ms）
2. 使用较小的模型（例如，gravitee-io/bert-small-pii-detection）
3. 减少被分析的文本长度
4. 考虑使用 OpenAI 提供商以获得更快的推理速度

### 高延迟

- 如果可以容忍较慢的响应，增加超时
- 考虑使用 OpenAI 提供商以获得更好的性能
- 减少 `ai_timeout_ms` 以更快失败（仅使用正则检测）
- 使用较小的模型（30-66MB 对比 400-560MB）

### 内存使用（本地提供商）

本地提供商将 ML 模型加载到内存中：
- 首次运行：下载模型（根据模型 30-560MB）
- 运行时：根据模型大小使用约 200-600MB RAM

**建议：**
- 低内存环境：使用 `gravitee-io/bert-small-pii-detection`（30MB）
- 平衡：使用 `SoelMgd/bert-pii-detection`（66MB）
- 高精度：使用 `iiiorg/piiranha-v1-detect-personal-information`（400MB）