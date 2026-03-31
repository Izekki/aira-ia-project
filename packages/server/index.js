const http = require('http');
const { Server } = require('socket.io');
const { generateAiraResponse } = require('./lib/gemini');
const { createMemoryStore } = require('./lib/supabase');
const { loadEnvFiles, resolveServerRuntimeConfig } = require('./config/runtime');
const { SERVER_VERSION, WS_PROTOCOL_VERSION, buildProtocolMeta } = require('./ws/protocol');
const { createInputDeduper } = require('./ws/userInput');
const { createUserInputHandler } = require('./ws/userInputHandler');
const { createWakeWordRuntime } = require('./wakeword/engineRuntime');
const { createTtsProvider } = require('./tts');

loadEnvFiles();

const runtimeConfig = resolveServerRuntimeConfig();
const PORT = runtimeConfig.port;
const voiceServerConfig = runtimeConfig.voiceServerConfig || {};

let WakeWordService = null;
try {
  WakeWordService = require('./recorder/wakeWordService');
} catch (error) {
  console.error('[wake-word] No se pudo cargar WakeWordService:', error?.message || error);
}

const memoryStore = createMemoryStore({
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
});

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

const wakeWordRuntimeController = createWakeWordRuntime({
  WakeWordService,
  io,
  buildProtocolMeta,
  voiceServerConfig,
});

const inputDeduper = createInputDeduper();
const ttsProvider = createTtsProvider({
  io,
  buildProtocolMeta,
  voiceRuntime: runtimeConfig.voiceRuntime,
});

if (runtimeConfig.voiceRuntime.ttsMode === 'backend') {
  ttsProvider.connect();
  console.log('[tts] Backend mode enabled', {
    provider: runtimeConfig.voiceRuntime.ttsProvider,
    vibevWsUrl: runtimeConfig.voiceRuntime.vibevWsUrl,
  });
}

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);

  socket.emit('SERVER_READY', {
    protocol: buildProtocolMeta('SERVER_READY'),
    timestamp: Date.now(),
    version: SERVER_VERSION,
    wsVersion: WS_PROTOCOL_VERSION,
    wakeWord: wakeWordRuntimeController.getRuntime(),
    voiceRuntime: runtimeConfig.voiceRuntime,
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

  const onUserInput = createUserInputHandler({
    socket,
    io,
    memoryStore,
    generateAiraResponse,
    deduper: inputDeduper,
    buildProtocolMeta,
    onInterruptActiveTts: ({ socketId }) => {
      ttsProvider.stop({
        socketId,
        reason: 'interrupt',
      });
    },
  });

  socket.on('USER_INPUT', onUserInput);

  socket.on('TTS_REQUEST', (payload = {}) => {
    const text = String(payload?.text || '').trim();
    if (!text) {
      return;
    }

    const requestId = String(payload?.requestId || `tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).trim();
    const lang = String(payload?.lang || 'es-MX').trim() || 'es-MX';
    const preset = String(payload?.preset || 'balanced').trim() || 'balanced';

    console.log('[socket.TTS_REQUEST]', {
      socketId: socket.id,
      requestId,
      textLength: text.length,
      text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
      lang,
      preset,
      timestamp: new Date().toISOString(),
    });

    const sent = ttsProvider.speak({
      socketId: socket.id,
      requestId,
      text,
      lang,
      preset,
    });

    if (!sent) {
      socket.emit('SYSTEM_MESSAGE', {
        protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
        type: 'error',
        code: 'TTS_BACKEND_UNAVAILABLE',
        message: 'No se pudo procesar TTS en backend para esta solicitud.',
        requestId,
      });
    }
  });

  socket.on('TTS_CANCEL', (payload = {}) => {
    const requestId = String(payload?.requestId || '').trim();
    const reason = String(payload?.reason || 'cancel').trim() || 'cancel';
    
    console.log('[socket.TTS_CANCEL]', {
      socketId: socket.id,
      requestId,
      reason,
      timestamp: new Date().toISOString(),
    });
    
    ttsProvider.stop({
      socketId: socket.id,
      requestId,
      reason,
    });
  });

  socket.on('disconnect', (reason) => {
    ttsProvider.stop({
      socketId: socket.id,
      reason: 'disconnect',
    });
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
  console.log('[INFO] Voice migration prep:', runtimeConfig.voiceRuntime);
  void wakeWordRuntimeController.startListening();
});

process.on('SIGINT', () => {
  wakeWordRuntimeController.stopListening();
  ttsProvider.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wakeWordRuntimeController.stopListening();
  ttsProvider.close();
  process.exit(0);
});
