const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');

let VOICE_CONFIG = null;

function loadEnvFiles() {
  const envCandidates = [
    path.resolve(__dirname, '..', '..', '..', '.env'),
    path.join(__dirname, '..', '.env'),
  ];

  envCandidates.forEach((envPath) => {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  });
}

function getVoiceConfigModule() {
  if (VOICE_CONFIG) {
    return VOICE_CONFIG;
  }

  try {
    VOICE_CONFIG = require('../../config/voice-detection-config.js');
  } catch {
    VOICE_CONFIG = null;
  }

  return VOICE_CONFIG;
}

function resolveServerRuntimeConfig() {
  const configModule = getVoiceConfigModule();
  const voiceServerConfig = configModule?.getServerConfig?.() || {};

  const configuredSocketPort = Number(voiceServerConfig.socketPort);
  const port = Number(
    process.env.PORT ||
    process.env.SOCKET_PORT ||
    (Number.isFinite(configuredSocketPort) ? configuredSocketPort : 4000)
  );

  const voiceRuntimeConfig = configModule?.getVoiceRuntimeConfig?.() || {};

  return {
    port,
    voiceServerConfig,
    voiceRuntime: {
      migrationPhase: String(voiceRuntimeConfig?.migration?.phase || 'prep'),
      backendStreamingEnabled: Boolean(voiceRuntimeConfig?.migration?.enableBackendStreamingProtocol),
      sttMode: String(voiceRuntimeConfig?.stt?.mode || 'browser'),
      ttsMode: String(voiceRuntimeConfig?.tts?.mode || 'browser'),
      browserFallbackEnabled: Boolean(voiceRuntimeConfig?.migration?.allowBrowserFallback),
    },
  };
}

module.exports = {
  loadEnvFiles,
  resolveServerRuntimeConfig,
};
