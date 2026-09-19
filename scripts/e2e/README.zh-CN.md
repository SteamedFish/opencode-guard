# E2E 测试辅助工具

用于 opencode-guard 端到端测试的伪造 provider/服务器。配合
`guard-e2e-testing` skill（`.opencode/skills/guard-e2e-testing/`）使用，
可证明哪些数据以掩码形式离开（或从未以原始形式离开）本机。

[English Documentation](README.md)

## capture-server.py —— 伪造 provider（OpenAI 兼容 + Anthropic Messages）

把每个请求体记录到日志文件，并以 SSE 流响应：`/v1/chat/completions` 上返回
OpenAI `chat.completion` chunk；当模式以 `anthropic` 开头时，在 `/v1/messages`
上返回 Anthropic Messages API 事件（`message_start` / `content_block_*` /
`message_delta` / `message_stop`）。仅依赖标准库，单文件。

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
| `anthropic` | Anthropic Messages API 文本流（`message_start`、一个 text block、`message_delta`、`message_stop`），在单个 `content_block_delta`（`text_delta`）中回显 `echo: <请求中最后一个 email>`。由路径含 `messages` 的请求触发（provider 需用 `aisdk:@ai-sdk/anthropic`，且 `baseURL` 以 `/v1` 结尾）。 |
| `anthropic-split` | 与 `anthropic` 类似，但 email 被拆到两个 `text_delta` 事件中（拆分点位于 email 正中），第 2 个事件带与 `echo-split` 相同的 `abcdef` 后缀。用于验证 Anthropic 形状下的跨事件还原 + hold-back。 |
| `anthropic-last` | 与 `anthropic` 类似，但先发一个填充 delta `working... `，回显 email 只出现在 `content_block_stop` 之前的最后一个 delta 中 —— 用于验证流结束时的 flush/还原行为（Anthropic 形状没有 `[DONE]`）。 |
| `anthropic-tool-split` | Anthropic `tool_use` block，其 `input` 以两个 `input_json_delta`（`partial_json`）片段流式发送，拆分点位于 arguments 内 email 值的正中；`stop_reason` 为 `tool_use`。第二轮（消息中含 `tool_result` block）返回普通的 `anthropic` 回显。工具选择/参数与 `tool` 模式一致，因此 `write`/`shell` 会把探针值写入 `tool-probe-output.txt`（用 `--mode=tool-file` 校验）。 |

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

在所有模式下，每个请求体都会按原样追加到捕获日志。`--no-done` 与
`--reasoning` 仅适用于 OpenAI 形状的模式（Anthropic 形状没有 `[DONE]` 帧，也没有
`reasoning_content` delta；如需验证流结束 flush，请用 `anthropic-last`）。
`--crlf`、`--keepalive`、`--prefer-tool`、`--tool-stdout` 对两种形状都适用。

### 冒烟测试

```bash
python3 scripts/e2e/capture-server.py 16400 /tmp/capture.log --mode=echo &
PID=$!
curl -s http://127.0.0.1:16400/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"my email is smoke@test.dev"}]}'
kill $PID
```

### Anthropic Messages API provider

把 `@ai-sdk/anthropic` provider 指向捕获服务器：SDK 会 POST 到
`${baseURL}/messages`，因此 `baseURL` 必须以 `/v1` 结尾；任何路径含 `messages`
的请求都会得到响应（并选用 `anthropic*` 模式）。

```jsonc
{
  "providers": {
    "capture": {
      "package": "aisdk:@ai-sdk/anthropic",
      "settings": { "baseURL": "http://127.0.0.1:16500/v1", "apiKey": "sk-ant-dummy" },
      "models": { "probe": { "capabilities": { "tools": true, "input": ["text"], "output": ["text"] } } }
    }
  },
  "model": "capture/probe",
  "agents": { "title": { "model": "capture/probe" } }
}
```

```bash
python3 scripts/e2e/capture-server.py 16500 cap.log --mode=anthropic-split &
opencode run --standalone -m capture/probe "My email is x42@example.com. Reply with exactly: OK" > out.txt
python3 scripts/e2e/verify-probe.py cap.log out.txt --mode=restore
```

已于 2026-09-19 针对 opencode v2.0.6 验证通过（`anthropic`、`anthropic-split`、
`anthropic-last`、`anthropic-tool-split --mode=tool-file` 全部 PASS）。

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
      "enabled": true,
      // 可选：把每个收到的 tools/call 的参数记录到文件。
      // 是 MCP 排除 probe 的决定性证据 —— 线上流量无法显示
      // 服务器收到的是掩码参数还是原始参数。
      "environment": {"FAKE_MCP_LOG": "/abs/path/received.log"}
    }
  }
}
```

设置 `FAKE_MCP_LOG` 后，每个 `tools/call` 会向该文件追加一行：
`<method> <tool-name> <紧凑 JSON 参数>`。日志失败会被吞掉 —— 日志绝不
影响服务器运行。未设置则不记录。

### 冒烟测试

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"lookup_secret","arguments":{"key":"acct-7"}}}' \
  | python3 scripts/e2e/fake-mcp-server.py
```

## verify-probe.py —— 自包含断言驱动器

用于 probe 运行的断言驱动器。执行 E2E probe 的 agent 在自己的会话中
加载了被测插件，因此任何经过该 agent shell 命令的 probe 值都可能被
不可预测地掩码/还原 —— 内联 `grep -c '<probe>' capture.log` 的结果
不可靠。verify-probe.py 因此不接受任何 probe 值作为参数：它从运行
转录（out.txt）推导 probe email，并从 `fake-mcp-server.py` 读取 MCP
fixture 秘密，所有断言都在进程内计算。输出只有 PASS/FAIL 行和计数 ——
绝不打印提取出的秘密值。

```bash
python3 scripts/e2e/verify-probe.py <capture.log> <out.txt> [--mode=restore|unmasked|tool-file] [--mcp] [--probe-file <path>] [--allow-wire-variants]
# 默认值：模式 restore，probe 文件 ./tool-probe-output.txt（仅 tool-file 模式使用）
```

| 标志 | 效果 |
|------|----------|
| `--allow-wire-variants` | 放宽 A5：out.txt 中字节级出现在 capture.log 里的残留 email 形 token 也被允许。理由：MCP 工具的调用参数与工具结果以掩码形式存于转录中（`execute.before`/`execute.after`），因此磁盘上的转录合法地包含曾上线的掩码变体。半还原的片段无法字节级匹配完整的线上变体，因此该放宽对部分还原损坏依然严格。 |

| 断言 | 模式 | 含义 |
|-----------|-------|---------|
| A1 derive-probe | 全部 | 能从 out.txt 唯一推导出 probe email（只有一个不同的 email 形 token，或有唯一无歧义的 `echo:` 行）。域名无点的 token（如 `x@explorer` 之类的 agent 提及残留物）会被忽略。使用 `--mcp` 时，fixture 的 FIXED_EMAIL 会被排除在候选之外（最后的 `echo:` 行回显的是 fixture 的 email —— 它是最终请求体中的最后一个 email）；真正的 probe 以还原形式出现在工具调用行上，因此此时含 `{"` 的行（工具调用参数）也用于消歧。 |
| A2 no-leak | restore、tool-file | probe email 在 capture.log 中的字节计数 == 0。 |
| A2 original-on-wire | unmasked | probe email 在 capture.log 中的字节计数 >= 1（已配置排除）。 |
| A3 masked-traffic | restore、tool-file | capture.log 含有 >= 1 个非 probe 的 email 形 token —— 证明掩码路径确实生效，而非被绕过。 |
| A4 restore | 全部 | probe email 出现在 out.txt 中（字节计数 >= 1）。 |
| A5 no-residual | restore、tool-file | out.txt 中每个 email 形 token 都等于 probe email（使用 `--mcp` 时还允许已还原的 FIXED_EMAIL；使用 `--allow-wire-variants` 时还允许任何字节级出现在 capture.log 中的 token）—— 无残留掩码片段。 |
| MCP1/MCP2 | `--mcp` | 从 `fake-mcp-server.py` 提取的 `FIXED_EMAIL`/`FIXED_TOKEN`：不出现在 capture.log 中（restore/tool-file）或必须出现（unmasked）。 |
| MCP3 | `--mcp`，restore/tool-file | `FIXED_EMAIL` 已在 out.txt 中还原（字节计数 >= 1）。 |
| T1 tool-file | tool-file | probe 文件恰好包含一次 probe email。 |

最后一行为 `RESULT: PASS` / `RESULT: FAIL`，退出码相应为 0/1。

## 验证掩码 —— 一律用 grep，绝不靠肉眼

所有验证必须通过 `grep -c` 在捕获日志中计数完成，绝不能靠眼睛看输出。
掩码后的值是格式保持的，乍一看与原始值完全相同。对于由 agent 驱动的
probe 运行，请使用 `verify-probe.py`（见上文）代替内联 grep —— agent
自身会话中的插件会使其 shell 命令里的 probe 值变得不可靠。

```bash
# 应为 0：原始密钥绝不能到达 provider/MCP 服务器。
grep -c 'smoke@test.dev' /tmp/capture.log

# 应 >= 1：掩码后的占位符确实离开了本机。
grep -c '@' /tmp/capture.log
```
