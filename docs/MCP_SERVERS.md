# MCP Server Configuration Guide

This guide explains how to configure OpenCode Guard for different types of MCP (Model Context Protocol) servers.

## What are MCP Servers?

MCP servers extend OpenCode with tools and capabilities:
- **Local servers**: Filesystem, git, shell commands (run on your machine)
- **External servers**: APIs, web services, third-party integrations (send data outside)

### Built-in Tools are Automatically Local

**OpenCode's built-in tools** (like `bash`, `read`, `write`, `edit`, `grep`, `task`, etc.) are **automatically treated as local** and do NOT need to be added to any exclusion list. These tools always receive real (unmasked) data through the `tool.execute.before` hook.

You only need to configure exclusions for:
- **MCP servers** via `exclude_mcp_servers` (e.g., `"filesystem"`, `"git"`)
- **Specific MCP tools** via `exclude_mcp_tools` (e.g., `"submit_plan"`, `"schedule_job"`)

## The Security Challenge

Different servers need different treatment:

| Server Type | Example | Args Should Be | Results Should Be |
|-------------|---------|----------------|-------------------|
| **Local** | filesystem, git, shell | **Restored** (real data) | **Masked** (hide from LLM) |
| **External** | email API, web services | **Masked** (hide secrets) | **Masked** (hide from LLM) |

## Configuration

### `exclude_mcp_servers` - Mark Servers as "Local"

Add local/trusted servers to this list so they receive **real (unmasked) data**:

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

**Default behavior**: Servers NOT in this list are treated as **external** and receive **masked data**.

### `exclude_mcp_tools` - Mark Specific Tools as "Local"

Add specific tool names to this list to treat them as local regardless of which server they come from:

```json
{
  "exclude_mcp_tools": [
    "submit_plan",
    "schedule_job",
    "list_jobs"
  ]
}
```

**Default exclusions**: The following tools are automatically excluded by default:
- `submit_plan`, `schedule_job`, `list_jobs`, `get_version`
- `get_skill`, `install_skill`
- `get_job`, `update_job`, `delete_job`, `run_job`, `job_logs`
- `cleanup_global`

These are OpenCode's built-in tools that need real data to function properly.

### Common MCP Servers

#### Always Exclude (Local)
These need real data to function:

```json
{
  "exclude_mcp_servers": [
    "filesystem",      // File operations
    "git",            // Git commands
    "github",         // GitHub CLI operations
    "shell",          // Shell command execution
    "terminal",       // Terminal access
    "command-runner"  // Command execution
  ]
}
```

#### Never Exclude (External)
These should receive masked data to protect secrets:

```json
{
  // These are EXTERNAL - do NOT add to exclude_mcp_servers
  "external_servers": [
    "email-service",     // Email sending APIs
    "slack",            // Slack integration
    "webhook",          // Webhook calls
    "api-client",       // Generic API client
    "analytics",        // Analytics services
    "logging-service"   // External logging
  ]
}
```

## How It Works

### Flow for Local/Excluded Servers

```
1. User: "Commit with message: Contact clio-agent@sisyphuslabs.ai"
   → LLM sees: "Contact ce_.rbgrrq@sisyphuslabs.ai" (masked)

2. LLM generates git tool call:
   → args: { message: "Contact ce_.rbgrrq@sisyphuslabs.ai" }

3. mcp.tool.call.before (git is excluded):
   → RESTORE args: { message: "Contact clio-agent@sisyphuslabs.ai" }

4. Git executes with real email

5. mcp.tool.call.after:
   → MASK result before returning to LLM
```

### Flow for External Servers

```
1. User: "Send email to clio-agent@sisyphuslabs.ai"
   → LLM sees: "Contact ce_.rbgrrq@sisyphuslabs.ai" (masked)

2. LLM generates email tool call:
   → args: { to: "ce_.rbgrrq@sisyphuslabs.ai" }

3. mcp.tool.call.before (email-service is NOT excluded):
   → MASK args: { to: "do+evluzbn@sisyphuslabs.ai" } (double-masked)
   
   ⚠️ Email fails to deliver - but original secret is protected!

4. mcp.tool.call.after:
   → MASK result before returning to LLM
```

## Troubleshooting

### Git commits contain masked values

**Problem**: Commit message shows `ce_.rbgrrq@sisyphuslabs.ai` instead of `clio-agent@sisyphuslabs.ai`

**Solution**: Add git MCP server to `exclude_mcp_servers`:
```json
{
  "exclude_mcp_servers": ["git"]
}
```

### Files written with masked content

**Problem**: Files contain masked values instead of real data

**Solution**: Add filesystem server to exclusions:
```json
{
  "exclude_mcp_servers": ["filesystem"]
}
```

### External API calls failing

**Problem**: Email/API calls fail because data is masked

**Expected behavior**: This is intentional security protection. The API receives masked data instead of real secrets.

**Workaround**: If you must send real data to an external API (not recommended), add it to exclusions:
```json
{
  "exclude_mcp_servers": ["my-api-service"]
}
```

**Warning**: This exposes your sensitive data to the external service!

## Complete Example Configuration

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

## Finding Your MCP Server Names

To find which MCP servers are active:
1. Enable debug mode: `"debug": true` in config
2. Look for logs: `[opencode-guard] mcp.tool.call.before: ...`
3. The `serverName` parameter shows the server ID

## Security Best Practices

1. **Default to excluding**: When in doubt, exclude the server
2. **Minimize exclusions**: Only exclude servers that absolutely need real data
3. **Review regularly**: Check which servers are excluded and why
4. **Never exclude untrusted**: Never add third-party APIs to exclusions

## FAQ

**Q: Why not just restore for all servers?**
A: Restoring for external APIs would send your real secrets to third parties, defeating the purpose of the plugin.

**Q: What if I need to send real data to an API?**
A: Consider if the data is truly sensitive. If yes, use a different communication method. If no, add the server to exclusions (with caution).

**Q: How do I know if a server is local or external?**
A: Ask: "Does this server send data outside my machine?" If yes, it's external and should NOT be excluded.

**Q: Can I exclude specific tools instead of entire servers?**
A: Yes! Use the `exclude_mcp_tools` configuration option to mark specific tools as local, regardless of which server they belong to. This is useful when you want most tools from a server to be masked, but need specific tools to receive real data.

**Q: What about tools that do both local and external operations?**
A: Currently, you must choose based on primary use case. Consider using separate MCP servers for different operations.
