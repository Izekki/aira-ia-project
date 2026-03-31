const WebSocket = require('ws');

const DEFAULT_VIBEV_WS_URL = 'ws://127.0.0.1:10001';
const RECONNECT_DELAY_MS = 1500; // se mantiene por compat, pero VibeVoice se conecta por-request
const REQUEST_TIMEOUT_MS = 20000;

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_CFG = 1.5;

function safeBuildProtocolMeta(buildProtocolMeta, eventType) {
  if (typeof buildProtocolMeta !== 'function') {
    return undefined;
  }
  return buildProtocolMeta(eventType);
}

function safeJsonParse(rawMessage) {
  try {
    return JSON.parse(String(rawMessage));
  } catch {
    return null;
  }
}

function normalizeWsUrl(inputWsUrl) {
  const url = String(inputWsUrl || '').trim();
  return url || DEFAULT_VIBEV_WS_URL;
}

function pickVoiceFromLang(lang, fallback = 'en-Carter_man') {
  const l = String(lang || '').toLowerCase();
  if (l.startsWith('es') || l.startsWith('sp')) return 'sp-Spk1_man';
  if (l.startsWith('ja') || l.startsWith('jp')) return 'jp-Spk0_man';
  if (l.startsWith('en')) return 'en-Carter_man';
  return fallback;
}

function pcm16ToWavBuffer(pcm16Buffer, sampleRate = DEFAULT_SAMPLE_RATE, channels = DEFAULT_CHANNELS) {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcm16Buffer.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);

  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcm16Buffer]);
}

function buildVibeVoiceStreamUrl(baseWsUrl, { text, voice, cfg, steps }) {
  const base = normalizeWsUrl(baseWsUrl);
  const url = new URL(base);

  // VibeVoice expects these query params
  url.searchParams.set('text', String(text ?? ''));
  if (voice) url.searchParams.set('voice', String(voice));
  if (cfg != null) url.searchParams.set('cfg', String(cfg));
  if (steps != null) url.searchParams.set('steps', String(steps));

  return url.toString();
}

function createVibeVoiceRealtimeBridge({ wsUrl, io, buildProtocolMeta }) {
  const baseWsUrl = normalizeWsUrl(wsUrl);

  let reconnectTimer = null;
  let isClosing = false;

  const activeRequests = new Map(); // requestId -> state
  const activeRequestBySocket = new Map(); // socketId -> requestId

  function logTelemetry(eventName, fields = {}) {
    console.log(`[tts] ${eventName}`, fields);
  }

  function emitSystemMessage(socketId, code, message) {
    const payload = {
      protocol: safeBuildProtocolMeta(buildProtocolMeta, 'SYSTEM_MESSAGE'),
      type: 'error',
      code,
      message,
    };

    if (socketId) {
      io.to(socketId).emit('SYSTEM_MESSAGE', payload);
      return;
    }
    io.emit('SYSTEM_MESSAGE', payload);
  }

  function clearRequest(requestId) {
    const requestState = activeRequests.get(requestId);
    if (!requestState) return null;

    if (requestState.timeoutRef) {
      clearTimeout(requestState.timeoutRef);
      requestState.timeoutRef = null;
    }

    if (requestState.ws) {
      try {
        requestState.ws.close();
      } catch {}
      requestState.ws = null;
    }

    activeRequests.delete(requestId);
    if (activeRequestBySocket.get(requestState.socketId) === requestId) {
      activeRequestBySocket.delete(requestState.socketId);
    }

    return requestState;
  }

  function emitDone({ requestId, reason = 'eos' }) {
    const requestState = clearRequest(requestId);
    if (!requestState) return;

    const latencyMs = Math.max(0, Date.now() - requestState.startedAt);
    io.to(requestState.socketId).emit('TTS_DONE', {
      protocol: safeBuildProtocolMeta(buildProtocolMeta, 'TTS_DONE'),
      requestId,
      reason,
    });

    logTelemetry('TTS_DONE_SENT', {
      requestId,
      reason,
      textLength: requestState.textLength,
      lang: requestState.lang,
      preset: requestState.preset,
      latencyMs,
    });
  }

  function scheduleReconnect() {
    // En VibeVoice el WS es por-request; mantenemos esto por compat (no debería ser necesario)
    if (isClosing || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
    }, RECONNECT_DELAY_MS);
  }

  function finalizeAsWav(requestState) {
    const pcm = Buffer.concat(requestState.pcmChunks);
    const wav = pcm16ToWavBuffer(pcm, requestState.sampleRate, requestState.channels);
    const chunkBase64 = wav.toString('base64');

    io.to(requestState.socketId).emit('TTS_AUDIO_CHUNK', {
      protocol: safeBuildProtocolMeta(buildProtocolMeta, 'TTS_AUDIO_CHUNK'),
      requestId: requestState.requestId,
      seq: 0,
      mime: 'audio/wav',
      sampleRate: requestState.sampleRate,
      chunkBase64,
    });
  }

  function speak({ socketId, requestId, text, lang = 'es-MX', preset = 'balanced' }) {
    const normalizedText = String(text || '').trim();
    const normalizedSocketId = String(socketId || '').trim();
    const normalizedRequestId = String(requestId || '').trim();

    if (!normalizedText || !normalizedSocketId || !normalizedRequestId) {
      return false;
    }

    const previousRequestId = activeRequestBySocket.get(normalizedSocketId);
    if (previousRequestId && previousRequestId !== normalizedRequestId) {
      stop({ socketId: normalizedSocketId, requestId: previousRequestId, reason: 'new_request' });
    }

    const voice = pickVoiceFromLang(lang);
    const cfg = DEFAULT_CFG;

    const streamUrl = buildVibeVoiceStreamUrl(baseWsUrl, {
      text: normalizedText,
      voice,
      cfg,
      steps: null,
    });

    const state = {
      requestId: normalizedRequestId,
      socketId: normalizedSocketId,
      startedAt: Date.now(),
      textLength: normalizedText.length,
      lang: String(lang || 'es-MX'),
      preset: String(preset || 'balanced'),
      firstChunkAt: 0,
      seq: 0,
      timeoutRef: null,
      ws: null,
      pcmChunks: [],
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
    };

    state.timeoutRef = setTimeout(() => {
      const current = activeRequests.get(normalizedRequestId);
      if (!current) return;
      
      console.error('[tts] TTS_TIMEOUT', {
        requestId: normalizedRequestId,
        text: normalizedText.substring(0, 50),
        elapsedMs: Date.now() - current.startedAt,
        timestamp: new Date().toISOString(),
      });
      
      emitSystemMessage(current.socketId, 'TTS_BACKEND_ERROR', 'Timeout esperando audio del backend TTS.');
      emitDone({ requestId: normalizedRequestId, reason: 'error' });
    }, REQUEST_TIMEOUT_MS);

    activeRequests.set(normalizedRequestId, state);
    activeRequestBySocket.set(normalizedSocketId, normalizedRequestId);

    logTelemetry('TTS_REQUEST_RECEIVED', {
      requestId: normalizedRequestId,
      textLength: normalizedText.length,
      lang: state.lang,
      preset: state.preset,
      voice,
      streamUrl,
    });

    const ws = new WebSocket(streamUrl);
    state.ws = ws;

    ws.on('open', () => {
      logTelemetry('VIBEV_WS_OPEN', { 
        requestId: normalizedRequestId,
        streamUrl: streamUrl.split('?')[0], // no mostrar full URL por seguridad
        timestamp: new Date().toISOString(),
      });
    });

    ws.on('message', (rawMessage) => {
      const requestState = activeRequests.get(normalizedRequestId);
      if (!requestState) return;

      // ============ LOG TEMPORAL: INSPECCIONAR QUÉ LLEGA ============
      const isBuffer = Buffer.isBuffer(rawMessage);
      let inspectionData = {
        isBuffer,
        size: isBuffer ? rawMessage.length : String(rawMessage).length,
        type: isBuffer ? 'Buffer' : 'String',
      };

      if (isBuffer) {
        // Para Buffer: mostrar primeros bytes en hex y si tiene "RIFF"
        const firstBytes = rawMessage.slice(0, 12);
        const riffCheck = firstBytes.toString('ascii', 0, 4) === 'RIFF';
        const hexPreview = firstBytes.toString('hex');
        
        inspectionData = {
          ...inspectionData,
          format: riffCheck ? 'WAV (tiene RIFF)' : 'Posible PCM/raw',
          hexPreview,
          firstBytesAscii: firstBytes.toString('ascii', 0, 4),
        };
      } else {
        // Para String: mostrar primeros 100 caracteres y si tiene data-URI
        const strMsg = String(rawMessage);
        const preview = strMsg.substring(0, 100);
        const hasDataUri = preview.includes('data:');
        const hasRiffBase64 = preview.includes('UklGR'); // RIFF en base64
        const isJsonLike = preview.trim().startsWith('{') || preview.trim().startsWith('[');
        
        inspectionData = {
          ...inspectionData,
          preview,
          hasDataUri,
          hasRiffBase64,
          isJsonLike,
        };
      }

      console.log('[INSPECT_VIBEV_MESSAGE]', {
        requestId: normalizedRequestId,
        message: inspectionData,
        timestamp: new Date().toISOString(),
      });
      // ============ FIN LOG TEMPORAL ============

      // VibeVoice sends:
      // - JSON logs as text
      // - PCM16 audio as binary bytes (sometimes with WAV header in first chunk)
      if (Buffer.isBuffer(rawMessage)) {
        // Validar y descartar WAV header si existe
        let audioData = rawMessage;
        let hadWavHeader = false;
        
        if (rawMessage.length >= 44 && rawMessage.slice(0, 4).toString('ascii') === 'RIFF') {
          audioData = rawMessage.slice(44);
          hadWavHeader = true;
          logTelemetry('PCM_VALIDATION_WAV_HEADER_DETECTED', {
            requestId: normalizedRequestId,
            receivedBytes: rawMessage.length,
            headerSize: 44,
            pcmBytes: audioData.length,
            sampleRate: requestState.sampleRate,
            seq: requestState.seq,
          });
        }
        
        requestState.pcmChunks.push(audioData);
        requestState.seq += 1;

        if (!requestState.firstChunkAt) {
          requestState.firstChunkAt = Date.now();
          logTelemetry('TTS_FIRST_CHUNK_RECEIVED', {
            requestId: normalizedRequestId,
            textLength: requestState.textLength,
            lang: requestState.lang,
            preset: requestState.preset,
            latencyMs: requestState.firstChunkAt - requestState.startedAt,
            chunkSize: audioData.length,
            hadWavHeader: hadWavHeader,
            sampleRate: requestState.sampleRate,
            timestamp: new Date().toISOString(),
          });
        } else if (requestState.seq % 5 === 0) {
          logTelemetry('PCM_STREAMING_CHUNK', {
            requestId: normalizedRequestId,
            seq: requestState.seq,
            pcmBytes: audioData.length,
            totalPcmAccumulated: requestState.pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0),
            sampleRate: requestState.sampleRate,
          });
        }
        return;
      }

      const msg = safeJsonParse(rawMessage);
      if (!msg || typeof msg !== 'object') return;

      const type = String(msg.type || '').toLowerCase();
      const event = String(msg.event || '').toLowerCase();

      if (type === 'log') {
        if (event === 'backend_busy') {
          emitSystemMessage(requestState.socketId, 'TTS_BACKEND_BUSY', 'Backend VibeVoice ocupado (solo 1 stream a la vez).');
          emitDone({ requestId: normalizedRequestId, reason: 'error' });
          return;
        }

        if (event === 'generation_error' || event === 'backend_error') {
          const details = String(msg?.data?.message || msg?.message || 'Error en motor TTS backend.').trim();
          emitSystemMessage(requestState.socketId, 'TTS_BACKEND_ERROR', details);
          emitDone({ requestId: normalizedRequestId, reason: 'error' });
          return;
        }

        if (event === 'backend_stream_complete') {
          logTelemetry('TTS_BACKEND_STREAM_COMPLETE', {
            requestId: normalizedRequestId,
            totalChunks: requestState.pcmChunks.length,
            totalSize: requestState.pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0),
            durationMs: Date.now() - requestState.startedAt,
            timestamp: new Date().toISOString(),
          });
          // finalize -> send WAV base64 -> done
          try {
            finalizeAsWav(requestState);
          } catch (e) {
            emitSystemMessage(requestState.socketId, 'TTS_BACKEND_ERROR', `Error empaquetando WAV: ${e?.message || e}`);
            emitDone({ requestId: normalizedRequestId, reason: 'error' });
            return;
          }
          emitDone({ requestId: normalizedRequestId, reason: 'eos' });
        }
      }
    });

    ws.on('error', (error) => {
      console.error('[tts] VibeVoice websocket error:', {
        requestId: normalizedRequestId,
        error: error?.message || String(error),
        timestamp: new Date().toISOString(),
      });
      emitSystemMessage(normalizedSocketId, 'TTS_BACKEND_UNAVAILABLE', 'No se pudo conectar al backend TTS (VibeVoice).');
      emitDone({ requestId: normalizedRequestId, reason: 'error' });
    });

    ws.on('close', () => {
      const requestState = activeRequests.get(normalizedRequestId);
      if (!requestState) return;
      
      logTelemetry('VIBEV_WS_CLOSE', {
        requestId: normalizedRequestId,
        hadChunks: requestState?.pcmChunks?.length > 0,
        chunkCount: requestState?.pcmChunks?.length || 0,
        timestamp: new Date().toISOString(),
      });
      
      // Si cierra sin backend_stream_complete, igual marcamos done (probable cancel o error)
      // Evitamos doble done si ya se limpió.
      scheduleReconnect();
    });

    return true;
  }

  function stop({ socketId, requestId, reason = 'cancel' } = {}) {
    const normalizedSocketId = String(socketId || '').trim();
    const normalizedRequestId = String(requestId || '').trim();

    const targetRequestId = normalizedRequestId || activeRequestBySocket.get(normalizedSocketId);
    if (!targetRequestId) {
      return false;
    }

    const requestState = activeRequests.get(targetRequestId);
    if (requestState?.ws) {
      try {
        requestState.ws.close();
      } catch {}
    }

    emitDone({ requestId: targetRequestId, reason: String(reason || 'cancel') });
    return true;
  }

  function connect() {
    // No-op: VibeVoice conecta por-request. Se mantiene por compat con el wrapper.
  }

  function close() {
    isClosing = true;

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    for (const requestId of Array.from(activeRequests.keys())) {
      emitDone({ requestId, reason: 'shutdown' });
    }
  }

  return {
    connect,
    speak,
    stop,
    close,
    getState() {
      return {
        wsUrl: baseWsUrl,
        connected: false,
        activeRequests: activeRequests.size,
      };
    },
  };
}

module.exports = {
  createVibeVoiceRealtimeBridge,
};