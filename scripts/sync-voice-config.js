const fs = require('fs');
const path = require('path');

const sourcePath = path.resolve(__dirname, '..', 'packages', 'config', 'voice-detection-config.js');
const targetPath = path.resolve(__dirname, '..', 'packages', 'client', 'public', 'voice-detection-config-inject.js');

function ensureSourceExists() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`No se encontro archivo fuente: ${sourcePath}`);
  }
}

function syncVoiceConfig() {
  ensureSourceExists();
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[sync-voice-config] OK: ${path.basename(sourcePath)} -> ${targetPath}`);
}

try {
  syncVoiceConfig();
} catch (error) {
  console.error('[sync-voice-config] ERROR:', error.message);
  process.exitCode = 1;
}
