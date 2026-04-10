# Aira MCP Agent – Local Desktop Tools

## Overview

The **Aira MCP Agent** adds local machine capabilities to Aira via an MCP-compatible tool server.  
It runs as a separate Node.js process alongside the main Aira backend and exposes tools for:

- Filesystem operations (list, read, write, create, delete)
- Git repository management (status, diff, log, branches, commits)
- Command runner (allowlisted commands only)
- App launcher (allowlisted apps with explicit executable paths)
- Browser automation (open URLs, search engines)
- Utilities (local time, weather via Open-Meteo – free, no API key)

All filesystem and command operations are **fenced** to `C:\AiraWorkspace` by default (configurable).  
App launching is **blocked** unless the appId is in the allowlist **and** has an explicit executable path configured.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Client (Browser / Tauri desktop)                           │
│  – Chat UI                                                  │
│  – PermissionPrompt component (shows on MCP_PERMISSION_REQUEST) │
└──────────────────────┬──────────────────────────────────────┘
                       │ Socket.IO (port 4000)
┌──────────────────────▼──────────────────────────────────────┐
│  Aira Server  (packages/server, port 4000)                  │
│  – Parses /tool commands from chat                          │
│  – Checks permission risk level                             │
│  – Emits MCP_PERMISSION_REQUEST ← → MCP_PERMISSION_RESPONSE │
│  – Calls MCP server via HTTP JSON-RPC                       │
│  – Returns result as AIRA_RESPONSE                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP JSON-RPC (port 4001)
┌──────────────────────▼──────────────────────────────────────┐
│  MCP Server  (packages/mcp-server, port 4001)               │
│  – Executes tools (fs, git, cmd, app, browser, util)        │
│  – Enforces workspace fence                                 │
│  – Enforces app allowlist                                   │
│  – Enforces command allowlist                               │
└─────────────────────────────────────────────────────────────┘
```

The Aira server acts as the **MCP client**; it calls the MCP server's JSON-RPC API at `http://127.0.0.1:4001/rpc`.

---

## How to Run

### 1. Install MCP server dependencies

```bash
npm run mcp:install
# or manually:
cd packages/mcp-server && npm install
```

### 2. Start the MCP server

```bash
# From repo root:
npm run mcp:server

# Development (auto-restart on file change, Node ≥ 18):
npm run mcp:dev
```

The server starts on `http://127.0.0.1:4001`.

### 3. Start the Aira backend

```bash
npm run server
```

### 4. (Optional) Start everything together

```bash
npm run dev:full
# Starts: config watcher + Aira server + client + MCP server
```

---

## Configuration

### Workspace root

Default: `C:\AiraWorkspace` (Windows) / `~/AiraWorkspace` (Linux/macOS).

Override via environment variable:
```bash
MCP_WORKSPACE_ROOT=D:\MyProjects node packages/mcp-server/index.js
```

Or via user config file (see below).

### User config file

Location:
- Windows: `%APPDATA%\Aira\mcp-config.json`
- Linux/macOS: `~/.aira/mcp-config.json`

> ⚠️ This file is **never committed** to the repository.

Copy and customise the example:
```bash
# Windows PowerShell
Copy-Item packages\mcp-server\config\app-allowlist.example.json $env:APPDATA\Aira\mcp-config.json

# Linux/macOS
cp packages/mcp-server/config/app-allowlist.example.json ~/.aira/mcp-config.json
```

**Structure:**
```json
{
  "workspaceRoot": "C:\\AiraWorkspace",
  "port": 4001,
  "commandAllowlist": ["git", "node", "npm", "python", ...],
  "appAllowlist": {
    "vscode": {
      "path": "C:\\Users\\YOUR_USER\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe"
    },
    "brave": {
      "path": "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe"
    }
  }
}
```

See `packages/mcp-server/config/app-allowlist.example.json` for the full example.

---

## Permission System

### Risk levels

| Level  | Default behaviour                           |
|--------|---------------------------------------------|
| LOW    | Executed automatically, no prompt           |
| MEDIUM | Prompt shown – user must approve            |
| HIGH   | Prompt shown – explicit confirmation needed |

### Per-tool risk levels

| Tool           | Risk   |
|----------------|--------|
| fs.list        | LOW    |
| fs.read        | LOW    |
| fs.write       | MEDIUM |
| fs.mkdir       | MEDIUM |
| fs.delete      | **HIGH** |
| git.status     | LOW    |
| git.diff       | LOW    |
| git.log        | LOW    |
| git.branch     | LOW / MEDIUM (create) |
| git.commit     | MEDIUM |
| cmd.run        | MEDIUM |
| app.launch     | MEDIUM |
| browser.open   | MEDIUM |
| browser.search | MEDIUM |
| util.time      | LOW    |
| util.weather   | LOW    |

### Permission prompt UI

When a MEDIUM or HIGH tool is called without an existing "Allow always" rule, the client displays a **PermissionPrompt** dialog with three options:

1. **Allow once** – executes this call only; next call prompts again.
2. **Allow always** – executes and persists a rule scoped to `toolName + scope` (path / command / appId / domain).
3. **Deny** – cancels the tool call.

For HIGH-risk actions, a warning is displayed inside the dialog.

### "Allow always" persistence

Rules are stored in:
- Windows: `%APPDATA%\Aira\mcp-permissions.json`
- Linux/macOS: `~/.aira/mcp-permissions.json`

> ⚠️ This file is **never committed**. Each rule is scoped by `toolName::scope` (e.g. `fs.write::C:\AiraWorkspace\notes.txt`). You can delete this file to reset all persistent grants.

---

## Using MCP Tools via Chat

Type `/tool` commands directly in the Aira chat:

```
/tool util.time
/tool util.weather location=Madrid

/tool fs.list path=.
/tool fs.read path=README.md
/tool fs.write path=notes.txt content="hello world"
/tool fs.mkdir path=projects/myapp
/tool fs.delete path=temp/old-file.txt

/tool git.status repoPath=.
/tool git.diff repoPath=.
/tool git.log repoPath=. limit=5
/tool git.branch repoPath=. action=list
/tool git.branch repoPath=. action=create name=feature/my-branch
/tool git.commit repoPath=. message="feat: initial commit" addAll=true

/tool cmd.run command=node args=["--version"]
/tool cmd.run command=npm args=["run","build"] cwd=packages/client

/tool app.list
/tool app.launch appId=vscode
/tool app.launch appId=brave

/tool browser.open url=https://github.com
/tool browser.search query="lofi music"
/tool browser.search query="youtube videos" engine=youtube
```

---

## Safety Model

### Workspace fence

- **All** filesystem operations (`fs.*`) resolve paths relative to `workspaceRoot` and reject any path that escapes it (including `../` traversal, absolute paths outside the root, etc.).
- **All** command executions (`cmd.run`) set `cwd` inside the workspace fence.
- Attempting to access paths outside `workspaceRoot` results in an `Access denied` error.

### App launcher

- `app.launch` checks **two independent conditions**:
  1. The `appId` must be present in the `appAllowlist`.
  2. The entry must have an explicit `path` field pointing to the executable.
- If either condition fails, execution is blocked with a descriptive error.
- The executable file must exist at the configured path.

### Command runner

- Only commands whose executable base name appears in `commandAllowlist` are allowed.
- Known dangerous patterns (e.g. `rm -rf`, `del /f`, `format`, `shutdown`, etc.) are blocked even if the command is in the allowlist.
- Commands run with a configurable timeout (default 30 s).

### URL filtering

- `browser.open` and `browser.search` only accept `http://` and `https://` URLs.
- `file://`, `javascript:`, and other protocols are rejected.

---

## API Reference (MCP Server)

### `GET /health`

Returns server status and workspace root.

```json
{ "status": "ok", "version": "1.0.0", "workspaceRoot": "C:\\AiraWorkspace" }
```

### `GET /tools`

Returns a list of all available tools with their descriptions and parameter schemas.

### `POST /rpc`

JSON-RPC 2.0 endpoint.

**Request:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "fs.list",
  "params": { "path": "." }
}
```

**Success response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "path": "C:\\AiraWorkspace",
    "entries": [
      { "name": "projects", "type": "directory" },
      { "name": "notes.txt", "type": "file", "size": 42 }
    ]
  }
}
```

**Error response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": { "code": -32000, "message": "Access denied: ..." }
}
```

---

## Socket.IO Events (Aira Server ↔ Client)

| Event                     | Direction       | Description                               |
|---------------------------|-----------------|-------------------------------------------|
| `MCP_PERMISSION_REQUEST`  | Server → Client | Request user approval for a tool call     |
| `MCP_PERMISSION_RESPONSE` | Client → Server | User's decision (allow_once/allow_always/deny) |

### `MCP_PERMISSION_REQUEST` payload

```json
{
  "requestId": "uuid-v4",
  "toolName": "fs.write",
  "params": { "path": "notes.txt", "content": "hello" },
  "riskLevel": "MEDIUM",
  "message": "[MEDIUM] Write file: C:\\AiraWorkspace\\notes.txt",
  "clientMessageId": "..."
}
```

### `MCP_PERMISSION_RESPONSE` payload

```json
{
  "requestId": "uuid-v4",
  "decision": "allow_once"
}
```

`decision` values: `"allow_once"` | `"allow_always"` | `"deny"`

---

## Manual Test Checklist

Use this checklist to verify the end-to-end permission flow and tool execution.

### Prerequisites

- [ ] `npm run mcp:server` is running (check: `GET http://127.0.0.1:4001/health`)
- [ ] `npm run server` is running (port 4000)
- [ ] Client is open in browser / Tauri desktop
- [ ] `C:\AiraWorkspace` directory exists (create it if needed)
- [ ] `%APPDATA%\Aira\mcp-config.json` created with at least one app entry

---

### Test 1 – Filesystem read (LOW risk, no prompt)

```
/tool fs.list path=.
```

**Expected:** Directory listing of `C:\AiraWorkspace` appears in chat. No permission prompt.

---

### Test 2 – Filesystem write (MEDIUM risk, prompt required)

```
/tool fs.write path=mcp-test.txt content="Aira MCP test file"
```

**Expected:**
1. Permission prompt appears: "Allow once / Allow always / Deny"
2. Click **Allow once**
3. Response: `✅ Archivo escrito: C:\AiraWorkspace\mcp-test.txt (18 bytes)`

---

### Test 3 – Filesystem read the file just created

```
/tool fs.read path=mcp-test.txt
```

**Expected:** File content displayed in chat. No permission prompt (LOW risk).

---

### Test 4 – Workspace fence (blocked path)

```
/tool fs.read path=../../Windows/System32/drivers/etc/hosts
```

**Expected:** Error: `Access denied: path "../../..." is outside workspace root`.  
No permission prompt should appear (blocked before execution).

---

### Test 5 – Filesystem delete (HIGH risk, explicit prompt)

```
/tool fs.delete path=mcp-test.txt
```

**Expected:**
1. Permission prompt appears with ⚠️ HIGH risk warning
2. Click **Allow once**
3. Response: `🗑️ Eliminado: C:\AiraWorkspace\mcp-test.txt`

---

### Test 6 – App launch (MEDIUM risk)

```
/tool app.list
/tool app.launch appId=vscode
```

**Expected:**
1. `app.list` returns configured apps (no prompt)
2. `app.launch vscode` → permission prompt
3. Click **Allow once** → VS Code opens

---

### Test 7 – App launch blocked (not in allowlist)

```
/tool app.launch appId=notepad
```

**Expected:** Error: `App "notepad" is not in the allowlist.` No prompt shown.

---

### Test 8 – Browser search

```
/tool browser.search query="lofi hip hop"
```

**Expected:** Permission prompt → Allow → default browser opens with search results.

---

### Test 9 – Git status

```
/tool git.status repoPath=.
```

**Expected:** Git status output in chat (if current dir is a git repo). No prompt (LOW risk).

---

### Test 10 – Utility time (LOW risk, no prompt)

```
/tool util.time
```

**Expected:** Local date/time and timezone displayed immediately. No permission prompt.

---

### Test 11 – Allow always rule

```
/tool fs.write path=notes.txt content="persistent test"
```

1. First call → prompt → click **Allow always**
2. Second identical call → **no prompt**, executes immediately

---

### Test 12 – MCP server offline

Stop the MCP server, then:
```
/tool util.time
```

**Expected:** Error message: `MCP Server no disponible. Inícialo con: npm run mcp:server`

---

## Roadmap / Future Enhancements

- [ ] Full Playwright integration for browser automation (clicking, form filling, screenshots)
- [ ] Calendar integration (Google Calendar API, with user-provided OAuth token)
- [ ] League of Legends stats via community APIs (no key required for some endpoints)
- [ ] Fortnite stats via Fortnite-API.com (free tier)
- [ ] LLM-powered tool planning (LLM proposes tool calls instead of manual `/tool`)
- [ ] MCP stdio transport for direct LLM client compatibility
- [ ] Auto-start MCP server when Aira server boots
- [ ] Tool result streaming for long-running commands
