/**
 * ============================================================================
 * CONFIGURACIÓN GLOBAL DE DETECCIÓN DE VOZ Y WAKE WORDS
 * ============================================================================
 * 
 * Este archivo centraliza TODA la configuración de detección de voz del sistema.
 * Modifica los valores aquí para cambiar el comportamiento de:
 *   - Modelos de wake word
 *   - Umbral de confianza (confidence threshold)
 *   - Sensibilidad de detección
 *   - Parámetros de audio
 *   - Idioma de reconocimiento
 *
 * NOTA: Este archivo es importado tanto por cliente como por servidor,
 *       adaptando los valores según sea necesario.
 * ============================================================================
 */

/**
 * ============================================================================
 * 1. CONFIGURACIÓN DE WAKE WORDS
 * ============================================================================
 * 
 * Define las palabras de activación que el sistema escucha.
 * 
 * CÓMO CAMBIAR:
 *   - Edita el array WAKE_WORDS_CONFIG
 *   - Ejemplo: ['aira', 'aira', 'ok aira']
 *   - El sistema detectará cualquiera de estas palabras (normalizadas)
 */
const ENV_WAKE_WORD_MODEL =
  typeof process !== 'undefined' && process?.env?.WAKE_WORD_MODEL
    ? process.env.WAKE_WORD_MODEL
    : null;

const ENV_WAKE_WORD_THRESHOLD =
  typeof process !== 'undefined' && process?.env?.WAKE_WORD_THRESHOLD
    ? Number(process.env.WAKE_WORD_THRESHOLD)
    : NaN;

const ENV_WAKE_WORD_VAD_THRESHOLD =
  typeof process !== 'undefined' && process?.env?.WAKE_WORD_VAD_THRESHOLD
    ? Number(process.env.WAKE_WORD_VAD_THRESHOLD)
    : NaN;

const ENV_SOCKET_PORT =
  typeof process !== 'undefined' && process?.env?.SOCKET_PORT
    ? Number(process.env.SOCKET_PORT)
    : NaN;

const ENV_STT_MODE =
  typeof process !== 'undefined' && process?.env?.AIRA_STT_MODE
    ? String(process.env.AIRA_STT_MODE).trim().toLowerCase()
    : '';

const ENV_TTS_MODE =
  typeof process !== 'undefined' && process?.env?.AIRA_TTS_MODE
    ? String(process.env.AIRA_TTS_MODE).trim().toLowerCase()
    : '';

const ENV_VOICE_BACKEND_URL =
  typeof process !== 'undefined' && process?.env?.VOICE_BACKEND_URL
    ? String(process.env.VOICE_BACKEND_URL).trim()
    : '';

const ENV_VOICE_TTS_PROVIDER =
  typeof process !== 'undefined' && process?.env?.VOICE_TTS_PROVIDER
    ? String(process.env.VOICE_TTS_PROVIDER).trim().toLowerCase()
    : '';

const ENV_VIBEV_WS_URL =
  typeof process !== 'undefined' && process?.env?.VIBEV_WS_URL
    ? String(process.env.VIBEV_WS_URL).trim()
    : '';

const ENV_VOICE_TTS_STREAMING =
  typeof process !== 'undefined' && process?.env?.VOICE_TTS_STREAMING
    ? String(process.env.VOICE_TTS_STREAMING).trim().toLowerCase()
    : '';

const WAKE_WORDS_CONFIG = {
  // Array de palabras o frases de activación
  // ⚠️  PRINCIPAL: Usa "aira" como wake word principal
  enabled: ['hey aira', 'aira'],

  // Variantes adicionales aceptadas (ej: pronunciaciones alternativas)
  // Se normalizan automáticamente (se quitan acentos, espacios extras, etc.)
  variants: [
    // Agrega más variantes aquí si lo necesitas
    // 'hey aira',
    // 'ok aira',
  ],

  // Sub-configuración de cliente (navegador)
  client: {
    // Palabras escuchadas por el navegador (reconocimiento de voz del sistema)
    default: ['hey aira', 'aira'],
    // Idioma de reconocimiento de voz en cliente
    language: 'es-MX', // Cambia a 'es-ES', 'en-US', etc. según lo necesites
  },

  // Sub-configuración de servidor (Electron/Desktop)
  server: {
    // Modelo ONNX a usar para detección (debe existir en packages/server/recorder/models/)
    // ⚠️  CAMBIA AQUÍ para usar diferentes modelos:
    //     - 'aira.onnx' (recomendado - para "aira")
    //     - 'alexa_v0.1.onnx' (para "alexa")
    //     - 'hey_jarvis_v0.1.onnx' (para "hey jarvis")
    //     - 'hey_mycroft_v0.1.onnx' (para "hey mycroft")
    model: ENV_WAKE_WORD_MODEL || 'aira.onnx',

    // Etiqueta legible del modelo (usada en logs y UI)
    // Se genera automáticamente a partir del nombre del modelo
    // pero puedes sobrescribirlo aquí
    labelOverride: null, // null = automático, o usa: 'HeyAIRA', 'Alexa Custom', etc.
  },
};

/**
 * ============================================================================
 * 2. CONFIGURACIÓN DE UMBRALES DE CONFIANZA
 * ============================================================================
 * 
 * Define qué tan seguro debe estar el sistema para activarse.
 * Rango: 0.0 (siempre activa) a 1.0 (muy restrictivo)
 * 
 * CÓMO AJUSTAR:
 *   - Aumenta el valor si hay DEMASIADAS FALSAS ALARMAS
 *   - Disminuye el valor si el sistema NO DETECTA tu voz
 * 
 * Recomendaciones:
 *   - 0.2 a 0.4 = muy permisivo (más detecciones falsas)
 *   - 0.35 a 0.55 = equilibrado (recomendado)
 *   - 0.6 a 0.8 = muy restrictivo (menos detecciones falsas, pero puede perder la tuya)
 */
const CONFIDENCE_THRESHOLDS = {
  // Cliente (navegador - reconocimiento de voz del sistema)
  // ⚠️  AJUSTA AQUÍ: Si la detección en el navegador es muy sensible o poco sensible
  client: {
    minConfidence: 0.18, // Balance recomendado para reducir falsos positivos sin perder sensibilidad
  },

  // Servidor (modelos ONNX locales)
  // ⚠️  AJUSTA AQUÍ: Si tienes falsas alarmas o no detecta bien tu "aira"
  server: {
    // Umbral del clasificador de wake word (Alexa, Jarvis, HeyAIRA, etc.)
    // Cambia con env var: WAKE_WORD_THRESHOLD
    wakeWordThreshold: Number.isFinite(ENV_WAKE_WORD_THRESHOLD)
      ? ENV_WAKE_WORD_THRESHOLD
      : 0.18,

    // Umbral del detector de actividad de voz (VAD - Voice Activity Detection)
    // Si es muy alto: puede no detectar voces suaves
    // Si es muy bajo: puede detectar ruido como voz
    vadThreshold: Number.isFinite(ENV_WAKE_WORD_VAD_THRESHOLD)
      ? ENV_WAKE_WORD_VAD_THRESHOLD
      : 0.45,

    // Umbral para logística/smoothing de detecciones
    logisticThreshold: 0.5,
  },
};

/**
 * ============================================================================
 * 3. CONFIGURACIÓN DE PARÁMETROS DE AUDIO
 * ============================================================================
 * 
 * Parámetros técnicos de procesamiento de audio.
 * 🔴 CAMBIAR ESTO REQUIERE AJUSTE DE MODELOS - deja como está si no sabes
 */
const AUDIO_PARAMETERS = {
  // Muestras de audio por segundo
  // Valores comunes: 16000 Hz (recomendado), 44100 Hz
  sampleRate: 16000, // ⚠️  No cambies sin reentrenar modelos

  // Número de muestras de audio procesadas por frame/lote
  frameSize: 512, // ⚠️  No cambies sin reentrenar modelos

  // Número de bins de frecuencia en el mel-spectrogram
  melFrameBins: 32, // ⚠️  No cambies sin reentrenar modelos

  // Tamaño de la ventana de mel-spectrograma
  melWindowSize: 76, // ⚠️  No cambies sin reentrenar modelos

  // Tamaño del modelo de embedding
  embeddingSize: 96, // ⚠️  No cambies sin reentrenar modelos

  // Tamaño de la ventana de embedding
  embeddingWindowSize: 16, // ⚠️  No cambies sin reentrenar modelos
};

/**
 * ============================================================================
 * 4. CONFIGURACIÓN DE TIEMPOS Y COOLDOWNS
 * ============================================================================
 * 
 * Tiempos entre detecciones para evitar activaciones múltiples rápidas.
 * 
 * CÓMO AJUSTAR:
 *   - Aumenta si la detección se dispara múltiples veces seguidas
 *   - Disminuye si quieres más rapidez entre detecciones
 */
const TIMING_CONFIG = {
  // Tiempo MÍNIMO entre detecciones consecutivas (en milisegundos)
  // ⚠️  AJUSTA AQUÍ: Si quieres que espere más (ej: 2000) o menos (ej: 1000)
  // Recomendado: 1400-1500 ms
  detectionCooldownMs: {
    client: 1700, // Navegador
    server: 1600, // Servidor (Electron)
  },

  // Parametros para flujo manos libres: activa microfono con wake word y
  // corta automaticamente al detectar fin de frase (silencio) con timeout de respaldo.
  speechCapture: {
    wakeAutoStopAfterFinalMs: 700,
    wakeMaxSessionMs: 18000,
  },

  // Tiempo antes de reintentar si hay error
  errorRetryDelayMs: 1000,

  // Timeout para caída de conexión
  connectionTimeoutMs: 5000,
};

/**
 * ============================================================================
 * 6. CONFIGURACIÓN DE RED (SOCKET)
 * ============================================================================
 */
const NETWORK_CONFIG = {
  socket: {
    host: '127.0.0.1',
    port: Number.isFinite(ENV_SOCKET_PORT) ? ENV_SOCKET_PORT : 4000,
  },
};

/**
 * ============================================================================
 * 5. CONFIGURACIÓN DE MAPEO DE MODELOS A ETIQUETAS LEGIBLES
 * ============================================================================
 * 
 * Mapea archivos .onnx a nombres legibles para mostrar en UI/logs.
 * 
 * CÓMO AGREGAR TU PROPIO MODELO:
 *   - Agrega una línea: 'aira.onnx': 'AIRA Custom'
 *   - El archivo must existir en: packages/server/recorder/models/aira.onnx
 */
const MODEL_LABELS = {
  // Nombres de modelos conocidos -> Etiqueta legible
  'alexa_v0.1.onnx': 'Alexa',
  'hey_jarvis_v0.1.onnx': 'Hey Jarvis',
  'hey_mycroft_v0.1.onnx': 'Hey Mycroft',
  'hey_rhasspy_v0.1.onnx': 'Hey Rhasspy',
  'aira.onnx': 'AIRA (Custom)',
  'timer_v0.1.onnx': 'Timer',
  'weather_v0.1.onnx': 'Weather',

  // ⚠️  AGREGAR MODELOS PERSONALIZADOS:
  // Si creas un nuevo modelo 'mimodelo.onnx', agrega:
  // 'mimodelo.onnx': 'Mi Modelo Personalizado',
};

/**
 * ============================================================================
 * 7. CONFIGURACIÓN DE DEBUG Y LOGGING
 * ============================================================================
 * 
 * Controla qué información se imprime en consola.
 */
const DEBUG_CONFIG = {
  // Habilita logs detallados de detección
  // Usa localStorage: localStorage.setItem('AIRA_WAKEWORD_DEBUG', '1')
  enableDetailedLogs: false,

  // Habilita logs de audio (cuidado: genera mucha salida)
  enableAudioLogs: false,
};

function parseEnvBoolean(rawValue, fallback = false) {
  const normalized = String(rawValue || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

/**
 * ============================================================================
 * 8. CONFIGURACIÓN DE RUNTIME DE VOZ (MIGRACIÓN STT/TTS)
 * ============================================================================
 *
 * Objetivo: preparar el proyecto para migrar STT/TTS al backend con streaming,
 * manteniendo fallback en navegador durante la transición.
 */
const VOICE_RUNTIME_CONFIG = {
  migration: {
    phase: 'prep',
    enableBackendStreamingProtocol: parseEnvBoolean(ENV_VOICE_TTS_STREAMING, false),
    allowBrowserFallback: true,
  },

  stt: {
    // browser | backend
    mode: ENV_STT_MODE === 'backend' ? 'backend' : 'browser',
    backendProvider: 'faster-whisper',
    backendTransport: 'socket.io',
    // Endpoint futuro para sesión de voz en streaming (no implementado aún)
    backendSessionEvent: 'VOICE_SESSION_START',
  },

  tts: {
    // browser | backend
    mode: ENV_TTS_MODE === 'browser' ? 'browser' : 'backend',
    backendProvider: ENV_VOICE_TTS_PROVIDER || 'vibevoice-realtime',
    backendTransport: 'socket.io',
    backendChunkEvent: 'TTS_AUDIO_CHUNK',
  },

  network: {
    backendUrl: ENV_VOICE_BACKEND_URL || null,
    vibevWsUrl: ENV_VIBEV_WS_URL || 'ws://127.0.0.1:3000',
  },
};

/**
 * ============================================================================
 * FUNCIONES HELPER
 * ============================================================================
 */

/**
 * Obtiene la etiqueta legible para un modelo ONNX
 * @param {string} modelName - Nombre del archivo del modelo
 * @returns {string} Etiqueta legible
 */
function getModelLabel(modelName) {
  return MODEL_LABELS[modelName] || modelName.replace(/_v\d+\.\d+(.onnx)?/g, '');
}

/**
 * Obtiene la configuración de servidor (lado Electron)
 * Combina valores por defecto con overrides de env vars
 * @returns {object} Configuración del servidor
 */
function getServerConfig() {
  return {
    modelName: WAKE_WORDS_CONFIG.server.model,
    label: WAKE_WORDS_CONFIG.server.labelOverride || getModelLabel(WAKE_WORDS_CONFIG.server.model),
    wakeWordThreshold: CONFIDENCE_THRESHOLDS.server.wakeWordThreshold,
    vadThreshold: CONFIDENCE_THRESHOLDS.server.vadThreshold,
    cooldownMs: TIMING_CONFIG.detectionCooldownMs.server,
    socketHost: NETWORK_CONFIG.socket.host,
    socketPort: NETWORK_CONFIG.socket.port,
    ...AUDIO_PARAMETERS,
  };
}

/**
 * Obtiene la configuración de cliente (lado navegador)
 * @returns {object} Configuración del cliente
 */
function getClientConfig() {
  const socketHost = NETWORK_CONFIG.socket.host;
  const socketPort = NETWORK_CONFIG.socket.port;

  return {
    wakeWords: WAKE_WORDS_CONFIG.client.default,
    language: WAKE_WORDS_CONFIG.client.language,
    minConfidence: CONFIDENCE_THRESHOLDS.client.minConfidence,
    cooldownMs: TIMING_CONFIG.detectionCooldownMs.client,
    wakeAutoStopAfterFinalMs: TIMING_CONFIG.speechCapture.wakeAutoStopAfterFinalMs,
    wakeMaxSessionMs: TIMING_CONFIG.speechCapture.wakeMaxSessionMs,
    sttMode: VOICE_RUNTIME_CONFIG.stt.mode,
    ttsMode: VOICE_RUNTIME_CONFIG.tts.mode,
    ttsProvider: VOICE_RUNTIME_CONFIG.tts.backendProvider,
    browserFallbackEnabled: VOICE_RUNTIME_CONFIG.migration.allowBrowserFallback,
    backendStreamingEnabled: VOICE_RUNTIME_CONFIG.migration.enableBackendStreamingProtocol,
    vibevWsUrl: VOICE_RUNTIME_CONFIG.network.vibevWsUrl,
    socketHost,
    socketPort,
    socketUrl: `http://${socketHost}:${socketPort}`,
  };
}

/**
 * Configuración de runtime de voz para orquestación server/client.
 * @returns {object}
 */
function getVoiceRuntimeConfig() {
  return {
    migration: {
      ...VOICE_RUNTIME_CONFIG.migration,
    },
    stt: {
      ...VOICE_RUNTIME_CONFIG.stt,
    },
    tts: {
      ...VOICE_RUNTIME_CONFIG.tts,
    },
    network: {
      ...VOICE_RUNTIME_CONFIG.network,
    },
  };
}

/**
 * Exporta configuración según el entorno (Node.js vs Navegador)
 */
if (typeof module !== 'undefined' && module.exports) {
  // Entorno Node.js (Servidor)
  module.exports = {
    WAKE_WORDS_CONFIG,
    CONFIDENCE_THRESHOLDS,
    AUDIO_PARAMETERS,
    TIMING_CONFIG,
    NETWORK_CONFIG,
    MODEL_LABELS,
    DEBUG_CONFIG,
    VOICE_RUNTIME_CONFIG,
    getModelLabel,
    getServerConfig,
    getClientConfig,
    getVoiceRuntimeConfig,
  };
} else {
  // Entorno navegador
  window.VOICE_DETECTION_CONFIG = {
    WAKE_WORDS_CONFIG,
    CONFIDENCE_THRESHOLDS,
    AUDIO_PARAMETERS,
    TIMING_CONFIG,
    NETWORK_CONFIG,
    MODEL_LABELS,
    DEBUG_CONFIG,
    VOICE_RUNTIME_CONFIG,
    getModelLabel,
    getClientConfig,
    getVoiceRuntimeConfig,
  };
}
