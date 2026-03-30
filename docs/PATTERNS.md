# Patterns and Customization Guide

Guide for understanding built-in detection patterns and creating custom ones.

## Table of Contents

- [Built-in Detection](#built-in-detection)
- [Built-in Masking Strategies](#built-in-masking-strategies)
- [Custom Patterns](#custom-patterns)
- [Custom Maskers](#custom-maskers)
- [Exclusions](#exclusions)

---

## Built-in Detection

OpenCode Guard includes patterns for detecting common sensitive data types:

### Credentials & Tokens

| Pattern | Example | Description |
|---------|---------|-------------|
| **Emails** | `user@example.com` | Standard email addresses |
| **OpenAI Keys** | `sk-abc123...` | OpenAI API keys (sk-, sk-proj-, sk-or-v1-, etc.) |
| **GitHub Tokens** | `ghp_xxxxxx` | GitHub personal access tokens (ghp_, gho_, ghu_, etc.) |
| **AWS Keys** | `AKIA...`, `ASIA...` | AWS access key IDs |
| **Generic API Keys** | `api_key=...`, `secret_key=...` | Key-value style credentials |

### Network & System

| Pattern | Example | Description |
|---------|---------|-------------|
| **IPv4** | `192.168.1.100` | IPv4 addresses (preserves network prefix) |
| **IPv6** | `fe80::1` | IPv6 addresses (preserves network prefix) |
| **MAC Addresses** | `00:1b:44:11:3a:b7` | Hardware addresses (preserves OUI prefix) |
| **UUIDs** | `550e8400-e29b-41d4-a716-446655440000` | Standard UUID format |

### Authentication

| Pattern | Example | Description |
|---------|---------|-------------|
| **HTTP Basic Auth** | `https://user:pass@host` | URLs with embedded credentials |
| **Basic Header** | `Basic base64...` | HTTP Basic auth headers |
| **Passwords** | `password=secret`, `pwd=...` | Password key-value pairs |
| **Usernames** | `username=admin`, `user=...` | Username key-value pairs |

### Database URLs

| Pattern | Example | Description |
|---------|---------|-------------|
| **PostgreSQL** | `postgres://user:pass@host/db` | PostgreSQL connection strings |
| **MySQL** | `mysql://user:pass@host/db` | MySQL connection strings |
| **MongoDB** | `mongodb://user:pass@host/db` | MongoDB connection strings |
| **MongoDB SRV** | `mongodb+srv://user:pass@host/db` | MongoDB SRV records |

### Environment Variables

| Pattern | Example | Description |
|---------|---------|-------------|
| **DATABASE_URL** | `DATABASE_URL=...` | Common database env var |
| **CONNECTION_STRING** | `CONNECTION_STRING=...` | Generic connection string |
| **API_KEY** | `API_KEY=...` | Generic API key env var |

---

## Built-in Masking Strategies

Each data type uses a specific masking strategy:

| Data Type | Strategy | Example Input | Example Output |
|-----------|----------|---------------|----------------|
| **Email** | Preserve domain | `john@example.com` | `a3f7@example.com` |
| **OpenAI Key** | Preserve prefix | `sk-abc123xyz` | `sk-x9m2p5q...` |
| **GitHub Token** | Preserve prefix | `ghp_xxxxxx` | `ghp_yyyyyy` |
| **IPv4** | Keep network prefix | `192.168.1.100` | `192.168.x.x` |
| **IPv6** | Keep network prefix | `fe80::1` | `fe80:0:0:0::xxxx` |
| **MAC Address** | Preserve OUI | `00:1b:44:11:3a:b7` | `00:1b:44:xx:xx:xx` |
| **DB URL** | Mask credentials | `postgres://user:pass@host` | `postgres://****:****@host` |
| **Password** | Mask value | `password=secret` | `password=********` |
| **Username** | Mask value | `username=admin` | `username=********` |

---

## Custom Patterns

Add your own patterns to detect organization-specific sensitive data:

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

### Pattern Properties

| Property | Required | Description |
|----------|----------|-------------|
| `pattern` | Yes | Regular expression string |
| `category` | No | Label for logging/debugging |
| `mask_as` | No | Which masker to use (defaults to generic) |

### Pattern Tips

1. **Use specific patterns**: Broad patterns may cause false positives
2. **Test your regex**: Validate patterns before deploying
3. **Use categories**: Helps with debugging and filtering
4. **Combine with exclusions**: Exclude test data to prevent over-masking

---

## Custom Maskers

Define custom masking behavior for specific pattern types:

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

### Masker Types

#### `prefixed_token`

Preserves a prefix and masks the rest:

```json
{
  "type": "prefixed_token",
  "prefix": "myapp-",
  "suffix_length": 32,
  "suffix_chars": "alphanumeric"
}
```

- `prefix`: The string to preserve at the start
- `suffix_length`: How many characters to mask
- `suffix_chars`: Character set for masked portion (`alphanumeric`, `hex`, `base64`)

#### `regex`

Applies regex-based replacement:

```json
{
  "type": "regex",
  "pattern": "user=[^&]+",
  "replacement": "user=****"
}
```

#### `fixed`

Replaces with a fixed string:

```json
{
  "type": "fixed",
  "replacement": "[REDACTED]"
}
```

---

## Exclusions

Prevent false positives by excluding specific values or patterns:

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

### When to Use Exclusions

- **Test data**: Exclude common test values like `test@example.com`
- **Internal domains**: Exclude internal-only domains
- **Placeholder values**: Exclude dummy credentials like `password=changeme`
- **Public identifiers**: Exclude non-sensitive IDs that match patterns

### Exclusion Types

- **Exact match**: The value must match exactly
- **Partial match**: Excludes any value containing the string
- **Case sensitive**: By default, exclusions are case-sensitive
