/**
 * Filesystem tools – fenced to workspaceRoot.
 *
 * Tools:
 *   fs.list(path)                           LOW
 *   fs.read(path)                           LOW
 *   fs.write(path, content)                 MEDIUM
 *   fs.mkdir(path)                          MEDIUM
 *   fs.delete(path)                         HIGH  (requires confirmation)
 */

const fs = require('fs');
const path = require('path');
const { getConfig } = require('../config/defaults');

/**
 * Resolve and validate that a requested path stays inside workspaceRoot.
 * Throws if the resolved path escapes the fence.
 * @param {string} requestedPath
 * @returns {string} absolute, normalised path
 */
function resolveSafe(requestedPath) {
  const { workspaceRoot } = getConfig();
  const resolved = path.resolve(workspaceRoot, requestedPath);
  const normalised = path.normalize(resolved);
  const fence = path.normalize(workspaceRoot);

  if (!normalised.startsWith(fence + path.sep) && normalised !== fence) {
    throw new Error(`Access denied: path "${requestedPath}" is outside workspace root "${workspaceRoot}".`);
  }
  return normalised;
}

/**
 * List directory contents.
 * @param {{ path?: string }} args
 * @returns {{ entries: Array<{ name: string, type: 'file'|'directory', size?: number }> }}
 */
async function fsList({ path: reqPath = '.' } = {}) {
  const dir = resolveSafe(reqPath);

  if (!fs.existsSync(dir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }

  const names = fs.readdirSync(dir);
  const entries = names.map((name) => {
    const full = path.join(dir, name);
    try {
      const s = fs.statSync(full);
      return {
        name,
        type: s.isDirectory() ? 'directory' : 'file',
        size: s.isFile() ? s.size : undefined,
      };
    } catch {
      return { name, type: 'unknown' };
    }
  });

  return { path: dir, entries };
}

/**
 * Read a file's text content.
 * @param {{ path: string, encoding?: string }} args
 * @returns {{ path: string, content: string }}
 */
async function fsRead({ path: reqPath, encoding = 'utf8' } = {}) {
  if (!reqPath) throw new Error('fs.read requires a path argument.');
  const file = resolveSafe(reqPath);

  if (!fs.existsSync(file)) {
    throw new Error(`File not found: ${file}`);
  }

  const stat = fs.statSync(file);
  if (!stat.isFile()) {
    throw new Error(`Not a file: ${file}`);
  }

  const content = fs.readFileSync(file, encoding);
  return { path: file, content };
}

/**
 * Write (create or overwrite) a file.
 * @param {{ path: string, content: string, encoding?: string }} args
 * @returns {{ path: string, bytesWritten: number }}
 */
async function fsWrite({ path: reqPath, content = '', encoding = 'utf8' } = {}) {
  if (!reqPath) throw new Error('fs.write requires a path argument.');
  const file = resolveSafe(reqPath);

  // Ensure parent directory exists.
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(file, content, encoding);
  return { path: file, bytesWritten: Buffer.byteLength(content, encoding) };
}

/**
 * Create a directory (including intermediate parents).
 * @param {{ path: string }} args
 * @returns {{ path: string, created: boolean }}
 */
async function fsMkdir({ path: reqPath } = {}) {
  if (!reqPath) throw new Error('fs.mkdir requires a path argument.');
  const dir = resolveSafe(reqPath);
  const existed = fs.existsSync(dir);
  fs.mkdirSync(dir, { recursive: true });
  return { path: dir, created: !existed };
}

/**
 * Delete a file or directory (recursive).
 * HIGH risk – must be pre-approved by the permission layer.
 * @param {{ path: string }} args
 * @returns {{ path: string, deleted: boolean }}
 */
async function fsDelete({ path: reqPath } = {}) {
  if (!reqPath) throw new Error('fs.delete requires a path argument.');
  const target = resolveSafe(reqPath);

  if (!fs.existsSync(target)) {
    return { path: target, deleted: false, reason: 'path does not exist' };
  }

  fs.rmSync(target, { recursive: true, force: true });
  return { path: target, deleted: true };
}

module.exports = { fsList, fsRead, fsWrite, fsMkdir, fsDelete, resolveSafe };
