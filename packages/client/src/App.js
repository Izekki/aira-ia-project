import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import useSpeech from './hooks/useSpeech';
import useTTS from './hooks/useTTS';
import Visualizer from './components/Visualizer';
import WakeActivationOverlay from './components/WakeActivationOverlay';
import { normalizeSpeechKey } from './lib/textNormalization';
import { buildInterruptPayload, buildUserInputPayload } from './lib/wsProtocol';
import { FALLBACK_SOCKET_SERVER_URL, resolveVoiceClientConfig } from './lib/voiceClientConfig';

const VOICE_ENGINE_MISSING_MESSAGE =
  'Motor de voz no disponible. Verifica que VibeVoice este corriendo en el puerto 3000.';
const VISUALIZER_STATE = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  SPEAKING: 'SPEAKING',
};

const DEFAULT_SPEECH_PROFILE = 'stable';
const DUPLICATE_EMIT_WINDOW_MS = 7000;
const VOICE_CONFIG_RELOAD_INTERVAL_MS = 2000;
const WAKEWORD_BOOTSTRAP_DELAY_MS = 260;

function resolveSpeechProfile() {
  const runtimeProfile =
    typeof window !== 'undefined'
      ? window.localStorage?.getItem('AIRA_SPEECH_PROFILE')
      : '';

  return String(runtimeProfile || DEFAULT_SPEECH_PROFILE).toLowerCase() === 'aggressive'
    ? 'aggressive'
    : DEFAULT_SPEECH_PROFILE;
}


export default function App() {
  const socketRef = useRef(null);
  const chatBottomRef = useRef(null);
  const [activeSocket, setActiveSocket] = useState(null);
  const speechProfile = resolveSpeechProfile();
  const [voiceClientConfig, setVoiceClientConfig] = useState(() => resolveVoiceClientConfig());
  const wakeWords = voiceClientConfig.wakeWords;
  const wakeAutoStopAfterFinalMs = voiceClientConfig.wakeAutoStopAfterFinalMs;
  const wakeMaxSessionMs = voiceClientConfig.wakeMaxSessionMs;
  const sttMode = voiceClientConfig.sttMode;
  const ttsMode = voiceClientConfig.ttsMode;
  const ttsProvider = voiceClientConfig.ttsProvider;
  const browserFallbackEnabled = voiceClientConfig.browserFallbackEnabled;
  const backendStreamingEnabled = voiceClientConfig.backendStreamingEnabled;
  const vibevWsUrl = voiceClientConfig.vibevWsUrl;
  const serverWakeWordThreshold = voiceClientConfig.serverWakeWordThreshold;
  const socketServerUrl = voiceClientConfig.socketUrl || FALLBACK_SOCKET_SERVER_URL;
  const wakeWordsRef = useRef(wakeWords);
  const wakeAutoStopAfterFinalMsRef = useRef(wakeAutoStopAfterFinalMs);
  const wakeMaxSessionMsRef = useRef(wakeMaxSessionMs);
  const isWakeConfirmedRef = useRef(false);
  const activePttKeyRef = useRef('');
  const processingCountRef = useRef(0);
  const isAiraSpeakingRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [serverTime, setServerTime] = useState('---');
  const [messages, setMessages] = useState([]);
  const [visualizerState, setVisualizerState] = useState(VISUALIZER_STATE.IDLE);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const lastProcessedFinalIdRef = useRef(null);
  const lastEmittedSpeechTextRef = useRef('');
  const lastEmittedSpeechAtRef = useRef(0);
  const processingTimeoutRef = useRef(null);

  const [isWakeConfirmed, setIsWakeConfirmed] = useState(false);
  const [isSpeechBootReady, setIsSpeechBootReady] = useState(false);
  const [lastWakeWord, setLastWakeWord] = useState('');
  const [isPttPressed, setIsPttPressed] = useState(false);
  const [wakeRuntime, setWakeRuntime] = useState(() => ({
    mode: 'server/openWakeWord',
    active: false,
    error: '',
    wakeWordLabel: 'AIRA (Custom)',
    modelName: 'aira.onnx',
    threshold: serverWakeWordThreshold,
  }));

  const { speak, cancel, isAiraSpeaking } = useTTS({
    mode: ttsMode,
    socket: activeSocket,
  });
  const speakRef = useRef(speak);
  const cancelRef = useRef(cancel);

  const {
    isSupported,
    isListening,
    interimTranscript,
    finalResult,
    error,
    isPttProcessingBridge,
    startPTT,
    stopPTT,
  } =
    useSpeech({
      enabled: isWakeConfirmed && isSpeechBootReady,
      profile: speechProfile,
      wakeAutoStopAfterFinalMs,
      wakeMaxSessionMs,
    });

  const wakeWordModeLabel = wakeRuntime.mode || 'server/openWakeWord';
  const wakeThresholdForUi = Number.isFinite(Number(wakeRuntime.threshold))
    ? Number(wakeRuntime.threshold)
    : serverWakeWordThreshold;
  const wakeError = String(wakeRuntime.error || '').trim();
  const isWakeListening =
    isWakeConfirmed &&
    isSpeechBootReady &&
    wakeRuntime.active &&
    !isListening &&
    !isProcessing &&
    !isPttProcessingBridge &&
    !isAiraSpeaking;

  function emitVoiceInput(rawText, source = 'ptt') {
    const normalizedSpeechText = String(rawText || '').trim();
    if (!normalizedSpeechText) {
      return false;
    }

    const normalizedSpeechKey = normalizeSpeechKey(normalizedSpeechText);
    const now = Date.now();
    const isDuplicatedSpeech =
      normalizedSpeechKey === lastEmittedSpeechTextRef.current &&
      now - lastEmittedSpeechAtRef.current <= DUPLICATE_EMIT_WINDOW_MS;

    if (isDuplicatedSpeech) {
      return false;
    }

    setMessages((prev) => [...prev, `Tu: ${normalizedSpeechText}`]);
    lastEmittedSpeechTextRef.current = normalizedSpeechKey;
    lastEmittedSpeechAtRef.current = now;

    if (!isConnected) {
      return true;
    }

    increaseProcessing();
    socketRef.current?.emit(
      'USER_INPUT',
      buildUserInputPayload({
        content: normalizedSpeechText,
        source,
        interruptActiveTts: isAiraSpeakingRef.current,
        timestamp: now,
        fingerprint: `${source}:${normalizedSpeechKey}`,
      })
    );

    return true;
  }

  function handleServerWakeWordDetected(payload = {}) {
    function startWakePtt() {
      setIsPttPressed(true);
      const started = startPTT({
        autoStopOnFinal: true,
        autoStopAfterFinalMs: wakeAutoStopAfterFinalMsRef.current,
        maxSessionMs: wakeMaxSessionMsRef.current,
      });
      if (!started) {
        setIsPttPressed(false);
        setMessages((prev) => {
          const nextMessage = 'Wake word detectada, pero no se pudo iniciar PTT. Revisa permisos de microfono del navegador.';
          if (prev[prev.length - 1] === nextMessage) {
            return prev;
          }
          return [...prev, nextMessage];
        });
        return false;
      }

      return true;
    }

    if (isAiraSpeakingRef.current) {
      cancelRef.current();
    }

    const resolvedWakeWord = String(payload?.wakeWord || wakeWordsRef.current[0] || 'hey aira').trim();
    setLastWakeWord(resolvedWakeWord);
    setMessages((prev) => {
      const confidence = Number(payload?.confidence);
      const confidenceText = Number.isFinite(confidence) ? ` (confianza ${confidence.toFixed(2)})` : '';
      const nextMessage = `Wake word detectada: ${resolvedWakeWord}${confidenceText}`;
      if (prev[prev.length - 1] === nextMessage) {
        return prev;
      }
      return [...prev, nextMessage];
    });

    if (!isWakeConfirmedRef.current) {
      setIsWakeConfirmed(true);
      setMessages((prev) => {
        const nextMessage = 'Wake word detectada. Inicializando canal de voz para auto-PTT...';
        if (prev[prev.length - 1] === nextMessage) {
          return prev;
        }
        return [...prev, nextMessage];
      });
      setTimeout(() => {
        startWakePtt();
      }, WAKEWORD_BOOTSTRAP_DELAY_MS);
      return;
    }

    startWakePtt();
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return undefined;
    }

    let disposed = false;
    let lastScriptText = '';

    function applyResolvedConfig() {
      if (disposed) {
        return;
      }

      const nextConfig = resolveVoiceClientConfig();
      setVoiceClientConfig((prev) => {
        const sameWakeWords =
          prev.wakeWords.length === nextConfig.wakeWords.length &&
          prev.wakeWords.every((word, index) => word === nextConfig.wakeWords[index]);
        const sameThreshold = prev.wakeWordThreshold === nextConfig.wakeWordThreshold;
        const sameLanguage = prev.wakeWordLanguage === nextConfig.wakeWordLanguage;
        const sameCooldown = prev.wakeWordCooldownMs === nextConfig.wakeWordCooldownMs;
        const sameServerThreshold =
          prev.serverWakeWordThreshold === nextConfig.serverWakeWordThreshold;
        const sameSocketUrl = prev.socketUrl === nextConfig.socketUrl;
        const sameSttMode = prev.sttMode === nextConfig.sttMode;
        const sameTtsMode = prev.ttsMode === nextConfig.ttsMode;
        const sameTtsProvider = prev.ttsProvider === nextConfig.ttsProvider;
        const sameFallback = prev.browserFallbackEnabled === nextConfig.browserFallbackEnabled;
        const sameBackendStreaming = prev.backendStreamingEnabled === nextConfig.backendStreamingEnabled;
        const sameVibevWsUrl = prev.vibevWsUrl === nextConfig.vibevWsUrl;

        if (
          sameWakeWords &&
          sameThreshold &&
          sameLanguage &&
          sameCooldown &&
          sameServerThreshold &&
          sameSocketUrl &&
          sameSttMode &&
          sameTtsMode &&
          sameTtsProvider &&
          sameFallback &&
          sameBackendStreaming &&
          sameVibevWsUrl
        ) {
          return prev;
        }

        return nextConfig;
      });
    }

    async function refreshVoiceConfigFromInject() {
      try {
        const response = await fetch(
          `/voice-detection-config-inject.js?ts=${Date.now()}`,
          { cache: 'no-store' }
        );
        if (!response.ok) {
          return;
        }

        const scriptText = await response.text();
        if (!scriptText || scriptText === lastScriptText) {
          applyResolvedConfig();
          return;
        }

        lastScriptText = scriptText;
        const executeScript = new Function(scriptText);
        executeScript();
        applyResolvedConfig();
      } catch {
        // Keep previous runtime config when fetch fails.
      }
    }

    applyResolvedConfig();
    refreshVoiceConfigFromInject();

    const intervalId = window.setInterval(
      refreshVoiceConfigFromInject,
      VOICE_CONFIG_RELOAD_INTERVAL_MS
    );

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, []);

  function increaseProcessing() {
    processingCountRef.current += 1;
    setIsProcessing(true);

    // Safety timeout: if no response after 15s, reset processing state
    if (processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
    }
    processingTimeoutRef.current = setTimeout(() => {
      console.log('[App] Processing timeout - resetting state');
      processingCountRef.current = 0;
      setIsProcessing(false);
      processingTimeoutRef.current = null;
    }, 15000);
  }

  function decreaseProcessing() {
    processingCountRef.current = Math.max(0, processingCountRef.current - 1);
    setIsProcessing(processingCountRef.current > 0);

    // Clear timeout when processing completes
    if (processingCountRef.current === 0 && processingTimeoutRef.current) {
      clearTimeout(processingTimeoutRef.current);
      processingTimeoutRef.current = null;
    }
  }

  function handleWakeActivation() {
    setIsWakeConfirmed(true);
    try {
      window.localStorage?.setItem('AIRA_WAKEWORD_AUTO_ACTIVATE', '1');
    } catch {
      // Ignore localStorage write failures.
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const shouldAutoActivate = window.localStorage?.getItem('AIRA_WAKEWORD_AUTO_ACTIVATE') === '1';
      if (shouldAutoActivate) {
        setIsWakeConfirmed(true);
      }
    } catch {
      // Ignore localStorage read failures.
    }
  }, []);

  useEffect(() => {
    setIsSpeechBootReady(isWakeConfirmed);
  }, [isWakeConfirmed]);

  useEffect(() => {
    isAiraSpeakingRef.current = isAiraSpeaking;
  }, [isAiraSpeaking]);

  useEffect(() => {
    wakeWordsRef.current = wakeWords;
  }, [wakeWords]);

  useEffect(() => {
    wakeAutoStopAfterFinalMsRef.current = wakeAutoStopAfterFinalMs;
  }, [wakeAutoStopAfterFinalMs]);

  useEffect(() => {
    wakeMaxSessionMsRef.current = wakeMaxSessionMs;
  }, [wakeMaxSessionMs]);

  useEffect(() => {
    isWakeConfirmedRef.current = isWakeConfirmed;
  }, [isWakeConfirmed]);

  useEffect(() => {
    speakRef.current = speak;
    cancelRef.current = cancel;
  }, [speak, cancel]);

  useEffect(() => {
    if (socketRef.current && socketRef.current.io?.uri !== socketServerUrl) {
      try {
        socketRef.current.disconnect();
      } catch {
        // Ignore disconnect errors while rotating socket URL.
      }
      socketRef.current = null;
      setActiveSocket(null);
    }

    if (!socketRef.current) {
      socketRef.current = io(socketServerUrl, {
        path: '/socket.io',
        transports: ['polling', 'websocket'],
        reconnection: true,
        autoConnect: false,
      });
    }

    const socket = socketRef.current;
    setActiveSocket(socket);

    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
      processingCountRef.current = 0;
      setIsProcessing(false);
      setIsPttPressed(false);
      setWakeRuntime((prev) => ({
        ...prev,
        active: false,
      }));
      if (processingTimeoutRef.current) {
        clearTimeout(processingTimeoutRef.current);
        processingTimeoutRef.current = null;
      }
    }

    function onConnectError(errorPayload) {
      setWakeRuntime((prev) => ({
        ...prev,
        active: false,
        error: String(errorPayload?.message || 'conexion fallida con backend wake word'),
      }));
      setMessages((prev) => {
        const nextMessage = `Error de conexion Socket: ${errorPayload?.message || 'desconocido'}`;
        if (prev[0] === nextMessage) {
          return prev;
        }
        return [nextMessage, ...prev].slice(0, 12);
      });
    }

    function onServerReady(payload) {
      const serverVersion = String(payload?.version || 'desconocida');
      const protocolVersion = String(payload?.wsVersion || payload?.protocol?.version || 'n/a');
      const nextMessage = `Servidor listo. Version: ${serverVersion} | WS: ${protocolVersion}`;
      const wakeWordPayload = payload?.wakeWord || {};
      const runtimeVoicePayload = payload?.voiceRuntime || {};

      if (typeof window !== 'undefined') {
        window.__AIRA_SERVER_VOICE_RUNTIME__ = {
          ...runtimeVoicePayload,
        };
      }

      setVoiceClientConfig((prev) => ({
        ...prev,
        sttMode: runtimeVoicePayload?.sttMode ? String(runtimeVoicePayload.sttMode) : prev.sttMode,
        ttsMode: runtimeVoicePayload?.ttsMode ? String(runtimeVoicePayload.ttsMode) : prev.ttsMode,
        ttsProvider: runtimeVoicePayload?.ttsProvider
          ? String(runtimeVoicePayload.ttsProvider)
          : prev.ttsProvider,
        backendStreamingEnabled:
          typeof runtimeVoicePayload?.backendStreamingEnabled === 'boolean'
            ? runtimeVoicePayload.backendStreamingEnabled
            : prev.backendStreamingEnabled,
        browserFallbackEnabled:
          typeof runtimeVoicePayload?.browserFallbackEnabled === 'boolean'
            ? runtimeVoicePayload.browserFallbackEnabled
            : prev.browserFallbackEnabled,
        vibevWsUrl: runtimeVoicePayload?.vibevWsUrl
          ? String(runtimeVoicePayload.vibevWsUrl)
          : prev.vibevWsUrl,
      }));

      setWakeRuntime((prev) => ({
        ...prev,
        mode: String(wakeWordPayload.mode || prev.mode || 'server/openWakeWord'),
        active: Boolean(wakeWordPayload.active),
        error: String(wakeWordPayload.error || ''),
        wakeWordLabel: String(wakeWordPayload.wakeWordLabel || prev.wakeWordLabel || 'AIRA (Custom)'),
        modelName: String(wakeWordPayload.modelName || prev.modelName || 'aira.onnx'),
        threshold: Number.isFinite(Number(wakeWordPayload.threshold))
          ? Number(wakeWordPayload.threshold)
          : prev.threshold,
      }));

      setMessages((prev) => {
        if (prev[prev.length - 1] === nextMessage) {
          return prev;
        }
        return [...prev, nextMessage];
      });
    }

    function onHeartbeat(payload) {
      setServerTime(new Date(payload.timestamp).toLocaleTimeString());
    }

    function onSystemMessage(payload) {
      const nextMessage = String(payload?.message || '').trim();
      if (!nextMessage) {
        return;
      }

      const messageType = String(payload?.type || '').toLowerCase();
      const messageCode = String(payload?.code || '').toUpperCase();
      if (messageType === 'status' && messageCode === 'USER_INPUT_ACCEPTED') {
        return;
      }

      if (messageCode === 'WAKE_WORD_ENGINE_READY') {
        setWakeRuntime((prev) => ({
          ...prev,
          active: true,
          error: '',
        }));
      }

      if (messageCode === 'WAKE_WORD_ENGINE_ERROR') {
        setWakeRuntime((prev) => ({
          ...prev,
          active: false,
          error: nextMessage,
        }));
      }

      setMessages((prev) => {
        if (prev[prev.length - 1] === nextMessage) {
          return prev;
        }
        return [...prev, nextMessage];
      });
    }

    function onAiraNudge(payload) {
      setMessages((prev) => [...prev, payload.message]);
      speakRef.current(String(payload?.message || '').trim(), {
        lang: 'es-MX',
        preset: 'balanced',
        metadata: {
          source: 'aira-nudge',
        },
      });
    }

    function onAiraResponse(payload) {
      decreaseProcessing();
      const responseText = String(payload?.text || '').trim();
      if (!responseText) {
        return;
      }

      setMessages((prev) => [...prev, `Aira: ${responseText}`]);
      speakRef.current(responseText, {
        lang: String(payload?.lang || 'es-MX'),
        preset: String(payload?.preset || 'balanced'),
        metadata: {
          source: 'aira-response',
          clientMessageId: payload?.clientMessageId || '',
        },
      });
    }

    function onStopTts() {
      cancelRef.current({
        reason: 'interrupt',
        notifyServer: false,
      });
    }

    function onWakeWordDetected(payload) {
      setWakeRuntime((prev) => ({
        ...prev,
        active: true,
        error: '',
        threshold: Number.isFinite(Number(payload?.threshold))
          ? Number(payload.threshold)
          : prev.threshold,
        modelName: String(payload?.modelName || prev.modelName || 'aira.onnx'),
      }));

      handleServerWakeWordDetected(payload);
    }

    setIsConnected(socket.connected);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('SERVER_READY', onServerReady);
    socket.on('HEARTBEAT', onHeartbeat);
    socket.on('SYSTEM_MESSAGE', onSystemMessage);
    socket.on('AIRA_NUDGE', onAiraNudge);
    socket.on('AIRA_RESPONSE', onAiraResponse);
    socket.on('STOP_TTS', onStopTts);
    socket.on('WAKE_WORD_DETECTED', onWakeWordDetected);

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('SERVER_READY', onServerReady);
      socket.off('HEARTBEAT', onHeartbeat);
      socket.off('SYSTEM_MESSAGE', onSystemMessage);
      socket.off('AIRA_NUDGE', onAiraNudge);
      socket.off('AIRA_RESPONSE', onAiraResponse);
      socket.off('STOP_TTS', onStopTts);
      socket.off('WAKE_WORD_DETECTED', onWakeWordDetected);
      socket.disconnect();
      socketRef.current = null;
      setActiveSocket(null);
    };
  }, [socketServerUrl]);

  useEffect(() => {
    if (isAiraSpeaking) {
      setVisualizerState(VISUALIZER_STATE.SPEAKING);
      return;
    }

    if (isPttPressed) {
      setVisualizerState(VISUALIZER_STATE.LISTENING);
      return;
    }

    if (isListening) {
      setVisualizerState(VISUALIZER_STATE.LISTENING);
      return;
    }

    if (isProcessing || isPttProcessingBridge) {
      setVisualizerState(VISUALIZER_STATE.PROCESSING);
      return;
    }

    setVisualizerState(VISUALIZER_STATE.IDLE);
  }, [isListening, isAiraSpeaking, isProcessing, isPttProcessingBridge, isPttPressed]);

  useEffect(() => {
    function onVoiceEngineMissing() {
      setMessages((prev) => {
        if (prev.includes(VOICE_ENGINE_MISSING_MESSAGE)) {
          return prev;
        }

        return [VOICE_ENGINE_MISSING_MESSAGE, ...prev].slice(0, 12);
      });
    }

    window.addEventListener('VOICE_ENGINE_MISSING', onVoiceEngineMissing);

    return () => {
      window.removeEventListener('VOICE_ENGINE_MISSING', onVoiceEngineMissing);
    };
  }, []);

  useEffect(() => {
    if (!finalResult || !finalResult.text) {
      return;
    }

    if (lastProcessedFinalIdRef.current === finalResult.id) {
      return;
    }

    lastProcessedFinalIdRef.current = finalResult.id;
    emitVoiceInput(finalResult.text, 'ptt');
  }, [finalResult, isConnected]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function sendTextMessage(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      return;
    }

    const now = Date.now();
    setMessages((prev) => [...prev, `Tu: ${text}`]);
    setChatInput('');

    if (!isConnected) {
      return;
    }

    const normalizedKey = normalizeSpeechKey(text);
    increaseProcessing();
    socketRef.current?.emit(
      'USER_INPUT',
      buildUserInputPayload({
        content: text,
        source: 'keyboard',
        interruptActiveTts: isAiraSpeakingRef.current,
        timestamp: now,
        fingerprint: `keyboard:${normalizedKey}`,
      })
    );
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendTextMessage(chatInput);
    }
  }

  useEffect(() => {
    function isEditableTarget(target) {
      if (!target || !(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select'
      );
    }

    function emitInterrupt(source) {
      if (!isConnected || !socketRef.current) {
        return;
      }

      socketRef.current.emit('USER_INPUT', buildInterruptPayload(source));
    }

    function onKeyDown(event) {
      const isPttKey = event.code === 'Space' || event.code === 'AltLeft' || event.code === 'AltRight';
      if (!isPttKey || event.repeat || activePttKeyRef.current) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      activePttKeyRef.current = event.code;
      setIsPttPressed(true);

      if (isAiraSpeakingRef.current) {
        cancel();
        emitInterrupt('ptt');
      }

      startPTT();
    }

    function onKeyUp(event) {
      if (!activePttKeyRef.current || event.code !== activePttKeyRef.current) {
        return;
      }

      event.preventDefault();
      activePttKeyRef.current = '';
      setIsPttPressed(false);
      stopPTT();
    }

    function onWindowBlur() {
      if (!activePttKeyRef.current) {
        return;
      }

      activePttKeyRef.current = '';
      setIsPttPressed(false);
      stopPTT();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isConnected, startPTT, stopPTT, cancel]);

  function sendPing() {
    socketRef.current?.emit('CLIENT_PING', {
      at: Date.now(),
      from: 'client-ui',
    });
  }

  const isFatalSpeechError = typeof error === 'string' && error.startsWith('FATAL_ERROR');

  return (
    <main className="app-shell">
      <section className="panel panel-left">
        <h1>Aira IA</h1>
        <p className="subtitle">Avatar reactivo en tiempo real</p>

        <Visualizer state={visualizerState} volume={0.18} />

        <div className="avatar-state" aria-live="polite">
          Estado: <strong>{visualizerState}</strong>
        </div>
      </section>

      <section className="panel panel-right">
        <h2 className="panel-title">Chat con Aira</h2>

        <div className="status-row">
          <span className={`status-dot ${isConnected ? 'ok' : 'off'}`} />
          <span>{isConnected ? 'Conectado al servidor' : 'Sin conexion'}</span>
        </div>

        <div className="status-row">
          <span className={`status-dot ${isListening ? 'ok' : isProcessing || isPttProcessingBridge ? 'processing' : 'off'}`} />
          <span>
            {isSupported
              ? isFatalSpeechError
                ? 'FATAL_ERROR'
                : isListening
                  ? 'Escuchando microfono'
                  : isWakeListening
                    ? `Esperando wake word (backend): ${String(wakeRuntime.wakeWordLabel || wakeWords[0] || 'HEY AIRA').toUpperCase()}`
                  : isProcessing || isPttProcessingBridge
                    ? 'Procesando consulta'
                  : !isWakeConfirmed
                    ? 'Pendiente de activacion'
                    : isSpeechBootReady
                      ? 'Reconocimiento en pausa'
                      : 'Inicializando canal de voz...'
              : 'Reconocimiento de voz por navegador no disponible (modo backend activo)'}
          </span>
        </div>

        <p className="server-time">Heartbeat del servidor: {serverTime}</p>
        <p className="server-time">Modo wake word activo: {wakeWordModeLabel}</p>
        <p className="server-time">Modelo wake word backend: {wakeRuntime.modelName || 'aira.onnx'}</p>
        <p className="server-time">Umbral wake word backend: {wakeThresholdForUi.toFixed(2)}</p>
        <p className="server-time">STT runtime (migracion): {String(sttMode || 'browser')}</p>
        <p className="server-time">TTS runtime (migracion): {String(ttsMode || 'browser')}</p>
        <p className="server-time">Proveedor TTS backend: {String(ttsProvider || 'vibevoice-realtime')}</p>
        <p className="server-time">Streaming backend habilitado: {backendStreamingEnabled ? 'si' : 'no'}</p>
        <p className="server-time">VIBEV WS URL: {String(vibevWsUrl || 'no-configurado')}</p>
        <p className="server-time">Fallback navegador habilitado: {browserFallbackEnabled ? 'si' : 'no'}</p>
        {error && <p className="speech-error">{error}</p>}
        {wakeError && <p className="speech-error">{wakeError}</p>}
        {lastWakeWord && (
          <p className="server-time">Wake word detectada recientemente: {lastWakeWord}</p>
        )}

        <section className="chat-container" aria-live="polite">
          {messages.length === 0 && (
            <article className="chat-bubble chat-bubble-aira">
              Hola, soy Aira. Escribe tu consulta o presiona el microfono.
            </article>
          )}

          {messages.map((message, index) => {
            const isUser = message.startsWith('Tu:');
            const bubbleClass = isUser ? 'chat-bubble-user' : 'chat-bubble-aira';
            const visibleMessage = isUser
              ? message.replace(/^Tu:\s*/, '')
              : message.replace(/^Aira:\s*/, '');

            return (
              <article className={`chat-bubble ${bubbleClass}`} key={`${message}-${index}`}>
                {visibleMessage}
              </article>
            );
          })}

          <div ref={chatBottomRef} />
        </section>

        <section className="control-bar" aria-label="Entrada multimodal">
          <button className="icon-btn add-media" type="button" onClick={sendPing}>
            +
          </button>

          <textarea
            className="chat-input"
            placeholder="Hola, que haremos hoy?"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            rows={1}
          />

          <div className="action-buttons">
            <button
              className="icon-btn send-btn"
              type="button"
              onClick={() => sendTextMessage(chatInput)}
              aria-label="Enviar mensaje"
            >
              🚀
            </button>
            <button
              className={`icon-btn mic-btn ${isListening ? 'listening' : ''}`}
              type="button"
              onMouseDown={() => {
                if (isAiraSpeakingRef.current) {
                  cancel();
                }
                setIsPttPressed(true);
                startPTT();
              }}
              onMouseUp={() => {
                setIsPttPressed(false);
                stopPTT();
              }}
              onMouseLeave={() => {
                setIsPttPressed(false);
                stopPTT();
              }}
              onTouchStart={(event) => {
                event.preventDefault();
                if (isAiraSpeakingRef.current) {
                  cancel();
                }
                setIsPttPressed(true);
                startPTT();
              }}
              onTouchEnd={() => {
                setIsPttPressed(false);
                stopPTT();
              }}
              aria-label={isListening ? 'Listening' : 'Push to Talk'}
            >
              🎙️
            </button>
          </div>
        </section>

        <p className="voice-hint">
          {isListening
            ? 'PTT activo: suelta Space o Alt para enviar voz.'
            : interimTranscript || 'Pulsa Enter para enviar. Shift + Enter agrega salto de linea.'}
        </p>
      </section>

      {!isWakeConfirmed && <WakeActivationOverlay onActivate={handleWakeActivation} />}
    </main>
  );
}
