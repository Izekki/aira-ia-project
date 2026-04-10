/**
 * MCP Bridge – HTTP client that calls the MCP server (port 4001).
 *
 * Used by the Aira server to execute tool calls after permission is granted.
 */

'use strict';

const http = require('http');

const MCP_HOST = process.env.MCP_HOST || '127.0.0.1';
const MCP_PORT = Number(process.env.MCP_PORT || 4001);

let _requestId = 1;

/**
 * Execute a tool on the MCP server.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} params
 * @returns {Promise<unknown>} result value
 * @throws if the tool call returns an error
 */
async function callTool(toolName, params = {}) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: _requestId++,
    method: toolName,
    params,
  });

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: MCP_HOST,
        port: MCP_PORT,
        path: '/rpc',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 35_000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (json.error) {
              reject(new Error(json.error.message || 'MCP tool error'));
            } else {
              resolve(json.result);
            }
          } catch (e) {
            reject(new Error('Invalid JSON response from MCP server: ' + e.message));
          }
        });
      }
    );

    req.on('error', (err) => reject(new Error(`MCP server unreachable (${MCP_HOST}:${MCP_PORT}): ${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('MCP server request timed out.'));
    });

    req.write(body);
    req.end();
  });
}

/**
 * Check if the MCP server is reachable.
 * @returns {Promise<boolean>}
 */
async function isAvailable() {
  return new Promise((resolve) => {
    const req = http.request(
      { hostname: MCP_HOST, port: MCP_PORT, path: '/health', method: 'GET', timeout: 3_000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
  });
}

module.exports = { callTool, isAvailable, MCP_HOST, MCP_PORT };
