const { createVibeVoiceRealtimeBridge } = require('./realtimeBridge');

function createNoopProvider() {
  return {
    connect() {
      return false;
    },
    speak() {
      return false;
    },
    stop() {
      return false;
    },
    close() {
      return false;
    },
    getState() {
      return {
        enabled: false,
        connected: false,
      };
    },
  };
}

function createTtsProvider({ io, buildProtocolMeta, voiceRuntime = {} }) {
  const ttsMode = String(voiceRuntime?.ttsMode || 'browser').trim().toLowerCase();
  if (ttsMode !== 'backend') {
    return createNoopProvider();
  }

  const wsUrl =
    String(process.env.VIBEV_WS_URL || '').trim() ||
    String(voiceRuntime?.vibevWsUrl || '').trim() ||
    String(process.env.VOICE_BACKEND_URL || '').trim() ||
    String(voiceRuntime?.voiceBackendUrl || '').trim();

  const providerName = String(voiceRuntime?.ttsProvider || 'vibevoice-realtime').trim().toLowerCase();
  if (providerName !== 'vibevoice-realtime') {
    console.warn(`[tts] Provider no soportado (${providerName}). Se usa bridge vibevoice-realtime.`);
  }
  
  console.log('[tts] vibev wsUrl =', wsUrl);
  return createVibeVoiceRealtimeBridge({
    wsUrl,
    io,
    buildProtocolMeta,
  });
}

module.exports = {
  createTtsProvider,
};
