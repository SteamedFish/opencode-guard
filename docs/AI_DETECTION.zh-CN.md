# AI 检测功能

[English Documentation](AI_DETECTION.md)

OpenCode Guard 内置 AI 驱动的敏感数据检测，可识别传统正则表达式可能遗漏的密钥和 PII。

## 概述

AI 检测使用机器学习模型对文本进行上下文分析，识别：
- 自然语言中的密码和密钥
- 代码片段中的 API key
- 日志中嵌入的凭据
- 对话中提及的 PII

它与现有的基于正则的检测互补，捕获边缘情况和依赖上下文的敏感信息。

## Provider

提供三种 AI provider 选项：

### 1. 本地（默认）- Transformers.js

使用 `@huggingface/transformers`（v3+）进行设备端推理。数据不会离开你的机器。

**优点：**
- 100% 私有 — 无 API 调用
- 无网络延迟
- 可离线工作（首次下载模型后）
- 免费

**缺点：**
- 需要下载模型（首次约 300MB）
- 比云端 API 慢
- 准确率低于 GPT-4

**设置：**

方式 1 — 手动安装：
```bash
npm install @huggingface/transformers
```

方式 2 — 自动安装（首次使用时自动安装依赖包）：
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "auto_install_deps": true,
    "ai_timeout_ms": 2000
  }
}
```

**配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "onnx-community/piiranha-v1-detect-personal-information-ONNX",
    "auto_install_deps": false,
    "ai_timeout_ms": 2000
  }
}
```

**模型下载：**

首次使用本地模型时会自动下载并缓存：
- **位置**：已安装的 `@huggingface/transformers` 包目录下的 `.cache/`（Transformers.js v3+ 默认）
- **大小**：默认量化模型约 300MB
- **离线使用**：下载后模型可离线工作
- **清理**：删除缓存目录即可移除模型
- **镜像**：如果 huggingface.co 不可达，可设置标准 `HF_ENDPOINT` 环境变量（例如 `https://8YdLPSj2PgjjnV0ZGXc3RuVugOWDuNl3u92GGWNHPIm7rpqAsfI9ynQBLPrs87gOMe9AX7s25AXpbFn5PwtUD1V28cFW5FStTkZmyFlu3w1OPpSaizXdkFYeVnvjoczZYrfDiMBksH1T41aE4X6r64GRkFxFl66uNub4ufMzKSSMGYYFzCzIetiq3VPQEAA7aEe5V7wCeM-oyusA1fMjiXMeV6jCyxTrTQ3Zo9c:QjJtZr6OpXtKIzxJEkMmqPf9tcizyOQDl60kHYKirSVPEzTLhEdDlCH3qHl56wFXlRKHLbxMpkEi70dMHdD4K0MJOBK7s2SiYPBqV6sUAmjRcYzLmKHTiAdlxuXeyV4E1wXRW4pFeK4kKkHbrqFA0TGrCQGNZaovxwZ5LzNhRKtVZHIe5ZuqdhVuHziuSeTyjBxM6CG0vpMp85OdqJtmOxTKx1eF3IazWc26jaHcu6W2oUxr6bCxKOvDU3OwTCW1ZSG0i6aRfPFf7SmbVSHQkv3DT6C8rB1cBBdkZtOy4r2PLEP9DKUGF8bvh9rp33x0ZtAqAgHLtY30hxQvIRv9Pc5XsuStAXN0ebnySfvlXyMO97NXEKo7kh0SrwXEHrmkFgQmcKwwohuqRoh6ZbiA8z8htDnVaW1vfwL31eTNZDWXyAXuBovqB6TszK3sKumEmK75EzOR79ttXifK0gnLHaCF6XxEdyRxjLS5QfGgDKPl3Fjsdp7MVoBibTymXm0O1XVwzSw9GWAZD5QTElgzXf1KwWXjKy6G1UZ0zDqMdUGwPLNf2MNRTIE5jau8SdjnV80VsAJOwm7gTBVZasStxr2l5IBk9nFuR7xKRvUuCx9gElU8NiDxdcJaSgO6ukcVDPuYvz2ycU07j8vYDJlo0JTv4BZVRmqKEEXkTfzo0JQ2nlIIwSuS40Jnbqg7kQThP0q4YDy3yNq4EbEeBQ1ZfV1lTv4nQdPGWUbEQoTaIioDBH9VLi7Xt6zSgzsFncTkCTqInQHrUpPLCEWEscOTGlxiB03szvhRnDmxp5rIlWrnwyvugfwZDKmhdw1ufYhyeoOkB9sEcMTGeC2qgHZ2CaxrJAdH35SXRlDgTUDTwUvCj8LGFsc8N2aPTk69mEQ5ldWE6gExgc3aMzNPFEFgPVbNiMpVZZ6DLhzQun43edJhzyVxNCg3WscY4u6zWa6m7KTsn6mKFAWPgkcOVSbIoNHKx4qnz4K2O7D5y99bgb7C6AvZdfVgfAbIjAq0B4PFEdDCMPg6aMGWIPhe3DlkzwGYZcQHnKaub13unFg5eUJeU8IOVi2I2V3P5fItDIC9Y0QP9lOD8QlofOceSEiMptYceStDXtAQAy1rFHKVMQKAc2AAoyhLzZBZfUoPvR2VclBmeEnXBLmVTnAMy9cFU9L7hhsSAoqgZboUXuZeQ4tvcz7lV5Bxz9ZYNeOP9MJbHfGslZUsvB1Pm82IWVsLMZdGTs8mTJr7eCsdTSaIqjumC87KgncgySBJ15CNIPrbU8amx8PqKwFeM17Tpw7E2pEg6AV9xYnk0bTfktJog1Kkd60rzTKhp1Eo2YZJ1x0DiTUlxfdsIFhnONaDIxaeJCuCIQdPMPXxzMv1TPBv3hZ1FBcOvsH5v6fmofvxALGBY0wrUWH7LrVkSVidCuNnCUvgHU4iqtS0JOk6AavL3V8kZS7XjdDmUGzgItXkR8CVDUbqBnUtGdmWbIkZuiv8IciEiXAFW4HDB9eaMIErPlnTEQNNaQgzKXYYmTOkPUy23zpkzhuDK2V5umf2q7mvVCAHe22Z8ulq5RP4JTxblEtI5t3wNLKwBRw7VgEuhYgySg3GoQYKp6lQaC8j4mG3Di39tfOgVsXrNT5ib2BNX5bmZUDjMTbF8lEmiu2f72wi7Er2BqrZZrOnJ1FS5KNpmyG4l0tqlEigY1kc0THry2fCR0lPmqryo6S1ARCBxDT9ljuUfKOGFx0eRCgpmDA85mZuA3tqWr9suA7sO8y4AnqISVd5TfG0cZeJj0p2nsGNnxbYFxSY3JrwAHei50Ei77mtCH2ZIvThFwwAUKbBtRavmNtdjv5Rbx6E@huggingface/transformers';

const detector = await pipeline(
  'token-classification',
  'onnx-community/piiranha-v1-detect-personal-information-ONNX',
  { dtype: 'q8' } // 量化权重；替代 v2 的 `quantized: true`
);
const result = await detector('I live at 742 Evergreen Terrace, Springfield', { aggregation_strategy: 'simple' });
// 检出："742"（I-BUILDINGNUM）、"Evergreen Terrace"（I-STREET）、"Springfield"（I-CITY）
```

**自定义模型配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "onnx-community/piiranha-v1-detect-personal-information-ONNX",
    "ai_timeout_ms": 2000
  }
}
```

### 2. OpenAI

使用 OpenAI 的 GPT-4 进行高精度检测。

**优点：**
- 最高准确率
- 响应速度快
- 擅长理解上下文

**缺点：**
- 数据发送到 OpenAI API
- 需要 API key
- 按请求计费

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

使用你自己的 OpenAI 兼容 API 端点（Ollama、LocalAI 等）。

**优点：**
- 自托管时私有
- 无按请求费用
- 模型可定制

**缺点：**
- 需要搭建基础设施
- 模型质量参差不齐

**配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "custom",
    "ai_timeout_ms": 5000,
    "custom_api_endpoint": "http://igBDPUvp.:AluP0G9vfWD6o7eLoPEpzEhAcvDwnldK3ILXeeLBnzbEUxOfqwHrkLCQqFE2mwNNdDvvYjTnL3cdzHsvBNodOBqdFHoTufPuZjnfhNdIt75hnIelRJZJl0tg5qQTlPgCQNNBvAlbOZKQwmQm3PhjIuK0aYs42hNRGqHzmKLMR@huggingface/transformers（v3+）支持：
- ✅ BERT
- ✅ DistilBERT
- ✅ RoBERTa / XLM-RoBERTa
- ✅ DeBERTa / DeBERTa-v2 / DeBERTa-v3
- ✅ ELECTRA
- ✅ MobileBERT
- ✅ ModernBERT

……以及任何支持 token-classification 的架构。注意：模型仓库还必须附带 ONNX 权重。

## 示例

### 检测自然语言中的密码

输入：
```
My database password is SuperSecret123! and my API key is sk-abc123...
```

正则检出：`sk-abc123...`
AI 检出：`SuperSecret123!`（取决于模型是否报警 — 见上方可靠性说明）

### 检测文本中的 PII

输入：
```
User ikma@example.com lives at 742 Evergreen Terrace, Springfield
```

正则检出：`ikma@example.com`
AI 检出：`742 Evergreen Terrace, Springfield`（地址组成部分）

## 故障排查

### 模型加载失败

1. 检查模型仓库是否附带 ONNX 权重（`onnx/` 目录）— 仅含 safetensors 的仓库无法加载
2. 确认使用的是 PII 模型而非 NER 模型：
   ```javascript
   const detector = await pipeline('token-classification', 'model-name');
   console.log(detector.model.config.id2label);
   // 应显示：PASSWORD、API_KEY 等（而非 PER、ORG、LOC）
   ```
3. 检查首次下载的网络连接（或设置 `HF_ENDPOINT` 镜像）
4. 清除缓存重试：删除已安装 `@huggingface/transformers` 包内的 `.cache/` 目录

### 模型能加载但检测不到凭据

默认的 Piiranha 模型对地址类 PII 检测最可靠；对自由文本中的密码和邮箱检测不稳定（见上方可靠性说明）。如需更强的凭据检测，请评估更大的 ONNX PII 模型或 OpenAI provider。

### 超时错误

```
[opencode-guard] AI detection failed: AI detection timeout after 2000ms
```

超时后请求仍会发出——但只做基于正则的 masking。只有 AI 检测才能发现的实体类型（例如街道地址、自然语言凭据）可能以**明文**到达 provider。此 fail-open 行为是有意设计（插件保持可用而不是破坏会话）；如果不可接受，请关闭 `ai_detection` 或配置充足的超时时间。

解决方案：
1. 增大 `ai_timeout_ms`（默认：2000ms）
2. 使用更小的模型
3. 减少分析的文本长度
4. 考虑使用 OpenAI provider 以获得更快推理

### 高延迟

- 如果可以容忍较慢的响应，增大超时时间
- 考虑使用 OpenAI provider 获得更好的性能
- 减小 `ai_timeout_ms` 以更快失败（将只使用正则检测）

### 内存占用（本地 provider）

本地 provider 会将 ML 模型加载到内存：
- 首次运行：下载模型（默认约 300MB）
- 运行时：根据模型大小占用数百 MB 内存
