import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_LANG = 'es-MX';
const DEFAULT_PRESET = 'balanced';

function createRequestId() {
  const randomChunk = Math.random().toString(36).slice(2, 8);
  return `tts-${Date.now()}-${randomChunk}`;
}

function decodeBase64Chunk(chunkBase64) {
  const normalizedChunk = String(chunkBase64 || '').trim();
  if (!normalizedChunk) {
    return null;
  }

  const payload = normalizedChunk.replace(/^data:[^;]+;base64,/i, '');
  try {
    const binary = window.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

export default function useBackendTTSStream({ socket }) {
  const [isAiraSpeaking, setIsAiraSpeaking] = useState(false);

  const activeRequestIdRef = useRef('');
  const requestStoreRef = useRef(new Map());
  const audioRef = useRef(null);
  const objectUrlRef = useRef('');

  const stopPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
      audioRef.current = null;
    }

    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = '';
    }
  }, []);

  const clearRequest = useCallback((requestId) => {
    if (!requestId) {
      return;
    }

    requestStoreRef.current.delete(requestId);
    if (activeRequestIdRef.current === requestId) {
      activeRequestIdRef.current = '';
    }
  }, []);

  const playBufferedRequest = useCallback((requestId) => {
    const state = requestStoreRef.current.get(requestId);
    if (!state || state.chunks.length === 0) {
      clearRequest(requestId);
      setIsAiraSpeaking(false);
      return;
    }

    stopPlayback();

    const totalBytes = state.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const sampleCount = totalBytes / 2;
    const sampleRate = state.sampleRate || 24000;
    const bufferedMs = (sampleCount / sampleRate) * 1000;

    console.log('[useBackendTTSStream.playBufferedRequest] BUFFER_STATS', {
      requestId,
      totalBytes,
      chunkCount: state.chunks.length,
      sampleRate,
      bufferedMs: Math.round(bufferedMs),
      mime: state.mime,
      timestamp: new Date().toISOString(),
    });

    const audioBlob = new Blob(state.chunks, {
      type: state.mime || 'audio/wav',
    });
    const objectUrl = URL.createObjectURL(audioBlob);
    objectUrlRef.current = objectUrl;

    const audio = new Audio(objectUrl);
    audioRef.current = audio;

    audio.onended = () => {
      console.log('[useBackendTTSStream] Playback ended', { requestId, timestamp: new Date().toISOString() });
      stopPlayback();
      clearRequest(requestId);
      setIsAiraSpeaking(false);
    };

    audio.onerror = () => {
      console.error('[useBackendTTSStream] Playback error', { requestId, timestamp: new Date().toISOString() });
      stopPlayback();
      clearRequest(requestId);
      setIsAiraSpeaking(false);
    };

    void audio.play().catch((err) => {
      console.error('[useBackendTTSStream] Play failed', { requestId, error: String(err), timestamp: new Date().toISOString() });
      stopPlayback();
      clearRequest(requestId);
      setIsAiraSpeaking(false);
    });
  }, [clearRequest, stopPlayback]);

  // Preparado para Paso B: cuando se confirme el formato final del backend,
  // esta función es el punto de extensión para cola de reproducción WebAudio.
  const queueRealtimeChunk = useCallback(() => {
    return false;
  }, []);

  const cancel = useCallback((options = {}) => {
    const requestId = String(options.requestId || activeRequestIdRef.current || '').trim();
    const reason = String(options.reason || 'user').trim() || 'user';
    const notifyServer = options.notifyServer !== false;

    if (notifyServer && socket && requestId) {
      socket.emit('TTS_CANCEL', {
        requestId,
        reason,
      });
    }

    stopPlayback();

    if (requestId) {
      clearRequest(requestId);
    } else {
      requestStoreRef.current.clear();
      activeRequestIdRef.current = '';
    }

    setIsAiraSpeaking(false);
  }, [clearRequest, socket, stopPlayback]);

  const speak = useCallback((text, options = {}) => {
    const normalizedText = String(text || '').trim();
    if (!normalizedText || !socket) {
      return false;
    }

    const requestId = String(options.requestId || createRequestId()).trim();
    if (!requestId) {
      return false;
    }

    if (activeRequestIdRef.current) {
      cancel({
        requestId: activeRequestIdRef.current,
        reason: 'new_request',
      });
    }

    requestStoreRef.current.set(requestId, {
      chunks: [],
      mime: 'audio/wav',
      sampleRate: 24000,
      startedAt: Date.now(),
      firstChunkAt: 0,
    });
    activeRequestIdRef.current = requestId;
    setIsAiraSpeaking(true);

    socket.emit('TTS_REQUEST', {
      requestId,
      text: normalizedText,
      lang: String(options.lang || DEFAULT_LANG),
      preset: String(options.preset || DEFAULT_PRESET),
      metadata: options.metadata || {},
    });

    return true;
  }, [cancel, socket]);

  useEffect(() => {
    if (!socket) {
      return undefined;
    }

    function onAudioChunk(payload = {}) {
      const requestId = String(payload?.requestId || '').trim();
      if (!requestId) {
        return;
      }

      const chunk = decodeBase64Chunk(payload?.chunkBase64);
      if (!chunk) {
        console.warn('[useBackendTTSStream.onAudioChunk] Failed to decode chunk', { requestId });
        return;
      }

      let requestState = requestStoreRef.current.get(requestId);
      if (!requestState) {
        requestState = {
          chunks: [],
          mime: 'audio/wav',
          sampleRate: 24000,
          startedAt: Date.now(),
          firstChunkAt: 0,
          chunkCount: 0,
          totalDecodedBytes: 0,
        };
        requestStoreRef.current.set(requestId, requestState);
      }

      requestState.chunkCount += 1;
      requestState.totalDecodedBytes += chunk.length;

      if (!requestState.firstChunkAt) {
        requestState.firstChunkAt = Date.now();
        console.log('[useBackendTTSStream.onAudioChunk] FIRST_CHUNK', {
          requestId,
          latencyMs: requestState.firstChunkAt - requestState.startedAt,
          chunkByteLength: chunk.length,
          format: String(payload?.mime || 'audio/wav'),
          sampleRate: Number(payload?.sampleRate || 24000),
          seq: Number(payload?.seq || 0),
          timestamp: new Date().toISOString(),
        });
      } else if (requestState.chunkCount % 5 === 0) {
        console.log('[useBackendTTSStream.onAudioChunk] PCM_CHUNK', {
          requestId,
          chunkCount: requestState.chunkCount,
          currentChunkBytes: chunk.length,
          totalDecodedBytes: requestState.totalDecodedBytes,
          format: String(payload?.mime || 'audio/wav'),
          sampleRate: Number(payload?.sampleRate || 24000),
          seq: Number(payload?.seq || 0),
          timestamp: new Date().toISOString(),
        });
      }

      requestState.mime = String(payload?.mime || requestState.mime || 'audio/wav');
      requestState.sampleRate = Number.isFinite(Number(payload?.sampleRate))
        ? Number(payload.sampleRate)
        : requestState.sampleRate;

      const streamed = queueRealtimeChunk({
        requestId,
        chunk,
        mime: requestState.mime,
        sampleRate: requestState.sampleRate,
      });

      if (!streamed) {
        requestState.chunks.push(chunk);
      }
    }

    function onTtsDone(payload = {}) {
      const requestId = String(payload?.requestId || activeRequestIdRef.current || '').trim();
      if (!requestId) {
        console.warn('[useBackendTTSStream.onTtsDone] No requestId');
        return;
      }

      const reason = String(payload?.reason || 'eos').trim().toLowerCase() || 'eos';
      const requestState = requestStoreRef.current.get(requestId);
      
      console.log('[useBackendTTSStream.onTtsDone]', {
        requestId,
        reason,
        totalChunks: requestState?.chunks?.length || 0,
        totalSize: requestState?.chunks?.reduce((sum, chunk) => sum + chunk.length, 0) || 0,
        durationMs: requestState ? Date.now() - requestState.startedAt : -1,
        timestamp: new Date().toISOString(),
      });
      
      if (reason !== 'eos') {
        clearRequest(requestId);
        stopPlayback();
        setIsAiraSpeaking(false);
        return;
      }

      playBufferedRequest(requestId);
    }

    function onStopTts() {
      cancel({
        reason: 'interrupt',
        notifyServer: false,
      });
    }

    function onSocketDisconnect() {
      cancel({
        reason: 'disconnect',
        notifyServer: false,
      });
    }

    socket.on('TTS_AUDIO_CHUNK', onAudioChunk);
    socket.on('TTS_DONE', onTtsDone);
    socket.on('STOP_TTS', onStopTts);
    socket.on('disconnect', onSocketDisconnect);

    return () => {
      socket.off('TTS_AUDIO_CHUNK', onAudioChunk);
      socket.off('TTS_DONE', onTtsDone);
      socket.off('STOP_TTS', onStopTts);
      socket.off('disconnect', onSocketDisconnect);
    };
  }, [cancel, clearRequest, playBufferedRequest, queueRealtimeChunk, socket, stopPlayback]);

  useEffect(() => {
    return () => {
      stopPlayback();
      requestStoreRef.current.clear();
      activeRequestIdRef.current = '';
    };
  }, [stopPlayback]);

  return {
    speak,
    cancel,
    isAiraSpeaking,
    activeRequestId: activeRequestIdRef.current,
  };
}
