/**
 * Risk levels for MCP tool calls.
 * LOW    – executed automatically without prompting.
 * MEDIUM – user is prompted (Allow once / Allow always / Deny).
 * HIGH   – user is prompted; explicit response required; cannot be auto-executed.
 */

const RISK = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
};

/**
 * Default risk level for each tool.
 * The actual call risk may be elevated depending on arguments
 * (e.g. writing outside a subdirectory is treated as MEDIUM even for fs.write).
 */
const TOOL_RISK = {
  'fs.list': RISK.LOW,
  'fs.read': RISK.LOW,
  'fs.write': RISK.MEDIUM,
  'fs.mkdir': RISK.MEDIUM,
  'fs.delete': RISK.HIGH,
  'git.status': RISK.LOW,
  'git.diff': RISK.LOW,
  'git.log': RISK.LOW,
  'git.branch': RISK.LOW,
  'git.branch.create': RISK.MEDIUM,
  'git.commit': RISK.MEDIUM,
  'cmd.run': RISK.MEDIUM,
  'app.launch': RISK.MEDIUM,
  'browser.open': RISK.MEDIUM,
  'browser.search': RISK.MEDIUM,
  'util.time': RISK.LOW,
  'util.weather': RISK.LOW,
};

/**
 * Returns the base risk level for a tool.
 * @param {string} toolName
 * @returns {'LOW'|'MEDIUM'|'HIGH'}
 */
function getRiskLevel(toolName) {
  return TOOL_RISK[toolName] || RISK.MEDIUM;
}

module.exports = { RISK, TOOL_RISK, getRiskLevel };
