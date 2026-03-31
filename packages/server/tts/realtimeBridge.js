const WebSocket = require('ws');

const DEFAULT_VIBEV_WS_URL = 'ws://127.0.0.1:10001';
const RECONNECT_DELAY_MS = 1500; // se mantiene por compat, pero VibeVoice se conecta por-request
const REQUEST_TIMEOUT_MS = 20000;

const DEFAULT_SAMPLE_RATE = 24000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_CFG = 1.5;
const PCM_MIME = 'audio/pcm';
const PCM_FORMAT = 'pcm16';

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

    ws.on('message', (rawMessage, isBinary) => {
      const requestState = activeRequests.get(normalizedRequestId);
      if (!requestState) return;

      // VibeVoice sends:
      // - PCM16 audio as binary frames (first chunk may include a WAV header)
      // - JSON control messages as text frames (log/done)
      if (isBinary) {
        let audioData = rawMessage;

        // Detect and strip WAV (RIFF/WAVE) header from first binary chunk
        if (rawMessage.length >= 44 && rawMessage.slice(0, 4).toString('ascii') === 'RIFF') {
          audioData = rawMessage.slice(44);
          logTelemetry('PCM_WAV_HEADER_STRIPPED', {
            requestId: normalizedRequestId,
            receivedBytes: rawMessage.length,
            pcmBytes: audioData.length,
            seq: requestState.seq,
          });
        }

        if (audioData.length === 0) return;

        const seq = requestState.seq;
        requestState.seq += 1;

        if (!requestState.firstChunkAt) {
          requestState.firstChunkAt = Date.now();
          logTelemetry('TTS_FIRST_CHUNK_LATENCY', {
            requestId: normalizedRequestId,
            latencyMs: requestState.firstChunkAt - requestState.startedAt,
            chunkBytes: audioData.length,
            sampleRate: requestState.sampleRate,
            timestamp: new Date().toISOString(),
          });
        }

        // Emit PCM16 chunk immediately for real-time client playback
        io.to(requestState.socketId).emit('TTS_AUDIO_CHUNK', {
          protocol: safeBuildProtocolMeta(buildProtocolMeta, 'TTS_AUDIO_CHUNK'),
          requestId: normalizedRequestId,
          seq,
          format: PCM_FORMAT,
          mime: PCM_MIME,
          channels: requestState.channels,
          sampleRate: requestState.sampleRate,
          chunkBase64: audioData.toString('base64'),
        });
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
          logTelemetry('TTS_STREAM_COMPLETE', {
            requestId: normalizedRequestId,
            chunksSent: requestState.seq,
            durationMs: Date.now() - requestState.startedAt,
          });
          emitDone({ requestId: normalizedRequestId, reason: 'eos' });
          return;
        }
      }

      // Handle explicit done event (sent by mock or compatible backends)
      if (type === 'done') {
        const doneReason = String(msg.reason || 'eos').toLowerCase();
        logTelemetry('TTS_STREAM_DONE_EVENT', {
          requestId: normalizedRequestId,
          reason: doneReason,
          chunksSent: requestState.seq,
        });
        emitDone({ requestId: normalizedRequestId, reason: doneReason === 'eos' ? 'eos' : 'cancel' });
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
      if (!requestState) return; // Already handled (stream_complete or stop)

      logTelemetry('VIBEV_WS_CLOSE_UNEXPECTED', {
        requestId: normalizedRequestId,
        chunksSent: requestState.seq,
        timestamp: new Date().toISOString(),
      });

      // If chunks were already sent to the client, treat close as end-of-stream;
      // otherwise the WS closed before any audio arrived, which indicates an error.
      const reason = requestState.seq > 0 ? 'eos' : 'error';
      emitDone({ requestId: normalizedRequestId, reason });
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