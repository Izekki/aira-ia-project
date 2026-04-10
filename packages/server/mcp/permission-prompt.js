/**
 * Permission Prompt – Socket.IO bridge for MCP tool authorization.
 *
 * Flow:
 *  1. Aira server receives a /tool command.
 *  2. permissionManager.checkPermission() determines if a prompt is needed.
 *  3. If yes, emit MCP_PERMISSION_REQUEST to the client.
 *  4. Client shows a permission UI (Allow once / Allow always / Deny).
 *  5. Client emits MCP_PERMISSION_RESPONSE.
 *  6. This module resolves/rejects the pending promise accordingly.
 *  7. If 'allow_always', persist the rule via permissionManager.grantAlwaysAllow().
 */

'use strict';

const crypto = require('crypto');
const { checkPermission, grantAlwaysAllow } = require('../../mcp-server/permissions/manager');

// Map of requestId -> { resolve, reject, timer }
const _pending = new Map();

const PROMPT_TIMEOUT_MS = 120_000; // 2 minutes to respond

/**
 * Build a short scope string for a tool call.
 * Used as the granularity key for "Allow always" rules.
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @returns {string}
 */
function buildScope(toolName, params) {
  if (toolName.startsWith('fs.')) return params.path || '';
  if (toolName.startsWith('git.')) return params.repoPath || '';
  if (toolName === 'cmd.run') return params.command || '';
  if (toolName === 'app.launch') return params.appId || '';
  if (toolName.startsWith('browser.')) return params.url || params.query || '';
  return '';
}

/**
 * Request user permission for a tool call.
 * Resolves when the user approves (allow_once or allow_always).
 * Rejects when denied or timed out.
 *
 * @param {object} opts
 * @param {import('socket.io').Socket} opts.socket  – target client socket
 * @param {string} opts.toolName
 * @param {Record<string, unknown>} opts.params
 * @param {string} opts.riskLevel
 * @param {string} [opts.clientMessageId]
 * @returns {Promise<{ decision: 'allow_once'|'allow_always', scope: string }>}
 */
function requestPermission({ socket, toolName, params, riskLevel, clientMessageId }) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const scope = buildScope(toolName, params);

    const timer = setTimeout(() => {
      _pending.delete(requestId);
      reject(new Error(`Permission request for "${toolName}" timed out after ${PROMPT_TIMEOUT_MS / 1000}s.`));
    }, PROMPT_TIMEOUT_MS);

    _pending.set(requestId, { resolve, reject, timer, toolName, scope });

    socket.emit('MCP_PERMISSION_REQUEST', {
      requestId,
      toolName,
      params,
      riskLevel,
      clientMessageId: clientMessageId || null,
      message: buildPromptMessage(toolName, params, riskLevel),
    });
  });
}

/**
 * Handle a MCP_PERMISSION_RESPONSE event from the client.
 *
 * @param {{ requestId: string, decision: 'allow_once'|'allow_always'|'deny' }} payload
 */
function handlePermissionResponse({ requestId, decision }) {
  const pending = _pending.get(requestId);
  if (!pending) return; // Already resolved or timed out.

  clearTimeout(pending.timer);
  _pending.delete(requestId);

  if (decision === 'deny') {
    pending.reject(new Error(`User denied permission for tool "${pending.toolName}".`));
    return;
  }

  if (decision === 'allow_always') {
    grantAlwaysAllow(pending.toolName, pending.scope);
  }

  pending.resolve({ decision, scope: pending.scope });
}

/**
 * Full permission check + prompt flow.
 *
 * If no prompt is needed (LOW risk or Allow always rule exists), resolves immediately.
 * Otherwise prompts the user via Socket.IO.
 *
 * @param {object} opts
 * @param {import('socket.io').Socket} opts.socket
 * @param {string} opts.toolName
 * @param {Record<string, unknown>} opts.params
 * @param {string} [opts.clientMessageId]
 * @returns {Promise<void>} resolves if execution is approved
 */
async function ensurePermission({ socket, toolName, params, clientMessageId }) {
  const scope = buildScope(toolName, params);
  const { needsPrompt, riskLevel } = checkPermission(toolName, scope);

  if (!needsPrompt) return;

  await requestPermission({ socket, toolName, params, riskLevel, clientMessageId });
}

/**
 * Build a human-readable prompt message shown in the UI.
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @param {string} riskLevel
 * @returns {string}
 */
function buildPromptMessage(toolName, params, riskLevel) {
  const descriptions = {
    'fs.list': `List directory: ${params.path || '.'}`,
    'fs.read': `Read file: ${params.path}`,
    'fs.write': `Write file: ${params.path}`,
    'fs.mkdir': `Create directory: ${params.path}`,
    'fs.delete': `⚠️ DELETE: ${params.path}`,
    'git.status': `Git status in: ${params.repoPath || '.'}`,
    'git.diff': `Git diff in: ${params.repoPath || '.'}`,
    'git.log': `Git log in: ${params.repoPath || '.'}`,
    'git.branch': `Git branch (${params.action || 'list'}) in: ${params.repoPath || '.'}`,
    'git.commit': `Git commit in: ${params.repoPath || '.'} — "${params.message}"`,
    'cmd.run': `Run command: ${params.command} ${(params.args || []).join(' ')}`,
    'app.launch': `Launch app: ${params.appId}`,
    'browser.open': `Open URL: ${params.url}`,
    'browser.search': `Search: "${params.query}" via ${params.engine || 'auto'}`,
    'util.time': 'Get local time',
    'util.weather': `Get weather for: ${params.location || params.lat || 'your location'}`,
  };

  const desc = descriptions[toolName] || `Execute tool: ${toolName}`;
  return `[${riskLevel}] ${desc}`;
}

module.exports = { ensurePermission, handlePermissionResponse, requestPermission, buildScope };
