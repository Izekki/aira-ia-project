/**
 * Permission manager for MCP tools.
 *
 * Handles:
 *   - Risk-level lookups.
 *   - "Allow always" rule persistence to ~/.aira/mcp-permissions.json.
 *   - Scope-keyed grant checks (tool + scope string, e.g. path, command, appId, domain).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { RISK, getRiskLevel } = require('./risk-levels');

// Config dir: %APPDATA%\Aira on Windows, ~/.aira elsewhere.
function getConfigDir() {
  if (process.platform === 'win32' && process.env.APPDATA) {
    return path.join(process.env.APPDATA, 'Aira');
  }
  return path.join(os.homedir(), '.aira');
}

const PERMISSIONS_FILE = path.join(getConfigDir(), 'mcp-permissions.json');

/**
 * Load persisted "allow always" rules from disk.
 * @returns {Record<string, boolean>}
 */
function loadRules() {
  try {
    if (fs.existsSync(PERMISSIONS_FILE)) {
      const raw = fs.readFileSync(PERMISSIONS_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch {
    // Corrupted file – start fresh.
  }
  return {};
}

/**
 * Persist "allow always" rules to disk.
 * @param {Record<string, boolean>} rules
 */
function saveRules(rules) {
  try {
    const dir = path.dirname(PERMISSIONS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(PERMISSIONS_FILE, JSON.stringify(rules, null, 2), 'utf8');
  } catch (err) {
    console.error('[mcp-permissions] Could not save rules:', err.message);
  }
}

/**
 * Build a canonical rule key scoped by tool name and a scope string.
 * @param {string} toolName
 * @param {string} scope  – path, command, appId, domain, or '' for tool-wide
 * @returns {string}
 */
function ruleKey(toolName, scope) {
  return scope ? `${toolName}::${scope}` : toolName;
}

/**
 * Check whether a given tool + scope combination has an "Allow always" rule.
 * @param {string} toolName
 * @param {string} [scope='']
 * @returns {boolean}
 */
function isAllowedAlways(toolName, scope = '') {
  const rules = loadRules();
  return !!rules[ruleKey(toolName, scope)] || !!rules[toolName];
}

/**
 * Persist an "Allow always" grant for a tool + scope combination.
 * @param {string} toolName
 * @param {string} [scope='']
 */
function grantAlwaysAllow(toolName, scope = '') {
  const rules = loadRules();
  rules[ruleKey(toolName, scope)] = true;
  saveRules(rules);
}

/**
 * Revoke an "Allow always" grant.
 * @param {string} toolName
 * @param {string} [scope='']
 */
function revokeAlwaysAllow(toolName, scope = '') {
  const rules = loadRules();
  delete rules[ruleKey(toolName, scope)];
  saveRules(rules);
}

/**
 * List all currently active "Allow always" rules.
 * @returns {string[]}
 */
function listAllowedAlways() {
  return Object.keys(loadRules());
}

/**
 * Decide if a tool call requires user confirmation.
 *
 * @param {string} toolName
 * @param {string} [scope='']  – scoped value (path / command / appId / domain)
 * @returns {{ needsPrompt: boolean, riskLevel: string }}
 */
function checkPermission(toolName, scope = '') {
  const riskLevel = getRiskLevel(toolName);

  if (riskLevel === RISK.LOW) {
    return { needsPrompt: false, riskLevel };
  }

  if (isAllowedAlways(toolName, scope)) {
    return { needsPrompt: false, riskLevel };
  }

  return { needsPrompt: true, riskLevel };
}

module.exports = {
  RISK,
  getRiskLevel,
  isAllowedAlways,
  grantAlwaysAllow,
  revokeAlwaysAllow,
  listAllowedAlways,
  checkPermission,
  PERMISSIONS_FILE,
};
