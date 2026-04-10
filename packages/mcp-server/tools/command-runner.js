/**
 * Command runner tool – cmd.run
 *
 * Executes shell commands from an explicit allowlist.
 * cwd is fenced to workspaceRoot.
 * Dangerous commands (rm -rf, format, del /f, etc.) are blocked regardless of allowlist.
 *
 * Risk: MEDIUM (allowlisted) or HIGH (elevated / potentially destructive)
 */

const { execFile } = require('child_process');
const path = require('path');
const { getConfig } = require('../config/defaults');
const { resolveSafe } = require('./filesystem');

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Patterns that are always blocked regardless of the allowlist.
 * Matched against the full command string (lower-cased).
 */
const BLOCKED_PATTERNS = [
  /\brm\s+-rf?\b/i,
  /\bdel\s+\/[fsFsq]/i,
  /\bformat\s+[a-z]:/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bpowershell\s+-enc\b/i,
  /\bcmd\.exe\s+\/c\b/i,
  /\bwscript\b/i,
  /\bcscript\b/i,
  /\bregsvr32\b/i,
  /\bnet\s+user\b/i,
  /\bschtasks\b/i,
];

/**
 * Return true if the command string matches a blocked pattern.
 * @param {string} commandLine
 * @returns {boolean}
 */
function isBlocked(commandLine) {
  const lower = commandLine.toLowerCase();
  return BLOCKED_PATTERNS.some((re) => re.test(lower));
}

/**
 * Validate that the executable name is in the configured allowlist.
 * @param {string} executable
 * @param {string[]} allowlist
 */
function assertAllowed(executable, allowlist) {
  const base = path.basename(executable).replace(/\.exe$/i, '').toLowerCase();
  const allowed = allowlist.map((a) => a.toLowerCase());
  if (!allowed.includes(base)) {
    throw new Error(
      `Command "${executable}" is not in the allowlist. Allowed: ${allowlist.join(', ')}.`
    );
  }
}

/**
 * Run an allowlisted command inside the workspace.
 *
 * @param {{
 *   command: string,
 *   args?: string[],
 *   cwd?: string,
 *   timeoutMs?: number,
 * }} params
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number }>}
 */
async function cmdRun({ command, args = [], cwd = '.', timeoutMs } = {}) {
  if (!command) throw new Error('cmd.run requires a command.');

  const config = getConfig();
  const timeout = Number(timeoutMs) || DEFAULT_TIMEOUT_MS;

  // Fence cwd inside workspace.
  const resolvedCwd = resolveSafe(cwd);

  // Block dangerous patterns first.
  const fullCmd = [command, ...args].join(' ');
  if (isBlocked(fullCmd)) {
    throw new Error(`Command blocked: "${fullCmd}" matches a dangerous pattern.`);
  }

  // Validate allowlist.
  assertAllowed(command, config.commandAllowlist);

  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd: resolvedCwd, timeout, encoding: 'utf8', shell: false },
      (err, stdout, stderr) => {
        if (err && err.code === undefined) {
          // Process-level error (e.g. ENOENT, timeout).
          reject(new Error(`Failed to run "${command}": ${err.message}`));
          return;
        }
        resolve({
          command,
          args,
          cwd: resolvedCwd,
          stdout: (stdout || '').trim(),
          stderr: (stderr || '').trim(),
          exitCode: err ? (err.code ?? 1) : 0,
        });
      }
    );
  });
}

module.exports = { cmdRun, isBlocked, assertAllowed };
