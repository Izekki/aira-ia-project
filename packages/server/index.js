const http = require('http');
const { Server } = require('socket.io');
const { generateAiraResponse } = require('./lib/gemini');
const { createMemoryStore } = require('./lib/supabase');
const { loadEnvFiles, resolveServerRuntimeConfig } = require('./config/runtime');
const { SERVER_VERSION, WS_PROTOCOL_VERSION, buildProtocolMeta } = require('./ws/protocol');
const { createInputDeduper } = require('./ws/userInput');
const { createUserInputHandler } = require('./ws/userInputHandler');
const { createWakeWordRuntime } = require('./wakeword/engineRuntime');

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
  });

  socket.on('USER_INPUT', onUserInput);

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
  console.log('[INFO] Voice migration prep:', runtimeConfig.voiceRuntime);
  void wakeWordRuntimeController.startListening();
});

process.on('SIGINT', () => {
  wakeWordRuntimeController.stopListening();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wakeWordRuntimeController.stopListening();
  process.exit(0);
});
