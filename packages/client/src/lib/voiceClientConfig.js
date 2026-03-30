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
      wakeWords: ['hey aira', 'heyaira'],
      wakeWordThreshold: 0.2,
      wakeWordLanguage: 'es-MX',
      wakeWordCooldownMs: 1500,
      wakeAutoStopAfterFinalMs: 700,
      wakeMaxSessionMs: 18000,
      sttMode: 'browser',
      ttsMode: 'browser',
      browserFallbackEnabled: true,
      backendStreamingEnabled: false,
      serverWakeWordThreshold: 0.1,
      socketUrl: FALLBACK_SOCKET_SERVER_URL,
    };
  }

  const cfg = window.VOICE_DETECTION_CONFIG;
  const clientConfig = cfg?.getClientConfig?.() || {};
  const socketHost = String(clientConfig.socketHost || cfg?.NETWORK_CONFIG?.socket?.host || '127.0.0.1');
  const socketPort = Number(clientConfig.socketPort || cfg?.NETWORK_CONFIG?.socket?.port || 4000);
  const socketUrl =
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
    ttsMode: String(clientConfig.ttsMode || cfg?.VOICE_RUNTIME_CONFIG?.tts?.mode || 'browser'),
    browserFallbackEnabled: Boolean(
      clientConfig.browserFallbackEnabled ?? cfg?.VOICE_RUNTIME_CONFIG?.migration?.allowBrowserFallback ?? true
    ),
    backendStreamingEnabled: Boolean(
      clientConfig.backendStreamingEnabled ?? cfg?.VOICE_RUNTIME_CONFIG?.migration?.enableBackendStreamingProtocol ?? false
    ),
    serverWakeWordThreshold: clampThreshold(cfg?.CONFIDENCE_THRESHOLDS?.server?.wakeWordThreshold, 0.1),
    socketUrl,
  };
}
