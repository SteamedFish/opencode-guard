# E2E 测试辅助工具

用于 opencode-guard 端到端测试的伪造 provider/服务器。配合
`guard-e2e-testing` skill（`.opencode/skills/guard-e2e-testing/`）使用，
可证明哪些数据以掩码形式离开（或从未以原始形式离开）本机。

[English Documentation](README.md)

## capture-server.py —— 伪造的 OpenAI 兼容 provider

把每个请求体记录到日志文件，并以 SSE `chat.completion` 流响应。仅依赖
标准库，单文件。

```bash
python3 scripts/e2e/capture-server.py [port] [capture-log-path] [--mode=MODE] [flags...]
# 默认值：端口 15151，日志 ./capture.log，模式 echo
```

### 模式

| 模式 | 行为 |
|------|----------|
| `echo`（默认） | 单个 content chunk：`echo: <请求中最后一个 email>`，然后是 `finish_reason: stop`，最后是 `[DONE]`。 |
| `echo-split` | 被回显的 email 拆到两个 content chunk（大致对半）；第 2 个 chunk 末尾附加 `abcdef` 后缀（6 个十六进制字符，不属于 email），用于测试 unmasker 的 hold-back 逻辑不会误吞尾随文本。短于 4 个字符的 email 不拆分。 |
| `echo-last` | 第一个 chunk 是填充文本 `working... `；回显的 email 只出现在第二个（最后一个 content）chunk 中，紧挨着 `finish_reason` chunk —— 用于测试流结束时的 flush 行为。 |
| `tool` | 请求中没有 `"role":"tool"` 消息时：以 OpenAI 流式 `tool_call` 响应，选择第一个名为 `write` 的工具（否则 `bash`，否则数组第一个），参数中嵌入请求体里最后一个 email（`write`/`bash` 会把它写入沙箱 cwd 下的 `tool-probe-output.txt`）。请求中含 `"role":"tool"` 消息时（工具执行后的第二轮）：普通的单 chunk 回显，并在捕获日志中写入 `=== TOOL-ROUND ===` 标记行。 |
| `tool-split` | 与 `tool` 类似，但 tool-call 的 `function.arguments` JSON 字符串被拆到两个 SSE delta chunk 中，拆分点位于 arguments 内 email 值的正中（第 1 个片段在 email 中间结束，第 2 个片段从剩余部分开始）。请求中没有 email 时按 arguments 长度对半拆。第二轮行为与 `tool` 模式完全一致（普通回显 + `=== TOOL-ROUND ===` 标记）。 |
| `echo-message` | 解析请求 JSON，把最后一条 `user` 消息的文本原样流式返回，拆成 3 个大致均等的 content chunk（不带 `echo: ` 前缀）。同时支持字符串 content 和数组 parts content（text 部分以空格连接）；没有 user 消息或没有文本时回复 `no-user-text`。用于验证 response-restore 钩子能还原非 email 类型的掩码值（例如 AI 检测出的街道地址）。 |

### 标志位

相互独立的标志位，可与任意模式组合，彼此也可组合（例如
`--mode=echo-split --crlf --keepalive --no-done`、
`--mode=tool-split --reasoning`）：

| 标志 | 行为 |
|------|----------|
| `--crlf` | 所有 SSE 行尾使用 `\r\n`（帧以 `\r\n\r\n` 结束），代替 `\n`。 |
| `--keepalive` | 在第一个 data 事件之前发送一行 SSE 注释 `: ka`，并在第一个与第二个 data 事件之间再发送一行。 |
| `--no-done` | 省略最后的 `data: [DONE]` 帧 —— 流在 finish chunk 之后直接结束。 |
| `--reasoning` | 在正常 chunk 之前插入一个额外的首个 data chunk，其 delta 为 `{"role":"assistant","reasoning_content":"<email>"}`（使用该模式本会回显的同一个 email）。 |
| `--prefer-tool=NAME` | 在 `tool`/`tool-split` 模式下，从请求的 tools 数组中选择名为 NAME 的工具，代替默认的 `write`→`bash`→第一个 优先级。必须项：不同 agent/发行版的工具集不同（例如 shell 工具可能叫 `shell`，MCP 工具可能根本不存在）。 |
| `--tool-stdout` | 对 shell 类工具（`bash`/`shell`）：把秘密打印到 stdout 而不是重定向进 `tool-probe-output.txt`，使工具【结果】携带秘密（测试下一轮请求 body 中 `tool.execute.after` 的结果 masking）。 |

在所有模式下，每个请求体都会按原样追加到捕获日志。

### 冒烟测试

```bash
python3 scripts/e2e/capture-server.py 16400 /tmp/capture.log --mode=echo &
PID=$!
curl -s http://127.0.0.1:16400/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"my email is smoke@test.dev"}]}'
kill $PID
```

## fake-mcp-server.py —— stdio 上的伪造 MCP 服务器

一个最简 [Model Context Protocol](https://modelcontextprotocol.io) 服务器，
在 stdio 上使用换行分隔的 JSON-RPC 2.0，仅依赖标准库。暴露一个工具
`lookup_secret`，其结果文本内嵌固定的探测密钥
（`mcp-probe@mailfence-test.net`、`mcpTok9f4ab71c3d`），opencode-guard
应当对它们进行掩码。收到的 method 名会记录到 stderr。

在 `opencode.jsonc` 中接入：

```jsonc
{
  "mcp": {
    "fake": {
      "type": "local",
      "command": ["python3", "/abs/path/scripts/e2e/fake-mcp-server.py"],
      "enabled": true
    }
  }
}
```

### 冒烟测试

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lookup_secret","arguments":{"key":"acct-7"}}}' \
  | python3 scripts/e2e/fake-mcp-server.py
```

## 验证掩码 —— 一律用 grep，绝不靠肉眼

所有验证必须通过 `grep -c` 在捕获日志中计数完成，绝不能靠眼睛看输出。
掩码后的值是格式保持的，乍一看与原始值完全相同。

```bash
# 应为 0：原始密钥绝不能到达 provider/MCP 服务器。
grep -c 'smoke@test.dev' /tmp/capture.log

# 应 >= 1：掩码后的占位符确实离开了本机。
grep -c '@' /tmp/capture.log
```
