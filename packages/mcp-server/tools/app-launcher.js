/**
 * App launcher tool – app.launch
 *
 * Launches a desktop application from the allowlist.
 * An app entry must BOTH:
 *   1) Be present in the allowlist (appId key exists), AND
 *   2) Have an explicit "path" property pointing to the executable.
 *
 * Risk: MEDIUM
 */

const { execFile } = require('child_process');
const fs = require('fs');
const { getConfig } = require('../config/defaults');

/**
 * Launch an application by its allowlist ID.
 * @param {{ appId: string }} params
 * @returns {Promise<{ appId: string, executablePath: string, launched: boolean }>}
 */
async function appLaunch({ appId } = {}) {
  if (!appId) throw new Error('app.launch requires an appId.');

  const config = getConfig();
  const entry = config.appAllowlist[appId];

  if (!entry) {
    throw new Error(
      `App "${appId}" is not in the allowlist. Allowed IDs: ${Object.keys(config.appAllowlist).join(', ') || '(none configured)'}.`
    );
  }

  if (!entry.path) {
    throw new Error(
      `App "${appId}" is in the allowlist but has no configured executable path. ` +
        `Update your mcp-config.json and set appAllowlist["${appId}"].path.`
    );
  }

  const execPath = entry.path;

  if (!fs.existsSync(execPath)) {
    throw new Error(
      `Executable not found for app "${appId}": "${execPath}". ` +
        `Check that the application is installed and the path in mcp-config.json is correct.`
    );
  }

  return new Promise((resolve, reject) => {
    const child = execFile(execPath, [], { detached: true }, (err) => {
      if (err) {
        reject(new Error(`Failed to launch "${appId}": ${err.message}`));
      }
    });

    child.unref();

    // Give the process a moment to fail, then resolve.
    setTimeout(() => {
      resolve({ appId, executablePath: execPath, launched: true });
    }, 300);

    child.on('error', (err) => {
      reject(new Error(`Failed to launch "${appId}": ${err.message}`));
    });
  });
}

/**
 * List configured apps in the allowlist.
 * @returns {{ apps: Array<{ appId: string, path: string, configured: boolean }> }}
 */
function appList() {
  const config = getConfig();
  const apps = Object.entries(config.appAllowlist).map(([appId, entry]) => ({
    appId,
    path: entry.path || null,
    configured: !!entry.path,
  }));
  return { apps };
}

module.exports = { appLaunch, appList };
