#!/usr/bin/env node
/**
 * Helper script for `npm run desktop:dev`.
 *
 * If the AIRA_DESKTOP_DEV_URL environment variable is set, it is forwarded to
 * Tauri via TAURI_CONFIG so the dev window loads from that URL instead of the
 * default (http://localhost:3001).
 *
 * Usage:
 *   # Linux / macOS
 *   AIRA_DESKTOP_DEV_URL=http://localhost:3002 npm run desktop:dev
 *
 *   # Windows PowerShell
 *   $env:AIRA_DESKTOP_DEV_URL="http://localhost:3002"; npm run desktop:dev
 *
 *   # Windows cmd
 *   set AIRA_DESKTOP_DEV_URL=http://localhost:3002 && npm run desktop:dev
 */

'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const devUrl = process.env.AIRA_DESKTOP_DEV_URL;
const env = { ...process.env };

if (devUrl) {
  // TAURI_CONFIG accepts a JSON string that deep-merges with tauri.conf.json.
  env.TAURI_CONFIG = JSON.stringify({ build: { devUrl } });
  console.log(`[desktop-dev] Using dev URL from AIRA_DESKTOP_DEV_URL: ${devUrl}`);
} else {
  console.log('[desktop-dev] Using default dev URL (http://localhost:3001)');
}

const desktopDir = path.resolve(__dirname, '..', 'packages', 'desktop');
const isWindows = process.platform === 'win32';
const result = spawnSync(
  isWindows ? 'npm.cmd' : 'npm',
  ['run', 'dev'],
  { cwd: desktopDir, env, stdio: 'inherit' }
);

process.exit(result.status ?? 0);
