export const FALLBACK_SOCKET_SERVER_URL = 'http://127.0.0.1:4000';

function clampThreshold(value, fallback = 0.2) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, parsed));
}

function normalizeWakeWords(words) {
  if (!Array.isArray(words)) {
    return ['aira'];
  }

  const normalized = words
    .map((word) => String(word || '').trim().toLowerCase())
    .filter(Boolean);

  return normalized.length > 0 ? normalized : ['aira'];
}

export function resolveVoiceClientConfig() {
  if (typeof window === 'undefined' || !window.VOICE_DETECTION_CONFIG) {
    return {
      wakeWords: ['hey aira', 'aira'],
      wakeWordThreshold: 0.2,
      wakeWordLanguage: 'es-MX',
      wakeWordCooldownMs: 1500,
      wakeAutoStopAfterFinalMs: 700,
      wakeMaxSessionMs: 18000,
      sttMode: 'browser',
      ttsMode: 'backend',
      ttsProvider: 'vibevoice-realtime',
      browserFallbackEnabled: true,
      backendStreamingEnabled: false,
      vibevWsUrl: 'ws://127.0.0.1:3000',
      serverWakeWordThreshold: 0.1,
      socketUrl: FALLBACK_SOCKET_SERVER_URL,
    };
  }

  const cfg = window.VOICE_DETECTION_CONFIG;
  const clientConfig = cfg?.getClientConfig?.() || {};
  const socketHost = String(clientConfig.socketHost || cfg?.NETWORK_CONFIG?.socket?.host || '127.0.0.1');
  const socketPort = Number(clientConfig.socketPort || cfg?.NETWORK_CONFIG?.socket?.port || 4000);
  // Allow Tauri desktop app (or any other host) to override the backend URL
  // by setting window.__AIRA_BACKEND_URL__ before the page scripts run.
  const desktopOverrideUrl =
    typeof window.__AIRA_BACKEND_URL__ === 'string'
      ? window.__AIRA_BACKEND_URL__.trim()
      : '';
  const socketUrl =
    desktopOverrideUrl ||
    String(clientConfig.socketUrl || '').trim() ||
    `http://${socketHost}:${Number.isFinite(socketPort) ? socketPort : 4000}`;

  return {
    wakeWords: normalizeWakeWords(clientConfig.wakeWords || cfg?.WAKE_WORDS_CONFIG?.client?.default),
    wakeWordThreshold: clampThreshold(cfg?.CONFIDENCE_THRESHOLDS?.client?.minConfidence, 0.2),
    wakeWordLanguage: String(clientConfig.language || cfg?.WAKE_WORDS_CONFIG?.client?.language || 'es-MX'),
    wakeWordCooldownMs: Math.max(
      0,
      Number(clientConfig.cooldownMs || cfg?.TIMING_CONFIG?.detectionCooldownMs?.client || 1500)
    ),
    wakeAutoStopAfterFinalMs: Math.max(
      120,
      Number(clientConfig.wakeAutoStopAfterFinalMs || cfg?.TIMING_CONFIG?.speechCapture?.wakeAutoStopAfterFinalMs || 700)
    ),
    wakeMaxSessionMs: Math.max(
      2000,
      Number(clientConfig.wakeMaxSessionMs || cfg?.TIMING_CONFIG?.speechCapture?.wakeMaxSessionMs || 18000)
    ),
    sttMode: String(clientConfig.sttMode || cfg?.VOICE_RUNTIME_CONFIG?.stt?.mode || 'browser'),
    ttsMode: String(clientConfig.ttsMode || cfg?.VOICE_RUNTIME_CONFIG?.tts?.mode || 'backend'),
    ttsProvider: String(
      clientConfig.ttsProvider || cfg?.VOICE_RUNTIME_CONFIG?.tts?.backendProvider || 'vibevoice-realtime'
    ),
    browserFallbackEnabled: Boolean(
      clientConfig.browserFallbackEnabled ?? cfg?.VOICE_RUNTIME_CONFIG?.migration?.allowBrowserFallback ?? true
    ),
    backendStreamingEnabled: Boolean(
      clientConfig.backendStreamingEnabled ?? cfg?.VOICE_RUNTIME_CONFIG?.migration?.enableBackendStreamingProtocol ?? false
    ),
    vibevWsUrl: String(clientConfig.vibevWsUrl || cfg?.VOICE_RUNTIME_CONFIG?.network?.vibevWsUrl || ''),
    serverWakeWordThreshold: clampThreshold(cfg?.CONFIDENCE_THRESHOLDS?.server?.wakeWordThreshold, 0.1),
    socketUrl,
  };
}
