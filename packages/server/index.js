const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const { generateAiraResponse } = require('./lib/gemini');
const { createMemoryStore } = require('./lib/supabase');

function loadEnvFiles() {
  const envCandidates = [
    path.resolve(__dirname, '..', '..', '.env'),
    path.join(__dirname, '.env'),
  ];

  envCandidates.forEach((envPath) => {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  });
}

loadEnvFiles();

let WakeWordService = null;
try {
  WakeWordService = require('./recorder/wakeWordService');
} catch (error) {
  console.error('[wake-word] No se pudo cargar WakeWordService:', error?.message || error);
}

let VOICE_CONFIG = null;
try {
  VOICE_CONFIG = require('../config/voice-detection-config.js');
} catch {
  VOICE_CONFIG = null;
}

const voiceServerConfig = VOICE_CONFIG?.getServerConfig?.() || {};
const configuredSocketPort = Number(voiceServerConfig.socketPort);
const PORT = Number(
  process.env.PORT ||
  process.env.SOCKET_PORT ||
  (Number.isFinite(configuredSocketPort) ? configuredSocketPort : 4000)
);
const WS_PROTOCOL_NAME = 'aira-ws';
const WS_PROTOCOL_VERSION = '1.0.0';
const SERVER_VERSION = '0.2.0';

const memoryStore = createMemoryStore({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
});

function buildFallbackMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  const isQuotaLike =
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('resource exhausted');

  if (isQuotaLike) {
    return 'Izekki, estoy en recaida por cuota ahora mismo. Dame un minuto, reintentamos y te saco adelante el siguiente paso.';
  }

  return 'Izekki, tuve una recaida de conexion en mi cerebro. Sigo contigo: vuelve a intentarlo y retomamos desde donde quedamos.';
}

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Aira Socket Server is running.');
});

const io = new Server(httpServer, {
  path: '/socket.io',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

let wakeWordService = null;
let wakeWordRuntime = {
  mode: 'server/openWakeWord',
  active: false,
  error: '',
  wakeWordLabel: String(voiceServerConfig.label || 'HeyAIRA (Custom)'),
  modelName: String(voiceServerConfig.modelName || 'heyaira.onnx'),
  threshold: Number(voiceServerConfig.wakeWordThreshold || 0.1),
};

async function startWakeWordEngine() {
  if (!WakeWordService) {
    wakeWordRuntime = {
      ...wakeWordRuntime,
      active: false,
      error: 'WakeWordService no disponible en este entorno',
    };

    io.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'error',
      code: 'WAKE_WORD_ENGINE_ERROR',
      message: `Wake word backend no disponible: ${wakeWordRuntime.error}`,
    });
    return;
  }

  try {
    wakeWordService = new WakeWordService({
      onWakeWordDetected: (payload = {}) => {
        io.emit('WAKE_WORD_DETECTED', {
          protocol: buildProtocolMeta('WAKE_WORD_DETECTED'),
          ...payload,
        });
      },
    });

    await wakeWordService.startListening();
    const runtimeInfo = wakeWordService.getRuntimeInfo();
    wakeWordRuntime = {
      mode: 'server/openWakeWord',
      active: true,
      error: '',
      wakeWordLabel: runtimeInfo.wakeWordLabel,
      modelName: runtimeInfo.modelName,
      threshold: runtimeInfo.wakeWordThreshold,
    };

    io.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'info',
      code: 'WAKE_WORD_ENGINE_READY',
      message: `Wake word backend activo: ${runtimeInfo.wakeWordLabel} (${runtimeInfo.modelName}) umbral ${runtimeInfo.wakeWordThreshold.toFixed(2)}`,
    });
  } catch (error) {
    wakeWordRuntime = {
      ...wakeWordRuntime,
      active: false,
      error: String(error?.message || 'No se pudo iniciar wake word engine'),
    };

    console.error('[wake-word] engine start failure', error);
    io.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'error',
      code: 'WAKE_WORD_ENGINE_ERROR',
      message: `Wake word backend no disponible: ${wakeWordRuntime.error}`,
    });
  }
}

function stopWakeWordEngine() {
  if (!wakeWordService) {
    return;
  }

  try {
    wakeWordService.cleanup();
  } catch (error) {
    console.error('[wake-word] engine cleanup failure', error);
  } finally {
    wakeWordService = null;
  }
}

let globalLastInputFingerprint = '';
let globalLastInputClientTimestamp = 0;
let globalLastInputReceivedAt = 0;
let globalLastClientMessageId = '';

function buildProtocolMeta(eventType) {
  return {
    protocol: WS_PROTOCOL_NAME,
    version: WS_PROTOCOL_VERSION,
    eventType,
    timestamp: Date.now(),
  };
}

function normalizeUserInputPayload(payload = {}) {
  const metadata =
    payload?.metadata && typeof payload.metadata === 'object'
      ? payload.metadata
      : {};

  const source = String(metadata?.source || payload?.source || 'unknown').trim().toLowerCase() || 'unknown';
  const text = String(payload?.content ?? payload?.text ?? payload?.message ?? '').trim();
  const timestamp = Number(payload?.timestamp || 0);
  const fingerprint = String(payload?.fingerprint || '').trim();
  const clientMessageId = String(
    payload?.clientMessageId ||
    metadata?.client_message_id ||
    metadata?.clientMessageId ||
    ''
  ).trim();
  const interruptActiveTts = Boolean(metadata?.interrupt_active_tts);

  return {
    metadata,
    source,
    text,
    timestamp,
    fingerprint,
    clientMessageId,
    interruptActiveTts,
  };
}

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);

  socket.emit('SERVER_READY', {
    protocol: buildProtocolMeta('SERVER_READY'),
    timestamp: Date.now(),
    version: SERVER_VERSION,
    wsVersion: WS_PROTOCOL_VERSION,
    wakeWord: wakeWordRuntime,
  });

  socket.emit('SYSTEM_MESSAGE', {
    protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
    type: 'info',
    code: 'CHANNEL_READY',
    message: 'Canal de eventos inicializado correctamente.',
  });

  socket.on('CLIENT_PING', (payload) => {
    console.log('[socket] CLIENT_PING', payload);

    socket.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'info',
      code: 'CLIENT_PING_OK',
      message: `Ping recibido a las ${new Date().toLocaleTimeString()}`,
    });
  });

  socket.on('USER_INPUT', async (payload = {}) => {
    const normalizedInput = normalizeUserInputPayload(payload);
    const {
      metadata,
      source,
      interruptActiveTts,
      text,
      timestamp: clientTimestamp,
      fingerprint: clientFingerprint,
      clientMessageId,
    } = normalizedInput;

    // Prioridad maxima: si el usuario interrumpe, cortamos TTS inmediatamente.
    if (interruptActiveTts) {
      io.emit('STOP_TTS');
      console.log(`[socket] STOP_TTS triggered by ${source}`);
    }

    if (!text) {
      return;
    }

    const fingerprint = clientFingerprint || `${source}:${text.toLowerCase()}`;
    const now = Date.now();

    const duplicatedByFingerprint =
      fingerprint === globalLastInputFingerprint &&
      now - globalLastInputReceivedAt <= 2500;

    const duplicatedByTimestamp =
      clientTimestamp > 0 &&
      clientTimestamp === globalLastInputClientTimestamp &&
      now - globalLastInputReceivedAt <= 10000;

    const duplicatedByClientMessageId =
      clientMessageId &&
      clientMessageId === globalLastClientMessageId &&
      now - globalLastInputReceivedAt <= 10000;

    if (duplicatedByFingerprint || duplicatedByTimestamp || duplicatedByClientMessageId) {
      console.log('[socket] USER_INPUT skipped duplicate', {
        text,
        source,
        clientMessageId,
      });
      return;
    }

    globalLastInputFingerprint = fingerprint;
    globalLastInputClientTimestamp = clientTimestamp;
    globalLastInputReceivedAt = now;
    globalLastClientMessageId = clientMessageId;

    socket.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'status',
      code: 'USER_INPUT_ACCEPTED',
      message: `Entrada ${source} aceptada para procesamiento.`,
      request: {
        clientMessageId,
        fingerprint,
        source,
      },
    });

    try {
      console.log('[socket] USER_INPUT', { text, source, clientMessageId });

      await memoryStore.saveMemory({
        role: 'user',
        content: text,
        inputType: source,
        fingerprint,
      });

      const recentMemories = await memoryStore.getRecentMemories(14);

      const airaText = await generateAiraResponse({
        userText: text,
        recentMemories,
        inputSource: source,
      });

      await memoryStore.saveMemory({
        role: 'aira',
        content: airaText,
      });

      socket.emit('AIRA_RESPONSE', {
        protocol: buildProtocolMeta('AIRA_RESPONSE'),
        text: airaText,
        timestamp: Date.now(),
        source,
        clientMessageId,
        fallback: false,
      });
    } catch (error) {
      const fallbackText = buildFallbackMessage(error);
      console.error('[socket] USER_INPUT failure', error);

      try {
        await memoryStore.saveMemory({
          role: 'aira',
          content: fallbackText,
        });
      } catch (saveError) {
        console.error('[socket] fallback save failure', saveError);
      }

      socket.emit('AIRA_RESPONSE', {
        protocol: buildProtocolMeta('AIRA_RESPONSE'),
        text: fallbackText,
        timestamp: Date.now(),
        source,
        clientMessageId,
        fallback: true,
      });

      socket.emit('SYSTEM_MESSAGE', {
        protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
        type: 'error',
        code: 'USER_INPUT_FAILURE',
        msg: 'Error en el flujo de memoria.',
        message: 'Aira entro en recaida temporal; se envio respuesta de contingencia.',
        request: {
          clientMessageId,
          fingerprint,
          source,
        },
      });
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] client disconnected: ${socket.id} (${reason})`);
  });
});

setInterval(() => {
  io.emit('HEARTBEAT', {
    protocol: buildProtocolMeta('HEARTBEAT'),
    timestamp: Date.now(),
  });
}, 2000);

httpServer.listen(PORT, () => {
  console.log(`Aira Socket Server listening on http://127.0.0.1:${PORT}`);
  console.log('[INFO] Conectores LLM listos: Local (1234) & Gemini (Cloud).');
  void startWakeWordEngine();
});

process.on('SIGINT', () => {
  stopWakeWordEngine();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopWakeWordEngine();
  process.exit(0);
});
