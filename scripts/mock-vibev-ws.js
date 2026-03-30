const { WebSocketServer } = require('ws');

const DEFAULT_PORT = 10001;
const SAMPLE_RATE = 24000;

function createSineWavBuffer({ durationMs = 900, frequency = 440, sampleRate = SAMPLE_RATE }) {
  const sampleCount = Math.max(1, Math.floor((sampleRate * durationMs) / 1000));
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRate * blockAlign;
  const dataSize = sampleCount * blockAlign;
  const totalSize = 44 + dataSize;

  const buffer = Buffer.alloc(totalSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(totalSize - 8, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const phase = (2 * Math.PI * frequency * index) / sampleRate;
    const sampleValue = Math.round(Math.sin(phase) * 0.25 * 32767);
    buffer.writeInt16LE(sampleValue, 44 + index * 2);
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

server.on('connection', (socket) => {
  const activeStreams = new Map();

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
    const wave = createSineWavBuffer({
      durationMs,
      frequency: 440,
      sampleRate: SAMPLE_RATE,
    });

    const chunkSize = 3200;
    let cursor = 0;
    let seq = 0;

    const intervalRef = setInterval(() => {
      if (socket.readyState !== socket.OPEN) {
        clearInterval(intervalRef);
        activeStreams.delete(requestId);
        return;
      }

      if (cursor >= wave.length) {
        clearInterval(intervalRef);
        activeStreams.delete(requestId);
        socket.send(JSON.stringify({
          type: 'done',
          requestId,
          reason: 'eos',
        }));
        return;
      }

      const chunk = wave.subarray(cursor, Math.min(cursor + chunkSize, wave.length));
      cursor += chunk.length;

      socket.send(JSON.stringify({
        type: 'audio_chunk',
        requestId,
        seq,
        mime: 'audio/wav',
        sampleRate: SAMPLE_RATE,
        chunkBase64: chunk.toString('base64'),
      }));

      seq += 1;
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
