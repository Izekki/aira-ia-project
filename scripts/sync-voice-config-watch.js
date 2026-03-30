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
  console.log(`[sync-voice-config:watch] SYNC OK ${new Date().toLocaleTimeString()}`);
}

let debounceTimer = null;

function scheduleSync() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    try {
      syncVoiceConfig();
    } catch (error) {
      console.error('[sync-voice-config:watch] ERROR:', error.message);
    }
  }, 120);
}

try {
  syncVoiceConfig();
  fs.watch(sourcePath, { persistent: true }, () => {
    scheduleSync();
  });
  console.log('[sync-voice-config:watch] Watching cambios en voice-detection-config.js');
} catch (error) {
  console.error('[sync-voice-config:watch] ERROR:', error.message);
  process.exitCode = 1;
}
