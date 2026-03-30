# AI 检测实现计划

**目标**：实现基于 AI 的敏感数据检测，以补充正则表达式模式，检测上下文相关的机密信息和正则表达式无法捕获的自由格式密码。

**架构**：创建可插拔的 AI 检测器系统，支持多个提供商（本地 Transformers.js、OpenAI、自定义端点）。当 `ai_detection: true` 时，AI 检测与正则检测并行运行。使用冲突解决合并结果（优先选择更长的匹配）。实现超时和优雅降级。

**技术栈**：Node.js ES 模块、@xenova/transformers（本地）、原生 fetch（远程 API）

---

## 背景

目前，`ai_detection`、`ai_provider` 和 `ai_timeout_ms` 配置选项存在但未使用。本计划实现该功能。

**要实现的配置：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "ai_timeout_ms": 500
  }
}
```

---

## 任务 1：创建 AI 检测器模块结构

**文件：**
- 创建：`src/ai-detector/index.js`
- 创建：`src/ai-detector/providers.js`
- 创建：`src/ai-detector/merge.js`
- 创建：`tests/ai-detector/` 目录

**步骤 1：创建提供程序接口和注册表**

`src/ai-detector/providers.js`：
```javascript
/**
 * AI 提供程序注册表和基础接口
 */

export class AIProvider {
  constructor(config) {
    this.config = config;
  }

  async isAvailable() {
    throw new Error('必须实现 isAvailable');
  }

  async detect(text) {
    throw new Error('必须实现 detect');
  }
}

export class LocalProvider extends AIProvider {
  // 使用 @xenova/transformers 在设备端实现
}

export class OpenAIProvider extends AIProvider {
  // 使用 OpenAI API 实现
}

export class CustomProvider extends AIProvider {
  // 使用自定义端点实现
}

export function createProvider(config) {
  switch (config.ai_provider) {
    case 'local': return new LocalProvider(config);
    case 'openai': return new OpenAIProvider(config);
    case 'custom': return new CustomProvider(config);
    default: throw new Error(`未知的 AI 提供程序：${config.ai_provider}`);
  }
}
```

**步骤 2：创建合并逻辑**

`src/ai-detector/merge.js`：
```javascript
/**
 * 合并正则和 AI 检测结果
 */

export function mergeDetections(regexMatches, aiMatches) {
  const all = [...regexMatches, ...aiMatches];
  
  // 按起始位置排序，然后按长度排序（优先选择更长的）
  all.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    return (b.end - b.start) - (a.end - a.start);
  });
  
  // 去重重叠的匹配
  const merged = [];
  for (const match of all) {
    const last = merged[merged.length - 1];
    if (!last || match.start >= last.end) {
      merged.push(match);
    }
    // 否则：重叠，跳过（由于排序，保留更长的）
  }
  
  return merged;
}
```

**步骤 3：创建主检测器**

`src/ai-detector/index.js`：
```javascript
import { createProvider } from './providers.js';
import { mergeDetections } from './merge.js';

export class AIDetector {
  constructor(config) {
    this.config = config;
    this.provider = createProvider(config);
  }

  async detect(text, regexMatches = []) {
    if (!this.config.ai_detection) {
      return regexMatches;
    }

    const isAvailable = await this.provider.isAvailable();
    if (!isAvailable) {
      console.warn('[opencode-guard] AI 检测器不可用，使用仅正则检测');
      return regexMatches;
    }

    try {
      const aiMatches = await this.runWithTimeout(
        () => this.provider.detect(text),
        this.config.ai_timeout_ms || 500
      );
      
      return mergeDetections(regexMatches, aiMatches);
    } catch (error) {
      console.warn('[opencode-guard] AI 检测失败：', error.message);
      return regexMatches;
    }
  }

  runWithTimeout(fn, timeoutMs) {
    return Promise.race([
      fn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI 检测超时')), timeoutMs)
      )
    ]);
  }
}
```

---

## 任务 2：实现本地 Transformers.js 提供程序

**文件：**
- 修改：`src/ai-detector/providers.js`

**步骤 1：实现 LocalProvider**

```javascript
import { pipeline } from '@xenova/transformers';

export class LocalProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.detector = null;
    this.model = config.local_model || 'SoelMgd/bert-pii-detection';
  }

  async isAvailable() {
    try {
      // 尝试加载模型
      await this.getDetector();
      return true;
    } catch (error) {
      return false;
    }
  }

  async getDetector() {
    if (!this.detector) {
      this.detector = await pipeline(
        'token-classification',
        this.model
      );
    }
    return this.detector;
  }

  async detect(text) {
    const detector = await this.getDetector();
    const results = await detector(text);
    
    // 转换为标准格式
    return results.map(r => ({
      value: r.word,
      start: r.start,
      end: r.end,
      type: r.entity_group,
      confidence: r.score,
      source: 'ai'
    }));
  }
}
```

**步骤 2：添加自动安装支持**

```javascript
async function autoInstallDeps() {
  try {
    const { execSync } = await import('child_process');
    execSync('npm install @xenova/transformers', { stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

// 在 LocalProvider.isAvailable 中：
async isAvailable() {
  try {
    await this.getDetector();
    return true;
  } catch (error) {
    if (this.config.auto_install_deps) {
      console.log('[opencode-guard] 正在安装 AI 依赖...');
      const installed = await autoInstallDeps();
      if (installed) {
        return this.isAvailable(); // 重试
      }
    }
    return false;
  }
}
```

---

## 任务 3：实现 OpenAI 提供程序

**文件：**
- 修改：`src/ai-detector/providers.js`

**实现：**

```javascript
export class OpenAIProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.apiKey = config.openai_api_key;
    this.model = config.openai_model || 'gpt-4';
  }

  async isAvailable() {
    return !!this.apiKey;
  }

  async detect(text) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{
          role: 'system',
          content: '识别文本中的敏感数据。返回 JSON 数组，包含：value、type、start、end。'
        }, {
          role: 'user',
          content: text
        }]
      })
    });

    const data = await response.json();
    const content = data.choices[0].message.content;
    return JSON.parse(content);
  }
}
```

---

## 任务 4：实现自定义提供程序

**文件：**
- 修改：`src/ai-detector/providers.js`

**实现：**

```javascript
export class CustomProvider extends AIProvider {
  constructor(config) {
    super(config);
    this.endpoint = config.custom_api_endpoint;
    this.apiKey = config.custom_api_key;
  }

  async isAvailable() {
    return !!this.endpoint;
  }

  async detect(text) {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ text })
    });

    return await response.json();
  }
}
```

---

## 任务 5：集成到检测管道

**文件：**
- 修改：`src/detector.js`
- 修改：`src/index.js`（插件初始化）

**步骤 1：更新检测器以使用 AI**

```javascript
// src/detector.js
import { AIDetector } from './ai-detector/index.js';

export async function detect(text, patterns, config) {
  // 首先运行正则检测
  const regexMatches = detectWithRegex(text, patterns);
  
  // 如果启用，运行 AI 检测
  if (config?.ai_detection) {
    const aiDetector = new AIDetector(config);
    return await aiDetector.detect(text, regexMatches);
  }
  
  return regexMatches;
}
```

**步骤 2：更新插件初始化**

确保 AI 检测器与配置一起初始化。

---

## 任务 6：添加测试

**文件：**
- 创建：`tests/ai-detector/providers.test.js`
- 创建：`tests/ai-detector/merge.test.js`
- 创建：`tests/ai-detector/index.test.js`

**示例测试：**

```javascript
import { test } from 'node:test';
import assert from 'node:assert';
import { mergeDetections } from '../../src/ai-detector/merge.js';

test('mergeDetections 优先选择更长的重叠匹配', () => {
  const regex = [{ start: 0, end: 5, value: 'hello', type: 'generic' }];
  const ai = [{ start: 0, end: 10, value: 'hello world', type: 'text' }];
  
  const merged = mergeDetections(regex, ai);
  
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].value, 'hello world');
});
```

---

## 配置示例

**本地（默认）：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "local",
    "local_model": "SoelMgd/bert-pii-detection",
    "auto_install_deps": true,
    "ai_timeout_ms": 500
  }
}
```

**OpenAI：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "openai",
    "openai_api_key": "sk-...",
    "openai_model": "gpt-4",
    "ai_timeout_ms": 2000
  }
}
```

**自定义：**
```json
{
  "detection": {
    "ai_detection": true,
    "ai_provider": "custom",
    "custom_api_endpoint": "http://localhost:1234/v1",
    "custom_api_key": "optional",
    "ai_timeout_ms": 5000
  }
}
```

---

## 性能考虑

- **本地**：首次运行下载模型（~100MB），然后离线工作
- **超时**：可配置，默认 500ms，超时后回退到仅正则
- **内存**：运行时加载的模型使用 ~200-600MB RAM

---

## 推荐模型

| 模型 | 大小 | 最适合 |
|-------|------|--------------|
| `SoelMgd/bert-pii-detection` | ~66MB | **默认** - 平衡 |
| `gravitee-io/bert-small-pii-detection` | ~30MB | 资源受限 |
| `iiiorg/piiranha-v1-detect-personal-information` | ~400MB | 高精度 |
| `gneeraj/deeppass2-bert` | ~560MB | 密码检测 |