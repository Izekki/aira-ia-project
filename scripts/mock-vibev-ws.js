const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 10001;
const SAMPLE_RATE = 24000;

/**
 * Generate raw PCM16 mono sine-wave samples (no WAV header).
 * Returns a Buffer of little-endian int16 samples.
 */
function createPcm16Buffer({ durationMs = 900, frequency = 440, sampleRate = SAMPLE_RATE }) {
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const buffer = Buffer.alloc(sampleCount * 2); // int16 = 2 bytes per sample

  for (let index = 0; index < sampleCount; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    const sampleValue = Math.round(Math.sin(phase) * 0.25 * 32767);
    buffer.writeInt16LE(sampleValue, index * 2);
  }

  return buffer;
}

function parseJson(message) {
  try {
    return JSON.parse(String(message));
  } catch {
    return null;
  }
}

const port = Number(process.env.MOCK_VIBEV_PORT || process.env.VIBEV_WS_PORT || DEFAULT_PORT);
const server = new WebSocketServer({ host: '127.0.0.1', port });

server.on('listening', () => {
  console.log(`[mock-vibev] WS mock escuchando en ws://127.0.0.1:${port}`);
});

server.on('connection', (socket, request) => {
  const activeStreams = new Map();
  
  // Extraer query params de la URL de conexión
  const url = new URL(request.url, `http://${request.headers.host}`);
  const queryParams = {
    text: url.searchParams.get('text') || '',
    voice: url.searchParams.get('voice') || '',
    cfg: url.searchParams.get('cfg') || '1.5',
    steps: url.searchParams.get('steps') || '',
  };

  // If the request carries query params (VibeVoice-style), start streaming immediately
  if (queryParams.text) {
    const requestId = 'mock-' + Date.now();
    const text = String(queryParams.text).trim();
    const durationMs = Math.max(350, Math.min(1800, text.length * 22));
    const pcm = createPcm16Buffer({
      durationMs,
      frequency: 440,
      sampleRate: SAMPLE_RATE,
    });

    const chunkSize = 3200;
    let cursor = 0;

    const intervalRef = setInterval(() => {
      if (socket.readyState !== socket.OPEN) {
        clearInterval(intervalRef);
        activeStreams.delete(requestId);
        return;
      }

      if (cursor >= pcm.length) {
        socket.send(JSON.stringify({
          type: 'log',
          event: 'backend_stream_complete',
          requestId,
        }));
        clearInterval(intervalRef);
        activeStreams.delete(requestId);
        return;
      }

      const chunk = pcm.slice(cursor, Math.min(cursor + chunkSize, pcm.length));
      socket.send(chunk);
      cursor += chunkSize;
    }, 55);

    activeStreams.set(requestId, { intervalRef });
    console.log(`[mock-vibev] Iniciando stream PCM16 para texto: "${text}" (${durationMs}ms)`);
  }

  function stopStream(requestId, reason = 'cancel') {
    const active = activeStreams.get(requestId);
    if (!active) {
      return;
    }

    clearInterval(active.intervalRef);
    activeStreams.delete(requestId);

    socket.send(JSON.stringify({
      type: 'done',
      requestId,
      reason,
    }));
  }

  socket.on('message', (rawMessage) => {
    const payload = parseJson(rawMessage);
    if (!payload) {
      return;
    }

    const eventType = String(payload?.type || '').trim().toLowerCase();
    if (eventType === 'tts_cancel') {
      const requestId = String(payload?.requestId || '').trim();
      if (requestId) {
        stopStream(requestId, String(payload?.reason || 'cancel').trim() || 'cancel');
      }
      return;
    }

    if (eventType !== 'tts_request') {
      return;
    }

    const requestId = String(payload?.requestId || '').trim();
    if (!requestId) {
      return;
    }

    if (activeStreams.has(requestId)) {
      stopStream(requestId, 'replace');
    }

    const text = String(payload?.text || '').trim();
    const durationMs = Math.max(350, Math.min(1800, text.length * 22));
    const pcm = createPcm16Buffer({
      durationMs,
      frequency: 440,
      sampleRate: SAMPLE_RATE,
    });

    const chunkSize = 3200;
    let cursor = 0;

    const intervalRef = setInterval(() => {
      if (socket.readyState !== socket.OPEN) {
        clearInterval(intervalRef);
        activeStreams.delete(requestId);
        return;
      }

      if (cursor >= pcm.length) {
        clearInterval(intervalRef);
        activeStreams.delete(requestId);
        socket.send(JSON.stringify({
          type: 'log',
          event: 'backend_stream_complete',
          requestId,
        }));
        return;
      }

      const chunk = pcm.subarray(cursor, Math.min(cursor + chunkSize, pcm.length));
      cursor += chunk.length;
      socket.send(chunk);
    }, 55);

    activeStreams.set(requestId, {
      intervalRef,
    });
  });

  socket.on('close', () => {
    for (const requestId of activeStreams.keys()) {
      stopStream(requestId, 'disconnect');
    }
  });
});
