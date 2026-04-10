/**
 * Aira MCP Server
 *
 * Exposes local agent tools (filesystem, git, commands, app launcher,
 * browser, utilities) via a JSON-RPC 2.0 HTTP API on port 4001 (configurable).
 *
 * The Aira server (port 4000) acts as the MCP *client* and routes `/tool`
 * chat commands here after obtaining user permission via Socket.IO.
 *
 * Endpoints:
 *   POST /rpc          – JSON-RPC 2.0 tool execution
 *   GET  /tools        – list available tools with descriptions
 *   GET  /health       – liveness check
 *
 * To start:
 *   node packages/mcp-server/index.js
 *   # or from repo root:
 *   npm run mcp:server
 */

'use strict';

const http = require('http');
const { getConfig } = require('./config/defaults');
const { fsList, fsRead, fsWrite, fsMkdir, fsDelete } = require('./tools/filesystem');
const { gitStatus, gitDiff, gitLog, gitBranch, gitCommit } = require('./tools/git-tools');
const { cmdRun } = require('./tools/command-runner');
const { appLaunch, appList } = require('./tools/app-launcher');
const { browserOpen, browserSearch } = require('./tools/browser');
const { utilTime, utilWeather } = require('./tools/utilities');

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS = {
  'fs.list': {
    description: 'List directory contents. Fenced to workspace root.',
    params: { path: 'string (optional, default ".")' },
    handler: fsList,
  },
  'fs.read': {
    description: 'Read a text file. Fenced to workspace root.',
    params: { path: 'string' },
    handler: fsRead,
  },
  'fs.write': {
    description: 'Write (create/overwrite) a file. Fenced to workspace root.',
    params: { path: 'string', content: 'string', encoding: 'string (optional)' },
    handler: fsWrite,
  },
  'fs.mkdir': {
    description: 'Create a directory (recursive). Fenced to workspace root.',
    params: { path: 'string' },
    handler: fsMkdir,
  },
  'fs.delete': {
    description: '[HIGH] Delete a file or directory recursively. Fenced to workspace root.',
    params: { path: 'string' },
    handler: fsDelete,
  },
  'git.status': {
    description: 'Run git status in a workspace repo.',
    params: { repoPath: 'string (optional, default ".")' },
    handler: gitStatus,
  },
  'git.diff': {
    description: 'Run git diff in a workspace repo.',
    params: { repoPath: 'string', staged: 'boolean', file: 'string (optional)' },
    handler: gitDiff,
  },
  'git.log': {
    description: 'Show recent git log in a workspace repo.',
    params: { repoPath: 'string', limit: 'number (max 50)' },
    handler: gitLog,
  },
  'git.branch': {
    description: 'List or create git branches in a workspace repo.',
    params: { repoPath: 'string', action: '"list"|"create"', name: 'string (required for create)' },
    handler: gitBranch,
  },
  'git.commit': {
    description: 'Commit staged (or all) changes in a workspace repo.',
    params: { repoPath: 'string', message: 'string', addAll: 'boolean' },
    handler: gitCommit,
  },
  'cmd.run': {
    description: 'Run an allowlisted command. cwd fenced to workspace root.',
    params: { command: 'string', args: 'string[]', cwd: 'string (optional)', timeoutMs: 'number (optional)' },
    handler: cmdRun,
  },
  'app.launch': {
    description: 'Launch an app from the allowlist (must have an explicit executable path configured).',
    params: { appId: 'string' },
    handler: appLaunch,
  },
  'app.list': {
    description: 'List configured apps in the allowlist.',
    params: {},
    handler: appList,
  },
  'browser.open': {
    description: 'Open a URL in the default browser (http/https only).',
    params: { url: 'string' },
    handler: browserOpen,
  },
  'browser.search': {
    description: 'Search the web (or YouTube/Spotify) via the default browser.',
    params: { query: 'string', engine: '"google"|"youtube"|"duckduckgo"|"bing"|"spotify" (optional)' },
    handler: browserSearch,
  },
  'util.time': {
    description: 'Get current local date/time and timezone.',
    params: {},
    handler: utilTime,
  },
  'util.weather': {
    description: 'Get current weather from Open-Meteo (free, no API key). Pass location name or lat/lon.',
    params: { location: 'string (optional)', lat: 'number (optional)', lon: 'number (optional)' },
    handler: utilWeather,
  },
};

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function sendJson(res, statusCode, body) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'Access-Control-Allow-Origin': 'http://127.0.0.1:4000',
    'Vary': 'Origin',
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 handler
// ---------------------------------------------------------------------------

async function handleRpc(body) {
  const id = body?.id ?? null;

  if (!body || body.jsonrpc !== '2.0') {
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC request.' } };
  }

  const method = body.method;
  const params = body.params ?? {};

  if (!method) {
    return { jsonrpc: '2.0', id, error: { code: -32600, message: 'Missing method.' } };
  }

  const tool = TOOLS[method];
  if (!tool) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Tool "${method}" not found. Call GET /tools to list available tools.` },
    };
  }

  try {
    const result = await tool.handler(params);
    return { jsonrpc: '2.0', id, result };
  } catch (err) {
    return { jsonrpc: '2.0', id, error: { code: -32000, message: err.message } };
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function createServer() {
  const config = getConfig();

  const server = http.createServer(async (req, res) => {
    // CORS pre-flight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': 'http://127.0.0.1:4000',
        'Access-Control-Allow-Methods': 'GET,POST',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Vary': 'Origin',
      });
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${config.port}`);

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { status: 'ok', version: '1.0.0', workspaceRoot: config.workspaceRoot });
      return;
    }

    // GET /tools
    if (req.method === 'GET' && url.pathname === '/tools') {
      const tools = Object.entries(TOOLS).map(([name, t]) => ({
        name,
        description: t.description,
        params: t.params,
      }));
      sendJson(res, 200, { tools });
      return;
    }

    // POST /rpc
    if (req.method === 'POST' && url.pathname === '/rpc') {
      const body = await readBody(req);
      const response = await handleRpc(body);
      const status = response.error ? (response.error.code === -32601 ? 404 : 400) : 200;
      sendJson(res, status, response);
      return;
    }

    sendJson(res, 404, { error: 'Not found. Use POST /rpc or GET /tools.' });
  });

  return new Promise((resolve) => {
    server.listen(config.port, '127.0.0.1', () => {
      console.log(`[mcp-server] Aira MCP Server listening on http://127.0.0.1:${config.port}`);
      console.log(`[mcp-server] Workspace root: ${config.workspaceRoot}`);
      console.log(`[mcp-server] Tools available: ${Object.keys(TOOLS).join(', ')}`);
      resolve(server);
    });
  });
}

createServer().catch((err) => {
  console.error('[mcp-server] Failed to start:', err);
  process.exit(1);
});
