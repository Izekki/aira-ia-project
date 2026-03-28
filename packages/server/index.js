const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const { generateAiraResponse } = require('./lib/gemini');
const { createMemoryStore } = require('./lib/supabase');

dotenv.config({ path: path.join(__dirname, '.env') });

const PORT = Number(process.env.PORT || 4000);

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
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

let globalLastInputFingerprint = '';
let globalLastInputClientTimestamp = 0;
let globalLastInputReceivedAt = 0;

io.on('connection', (socket) => {
  console.log(`[socket] client connected: ${socket.id}`);

  socket.emit('SERVER_READY', {
    timestamp: Date.now(),
    version: '0.1.0',
  });

  socket.emit('SYSTEM_MESSAGE', {
    message: 'Canal de eventos inicializado correctamente.',
  });

  socket.on('CLIENT_PING', (payload) => {
    console.log('[socket] CLIENT_PING', payload);

    socket.emit('SYSTEM_MESSAGE', {
      message: `Ping recibido a las ${new Date().toLocaleTimeString()}`,
    });
  });

  socket.on('USER_INPUT', (payload) => {
    const text = String(payload?.text || '').trim();
    if (!text) {
      return;
    }

    const source = String(payload?.source || 'unknown');
    const clientTimestamp = Number(payload?.timestamp || 0);
    const fingerprint = `${source}:${text.toLowerCase()}`;
    const now = Date.now();

    const duplicatedByFingerprint =
      fingerprint === globalLastInputFingerprint &&
      now - globalLastInputReceivedAt <= 2500;

    const duplicatedByTimestamp =
      clientTimestamp > 0 &&
      clientTimestamp === globalLastInputClientTimestamp &&
      now - globalLastInputReceivedAt <= 10000;

    if (duplicatedByFingerprint || duplicatedByTimestamp) {
      console.log('[socket] USER_INPUT skipped duplicate', {
        text,
        source,
      });
      return;
    }

    globalLastInputFingerprint = fingerprint;
    globalLastInputClientTimestamp = clientTimestamp;
    globalLastInputReceivedAt = now;

    (async () => {
      try {
        console.log('[socket] USER_INPUT', { text, source });

        await memoryStore.saveMemory({
          role: 'user',
          content: text,
        });

        const recentMemories = await memoryStore.getRecentMemories(14);

        const airaText = await generateAiraResponse({
          userText: text,
          recentMemories,
        });

        await memoryStore.saveMemory({
          role: 'aira',
          content: airaText,
        });

        socket.emit('AIRA_RESPONSE', {
          text: airaText,
          timestamp: Date.now(),
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
          text: fallbackText,
          timestamp: Date.now(),
          fallback: true,
        });

        socket.emit('SYSTEM_MESSAGE', {
          message: 'Aira entro en recaida temporal; se envio respuesta de contingencia.',
        });
      }
    })();
  });

  socket.on('disconnect', (reason) => {
    console.log(`[socket] client disconnected: ${socket.id} (${reason})`);
  });
});

setInterval(() => {
  io.emit('HEARTBEAT', {
    timestamp: Date.now(),
  });
}, 2000);

httpServer.listen(PORT, () => {
  console.log(`Aira Socket Server listening on http://127.0.0.1:${PORT}`);
  console.log('[INFO] Conectores LLM listos: Local (1234) & Gemini (Cloud).');
});
