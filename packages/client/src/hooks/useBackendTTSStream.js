import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_LANG = 'es-MX';
const DEFAULT_PRESET = 'balanced';
const DEBUG_STREAMING = false;

// ── Streaming playback tuning ──────────────────────────────────────────────
// Accumulate this many ms of PCM audio before starting WebAudio playback to
// avoid stutter caused by network jitter emptying the scheduler queue before
// enough chunks have arrived.
const PREBUFFER_MS = 300;
// When the scheduled-ahead window drops below zero (underrun), re-prime with
// this many ms of extra headroom so playback can recover gracefully.
const UNDERRUN_REPRIME_S = 0.100; // 100 ms
// Minimum offset (in seconds) added to AudioContext.currentTime when computing
// the start time of an AudioBufferSourceNode.  Keeps the schedule strictly in
// the future so the node fires immediately on the next processing quantum.
const MIN_SCHEDULE_OFFSET_S = 0.001;
// Extra ms to wait after the last scheduled audio node before tearing down the
// AudioContext and clearing the request state.
const CLEANUP_GRACE_MS = 150;

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

/**
 * Convert PCM16 little-endian bytes to Float32 samples for WebAudio.
 */
function pcm16ToFloat32(bytes) {
  const samples = Math.floor(bytes.length / 2);
  const float32 = new Float32Array(samples);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < samples; i += 1) {
    float32[i] = view.getInt16(i * 2, true) / 32768.0;
  }
  return float32;
}

export default function useBackendTTSStream({ socket }) {
  const [isAiraSpeaking, setIsAiraSpeaking] = useState(false);

  const activeRequestIdRef = useRef('');
  const requestStoreRef = useRef(new Map());
  const audioRef = useRef(null);
  const objectUrlRef = useRef('');

  // WebAudio streaming refs
  const audioCtxRef = useRef(null);
  const nextPlayTimeRef = useRef(0);
  const streamingRequestIdRef = useRef('');

  // Adaptive-jitter / prebuffer refs
  const prebufferReadyRef = useRef(false);          // true once enough audio has accumulated
  const pendingChunksRef = useRef([]);               // [{float32, sampleRate}] held before prebuffer is ready
  const pendingChunksMsRef = useRef(0);             // total ms in pendingChunksRef
  const underrunCountRef = useRef(0);               // cumulative underrun events for telemetry

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

  const stopStreamingPlayback = useCallback(() => {
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // ignore close errors
      }
      audioCtxRef.current = null;
    }
    nextPlayTimeRef.current = 0;
    streamingRequestIdRef.current = '';
    prebufferReadyRef.current = false;
    pendingChunksRef.current = [];
    pendingChunksMsRef.current = 0;
    underrunCountRef.current = 0;
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

  /**
   * Queue a PCM16 chunk for real-time WebAudio playback.
   *
   * Strategy:
   *  1. Accumulate chunks in a pending queue until PREBUFFER_MS of audio has
   *     arrived.  This ensures the WebAudio scheduler always has audio ready
   *     to play when the first source node fires, eliminating the initial stutter
   *     caused by a too-small jitter buffer.
   *  2. After the prebuffer is ready, schedule each chunk back-to-back.  If the
   *     scheduler falls behind (underrun: nextPlayTime < currentTime), re-prime
   *     the schedule with UNDERRUN_REPRIME_S of headroom to recover cleanly.
   *  3. Debug telemetry (prebufferedMs, scheduledAheadMs, underrunCount) is
   *     emitted to console.debug when DEBUG_STREAMING is true.
   *
   * Returns true if the chunk was scheduled; false falls back to buffer+play mode.
   */
  const queueRealtimeChunk = useCallback(({ requestId, chunk, mime, sampleRate }) => {
    // Only handle pcm16 / audio/pcm format
    const fmt = String(mime || '').toLowerCase();
    if (fmt !== 'audio/pcm' && !fmt.includes('pcm16')) {
      return false;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return false;
    }

    if (!chunk || chunk.length < 2) {
      return false;
    }

    try {
      const effectiveSampleRate = sampleRate || 24000;

      // Create (or re-create) AudioContext on the first chunk of each request
      if (!audioCtxRef.current || streamingRequestIdRef.current !== requestId) {
        stopStreamingPlayback();
        audioCtxRef.current = new AudioContextClass({ sampleRate: effectiveSampleRate });
        streamingRequestIdRef.current = requestId;
        // nextPlayTimeRef will be set when the prebuffer flushes
        if (DEBUG_STREAMING) {
          console.debug('[useBackendTTSStream] Streaming started', { requestId, effectiveSampleRate });
        }
      }

      const ctx = audioCtxRef.current;

      // Resume if browser suspended due to autoplay policy
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }

      const float32 = pcm16ToFloat32(chunk);
      if (float32.length === 0) {
        return false;
      }

      const chunkDurationMs = (float32.length / effectiveSampleRate) * 1000;

      // ── Phase 1: prebuffer accumulation ────────────────────────────────
      if (!prebufferReadyRef.current) {
        pendingChunksRef.current.push({ float32, sampleRate: effectiveSampleRate });
        pendingChunksMsRef.current += chunkDurationMs;

        if (DEBUG_STREAMING) {
          console.debug('[useBackendTTSStream] PREBUFFER_ACCUMULATE', {
            requestId,
            pendingMs: Math.round(pendingChunksMsRef.current),
            targetMs: PREBUFFER_MS,
          });
        }

        if (pendingChunksMsRef.current < PREBUFFER_MS) {
          // Still accumulating – do not schedule yet
          return true;
        }

        // Prebuffer satisfied: mark ready and flush all pending chunks
        prebufferReadyRef.current = true;
        // Start scheduling a small offset ahead of currentTime so the first
        // source node fires on the next quantum rather than in the past.
        nextPlayTimeRef.current = ctx.currentTime + MIN_SCHEDULE_OFFSET_S;

        if (DEBUG_STREAMING) {
          console.debug('[useBackendTTSStream] PREBUFFER_FLUSH', {
            requestId,
            chunks: pendingChunksRef.current.length,
            prebufferedMs: Math.round(pendingChunksMsRef.current),
          });
        }

        for (const pending of pendingChunksRef.current) {
          const buf = ctx.createBuffer(1, pending.float32.length, pending.sampleRate);
          buf.copyToChannel(pending.float32, 0);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          const st = Math.max(ctx.currentTime + MIN_SCHEDULE_OFFSET_S, nextPlayTimeRef.current);
          src.start(st);
          nextPlayTimeRef.current = st + buf.duration;
        }

        pendingChunksRef.current = [];
        pendingChunksMsRef.current = 0;

        if (DEBUG_STREAMING) {
          console.debug('[useBackendTTSStream] PREBUFFER_READY', {
            requestId,
            scheduledAheadMs: Math.round((nextPlayTimeRef.current - ctx.currentTime) * 1000),
          });
        }

        return true;
      }

      // ── Phase 2: live scheduling with underrun detection ───────────────
      const scheduledAheadS = nextPlayTimeRef.current - ctx.currentTime;

      if (scheduledAheadS < 0) {
        // Underrun: the scheduler fell behind real time (network jitter or tab
        // throttling).  Re-prime with UNDERRUN_REPRIME_S of headroom so playback
        // resumes without a prolonged gap.
        underrunCountRef.current += 1;
        nextPlayTimeRef.current = ctx.currentTime + UNDERRUN_REPRIME_S;

        if (DEBUG_STREAMING) {
          console.debug('[useBackendTTSStream] UNDERRUN', {
            requestId,
            underrunCount: underrunCountRef.current,
            gapMs: Math.round(-scheduledAheadS * 1000),
            reprimedMs: Math.round(UNDERRUN_REPRIME_S * 1000),
          });
        }
      }

      const audioBuffer = ctx.createBuffer(1, float32.length, effectiveSampleRate);
      audioBuffer.copyToChannel(float32, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const startTime = Math.max(ctx.currentTime + MIN_SCHEDULE_OFFSET_S, nextPlayTimeRef.current);
      source.start(startTime);
      nextPlayTimeRef.current = startTime + audioBuffer.duration;

      if (DEBUG_STREAMING) {
        console.debug('[useBackendTTSStream] CHUNK_SCHEDULED', {
          requestId,
          chunkMs: Math.round(chunkDurationMs),
          scheduledAheadMs: Math.round((nextPlayTimeRef.current - ctx.currentTime) * 1000),
          underrunCount: underrunCountRef.current,
        });
      }

      return true;
    } catch (err) {
      console.error('[useBackendTTSStream] WebAudio scheduling error, falling back to buffer', {
        requestId,
        error: String(err),
      });
      stopStreamingPlayback();
      return false;
    }
  }, [stopStreamingPlayback]);

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
    stopStreamingPlayback();

    if (requestId) {
      clearRequest(requestId);
    } else {
      requestStoreRef.current.clear();
      activeRequestIdRef.current = '';
    }

    setIsAiraSpeaking(false);
  }, [clearRequest, socket, stopPlayback, stopStreamingPlayback]);

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
        stopStreamingPlayback();
        setIsAiraSpeaking(false);
        return;
      }

      // When PCM16 chunks were streamed via WebAudio, requestState.chunks is
      // empty (chunks went directly to the scheduler).  In that case schedule
      // the cleanup to fire after the last queued audio node finishes playing
      // so that isAiraSpeaking stays true until the voice actually goes silent.
      if (
        streamingRequestIdRef.current === requestId &&
        audioCtxRef.current &&
        requestState?.chunks?.length === 0
      ) {
        const ctx = audioCtxRef.current;
        const remainingS = Math.max(0, nextPlayTimeRef.current - ctx.currentTime);
        const delayMs = Math.round(remainingS * 1000) + CLEANUP_GRACE_MS;

        if (DEBUG_STREAMING) {
          console.debug('[useBackendTTSStream] WAIT_FOR_WEBAUDIO', {
            requestId,
            remainingMs: Math.round(remainingS * 1000),
            delayMs,
          });
        }

        setTimeout(() => {
          stopStreamingPlayback();
          clearRequest(requestId);
          setIsAiraSpeaking(false);
        }, delayMs);
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
  }, [cancel, clearRequest, playBufferedRequest, queueRealtimeChunk, socket, stopPlayback, stopStreamingPlayback]);

  useEffect(() => {
    return () => {
      stopPlayback();
      stopStreamingPlayback();
      requestStoreRef.current.clear();
      activeRequestIdRef.current = '';
    };
  }, [stopPlayback, stopStreamingPlayback]);

  return {
    speak,
    cancel,
    isAiraSpeaking,
    activeRequestId: activeRequestIdRef.current,
  };
}
