/**
 * MCP Command Parser
 *
 * Parses the minimal chat command syntax for manual tool invocation:
 *
 *   /tool <toolName> [key=value ...] [--flag]
 *
 * Examples:
 *   /tool fs.list path=.
 *   /tool fs.read path=src/index.js
 *   /tool fs.write path=notes.txt content="hello world"
 *   /tool git.status repoPath=.
 *   /tool cmd.run command=node args=["--version"]
 *   /tool app.launch appId=vscode
 *   /tool browser.search query="lofi music"
 *   /tool util.time
 */

'use strict';

const TOOL_PREFIX = '/tool ';

/**
 * Check if a text starts with the tool command prefix.
 * @param {string} text
 * @returns {boolean}
 */
function isToolCommand(text) {
  return typeof text === 'string' && text.trimStart().startsWith(TOOL_PREFIX);
}

/**
 * Parse a tool command string into { toolName, params }.
 *
 * Supports:
 *   key=value          – simple string value
 *   key="quoted value" – quoted string (spaces allowed)
 *   key=123            – number
 *   key=true/false     – boolean
 *   key=[a,b,c]        – JSON array
 *   key={...}          – JSON object
 *
 * @param {string} text
 * @returns {{ toolName: string, params: Record<string, unknown> } | null}
 */
function parseToolCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith(TOOL_PREFIX)) return null;

  const rest = trimmed.slice(TOOL_PREFIX.length).trim();
  if (!rest) return null;

  // First token is the tool name.
  const spaceIdx = rest.indexOf(' ');
  const toolName = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const argsStr = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

  const params = parseArgs(argsStr);

  return { toolName, params };
}

/**
 * Parse `key=value` pairs from a string.
 * Handles quoted values, JSON arrays/objects, and bare numbers/booleans.
 * @param {string} str
 * @returns {Record<string, unknown>}
 */
function parseArgs(str) {
  const params = {};
  if (!str) return params;

  // Tokenise respecting quotes and brackets.
  const tokens = tokenise(str);

  for (const token of tokens) {
    const eqIdx = token.indexOf('=');
    if (eqIdx === -1) {
      // Flag without value → treat as boolean true.
      params[token.replace(/^--/, '')] = true;
      continue;
    }
    const key = token.slice(0, eqIdx);
    const rawValue = token.slice(eqIdx + 1);
    params[key] = coerce(rawValue);
  }

  return params;
}

/**
 * Split the args string into `key=value` tokens, respecting:
 * - double-quoted strings
 * - JSON arrays `[...]`
 * - JSON objects `{...}`
 * @param {string} str
 * @returns {string[]}
 */
function tokenise(str) {
  const tokens = [];
  let current = '';
  let depth = 0;
  let inQuote = false;
  let quoteChar = '';

  for (let i = 0; i < str.length; i++) {
    const ch = str[i];

    if (inQuote) {
      if (ch === quoteChar && str[i - 1] !== '\\') {
        inQuote = false;
        current += ch;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
      current += ch;
      continue;
    }

    if (ch === '[' || ch === '{') {
      depth++;
      current += ch;
      continue;
    }

    if (ch === ']' || ch === '}') {
      depth--;
      current += ch;
      continue;
    }

    if (ch === ' ' && depth === 0) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += ch;
  }

  if (current) tokens.push(current);
  return tokens;
}

/**
 * Coerce a raw string value to the appropriate JS type.
 * @param {string} raw
 * @returns {unknown}
 */
function coerce(raw) {
  if (!raw) return '';

  // Strip surrounding quotes.
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\'/g, "'");
  }

  // JSON array or object.
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;

  const num = Number(raw);
  if (!isNaN(num) && raw !== '') return num;

  return raw;
}

module.exports = { isToolCommand, parseToolCommand, parseArgs };
