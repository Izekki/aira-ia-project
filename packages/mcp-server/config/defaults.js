/**
 * Default configuration for the MCP server.
 *
 * User-overrides can be placed in ~/.aira/mcp-config.json (not committed).
 * All filesystem and shell operations are fenced to WORKSPACE_ROOT.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

const DEFAULT_WORKSPACE_ROOT =
  process.platform === 'win32' ? 'C:\\AiraWorkspace' : path.join(os.homedir(), 'AiraWorkspace');

function getConfigDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Aira');
  }
  return path.join(os.homedir(), '.aira');
}

const USER_CONFIG_FILE = path.join(getConfigDir(), 'mcp-config.json');

function loadUserConfig() {
  try {
    if (fs.existsSync(USER_CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(USER_CONFIG_FILE, 'utf8'));
    }
  } catch {
    // Ignore – use defaults.
  }
  return {};
}

/**
 * Merged configuration (defaults + user overrides).
 * @returns {{
 *   workspaceRoot: string,
 *   port: number,
 *   commandAllowlist: string[],
 *   appAllowlist: Record<string, { path: string }>,
 *   weatherBaseUrl: string,
 * }}
 */
function getConfig() {
  const userCfg = loadUserConfig();

  return {
    workspaceRoot: process.env.MCP_WORKSPACE_ROOT || userCfg.workspaceRoot || DEFAULT_WORKSPACE_ROOT,
    port: Number(process.env.MCP_PORT || userCfg.port || 4001),
    commandAllowlist: userCfg.commandAllowlist || [
      'git',
      'node',
      'npm',
      'npx',
      'pnpm',
      'yarn',
      'python',
      'python3',
      'pip',
      'cargo',
      'rustc',
      'rustup',
      'tsc',
      'code',
      'dir',
      'ls',
      'echo',
      'type',
      'cat',
      'mkdir',
      'rmdir',
      'copy',
      'move',
      'cls',
      'clear',
    ],
    // Apps must have explicit executable paths; this is the fallback empty map.
    appAllowlist: userCfg.appAllowlist || {},
    weatherBaseUrl: 'https://api.open-meteo.com/v1',
  };
}

module.exports = { getConfig, getConfigDir, USER_CONFIG_FILE };
