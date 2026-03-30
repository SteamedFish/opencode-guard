# 模式与自定义指南

了解内置检测模式并创建自定义模式的指南。

## 目录

- [内置检测](#内置检测)
- [内置脱敏策略](#内置脱敏策略)
- [自定义模式](#自定义模式)
- [自定义脱敏器](#自定义脱敏器)
- [排除规则](#排除规则)

---

## 内置检测

OpenCode Guard 包含检测常见敏感数据类型的模式：

### 凭据与令牌

| 模式 | 示例 | 描述 |
|-----|------|------|
| **邮箱** | `user@example.com` | 标准邮箱地址 |
| **OpenAI 密钥** | `sk-abc123...` | OpenAI API 密钥（sk-, sk-proj-, sk-or-v1- 等） |
| **GitHub 令牌** | `ghp_xxxxxx` | GitHub 个人访问令牌（ghp_, gho_, ghu_ 等） |
| **AWS 密钥** | `AKIA...`, `ASIA...` | AWS 访问密钥 ID |
| **通用 API 密钥** | `api_key=...`, `secret_key=...` | 键值样式凭据 |

### 网络与系统

| 模式 | 示例 | 描述 |
|-----|------|------|
| **IPv4** | `192.168.1.100` | IPv4 地址（保留网络前缀） |
| **IPv6** | `fe80::1` | IPv6 地址（保留网络前缀） |
| **MAC 地址** | `00:1b:44:11:3a:b7` | 硬件地址（保留 OUI 前缀） |
| **UUID** | `550e8400-e29b-41d4-a716-446655440000` | 标准 UUID 格式 |

### 认证

| 模式 | 示例 | 描述 |
|-----|------|------|
| **HTTP 基础认证** | `https://user:pass@host` | 包含嵌入式凭据的 URL |
| **Basic 头** | `Basic base64...` | HTTP Basic 认证头 |
| **密码** | `password=secret`, `pwd=...` | 密码键值对 |
| **用户名** | `username=admin`, `user=...` | 用户名键值对 |

### 数据库 URL

| 模式 | 示例 | 描述 |
|-----|------|------|
| **PostgreSQL** | `postgres://user:pass@host/db` | PostgreSQL 连接字符串 |
| **MySQL** | `mysql://user:pass@host/db` | MySQL 连接字符串 |
| **MongoDB** | `mongodb://user:pass@host/db` | MongoDB 连接字符串 |
| **MongoDB SRV** | `mongodb+srv://user:pass@host/db` | MongoDB SRV 记录 |

### 环境变量

| 模式 | 示例 | 描述 |
|-----|------|------|
| **DATABASE_URL** | `DATABASE_URL=...` | 通用数据库环境变量 |
| **CONNECTION_STRING** | `CONNECTION_STRING=...` | 通用连接字符串 |
| **API_KEY** | `API_KEY=...` | 通用 API 密钥环境变量 |

---

## 内置脱敏策略

每种数据类型使用特定的脱敏策略：

| 数据类型 | 策略 | 输入示例 | 输出示例 |
|---------|------|---------|---------|
| **邮箱** | 保留域名 | `john@example.com` | `a3f7@example.com` |
| **OpenAI 密钥** | 保留前缀 | `sk-abc123xyz` | `sk-x9m2p5q...` |
| **GitHub 令牌** | 保留前缀 | `ghp_xxxxxx` | `ghp_yyyyyy` |
| **IPv4** | 保留网络前缀 | `192.168.1.100` | `192.168.x.x` |
| **IPv6** | 保留网络前缀 | `fe80::1` | `fe80:0:0:0::xxxx` |
| **MAC 地址** | 保留 OUI | `00:1b:44:11:3a:b7` | `00:1b:44:xx:xx:xx` |
| **数据库 URL** | 脱敏凭据 | `postgres://user:pass@host` | `postgres://****:****@host` |
| **密码** | 脱敏值 | `password=secret` | `password=********` |
| **用户名** | 脱敏值 | `username=admin` | `username=********` |

---

## 自定义模式

添加你自己的模式以检测组织特定的敏感数据：

```json
{
  "patterns": {
    "regex": [
      {
        "pattern": "myapp-[a-z0-9]{32}",
        "category": "MYAPP_TOKEN",
        "mask_as": "my_token"
      },
      {
        "pattern": "internal_[a-z]+_[0-9]{8}",
        "category": "INTERNAL_ID"
      }
    ]
  }
}
```

### 模式属性

| 属性 | 必需 | 描述 |
|-----|------|------|
| `pattern` | 是 | 正则表达式字符串 |
| `category` | 否 | 用于日志/调试的标签 |
| `mask_as` | 否 | 使用哪个脱敏器（默认为 generic） |

### 模式技巧

1. **使用具体的模式**：宽泛的模式可能导致误报
2. **测试你的正则**：在部署前验证模式
3. **使用分类**：有助于调试和过滤
4. **结合排除规则**：排除测试数据以防止过度脱敏

---

## 自定义脱敏器

为特定模式类型定义自定义脱敏行为：

```json
{
  "custom_maskers": {
    "my_token": {
      "type": "prefixed_token",
      "prefix": "myapp-",
      "suffix_length": 32,
      "suffix_chars": "alphanumeric"
    },
    "internal_id": {
      "type": "regex",
      "pattern": "(?<=internal_)[a-z]+(?=_[0-9]{8})",
      "replacement": "xxxx"
    }
  }
}
```

### 脱敏器类型

#### `prefixed_token`

保留前缀并脱敏其余部分：

```json
{
  "type": "prefixed_token",
  "prefix": "myapp-",
  "suffix_length": 32,
  "suffix_chars": "alphanumeric"
}
```

- `prefix`: 要在开头保留的字符串
- `suffix_length`: 要脱敏的字符数
- `suffix_chars`: 脱敏部分的字符集（`alphanumeric`, `hex`, `base64`）

#### `regex`

应用基于正则的替换：

```json
{
  "type": "regex",
  "pattern": "user=[^&]+",
  "replacement": "user=****"
}
```

#### `fixed`

替换为固定字符串：

```json
{
  "type": "fixed",
  "replacement": "[REDACTED]"
}
```

---

## 排除规则

通过排除特定值或模式防止误报：

```json
{
  "patterns": {
    "exclude": [
      "example.com",
      "localhost",
      "127.0.0.1",
      "test@example.org",
      "api_key=TEST_KEY"
    ]
  }
}
```

### 何时使用排除规则

- **测试数据**：排除常见的测试值如 `test@example.com`
- **内部域名**：排除仅限内部使用的域名
- **占位符值**：排除虚拟凭据如 `password=changeme`
- **公共标识符**：排除匹配模式但非敏感的 ID

### 排除规则类型

- **精确匹配**：值必须完全匹配
- **部分匹配**：排除包含该字符串的任何值
- **区分大小写**：默认情况下，排除规则区分大小写
